import AuthLog from "../models/authLogModel.js";

const pickString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const normalizeEmail = (value) => pickString(value).toLowerCase();

const normalizePhone = (value) => pickString(value).replace(/[^\d+]/g, "");

const safeRequestBody = (body = {}) => ({
  email: normalizeEmail(body.email),
  phone: normalizePhone(body.phone),
  identifier: pickString(body.identifier || body.email || body.phone),
  nickname: pickString(body.nickname),
  name: pickString(body.name),
});

const getUserIdFromPayload = (payload) =>
  payload?._id ||
  payload?.id ||
  payload?.userId ||
  payload?.user?._id ||
  payload?.user?.id ||
  payload?.user?.userId ||
  null;

const getRoleFromPayload = (payload) =>
  payload?.role || payload?.user?.role || payload?.userInfo?.role || "";

const getIsAdminFromPayload = (payload) =>
  payload?.isAdmin === true || payload?.user?.isAdmin === true || getRoleFromPayload(payload) === "admin";

const getLoginKey = (body = {}, payload = {}) =>
  pickString(
    body.identifier ||
      body.email ||
      body.phone ||
      body.nickname ||
      payload?.email ||
      payload?.phone ||
      payload?.nickname ||
      payload?.user?.email ||
      payload?.user?.phone ||
      payload?.user?.nickname,
  );

export const inferAuthLogChannel = ({
  fallback = "unknown",
  path = "",
  userAgent = "",
  platform = "",
} = {}) => {
  if (["admin", "mobile", "web"].includes(fallback)) return fallback;

  const normalizedPlatform = String(platform || "").toLowerCase();
  if (/(ios|android|app|mobile)/.test(normalizedPlatform)) return "mobile";
  if (/(web|browser)/.test(normalizedPlatform)) return "web";

  const normalizedPath = String(path || "").toLowerCase();
  if (normalizedPath.includes("/admin/login")) return "admin";
  if (normalizedPath.includes("/auth/web")) return "web";
  if (normalizedPath.includes("/auth")) return "mobile";

  const ua = String(userAgent || "").toLowerCase();
  if (
    /(okhttp|dalvik|expo|reactnative|react-native|cfnetwork|darwin|pickletour|iphone|ipad|android)/.test(
      ua,
    )
  ) {
    return "mobile";
  }
  if (/(mozilla|chrome|safari|firefox|edge)/.test(ua)) return "web";
  return fallback;
};

const resolveChannel = (req, fallback = "unknown") =>
  inferAuthLogChannel({
    fallback,
    path: req.originalUrl || req.url,
    userAgent: req.headers["user-agent"],
    platform:
      req.headers["x-client-platform"] ||
      req.headers["x-platform"] ||
      req.headers["x-app-platform"],
  });

export const authLog =
  ({ action, channel = "unknown" }) =>
  (req, res, next) => {
    let responsePayload = null;
    const originalJson = res.json.bind(res);

    res.json = (payload) => {
      responsePayload = payload;
      return originalJson(payload);
    };

    res.on("finish", () => {
      const statusCode = res.statusCode || 0;
      const ok = statusCode >= 200 && statusCode < 400;
      const request = safeRequestBody(req.body || {});
      const userId = getUserIdFromPayload(responsePayload);
      const loginKey = getLoginKey(req.body || {}, responsePayload || {});

      AuthLog.create({
        action,
        channel: resolveChannel(req, channel),
        status: ok ? "success" : "failed",
        statusCode,
        user: userId || undefined,
        loginKey,
        email: request.email,
        phone: request.phone,
        nickname: request.nickname,
        ip:
          pickString(req.headers["x-forwarded-for"]).split(",")[0]?.trim() ||
          req.ip ||
          req.socket?.remoteAddress ||
          "",
        userAgent: pickString(req.headers["user-agent"]),
        method: req.method,
        path: req.originalUrl || req.url,
        errorMessage: ok
          ? ""
          : pickString(responsePayload?.message || responsePayload?.error || res.statusMessage),
        request,
        response: {
          userId: userId ? String(userId) : "",
          role: getRoleFromPayload(responsePayload || {}),
          isAdmin: getIsAdminFromPayload(responsePayload || {}),
        },
      }).catch((err) => {
        console.error("[authLog] write failed:", err?.message || err);
      });
    });

    next();
  };
