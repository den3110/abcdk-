import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { getSystemSettingsRuntime } from "./systemSettingsRuntime.service.js";

const AZURE_BILLING_MAX_USAGE_DETAILS = 500;
const AZURE_BILLING_METRIC = "actualcost";
const AZURE_BILLING_TOP_CATEGORY_LIMIT = 6;
const AZURE_BILLING_TOP_SERVICE_LIMIT = 6;
const AZURE_BILLING_TOP_RESOURCE_LIMIT = 8;
const OBSERVER_AZURE_STATUS_CACHE_TTL_MS = 15_000;

let observerAzureStatusCache = { key: "", value: null, ts: 0 };

function requireAzureAccountField(account, field, label) {
  if (String(account?.[field] || "").trim()) {
    return;
  }

  throw new Error(`Tài khoản ${label} thiếu trường ${field}.`);
}

// Helper để tạo Azure credential từ cấu hình account trong DB.
function getAzureCredential(account) {
  const label = account?.label || "Azure";

  requireAzureAccountField(account, "clientId", label);
  requireAzureAccountField(account, "clientSecret", label);
  requireAzureAccountField(account, "tenantId", label);

  return new ClientSecretCredential(
    String(account.tenantId).trim(),
    String(account.clientId).trim(),
    String(account.clientSecret).trim(),
  );
}

function getAzureSubscriptionId(account) {
  const subscriptionId = String(account?.subscriptionId || "").trim();

  if (!subscriptionId) {
    throw new Error(`Tài khoản ${account?.label || "Azure"} thiếu trường subscriptionId.`);
  }

  return subscriptionId;
}

function normalizePowerState(powerState) {
  const normalized = String(powerState || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("deallocated")) return "deallocated";
  if (normalized.includes("stopped")) return "stopped";
  if (normalized.includes("stopping") || normalized.includes("deallocating")) return "stopping";
  if (normalized.includes("starting")) return "starting";
  if (normalized.includes("running")) return "running";
  return normalized;
}

function isStoppedPowerState(normalizedPowerState) {
  return ["deallocated", "stopped"].includes(normalizedPowerState);
}

function isTransitioningPowerState(normalizedPowerState) {
  return ["starting", "stopping"].includes(normalizedPowerState);
}

