// controllers/admin/adminAccessAnalyticsController.js
// Thống kê số lượng người truy cập gần nhất (1 / 7 / 30 ngày).
// Dữ liệu lấy từ AuthLog (login thành công), unique theo user.
// Show details: list user + tần suất login + kênh (web/mobile/admin/unknown) + lần cuối.

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import AuthLog from "../../models/authLogModel.js";
import { inferAuthLogChannel } from "../../middleware/authLogMiddleware.js";

const parsePositiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const escapeRegex = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const WINDOWS = [
  { key: "d1", days: 1 },
  { key: "d7", days: 7 },
  { key: "d30", days: 30 },
];
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_CHANNELS = ["web", "mobile", "admin", "unknown"];

// Chuẩn hoá channel từ document (có thể null hoặc chưa được middleware set)
const resolveChannel = (log) =>
  inferAuthLogChannel({
    fallback: log.channel,
    path: log.path,
    userAgent: log.userAgent,
  });

// ------- Summary: 1/7/30 ngày -------
export const getAccessAnalyticsSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const from30 = new Date(now.getTime() - 30 * DAY_MS);
  const from7 = new Date(now.getTime() - 7 * DAY_MS);
  const from1 = new Date(now.getTime() - 1 * DAY_MS);

  // Aggregate 1 lần cho 30 ngày, sau đó cắt lát trong bộ nhớ theo user's firstIn.
  // Thay vào đó dùng 3 query song song đơn giản, đủ nhanh vì có index createdAt + status.
  const baseMatch = { action: "login", status: "success" };

  async function countWindow(from) {
    const rows = await AuthLog.aggregate([
      { $match: { ...baseMatch, createdAt: { $gte: from } } },
      {
        $group: {
          _id: {
            user: "$user",
            channel: { $ifNull: ["$channel", "unknown"] },
          },
          count: { $sum: 1 },
          lastPath: { $last: "$path" },
          lastUserAgent: { $last: "$userAgent" },
        },
      },
    ]);
    const uniqUsers = new Set();
    const uniqUsersByChannel = { web: new Set(), mobile: new Set(), admin: new Set(), unknown: new Set() };
    let totalLogins = 0;
    const totalLoginsByChannel = { web: 0, mobile: 0, admin: 0, unknown: 0 };
    for (const r of rows) {
      const channel = ALLOWED_CHANNELS.includes(r._id.channel)
        ? r._id.channel
        : inferAuthLogChannel({
            fallback: r._id.channel,
            path: r.lastPath,
            userAgent: r.lastUserAgent,
          });
      const bucket = ALLOWED_CHANNELS.includes(channel) ? channel : "unknown";
      totalLogins += r.count;
      totalLoginsByChannel[bucket] += r.count;
      const uid = r._id.user ? String(r._id.user) : null;
      if (uid) {
        uniqUsers.add(uid);
        uniqUsersByChannel[bucket].add(uid);
      }
    }
    return {
      uniqueUsers: uniqUsers.size,
      totalLogins,
      byChannel: {
        web: {
          uniqueUsers: uniqUsersByChannel.web.size,
          totalLogins: totalLoginsByChannel.web,
        },
        mobile: {
          uniqueUsers: uniqUsersByChannel.mobile.size,
          totalLogins: totalLoginsByChannel.mobile,
        },
        admin: {
          uniqueUsers: uniqUsersByChannel.admin.size,
          totalLogins: totalLoginsByChannel.admin,
        },
        unknown: {
          uniqueUsers: uniqUsersByChannel.unknown.size,
          totalLogins: totalLoginsByChannel.unknown,
        },
      },
    };
  }

  const [d1, d7, d30] = await Promise.all([countWindow(from1), countWindow(from7), countWindow(from30)]);
  res.json({
    ts: Date.now(),
    windows: { d1, d7, d30 },
  });
});

// ------- Users details: paginated list -------
export const listAccessAnalyticsUsers = asyncHandler(async (req, res) => {
  const days = [1, 7, 30].includes(parsePositiveInt(req.query.days, 7))
    ? parsePositiveInt(req.query.days, 7)
    : 7;
  const channelParam = String(req.query.channel || "").trim();
  const channel = ALLOWED_CHANNELS.includes(channelParam) ? channelParam : "";
  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 30));
  const keyword = String(req.query.keyword || "").trim();

  const from = new Date(Date.now() - days * DAY_MS);
  const match = { action: "login", status: "success", createdAt: { $gte: from } };
  if (channel) match.channel = channel;
  if (keyword) {
    const rx = new RegExp(escapeRegex(keyword), "i");
    match.$or = [
      { loginKey: rx },
      { email: rx },
      { phone: rx },
      { nickname: rx },
      { ip: rx },
      { userAgent: rx },
      { "request.name": rx },
    ];
    if (mongoose.isValidObjectId(keyword)) {
      match.$or.push({ user: new mongoose.Types.ObjectId(keyword) });
    }
  }

  const pipeline = [
    { $match: match },
    {
      $sort: { createdAt: -1 },
    },
    {
      $group: {
        _id: "$user",
        lastLoginAt: { $max: "$createdAt" },
        firstLoginAt: { $min: "$createdAt" },
        loginCount: { $sum: 1 },
        channels: { $addToSet: { $ifNull: ["$channel", "unknown"] } },
        // giữ record gần nhất để suy method/ip/ua
        lastPath: { $first: "$path" },
        lastMethod: { $first: "$method" },
        lastIp: { $first: "$ip" },
        lastUserAgent: { $first: "$userAgent" },
        lastLoginKey: { $first: "$loginKey" },
      },
    },
    { $sort: { lastLoginAt: -1 } },
    {
      $facet: {
        items: [
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "user",
              pipeline: [
                { $project: { name: 1, nickname: 1, phone: 1, email: 1, avatar: 1, role: 1 } },
              ],
            },
          },
          { $addFields: { user: { $arrayElemAt: ["$user", 0] } } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ];

  const [agg] = await AuthLog.aggregate(pipeline);
  const raw = agg?.items || [];
  const total = agg?.total?.[0]?.count || 0;

  const items = raw.map((r) => {
    // Chuẩn hoá channels — dùng inferChannel cho các entry unknown
    const channels = Array.from(
      new Set(
        (r.channels || []).map((c) =>
          ALLOWED_CHANNELS.includes(c)
            ? c
            : inferAuthLogChannel({ fallback: c, path: r.lastPath, userAgent: r.lastUserAgent })
        )
      )
    );
    return {
      user: r.user
        ? {
            _id: String(r.user._id),
            name: r.user.name || "",
            nickname: r.user.nickname || "",
            phone: r.user.phone || "",
            email: r.user.email || "",
            avatar: r.user.avatar || "",
            role: r.user.role || "",
          }
        : null,
      // Với record không có user (login fail vẫn qua status:success đây không có; nhưng để tương thích):
      loginKey: r.lastLoginKey || "",
      lastLoginAt: r.lastLoginAt,
      firstLoginAt: r.firstLoginAt,
      loginCount: r.loginCount,
      channels,
      lastMethod: r.lastMethod || "",
      lastIp: r.lastIp || "",
      lastUserAgent: r.lastUserAgent || "",
    };
  });

  res.json({
    ts: Date.now(),
    days,
    channel: channel || "all",
    keyword,
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});
