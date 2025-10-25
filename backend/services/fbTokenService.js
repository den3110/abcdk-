// services/fbTokenService.js
import FbToken from "../models/fbTokenModel.js";
import { getAllPages, getPageViaFields, debugToken } from "./facebookApi.js";
import { getCfgStr, getCfgInt } from "./config.service.js";

// ───────────────────────────────────────────────────────────────────────────────
// Runtime flags & logging
const VERBOSE_ENV = String(process.env.FB_VERBOSE || "0") === "1";
const log = {
  info: (...a) => console.log("[FB]", ...a),
  warn: (...a) => console.warn("[FB]", ...a),
  error: (...a) => console.error("[FB]", ...a),
  v: (...a) => VERBOSE_ENV && console.log("[FB][v]", ...a),
};

const now = () => new Date();

// ───────────────────────────────────────────────────────────────────────────────
// Config helpers

/** Tách list bằng dấu phẩy hoặc xuống dòng */
function parseCsvMulti(s) {
  return String(s || "")
    .split(/[,\r\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Đọc danh sách long user tokens (ngăn cách phẩy/line) */
async function getLongUserTokensFromConfig() {
  const csv = await getCfgStr("FB_BOOT_LONG_USER_TOKEN", "");
  return parseCsvMulti(csv);
}

/** Đọc pool token + appId + appSecret và ghép theo index */
async function getBootPairsFromConfig() {
  const tokens = parseCsvMulti(await getCfgStr("FB_BOOT_LONG_USER_TOKEN", ""));
  const appIds = parseCsvMulti(await getCfgStr("FB_APP_ID", ""));
  const appSecrets = parseCsvMulti(await getCfgStr("FB_APP_SECRET", ""));
  const pairs = [];

  if (tokens.length === 0) return pairs;

  const oneGlobal = appIds.length === 1 && appSecrets.length === 1;
  const equalLen =
    tokens.length === appIds.length && appIds.length === appSecrets.length;

  if (equalLen) {
    for (let i = 0; i < tokens.length; i++) {
      pairs.push({
        token: tokens[i],
        appId: appIds[i],
        appSecret: appSecrets[i],
      });
    }
  } else if (oneGlobal) {
    for (const t of tokens)
      pairs.push({ token: t, appId: appIds[0], appSecret: appSecrets[0] });
  } else if (appIds.length === 0 && appSecrets.length === 0) {
    // Không cấu hình app list → để null, debugToken sẽ tự fallback sang env (nếu có)
    for (const t of tokens)
      pairs.push({ token: t, appId: null, appSecret: null });
  } else {
    const n = Math.min(tokens.length, appIds.length, appSecrets.length);
    log.warn(
      `[FB] Config length mismatch: tokens=${tokens.length}, appIds=${appIds.length}, appSecrets=${appSecrets.length} → using first ${n} pairs`
    );
    for (let i = 0; i < n; i++) {
      pairs.push({
        token: tokens[i],
        appId: appIds[i],
        appSecret: appSecrets[i],
      });
    }
  }
  return pairs;
}

/** Xoá FbToken theo pool token trong config.
 *  - tokens rỗng  → xoá toàn bộ FbToken (reset sạch)
 *  - tokens có giá trị → xoá doc có longUserToken ∉ tokens, hoặc null/""/không có field
 */
async function pruneFbTokensByConfig(tokens) {
  const allow = Array.isArray(tokens)
    ? tokens.map((s) => s.trim()).filter(Boolean)
    : [];

  // Breakdown hiện trạng
  const breakdown = await FbToken.aggregate([
    { $group: { _id: "$longUserToken", cnt: { $sum: 1 } } },
    { $sort: { cnt: -1 } },
  ]);
  const total = breakdown.reduce((a, b) => a + b.cnt, 0);
  log.info(`[FB] prune: total docs=${total}, tokens in config=${allow.length}`);
  breakdown.forEach((row) => {
    const k = row._id ?? "(null)";
    const mark =
      allow.length === 0
        ? "🗑️ delete(all)"
        : allow.includes(k)
        ? "✅ keep"
        : "🗑️ delete";
    log.v(` - ${mark} longUserToken=${k} -> ${row.cnt} docs`);
  });

  let query;
  if (allow.length === 0) {
    log.warn("[FB] prune: tokens config is EMPTY → deleting ALL FbToken docs");
    query = {}; // delete all documents
  } else {
    query = {
      $or: [
        { longUserToken: { $exists: false } },
        { longUserToken: null },
        { longUserToken: "" },
        { longUserToken: { $nin: allow } },
      ],
    };
  }

  const res = await FbToken.deleteMany(query);
  const deleted = res?.deletedCount ?? res?.result?.n ?? 0;
  if (deleted > 0) log.warn(`[FB] Pruned ${deleted} FbToken docs`);
  else log.v(`[FB] prune: nothing to delete]`);
  return { deleted, total };
}

/** Đọc REFRESH_THRESHOLD_HOURS từ DB → ms (mặc định 72h) */
async function getThresholdMs() {
  const hours = await getCfgInt("REFRESH_THRESHOLD_HOURS", 72);
  return Number(hours || 72) * 3600 * 1000;
}

/** Kiểm tra hạn token với ngưỡng lấy từ DB; nhận Date | string */
async function isNearExpiryAsync(d) {
  if (!d) return false;
  const ms = await getThresholdMs();
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return t - Date.now() <= ms;
}

/** Tìm appId/appSecret ứng với một long token (dựa trên config zip) */
async function findCredsForLongToken(longToken) {
  const pairs = await getBootPairsFromConfig();
  const hit = pairs.find((p) => p.token === longToken);
  if (hit) return { appId: hit.appId, appSecret: hit.appSecret };

  // fallback: nếu toàn bộ pairs dùng chung 1 bộ creds
  const creds = Array.from(
    new Set(
      pairs.map((p) =>
        p.appId && p.appSecret ? `${p.appId}|${p.appSecret}` : ""
      )
    )
  ).filter(Boolean);
  if (creds.length === 1) {
    const [appId, appSecret] = creds[0].split("|");
    return { appId, appSecret };
  }
  return { appId: null, appSecret: null }; // để debugToken tự fallback env nếu có
}

// ───────────────────────────────────────────────────────────────────────────────
// Internal helpers

async function upsertFromLong(page, longUserToken, longDbg, appId, appSecret) {
  const p = page;
  const pageObj = p?.access_token
    ? p
    : await getPageViaFields(longUserToken, p.id);

  const base = {
    pageId: p.id,
    pageName: pageObj?.name || p.name,
    category: pageObj?.category || p.category || null,
    tasks: pageObj?.tasks || p.tasks || [],
    longUserToken,
    longUserExpiresAt: longDbg?.expiresAt || null,
    longUserScopes: longDbg?.scopes || [],
    lastCheckedAt: now(),
  };

  if (!pageObj?.access_token) {
    await FbToken.updateOne(
      { pageId: p.id },
      {
        ...base,
        pageToken: null,
        pageTokenIsNever: false,
        pageTokenExpiresAt: null,
        needsReauth: true,
        lastError: "No page access_token (missing permissions?)",
      },
      { upsert: true }
    );
    log.warn(
      `Sync: page ${p.id} has no access_token (check permissions/roles).`
    );
    return { createdOrUpdated: true, tokenOk: false };
  }

  // Debug page token bằng đúng app của long token
  const pageDbg = await debugToken(pageObj.access_token, appId, appSecret);
  await FbToken.updateOne(
    { pageId: p.id },
    {
      ...base,
      pageToken: pageObj.access_token,
      pageTokenIsNever: !pageDbg.expiresAt,
      pageTokenExpiresAt: pageDbg.expiresAt || null,
      needsReauth: false,
      lastError: "",
    },
    { upsert: true }
  );
  log.info(`Sync OK: ${p.id} (${pageObj.name || p.name})`);
  return { createdOrUpdated: true, tokenOk: true };
}

// ───────────────────────────────────────────────────────────────────────────────
/**
 * Bootstrap/SYNC từ FB_BOOT_LONG_USER_TOKEN (đọc DB):
 * - DB trống → bootstrap toàn bộ.
 * - DB đã có → luôn SYNC để bắt Page mới/cập nhật Page cũ (idempotent).
 */
export async function bootstrapFromEnvIfNeeded() {
  const t0 = Date.now();
  const count = await FbToken.countDocuments({});

  const pairs = await getBootPairsFromConfig(); // [{ token, appId, appSecret }]
  const tokens = pairs.map((p) => p.token);
  // console.log("token", tokens)
  // Nếu DB trống mà lại thiếu long token → không làm gì được
  if (count === 0 && tokens.length === 0) {
    log.error(
      "Bootstrap failed: FB_BOOT_LONG_USER_TOKEN missing in DB (DB empty)."
    );
    return false;
  }

  // 🔥 Prune các bản ghi thuộc token không còn trong cấu hình
  const { deleted: prunedAtBootstrap } = await pruneFbTokensByConfig(tokens);
  log.info(`[FB] prune@bootstrap: deleted=${prunedAtBootstrap}`);

  // Validate tất cả tokens, giữ lại token hợp lệ (dùng đúng app theo cặp)
  const valid = [];
  for (const { token: tok, appId, appSecret } of pairs) {
    try {
      const dbg = await debugToken(tok, appId, appSecret);
      if (dbg.isValid) valid.push({ tok, dbg, appId, appSecret });
      else log.warn("Bootstrap/Sync: LONG user token invalid (skipped).");
    } catch (e) {
      log.warn("Bootstrap/Sync: debug long token error (skipped):", e.message);
    }
  }
  if (valid.length === 0) {
    log.error("Bootstrap/Sync failed: no valid LONG user tokens in DB.");
    return false;
  }
  // Lấy danh sách page từ tất cả tokens (dedupe theo pageId, ưu tiên token xuất hiện trước)
  const byPageId = new Map(); // pageId -> { p, tok, dbg, appId, appSecret }

  for (const v of valid) {
    try {
      const arr = await getAllPages(v.tok);
      log.info(
        `[FB] ${count === 0 ? "Bootstrap" : "Sync"}: token ok → ${
          arr.length
        } pages`
      );
      for (const p of arr) {
        if (!byPageId.has(p.id)) byPageId.set(p.id, { p, ...v });
      }
    } catch (e) {
      log.warn(`[FB] getAllPages error for one token: ${e.message}`);
    }
  }
  const pages = Array.from(byPageId.values());
  log.info(
    `[FB] ${count === 0 ? "Bootstrap" : "Sync"}: total unique pages=${
      pages.length
    }`
  );
  if (pages.length === 0) return false;

  // Upsert toàn bộ
  let created = 0,
    updated = 0,
    fail = 0;
  for (const { p, tok, dbg, appId, appSecret } of pages) {
    try {
      const exists = await FbToken.findOne({ pageId: p.id }).lean();
      const r = await upsertFromLong(p, tok, dbg, appId, appSecret);
      if (exists) updated += r.createdOrUpdated ? 1 : 0;
      else created += r.createdOrUpdated ? 1 : 0;
    } catch (e) {
      fail++;
      log.warn(`Sync failed for page ${p.id}: ${e.message}`);
    }
  }

  log.info(
    `[FB] ${
      count === 0 ? "Bootstrap" : "Sync"
    } done: created=${created}, updated=${updated}, failed=${fail}, took=${
      Date.now() - t0
    }ms`
  );
  return created > 0 || updated > 0;
}

// ───────────────────────────────────────────────────────────────────────────────
/**
 * Đảm bảo PAGE token hợp lệ cho 1 page.
 * - Nếu chưa có record → auto-provision từ pool LONG user tokens (DB).
 * - Nếu cần, tự refresh token dựa trên LONG user token.
 * - Nếu long token invalid/near-expiry → thử switch sang token khác có quyền.
 */
export async function ensureValidPageToken(pageId) {
  log.v(`ensureValidPageToken(pageId=${pageId})`);
  let doc = await FbToken.findOne({ pageId });

  const pairs = await getBootPairsFromConfig();
  const poolTokens = pairs.map((p) => p.token);

  // 🔥 Nếu record đang trỏ longUserToken không thuộc pool → xoá record
  if (
    doc &&
    poolTokens.length > 0 &&
    doc.longUserToken &&
    !poolTokens.includes(doc.longUserToken)
  ) {
    await FbToken.deleteOne({ _id: doc._id });
    log.warn(
      `[FB] ensure: deleted record of pageId=${pageId} (longUserToken not in config pool)`
    );
    doc = null; // cho phép nhảy xuống nhánh auto-provision
  }

  // Auto-provision nếu chưa có record
  if (!doc) {
    if (pairs.length === 0) {
      throw new Error(
        `No record for pageId=${pageId} and no LONG tokens in DB`
      );
    }
    let picked = null;
    for (const { token: tok, appId, appSecret } of pairs) {
      const dbg = await debugToken(tok, appId, appSecret).catch(() => ({
        isValid: false,
      }));
      if (!dbg.isValid) continue;
      const pageObj = await getPageViaFields(tok, pageId).catch(() => null);
      if (pageObj) {
        picked = { tok, dbg, appId, appSecret, pageObj };
        break;
      }
    }
    if (!picked) {
      throw new Error(
        `Cannot provision ${pageId}: not accessible by any LONG token in DB`
      );
    }

    const base = {
      pageId,
      pageName: picked.pageObj.name || null,
      category: picked.pageObj.category || null,
      tasks: picked.pageObj.tasks || [],
      longUserToken: picked.tok,
      longUserExpiresAt: picked.dbg.expiresAt || null,
      longUserScopes: picked.dbg.scopes || [],
      lastCheckedAt: now(),
    };

    if (!picked.pageObj.access_token) {
      await FbToken.updateOne(
        { pageId },
        {
          ...base,
          pageToken: null,
          pageTokenIsNever: false,
          pageTokenExpiresAt: null,
          needsReauth: true,
          lastError: "No page access_token (missing permissions?)",
        },
        { upsert: true }
      );
      log.info(`[FB] ensure: provisioned record for ${pageId} (needs reauth)`);
      throw new Error(`Cannot fetch page access_token for ${pageId}`);
    } else {
      const pageDbg = await debugToken(
        picked.pageObj.access_token,
        picked.appId,
        picked.appSecret
      );
      await FbToken.updateOne(
        { pageId },
        {
          ...base,
          pageToken: picked.pageObj.access_token,
          pageTokenIsNever: !pageDbg.expiresAt,
          pageTokenExpiresAt: pageDbg.expiresAt || null,
          needsReauth: false,
          lastError: "",
        },
        { upsert: true }
      );
      log.info(`[FB] ensure: provisioned record for ${pageId} (token OK)`);
      doc = await FbToken.findOne({ pageId });
    }
  }

  // Token NEVER → OK
  if (doc.pageToken && doc.pageTokenIsNever) {
    log.v(`pageId=${pageId}: token NEVER expires → OK`);
    return true;
  }

  // Còn hạn xa → OK
  if (
    doc.pageToken &&
    doc.pageTokenExpiresAt &&
    !(await isNearExpiryAsync(doc.pageTokenExpiresAt))
  ) {
    log.v(`pageId=${pageId}: token far from expiry → OK`);
    return true;
  }

  // Cần refresh: dựa vào long user token
  if (!doc.longUserToken) {
    await FbToken.updateOne(
      { _id: doc._id },
      {
        needsReauth: true,
        lastCheckedAt: now(),
        lastError: "Missing longUserToken",
      }
    );
    throw new Error(`Missing longUserToken for ${pageId}`);
  }

  // LONG user token hợp lệ? nếu không → thử switch sang token khác có quyền
  const { appId: curAppId, appSecret: curAppSecret } =
    await findCredsForLongToken(doc.longUserToken);
  const longDbg = await debugToken(
    doc.longUserToken,
    curAppId,
    curAppSecret
  ).catch(() => ({
    isValid: false,
  }));
  if (!longDbg.isValid || (await isNearExpiryAsync(longDbg.expiresAt))) {
    let switched = null;
    for (const { token: tok, appId: a2, appSecret: s2 } of pairs) {
      if (tok === doc.longUserToken) continue;
      const dbg2 = await debugToken(tok, a2, s2).catch(() => ({
        isValid: false,
      }));
      if (!dbg2.isValid || (await isNearExpiryAsync(dbg2.expiresAt))) continue;
      const pageObj2 = await getPageViaFields(tok, pageId).catch(() => null);
      if (pageObj2) {
        switched = { tok, dbg2, appId: a2, appSecret: s2 };
        break;
      }
    }
    if (!switched) {
      await FbToken.updateOne(
        { _id: doc._id },
        {
          needsReauth: true,
          lastCheckedAt: now(),
          lastError: "Long user token invalid/near-expiry",
        }
      );
      throw new Error(`Long user token invalid/near-expiry for ${pageId}`);
    }
    // cập nhật doc dùng long token mới
    await FbToken.updateOne(
      { _id: doc._id },
      {
        longUserToken: switched.tok,
        longUserExpiresAt: switched.dbg2.expiresAt || null,
        longUserScopes: switched.dbg2.scopes || [],
        lastCheckedAt: now(),
        lastError: "",
      }
    );
    doc = await FbToken.findOne({ _id: doc._id });
  }

  // Lấy lại page token bằng longUserToken hiện tại (có thể đã switch)
  const pageObj = await getPageViaFields(doc.longUserToken, pageId);
  if (!pageObj?.access_token) {
    await FbToken.updateOne(
      { _id: doc._id },
      {
        needsReauth: true,
        lastCheckedAt: now(),
        lastError: "Cannot fetch page access_token",
      }
    );
    throw new Error(`Cannot fetch page access_token for ${pageId}`);
  }

  const { appId: a3, appSecret: s3 } = await findCredsForLongToken(
    doc.longUserToken
  );
  const pageDbg = await debugToken(pageObj.access_token, a3, s3);
  await FbToken.updateOne(
    { _id: doc._id },
    {
      pageToken: pageObj.access_token,
      pageTokenIsNever: !pageDbg.expiresAt,
      pageTokenExpiresAt: pageDbg.expiresAt || null,
      pageName: pageObj.name || doc.pageName,
      category: pageObj.category || doc.category,
      tasks: pageObj.tasks || doc.tasks || [],
      needsReauth: false,
      lastCheckedAt: now(),
      lastError: "",
    }
  );
  log.v(`pageId=${pageId}: token refreshed OK (never=${!pageDbg.expiresAt})`);
  return true;
}

// ───────────────────────────────────────────────────────────────────────────────
/** Quét toàn bộ page để đảm bảo token luôn ổn. */
export async function sweepRefreshAll() {
  const t0 = Date.now();
  // 🔥 Prune trước khi sweep để dọn rác theo config hiện tại
  const pairs = await getBootPairsFromConfig();
  const { deleted: prunedAtSweep } = await pruneFbTokensByConfig(
    pairs.map((p) => p.token)
  );
  log.info(`[FB] prune@sweep: deleted=${prunedAtSweep}`);
  const docs = await FbToken.find({});
  log.info(`[FB] Sweep: ${docs.length} pages`);
  let ok = 0,
    reauth = 0;
  for (const d of docs) {
    try {
      await ensureValidPageToken(d.pageId);
      log.v(`Valid/refreshed: ${d.pageId}`);
      ok++;
    } catch (e) {
      log.warn(`Needs reauth: ${d.pageId} — ${e.message}`);
      reauth++;
    }
  }
  log.info(
    `[FB] Sweep done: ok=${ok}, needsReauth=${reauth}, took=${
      Date.now() - t0
    }ms`
  );
  return { ok, reauth };
}

// ───────────────────────────────────────────────────────────────────────────────
/** Trả về PAGE access token hợp lệ (auto refresh nếu gần hết hạn) */
export async function getValidPageToken(pageId) {
  await ensureValidPageToken(pageId);
  const doc = await FbToken.findOne({ pageId });
  if (!doc || !doc.pageToken) {
    throw new Error(
      `No valid page token for pageId=${pageId}. needsReauth=${
        doc?.needsReauth ?? "unknown"
      }`
    );
  }
  return doc.pageToken;
}

// ───────────────────────────────────────────────────────────────────────────────
let _resyncTimer = null;

export async function resyncNow() {
  try {
    log.info("[FB] ResyncNow: start");
    const boot = await bootstrapFromEnvIfNeeded(); // prune + sync pages
    const sweep = await sweepRefreshAll(); // ensure tokens fresh
    log.info("[FB] ResyncNow: done");
    return { boot, sweep };
  } catch (e) {
    log.error("[FB] ResyncNow: failed", e.message);
    throw e;
  }
}

export function scheduleFbResync(delayMs = 800) {
  if (_resyncTimer) clearTimeout(_resyncTimer);
  _resyncTimer = setTimeout(async () => {
    _resyncTimer = null;
    try {
      await resyncNow();
    } catch (e) {
      // đã log ở resyncNow
    }
  }, delayMs);
  log.info(`[FB] Resync scheduled in ${delayMs}ms`);
}
