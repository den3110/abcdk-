// routes/progressionRoutes.js
// =============================
import express from "express";
import {
  listTournamentStages,
  listSourcesForTarget,
  previewAdvancement,
  commitAdvancement,
  prefillAdvancement,
} from "../controllers/progressionController.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// (1) List all brackets of a tournament (ordered)
router.get(
  "/tournaments/:tid/stages",
  protect,
  authorize("admin"),
  listTournamentStages
);

// (2) For a target bracket, list valid sources (previous stages in same tournament)
router.get(
  "/brackets/:bid/advancement/sources",
  protect,
  authorize("admin"),
  listSourcesForTarget
);

// (3) Preview who will advance from a source bracket to a target bracket
router.post(
  "/brackets/:targetId/advancement/preview",
  protect,
  authorize("admin"),
  previewAdvancement
);

// (3b) Prefill a DrawSession for the target bracket from a previous stage
router.post(
  "/brackets/:targetId/advancement/prefill-draw",
  protect,
  authorize("admin"),
  prefillAdvancement
);

// (4) Commit: create Round 1 matches for the target bracket using the qualifiers
router.post(
  "/brackets/:targetId/advancement/commit",
  protect,
  authorize("admin"),
  commitAdvancement
);

export default router;
