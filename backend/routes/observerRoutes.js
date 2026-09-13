import express from "express";
import {
  getObserverSummary,
  ingestObserverBackupSnapshot,
  ingestObserverEvents,
  ingestObserverRuntimeSnapshot,
  listObserverBackupSnapshots,
  listObserverEvents,
  listObserverRuntimeSnapshots,
} from "../controllers/observerController.js";
import {
  ingestLiveDeviceHeartbeat,
  ingestLiveDeviceEvent,
  ingestLiveDeviceEvents,
  listLiveDevices,
  listLiveDeviceEvents,
} from "../controllers/liveDeviceObserverController.js";
import {
  requireObserverApiKey,
  requireObserverReadKey,
} from "../middleware/observerAuth.js";
import { protectLiveApp } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/ingest/events", requireObserverApiKey, ingestObserverEvents);
router.post("/ingest/runtime", requireObserverApiKey, ingestObserverRuntimeSnapshot);
router.post("/ingest/backups", requireObserverApiKey, ingestObserverBackupSnapshot);

// Telemetry máy live: app iOS/Android gửi kèm Bearer session token (protectLiveApp).
router.post("/ingest/live-devices/heartbeat", protectLiveApp, ingestLiveDeviceHeartbeat);
router.post("/ingest/live-devices/event", protectLiveApp, ingestLiveDeviceEvent);
router.post("/ingest/live-devices/events", protectLiveApp, ingestLiveDeviceEvents);

router.get("/read/summary", requireObserverReadKey, getObserverSummary);
router.get("/read/events", requireObserverReadKey, listObserverEvents);
router.get("/read/runtime", requireObserverReadKey, listObserverRuntimeSnapshots);
router.get("/read/backups", requireObserverReadKey, listObserverBackupSnapshots);

// Dashboard đọc trạng thái máy live (đọc bằng observer read-key).
router.get("/read/live-devices", requireObserverReadKey, listLiveDevices);
router.get("/read/live-devices/events", requireObserverReadKey, listLiveDeviceEvents);

export default router;
