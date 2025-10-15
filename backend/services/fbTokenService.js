// services/fbTokenService.js
import FbToken from "../models/fbTokenModel.js";
import { getAllPages, getPageViaFields, debugToken } from "./facebookApi.js";
import dotenv from "dotenv";
dotenv.config();

const THRESH_HOURS = Number(process.env.REFRESH_THRESHOLD_HOURS || "72");
const THRESH_MS = THRESH_HOURS * 3600 * 1000;

const VERBOSE = String(process.env.FB_VERBOSE || "0") === "1";
const now = () => new Date();
const isNearExpiry = (d) => (d ? d.getTime() - Date.now() <= THRESH_MS : false);

const log = {
  info: (...a) => console.log("[FB]", ...a),
  warn: (...a) => console.warn("[FB]", ...a),
  error: (...a) => console.error("[FB]", ...a),
  v: (...a) => VERBOSE && console.log("[FB][v]", ...a),
};

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
async function upsertFromLong(page, longUserToken, longDbg) {
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

  const pageDbg = await debugToken(pageObj.access_token);
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
 * Bootstrap hoặc SYNC từ FB_BOOT_LONG_USER_TOKEN:
 * - DB trống → bootstrap toàn bộ.
 * - DB đã có → luôn SYNC để bắt Page mới/cập nhật Page cũ (idempotent).
 */
export async function bootstrapFromEnvIfNeeded() {
  const t0 = Date.now();
  const count = await FbToken.countDocuments({});
  const longUserToken = process.env.FB_BOOT_LONG_USER_TOKEN;

  // Nếu DB trống mà lại thiếu long token → không làm gì được
  if (count === 0 && !longUserToken) {
    log.error("Bootstrap failed: FB_BOOT_LONG_USER_TOKEN missing (DB empty).");
    return false;
  }

  // Nếu có long token → validate
  let longDbg = null;
  if (longUserToken) {
    try {
      longDbg = await debugToken(longUserToken);
      if (!longDbg.isValid) {
        log.error("Bootstrap/Sync failed: LONG user token invalid.");
        return false;
      }
    } catch (e) {
      log.error("Bootstrap/Sync failed: debug long token error:", e.message);
      return false;
    }
  } else {
    // DB có dữ liệu nhưng không có long token → chỉ skip (không SYNC được)
    log.v("Sync skip: no FB_BOOT_LONG_USER_TOKEN and existing docs > 0.");
    return false;
  }

  // Lấy danh sách page từ long token
  let pages = [];
  try {
    pages = await getAllPages(longUserToken);
    log.info(
      `[FB] ${count === 0 ? "Bootstrap" : "Sync"}: found ${
        pages.length
      } pages from LONG token`
    );
  } catch (e) {
    log.error(
      `${count === 0 ? "Bootstrap" : "Sync"}: getAllPages error:`,
      e.message
    );
    return false;
  }

  // Upsert toàn bộ
  let created = 0,
    updated = 0,
    fail = 0;
  for (const p of pages) {
    try {
      const exists = await FbToken.findOne({ pageId: p.id }).lean();
      const r = await upsertFromLong(p, longUserToken, longDbg);
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
 * - Nếu chưa có record → auto-provision từ LONG user token (nếu có).
 * - Nếu cần, tự refresh token dựa trên LONG user token.
 */
export async function ensureValidPageToken(pageId) {
  VERBOSE && log.v(`ensureValidPageToken(pageId=${pageId})`);
  let doc = await FbToken.findOne({ pageId });

  // Auto-provision nếu chưa có record
  if (!doc) {
    const longUserToken = process.env.FB_BOOT_LONG_USER_TOKEN;
    if (!longUserToken) {
      throw new Error(
        `No record for pageId=${pageId} and no LONG token to provision`
      );
    }

    const longDbg = await debugToken(longUserToken).catch(() => ({
      isValid: false,
    }));
    if (!longDbg.isValid)
      throw new Error(`Cannot provision ${pageId}: LONG user token invalid`);

    const pageObj = await getPageViaFields(longUserToken, pageId);
    if (!pageObj)
      throw new Error(
        `Cannot provision ${pageId}: not accessible by LONG user token`
      );

    const base = {
      pageId,
      pageName: pageObj.name || null,
      category: pageObj.category || null,
      tasks: pageObj.tasks || [],
      longUserToken,
      longUserExpiresAt: longDbg.expiresAt || null,
      longUserScopes: longDbg.scopes || [],
      lastCheckedAt: now(),
    };

    if (!pageObj.access_token) {
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
      const pageDbg = await debugToken(pageObj.access_token);
      await FbToken.updateOne(
        { pageId },
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
    !isNearExpiry(doc.pageTokenExpiresAt)
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

  // LONG user token hợp lệ?
  const longDbg = await debugToken(doc.longUserToken).catch(() => ({
    isValid: false,
  }));
  if (!longDbg.isValid || isNearExpiry(longDbg.expiresAt)) {
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

  // Lấy lại page token
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

  const pageDbg = await debugToken(pageObj.access_token);
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
/**
 * Quét toàn bộ page để đảm bảo token luôn ổn.
 */
export async function sweepRefreshAll() {
  const t0 = Date.now();
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
// Trả về PAGE access token hợp lệ (auto refresh nếu gần hết hạn)
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
