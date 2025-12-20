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
