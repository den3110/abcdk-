import {
  getAzureVmStatuses,
  toggleAzureVm,
  getAzureBillingRecords,
} from "../services/azureVmWorker.service.js";

export async function getAzureStatus(req, res) {
  try {
    const statuses = await getAzureVmStatuses();
    res.json({ success: true, vms: statuses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function toggleVmState(req, res) {
  try {
    const { accountId, action } = req.body;
    if (!accountId || !["start", "deallocate"].includes(action)) {
      return res.status(400).json({ success: false, message: "Thiếu accountId hoặc action không hợp lệ." });
    }
    
    const msg = await toggleAzureVm(accountId, action);
    res.json({ success: true, message: msg });
  } catch (error) {
    console.error("toggleVmState Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getAzureBilling(req, res) {
  try {
    const billing = await getAzureBillingRecords();
    res.json({ success: true, billing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
