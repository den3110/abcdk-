// routes/adminRoutes.js
import express from "express";
import {
  getUsers,
  updateUserRole,
  deleteUser,
  reviewUserKyc,
  updateUserInfo,
} from "../controllers/admin/adminController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { adminLogin } from "../controllers/admin/adminAuthController.js";
import {
  adminUpdateRanking,
  getUsersWithRank,
} from "../controllers/rankingController.js";
import {
  createScoreHistory,
  listScoreHistory,
} from "../controllers/scoreHistoryController.js";
import {
  adminCreateTournament,
  adminUpdateTournament,
  deleteTournament,
  finishExpiredTournaments,
  finishTournament,
  getTournamentById,
  getTournaments,
  planAuto,
  planCommit,
  updateTournamentOverlay,
} from "../controllers/admin/adminTournamentController.js";
import {
  adminCheckin,
  adminDeleteRegistration,
  adminUpdatePayment,
  getRegistrationsAdmin,
} from "../controllers/admin/adminRegistrationController.js";
import {
  adminCreateBracket,
  adminUpdateBracket,
  deleteBracketCascade,
  getBracketsWithMatches,
  getTournamentBracketsStructure,
} from "../controllers/admin/bracketController.js";
import {
  adminAssignReferee,
  adminCreateMatch,
  adminDeleteMatch,
  adminGetAllMatches,
  adminGetAllMatchesPagination,
  adminGetMatchById,
  adminListMatchGroups,
  adminUpdateMatch,
  getMatchesByBracket,
  refereeUpdateScore,
} from "../controllers/admin/matchController.js";
import { softResetChainFrom } from "../services/matchChainReset.js";
import { finalizeExpiredTournaments } from "../services/tournamentLifecycle.js";
import {
  adminChangeUserPassword,
  createAutoUsers,
  previewAutoUsers,
} from "../controllers/admin/adminUserController.js";
import {
  getDashboardMetrics,
  getDashboardSeries,
} from "../controllers/admin/adminDashboardController.js";
import {
  batchAssignReferee,
  batchDeleteMatches,
  buildRoundElimSkeleton,
  clearBracketMatches,
} from "../controllers/matchBatchController.js";
import { autoGenerateRegistrations } from "../controllers/registrationAutoController.js";
import {
  getMatchAdmin,
  getMatchLogs,
  getMatchRatingChanges,
  previewRatingDelta,
  resetMatchScores,
} from "../controllers/admin/adminMatchController.js";
import {
  assignNextHttp,
  assignSpecificHttp,
  buildGroupsQueueHttp,
  freeCourtHttp,
  getSchedulerState,
  resetCourtsHttp,
  upsertCourts,
} from "../controllers/admin/adminCourtController.js";
import {
  feedStageToNext,
  reapplyPropagation,
  reapplySeedsForBracket,
} from "../controllers/tool/seedToolsController.js";
import {
  demoteEvaluator,
  listEvaluators,
  promoteToEvaluator,
  updateEvaluatorScopes,
} from "../controllers/admin/adminEvaluatorController.js";
import { bulkAssignSlotPlan, generateGroupMatchesForTeam, getAdminBracketById, insertRegIntoGroupSlot } from "../controllers/admin/adminBracketController.js";
// import { assignNextController, buildBracketQueueController, toggleAutoAssignController, upsertCourtsForBracket } from "../controllers/admin/adminCourtController.js";
// import { assignNextToCourtCtrl, buildGroupsQueue, freeCourtCtrl, upsertCourts } from "../controllers/admin/adminCourtController.js";

const router = express.Router();

router.post("/login", adminLogin);

router.get(
  "/matches/:id([0-9a-fA-F]{24})",
  protect,
  authorize("admin", "referee"),
  adminGetMatchById
);

router.use(protect, authorize("admin")); // tất cả dưới đây cần admin

// router.get("/users", getUsers);
router.get("/users", getUsersWithRank);
router.put("/users/:id/role", updateUserRole);
router.delete("/users/:id", deleteUser);
router.put("/users/:id", updateUserInfo);
router.put("/users/:id/kyc", reviewUserKyc); // approve / reject

router.put("/rankings/:id", adminUpdateRanking);

router.get("/score-history", listScoreHistory); // ?user=&page=
router.post("/score-history", createScoreHistory); // body { userId, ... }

