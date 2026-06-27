import express from "express";
import {
  adminPatchMatch,
  adminSwapMatchTeams,
  notifyStreamEnded,
  notifyStreamHeartbeat,
  notifyStreamStarted,
  setMatchLive,
  updateMatchSettings,
} from "../controllers/matchController.js";
import {
  authorize,
  isManagerTournament,
  protect,
  protectLiveApp,
} from "../middleware/authMiddleware.js";
import { createFacebookLiveForMatch } from "../controllers/adminMatchLiveController.js";

const router = express.Router();

router.patch("/:id/live", protect, isManagerTournament, setMatchLive);

router.patch("/:id/admin", protect, isManagerTournament, adminPatchMatch);
router.post("/:id/admin/swap-teams", protect, isManagerTournament, adminSwapMatchTeams);

router.post("/:matchId/live/facebook", createFacebookLiveForMatch);
router.post("/:matchId/live/create", createFacebookLiveForMatch);

router.post("/:id/live/start", protectLiveApp, notifyStreamStarted);
router.post("/:id/live/heartbeat", protectLiveApp, notifyStreamHeartbeat);
router.post("/:id/live/end", protectLiveApp, notifyStreamEnded);

router.patch('/:matchId/update', updateMatchSettings);

export default router;
