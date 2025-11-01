import { Router } from "express";
import { protect, refereeOnly } from "../middleware/authMiddleware.js";
import canScoreMatch, { ownOrAdmin } from "../middleware/canScoreMatch.js";
import {
  assignCourtToMatch,
  getAssignedMatches,
  listCourtsByTournamentBracket,
  listCourtsForMatch,
  listRefereeBrackets,
  listRefereeMatchesByTournament,
  listRefereeTournaments,
  patchCourtStatus,
  patchScore,
  patchStatus,
  patchWinner,
  refereeSetBreak,
  unassignCourtFromMatch,
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
router.patch(
  "/matches/:id/winner",
  protect,
  refereeOnly,
  ownOrAdmin,
  patchWinner
);

// GET /referee/tournaments
router.get("/tournaments", protect, refereeOnly, listRefereeTournaments);

// GET /referee/tournaments/:tid/brackets
router.get(
  "/tournaments/:tid/brackets",
  protect,
  refereeOnly,
  listRefereeBrackets
);

// GET /referee/tournaments/:tid/matches
router.get(
  "/tournaments/:tid/matches",
  protect,
  refereeOnly,
  listRefereeMatchesByTournament
);

// Courts theo bracket (chuẩn hoá "mỗi bracket có sân")
router.get(
  "/tournaments/:tId/brackets/:bId/courts",
  protect,
  refereeOnly,
  listCourtsByTournamentBracket
);

// Courts hợp lệ cho 1 match (cùng tournament+bracket)
router.get(
  "/matches/:matchId/courts",
  protect,
  refereeOnly,
  listCourtsForMatch
);

// Gán / bỏ gán sân cho match
router.post(
  "/matches/:matchId/assign-court",
  protect,
  refereeOnly,
  assignCourtToMatch
);
router.post(
  "/matches/:matchId/unassign-court",
  protect,
  refereeOnly,
  unassignCourtFromMatch
);

// Cập nhật trạng thái sân (maintenance, …)
router.patch("/courts/:courtId/status", protect, refereeOnly, patchCourtStatus);

router.put("/matches/:id/break", protect, refereeSetBreak);

export default router;
