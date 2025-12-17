import asyncHandler from "express-async-handler";
import AuditLog from "../models/auditLogModel.js";

/**
 * GET /api/audit/users/:userId
 * Admin/SuperUser: xem lịch sử chỉnh sửa profile của 1 user
 * Query:
 * - page (default 1)
 * - limit (default 30, max 100)
 * - actorId (lọc theo người sửa)
 * - field (lọc theo field, vd: "avatar", "province")
 */
export const getUserProfileAudit = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "30", 10), 1), 100);

  const actorId = (req.query.actorId || "").trim();
  const field = (req.query.field || "").trim();

  const filter = {
    entityType: "User",
    entityId: userId,
    action: "UPDATE",
  };

  if (actorId) filter["actor.id"] = actorId;
  if (field) filter["changes.field"] = field;

  const total = await AuditLog.countDocuments(filter);

  const items = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    items,
  });
});

/**
 * GET /api/audit/me
 * User tự xem lịch sử chỉnh sửa của chính mình
 */
export const getMyProfileAudit = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "30", 10), 1), 100);

  const filter = {
    entityType: "User",
    entityId: req.user._id,
    action: "UPDATE",
  };

  const total = await AuditLog.countDocuments(filter);

  const items = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    items,
  });
});

/**
 * GET /api/audit/:id
 * Xem chi tiết 1 log (để hiển thị UI đẹp)
 */
export const getAuditDetail = asyncHandler(async (req, res) => {
  const log = await AuditLog.findById(req.params.id).lean();
  if (!log) {
    res.status(404);
    throw new Error("Không tìm thấy audit log");
  }
  res.json(log);
});
