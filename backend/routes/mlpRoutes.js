// routes/mlpRoutes.js — MLP tournament routes (Phase 1: teams CRUD).
import express from "express";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import {
  updateMlpConfig,
  createMlpTeam,
  listMlpTeams,
  getMlpTeam,
  updateMlpTeam,
  deleteMlpTeam,
  generateMlpDuals,
  generateMlpKnockout,
  listMlpDuals,
  getMlpDual,
  patchMlpDual,
  patchMlpSubMatch,
  assignSubMatchLineup,
  syncSubMatchResult,
  startDreamBreaker,
  scoreDreamBreakerPoint,
  undoDreamBreakerPoint,
  getMlpStandings,
  recomputeStandingsHandler,
  listMlpTournamentCourts,
  autoAssignMlpCourts,
  forceFinishMlpDual,
  deleteMlpDual,
  deleteMlpRound,
  checkInMlpDual,
  exportMlpStandingsCsv,
  exportMlpResultsCsv,
  exportMlpSummary,
} from "../controllers/mlpController.js";

const router = express.Router();

// Tournament-level MLP config
router.patch("/tournaments/:id/mlp-config", protect, updateMlpConfig);

// Teams
router.get("/tournaments/:tid/teams", optionalAuth, listMlpTeams);
router.post("/tournaments/:tid/teams", protect, createMlpTeam);
router.get("/teams/:id", optionalAuth, getMlpTeam);
router.patch("/teams/:id", protect, updateMlpTeam);
router.delete("/teams/:id", protect, deleteMlpTeam);

// Duals
router.get("/tournaments/:tid/duals", optionalAuth, listMlpDuals);
router.post("/tournaments/:tid/duals/generate", protect, generateMlpDuals);
router.get("/duals/:id", optionalAuth, getMlpDual);
router.patch("/duals/:id", protect, patchMlpDual);
router.patch("/duals/:id/subs/:subId", protect, patchMlpSubMatch);
router.patch("/duals/:id/subs/:subId/lineup", protect, assignSubMatchLineup);
router.post("/duals/:id/subs/:subId/score", protect, syncSubMatchResult);

router.delete("/duals/:id", protect, deleteMlpDual);
router.delete(
  "/tournaments/:tid/duals/round/:round",
  protect,
  deleteMlpRound,
);
router.post("/duals/:id/force-finish", protect, forceFinishMlpDual);
router.post("/duals/:id/check-in", protect, checkInMlpDual);

// Standings
router.get("/tournaments/:tid/standings", optionalAuth, getMlpStandings);
router.post(
  "/tournaments/:tid/standings/recompute",
  protect,
  recomputeStandingsHandler,
);

// Courts
router.get("/tournaments/:tid/courts", optionalAuth, listMlpTournamentCourts);
router.post(
  "/tournaments/:tid/duals/auto-assign-courts",
  protect,
  autoAssignMlpCourts,
);

// Knockout bracket từ BXH
router.post(
  "/tournaments/:tid/duals/generate-knockout",
  protect,
  generateMlpKnockout,
);

// Reports / export
router.get(
  "/tournaments/:tid/export/standings.csv",
  optionalAuth,
  exportMlpStandingsCsv,
);
router.get(
  "/tournaments/:tid/export/results.csv",
  optionalAuth,
  exportMlpResultsCsv,
);
router.get(
  "/tournaments/:tid/export/summary.json",
  optionalAuth,
  exportMlpSummary,
);

// DreamBreaker
router.post("/duals/:id/dreambreaker/start", protect, startDreamBreaker);
router.post("/duals/:id/dreambreaker/point", protect, scoreDreamBreakerPoint);
router.post("/duals/:id/dreambreaker/undo", protect, undoDreamBreakerPoint);

export default router;
