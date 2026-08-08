// routes/overlayRoutes.js — Tạo scoreboard overlay từ poster + tên giải.
// Kiểm quyền admin/manager giải trong controller (canManage).
import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  getOverlayStatus,
  generateOverlay,
  deployOverlay,
  clearOverlay,
  getGeneratorKeyStatus,
  setGeneratorKey,
} from "../controllers/tournamentOverlayController.js";

const router = express.Router();

router.get("/tournaments/:id/overlay/status", protect, getOverlayStatus);
router.post("/tournaments/:id/overlay/generate", protect, generateOverlay);
router.post("/tournaments/:id/overlay/deploy", protect, deployOverlay);
router.delete("/tournaments/:id/overlay", protect, clearOverlay);

// Admin-only: quản lý ANTHROPIC_API_KEY của overlay generator
router.get(
  "/overlay-generator/keystatus",
  protect,
  authorize("admin"),
  getGeneratorKeyStatus
);
router.post(
  "/overlay-generator/setkey",
  protect,
  authorize("admin"),
  setGeneratorKey
);

export default router;
