// routes/publicOverlayRoutes.js
import express from "express";
import { getOverlayConfig } from "../controllers/publicOverlayController.js";

const router = express.Router();

// /api/public/overlay/config
router.get("/overlay/config", getOverlayConfig);

export default router;