router
  .route("/tournaments/:id")
  // .all(validateObjectId)           // (nếu dùng)
  .get(getTournamentById) // GET    /api/admin/tournaments/:id
  .put(adminUpdateTournament) // PUT    /api/admin/tournaments/:id
  .delete(deleteTournament); // DELETE /api/admin/tournaments/:id

router
  .route("/tournaments")
  .get(getTournaments) // GET  /api/admin/tournaments
  .post(adminCreateTournament); // POST /api/admin/tournaments

router
  .route("/tournaments/registrations/:regId/payment")
  .put(adminUpdatePayment);

router.route("/tournaments/registrations/:regId/checkin").put(adminCheckin);

router
  .route("/tournaments/registrations/:regId")
  .delete(adminDeleteRegistration);

// create bracket for a tournament
router.post(
  "/tournaments/:id/brackets",
  protect,
  authorize("admin"),
  adminCreateBracket
);

// get lists of bracket của tournament
router.get(
  "/tournaments/:id/brackets",
  protect,
  authorize("admin", "referee", "user"),
  getBracketsWithMatches
);

// get lists of bracket của tournament
router.get(
  "/tournaments/:id/brackets/structure",
  protect,
  authorize("admin", "referee", "user"),
  getTournamentBracketsStructure
);

router.get(
  "/tournaments/:id/registrations",
  protect,
  authorize("admin"),
  getRegistrationsAdmin
);

// Admin: list all matches
router.get(
  "/matches",
  protect,
  authorize("admin"),
  adminGetAllMatchesPagination
);
router.get("/matches/all", protect, authorize("admin"), adminGetAllMatches);

router.get(
  "/matches/groups",
  protect,
  authorize("admin"),
  adminListMatchGroups
);

router.post(
  "/brackets/:bracketId/matches",
  protect,
  authorize("admin"),
  adminCreateMatch
);
router.get(
  "/brackets/:bracketId/matches",
  protect,
  authorize("admin", "referee", "user"),
  getMatchesByBracket
);

router.post(
  "/brackets/:bid/slot-plan/bulk-assign",
  protect, authorize("admin"),
  bulkAssignSlotPlan
);


router.patch(
  "/matches/:matchId/score",
  protect,
  authorize("admin", "referee"),
  refereeUpdateScore
);
router.patch(
  "/matches/:matchId/referee",
  protect,
  authorize("admin"),
  adminAssignReferee
);

router.delete(
  "/tournaments/:tourId/brackets/:bracketId",
  protect,
  authorize("admin"),
  deleteBracketCascade
);

router.delete(
  "/matches/:matchId",
  protect,
  authorize("admin"),
  adminDeleteMatch
);
router.patch(
  "/tournaments/:tournamentId/brackets/:bracketId",
  protect,
  authorize("admin"),
  adminUpdateBracket
);

router.patch("/matches/:matchId", protect, adminUpdateMatch);

