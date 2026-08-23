// routes/playRoutes.js — "Tìm bạn đánh" (matchmaking giao lưu)
import express from "express";
import rateLimit from "express-rate-limit";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import {
  listInvites,
  getInvite,
  createInvite,
  updateInvite,
  deleteInvite,
  requestJoin,
  respondJoin,
  leaveInvite,
} from "../controllers/playController.js";

const router = express.Router();

const perUserKey = (req) => String(req.user?._id || req.ip);
const rlCreate = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 30,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn tạo kèo quá nhiều hôm nay, thử lại sau." },
});

router.get("/", optionalAuth, listInvites);
router.post("/", protect, rlCreate, createInvite);

// Join sub-routes (đặt trước "/:id" generic có param riêng)
router.patch("/:id/join/:userId", protect, respondJoin);
router.post("/:id/join", protect, requestJoin);
router.delete("/:id/join", protect, leaveInvite);

router.get("/:id", optionalAuth, getInvite);
router.put("/:id", protect, updateInvite);
router.delete("/:id", protect, deleteInvite);

export default router;
