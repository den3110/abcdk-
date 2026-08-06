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
  listMlpDuals,
  getMlpDual,
  assignSubMatchLineup,
  syncSubMatchResult,
  startDreamBreaker,
  scoreDreamBreakerPoint,
  undoDreamBreakerPoint,
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
router.patch("/duals/:id/subs/:subId/lineup", protect, assignSubMatchLineup);
router.post("/duals/:id/subs/:subId/score", protect, syncSubMatchResult);

// DreamBreaker
router.post("/duals/:id/dreambreaker/start", protect, startDreamBreaker);
router.post("/duals/:id/dreambreaker/point", protect, scoreDreamBreakerPoint);
router.post("/duals/:id/dreambreaker/undo", protect, undoDreamBreakerPoint);

export default router;
