// utils/nameStyle.js
// Chuẩn hoá & làm sạch object "hiệu ứng tên" (nameStyle) do admin cấu hình.
// Dùng chung ở: adminController (ghi), nameStyleController (đọc), createUser…

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const NAME_STYLE_EFFECTS = ["none", "solid", "gradient"];
export const NAME_STYLE_MAX_COLORS = 7;

const clampNum = (v, min, max, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

const cleanHex = (v) => {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return HEX_RE.test(s) ? s.toLowerCase() : "";
};

/**
 * Trả về object nameStyle đã làm sạch (an toàn để lưu DB / gửi client).
 * Không hợp lệ -> { effect: "none" }.
 */
export function sanitizeNameStyle(input) {
  const out = {
    effect: "none",
    color: "",
    colors: [],
    angle: 90,
    animated: false,
    speed: 6,
    bold: false,
  };
  if (!input || typeof input !== "object") return out;

  let effect = String(input.effect || "none").toLowerCase();
  if (!NAME_STYLE_EFFECTS.includes(effect)) effect = "none";

  out.bold = Boolean(input.bold);

  if (effect === "solid") {
    const color =
      cleanHex(input.color) ||
      cleanHex(Array.isArray(input.colors) ? input.colors[0] : "");
    if (!color) return out; // không có màu hợp lệ -> none
    out.effect = "solid";
    out.color = color;
    return out;
  }

  if (effect === "gradient") {
    const colors = (Array.isArray(input.colors) ? input.colors : [])
      .map(cleanHex)
      .filter(Boolean)
      .slice(0, NAME_STYLE_MAX_COLORS);
    if (colors.length < 2) {
      // gradient cần >=2 màu; nếu đúng 1 màu -> coi như solid
      if (colors.length === 1) {
        out.effect = "solid";
        out.color = colors[0];
      }
      return out;
    }
    out.effect = "gradient";
    out.colors = colors;
    out.angle = clampNum(input.angle, 0, 360, 90);
    out.animated = Boolean(input.animated);
    out.speed = clampNum(input.speed, 1, 30, 6);
    return out;
  }

  return out; // none
}

/** Có phải một hiệu ứng "thật" (khác none) không. */
export function hasNameEffect(ns) {
  return Boolean(ns && ns.effect && ns.effect !== "none");
}
