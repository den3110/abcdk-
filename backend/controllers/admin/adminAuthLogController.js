import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import AuthLog from "../../models/authLogModel.js";
import { inferAuthLogChannel } from "../../middleware/authLogMiddleware.js";

const parsePositiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const escapeRegex = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeAuthLogForAdmin = (log = {}) => ({
  ...log,
  channel: inferAuthLogChannel({
    fallback: log.channel,
    path: log.path,
    userAgent: log.userAgent,
  }),
});

export const listAuthLogs = asyncHandler(async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 30));
  const keyword = String(req.query.keyword || "").trim();
  const action = String(req.query.action || "").trim();
  const channel = String(req.query.channel || "").trim();
  const status = String(req.query.status || "").trim();

  const filter = {};
  if (["login", "register"].includes(action)) filter.action = action;
  if (["web", "mobile", "admin", "unknown"].includes(channel)) filter.channel = channel;
  if (["success", "failed"].includes(status)) filter.status = status;

  if (keyword) {
    const rx = new RegExp(escapeRegex(keyword), "i");
    filter.$or = [
      { loginKey: rx },
      { email: rx },
      { phone: rx },
      { nickname: rx },
      { ip: rx },
      { userAgent: rx },
      { "request.name": rx },
    ];
    if (mongoose.isValidObjectId(keyword)) {
      filter.$or.push({ user: new mongoose.Types.ObjectId(keyword) });
    }
  }

  const [total, logs] = await Promise.all([
    AuthLog.countDocuments(filter),
    AuthLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("user", "name nickname phone email avatar role")
      .lean(),
  ]);

  res.json({
    logs: logs.map(normalizeAuthLogForAdmin),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

export const getAuthLogDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("Log id không hợp lệ");
  }

  const log = await AuthLog.findById(id)
    .populate("user", "name nickname phone email avatar role")
    .lean();

  if (!log) {
    res.status(404);
    throw new Error("Không tìm thấy log");
  }

  res.json(normalizeAuthLogForAdmin(log));
});
