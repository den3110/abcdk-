import asyncHandler from "express-async-handler";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import OAuthAuthorizationCode from "../models/oauthAuthorizationCodeModel.js";
import { buildLiveAppBootstrapForUser } from "../services/liveAppAccess.service.js";

const OAUTH_LIVE_CLIENT_ID =
  process.env.OAUTH_LIVE_CLIENT_ID || "pickletour-live-app";
const OAUTH_LIVE_REDIRECT_URI =
  process.env.OAUTH_LIVE_REDIRECT_URI || "pickletour-live://auth";
const OAUTH_CODE_TTL_MS = Math.max(
  30_000,
  Number(process.env.OAUTH_LIVE_CODE_TTL_MS || 120_000)
);
const ACCESS_TOKEN_TTL = process.env.OAUTH_LIVE_ACCESS_TOKEN_TTL || "30d";

function normalizeText(value) {
  return String(value || "").trim();
}

function parseAuthorizeInput(source) {
  return {
    clientId: normalizeText(source.client_id || source.clientId),
    redirectUri: normalizeText(source.redirect_uri || source.redirectUri),
    responseType: normalizeText(source.response_type || source.responseType),
    scope: normalizeText(source.scope || "openid profile"),
    state: normalizeText(source.state),
    codeChallenge: normalizeText(
      source.code_challenge || source.codeChallenge
    ),
    codeChallengeMethod: normalizeText(
      source.code_challenge_method || source.codeChallengeMethod || "S256"
    ),
    osAuthToken: normalizeText(source.os_auth_token || source.osAuthToken),
  };
}

function buildAuthorizeValidationError(input) {
  if (input.clientId !== OAUTH_LIVE_CLIENT_ID) {
    return "Ứng dụng PickleTour Live không hợp lệ.";
  }
  if (input.redirectUri !== OAUTH_LIVE_REDIRECT_URI) {
    return "Đường dẫn quay về ứng dụng live không hợp lệ.";
  }
  if (input.responseType !== "code") {
    return "OAuth request không hợp lệ.";
  }
  if (!input.state) {
    return "Thiếu state xác thực.";
  }
  if (!input.codeChallenge) {
    return "Thiếu PKCE challenge.";
  }
  if (!["S256", "plain"].includes(input.codeChallengeMethod)) {
    return "PKCE method không được hỗ trợ.";
  }
  return null;
}

