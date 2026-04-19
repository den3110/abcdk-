// src/routes/overlayRoutes.js
import express from "express";
import {
  getNextMatchByCourt,
  getOverlayMatch,
} from "../controllers/overlayController.js";
import { getOverlayCurrentMatchByMatchId } from "../controllers/overlayCurrentMatchController.js";

const router = express.Router();

// GET /api/overlay/match/:id
router.get("/match/:id", getOverlayMatch);
router.get("/match/:id/current", getOverlayCurrentMatchByMatchId);
router.get("/courts/:courtId/next", getNextMatchByCourt);

export default router;
