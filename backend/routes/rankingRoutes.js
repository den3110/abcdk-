import express from "express";
import { getPodium30d, getRankingOnly, getRankings } from "../controllers/rankingController.js";
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
//   requireAppSession,
//   verifyRankingToken,
  passProtect,
  getRankings
);

router.get("/rankings", passProtect, getRankingOnly)
router.get("/podium30d", passProtect, getPodium30d)

export default router;
