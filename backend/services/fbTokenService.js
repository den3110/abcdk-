import FbToken from "../models/fbTokenModel.js";
import { getAllPages, getPageViaFields, debugToken } from "./facebookApi.js";
import dotenv from "dotenv";
dotenv.config();

const THRESH_HOURS = Number(process.env.REFRESH_THRESHOLD_HOURS || "72");
const THRESH_MS = THRESH_HOURS * 3600 * 1000;

const now = () => new Date();
const isNearExpiry = (d) => (d ? d.getTime() - Date.now() <= THRESH_MS : false);

/**
 * Bootstrap lần đầu:
 * - Nếu DB trống, dùng FB_BOOT_LONG_USER_TOKEN để lấy toàn bộ Page & seed.
 * - Nếu DB có rồi → bỏ qua.
 */
export async function bootstrapFromEnvIfNeeded() {
  const count = await FbToken.countDocuments({});
  if (count > 0) return false;

  const longUserToken = process.env.FB_BOOT_LONG_USER_TOKEN;
  if (!longUserToken) {
    console.error("[FB] Bootstrap skipped: FB_BOOT_LONG_USER_TOKEN missing");
    return false;
  }

  // Check long token
  let longDbg;
  try {
    longDbg = await debugToken(longUserToken);
    if (!longDbg.isValid) {
      console.error("[FB] Bootstrap failed: LONG user token invalid");
      return false;
    }
  } catch (e) {
    console.error("[FB] Bootstrap failed: debug long token error:", e.message);
    return false;
  }

  // Lấy danh sách page
  let pages = [];
  try {
    pages = await getAllPages(longUserToken);
  } catch (e) {
    console.error("[FB] Bootstrap: getAllPages error:", e.message);
    return false;
  }

  // Seed từng page
  for (const p of pages) {
    try {
      // Nếu /me/accounts đã có access_token thì dùng luôn, nếu không thì gọi /{page}?fields=...
      const pageObj = p?.access_token ? p : await getPageViaFields(longUserToken, p.id);
      if (!pageObj?.access_token) {
        await FbToken.updateOne(
          { pageId: p.id },
          {
            pageId: p.id,
            pageName: pageObj?.name || p.name,
            category: pageObj?.category || p.category || null,
            tasks: pageObj?.tasks || p.tasks || [],
            longUserToken,
            longUserExpiresAt: longDbg.expiresAt || null,
            longUserScopes: longDbg.scopes || [],
            pageToken: null,
            pageTokenIsNever: false,
            pageTokenExpiresAt: null,
            needsReauth: true,
            lastCheckedAt: now(),
            lastError: "No page access_token (missing permissions?)"
          },
          { upsert: true }
        );
        console.warn(`[FB] Bootstrap: page ${p.id} has no access_token (check permissions/roles).`);
        continue;
      }

      const pageDbg = await debugToken(pageObj.access_token);
      await FbToken.updateOne(
        { pageId: p.id },
        {
          pageId: p.id,
          pageName: pageObj.name || p.name,
          category: pageObj.category || p.category || null,
          tasks: pageObj.tasks || p.tasks || [],

          longUserToken,
          longUserExpiresAt: longDbg.expiresAt || null,
          longUserScopes: longDbg.scopes || [],

          pageToken: pageObj.access_token,
          pageTokenIsNever: !pageDbg.expiresAt,
          pageTokenExpiresAt: pageDbg.expiresAt || null,

          needsReauth: false,
          lastCheckedAt: now(),
          lastError: ""
        },
        { upsert: true }
      );

      console.log(`[FB] Bootstrap OK: ${p.id} (${pageObj.name || p.name})`);
    } catch (e) {
      console.error(`[FB] Bootstrap failed for page ${p.id}:`, e.message);
    }
  }

  return true;
}

/**
 * Đảm bảo PAGE token hợp lệ cho 1 page (tự lấy mới nếu gần hết hạn).
 */
export async function ensureValidPageToken(pageId) {
  const doc = await FbToken.findOne({ pageId });
  if (!doc) throw new Error(`No record for pageId=${pageId}`);

  // "never" → OK
  if (doc.pageToken && doc.pageTokenIsNever) return true;
  // còn hạn xa → OK
  if (doc.pageToken && doc.pageTokenExpiresAt && !isNearExpiry(doc.pageTokenExpiresAt)) return true;

  // Cần refresh: dựa vào long user token
  if (!doc.longUserToken) {
    await FbToken.updateOne({ _id: doc._id }, {
      needsReauth: true, lastCheckedAt: now(), lastError: "Missing longUserToken"
    });
    throw new Error(`Missing longUserToken for ${pageId}`);
  }

  // long user token còn hợp lệ?
  const longDbg = await debugToken(doc.longUserToken).catch(() => ({ isValid: false }));
  if (!longDbg.isValid || isNearExpiry(longDbg.expiresAt)) {
    await FbToken.updateOne({ _id: doc._id }, {
      needsReauth: true, lastCheckedAt: now(), lastError: "Long user token invalid/near-expiry"
    });
    throw new Error(`Long user token invalid/near-expiry for ${pageId}`);
  }

  // Lấy lại page token
  const pageObj = await getPageViaFields(doc.longUserToken, pageId);
  if (!pageObj?.access_token) {
    await FbToken.updateOne({ _id: doc._id }, {
      needsReauth: true, lastCheckedAt: now(), lastError: "Cannot fetch page access_token"
    });
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
      lastError: ""
    }
  );
  return true;
}

/**
 * Quét toàn bộ page để đảm bảo token luôn ổn.
 */
export async function sweepRefreshAll() {
  const docs = await FbToken.find({});
  for (const d of docs) {
    try {
      await ensureValidPageToken(d.pageId);
      // console.log(`[FB] Valid/refreshed: ${d.pageId}`);
    } catch (e) {
      console.warn(`[FB] Needs reauth: ${d.pageId} — ${e.message}`);
    }
  }
}

// Trả về PAGE access token hợp lệ (auto refresh nếu gần hết hạn)
export async function getValidPageToken(pageId) {
  // đảm bảo token đã được làm mới nếu cần
  await ensureValidPageToken(pageId);

  // đọc token mới nhất từ DB
  const doc = await FbToken.findOne({ pageId });
  if (!doc || !doc.pageToken) {
    throw new Error(
      `No valid page token for pageId=${pageId}. needsReauth=${doc?.needsReauth ?? "unknown"}`
    );
  }
  return doc.pageToken;
}
