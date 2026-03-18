const ABSOLUTE_HTTP_URL_RE = /^https?:\/\//i;
const IS_PROD = String(process.env.NODE_ENV || "").toLowerCase() === "production";

function firstForwardedValue(value) {
  if (Array.isArray(value)) return firstForwardedValue(value[0]);
  return String(value || "")
    .split(",")[0]
    .trim();
}

function sanitizeProto(value) {
  const proto = firstForwardedValue(value).toLowerCase();
  return proto === "https" || proto === "http" ? proto : "";
}

function normalizeAbsoluteHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!ABSOLUTE_HTTP_URL_RE.test(raw)) return "";

  try {
    const url = new URL(raw);
    if (IS_PROD) {
      url.protocol = "https:";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function isAbsoluteHttpUrl(value) {
  return ABSOLUTE_HTTP_URL_RE.test(String(value || "").trim());
}

export function getPublicBaseUrl(req) {
  const configuredBaseUrl =
    normalizeAbsoluteHttpUrl(process.env.EXTERNAL_BASE_URL) ||
    normalizeAbsoluteHttpUrl(process.env.HOST) ||
    normalizeAbsoluteHttpUrl(process.env.WEB_URL);

  if (configuredBaseUrl) return configuredBaseUrl;

  const proto =
    sanitizeProto(req.headers["x-forwarded-proto"]) || req.protocol || "http";
  const host =
    firstForwardedValue(req.headers["x-forwarded-host"]) || req.get("host") || "";

  if (!host) return "";

  return normalizeAbsoluteHttpUrl(`${proto}://${host}`);
}

export function toPublicUrl(req, value, options = {}) {
  const { absolute = true } = options;
  const raw = value == null ? "" : String(value).trim();

  if (!raw) return raw;

  if (isAbsoluteHttpUrl(raw)) {
    return normalizeAbsoluteHttpUrl(raw) || raw;
  }

  if (!absolute) return raw;

  const baseUrl = getPublicBaseUrl(req);
  if (!baseUrl) return raw;

  try {
    return new URL(raw, `${baseUrl}/`).toString();
  } catch {
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const normalizedPath = raw.replace(/^\/+/, "");
    return `${normalizedBase}/${normalizedPath}`;
  }
}
