import { getCurrentCheckpointRequirementForUser } from "../services/checkpoint.service.js";

const ALLOWED_PREFIXES = [
  "/api/checkpoints",
  "/api/users/auth",
  "/api/users/logout",
  "/api/auth",
  "/api/app/init",
  "/api/health",
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RISK_PREFIXES = [
  "/api/admin",
  "/api/upload",
  "/api/chat",
  "/api/support",
  "/api/registrations",
  "/api/push",
];

const isAllowedPath = (path = "") => {
  const value = String(path || "").toLowerCase();
  return ALLOWED_PREFIXES.some((prefix) => value.startsWith(prefix));
};

const shouldEvaluateRisk = (path = "", method = "") => {
  const value = String(path || "").toLowerCase();
  if (RISK_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  return WRITE_METHODS.has(String(method || "").toUpperCase());
};

export async function checkpointRestriction(req, res, next) {
  try {
    const path = req.originalUrl || req.url || "";
    if (String(req.method || "").toUpperCase() === "OPTIONS") return next();
    if (!String(path).toLowerCase().startsWith("/api/")) return next();
    if (isAllowedPath(path)) return next();
    if (!req.user?._id) return next();

    const result = await getCurrentCheckpointRequirementForUser({
      user: req.user,
      req,
      createSession: true,
      includeRisk: shouldEvaluateRisk(path, req.method),
    });
    if (!result?.required) return next();

    return res.status(423).json({
      message: "Tài khoản đang bị hạn chế bởi checkpoint. Vui lòng hoàn tất xác minh để tiếp tục.",
      checkpointRequired: true,
      checkpoint: result.checkpoint || null,
      level: result.level || 1,
      reason: result.reason || "",
    });
  } catch (error) {
    return next(error);
  }
}
