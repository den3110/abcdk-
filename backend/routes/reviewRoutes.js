// routes/reviewRoutes.js — Đánh giá giải đấu / sân chơi
import express from "express";
import {
  listReviews,
  upsertReview,
  deleteMyReview,
  getReviewSummary,
  adminListReviews,
  adminSetHidden,
} from "../controllers/reviewController.js";
import {
  protect,
  authorize,
  attachJwtIfPresent,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Admin — đặt TRƯỚC /:targetType/:targetId để không bị nuốt route
router.get("/admin/list", protect, authorize("admin"), adminListReviews);
router.patch("/admin/:id/hidden", protect, authorize("admin"), adminSetHidden);

// Public list (gắn user nếu có token để trả "mine")
router.get("/:targetType/:targetId/summary", getReviewSummary);
router.get("/:targetType/:targetId", attachJwtIfPresent, listReviews);

// Người dùng
router.post("/:targetType/:targetId", protect, upsertReview);
router.delete("/:targetType/:targetId", protect, deleteMyReview);

export default router;
