// utils/nameStyle.js — Hiệu ứng tên hiển thị (đồng bộ với backend/utils/nameStyle.js).
// Chuyển object nameStyle -> inline style (chạy được cả MUI light-DOM lẫn Shadow DOM Astryx).
// Keyframes cho hiệu ứng động (`pkNameShine`) được đăng ký ở:
//   - frontend/src/index.css               (v1 / light DOM)
//   - frontend/src/screens/astryx/ShadowFrame.jsx EXTRA_CSS (v2 / shadow DOM)

export const NAME_ANIM_NAME = "pkNameShine";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const isHex = (v) => typeof v === "string" && HEX_RE.test(v.trim());

/** Chuẩn hoá object nameStyle bất kỳ về dạng an toàn, hoặc null nếu không có hiệu ứng. */
export function normalizeNameStyle(ns) {
  if (!ns || typeof ns !== "object") return null;
  const effect = ns.effect;
  if (!effect || effect === "none") return null;

  if (effect === "solid") {
    const color = isHex(ns.color)
      ? ns.color.trim()
      : Array.isArray(ns.colors) && isHex(ns.colors[0])
        ? ns.colors[0].trim()
        : "";
    if (!color) return null;
    return { effect: "solid", color, bold: !!ns.bold };
  }

  if (effect === "gradient") {
    const colors = (Array.isArray(ns.colors) ? ns.colors : [])
      .filter(isHex)
      .map((c) => c.trim())
      .slice(0, 7);
    if (colors.length < 2) {
      return colors.length === 1
        ? { effect: "solid", color: colors[0], bold: !!ns.bold }
        : null;
    }
    return {
      effect: "gradient",
      colors,
      angle: Number.isFinite(+ns.angle) ? +ns.angle : 90,
      animated: !!ns.animated,
      speed: Number.isFinite(+ns.speed) ? Math.min(30, Math.max(1, +ns.speed)) : 6,
      bold: !!ns.bold,
    };
  }
  return null;
}

export function hasNameEffect(ns) {
  return !!normalizeNameStyle(ns);
}

/**
 * Trả về { style } (inline style object React) để áp lên phần tử chứa tên,
 * hoặc null nếu không có hiệu ứng. Áp lên `<span>`/`<Typography>` bọc quanh tên.
 */
export function buildNameStyleCss(nsRaw) {
  const n = normalizeNameStyle(nsRaw);
  if (!n) return null;

  if (n.effect === "solid") {
    const style = { color: n.color };
    if (n.bold) style.fontWeight = 800;
    return { style };
  }

  // gradient (gồm cả "cầu vồng")
  // Animate: nhân đôi palette + background-size 200% + chạy 0% -> 100% để luôn
  // phủ kín chữ (không bao giờ lộ vùng trống) và lặp liền mạch.
  const stops = n.animated ? [...n.colors, ...n.colors] : n.colors;
  const style = {
    backgroundImage: `linear-gradient(${n.angle}deg, ${stops.join(", ")})`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
    backgroundRepeat: "no-repeat",
  };
  if (n.bold) style.fontWeight = 800;
  if (n.animated) {
    style.backgroundSize = "200% auto";
    style.backgroundPosition = "0% center";
    style.animation = `${NAME_ANIM_NAME} ${n.speed}s linear infinite`;
  }
  return { style };
}

const norm = (s) => String(s || "").trim().toLowerCase();

/**
 * Tra cứu hiệu ứng tên cho một đối tượng render.
 * @param {{byId:Object, byNick:Object}} map  bản đồ đã build từ /api/name-styles
 * @param {Object} target  user/player object (hoặc null)
 * @param {{nickname?:string, name?:string}} [extra] tên chuỗi bổ sung để fallback
 * @returns object nameStyle đã chuẩn hoá hoặc null
 */
export function resolveNameStyle(map, target, extra) {
  // 1) Ưu tiên nameStyle nhúng sẵn trên chính object (getMe / publicProfile)
  const inlineNs =
    normalizeNameStyle(target?.nameStyle) ||
    normalizeNameStyle(target?.user?.nameStyle);
  if (inlineNs) return inlineNs;

  if (!map) return null;
  const byId = map.byId || {};
  const byNick = map.byNick || {};

  // 2) Theo userId (nhiều dạng)
  const idCandidates = [
    target?._id,
    target?.id,
    typeof target?.user === "string" ? target.user : null,
    target?.user?._id,
    target?.user?.id,
  ];
  for (const id of idCandidates) {
    if (id && byId[String(id)]) return normalizeNameStyle(byId[String(id)]);
  }

  // 3) Fallback theo nickname (unique)
  const nickCandidates = [
    target?.nickname,
    target?.nickName,
    target?.nick,
    target?.user?.nickname,
    target?.user?.nickName,
    extra?.nickname,
    extra?.name,
  ];
  for (const nk of nickCandidates) {
    const key = norm(nk);
    if (key && byNick[key]) return normalizeNameStyle(byNick[key]);
  }
  return null;
}
