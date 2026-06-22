import { recordCheckpointEvent } from "../services/checkpoint.service.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const getRouteGroup = (path = "") => {
  const p = String(path || "").toLowerCase();
  if (p.startsWith("/api/admin") || p.startsWith("/admin")) return "admin";
  if (p.startsWith("/api/upload") || p.startsWith("/upload")) return "upload";
  if (p.startsWith("/api/chat")) return "chat";
  if (p.startsWith("/api/support")) return "support";
  if (p.startsWith("/api/registrations")) return "registrations";
  if (p.startsWith("/api/push")) return "push";
  if (p.startsWith("/api/checkpoints")) return "checkpoint";
  return "";
};

const shouldObserveWriteSpam = (routeGroup) =>
  ["upload", "chat", "support", "registrations", "push"].includes(routeGroup);

export function checkpointObserver(req, res, next) {
  res.on("finish", () => {
    const path = req.originalUrl || req.url || "";
    const routeGroup = getRouteGroup(path);
    if (!routeGroup) return;

    const status = Number(res.statusCode || 0);
    const method = String(req.method || "").toUpperCase();
    const user = req.user || null;

    if (routeGroup === "admin" && [401, 403, 404].includes(status)) {
      void recordCheckpointEvent({
        req,
        user,
        subjectUser: user,
        type: "admin_route_denied",
        category: "admin_route",
        outcome: "denied",
        severity: status === 404 ? "low" : "medium",
        weight: status === 404 ? 1 : 3,
        routeGroup,
        metadata: { status },
      });
      return;
    }

    if (status === 429) {
      void recordCheckpointEvent({
        req,
        user,
        subjectUser: user,
        type: "rate_limited",
        category: "rate_limit",
        outcome: "rate_limited",
        severity: "medium",
        weight: 4,
        routeGroup,
        metadata: { status },
      });
      return;
    }

    if (WRITE_METHODS.has(method) && shouldObserveWriteSpam(routeGroup)) {
      void recordCheckpointEvent({
        req,
        user,
        subjectUser: user,
        type: "impactful_write",
        category: "spam",
        outcome: status >= 200 && status < 400 ? "observed" : "failed",
        severity: status >= 400 ? "medium" : "low",
        weight: status >= 400 ? 2 : 1,
        routeGroup,
        metadata: { status },
      });
    }
  });

  next();
}
