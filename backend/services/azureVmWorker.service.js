import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { getSystemSettingsRuntime } from "./systemSettingsRuntime.service.js";

const AZURE_BILLING_MAX_USAGE_DETAILS = 500;
const AZURE_BILLING_METRIC = "actualcost";
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

      let totalAmount = 0;
      let currency = "USD";
      let count = 0;

      for await (const detail of client.usageDetails.list(
        scope,
        getAzureBillingQueryOptions(),
      )) {
        totalAmount += getUsageDetailPretaxCost(detail);

        const detailCurrency = getUsageDetailCurrency(detail);
        if (detailCurrency) {
          currency = detailCurrency;
        }

        count += 1;

        if (count >= AZURE_BILLING_MAX_USAGE_DETAILS) {
          break;
        }
      }

      billingData.push({
        accountId: acc.id,
        label: acc.label,
        totalCost: totalAmount.toFixed(2),
        currency,
      });
    } catch (error) {
      const formattedError = formatAzureBillingError(error);
      console.error(`Không thể lấy billing cho ${acc.label}:`, formattedError);

      billingData.push({
        accountId: acc.id,
        label: acc.label,
        totalCost: "?",
        error: formattedError,
      });
    }
  }

  return billingData;
}
