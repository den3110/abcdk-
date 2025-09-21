import express from "express";
import {
  adminPatchMatch,
  setMatchLive,
} from "../controllers/matchController.js";
import {
  authorize,
  isManagerTournament,
  protect,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.patch("/:id/live", protect, isManagerTournament, setMatchLive);

router.patch("/:id/admin", protect, authorize("admin"), adminPatchMatch);

export default router;
