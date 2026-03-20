import path from "path";
import { toPublicUrl } from "./publicUrl.js";

const ADMIN_HOST = "admin.pickletour.vn";
const ADMIN_PROXY_PATH = "/api/admin/assets/tournament-image";
const ALLOWED_ABSOLUTE_HOSTS = new Set(["pickletour.vn", "admin.pickletour.vn"]);

function firstForwardedValue(value) {
  if (Array.isArray(value)) return firstForwardedValue(value[0]);
  return String(value || "")
    .split(",")[0]
    .trim();
}

function normalizeHost(value) {
  return firstForwardedValue(value).toLowerCase();
}

function sanitizeProto(value) {
  const proto = firstForwardedValue(value).toLowerCase();
  return proto === "https" || proto === "http" ? proto : "";
}

export function getRequestHost(req) {
  return (
    normalizeHost(req?.headers?.["x-forwarded-host"]) ||
    normalizeHost(req?.get?.("host")) ||
    ""
  );
}

export function shouldProxyTournamentImageForAdmin(req) {
  return getRequestHost(req) === ADMIN_HOST;
}

export function normalizeTournamentImageUploadsPath(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  if (value.startsWith("/uploads/")) return value;
  if (value.startsWith("uploads/")) return `/${value}`;
  if (!/^https?:\/\//i.test(value)) return "";

  try {
    const parsed = new URL(value);
    if (!ALLOWED_ABSOLUTE_HOSTS.has(parsed.hostname.toLowerCase())) return "";
    return parsed.pathname.startsWith("/uploads/") ? parsed.pathname : "";
  } catch {
    return "";
  }
}

export function resolveTournamentImageDiskPath(raw) {
  const uploadsPath = normalizeTournamentImageUploadsPath(raw);
  if (!uploadsPath) return null;

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(process.cwd(), uploadsPath.replace(/^\/+/, ""));
  const relative = path.relative(uploadsRoot, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  return { uploadsPath, filePath };
}

export function buildAdminTournamentImageProxyUrl(req, raw) {
  const value = String(raw || "").trim();
  if (!value) return value;
  if (!shouldProxyTournamentImageForAdmin(req)) return value;

  const proxyPath = `${ADMIN_PROXY_PATH}?src=${encodeURIComponent(
    value
  )}`;
  const proto =
    sanitizeProto(req?.headers?.["x-forwarded-proto"]) || req?.protocol || "";
  const host = getRequestHost(req);

  if (!proto || !host) return proxyPath;

  try {
    return new URL(proxyPath, `${proto}://${host}/`).toString();
  } catch {
    return toPublicUrl(req, proxyPath);
  }
}

export function unwrapAdminTournamentImageProxySource(raw) {
  const value = String(raw || "").trim();
  if (!value) return value;

  try {
    const parsed = /^https?:\/\//i.test(value)
      ? new URL(value)
      : new URL(value, "http://admin.pickletour.vn");

    if (parsed.pathname !== ADMIN_PROXY_PATH) return value;

    const src = parsed.searchParams.get("src");
    return String(src || "").trim() || value;
  } catch {
    return value;
  }
}
