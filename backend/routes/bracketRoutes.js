import express from "express";
import { getBracket } from "../controllers/bracketController.js";
import {
  restoreBracketRating,
  revokeBracketRating,
} from "../controllers/ratingController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/:bracketId", getBracket)

// SUPER ADMIN: thu hồi điểm cộng/trừ của cả bracket (check quyền trong controller)
router.post("/:bracketId/revoke-rating", protect, revokeBracketRating);
router.post("/:bracketId/restore-rating", protect, restoreBracketRating);

export default router;
