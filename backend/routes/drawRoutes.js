// routes/drawRoutes.js
import express from "express";
import {
  startDraw,
  drawNext,
  drawCommit,
  drawCancel,
  getDrawSession,
  getDrawStatusByBracket,
  generateGroupMatches,
} from "../controllers/drawController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Tất cả endpoint đều yêu cầu admin
router.post("/:bracketId/start", protect, authorize("admin"), startDraw);
router.post("/:drawId/next", protect, authorize("admin"), drawNext);
router.post("/:drawId/commit", protect, authorize("admin"), drawCommit);
router.post("/:drawId/cancel", protect, authorize("admin"), drawCancel);
router.get("/:drawId", protect, authorize("admin"), getDrawSession);
router.get("/brackets/:bracketId/draw/status", protect, authorize("admin"), getDrawStatusByBracket);
router.post("/brackets/:bracketId/group/generate-matches", protect, authorize("admin"), generateGroupMatches);

export default router;
