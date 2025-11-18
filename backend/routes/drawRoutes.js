// routes/drawRoutes.js
import express from "express";
import {
  startDraw,
  drawNext,
  drawCommit,
  drawCancel,
  getDrawSession,
  getDrawStatusByBracket,
  generateGroupMatches,
  assignByes,
  updatePoPreplan,
  previewPoPreplan,
} from "../controllers/drawController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { canManageTournament, requireTournamentManager } from "../utils/tournamentAuth.js";
import { attachTournamentFromBracket } from "../utils/attachTournamentFromBracket.js";
import { attachBracketIdFromDraw } from "../middleware/drawMiddleware.js";

const router = express.Router();

// Tất cả endpoint đều yêu cầu admin
router.post("/:bracketId/start", protect, attachTournamentFromBracket, requireTournamentManager, startDraw);
router.post("/brackets/:bracketId/byes/assign", protect, attachTournamentFromBracket, requireTournamentManager, assignByes);
router.get("/brackets/:bracketId/draw/status", protect, attachTournamentFromBracket, requireTournamentManager, getDrawStatusByBracket);
router.post("/brackets/:bracketId/group/generate-matches", protect, attachTournamentFromBracket, requireTournamentManager, generateGroupMatches);
router.post("/:drawId/next", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, drawNext);
router.post("/:drawId/commit", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, drawCommit);
router.post("/:drawId/cancel", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, drawCancel);
router.get("/:drawId", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, getDrawSession);

router.post("/sessions/:drawId/po/preplan", protect,  authorize("admin"), updatePoPreplan);
router.get("/sessions/:drawId/po/preplan/preview", protect,  authorize("admin"), previewPoPreplan);

export default router;
