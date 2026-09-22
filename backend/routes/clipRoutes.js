import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  createClip,
  listMyClips,
  listBookingCams,
  getClip,
  deleteClip,
  listPendingApprovals,
  approveClip,
  rejectClip,
  getClipSettings,
  setClipSettings,
} from "../controllers/clipController.js";

const router = express.Router();

// Tất cả đều yêu cầu đăng nhập.
router.post("/", protect, createClip);
router.get("/cams", protect, listBookingCams); // đặt TRƯỚC /:id
router.get("/mine", protect, listMyClips); // đặt TRƯỚC /:id
// Chủ sân duyệt clip ngoài giờ (đặt TRƯỚC /:id).
router.get("/pending", protect, listPendingApprovals);
router.get("/settings", protect, getClipSettings);
router.patch("/settings", protect, setClipSettings);
router.post("/:id/approve", protect, approveClip);
router.post("/:id/reject", protect, rejectClip);
router.get("/:id", protect, getClip);
router.delete("/:id", protect, deleteClip);

export default router;
