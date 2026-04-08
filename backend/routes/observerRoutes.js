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
  requireObserverApiKey,
  requireObserverReadKey,
} from "../middleware/observerAuth.js";

const router = express.Router();

router.post("/ingest/events", requireObserverApiKey, ingestObserverEvents);
router.post("/ingest/runtime", requireObserverApiKey, ingestObserverRuntimeSnapshot);
router.post("/ingest/backups", requireObserverApiKey, ingestObserverBackupSnapshot);

router.get("/read/summary", requireObserverReadKey, getObserverSummary);
router.get("/read/events", requireObserverReadKey, listObserverEvents);
router.get("/read/runtime", requireObserverReadKey, listObserverRuntimeSnapshots);
router.get("/read/backups", requireObserverReadKey, listObserverBackupSnapshots);

export default router;
