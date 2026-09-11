// controllers/adminFacebookController.js
import expressAsyncHandler from "express-async-handler";
import axios from "axios";
import { getCfgStr } from "../services/config.service.js";

export const exchangeLongUserToken = expressAsyncHandler(async (req, res) => {
  const graphVer = await getCfgStr("GRAPH_VER", "v24.0");
  const GRAPH = "https://graph.facebook.com/" + graphVer;

  const {
    shortToken,
    appId: appIdBody,
    appSecret: appSecretBody,
  } = req.body || {};

  if (!shortToken || typeof shortToken !== "string" || !shortToken.trim()) {
    return res.status(400).json({ message: "shortToken is required" });
  }

  const appId = typeof appIdBody === "string" && appIdBody.trim();
  const appSecret = typeof appSecretBody === "string" && appSecretBody.trim();

  if (!appId || !appSecret) {
    return res.status(400).json({
      message:
        "Thiếu appId/appSecret. Truyền qua body hoặc cấu hình FACEBOOK_APP_ID / FACEBOOK_APP_SECRET.",
    });
  }

  try {
    // 1) đổi short → long
    const { data: tokenRes } = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken.trim(),
      },
      timeout: 15000,
    });

    const longToken = tokenRes?.access_token;
    const tokenType = tokenRes?.token_type || "bearer";
    const expiresIn = Number(tokenRes?.expires_in) || null;

    if (!longToken) {
      return res
        .status(400)
        .json({ message: "Facebook không trả về access_token hợp lệ" });
    }

    // 2) debug để lấy meta
    let expiresAt = null;
    let scopes = [];
    let isValid = true;
    let isNever = false;

    try {
      const appAccessToken = `${appId}|${appSecret}`;
      const { data: dbg } = await axios.get(`${GRAPH}/debug_token`, {
        params: {
          input_token: longToken,
          access_token: appAccessToken,
        },
        timeout: 10000,
      });

      const d = dbg?.data || {};

      const exp = typeof d.expires_at === "number" ? d.expires_at : null;
      const dataExp =
        typeof d.data_access_expires_at === "number"
          ? d.data_access_expires_at
          : null;

      // ✅ chỉ nhận expires_at nếu > 0
      if (exp && exp > 0) {
        expiresAt = new Date(exp * 1000).toISOString();
      } else if (dataExp && dataExp > 0) {
        // nhiều token user giờ chỉ set data_access_expires_at
        expiresAt = new Date(dataExp * 1000).toISOString();
      } else {
        // exp = 0 → có thể là "never"
        isNever = true;
      }

      if (Array.isArray(d.scopes)) scopes = d.scopes;
      if (typeof d.is_valid === "boolean") isValid = d.is_valid;
    } catch (e) {
      // bỏ qua
    }

    // ✅ fallback bằng expires_in nếu trên không ra gì
    if (!expiresAt && expiresIn) {
      expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    }

    return res.json({
      longToken,
      tokenType,
      expiresIn,
      expiresAt, // sẽ KHÔNG còn 1970 nữa
      scopes,
      isValid,
      isNever,
    });
  } catch (err) {
    const status = err?.response?.status || 502;
    const fbErr = err?.response?.data?.error;
    return res.status(status).json({
      message: "Đổi token với Facebook thất bại",
      error: fbErr || err.message,
    });
  }
});

/* ============================================================================
 * Quản lý FB_BOOT_LONG_USER_TOKEN trực quan
 *  - inspectBootTokens: tách CSV thành từng token, debug + lấy chủ tài khoản + page
 *  - addBootToken: thêm nhanh 1 token (long, hoặc short→exchange) rồi resync
 *  - deleteBootToken: xoá 1 token theo fingerprint rồi resync
 * Không bao giờ trả token đầy đủ về client — chỉ preview + fingerprint (sha256).
 * ==========================================================================*/
import crypto from "crypto";
import { setCfg } from "../services/config.service.js";
import {
  debugAnyToken,
  getMeFromToken,
  listPagesFromToken,
} from "../services/fbGraph.js";
import { scheduleFbResync } from "../services/fbTokenService.js";

const BOOT_KEY = "FB_BOOT_LONG_USER_TOKEN";

