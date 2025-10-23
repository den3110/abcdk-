import mongoose from "mongoose";
import Court from "../models/courtModel.js";

const okLiveConfig = (cfg = {}) => ({
  enabled: !!cfg.enabled,
  videoUrl: (cfg.videoUrl || "").trim(),
  overrideExisting: !!cfg.overrideExisting,
});

/** GET /api/admin/courts/:courtId/live-config */
export async function getCourtLiveConfig(req, res) {
  try {
    const { courtId } = req.params;
    if (!mongoose.isValidObjectId(courtId)) {
      return res.status(400).json({ message: "Invalid courtId" });
    }
    const court = await Court.findById(courtId).lean();
    if (!court) return res.status(404).json({ message: "Court not found" });
    return res.json({ liveConfig: okLiveConfig(court.liveConfig) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Get live config failed" });
  }
}

/** PATCH /api/admin/courts/:courtId/live-config
 * body: { enabled?: boolean, videoUrl?: string, overrideExisting?: boolean }
 */
export async function setCourtLiveConfig(req, res) {
  try {
    const { courtId } = req.params;
    if (!mongoose.isValidObjectId(courtId)) {
      return res.status(400).json({ message: "Invalid courtId" });
    }

    const enabled = req.body?.enabled === true || req.body?.enabled === "true";
    const overrideExisting =
      req.body?.overrideExisting === true ||
      req.body?.overrideExisting === "true";
    let videoUrl = (req.body?.videoUrl || "").toString().trim();

    // chặn URL quá dài / rác cơ bản
    if (videoUrl.length > 2048) {
      return res.status(400).json({ message: "videoUrl quá dài" });
    }

    const court = await Court.findById(courtId);
    if (!court) return res.status(404).json({ message: "Court not found" });

    court.liveConfig = { enabled, videoUrl, overrideExisting };
    await court.save();

    return res.json({
      success: true,
      liveConfig: okLiveConfig(court.liveConfig),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Set live config failed" });
  }
}

/** PATCH /api/admin/tournaments/:tid/courts/live-config/bulk
 * body: { items: [{ courtId, enabled, videoUrl, overrideExisting }, ...] }
 */
export async function bulkSetCourtLiveConfig(req, res) {
  try {
    const { tid } = req.params;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!mongoose.isValidObjectId(tid)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }
    if (!items.length) {
      return res.status(400).json({ message: "No items provided" });
    }

    const ops = [];
    for (const it of items) {
      if (!mongoose.isValidObjectId(it.courtId)) continue;
      const enabled = it.enabled === true || it.enabled === "true";
      const overrideExisting =
        it.overrideExisting === true || it.overrideExisting === "true";
      const videoUrl = (it.videoUrl || "").toString().trim();

      ops.push({
        updateOne: {
          filter: { _id: it.courtId, tournament: tid },
          update: {
            $set: {
              "liveConfig.enabled": enabled,
              "liveConfig.videoUrl": videoUrl,
              "liveConfig.overrideExisting": overrideExisting,
            },
          },
        },
      });
    }

    if (!ops.length) {
      return res.status(400).json({ message: "No valid items" });
    }

    const result = await Court.bulkWrite(ops, { ordered: false });
    return res.json({ success: true, result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Bulk set live config failed" });
  }
}

/** (tuỳ chọn) GET /api/admin/tournaments/:tid/courts?bracketId=...  */
export async function listCourtsByTournamentLive(req, res) {
  try {
    const { tid } = req.params;
    if (!mongoose.isValidObjectId(tid)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }
    const q = { tournament: tid };
    if (req.query?.bracketId && mongoose.isValidObjectId(req.query.bracketId)) {
      q.bracket = req.query.bracketId;
    }
    const items = await Court.find(q).lean();
    return res.json({ items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Load courts failed" });
  }
}
