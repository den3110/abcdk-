import express from "express";
import {
  createLiveSessionForLiveApp,
  getCourtRuntimeForLiveApp,
  getMatchRuntimeForLiveApp,
} from "../controllers/liveAppController.js";
import { protectLiveApp } from "../middleware/authMiddleware.js";
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
  listLiveAppTournamentCourtStations,
} from "../controllers/liveAppClusterController.js";

const router = express.Router();

router.post("/matches/:matchId/live/create", protectLiveApp, createLiveSessionForLiveApp);
router.get("/bootstrap", protectLiveApp, getLiveAppBootstrap);
router.get("/clusters", protectLiveApp, listLiveAppCourtClusters);
router.get("/clusters/:clusterId/courts", protectLiveApp, listLiveAppCourtStations);
router.get("/tournaments/:tournamentId/courts", protectLiveApp, listLiveAppTournamentCourtStations);
router.get(
  "/court-stations/:courtStationId/current-match",
  protectLiveApp,
  getLiveAppCourtStationCurrentMatch
);
router.get("/courts/:courtId/runtime", protectLiveApp, getCourtRuntimeForLiveApp);
router.get("/matches/:matchId/runtime", protectLiveApp, getMatchRuntimeForLiveApp);
router.post("/courts/:courtId/presence/start", protectLiveApp, startCourtPresence);
router.post("/courts/:courtId/presence/heartbeat", protectLiveApp, heartbeatCourtPresenceController);
router.post("/courts/:courtId/presence/end", protectLiveApp, endCourtPresenceController);
router.post(
  "/courts/:courtId/presence/extend-preview",
  protectLiveApp,
  extendCourtPreviewPresenceController
);

export default router;
