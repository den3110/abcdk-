import mongoose from "mongoose";
import Court from "../models/courtModel.js";

import FacebookPageConnection from "../models/facebookPageConnectionModel.js";

const { Schema, Types } = mongoose;

/** Chuẩn hoá liveConfig trả ra client */
const okLiveConfig = (cfg = {}) => {
  const enabled = !!cfg.enabled;
  const videoUrl = (cfg.videoUrl || "").trim();
  const overrideExisting = !!cfg.overrideExisting;

  const advancedSettingEnabled =
    typeof cfg.advancedSettingEnabled === "boolean"
      ? cfg.advancedSettingEnabled
      : !!cfg.advancedRandomEnabled;

  const pageMode = cfg.pageMode || cfg.randomPageMode || "default" || "default";

  const pageConnectionId =
    cfg.pageConnectionId || cfg.randomPageConnectionId || null;

  const pageConnectionName =
    cfg.pageConnectionName || cfg.randomPageConnectionName || "";

  const advancedSetting = cfg.advancedSetting || null;

  return {
    enabled,
    videoUrl,
    overrideExisting,
    advancedSettingEnabled,
    pageMode,
    pageConnectionId,
    pageConnectionName,
    advancedSetting,
  };
};

/** Tìm tên Page từ pageConnectionId (ưu tiên _id, fallback pageId) */
async function resolvePageConnectionName(pageConnectionId) {
  if (!pageConnectionId) return "";

  const idStr = String(pageConnectionId);

  // 1) thử coi như _id của FacebookPageConnection
  let conn = null;
  if (mongoose.isValidObjectId(idStr)) {
    conn = await FacebookPageConnection.findById(idStr).lean();
  }

  // 2) nếu không thấy thì thử theo pageId
  if (!conn) {
    conn = await FacebookPageConnection.findOne({ pageId: idStr }).lean();
  }

  if (!conn) return "";

  return conn.pageName || "";
}

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
 * body: {
 *   enabled?: boolean,
 *   videoUrl?: string,
 *   overrideExisting?: boolean,
 *   advancedSettingEnabled?: boolean,
 *   pageMode?: "default" | "custom",
 *   pageConnectionId?: string        // chỉ dùng khi pageMode = "custom"
 * }
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

    const liveConfig = court.liveConfig || {};

    // ----- advancedSettingEnabled -----
    let advancedSettingEnabled =
      typeof liveConfig.advancedSettingEnabled === "boolean"
        ? liveConfig.advancedSettingEnabled
        : !!liveConfig.advancedRandomEnabled;

    if ("advancedSettingEnabled" in req.body) {
      const raw = req.body.advancedSettingEnabled;
      advancedSettingEnabled =
        raw === true || raw === "true" || raw === 1 || raw === "1";
    }

    // ----- pageMode -----
    let pageMode = (
      liveConfig.pageMode ||
      liveConfig.randomPageMode ||
      "default"
    )
      .toString()
      .trim()
      .toLowerCase();

    if ("pageMode" in req.body) {
      const rawMode = (req.body.pageMode || "").toString().trim().toLowerCase();
      pageMode = rawMode === "custom" ? "custom" : "default";
    }

    // ----- pageConnectionId + pageConnectionName -----
    let pageConnectionId =
      liveConfig.pageConnectionId || liveConfig.randomPageConnectionId || null;

    let pageConnectionName =
      liveConfig.pageConnectionName ||
      liveConfig.randomPageConnectionName ||
      "";

    if (pageMode === "default") {
      // dùng Page hệ thống → không dùng pageConnectionId
      pageConnectionId = null;
      pageConnectionName = "";
    } else {
      // mode "custom"
      if ("pageConnectionId" in req.body) {
        const incoming = req.body.pageConnectionId;
        if (incoming == null || incoming === "") {
          pageConnectionId = null;
          pageConnectionName = "";
        } else {
          const pid = String(incoming);
          if (pid.length > 256) {
            return res
              .status(400)
              .json({ message: "pageConnectionId quá dài" });
          }
          pageConnectionId = pid;
        }
      }

      // Nếu đang có pageConnectionId thì tự đi lookup tên
      if (pageConnectionId) {
        pageConnectionName = await resolvePageConnectionName(pageConnectionId);
      } else {
        pageConnectionName = "";
      }
    }

    // ----- advancedSetting (server build, không phụ thuộc client) -----
    let advancedSetting = null;
    if (advancedSettingEnabled) {
      advancedSetting = { mode: pageMode };
      if (pageMode === "custom" && pageConnectionId) {
        advancedSetting.pageConnectionId = pageConnectionId;
      }
    }

    // ----- ghi lại liveConfig với field mới -----
    liveConfig.enabled = enabled;
    liveConfig.videoUrl = videoUrl;
    liveConfig.overrideExisting = overrideExisting;

    liveConfig.advancedSettingEnabled = advancedSettingEnabled;
    liveConfig.pageMode = pageMode;
    liveConfig.pageConnectionId = pageConnectionId;
    liveConfig.pageConnectionName = pageConnectionName;
    liveConfig.advancedSetting = advancedSetting;

    // 🧯 sync với field cũ cho chỗ code legacy
    liveConfig.advancedRandomEnabled = advancedSettingEnabled;
    liveConfig.randomPageMode = pageMode;
    liveConfig.randomPageConnectionId = pageConnectionId;
    liveConfig.randomPageConnectionName = pageConnectionName;

    court.liveConfig = liveConfig;
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
