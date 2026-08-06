// utils/fbPixel.js — Helpers cho Facebook Pixel.
// Pixel script được init trong index.html (`fbq('init', <id>)`) → mọi wrapper
// dưới đây chỉ gọi lại `window.fbq(...)` khi có mặt (an toàn nếu adblock chặn).

export const isFbqReady = () =>
  typeof window !== "undefined" && typeof window.fbq === "function";

export function fbTrack(event, params) {
  if (!isFbqReady()) return;
  try {
    if (params) window.fbq("track", event, params);
    else window.fbq("track", event);
  } catch {}
}

export function fbTrackCustom(event, params) {
  if (!isFbqReady()) return;
  try {
    if (params) window.fbq("trackCustom", event, params);
    else window.fbq("trackCustom", event);
  } catch {}
}

// Fire lại PageView khi SPA đổi route (Pixel snippet chỉ fire ở lần load đầu).
export function fbPageView() {
  fbTrack("PageView");
}
