import express from "express";
import {
  createLiveSessionForLiveApp,
  getCourtRuntimeForLiveApp,
  getMatchRuntimeForLiveApp,
} from "../controllers/liveAppController.js";
import { protect } from "../middleware/authMiddleware.js";
import { getLiveAppBootstrap } from "../controllers/liveAppAuthController.js";
import {
  endCourtPresenceController,
  extendCourtPreviewPresenceController,
  heartbeatCourtPresenceController,
  startCourtPresence,
} from "../controllers/courtLivePresenceController.js";
import {
  getLiveAppCourtStationCurrentMatch,
  listLiveAppCourtClusters,
  listLiveAppCourtStations,
} from "../controllers/liveAppClusterController.js";

const router = express.Router();

router.post("/matches/:matchId/live/create", createLiveSessionForLiveApp);
router.get("/bootstrap", protect, getLiveAppBootstrap);
router.get("/clusters", protect, listLiveAppCourtClusters);
router.get("/clusters/:clusterId/courts", protect, listLiveAppCourtStations);
router.get(
  "/court-stations/:courtStationId/current-match",
  protect,
  getLiveAppCourtStationCurrentMatch
);
router.get("/courts/:courtId/runtime", protect, getCourtRuntimeForLiveApp);
router.get("/matches/:matchId/runtime", protect, getMatchRuntimeForLiveApp);
router.post("/courts/:courtId/presence/start", protect, startCourtPresence);
router.post("/courts/:courtId/presence/heartbeat", protect, heartbeatCourtPresenceController);
router.post("/courts/:courtId/presence/end", protect, endCourtPresenceController);
router.post(
  "/courts/:courtId/presence/extend-preview",
  protect,
  extendCourtPreviewPresenceController
);

export default router;
