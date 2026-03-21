import mongoose from "mongoose";
import {
  getPushDispatchById,
  getPushDispatchSummary,
  listPushDispatches,
} from "../../services/pushDispatchService.js";

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getAdminPushSummary(req, res) {
  try {
    const data = await getPushDispatchSummary();
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error?.message || "Cannot load push summary" });
  }
}

export async function listAdminPushDispatches(req, res) {
  try {
    const data = await listPushDispatches({
      page: asNumber(req.query?.page, 1),
      limit: asNumber(req.query?.limit, 25),
      status: req.query?.status,
      sourceKind: req.query?.sourceKind,
      eventName: req.query?.eventName,
      platform: req.query?.platform,
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error?.message || "Cannot load push dispatches" });
  }
}

export async function getAdminPushDispatchDetail(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(String(id))) {
      return res.status(400).json({ message: "Invalid dispatch id" });
    }

    const data = await getPushDispatchById(id);
    if (!data) {
      return res.status(404).json({ message: "Push dispatch not found" });
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error?.message || "Cannot load push dispatch" });
  }
}
