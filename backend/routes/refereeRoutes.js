import { Router } from "express";
import { protect, refereeOnly } from "../middleware/authMiddleware.js";
import canScoreMatch from "../middleware/canScoreMatch.js";
import {
    getAssignedMatches,
  patchScore,
  patchStatus,
  patchWinner,
} from "../controllers/refereeController.js";

const router = Router();

// GET
router.get("/matches/assigned-to-me", protect, refereeOnly, getAssignedMatches);

// PATCH
router.patch("/matches/:id/score", protect, refereeOnly, canScoreMatch, patchScore);
router.patch("/matches/:id/status", protect, refereeOnly, canScoreMatch, patchStatus);
router.patch("/matches/:id/winner", protect, refereeOnly, canScoreMatch, patchWinner);


export default router;