function hostnameFromUrl(value) {
  try {
    return new URL(String(value || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function selectObserverAzureAccount(accounts, observerBaseUrl = "") {
  const activeVmAccounts = (accounts || []).filter(
    (acc) => acc?.isActive && acc?.capabilities?.useForVmWorker,
  );
  if (!activeVmAccounts.length) return null;

  const configuredAccountId = String(
    process.env.OBSERVER_AZURE_ACCOUNT_ID ||
      process.env.AZURE_OBSERVER_ACCOUNT_ID ||
      "",
  ).trim();
  if (configuredAccountId) {
    const matched = activeVmAccounts.find((acc) => acc.id === configuredAccountId);
    if (matched) return matched;
  }

  const observerHost = hostnameFromUrl(observerBaseUrl);
  if (observerHost) {
    const hostMatched = activeVmAccounts.find((acc) => {
      const vmName = String(acc.vmName || "").trim().toLowerCase();
      const label = String(acc.label || "").trim().toLowerCase();
      return (
        (vmName && observerHost.includes(vmName)) ||
        (label && observerHost.includes(label.replace(/\s+/g, "-")))
      );
    });
    if (hostMatched) return hostMatched;
  }

  const observerNamed = activeVmAccounts.find((acc) => {
    const key = `${acc.label || ""} ${acc.vmName || ""}`.toLowerCase();
    return key.includes("observer");
  });
  if (observerNamed) return observerNamed;

  return activeVmAccounts.length === 1 ? activeVmAccounts[0] : null;
}

export function buildAzureConsumptionScope(subscriptionId) {
  const normalized = String(subscriptionId || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!normalized) {
    throw new Error("Thiếu subscriptionId Azure để tạo billing scope.");
  }

  return normalized.startsWith("subscriptions/")
    ? normalized
    : `subscriptions/${normalized}`;
}

function getAzureBillingQueryOptions() {
  return {
    top: AZURE_BILLING_MAX_USAGE_DETAILS,
    metric: AZURE_BILLING_METRIC,
  };
}

export function formatAzureBillingError(error) {
  const statusCode =
    error?.statusCode ||
    error?.status ||
    error?.response?.status ||
    error?.details?.statusCode ||
    null;

  const code =
    error?.details?.error?.code ||
    error?.body?.error?.code ||
    error?.code ||
    null;

  const rawMessage =
    error?.details?.error?.message ||
    error?.body?.error?.message ||
    error?.message ||
    "";

  const message = String(rawMessage)
    .replace(/\s+/g, " ")
    .trim();

  const prefixParts = [];
  if (code) prefixParts.push(code);
  if (statusCode) prefixParts.push(`HTTP ${statusCode}`);

  if (prefixParts.length && message) {
    return `${prefixParts.join(" | ")}: ${message}`;
  }

  if (message) {
    return message;
  }

  if (prefixParts.length) {
    return prefixParts.join(" | ");
  }

  return "Azure billing API error";
}

export function getUsageDetailPretaxCost(detail) {
  const candidates = [
    detail?.costInBillingCurrency,
    detail?.paygCostInBillingCurrency,
    detail?.pretaxCost,
    detail?.costInPricingCurrency,
    detail?.costInUSD,
    detail?.paygCostInUSD,
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return 0;
}

function getUsageDetailCurrency(detail) {
  const candidates = [
    detail?.billingCurrency,
    detail?.billingCurrencyCode,
    detail?.pricingCurrencyCode,
    detail?.currency,
  ];

  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function normalizeBillingText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function coalesceBillingText(...values) {
  for (const value of values) {
    const normalized = normalizeBillingText(value);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function addCostRow(targetMap, key, payload) {
  const normalizedKey = normalizeBillingText(key).toLowerCase() || "other";
  const existing = targetMap.get(normalizedKey);
  if (existing) {
    existing.totalCost += payload.totalCost;
    existing.itemCount += payload.itemCount;
    existing.resourceGroup = existing.resourceGroup || payload.resourceGroup || "";
    existing.serviceName = existing.serviceName || payload.serviceName || "";
    existing.resourceId = existing.resourceId || payload.resourceId || "";
    existing.label = existing.label || payload.label || "";
    return;
  }

  targetMap.set(normalizedKey, {
    key: normalizedKey,
    label: payload.label || key,
    totalCost: payload.totalCost,
    itemCount: payload.itemCount,
    resourceGroup: payload.resourceGroup || "",
    serviceName: payload.serviceName || "",
    resourceId: payload.resourceId || "",
  });
}

function toSortedBreakdownRows(targetMap, totalCost, limit) {
  return Array.from(targetMap.values())
    .sort((left, right) => {
      if (right.totalCost !== left.totalCost) {
        return right.totalCost - left.totalCost;
      }

      return left.label.localeCompare(right.label, "vi");
    })
    .slice(0, limit)
    .map((row) => ({
      ...row,
      totalCost: Number(row.totalCost.toFixed(4)),
      sharePercent:
        totalCost > 0 ? Number(((row.totalCost / totalCost) * 100).toFixed(1)) : 0,
    }));
}

function basenameFromResourceId(resourceId = "") {
  const normalized = normalizeBillingText(resourceId).replace(/\/+$/, "");
  if (!normalized) return "";

  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

export function classifyAzureBillingCategory(detail) {
  const serviceName = normalizeBillingText(detail?.serviceName);
  const meterCategory = normalizeBillingText(detail?.meterCategory);
  const consumedService = normalizeBillingText(detail?.consumedService);
  const product = normalizeBillingText(detail?.product);
  const productOrderName = normalizeBillingText(detail?.productOrderName);
  const chargeType = normalizeBillingText(detail?.chargeType);
  const publisherType = normalizeBillingText(detail?.publisherType);
  const instanceName = normalizeBillingText(detail?.instanceName);
  const resourceId = normalizeBillingText(detail?.resourceId);
  const keywordBag = [
    serviceName,
    meterCategory,
    consumedService,
    product,
    productOrderName,
    chargeType,
    publisherType,
    instanceName,
    resourceId,
  ]
    .join(" ")
    .toLowerCase();

  if (
    /reservation|reserved instance|savings plan|commitment|purchase|spot|refund/.test(
      keywordBag,
    ) ||
    ["purchase", "refund"].includes(chargeType.toLowerCase())
  ) {
    return { key: "commitment", label: "Cam kết / mua trước" };
  }

  if (
    /disk|storage|snapshot|managed disk|ssd|hdd|blob|files|premium ssd|standard ssd|ultra disk|storage account/.test(
      keywordBag,
    )
  ) {
    return { key: "storage", label: "Disk / Storage" };
  }

  if (
    /network|bandwidth|public ip|nat gateway|load balancer|vpn gateway|traffic manager|virtual network|vnet|application gateway|expressroute/.test(
      keywordBag,
    )
  ) {
    return { key: "network", label: "Network / IP" };
  }

  if (/monitor|insights|log analytics|application insights|diagnostic/.test(keywordBag)) {
    return { key: "monitoring", label: "Monitor / Logs" };
  }

  if (/backup|recovery services|site recovery|recovery vault/.test(keywordBag)) {
    return { key: "backup", label: "Backup / Recovery" };
  }

  if (
    /virtual machines|compute|container|aks|app service|functions|vm|standard_[a-z0-9]+/.test(
      keywordBag,
    )
  ) {
    return { key: "compute", label: "Compute" };
  }

  return { key: "other", label: "Khác" };
}

function getAzureBillingServiceLabel(detail) {
  return (
    coalesceBillingText(
      detail?.serviceName,
      detail?.meterCategory,
      detail?.consumedService,
      detail?.product,
      detail?.productOrderName,
    ) || "Khác"
  );
}

function getAzureBillingResourceSummary(detail) {
  const serviceName = getAzureBillingServiceLabel(detail);
  const resourceGroup = coalesceBillingText(detail?.resourceGroup);
  const instanceName = coalesceBillingText(detail?.instanceName);
  const resourceId = coalesceBillingText(detail?.resourceId);
  const fallbackName = basenameFromResourceId(resourceId);
  const label =
    coalesceBillingText(instanceName, fallbackName) ||
    (resourceGroup ? `RG ${resourceGroup}` : serviceName);

  return {
    key: coalesceBillingText(resourceId, instanceName, resourceGroup, serviceName, "other"),
    label,
    resourceGroup,
    serviceName,
    resourceId,
  };
}

export function summarizeAzureUsageDetails(details, options = {}) {
  const {
    categoryLimit = AZURE_BILLING_TOP_CATEGORY_LIMIT,
    serviceLimit = AZURE_BILLING_TOP_SERVICE_LIMIT,
    resourceLimit = AZURE_BILLING_TOP_RESOURCE_LIMIT,
  } = options;

  let totalAmount = 0;
  let currency = "USD";
  let count = 0;
  let latestUsageAt = "";

  const categoryMap = new Map();
  const serviceMap = new Map();
  const resourceMap = new Map();

  for (const detail of details || []) {
    const amount = getUsageDetailPretaxCost(detail);
    totalAmount += amount;

    const detailCurrency = getUsageDetailCurrency(detail);
    if (detailCurrency) {
      currency = detailCurrency;
    }

    const usageAt = coalesceBillingText(detail?.usageEnd, detail?.date, detail?.usageStart);
    if (usageAt && (!latestUsageAt || String(usageAt) > String(latestUsageAt))) {
      latestUsageAt = String(usageAt);
    }

    count += 1;

    const category = classifyAzureBillingCategory(detail);
    addCostRow(categoryMap, category.key, {
      label: category.label,
      totalCost: amount,
      itemCount: 1,
    });

    const serviceLabel = getAzureBillingServiceLabel(detail);
    addCostRow(serviceMap, serviceLabel, {
      label: serviceLabel,
      totalCost: amount,
      itemCount: 1,
    });

    const resource = getAzureBillingResourceSummary(detail);
    addCostRow(resourceMap, resource.key, {
      label: resource.label,
      totalCost: amount,
      itemCount: 1,
      resourceGroup: resource.resourceGroup,
      serviceName: resource.serviceName,
      resourceId: resource.resourceId,
    });
  }

  return {
    totalAmount,
    currency,
    usageDetailCount: count,
    latestUsageAt,
    categories: toSortedBreakdownRows(categoryMap, totalAmount, categoryLimit),
    services: toSortedBreakdownRows(serviceMap, totalAmount, serviceLimit),
    resources: toSortedBreakdownRows(resourceMap, totalAmount, resourceLimit),
  };
}

// -------------------------------------------------------------
// [1] Lấy trạng thái của các máy ảo (VM status)
// -------------------------------------------------------------
export async function getAzureVmStatuses() {
  const settings = await getSystemSettingsRuntime();
  const accounts = settings.azure?.accounts || [];

  const vmAccounts = accounts.filter(
    (acc) => acc.isActive && acc.capabilities?.useForVmWorker,
  );

  const statuses = [];

  for (const acc of vmAccounts) {
    let powerState = "unknown";

    try {
      const cred = getAzureCredential(acc);
      const subscriptionId = getAzureSubscriptionId(acc);
      const client = new ComputeManagementClient(cred, subscriptionId);
      const vmResponse = await client.virtualMachines.instanceView(
        acc.resourceGroup,
        acc.vmName,
      );

      const pState = vmResponse.statuses?.find((status) =>
        status.code?.startsWith("PowerState/"),
      );

      powerState = pState?.displayStatus || "unknown";
    } catch (error) {
      console.error(`Lỗi lấy trạng thái VM cho ${acc.label}:`, error.message);
      powerState = "error";
    }

    statuses.push({
      accountId: acc.id,
      label: acc.label,
      powerState,
      resourceGroup: acc.resourceGroup,
      vmName: acc.vmName,
    });
  }

  return statuses;
}

export async function getObserverAzureVmStatus(observerBaseUrl = "", options = {}) {
  const { forceRefresh = false } = options || {};
  const settings = await getSystemSettingsRuntime();
  const accounts = settings.azure?.accounts || [];
  const account = selectObserverAzureAccount(accounts, observerBaseUrl);

  if (!account) {
    return {
      configured: false,
      accountId: null,
      label: "",
      resourceGroup: "",
      vmName: "",
      powerState: "unknown",
      normalizedPowerState: "unknown",
      isRunning: false,
      isStopped: false,
      isTransitioning: false,
      checkedAt: new Date().toISOString(),
      message: "Chưa xác định được tài khoản Azure của Observer VPS.",
    };
  }

  const cacheKey = `${account.id}|${account.resourceGroup}|${account.vmName}`;
  const now = Date.now();
  if (
    !forceRefresh &&
    observerAzureStatusCache.value &&
    observerAzureStatusCache.key === cacheKey &&
    now - observerAzureStatusCache.ts <= OBSERVER_AZURE_STATUS_CACHE_TTL_MS
  ) {
    return observerAzureStatusCache.value;
  }

  let powerState = "unknown";
  let error = "";

  try {
    const cred = getAzureCredential(account);
    const subscriptionId = getAzureSubscriptionId(account);
    const client = new ComputeManagementClient(cred, subscriptionId);
    const vmResponse = await client.virtualMachines.instanceView(
      account.resourceGroup,
      account.vmName,
    );
    const pState = vmResponse.statuses?.find((status) =>
      status.code?.startsWith("PowerState/"),
    );
    powerState = pState?.displayStatus || "unknown";
  } catch (err) {
    error = err?.message || "Không thể kiểm tra trạng thái Azure VM.";
    console.error(
      `[observer-azure] Không thể lấy trạng thái VM ${account.label || account.vmName}:`,
      error,
    );
  }

  const normalizedPowerState = normalizePowerState(powerState);
  const result = {
    configured: true,
    accountId: account.id,
    label: account.label,
    resourceGroup: account.resourceGroup,
    vmName: account.vmName,
    powerState,
    normalizedPowerState,
    isRunning: normalizedPowerState === "running",
    isStopped: isStoppedPowerState(normalizedPowerState),
    isTransitioning: isTransitioningPowerState(normalizedPowerState),
    checkedAt: new Date().toISOString(),
    error,
  };

  observerAzureStatusCache = { key: cacheKey, value: result, ts: now };
  return result;
}

// -------------------------------------------------------------
// [2] Bật / tắt (toggle) máy ảo
// -------------------------------------------------------------
export async function toggleAzureVm(accountId, action) {
  const settings = await getSystemSettingsRuntime();
  const acc = settings.azure?.accounts?.find((item) => item.id === accountId);

  if (!acc) {
    throw new Error("Không tìm thấy tài khoản Azure này.");
  }

  if (!acc.capabilities?.useForVmWorker) {
    throw new Error("Tài khoản này không được cấu hình cho VM Worker.");
  }

  const cred = getAzureCredential(acc);
  const subscriptionId = getAzureSubscriptionId(acc);
  const client = new ComputeManagementClient(cred, subscriptionId);

  if (action === "start") {
    client.virtualMachines
      .beginStart(acc.resourceGroup, acc.vmName)
      .catch((error) => console.error(error));
    return "Đã gửi lệnh Start VM.";
  }

  if (action === "deallocate") {
    client.virtualMachines
      .beginDeallocate(acc.resourceGroup, acc.vmName)
      .catch((error) => console.error(error));
    return "Đã gửi lệnh Deallocate (tắt hẳn) VM.";
  }

  throw new Error("Lệnh không hợp lệ.");
}

// -------------------------------------------------------------
// [3] Lấy chi phí Azure billing
// -------------------------------------------------------------
export async function getAzureBillingRecords() {
  const settings = await getSystemSettingsRuntime();
  const accounts = settings.azure?.accounts || [];
  const activeAccounts = accounts.filter((acc) => acc.isActive);

  const billingData = [];

  for (const acc of activeAccounts) {
    try {
      const cred = getAzureCredential(acc);
      const subscriptionId = getAzureSubscriptionId(acc);
      const client = new ConsumptionManagementClient(cred, subscriptionId);
      const scope = buildAzureConsumptionScope(subscriptionId);
      const usageDetails = [];

      for await (const detail of client.usageDetails.list(
        scope,
        getAzureBillingQueryOptions(),
      )) {
        usageDetails.push(detail);

        if (usageDetails.length >= AZURE_BILLING_MAX_USAGE_DETAILS) {
          break;
        }
      }

      const summarized = summarizeAzureUsageDetails(usageDetails);

      billingData.push({
        accountId: acc.id,
        label: acc.label,
        totalCost: summarized.totalAmount.toFixed(2),
        totalCostRaw: Number(summarized.totalAmount.toFixed(4)),
        currency: summarized.currency,
        usageDetailCount: summarized.usageDetailCount,
        usageDetailLimit: AZURE_BILLING_MAX_USAGE_DETAILS,
        usageDetailLimitReached:
          summarized.usageDetailCount >= AZURE_BILLING_MAX_USAGE_DETAILS,
        latestUsageAt: summarized.latestUsageAt || null,
        breakdown: {
          categories: summarized.categories,
          services: summarized.services,
          resources: summarized.resources,
        },
        note:
          "Chi phí là lũy kế trong kỳ hiện tại và có thể trễ cập nhật so với trạng thái VM.",
      });
    } catch (error) {
      const formattedError = formatAzureBillingError(error);
      console.error(`Không thể lấy billing cho ${acc.label}:`, formattedError);

      billingData.push({
        accountId: acc.id,
        label: acc.label,
        totalCost: "?",
        totalCostRaw: null,
        error: formattedError,
        usageDetailCount: 0,
        usageDetailLimit: AZURE_BILLING_MAX_USAGE_DETAILS,
        usageDetailLimitReached: false,
        latestUsageAt: null,
        breakdown: {
          categories: [],
          services: [],
          resources: [],
        },
      });
    }
  }

  return billingData;
}
