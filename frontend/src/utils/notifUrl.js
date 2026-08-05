// utils/notifUrl.js — Chuẩn hoá URL notification từ backend (mobile format) sang web route.
// Backend gửi url style mobile (VD /messages/:cid). Web dùng /messages?c=:cid.
export function normalizeNotifUrl(url) {
  if (!url) return "/notifications";
  const s = String(url);
  const chatMatch = s.match(/^\/messages\/([^/?#]+)(.*)?$/);
  if (chatMatch) return `/messages?c=${chatMatch[1]}${chatMatch[2] || ""}`;
  // /feed/post/:id — web đã có route detail chung với mobile.
  return s;
}
