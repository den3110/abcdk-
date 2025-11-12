// routes/leaderboardRoutes.js
import express from "express";
import { getFeaturedLeaderboard } from "../controllers/leaderboardController.js";
import { passProtect } from "../middleware/authMiddleware.js";
// import { protectOptional } from "../middleware/authMiddleware.js"; // nếu muốn

const router = express.Router();

router.get("/", /*protectOptional,*/ passProtect, getFeaturedLeaderboard);

export default router;
