// src/routes/overlayRoutes.js
import express from "express";
import {
  getNextMatchByCourt,
  getOverlayMatch,
} from "../controllers/overlayController.js";
import { getOverlayCurrentMatchByMatchId } from "../controllers/overlayCurrentMatchController.js";
import {
  cloneOverlayTemplate,
  listOverlayTemplateLibrary,
  listOverlayTemplates,
  publishOverlayTemplate,
  resolveOverlayTemplate,
  updateOverlayTemplate,
} from "../controllers/overlayTemplateController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/overlay/match/:id
router.get("/templates/library", listOverlayTemplateLibrary);
router.get("/templates/resolve", resolveOverlayTemplate);
router.get("/templates", protect, listOverlayTemplates);
router.post("/templates/clone", protect, cloneOverlayTemplate);
router.patch("/templates/:id", protect, updateOverlayTemplate);
router.post("/templates/:id/publish", protect, publishOverlayTemplate);
router.get("/match/:id", getOverlayMatch);
router.get("/match/:id/current", getOverlayCurrentMatchByMatchId);
router.get("/courts/:courtId/next", getNextMatchByCourt);

export default router;
