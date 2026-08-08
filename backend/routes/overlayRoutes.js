// routes/overlayRoutes.js — Tạo scoreboard overlay từ poster + tên giải.
// Kiểm quyền admin/manager giải trong controller (canManage).
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getOverlayStatus,
  generateOverlay,
  deployOverlay,
  clearOverlay,
} from "../controllers/tournamentOverlayController.js";

const router = express.Router();

router.get("/tournaments/:id/overlay/status", protect, getOverlayStatus);
router.post("/tournaments/:id/overlay/generate", protect, generateOverlay);
router.post("/tournaments/:id/overlay/deploy", protect, deployOverlay);
router.delete("/tournaments/:id/overlay", protect, clearOverlay);

export default router;
