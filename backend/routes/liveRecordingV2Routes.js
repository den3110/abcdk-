import express from "express";
import { authorize, protect, protectLiveApp } from "../middleware/authMiddleware.js";
import {
  abortMultipartLiveRecordingSegmentV2,
  bulkTrashLiveRecordingDriveAssetV2,
  cleanLiveRecordingR2SourceV2,
  completeLiveRecordingSegmentV2,
  completeMultipartLiveRecordingSegmentV2,
  finalizeLiveRecordingV2,
  getLiveRecordingAiCommentaryMonitorV2,
  getLiveRecordingDriveAssetV2,
  forceUploadingRecordingToExportV2,
  getLiveRecordingMonitorV2,
  getLiveRecordingMonitorMetaV2,
  getLiveRecordingMonitorOverviewV2,
  getLiveRecordingMonitorExportQueueV2,
  getLiveRecordingMonitorRowV2,
  getLiveRecordingMonitorRowsV2,
  getLiveRecordingMonitorStorageV2,
  getLiveRecordingMonitorSummaryV2,
  getLiveRecordingMonitorTournamentsV2,
  getLiveRecordingWorkerHealthV2,
  heartbeatLiveRecordingV2,
  getLiveRecordingByMatchV2,
  moveLiveRecordingDriveAssetV2,
  playLiveRecordingAiCommentaryV2,
  playLiveRecordingV2,
  queueLiveRecordingAiCommentaryV2,
  renameLiveRecordingDriveAssetV2,
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
  trashLiveRecordingDriveAssetV2,
  trashLiveRecordingR2AssetsV2,
} from "../controllers/liveRecordingV2Controller.js";

const router = express.Router();

router.post("/start", protectLiveApp, startLiveRecordingV2);
router.post("/heartbeat", protectLiveApp, heartbeatLiveRecordingV2);
router.post(
  "/segments/presign-batch",
  protectLiveApp,
  presignLiveRecordingSegmentBatchV2
);
router.post("/segments/presign", protectLiveApp, presignLiveRecordingSegmentV2);
router.post("/live-manifest/presign", protectLiveApp, presignLiveRecordingManifestV2);
router.post("/segments/complete", protectLiveApp, completeLiveRecordingSegmentV2);
router.post(
  "/segments/multipart/start",
  protectLiveApp,
  startMultipartLiveRecordingSegmentV2
);
router.post(
  "/segments/multipart/part-url",
  protectLiveApp,
  presignMultipartLiveRecordingSegmentPartV2
);
router.post(
  "/segments/multipart/progress",
  protectLiveApp,
  reportMultipartLiveRecordingSegmentProgressV2
);
router.post(
  "/segments/multipart/complete",
  protectLiveApp,
  completeMultipartLiveRecordingSegmentV2
);
router.post(
  "/segments/multipart/abort",
  protectLiveApp,
  abortMultipartLiveRecordingSegmentV2
);
router.post("/finalize", protectLiveApp, finalizeLiveRecordingV2);
router.get(
  "/admin/monitor",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorV2
);
router.get(
  "/admin/monitor/overview",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorOverviewV2
);
router.get(
  "/admin/monitor/summary",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorSummaryV2
);
router.get(
  "/admin/monitor/meta",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorMetaV2
);
router.get(
  "/admin/monitor/tournaments",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorTournamentsV2
);
router.get(
  "/admin/monitor/storage",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorStorageV2
);
router.get(
  "/admin/monitor/export-queue",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorExportQueueV2
);
router.get(
  "/admin/monitor/rows",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorRowsV2
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
router.get(
  "/admin/:id/monitor-row",
  protect,
  authorize("admin"),
  getLiveRecordingMonitorRowV2
);
router.get(
  "/admin/:id/drive-asset",
  protect,
  authorize("admin"),
  getLiveRecordingDriveAssetV2
);
router.post(
  "/admin/:id/drive-asset/rename",
  protect,
  authorize("admin"),
  renameLiveRecordingDriveAssetV2
);
router.post(
  "/admin/:id/drive-asset/move",
  protect,
  authorize("admin"),
  moveLiveRecordingDriveAssetV2
);
router.post(
  "/admin/drive-asset/trash/bulk",
  protect,
  authorize("admin"),
  bulkTrashLiveRecordingDriveAssetV2
);
router.post(
  "/admin/:id/drive-asset/trash",
  protect,
  authorize("admin"),
  trashLiveRecordingDriveAssetV2
);
router.post(
  "/admin/:id/r2-clean",
  protect,
  authorize("admin"),
  trashLiveRecordingR2AssetsV2
);
router.post(
  "/admin/:id/source-r2-clean",
  protect,
  authorize("admin"),
  cleanLiveRecordingR2SourceV2
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
