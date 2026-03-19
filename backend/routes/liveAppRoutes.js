import express from "express";
import { createLiveSessionForLiveApp } from "../controllers/liveAppController.js";
import { protect } from "../middleware/authMiddleware.js";
import { getLiveAppBootstrap } from "../controllers/liveAppAuthController.js";
import {
  endCourtPresenceController,
  extendCourtPreviewPresenceController,
  heartbeatCourtPresenceController,
  startCourtPresence,
} from "../controllers/courtLivePresenceController.js";

const router = express.Router();

router.post("/matches/:matchId/live/create", createLiveSessionForLiveApp);
router.get("/bootstrap", protect, getLiveAppBootstrap);
router.post("/courts/:courtId/presence/start", protect, startCourtPresence);
router.post("/courts/:courtId/presence/heartbeat", protect, heartbeatCourtPresenceController);
router.post("/courts/:courtId/presence/end", protect, endCourtPresenceController);
router.post(
  "/courts/:courtId/presence/extend-preview",
  protect,
  extendCourtPreviewPresenceController
);

export default router;
