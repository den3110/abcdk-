import mongoose from "mongoose";
import Court from "../models/courtModel.js";
import FacebookPageConnection from "../models/facebookPageConnectionModel.js";

/* ---------- helpers ---------- */

const normalizePageMode = (mode) => {
  const m = String(mode || "")
    .trim()
    .toLowerCase();
  return m === "custom" ? "custom" : "default";
};

/** Chuẩn hoá liveConfig trả ra client */
const okLiveConfig = (cfg = {}) => {
  const enabled = !!cfg.enabled;
  const videoUrl = (cfg.videoUrl || "").trim();
  const overrideExisting = !!cfg.overrideExisting;

  const advancedSettingEnabled =
    typeof cfg.advancedSettingEnabled === "boolean"
      ? cfg.advancedSettingEnabled
      : !!cfg.advancedRandomEnabled;

  let pageMode = normalizePageMode(
    cfg.pageMode || cfg.randomPageMode || "default"
  );

  let pageConnectionId =
    cfg.pageConnectionId || cfg.randomPageConnectionId || null;

  let pageConnectionName =
    cfg.pageConnectionName || cfg.randomPageConnectionName || "";

  let advancedSetting = cfg.advancedSetting || null;

  // ❌ Nếu tắt cấu hình nâng cao → coi như reset sạch
  if (!advancedSettingEnabled) {
    pageMode = "default";
    pageConnectionId = null;
    pageConnectionName = "";
    advancedSetting = null;
  } else {
    // Nếu advanced đang bật nhưng mode != custom thì cũng không giữ page user
    if (pageMode !== "custom") {
      pageMode = "default";
      pageConnectionId = null;
      pageConnectionName = "";
      // advancedSetting chỉ cần mode default
      if (!advancedSetting || typeof advancedSetting !== "object") {
        advancedSetting = { mode: "default" };
      } else {
        advancedSetting = { mode: "default", ...advancedSetting };
      }
    }
  }

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
async function resolvePageConnectionName(pageConnectionId, userId) {
  if (!pageConnectionId) return "";

  const idStr = String(pageConnectionId);

  let conn = null;

  // 1) Thử như _id
  if (mongoose.isValidObjectId(idStr)) {
    const q = { _id: idStr };
    if (userId) q.user = userId;
    conn = await FacebookPageConnection.findOne(q).lean();
  }

  // 2) Nếu không thấy thì thử theo pageId
  if (!conn) {
    const q = { pageId: idStr };
    if (userId) q.user = userId;
    conn = await FacebookPageConnection.findOne(q).lean();
  }

  if (!conn) return "";
  return conn.pageName || "";
}

/* ---------- core apply logic dùng chung cho single + bulk ---------- */

async function applyLiveConfigPatch(
  court,
  patch,
  { skipVideoLengthCheck } = {}
) {
  const liveConfig = court.liveConfig || {};

  // enabled / overrideExisting
  const enabled = patch.enabled === true || patch.enabled === "true";
  const overrideExisting =
    patch.overrideExisting === true || patch.overrideExisting === "true";

  let videoUrl = (patch.videoUrl ?? "").toString().trim();
  if (!skipVideoLengthCheck && videoUrl.length > 2048) {
    const err = new Error("videoUrl quá dài");
    err.code = "VIDEO_URL_TOO_LONG";
    throw err;
  }

  // ----- advancedSettingEnabled -----
  let advancedSettingEnabled =
    typeof liveConfig.advancedSettingEnabled === "boolean"
      ? liveConfig.advancedSettingEnabled
      : !!liveConfig.advancedRandomEnabled;

  if ("advancedSettingEnabled" in patch) {
    const raw = patch.advancedSettingEnabled;
    advancedSettingEnabled =
      raw === true || raw === "true" || raw === 1 || raw === "1";
  }

  // ----- pageMode -----
  let pageMode = normalizePageMode(
    liveConfig.pageMode || liveConfig.randomPageMode || "default"
  );

  if ("pageMode" in patch) {
    pageMode = normalizePageMode(patch.pageMode);
  }

  // ----- pageConnectionId + pageConnectionName -----
  let pageConnectionId =
    liveConfig.pageConnectionId || liveConfig.randomPageConnectionId || null;

  let pageConnectionName =
    liveConfig.pageConnectionName || liveConfig.randomPageConnectionName || "";

  // Nếu advanced tắt → reset sạch
  if (!advancedSettingEnabled) {
    pageMode = "default";
    pageConnectionId = null;
    pageConnectionName = "";
  } else {
    // advanced đang bật
    if ("pageConnectionId" in patch) {
      const incoming = patch.pageConnectionId;
      if (incoming == null || incoming === "") {
        pageConnectionId = null;
        pageConnectionName = "";
      } else {
        const pid = String(incoming);
        if (pid.length > 256) {
          const err = new Error("pageConnectionId quá dài");
          err.code = "PAGE_ID_TOO_LONG";
          throw err;
        }
        pageConnectionId = pid;
      }
    }

    if (pageMode === "default") {
      // mode default: không dùng page user
      pageConnectionId = null;
      pageConnectionName = "";
    } else {
      // mode custom: nếu có pageConnectionId thì lookup tên
      if (pageConnectionId) {
        pageConnectionName = await resolvePageConnectionName(
          pageConnectionId,
          court.owner || patch.userId || (patch.user && patch.user._id) // phòng xa
        );
      } else {
        pageConnectionName = "";
      }
    }
  }

  // ----- advancedSetting (server build) -----
  let advancedSetting = null;
  if (advancedSettingEnabled) {
    advancedSetting = { mode: pageMode };
    if (pageMode === "custom" && pageConnectionId) {
      advancedSetting.pageConnectionId = pageConnectionId;
    }
  }

  // ----- set lại liveConfig + legacy fields -----
  const finalConfig = {
    ...(liveConfig || {}),
    enabled,
    videoUrl,
    overrideExisting,

    advancedSettingEnabled,
    pageMode,
    pageConnectionId,
    pageConnectionName,
    advancedSetting,

    // legacy fields
    advancedRandomEnabled: advancedSettingEnabled,
    randomPageMode: pageMode,
    randomPageConnectionId: pageConnectionId,
    randomPageConnectionName: pageConnectionName,
  };

  court.liveConfig = finalConfig;
  return finalConfig;
}

/* ---------- CONTROLLERS ---------- */

/** GET /api/admin/courts/:courtId/live-config */
export async function getCourtLiveConfig(req, res) {
  try {
    const { courtId } = req.params;
    if (!mongoose.isValidObjectId(courtId)) {
      return res.status(400).json({ message: "Invalid courtId" });
    }
    const court = await Court.findById(courtId).lean();
    if (!court) return res.status(404).json({ message: "Court not found" });

    return res.json({ liveConfig: okLiveConfig(court.liveConfig || {}) });
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

    const court = await Court.findById(courtId);
    if (!court) return res.status(404).json({ message: "Court not found" });

    // Trim + validate videoUrl trước
    const rawVideoUrl = (req.body?.videoUrl || "").toString().trim();
    if (rawVideoUrl.length > 2048) {
      return res.status(400).json({ message: "videoUrl quá dài" });
    }

    const patch = {
      ...req.body,
      enabled:
        req.body?.enabled === true || req.body?.enabled === "true"
          ? true
          : false,
      overrideExisting:
        req.body?.overrideExisting === true ||
        req.body?.overrideExisting === "true",
      videoUrl: rawVideoUrl,
    };

    let finalCfg;
    try {
      finalCfg = await applyLiveConfigPatch(court, patch, {
        skipVideoLengthCheck: true,
      });
    } catch (err) {
      if (err.code === "PAGE_ID_TOO_LONG") {
        return res.status(400).json({ message: "pageConnectionId quá dài" });
      }
      if (err.code === "VIDEO_URL_TOO_LONG") {
        return res.status(400).json({ message: "videoUrl quá dài" });
      }
      throw err;
    }

    await court.save();

    return res.json({
      success: true,
      liveConfig: okLiveConfig(finalCfg),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Set live config failed" });
  }
}

/** PATCH /api/admin/tournaments/:tid/courts/live-config/bulk
 * body: {
 *   items: [{
 *     courtId,
 *     enabled,
 *     videoUrl,
 *     overrideExisting,
 *     advancedSettingEnabled?,
 *     pageMode?,            // "default" | "custom"
 *     pageConnectionId?,    // nếu custom
 *   }, ...]
 * }
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

    let updated = 0;
    for (const it of items) {
      if (!mongoose.isValidObjectId(it.courtId)) continue;

      const court = await Court.findOne({
        _id: it.courtId,
        tournament: tid,
      });
      if (!court) continue;

      const rawVideoUrl = (it.videoUrl || "").toString().trim();
      if (rawVideoUrl.length > 2048) {
        // skip court này nếu URL rác
        continue;
      }

      const patch = {
        ...it,
        enabled: it.enabled === true || it.enabled === "true",
        overrideExisting:
          it.overrideExisting === true || it.overrideExisting === "true",
        videoUrl: rawVideoUrl,
      };

      try {
        await applyLiveConfigPatch(court, patch, {
          skipVideoLengthCheck: true,
        });
      } catch (err) {
        // nếu lỗi do pageId quá dài thì bỏ qua court này, không phá cả batch
        if (err.code === "PAGE_ID_TOO_LONG") {
          continue;
        }
        throw err;
      }

      await court.save();
      updated += 1;
    }

    if (!updated) {
      return res.status(400).json({ message: "No valid items" });
    }

    return res.json({ success: true, updated });
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
