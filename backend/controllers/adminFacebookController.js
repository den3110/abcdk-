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

  // Ưu tiên appId/appSecret từ body, fallback ENV
  const appId = typeof appIdBody === "string" && appIdBody.trim();

  const appSecret = typeof appSecretBody === "string" && appSecretBody.trim();
  
  if (!appId || !appSecret) {
    return res.status(400).json({
      message:
        "Thiếu appId/appSecret. Truyền qua body hoặc cấu hình FACEBOOK_APP_ID / FACEBOOK_APP_SECRET.",
    });
  }

  try {
    // 1) Đổi short-lived → long-lived user token
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
        .status(502)
        .json({ message: "Facebook không trả về access_token hợp lệ" });
    }

    // 2) Debug token để lấy meta (expires_at, scopes, is_valid)
    let expiresAt = null;
    let scopes = [];
    let isValid = true;

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
      if (typeof d.expires_at === "number") {
        expiresAt = new Date(d.expires_at * 1000).toISOString();
      }
      if (Array.isArray(d.scopes)) scopes = d.scopes;
      if (typeof d.is_valid === "boolean") isValid = d.is_valid;
    } catch {
      // Không chặn flow nếu debug thất bại; fallback bằng expiresIn
    }

    if (!expiresAt && expiresIn) {
      expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    }

    return res.json({
      longToken,
      tokenType,
      expiresIn,
      expiresAt,
      scopes,
      isValid,
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