router.post(
  "/matches/:matchId/reset-chain",
  /*protect, admin,*/ async (req, res, next) => {
    try {
      await softResetChainFrom(req.params.matchId);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/tournaments/finish-expired",
  protect,
  authorize("admin"),
  finishExpiredTournaments
);
router.put(
  "/tournament/:id/finish",
  protect,
  authorize("admin"),
  finishTournament
);

// Xem trước (không ghi DB)
router.post(
  "/users/auto/preview",
  protect,
  authorize("admin"),
  previewAutoUsers
);

// Tạo thật (ghi DB)
router.post("/users/auto/create", protect, authorize("admin"), createAutoUsers);
router.patch(
  "/users/:id/password",
  protect,
  authorize("admin"),
  adminChangeUserPassword
);

router.get(
  "/dashboard/metrics",
  protect,
  authorize("admin"),
  getDashboardMetrics
);
router.get(
  "/dashboard/series",
  protect,
  authorize("admin"),
  getDashboardSeries
);

// Batch matches
router.post(
  "/matches/batch/update-referee",
  protect,
  authorize("admin"),
  batchAssignReferee
);
router.post(
  "/brackets/:bracketId/matches/batch-delete",
  protect,
  authorize("admin"),
  batchDeleteMatches
);

// RoundElim helper
router.post(
  "/brackets/:bracketId/round-elim/skeleton",
  protect,
  authorize("admin"),
  buildRoundElimSkeleton
);

router.post(
  "/brackets/:bracketId/matches/clear",
  protect,
  authorize("admin"),
  clearBracketMatches
);
//

// /api/tournaments/:id/plan/auto
router.post(
  "/tournaments/:id/plan/auto",
  protect,
  authorize("admin"),
  planAuto
);

// /api/tournaments/:id/plan/commit
router.post(
  "/tournaments/:id/plan/commit",
  protect,
  authorize("admin"),
  planCommit
);

// auto create registration
router.post(
  "/tournaments/:tourId/registrations/auto",
  protect,
  authorize("admin"),
  autoGenerateRegistrations
);

router.patch(
  "/tournaments/:id/overlay",
  protect,
  authorize("admin"),
  updateTournamentOverlay
);

router.get("/matches/a/:id", protect, authorize("admin"), getMatchAdmin);
router.get("/matches/:id/logs", protect, authorize("admin"), getMatchLogs);
router.get(
  "/matches/:id/rating-changes",
  protect,
  authorize("admin"),
  getMatchRatingChanges
);

// relate court

// Courts CRUD (upsert theo cụm)
// router.post("/tournaments/:id/courts", upsertCourts);

// Build hàng đợi vòng bảng (xoay lượt A1,B1,C1,D1,...)
// router.post("/tournaments/:id/queue/groups:build", buildGroupsQueue);

// Gán trận kế tiếp hợp lệ vào 1 sân
// router.post(
//   "/tournaments/:id/courts/:courtId/assign-next",
//   assignNextToCourtCtrl
// );

// (Tuỳ chọn) Giải phóng sân + auto-assign
// router.post("/courts/:courtId/free", freeCourtCtrl);

// Tất cả endpoint yêu cầu quyền admin ở middleware global của bạn
// router.post("/brackets/:bracketId/courts",protect, authorize("admin"), upsertBracketCourts);

// Tất cả require admin
router.post(
  "/tournaments/:tournamentId/courts",
  protect,
  authorize("admin"),
  upsertCourts
);

router.post(
  "/tournaments/:tournamentId/queue/groups/build",
  protect,
  authorize("admin"),
  buildGroupsQueueHttp
);

router.post(
  "/tournaments/:tournamentId/courts/:courtId/assign-next",
  protect,
  authorize("admin"),
  assignNextHttp
);

router.post(
  "/tournaments/:tournamentId/courts/:courtId/free",
  protect,
  authorize("admin"),
  freeCourtHttp
);

// Realtime panel (FE gọi để lấy state ban đầu / fallback polling)
router.get(
  "/tournaments/:tournamentId/scheduler/state",
  protect,
  authorize("admin"),
  getSchedulerState
);

// POST /api/tournaments/:tournamentId/courts/:courtId/assign-specific
router.post(
  "/tournaments/:tournamentId/courts/:courtId/assign-specific",
  protect,
  authorize("admin"), // nếu bạn có middleware
  assignSpecificHttp
);

// POST /api/tournaments/:tournamentId/courts/reset
router.post(
  "/tournaments/:tournamentId/courts/reset",
  protect,
  authorize("admin"),
  resetCourtsHttp
);

router.post(
  "/match/rating/preview",
  protect,
  authorize("admin"),
  previewRatingDelta
);

router.post("/matches/:id/reset-scores", resetMatchScores);

router.post(
  "/tournaments/:id/reapply-propagation",
  protect,
  authorize("admin"),
  reapplyPropagation
);
router.post(
  "/tournaments/:id/brackets/:bid/reapply-seeds",
  protect,
  authorize("admin"),
  reapplySeedsForBracket
);

router.post(
  "/tournaments/:tid/stages/:sourceStage/feed-to/:targetStage",
  protect,
  authorize("admin"),
  feedStageToNext
);

// Danh sách + filter
router.get("/evaluators/", protect, authorize("admin"), listEvaluators);

// Cập nhật phạm vi chấm
router.patch(
  "/evaluators/:id/scopes",
  protect,
  authorize("admin"),
  updateEvaluatorScopes
);

// Promote user -> evaluator
router.post(
  "/evaluators/promote",
  protect,
  authorize("admin"),
  promoteToEvaluator
);

// Demote evaluator -> user/referee
router.patch(
  "/evaluators/:id/demote",
  protect,
  authorize("admin"),
  demoteEvaluator
);

router.post(
  "/brackets/:bracketId/groups/:groupId/insert-slot",
  protect,
  authorize("admin"),
  insertRegIntoGroupSlot
);

router.post(
  "/brackets/:bracketId/groups/:groupId/generate-matches",
  protect,
  authorize("admin"),
  generateGroupMatchesForTeam
);

router.get(
  "/brackets/:bracketId",
  protect,
  authorize("admin"),
  getAdminBracketById
);



export default router;
