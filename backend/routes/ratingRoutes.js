// routes/ratingRoutes.js
import express from "express";
import {
  applyMatchRating,
  recomputeTournament,
  recomputeUser,
  getUserRating,
} from "../controllers/ratingController.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/apply/:matchId", protect, authorize("admin"), applyMatchRating);
router.post(
  "/recompute/tournament/:tournamentId",
  protect,
  authorize("admin"),
  recomputeTournament
);
router.post(
  "/recompute/user/:userId",
  protect,
  authorize("admin"),
  recomputeUser
);
router.get("/user/:userId", protect, getUserRating);

export default router;
