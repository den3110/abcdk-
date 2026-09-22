import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  createClip,
  listMyClips,
  listBookingCams,
  getClip,
  deleteClip,
} from "../controllers/clipController.js";

const router = express.Router();

// Tất cả đều yêu cầu đăng nhập (user sở hữu lượt đặt sân).
router.post("/", protect, createClip);
router.get("/cams", protect, listBookingCams); // đặt TRƯỚC /:id
router.get("/mine", protect, listMyClips); // đặt TRƯỚC /:id
router.get("/:id", protect, getClip);
router.delete("/:id", protect, deleteClip);

export default router;
