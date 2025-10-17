// controllers/adminConfigController.js
import {
  listCfg,
  getCfgStr,
  setCfg,
  deleteCfg,
} from "../services/config.service.js";
import { scheduleFbResync, resyncNow } from "../services/fbTokenService.js";

/**
 * GET /admin/config
 * Trả về toàn bộ config (tuỳ policy: bạn có thể mask secret ở service)
 */
export async function getAllConfig(req, res) {
  try {
    const list = await listCfg();
    res.json({ items: list });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
}

/**
 * GET /admin/config/:key
 * Lấy 1 key cụ thể (ở đây không mask – tuỳ policy)
 */
export async function getConfigValue(req, res) {
  try {
    const { key } = req.params;
    const val = await getCfgStr(key, "");
    res.json({ key, value: val });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
}

/**
 * POST /admin/config
 * Upsert 1 config: { key, value, isSecret? }
 * Nếu key là FB_BOOT_LONG_USER_TOKEN hoặc REFRESH_THRESHOLD_HOURS:
 *  - ?resync=now  (hoặc body.resync="now")  → chạy resync ngay (prune + bootstrap + sweep)
 *  - ngược lại    → schedule resync sau 500ms (không block request)
 */
export async function upsertConfig(req, res) {
  try {
    const { key, value, isSecret } = req.body || {};
    const updatedBy = req.user?.email || "admin";

    if (!key) {
      return res.status(400).json({ message: "Missing 'key'." });
    }

    const result = await setCfg({
      key,
      value,
      isSecret: !!isSecret,
      updatedBy,
    });

    const K = String(key).toUpperCase();
    const shouldResync =
      K === "FB_BOOT_LONG_USER_TOKEN" || K === "REFRESH_THRESHOLD_HOURS";

    if (!shouldResync) {
      return res.json({ ok: 1, ...result });
    }

    // Chọn chế độ resync
    const mode = String(
      req.body?.resync || req.query?.resync || "schedule"
    ).toLowerCase();

    if (mode === "now" || mode === "immediate") {
      // Chạy ngay: PRUNE theo config, rồi SYNC pages, rồi SWEEP refresh
      const r = await resyncNow();
      return res.json({ ok: 1, ...result, resync: { mode: "now", ...r } });
    }

    // Mặc định: schedule để không block request
    scheduleFbResync(500);
    return res.json({
      ok: 1,
      ...result,
      resync: { mode: "scheduled", delayMs: 500 },
    });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
}

/**
 * (Tuỳ chọn) POST /admin/fb/resync
 * Cho phép bấm nút “Resync now” thủ công từ UI
 * - body.mode="now" → chạy ngay
 * - ngược lại       → schedule
 */
export async function triggerFbResync(req, res) {
  try {
    const mode = String(
      req.body?.mode || req.query?.mode || "schedule"
    ).toLowerCase();
    if (mode === "now" || mode === "immediate") {
      const r = await resyncNow();
      return res.json({ ok: 1, resync: { mode: "now", ...r } });
    }
    scheduleFbResync(500);
    return res.json({ ok: 1, resync: { mode: "scheduled", delayMs: 500 } });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
}

/*
— Router wiring (đặt ở file routes của bạn):
router.get("/config",        protect, authorize("admin"), getAllConfig);
router.get("/config/:key",   protect, authorize("admin"), getConfigValue);
router.post("/config",       protect, authorize("admin"), upsertConfig);

// (tuỳ chọn) nút bấm resync:
router.post("/fb/resync",    protect, authorize("admin"), triggerFbResync);

- Khi lưu FB_BOOT_LONG_USER_TOKEN:
  POST /admin/config { key: "FB_BOOT_LONG_USER_TOKEN", value: "tok1,tok2", isSecret: true, resync: "now" }
  → sẽ chạy resync ngay (prune + sync + sweep)

- Nếu muốn không block request:
  POST /admin/config { key: "FB_BOOT_LONG_USER_TOKEN", value: "tok1,tok2", isSecret: true }
  → schedule resync sau 500ms
*/

// controller
export async function deleteConfig(req, res) {
  try {
    const { key } = req.params;
    const r = await deleteCfg(key);
    res.json({ ok: 1, deleted: r?.deletedCount ?? 0 });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}
