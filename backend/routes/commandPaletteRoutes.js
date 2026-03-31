import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import { assistCommandPaletteIntent } from "../controllers/commandPaletteController.js";

const router = express.Router();

router.post("/assist", protect, assistCommandPaletteIntent);

export default router;
