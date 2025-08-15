import express from "express";
import {
  getDrawSchema,
  getGlobalDrawSettings,
  updateGlobalDrawSettings,
  getTournamentDrawSettings,
  updateTournamentDrawSettings,
  getBracketDrawSettings,
  updateBracketDrawSettings,
  getEffectiveDrawSettings,
  previewPlan,
} from "../controllers/drawSettingsController.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// schema metadata (labels + help)
router.get("/draw/settings/schema", protect, authorize("admin"), getDrawSchema);

// Global
router.get(
  "/draw/settings",
  protect,
  authorize("admin"),
  getGlobalDrawSettings
);
router.put(
  "/draw/settings",
  protect,
  authorize("admin"),
  updateGlobalDrawSettings
);

// Tournament
router.get(
  "/tournaments/:tournamentId/draw/settings",
  protect,
  authorize("admin"),
  getTournamentDrawSettings
);
router.put(
  "/tournaments/:tournamentId/draw/settings",
  protect,
  authorize("admin"),
  updateTournamentDrawSettings
);

// Bracket
router.get(
  "/brackets/:bracketId/draw/settings",
  protect,
  authorize("admin"),
  getBracketDrawSettings
);
router.put(
  "/brackets/:bracketId/draw/settings",
  protect,
  authorize("admin"),
  updateBracketDrawSettings
);

// Effective + Preview
router.get(
  "/draw/settings/effective",
  protect,
  authorize("admin"),
  getEffectiveDrawSettings
);
router.post("/draw/settings/preview", protect, authorize("admin"), previewPlan);

export default router;
