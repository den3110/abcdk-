// routes/eventLiveRoutes.js — Xem live giải đấu (public read + tracking)
import express from "express";
import {
  getEventLive,
  getEventLiveConfigPublic,
  trackEventLiveView,
  getEventLiveStats,
} from "../controllers/eventLiveController.js";
import {
  attachJwtIfPresent,
  protect,
  authorize,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", getEventLive);
router.get("/config", getEventLiveConfigPublic);

// Ghi nhận lượt dùng (web + app). Gắn user nếu có token, không thì tính theo deviceId.
router.post("/track", attachJwtIfPresent, trackEventLiveView);

// Thống kê cho admin
router.get("/stats", protect, authorize("admin"), getEventLiveStats);

// Ai đang xem ngay bây giờ (admin, real-time từ Redis)
router.get("/viewers", protect, authorize("admin"), async (req, res) => {
  try {
    const { getCurrentEventLiveViewers } = await import(
      "../services/eventLivePresence.service.js"
    );
    const data = await getCurrentEventLiveViewers();
    res.json(data);
  } catch (e) {
    res.status(500).json({ message: e?.message || "Lỗi lấy viewer" });
  }
});

// Lịch sử phiên xem (admin, từ MongoDB)
router.get("/viewers/history", protect, authorize("admin"), async (req, res) => {
  try {
    const { default: EventLivePresence } = await import(
      "../models/eventLivePresenceModel.js"
    );
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      200,
    );
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const [sessions, total, analytics] = await Promise.all([
      EventLivePresence.find({ joinedAt: { $gte: since } })
        .sort({ joinedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "name fullName nickname nickName avatar")
        .lean(),
      EventLivePresence.countDocuments({ joinedAt: { $gte: since } }),
      EventLivePresence.aggregate([
        { $match: { joinedAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            uniqueUsers: { $addToSet: "$user" },
            avgDurationSec: { $avg: "$durationSec" },
            totalDurationSec: { $sum: "$durationSec" },
          },
        },
        {
          $project: {
            _id: 0,
            totalSessions: 1,
            uniqueUsers: { $size: "$uniqueUsers" },
            avgDurationSec: { $round: ["$avgDurationSec", 0] },
            totalDurationSec: 1,
          },
        },
      ]),
    ]);

    res.json({
      days,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      analytics: analytics[0] || {
        totalSessions: 0,
        uniqueUsers: 0,
        avgDurationSec: 0,
      },
      sessions,
    });
  } catch (e) {
    res.status(500).json({ message: e?.message || "Lỗi viewer history" });
  }
});

export default router;
