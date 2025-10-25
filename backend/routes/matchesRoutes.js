import express from "express";
import {
  adminPatchMatch,
  notifyStreamEnded,
  notifyStreamStarted,
  setMatchLive,
} from "../controllers/matchController.js";
import {
  authorize,
  isManagerTournament,
  protect,
} from "../middleware/authMiddleware.js";
import { createFacebookLiveForMatch } from "../controllers/adminMatchLiveController.js";

const router = express.Router();

router.patch("/:id/live", protect, isManagerTournament, setMatchLive);

router.patch("/:id/admin", protect, isManagerTournament, adminPatchMatch);

router.post("/:matchId/live/facebook", createFacebookLiveForMatch);
router.post("/:matchId/live/create", createFacebookLiveForMatch);

router.post("/:id/live/start", protect, notifyStreamStarted);
router.post("/:id/live/end", protect, notifyStreamEnded);

export default router;
