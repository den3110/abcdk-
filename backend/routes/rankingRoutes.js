import express from "express";
import {
  getPodium30d,
  getRankingOnly,
  getRankings,
  getRankingsV2,
  getRankingOnlyV2,
} from "../controllers/rankingController.js";
import { passProtect } from "../middleware/authMiddleware.js";
import { verifyRankingToken } from "../middleware/verifyRankingToken.js";
import { requireAppSession } from "../middleware/requireAppSession.js";
const router = express.Router();

router.get(
  "/list",
  requireAppSession,
  verifyRankingToken,
  passProtect,
  getRankings,
);

router.get(
  "/",
  //   requireAppSession,
  //   verifyRankingToken,
  passProtect,
  getRankings,
);

router.get("/rankings", passProtect, getRankingOnly);
router.get("/podium30d", passProtect, getPodium30d);

// V2 Optimized APIs (uses denormalized fields)
router.get("/v2", passProtect, getRankingsV2);
router.get("/rankings/v2", passProtect, getRankingOnlyV2);

export default router;
