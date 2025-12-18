// utils/isWebRequest.js
export function isWebRequest(req) {
  const xClient = String(req.headers["x-client"] || "").toLowerCase(); // web/app
  if (xClient) return xClient === "web";

  // fallback theo origin/referer (web thường có, app thường không)
  const origin = String(req.headers.origin || "");
  const referer = String(req.headers.referer || "");
  const src = origin || referer;

  const allowed = String(process.env.WEB_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.length === 0) return false; // không cấu hình thì mặc định KHÔNG coi là web
  return allowed.some((o) => src.startsWith(o));
}
