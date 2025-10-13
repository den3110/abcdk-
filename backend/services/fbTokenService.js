import FbToken from "../models/FbToken.js";
import {
  debugToken,
  exchangeShortToLong,
  getPageTokenFromLongUserToken,
} from "./facebookApi.js";
import dotenv from "dotenv";
dotenv.config();

const { REFRESH_THRESHOLD_HOURS = "72" } = process.env;
const THRESH_MS = Number(REFRESH_THRESHOLD_HOURS) * 3600 * 1000;

const now = () => new Date();
const isNearExpiry = (d) => (d ? d.getTime() - Date.now() <= THRESH_MS : false);

/** Seed/reconnect: SHORT → LONG → PAGE token → lưu DB */
export async function connectOrRefreshFromShort({ pageId, shortUserToken }) {
  const ex = await exchangeShortToLong(shortUserToken);
  const longUserToken = ex.access_token;

  const longDbg = await debugToken(longUserToken);
  const item = await getPageTokenFromLongUserToken(longUserToken, pageId);
  const pageDbg = await debugToken(item.access_token);

  const upsert = {
    pageId,
    pageName: item.name,
    tasks: item.tasks || [],
    category: item.category || null,

    longUserToken,
    longUserExpiresAt: longDbg.expiresAt || null,
    longUserScopes: longDbg.scopes || [],

    pageToken: item.access_token,
    pageTokenIsNever: !pageDbg.expiresAt,
    pageTokenExpiresAt: pageDbg.expiresAt || null,

    needsReauth: false,
    lastCheckedAt: now(),
    lastError: "",
  };
  await FbToken.updateOne({ pageId }, upsert, { upsert: true });
  return upsert;
}

/** Cron dùng: đảm bảo PAGE token luôn hợp lệ / làm mới nếu gần hết hạn */
export async function ensureValidPageToken(pageId) {
  const doc = await FbToken.findOne({ pageId });
  if (!doc) throw new Error(`No record for pageId=${pageId}. Seed trước đã.`);

  if (doc.pageToken && doc.pageTokenIsNever) return true;
  if (
    doc.pageToken &&
    doc.pageTokenExpiresAt &&
    !isNearExpiry(doc.pageTokenExpiresAt)
  )
    return true;

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

  const item = await getPageTokenFromLongUserToken(doc.longUserToken, pageId);
  const pageDbg = await debugToken(item.access_token);

  await FbToken.updateOne(
    { _id: doc._id },
    {
      pageToken: item.access_token,
      pageTokenIsNever: !pageDbg.expiresAt,
      pageTokenExpiresAt: pageDbg.expiresAt || null,
      pageName: item.name,
      tasks: item.tasks || [],
      category: item.category || null,
      needsReauth: false,
      lastCheckedAt: now(),
      lastError: "",
    }
  );
  return true;
}

/** Quét tất cả Page */
export async function sweepRefreshAll() {
  const docs = await FbToken.find({});
  for (const d of docs) {
    try {
      await ensureValidPageToken(d.pageId);
    } catch (_) {}
  }
}
