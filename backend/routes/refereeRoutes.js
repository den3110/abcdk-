import { Router } from "express";
import { protect, refereeOnly } from "../middleware/authMiddleware.js";
import canScoreMatch, { ownOrAdmin } from "../middleware/canScoreMatch.js";
import {
  getAssignedMatches,
  listRefereeBrackets,
  listRefereeMatchesByTournament,
  listRefereeTournaments,
  patchScore,
  patchStatus,
  patchWinner,
} from "../controllers/refereeController.js";

const router = Router();

// GET
router.get("/matches/assigned-to-me", protect, refereeOnly, getAssignedMatches);

// PATCH
router.patch(
  "/matches/:id/score",
  protect,
  refereeOnly,
  canScoreMatch,
  patchScore
);
router.patch(
  "/matches/:id/status",
  protect,
  refereeOnly,
  canScoreMatch,
  patchStatus
);
router.patch("/matches/:id/winner", protect, refereeOnly, ownOrAdmin, patchWinner);


// GET /referee/tournaments
router.get("/tournaments", protect, refereeOnly, listRefereeTournaments);

// GET /referee/tournaments/:tid/brackets
router.get("/tournaments/:tid/brackets", protect, refereeOnly, listRefereeBrackets);

// GET /referee/tournaments/:tid/matches
router.get("/tournaments/:tid/matches", protect, refereeOnly, listRefereeMatchesByTournament);

export default router;
