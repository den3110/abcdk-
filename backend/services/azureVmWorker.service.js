import { DefaultAzureCredential, ClientSecretCredential } from "@azure/identity";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { Client } from "ssh2";
import { getSystemSettingsRuntime } from "./systemSettingsRuntime.service.js";

// Helper để tạo Azure Credential từ cấu hình Account trong DB
function getAzureCredential(account) {
  if (!account.clientId || !account.clientSecret || !account.tenantId) {
    throw new Error(`Tài khoản ${account.label} thiếu thông tin xác thực Azure.`);
  }
  return new ClientSecretCredential(account.tenantId, account.clientId, account.clientSecret);
}

// -------------------------------------------------------------
// [1] Lấy trạng thái của các Máy ảo (VM Status)
// -------------------------------------------------------------
export async function getAzureVmStatuses() {
  const settings = await getSystemSettingsRuntime();
  const accounts = settings.azure?.accounts || [];

  const vmAccounts = accounts.filter(
    (acc) => acc.isActive && acc.capabilities?.useForVmWorker
  );

  const statuses = [];

  for (const acc of vmAccounts) {
    let powerState = "unknown";
    try {
      const cred = getAzureCredential(acc);
      const client = new ComputeManagementClient(cred, acc.subscriptionId);
      const vmResponse = await client.virtualMachines.instanceView(
        acc.resourceGroup,
        acc.vmName
      );
      
      const pState = vmResponse.statuses?.find((s) =>
        s.code.startsWith("PowerState/")
      );
      powerState = pState ? pState.displayStatus : "unknown";
    } catch (err) {
      console.error(`Lỗi lấy trạng thái VM cho ${acc.label}:`, err.message);
      powerState = "error";
    }

    statuses.push({
      accountId: acc.id,
      label: acc.label,
      powerState, // "VM running", "VM deallocated", "VM starting", v.v.
      resourceGroup: acc.resourceGroup,
      vmName: acc.vmName,
    });
  }

  return statuses;
}

// -------------------------------------------------------------
// [2] Bật / Tắt (Toggle) Máy ảo
// -------------------------------------------------------------
export async function toggleAzureVm(accountId, action) {
  const settings = await getSystemSettingsRuntime();
  const acc = settings.azure?.accounts?.find((a) => a.id === accountId);
  
  if (!acc) throw new Error("Không tìm thấy tài khoản Azure này.");
  if (!acc.capabilities?.useForVmWorker) throw new Error("Tài khoản này không được cấu hình cho VM Worker.");

  const cred = getAzureCredential(acc);
  const client = new ComputeManagementClient(cred, acc.subscriptionId);

  if (action === "start") {
    // Không await toàn khóa để tránh block HTTP Request, Azure API tự chạy nền
    client.virtualMachines.beginStart(acc.resourceGroup, acc.vmName).catch(e => console.error(e));
    return "Đã gửi lệnh Start VM.";
  } else if (action === "deallocate") {
    client.virtualMachines.beginDeallocate(acc.resourceGroup, acc.vmName).catch(e => console.error(e));
    return "Đã gửi lệnh Deallocate (Tắt hẳn) VM.";
  } else {
    throw new Error("Lệnh không hợp lệ.");
  }
}

// -------------------------------------------------------------
// [3] Lấy số dư Billing (Cost Management)
// -------------------------------------------------------------
export async function getAzureBillingRecords() {
  const settings = await getSystemSettingsRuntime();
  const accounts = settings.azure?.accounts || [];
  const activeAccounts = accounts.filter(acc => acc.isActive);

  const billingData = [];

  for (const acc of activeAccounts) {
    try {
      const cred = getAzureCredential(acc);
      const client = new ConsumptionManagementClient(cred, acc.subscriptionId);
      
      // Lấy chi tiêu tháng hiện tại (Billing period based)
      // Thường thì dùng costManagement api, nhưng hàm dưới đây là cách đơn giản thông qua consumption
      const scope = `/subscriptions/${acc.subscriptionId}`;
      let totalAmount = 0;
      let currency = "USD";

      // Lấy tổng quan usageDetails (Gói sinh viên có thể bị giới hạn truy cập tuỳ role)
      const usageIterator = client.usageDetails.list(scope, {
         // có thể truyền filter/expand ở đây
      });

      let count = 0;
      for await (const detail of usageIterator) {
        if (detail.pretaxCost) {
          totalAmount += detail.pretaxCost;
          if (detail.billingCurrency) currency = detail.billingCurrency;
        }
        count++;
        // Limit query để avoid long latency
        if (count > 500) break;
      }

      billingData.push({
        accountId: acc.id,
        label: acc.label,
        totalCost: totalAmount.toFixed(2),
        currency: currency
      });
    } catch (err) {
      console.error(`Không thể lấy Billing cho ${acc.label}:`, err.message);
      billingData.push({
        accountId: acc.id,
        label: acc.label,
        totalCost: "?",
        error: "Insufficient Access or API Error"
      });
    }
  }

  return billingData;
}
