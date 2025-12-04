// controllers/facebookConnectController.js
import FacebookPageConnection from "../models/facebookPageConnectionModel.js";
import { getCfgStr } from "../services/config.service.js";

const FB_API = "https://graph.facebook.com/v24.0";

// xác định môi trường
const IS_DEV = process.env.NODE_ENV !== "production";

// helper: lấy redirect_uri cho Facebook OAuth
const getRedirectUri = () => {
  if (IS_DEV) {
    // ưu tiên env riêng cho dev, không có thì fallback localhost
    return (
      process.env.FB_REDIRECT_URI_DEV ||
      "http://localhost:5001/api/me/facebook/callback"
    );
  }
  // production
  return process.env.FB_REDIRECT_URI;
};

// helper: lấy FRONTEND_URL để redirect user sau khi connect xong
const getFrontendUrl = () => {
  if (IS_DEV) {
    return process.env.FRONTEND_URL_DEV || "http://localhost:3000";
  }
  return process.env.FRONTEND_URL || "http://localhost:3000";
};

const getUserIdFromReq = (req) => {
  // chỉnh theo auth middleware của bạn
  // nếu bạn set req.user._id thì return req.user._id
  return req.user._id || req.user.id;
};

/**
 * GET /api/me/facebook/login-url
 * Trả URL để frontend redirect user sang Facebook OAuth
 */
export const getFacebookLoginUrl = async (req, res, next) => {
  try {
     const graphVer = await getCfgStr("GRAPH_VER", "v24.0");
    const redirectUri = getRedirectUri();
    const appId = process.env.FB_APP_ID;

    const scopes = [
      "public_profile",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      // thêm nếu cần: "publish_video"
    ].join(",");

    // state có thể bỏ vào userId hoặc random string chống CSRF
    const state = encodeURIComponent(`${getUserIdFromReq(req)}`);

    const url = `https://www.facebook.com/${graphVer}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${scopes}&response_type=code&state=${state}`;

    res.json({ url });
  } catch (err) {
    next(err);
  }
};

/**
 * helper: đổi code -> access_token
 */
const exchangeCodeForAccessToken = async (code) => {
  const redirectUri = getRedirectUri();
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;

  const tokenRes = await fetch(
    `${FB_API}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
  );

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Failed to exchange code: ${tokenRes.status} ${text}`);
  }

  return tokenRes.json(); // { access_token, token_type, expires_in }
};

/**
 * Đổi user short-lived token -> long-lived user token (60 ngày)
 */
async function exchangeUserTokenForLongLived(shortUserToken) {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: FB_APP_ID,
    client_secret: FB_APP_SECRET,
    fb_exchange_token: shortUserToken,
  });

  const res = await fetch(`${FB_API}/oauth/access_token?${params.toString()}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to exchange long-lived user token: ${res.status} ${text}`
    );
  }

  // { access_token, token_type, expires_in }
  return res.json();
}

export const facebookCallback = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ message: "code is required" });
    }

    const userId = state;

    // 1) code -> short-lived user access token
    const tokenData = await exchangeCodeForAccessToken(code);
    const shortUserAccessToken = tokenData.access_token;

    // 2) đổi sang long-lived user token (nếu lỗi thì fallback short)
    let userAccessToken = shortUserAccessToken;
    let expireAt = null;

    try {
      const longLived = await exchangeUserTokenForLongLived(
        shortUserAccessToken
      );
      userAccessToken = longLived.access_token || shortUserAccessToken;

      if (longLived.expires_in) {
        // expires_in là giây
        expireAt = new Date(Date.now() + longLived.expires_in * 1000);
      }
    } catch (err) {
      console.error(
        "[facebookCallback] exchange long-lived token failed:",
        err?.message || err
      );
      // vẫn tiếp tục dùng short token cho userAccessToken
      if (tokenData.expires_in) {
        expireAt = new Date(Date.now() + tokenData.expires_in * 1000);
      }
    }

    // 3) lấy list page user quản lý bằng long-lived userAccessToken
    const pagesRes = await fetch(
      `${FB_API}/me/accounts?fields=id,name,picture,category,access_token`,
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
        },
      }
    );

    if (!pagesRes.ok) {
      const text = await pagesRes.text();
      throw new Error(`Failed to fetch pages: ${pagesRes.status} ${text}`);
    }

    const pagesJson = await pagesRes.json();
    const pages = pagesJson.data || [];

    // 4) lưu / upsert vào DB
    // pageAccessToken ở đây đã là token tạo từ long-lived user token
    const ops = pages.map((p) => ({
      updateOne: {
        filter: { user: userId, pageId: p.id },
        update: {
          user: userId,
          pageId: p.id,
          pageName: p.name,
          pagePicture: p.picture?.data?.url,
          pageCategory: p.category,
          pageAccessToken: p.access_token,
          expireAt, // NEW: cùng hạn với user long-lived token
          raw: p,
        },
        upsert: true,
      },
    }));

    if (ops.length > 0) {
      await FacebookPageConnection.bulkWrite(ops);
    }

    // 5) redirect về frontend
    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/settings/facebook?connected=1`);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/me/facebook/pages
 * Lấy list page user đã connect (từ DB)
 */
export const getMyFacebookPages = async (req, res, next) => {
  try {
    const userId = getUserIdFromReq(req);
    const pages = await FacebookPageConnection.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    res.json(
      pages.map((p) => ({
        id: p._id,
        pageId: p.pageId,
        pageName: p.pageName,
        pagePicture: p.pagePicture,
        pageCategory: p.pageCategory,
        isDefault: p.isDefault,
        createdAt: p.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/me/facebook/pages/:id
 * Xoá 1 page connection
 */
export const deleteFacebookPage = async (req, res, next) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;

    const conn = await FacebookPageConnection.findOne({
      _id: id,
      user: userId,
    });

    if (!conn) {
      return res.status(404).json({ message: "Connection not found" });
    }

    await conn.deleteOne();

    res.json({ message: "Deleted" });
  } catch (err) {
    next(err);
  }
};
