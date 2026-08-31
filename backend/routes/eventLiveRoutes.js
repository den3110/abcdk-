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

export default router;
