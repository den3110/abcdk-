// src/routes/notifyRoutes.js
import { Router } from "express";
import {
    notifyGlobalBroadcast,
  notifyMatchStartSoon,
  notifyTournamentCreated,
  notifyTournamentScheduleUpdated,
} from "../controllers/notifyController.js";
import {
  protect,
  authorize,
  isManagerTournament,
} from "../middleware/authMiddleware.js";

const router = Router();

/**
 * POST /api/events/match/:matchId/start-soon
 * - Chỉ owner/manager của giải chứa match (hoặc admin) mới được phép
 * - Quyền check bằng middleware isManagerTournament (dựa trên :matchId)
 */
router.post(
  "/match/:matchId/start-soon",
  protect,
  isManagerTournament,
  notifyMatchStartSoon
);

/**
 * POST /api/events/tournament-created
 * - Chỉ admin
 * - Body: { tournamentId, orgId? }
 */
router.post(
  "/tournament-created",
  protect,
  authorize("admin"),
  notifyTournamentCreated
);

/**
 * POST /api/events/tournament/:tournamentId/schedule-updated
 * - Yêu cầu đăng nhập; quyền owner/manager/admin được kiểm tra trong controller
 */
router.post(
  "/tournament/:tournamentId/schedule-updated",
  protect,
  notifyTournamentScheduleUpdated
);

router.post("/global/broadcast", protect, authorize("admin"), notifyGlobalBroadcast);

export default router;
