// routes/drawRoutes.js
import express from "express";
import {
  startDraw,
  drawNext,
  drawCommit,
  drawCancel,
  resetGroupBracket,
  getDrawSession,
  getDrawStatusByBracket,
  generateGroupMatches,
  addPairToGroup,
  movePairBetweenGroups,
  assignByes,
  takeoverTournamentDraw,
  stopTournamentDraw,
  updatePoPreplan,
  previewPoPreplan,
} from "../controllers/drawController.js";
import { protect, authorize, requireSuperAdmin } from "../middleware/authMiddleware.js";
import { canManageTournament, requireTournamentManager } from "../utils/tournamentAuth.js";
import { attachTournamentFromBracket } from "../utils/attachTournamentFromBracket.js";
import { attachBracketIdFromDraw } from "../middleware/drawMiddleware.js";

const router = express.Router();

// Tất cả endpoint đều yêu cầu admin
router.post("/:bracketId/start", protect, attachTournamentFromBracket, requireTournamentManager, startDraw);
router.post("/brackets/:bracketId/byes/assign", protect, attachTournamentFromBracket, requireTournamentManager, assignByes);
router.get("/brackets/:bracketId/draw/status", protect, attachTournamentFromBracket, requireTournamentManager, getDrawStatusByBracket);
router.post("/brackets/:bracketId/group/generate-matches", protect, attachTournamentFromBracket, requireTournamentManager, generateGroupMatches);
router.post("/brackets/:bracketId/groups/:groupId/add-pair", protect, attachTournamentFromBracket, requireTournamentManager, addPairToGroup);
router.post("/brackets/:bracketId/move-pair", protect, attachTournamentFromBracket, requireTournamentManager, movePairBetweenGroups);
router.post("/:drawId/next", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, drawNext);
router.post("/:drawId/commit", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, drawCommit);
router.post("/:drawId/cancel", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, drawCancel);
router.post("/brackets/:bracketId/group/reset", protect, attachTournamentFromBracket, requireTournamentManager, resetGroupBracket);
router.get("/:drawId", protect, attachBracketIdFromDraw, attachTournamentFromBracket, requireTournamentManager, getDrawSession);

router.post("/sessions/:drawId/po/preplan", protect, authorize("admin"), requireSuperAdmin, updatePoPreplan);
router.get("/sessions/:drawId/po/preplan/preview", protect, authorize("admin"), requireSuperAdmin, previewPoPreplan);
router.post(
  "/tournaments/:tournamentId/takeover",
  protect,
  authorize("admin"),
  requireSuperAdmin,
  takeoverTournamentDraw
);
router.post(
  "/tournaments/:tournamentId/stop",
  protect,
  authorize("admin"),
  requireSuperAdmin,
  stopTournamentDraw
);

export default router;

