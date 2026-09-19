import express from "express";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  startSession, stopSession, listSessions, getSession,
  getOverlayImage, internalHeartbeat,
} from "../controllers/tournamentAutoLiveController.js";

const router = express.Router();

// Public overlay PNG (worker fetch) + internal heartbeat KHÔNG cần user auth.
router.get("/overlay/:id", getOverlayImage);
router.post("/internal/heartbeat", express.json(), internalHeartbeat);

// Admin API
router.post("/start", protect, admin, startSession);
router.post("/:id/stop", protect, admin, stopSession);
router.get("/sessions", protect, admin, listSessions);
router.get("/:id", protect, admin, getSession);

export default router;
