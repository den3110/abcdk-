// controllers/nameStyleController.js
// Public endpoint trả về "bản đồ" hiệu ứng tên của các VĐV đã được admin trang trí.
// Payload nhỏ (chỉ user có effect khác "none") -> client tải 1 lần, cache, tra cứu
// theo userId (fallback theo nickname) ở mọi nơi render tên.
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";

const TTL_MS = 30 * 1000; // cache trong tiến trình 30s (đủ để né quét lặp lại)
const HARD_LIMIT = 5000; // chặn payload phình to bất thường

let _cache = { at: 0, data: null };

/** Xoá cache khi admin thay đổi hiệu ứng tên (gọi từ adminController). */
export function invalidateNameStyleCache() {
  _cache = { at: 0, data: null };
}

/**
 * GET /api/name-styles
 * -> { styles: [{ user, nickname, name, nameStyle }], count }
 */
export const getNameStyles = asyncHandler(async (req, res) => {
  const now = Date.now();
  if (_cache.data && now - _cache.at < TTL_MS) {
    res.set("Cache-Control", "public, max-age=30");
    return res.json(_cache.data);
  }

  const rows = await User.find(
    { "nameStyle.effect": { $in: ["solid", "gradient"] } },
    { _id: 1, nickname: 1, name: 1, nameStyle: 1 },
  )
    .limit(HARD_LIMIT)
    .lean();

  const styles = [];
  for (const u of rows) {
    const ns = u.nameStyle;
    if (!ns || !ns.effect || ns.effect === "none") continue;
    styles.push({
      user: String(u._id),
      nickname: u.nickname || "",
      name: u.name || "",
      nameStyle: {
        effect: ns.effect,
        color: ns.color || "",
        colors: Array.isArray(ns.colors) ? ns.colors : [],
        angle: typeof ns.angle === "number" ? ns.angle : 90,
        animated: Boolean(ns.animated),
        speed: typeof ns.speed === "number" ? ns.speed : 6,
        bold: Boolean(ns.bold),
      },
    });
  }

  const payload = { styles, count: styles.length };
  _cache = { at: now, data: payload };
  res.set("Cache-Control", "public, max-age=30");
  res.json(payload);
});
