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

export default router;
