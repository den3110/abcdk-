// routes/eventLiveCommentRoutes.js
import express from "express";
import {
  getEventLiveComments,
  postEventLiveComment,
  deleteEventLiveComment,
  getEventLiveCommentStats,
} from "../controllers/eventLiveCommentController.js";
import {
  protect,
  authorize,
  attachJwtIfPresent,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Lịch sử bình luận (public, gắn user nếu có token)
router.get("/", attachJwtIfPresent, getEventLiveComments);

// Thống kê bình luận (admin) — đặt TRƯỚC /:id routes
router.get("/stats", protect, authorize("admin"), getEventLiveCommentStats);

// Gửi bình luận (phải đăng nhập)
router.post("/", protect, postEventLiveComment);

// Xoá bình luận (admin moderation)
router.delete("/:id", protect, authorize("admin"), deleteEventLiveComment);

export default router;