function splitBootTokens(csv) {
  return String(csv || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenFingerprint(tok) {
  return crypto.createHash("sha256").update(String(tok)).digest("hex").slice(0, 16);
}

function maskToken(tok) {
  const s = String(tok || "");
  if (s.length <= 14) return "••••••";
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function epochToIso(sec) {
  if (sec == null) return null;
  if (Number(sec) === 0) return null; // 0 = không hết hạn
  const d = new Date(Number(sec) * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Soi 1 token: debug (còn sống?/hạn/scope) + chủ tài khoản + danh sách page. */
async function inspectOneToken(tok, index) {
  const base = {
    index,
    fingerprint: tokenFingerprint(tok),
    preview: maskToken(tok),
  };
  try {
    const dbg = await debugAnyToken(tok);
    const valid = dbg?.is_valid === true;
    const result = {
      ...base,
      valid,
      type: dbg?.type || "",
      appId: dbg?.app_id || "",
      scopes: Array.isArray(dbg?.scopes) ? dbg.scopes : [],
      expiresAt: epochToIso(dbg?.expires_at),
      dataAccessExpiresAt: epochToIso(dbg?.data_access_expires_at),
      neverExpires: Number(dbg?.expires_at) === 0,
      message: valid ? "" : dbg?.message || "Token không hợp lệ / đã hết hạn",
      owner: null,
      pages: [],
      pageCount: 0,
      pagesError: "",
    };
    if (valid) {
      const [ownerRes, pagesRes] = await Promise.allSettled([
        getMeFromToken(tok),
        listPagesFromToken(tok),
      ]);
      if (ownerRes.status === "fulfilled") {
        result.owner = {
          id: ownerRes.value?.id || "",
          name: ownerRes.value?.name || "",
        };
      }
      if (pagesRes.status === "fulfilled") {
        result.pages = pagesRes.value.map((p) => ({ id: p.id, name: p.name }));
        result.pageCount = result.pages.length;
      } else {
        result.pagesError =
          pagesRes.reason?.response?.data?.error?.message ||
          pagesRes.reason?.message ||
          "Không lấy được danh sách page";
      }
    }
    return result;
  } catch (e) {
    return {
      ...base,
      valid: false,
      message: e?.message || "Lỗi kiểm tra token",
      owner: null,
      pages: [],
      pageCount: 0,
    };
  }
}

/** GET /admin/fb/boot-tokens — danh sách token đã tách + soi từng cái. */
export const inspectBootTokens = expressAsyncHandler(async (req, res) => {
  const csv = await getCfgStr(BOOT_KEY, "");
  const tokens = splitBootTokens(csv);
  const items = await Promise.all(tokens.map((t, i) => inspectOneToken(t, i)));
  const livePageIds = new Set();
  for (const it of items) {
    if (it.valid) for (const p of it.pages) livePageIds.add(p.id);
  }
  res.json({
    count: tokens.length,
    liveCount: items.filter((i) => i.valid).length,
    deadCount: items.filter((i) => !i.valid).length,
    uniquePageCount: livePageIds.size,
    items,
  });
});

/** Đổi short-lived → long-lived, fallback app creds từ Config FB_APP_ID/FB_APP_SECRET. */
async function exchangeShortToLong(shortToken, appIdIn, appSecretIn) {
  const graphVer = await getCfgStr("GRAPH_VER", "v24.0");
  const GRAPH = "https://graph.facebook.com/" + graphVer;
  const appId =
    (typeof appIdIn === "string" && appIdIn.trim()) ||
    (await getCfgStr("FB_APP_ID", "")) ||
    process.env.FB_APP_ID;
  const appSecret =
    (typeof appSecretIn === "string" && appSecretIn.trim()) ||
    (await getCfgStr("FB_APP_SECRET", "")) ||
    process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    const err = new Error(
      "Thiếu App ID / App Secret (cấu hình FB_APP_ID / FB_APP_SECRET hoặc truyền vào)."
    );
    err.status = 400;
    throw err;
  }
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: String(shortToken).trim(),
    },
    timeout: 15000,
  });
  const longToken = data?.access_token;
  if (!longToken) {
    const err = new Error("Facebook không trả về access_token khi đổi token.");
    err.status = 400;
    throw err;
  }
  return longToken;
}

/**
 * POST /admin/fb/boot-tokens
 * body: { token }  (đã là long-lived user token)
 *    hoặc { shortToken, appId?, appSecret? }  (tự đổi sang long-lived)
 * Kiểm tra token hợp lệ → chèn vào CSV (dedupe) → resync để đúc page token.
 */
export const addBootToken = expressAsyncHandler(async (req, res) => {
  const { token, shortToken, appId, appSecret } = req.body || {};

  let longToken = typeof token === "string" ? token.trim() : "";
  if (!longToken && typeof shortToken === "string" && shortToken.trim()) {
    longToken = await exchangeShortToLong(shortToken, appId, appSecret);
  }
  if (!longToken) {
    return res
      .status(400)
      .json({ message: "Cần 'token' (long-lived) hoặc 'shortToken' để đổi." });
  }

  // Chặn thêm token chết ngay từ đầu.
  const dbg = await debugAnyToken(longToken);
  if (dbg?.is_valid !== true) {
    return res.status(400).json({
      message: `Token không hợp lệ / đã hết hạn: ${dbg?.message || "unknown"}`,
    });
  }

  const csv = await getCfgStr(BOOT_KEY, "");
  const tokens = splitBootTokens(csv);
  const fp = tokenFingerprint(longToken);
  if (tokens.some((t) => tokenFingerprint(t) === fp)) {
    return res.status(409).json({ message: "Token này đã có trong danh sách." });
  }

  tokens.push(longToken);
  await setCfg({
    key: BOOT_KEY,
    value: tokens.join(","),
    isSecret: true,
    updatedBy: req.user?.email || "admin",
  });

  scheduleFbResync(500); // đúc lại page token cho các page của token mới

  const owner = await getMeFromToken(longToken).catch(() => null);
  const pages = await listPagesFromToken(longToken).catch(() => []);
  res.status(201).json({
    ok: true,
    fingerprint: fp,
    owner: owner ? { id: owner.id, name: owner.name } : null,
    pageCount: pages.length,
    pages: pages.map((p) => ({ id: p.id, name: p.name })),
    resync: "scheduled",
  });
});

/** DELETE /admin/fb/boot-tokens/:fingerprint — xoá 1 token khỏi CSV rồi resync. */
export const deleteBootToken = expressAsyncHandler(async (req, res) => {
  const fp = String(req.params.fingerprint || "").trim();
  if (!fp) return res.status(400).json({ message: "Thiếu fingerprint." });

  const csv = await getCfgStr(BOOT_KEY, "");
  const tokens = splitBootTokens(csv);
  const remaining = tokens.filter((t) => tokenFingerprint(t) !== fp);

  if (remaining.length === tokens.length) {
    return res.status(404).json({ message: "Không tìm thấy token." });
  }

  await setCfg({
    key: BOOT_KEY,
    value: remaining.join(","),
    isSecret: true,
    updatedBy: req.user?.email || "admin",
  });

  scheduleFbResync(500);
  res.json({ ok: true, removed: fp, remaining: remaining.length, resync: "scheduled" });
});
