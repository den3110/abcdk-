import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  startSession, stopSession, listSessions, getSession,
  getOverlayImage, getUserMatchOverlayImage, internalHeartbeat, listAvailableCams, internalImouSession,
  internalGetImouSession, getStats, internalRefreshDestinations, workerConfig,
  listTournamentsForApp, listCourtsForApp, listFbPagesForApp, courtImouSession,
  courtImouStreamUrl, getVenueDahua, setVenueDahua, listDahuaVenues,
} from "../controllers/tournamentAutoLiveController.js";

const router = express.Router();
const admin = authorize("admin");

// Public overlay PNG (worker fetch) + internal heartbeat KHÔNG cần user auth.
router.get("/overlay/usermatch/:id", getUserMatchOverlayImage);
router.get("/overlay/:id", getOverlayImage);
router.post("/internal/heartbeat", express.json(), internalHeartbeat);
router.post("/internal/imou-session", express.json(), internalImouSession);
router.get("/internal/imou-session", internalGetImouSession);
router.get("/internal/destinations", internalRefreshDestinations);

// Admin API
router.post("/start", protect, admin, startSession);
router.post("/:id/stop", protect, admin, stopSession);
router.get("/sessions", protect, admin, listSessions);
router.get("/stats", protect, admin, getStats);
router.get("/available-cams", protect, admin, listAvailableCams);
router.get("/tournaments", protect, admin, listTournamentsForApp);
router.get("/tournaments/:tid/courts", protect, admin, listCourtsForApp);
router.get("/fb-pages", protect, admin, listFbPagesForApp);
router.get("/court-imou-session", protect, admin, courtImouSession);
router.get("/court-imou-stream-url", protect, admin, courtImouStreamUrl);
router.get("/venue-dahua", protect, admin, getVenueDahua);
router.post("/venue-dahua", protect, admin, express.json(), setVenueDahua);
router.get("/dahua-venues", protect, admin, listDahuaVenues);
router.get("/:id/worker-config", protect, admin, workerConfig);
router.get("/:id", protect, admin, getSession);

export default router;
