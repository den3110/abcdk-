// routes/publicOverlayRoutes.js
import express from "express";
import { getOverlayConfig } from "../controllers/publicOverlayController.js";
import { getGuideLink } from "../controllers/systemSettings.controller.js";

const router = express.Router();

// /api/public/overlay/config
router.get("/overlay/config", getOverlayConfig);
router.get("/guide-link", getGuideLink)

export default router;
