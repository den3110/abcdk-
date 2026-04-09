// routes/live.routes.js
import { Router } from "express";
import {
  deleteLiveVideoForMatch,
  listLiveMatches,
} from "../controllers/liveMatchesController.js";
import {
  getPublicLiveFeed,
  searchPublicLiveFeed,
} from "../controllers/liveFeedController.js";
import {
  getPublicLiveClusterById,
  getPublicLiveCourtById,
  listPublicLiveClusters,
} from "../controllers/liveClusterController.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = Router();

// GET /api/live/matches
// Query:
//   - windowMs (ms, default 8h)
//   - excludeFinished (true|false, default true)
//   - statuses (CSV: "scheduled,queued,assigned,live")
//   - concurrency (number, default 4)
router.get("/matches", listLiveMatches);
router.get("/feed/search", searchPublicLiveFeed);
router.get("/feed", getPublicLiveFeed);
router.get("/clusters", listPublicLiveClusters);
router.get("/clusters/:clusterId", getPublicLiveClusterById);
router.get("/courts/:courtStationId", getPublicLiveCourtById);
router.delete(
  "/matches/:matchId/video",
  protect,
  authorize("admin"),
  deleteLiveVideoForMatch
);


export default router;
