// services/config.service.js
import Config from "../models/configModel.js";
import { encryptToken, decryptToken } from "./secret.service.js";

const CACHE = new Map(); // key -> { val, till }
const TTL_MS = 30 * 1000; // 30s

// Những key luôn được lưu dạng secret (bắt buộc mã hoá)
const SECRET_KEYS = new Set([
  "FB_APP_SECRET",
  "FB_BOOT_LONG_USER_TOKEN", // hỗ trợ nhiều token: CSV
  "GOOGLE_CLIENT_SECRET",
  "YOUTUBE_API_KEY", // nếu dùng API key
  "YOUTUBE_REFRESH_TOKEN", // refresh token YouTube
]);

// Những key CHỈ được set qua ENV (không cho sửa qua API/DB)
const ENV_ONLY_KEYS = new Set([
  "LIVE_ENCRYPTION",
  "LIVE_SECRET_KEY_BASE64",
  "LIVE_SECRET_KEY_BASE64_OLD",
]);

function now() {
  return Date.now();
}
function cacheSet(key, val) {
  CACHE.set(key, { val, till: now() + TTL_MS });
}
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.till < now()) {
    CACHE.delete(key);
    return null;
  }
  return hit.val;
}

function envOr(defKey, fallback) {
  const v = process.env[defKey];
  return v == null ? fallback : String(v);
}

// ───────────────────────────────────────────────────────────────────────────────
// READ

export async function getCfgRaw(key, def = "") {
  const c = cacheGet(key);
  if (c != null) return c;

  const doc = await Config.findOne({ key }).lean();
  let out;
  if (!doc) {
    // fallback ENV nếu chưa có trong DB
    out = envOr(key, def);
  } else {
    if (doc.isSecret) {
      const raw = doc.value || "";
      // Không cố decrypt khi rỗng để tránh throw
      out = raw ? decryptToken(raw) : "";
    } else {
      out = String(doc.value || "");
    }
  }
  cacheSet(key, out);
  return out;
}

export async function getCfgStr(key, def = "") {
  const v = await getCfgRaw(key, def);
  return String(v ?? "");
}

export async function getCfgBool(key, def = false) {
  const v = (await getCfgRaw(key, def ? "1" : "0")).toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function getCfgInt(key, def = 0) {
  const v = await getCfgRaw(key, String(def));
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export async function getCfgJSON(key, def = null) {
  const v = await getCfgRaw(key, def == null ? "" : JSON.stringify(def));
  if (!v) return def;
  try {
    return JSON.parse(v);
  } catch {
    return def;
  }
}

// invalidate 1 key trong cache
export function invalidateCfg(key) {
  CACHE.delete(key);
}

// (tuỳ chọn) invalidate toàn bộ cache
export function invalidateAllCfg() {
  CACHE.clear();
}

// ───────────────────────────────────────────────────────────────────────────────
// WRITE

// validate & normalize theo key (chỉ các ràng buộc format/ENV-only)
function validateKeyValue(key, val) {
  if (ENV_ONLY_KEYS.has(key)) {
    throw new Error(`${key} chỉ đổi qua ENV và cần restart server.`);
  }
  if (key === "GRAPH_VER") {
    if (!/^v\d+\.\d+$/.test(val)) {
      throw new Error("GRAPH_VER phải dạng vNN.N (vd: v24.0)");
    }
  }
  if (key === "LIVE_BUSY_WINDOW_MS") {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("LIVE_BUSY_WINDOW_MS phải là số nguyên >= 0");
    }
  }
  if (key === "FB_BOOT_LONG_USER_TOKEN") {
    // Cho phép CSV rỗng để thực hiện clear toàn bộ token (không throw)
    // Nếu cần ràng buộc cụ thể hơn, có thể thêm validate từng token ở đây.
    // Ví dụ: chỉ trim và giữ nguyên.
    val = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(",");
  }
  return val;
}

/**
 * Upsert 1 key.
 * Chuẩn hoá:
 *  - Nếu value === ""  → isSecret=false (không mã hoá)
 *  - Nếu có value và (isSecret || SECRET_KEYS.has(key)) → mã hoá & isSecret=true
 */
export async function setCfg({ key, value, isSecret = false, updatedBy = "" }) {
  if (!key) throw new Error("key is required");

  let normalized = String(value ?? "");
  normalized = validateKeyValue(key, normalized);

  // Quyết định cờ secret theo invariant
  let secretFlag = SECRET_KEYS.has(key) || !!isSecret;

  // Rỗng => không còn bí mật
  if (!normalized) {
    secretFlag = false;
  }

  // Mã hoá nếu có giá trị và là secret
  const toStore = secretFlag ? encryptToken(normalized) : normalized;

  const doc = await Config.findOneAndUpdate(
    { key },
    { $set: { key, value: toStore, isSecret: secretFlag, updatedBy } },
    { upsert: true, new: true }
  );

  invalidateCfg(key);
  return { key: doc.key, isSecret: doc.isSecret, updatedAt: doc.updatedAt };
}

// List tất cả (mask secret)
export async function listCfg() {
  const docs = await Config.find({}).sort({ key: 1 }).lean();
  return docs.map((d) => ({
    key: d.key,
    value: d.isSecret ? "••••••" : d.value ?? "",
    isSecret: d.isSecret,
    updatedBy: d.updatedBy,
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
  }));
}

export async function deleteCfg(key) {
  const r = await Config.deleteOne({ key });
  invalidateCfg(key);
  return { deleted: r?.deletedCount ?? 0 };
}