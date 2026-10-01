import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  startSession, stopSession, listSessions, getSession,
  getOverlayImage, getUserMatchOverlayImage, internalHeartbeat, listAvailableCams, internalImouSession,
  internalGetImouSession, getStats, internalRefreshDestinations, workerConfig, setSessionLayout,
  listTournamentsForApp, listCourtsForApp, listFbPagesForApp, courtImouSession,
  courtImouStreamUrl, getVenueDahua, setVenueDahua, listDahuaVenues, dahuaSnapshot,
  listRtspSources, createRtspSource, updateRtspSource, deleteRtspSource,
  internalRecordingPlan, internalUploadSegment, internalSegmentPresign, internalSegmentComplete, listClipsForAdmin,
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
// Recording clip: desktop hỏi kế hoạch + đẩy segment (body raw MP4 → KHÔNG body parser).
router.get("/internal/recording/plan", internalRecordingPlan);
router.post("/internal/recording/segment", internalUploadSegment);
// Bản desktop MỚI: đẩy segment thẳng lên R2 (presign PUT → báo hoàn tất).
router.post("/internal/recording/segment-presign", internalSegmentPresign);
router.post("/internal/recording/segment-complete", express.json(), internalSegmentComplete);

// Admin API
router.post("/start", protect, admin, startSession);
router.post("/:id/stop", protect, admin, stopSession);
router.get("/sessions", protect, admin, listSessions);
router.get("/clips", protect, admin, listClipsForAdmin);
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
router.get("/dahua-snapshot", protect, admin, dahuaSnapshot);
// Thư viện nguồn RTSP có tên (đặt TRƯỚC "/:id" để không bị route động nuốt).
router.get("/rtsp-sources", protect, admin, listRtspSources);
router.post("/rtsp-sources", protect, admin, express.json(), createRtspSource);
router.put("/rtsp-sources/:id", protect, admin, express.json(), updateRtspSource);
router.delete("/rtsp-sources/:id", protect, admin, deleteRtspSource);
router.get("/:id/worker-config", protect, admin, workerConfig);
router.patch("/:id/layout", protect, admin, express.json(), setSessionLayout);
router.get("/:id", protect, admin, getSession);

export default router;
