// routes/live.routes.js
import { Router } from "express";
import { listLiveMatches } from "../controllers/liveMatchesController.js";

const router = Router();

// GET /api/live/matches
// Query:
//   - windowMs (ms, default 8h)
//   - excludeFinished (true|false, default true)
//   - statuses (CSV: "scheduled,queued,assigned,live")
//   - concurrency (number, default 4)
router.get("/matches", listLiveMatches);

export default router;
