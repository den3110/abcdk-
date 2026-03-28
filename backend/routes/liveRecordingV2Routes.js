import express from "express";
import { authorize } from "../middleware/authMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  abortMultipartLiveRecordingSegmentV2,
  completeLiveRecordingSegmentV2,
  completeMultipartLiveRecordingSegmentV2,
  finalizeLiveRecordingV2,
  getLiveRecordingAiCommentaryMonitorV2,
  forceUploadingRecordingToExportV2,
  getLiveRecordingMonitorV2,
  getLiveRecordingWorkerHealthV2,
  getLiveRecordingByMatchV2,
  playLiveRecordingAiCommentaryV2,
  playLiveRecordingV2,
  queueLiveRecordingAiCommentaryV2,
  rerenderLiveRecordingAiCommentaryV2,
  getLiveRecordingTemporaryPlaylistV2,
  serveLiveHlsPlaylistV2,
  getLiveRecordingRawStatusV2,
  playLiveRecordingTemporaryV2,
  presignLiveRecordingManifestV2,
  presignLiveRecordingSegmentBatchV2,
  presignMultipartLiveRecordingSegmentPartV2,
  presignLiveRecordingSegmentV2,
  reportMultipartLiveRecordingSegmentProgressV2,
  retryLiveRecordingExportV2,
  startMultipartLiveRecordingSegmentV2,
  startLiveRecordingV2,
  streamLiveRecordingAiCommentaryRawV2,
  streamLiveRecordingRawV2,
} from "../controllers/liveRecordingV2Controller.js";

const router = express.Router();

router.post("/start", protect, startLiveRecordingV2);
router.post(
  "/segments/presign-batch",
  protect,
  presignLiveRecordingSegmentBatchV2
);
router.post("/segments/presign", protect, presignLiveRecordingSegmentV2);
router.post("/live-manifest/presign", protect, presignLiveRecordingManifestV2);
router.post("/segments/complete", protect, completeLiveRecordingSegmentV2);
router.post(
  "/segments/multipart/start",
  protect,
  startMultipartLiveRecordingSegmentV2
);
router.post(
  "/segments/multipart/part-url",
  protect,
  presignMultipartLiveRecordingSegmentPartV2
);
router.post(
  "/segments/multipart/progress",
  protect,
  reportMultipartLiveRecordingSegmentProgressV2
);
router.post(
  "/segments/multipart/complete",
  protect,
  completeMultipartLiveRecordingSegmentV2
);
router.post(
  "/segments/multipart/abort",
  protect,
  abortMultipartLiveRecordingSegmentV2
);
router.post("/finalize", protect, finalizeLiveRecordingV2);
router.get(
  "/admin/monitor",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorV2
);
router.get(
  "/admin/worker-health",
  protect,
  authorize("admin"),
  getLiveRecordingWorkerHealthV2
);
router.get(
  "/admin/commentary/monitor",
  protect,
  authorize("admin"),
  getLiveRecordingAiCommentaryMonitorV2
);
router.post(
  "/admin/:id/commentary",
  protect,
  authorize("admin"),
  queueLiveRecordingAiCommentaryV2
);
router.post(
  "/admin/:id/commentary/rerender",
  protect,
  authorize("admin"),
  rerenderLiveRecordingAiCommentaryV2
);
router.post(
  "/admin/:id/retry-export",
  protect,
  authorize("admin"),
  retryLiveRecordingExportV2
);
router.post(
  "/admin/:id/force-export",
  protect,
  authorize("admin"),
  forceUploadingRecordingToExportV2
);
router.get("/by-match/:matchId", getLiveRecordingByMatchV2);
router.get("/:id/temp/playlist", getLiveRecordingTemporaryPlaylistV2);
router.get("/:id/live.m3u8", serveLiveHlsPlaylistV2);
router.get("/:id/temp", playLiveRecordingTemporaryV2);
router.get("/:id/commentary/play", playLiveRecordingAiCommentaryV2);
router.get("/:id/commentary/raw", streamLiveRecordingAiCommentaryRawV2);
router.get("/:id/play", playLiveRecordingV2);
router.get("/:id/raw", streamLiveRecordingRawV2);
router.get("/:id/raw/status", getLiveRecordingRawStatusV2);

export default router;
