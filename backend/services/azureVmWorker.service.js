import { ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { getSystemSettingsRuntime } from "./systemSettingsRuntime.service.js";

const AZURE_BILLING_MAX_USAGE_DETAILS = 500;
const AZURE_BILLING_METRIC = "actualcost";

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

function getUsageDetailPretaxCost(detail) {
  if (typeof detail?.pretaxCost === "number" && Number.isFinite(detail.pretaxCost)) {
    return detail.pretaxCost;
  }

  const numeric = Number(detail?.pretaxCost);
  return Number.isFinite(numeric) ? numeric : 0;
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

        if (String(detail?.billingCurrency || "").trim()) {
          currency = detail.billingCurrency;
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
