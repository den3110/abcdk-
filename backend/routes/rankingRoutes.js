import express from "express";
import { getRankings } from "../controllers/rankingController.js";
import { passProtect } from "../middleware/authMiddleware.js";
import { verifyRankingToken } from "../middleware/verifyRankingToken.js";
import { requireAppSession } from "../middleware/requireAppSession.js";
const router = express.Router();

router.get(
  "/list",
  requireAppSession,
  verifyRankingToken,
  passProtect,
  getRankings
);

router.get(
  "/",
  passProtect,
  getRankings
);


export default router;
