// controllers/eventLiveController.js
// API công khai cho tính năng "Xem live giải đấu" (vd Heineken Pickleball World Cup).
import asyncHandler from "express-async-handler";
import {
  getEventLiveData,
  getEventLiveConfig,
} from "../services/eventLiveStreams.service.js";
import EventLiveView from "../models/eventLiveViewModel.js";

// Ngày theo giờ VN (UTC+7) -> "YYYY-MM-DD"
function vnDayKey(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const normPlatform = (p) =>
  ["web", "ios", "android"].includes(String(p || "").toLowerCase())
    ? String(p).toLowerCase()
    : "unknown";

// GET /api/event-live  -> { enabled, event..., live:[], replays:[] }
export const getEventLive = asyncHandler(async (req, res) => {
  const force = String(req.query.refresh || "") === "1";
  const data = await getEventLiveData({ force });
  res.set("Cache-Control", "public, max-age=60");
  res.json(data);
});

// GET /api/event-live/config -> { enabled, eventName, eventLogoUrl, bannerImageUrl, tournamentId }
// (nhẹ, cho banner trang chủ; KHÔNG trả apiKey/channel)
export const getEventLiveConfigPublic = asyncHandler(async (req, res) => {
  const cfg = await getEventLiveConfig();
  res.set("Cache-Control", "public, max-age=120");
  res.json({
    enabled: cfg.enabled,
    eventName: cfg.eventName,
    eventLogoUrl: cfg.eventLogoUrl,
    bannerImageUrl: cfg.bannerImageUrl,
    tournamentId: cfg.tournamentId,
    configured: Boolean(cfg.youtubeChannel),
  });
});

// POST /api/event-live/track  body: { platform, videoId?, deviceId? }
// Ghi nhận 1 lượt mở tính năng. Dùng attachJwtIfPresent -> req.user có thể null.
export const trackEventLiveView = asyncHandler(async (req, res) => {
  const platform = normPlatform(req.body?.platform);
  const videoId = String(req.body?.videoId || "").slice(0, 24);
  const userId = req.user?._id || null;
  const deviceId = String(
    req.body?.deviceId || req.headers["x-device-id"] || "",
  ).slice(0, 128);

  const identity = userId ? `u:${userId}` : deviceId ? `d:${deviceId}` : "";
  if (!identity) {
    // Không có danh tính -> vẫn nhận nhưng không ghi (tránh rác vô danh trùng lặp)
    return res.status(202).json({ ok: true, counted: false });
  }

  const dayKey = vnDayKey();
  const now = new Date();
  try {
    await EventLiveView.updateOne(
      { identity, platform, dayKey },
      {
        $inc: { count: 1 },
        $set: {
          user: userId,
          deviceId,
          lastVideoId: videoId,
          lastAt: now,
          expireAt: new Date(now.getTime() + 180 * 24 * 3600 * 1000),
        },
        $setOnInsert: { firstAt: now },
      },
      { upsert: true },
    );
  } catch (e) {
    // Trùng key do race -> bỏ qua
  }
  res.status(202).json({ ok: true, counted: true });
});

// GET /api/event-live/stats?days=30  (admin) -> tổng hợp lượt dùng
export const getEventLiveStats = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = vnDayKey(new Date(Date.now() - (days - 1) * 24 * 3600 * 1000));

  const match = { dayKey: { $gte: since } };

  const [byPlatform, totals, daily, uniqueAll] = await Promise.all([
    // Theo nền tảng: unique identity + tổng lượt
    EventLiveView.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$platform",
          users: { $addToSet: "$identity" },
          opens: { $sum: "$count" },
        },
      },
      { $project: { platform: "$_id", _id: 0, users: { $size: "$users" }, opens: 1 } },
    ]),
    // Tổng lượt mở
    EventLiveView.aggregate([
      { $match: match },
      { $group: { _id: null, opens: { $sum: "$count" } } },
    ]),
    // Theo ngày
    EventLiveView.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$dayKey",
          users: { $addToSet: "$identity" },
          opens: { $sum: "$count" },
        },
      },
      { $project: { date: "$_id", _id: 0, users: { $size: "$users" }, opens: 1 } },
      { $sort: { date: 1 } },
    ]),
    // Unique user/thiết bị toàn kỳ
    EventLiveView.distinct("identity", match),
  ]);

  const platformMap = { web: { users: 0, opens: 0 }, ios: { users: 0, opens: 0 }, android: { users: 0, opens: 0 }, unknown: { users: 0, opens: 0 } };
  for (const p of byPlatform) {
    platformMap[p.platform] = { users: p.users, opens: p.opens };
  }
  const loggedIn = uniqueAll.filter((i) => i.startsWith("u:")).length;

  res.json({
    days,
    since,
    totalOpens: totals[0]?.opens || 0,
    uniqueUsers: uniqueAll.length,
    uniqueLoggedIn: loggedIn,
    uniqueAnonymous: uniqueAll.length - loggedIn,
    byPlatform: platformMap,
    // Gộp web vs app cho tiện đọc
    web: platformMap.web,
    app: {
      users: platformMap.ios.users + platformMap.android.users,
      opens: platformMap.ios.opens + platformMap.android.opens,
    },
    daily,
  });
});