function buildWebLoginUrl(req) {
  const returnTo =
    typeof req.originalUrl === "string" && req.originalUrl.startsWith("/")
      ? req.originalUrl
      : "/oauth/authorize";
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

async function resolveOAuthUser(req, osAuthToken) {
  if (req.user?._id) {
    return req.user;
  }

  if (!osAuthToken) return null;

  try {
    const decoded = jwt.verify(osAuthToken, process.env.JWT_SECRET);
    if (decoded?.kind !== "os-auth" || !decoded?.sub) {
      return null;
    }
    const user = await User.findById(decoded.sub)
      .select("_id name nickname email phone role avatar")
      .lean();
    return user || null;
  } catch {
    return null;
  }
}

function makeCode() {
  return crypto.randomBytes(32).toString("hex");
}

function sha256Base64Url(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function issueLiveAccessToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

export const getAuthorizeContext = asyncHandler(async (req, res) => {
  const input = parseAuthorizeInput(req.query || {});
  const validationError = buildAuthorizeValidationError(input);
  if (validationError) {
    return res.status(400).json({
      ok: false,
      authenticated: false,
      canAuthorize: false,
      reason: "invalid_request",
      message: validationError,
    });
  }

  const user = await resolveOAuthUser(req, input.osAuthToken);
  if (!user) {
    return res.json({
      ok: true,
      authenticated: false,
      canAuthorize: false,
      reason: input.osAuthToken ? "os_auth_invalid" : "login_required",
      message: input.osAuthToken
        ? "Phiên xác thực PickleTour trên thiết bị đã hết hạn. Hãy đăng nhập lại hoặc tiếp tục bằng web."
        : "Bạn cần đăng nhập PickleTour trước khi cấp quyền cho app live.",
      loginUrl: buildWebLoginUrl(req),
      app: {
        clientId: OAUTH_LIVE_CLIENT_ID,
        name: "PickleTour Live",
      },
    });
  }

  const bootstrap = await buildLiveAppBootstrapForUser(user);
  return res.json({
    ok: true,
    authenticated: true,
    canAuthorize: bootstrap.canUseLiveApp,
    reason: bootstrap.reason,
    message: bootstrap.message,
    user: bootstrap.user,
    app: {
      clientId: OAUTH_LIVE_CLIENT_ID,
      name: "PickleTour Live",
    },
    manageableTournaments: bootstrap.manageableTournaments,
    roleSummary: bootstrap.roleSummary,
  });
});

export const approveAuthorizeRequest = asyncHandler(async (req, res) => {
  const input = parseAuthorizeInput(req.body || {});
  const validationError = buildAuthorizeValidationError(input);
  if (validationError) {
    return res.status(400).json({
      ok: false,
      reason: "invalid_request",
      message: validationError,
    });
  }

  const user = await resolveOAuthUser(req, input.osAuthToken);
  if (!user) {
    return res.status(401).json({
      ok: false,
      reason: "login_required",
      message: "Phiên đăng nhập PickleTour không còn hợp lệ.",
    });
  }

  const bootstrap = await buildLiveAppBootstrapForUser(user);
  if (!bootstrap.canUseLiveApp) {
    return res.status(403).json({
      ok: false,
      reason: bootstrap.reason || "live_access_denied",
      message:
        bootstrap.message ||
        "Tài khoản này chưa có quyền dùng PickleTour Live.",
    });
  }

  const code = makeCode();
  const expiresAt = new Date(Date.now() + OAUTH_CODE_TTL_MS);

  await OAuthAuthorizationCode.create({
    code,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    scope: input.scope,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    user: user._id,
    expiresAt,
  });

  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", input.state);

  return res.json({
    ok: true,
    redirectTo: redirect.toString(),
    expiresAt: expiresAt.toISOString(),
  });
});

export const exchangeAuthorizeCode = asyncHandler(async (req, res) => {
  const grantType = normalizeText(req.body?.grant_type);
  const code = normalizeText(req.body?.code);
  const clientId = normalizeText(req.body?.client_id || req.body?.clientId);
  const redirectUri = normalizeText(
    req.body?.redirect_uri || req.body?.redirectUri
  );
  const codeVerifier = normalizeText(
    req.body?.code_verifier || req.body?.codeVerifier
  );

  if (grantType !== "authorization_code") {
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only authorization_code is supported.",
    });
  }

  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing code, client_id, redirect_uri, or code_verifier.",
    });
  }

  const authCode = await OAuthAuthorizationCode.findOne({ code });
  if (!authCode) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Authorization code is invalid.",
    });
  }

  if (authCode.usedAt) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Authorization code has already been used.",
    });
  }

  if (authCode.expiresAt.getTime() <= Date.now()) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Authorization code has expired.",
    });
  }

  if (authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "client_id or redirect_uri mismatch.",
    });
  }

  const expectedChallenge =
    authCode.codeChallengeMethod === "plain"
      ? codeVerifier
      : sha256Base64Url(codeVerifier);
  if (expectedChallenge !== authCode.codeChallenge) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "PKCE verification failed.",
    });
  }

  const user = await User.findById(authCode.user)
    .select("_id role")
    .lean();
  if (!user) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "User not found.",
    });
  }

  const marked = await OAuthAuthorizationCode.findOneAndUpdate(
    {
      _id: authCode._id,
      usedAt: null,
    },
    {
      $set: { usedAt: new Date() },
    },
    { new: true }
  ).lean();
  if (!marked) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Authorization code has already been used.",
    });
  }

  const accessToken = issueLiveAccessToken(user);
  return res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 30 * 24 * 60 * 60,
    scope: authCode.scope || "openid profile",
  });
});
