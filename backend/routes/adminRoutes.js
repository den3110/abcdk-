// routes/adminRoutes.js
import express from "express";
import {
  getUsers,
  updateUserRole,
  deleteUser,
  reviewUserKyc,
  updateUserInfo,
  updateUserSuperAdmin,
} from "../controllers/admin/adminController.js";
import {
  protect,
  authorize,
  isManagerTournament,
  isManagerOrTournamentReferee,
  requireAdminAndSuperUser,
  requireSuperAdmin,
} from "../middleware/authMiddleware.js";
import { adminLogin } from "../controllers/admin/adminAuthController.js";
import {
  adminCreateUser,
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
  listTournamentAllowedCourtClusterOptions,
  listTournamentRefereesInScope,
  planAuto,
  planCommit,
  planGet,
  planImpact,
  planUpdate,
  updateTournamentAllowedCourtClusters,
  updateTournamentOverlay,
  updateTournamentTimeoutPerGame,
  upsertTournamentReferees,
} from "../controllers/admin/adminTournamentController.js";
import {
  adminCreateRegistration,
  adminCheckin,
  adminDeleteRegistration,
  adminGetRegistrationHistory,
  adminUpdatePayment,
  adminUpdateRegistration,
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
  commitRegistrationImport,
  getImportUserBatch,
  listImportUserBatches,
  previewRegistrationImport,
  previewRegistrationImportStream,
  quickImportRegistrationJson,
} from "../controllers/admin/adminAiImportController.js";
import {
  getDashboardMetrics,
  getPeakRuntimeMetrics,
  getDashboardSeries,
} from "../controllers/admin/adminDashboardController.js";
import {
  clearAllCacheGroupsHttp,
  clearCacheGroupById,
  getCacheSummary,
} from "../controllers/admin/adminCacheController.js";
import {
  getAdminLivePlaybackConfig,
  updateAdminLivePlaybackConfig,
} from "../controllers/admin/adminLivePlaybackController.js";
import {
  batchAssignReferee,
  batchDeleteMatches,
  batchSetLiveUrl,
  buildRoundElimSkeleton,
  clearBracketMatches,
} from "../controllers/matchBatchController.js";
import { autoGenerateRegistrations } from "../controllers/registrationAutoController.js";
import {
  assignMatchToCourt,
  clearMatchCourt,
  getMatchAdmin,
  getMatchLogs,
  getMatchRatingChanges,
  getMatchReferees,
  previewRatingDelta,
  resetMatchScores,
} from "../controllers/admin/adminMatchController.js";
import {
  advanceCourtMatchListHttp,
  assignNextHttp,
  assignSpecificHttp,
  buildGroupsQueueHttp,
  clearCourtMatchListHttp,
  deleteAllCourts,
  deleteOneCourt,
  fetchSchedulerMatches,
  freeCourtHttp,
  getSchedulerState,
  listCourtsByTournament,
  resetCourtsHttp,
  setCourtMatchListHttp,
  setCourtReferee,
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
import {
  bulkAssignPoPlan,
  bulkAssignSlotPlan,
  generateGroupMatchesForTeam,
  getAdminBracketById,
  insertRegIntoGroupSlot,
} from "../controllers/admin/adminBracketController.js";
import {
  getUsersVersion,
  getVersionStats,
} from "../controllers/admin/adminVersions.controller.js";
import {
  getSystemSettings,
  updateSystemSettings,
} from "../controllers/systemSettings.controller.js";
import {
  getPresenceOfUser,
  getPresenceSummary,
  listPresenceUsers,
  searchPresenceUsers,
} from "../controllers/admin/adminStatsController.js";
import {
  getAdminPushDispatchDetail,
  getAdminPushSummary,
  listAdminPushDispatches,
} from "../controllers/admin/adminPushDispatchController.js";
import { searchUsersForRefereeAssign } from "../controllers/admin/refereeController.js";
import { uploadSingleAiImportFile } from "../middleware/uploadMiddleware.js";
import { suggestAndCommit, suggestPlan } from "./planSuggest.js";
import {
  getConfig,
  updateConfig,
} from "../controllers/fbLiveAdmin.controller.js";
import {
  deleteConfig,
  getAllConfig,
  getConfigValue,
  triggerFbResync,
  upsertConfig,
} from "../controllers/adminConfigController.js";
import {
  ytCallback,
  ytGetOrCreateStreamKey,
  ytInit,
  ytRevoke,
} from "../controllers/youtubeSetupController.js";
import {
  disconnectRecordingDriveOAuth,
  recordingDrivePickerSession,
  getRecordingDriveOAuthStatus,
  recordingDriveOAuthInit,
} from "../controllers/recordingDriveSetupController.js";
import {
  bulkSetCourtLiveConfig,
  getCourtLiveConfig,
  listCourtsByTournamentLive,
  setCourtLiveConfig,
} from "../controllers/courtLiveConfigController.js";
import {
  adminGetLiveSession,
  adminListLiveSessions,
  adminStopLiveSession,
} from "../controllers/adminLiveController.js";
import {
  ensureFbVodMonitorExport,
  getFbVodMonitor,
} from "../controllers/fbVodDriveMonitorController.js";
import {
  assignMatchToCourtStationHttp,
  appendTournamentCourtStationQueueItemHttp,
  assignTournamentMatchToCourtStationHttp,
  createAdminCourtCluster,
  createAdminCourtStation,
  deleteAdminCourtCluster,
  deleteAdminCourtStation,
  forceFreeAdminCourtStationHttp,
  forceReleaseAdminCourtStationPresenceHttp,
  freeTournamentCourtStationHttp,
  freeCourtStationHttp,
  getAdminCourtClusterRuntime,
  getAdminCourtStationCurrentMatch,
  getTournamentCourtClusterRuntime,
  listAdminCourtStationFreeManager,
  listAdminCourtClusters,
  listAdminCourtStations,
  removeTournamentCourtStationQueueItemHttp,
  updateTournamentCourtStationAssignmentConfigHttp,
  updateAdminCourtCluster,
  updateAdminCourtStation,
} from "../controllers/admin/adminCourtClusterController.js";
import { exchangeLongUserToken } from "../controllers/adminFacebookController.js";
import {
  getNewsCandidates,
  getNewsSettings,
  runNewsSyncNow,
  runNewsSyncNowV2,
  updateNewsSettings,
} from "../controllers/newsAdminController.js";
import {
  cleanupSeoNewsGatewaySourceImagesNow,
  createSeoNewsReadyArticlesNow,
  getSeoNewsArticles,
  getSeoNewsCandidates,
  getSeoNewsImageStats,
  getSeoNewsPipelineMonitorNow,
  getSeoNewsSettings,
  pushSeoNewsDraftsToPublished,
  queueSeoNewsPipelineJobNow,
  queueSeoNewsImageRegenerationNow,
  runSeoNewsPendingCandidates,
  runSeoNewsSyncNow,
  updateSeoNewsSettings,
} from "../controllers/seoNewsAdminController.js";
import {
  adminSetRankingSearchConfig,
  aiFillCccdForUser,
  backfillUsersFromCccd,
} from "../controllers/userController.js";
import {
  getAvatarOptimizationStatus,
  runAvatarOptimizationCleanupNow,
  runAvatarOptimizationSweepNow,
} from "../controllers/admin/adminAvatarOptimizationController.js";
import { getAdminTournamentImageProxy } from "../controllers/admin/adminAssetProxyController.js";
import { getAdminObserverOverview as getObserverOverviewProxy } from "../controllers/admin/adminObserverController.js";
// import { assignNextController, buildBracketQueueController, toggleAutoAssignController, upsertCourtsForBracket } from "../controllers/admin/adminCourtController.js";
// import { assignNextToCourtCtrl, buildGroupsQueue, freeCourtCtrl, upsertCourts } from "../controllers/admin/adminCourtController.js";

const router = express.Router();

router.post("/login", adminLogin);

router.get("/matches/:id([0-9a-fA-F]{24})", protect, adminGetMatchById);

router.get("/tournaments/:id/referees", protect, listTournamentRefereesInScope);

router.post("/tournaments/:tid/referees", protect, upsertTournamentReferees);

router.get("/referees/search", protect, searchUsersForRefereeAssign);
router.get("/tournaments/:tid/courts", protect, listCourtsByTournament);
router.post("/courts/deleteAll", protect, deleteAllCourts);
router.delete("/courts/:courtId", protect, deleteOneCourt);
// POST   /api/admin/tournaments/:tid/matches/:mid/court  -> gán sân
router.post(
  "/tournaments/:tid/matches/:mid/court",
  protect,
  assignMatchToCourt,
);

// DELETE /api/admin/tournaments/:tid/matches/:mid/court  -> bọĩ gán sân
router.delete("/tournaments/:tid/matches/:mid/court", protect, clearMatchCourt);

router.get(
  "/tournaments/:tid/matches/:mid/referees",
  protect,
  getMatchReferees,
);

// Batch matches
router.post("/matches/batch/update-referee", protect, batchAssignReferee);
router.post("/matches/batch/live-url", protect, batchSetLiveUrl);

router.post("/tournaments/:tournamentId/courts", protect, upsertCourts);

router.get("/tournaments/c/:tid/courts", protect, listCourtsByTournamentLive);

router.get("/courts/:courtId/live-config", protect, getCourtLiveConfig);

router.patch("/courts/:courtId/live-config", protect, setCourtLiveConfig);

router.patch(
  "/tournaments/:tid/courts/live-config/bulk",
  protect,
  bulkSetCourtLiveConfig,
);

router.put(
  "/tournaments/:tournamentId/courts/:courtId/referee",
  protect,
  setCourtReferee,
);

router.put(
  "/tournaments/:id/matches/timeout-per-game",
  updateTournamentTimeoutPerGame,
);

router.get(
  "/tournaments/:tournamentId/allowed-court-clusters/options",
  protect,
  isManagerOrTournamentReferee,
  listTournamentAllowedCourtClusterOptions,
);
router.put(
  "/tournaments/:tournamentId/allowed-court-clusters",
  protect,
  isManagerTournament,
  updateTournamentAllowedCourtClusters,
);
router.get(
  "/tournaments/:tournamentId/court-clusters/:clusterId/runtime",
  protect,
  isManagerOrTournamentReferee,
  getTournamentCourtClusterRuntime,
);
router.post(
  "/tournaments/:tournamentId/court-stations/:stationId/assign-match",
  protect,
  isManagerOrTournamentReferee,
  assignTournamentMatchToCourtStationHttp,
);
router.put(
  "/tournaments/:tournamentId/court-stations/:stationId/assignment-config",
  protect,
  isManagerOrTournamentReferee,
  updateTournamentCourtStationAssignmentConfigHttp,
);
router.post(
  "/tournaments/:tournamentId/court-stations/:stationId/queue/items",
  protect,
  isManagerOrTournamentReferee,
  appendTournamentCourtStationQueueItemHttp,
);
router.delete(
  "/tournaments/:tournamentId/court-stations/:stationId/queue/items/:matchId",
  protect,
  isManagerOrTournamentReferee,
  removeTournamentCourtStationQueueItemHttp,
);
router.post(
  "/tournaments/:tournamentId/court-stations/:stationId/free",
  protect,
  isManagerOrTournamentReferee,
  freeTournamentCourtStationHttp,
);

router.use(protect, authorize("admin")); // tất cả dưới đây cần admin

router.get("/assets/tournament-image", getAdminTournamentImageProxy);

router.get(
  "/avatar-optimization/status",
  requireAdminAndSuperUser,
  getAvatarOptimizationStatus,
);
router.post(
  "/avatar-optimization/run",
  requireAdminAndSuperUser,
  runAvatarOptimizationSweepNow,
);
router.post(
  "/avatar-optimization/cleanup",
  requireAdminAndSuperUser,
  runAvatarOptimizationCleanupNow,
);

// router.get("/users", getUsers);
router.get("/users", getUsersWithRank);
router.post("/users", adminCreateUser);
router.put("/users/:id/role", updateUserRole);
router.patch("/users/:id/super-admin", requireSuperAdmin, updateUserSuperAdmin);
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
  .all(protect, authorize("admin"))
  .put(adminUpdatePayment);

router
  .route("/tournaments/registrations/:regId/checkin")
  .all(protect, authorize("admin"))
  .put(adminCheckin);

router
  .route("/tournaments/registrations/:regId/history")
  .all(protect, authorize("admin"))
  .get(adminGetRegistrationHistory);

router
  .route("/tournaments/registrations/:regId")
  .all(protect, authorize("admin"))
  .patch(adminUpdateRegistration)
  .delete(adminDeleteRegistration);

// create bracket for a tournament
router.post(
  "/tournaments/:id/brackets",
  protect,
  authorize("admin"),
  adminCreateBracket,
);

// get lists of bracket của tournament
router.get(
  "/tournaments/:id/brackets",
  protect,
  authorize("admin", "referee", "user"),
  getBracketsWithMatches,
);

// get lists of bracket của tournament
router.get(
  "/tournaments/:id/brackets/structure",
  protect,
  authorize("admin", "referee", "user"),
  getTournamentBracketsStructure,
);

router.get(
  "/tournaments/:id/registrations",
  protect,
  authorize("admin"),
  getRegistrationsAdmin,
);
router.post(
  "/tournaments/:id/registrations",
  protect,
  authorize("admin"),
  adminCreateRegistration,
);

// Admin: list all matches
router.get(
  "/matches",
  protect,
  authorize("admin"),
  adminGetAllMatchesPagination,
);
router.get("/matches/all", protect, authorize("admin"), adminGetAllMatches);

router.get(
  "/matches/groups",
  protect,
  authorize("admin"),
  adminListMatchGroups,
);

router.post(
  "/brackets/:bracketId/matches",
  protect,
  authorize("admin"),
  adminCreateMatch,
);
router.get(
  "/brackets/:bracketId/matches",
  protect,
  authorize("admin", "referee", "user"),
  getMatchesByBracket,
);

router.post(
  "/brackets/:bid/slot-plan/bulk-assign",
  protect,
  authorize("admin"),
  requireSuperAdmin,
  bulkAssignSlotPlan,
);

router.patch(
  "/matches/:matchId/score",
  protect,
  authorize("admin", "referee"),
  refereeUpdateScore,
);
router.patch(
  "/matches/:matchId/referee",
  protect,
  authorize("admin"),
  adminAssignReferee,
);

router.delete(
  "/tournaments/:tourId/brackets/:bracketId",
  protect,
  authorize("admin"),
  deleteBracketCascade,
);

router.delete(
  "/matches/:matchId",
  protect,
  authorize("admin"),
  adminDeleteMatch,
);
router.patch(
  "/tournaments/:tournamentId/brackets/:bracketId",
  protect,
  authorize("admin"),
  adminUpdateBracket,
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
  },
);

router.post(
  "/tournaments/finish-expired",
  protect,
  authorize("admin"),
  finishExpiredTournaments,
);
router.put(
  "/tournament/:id/finish",
  protect,
  authorize("admin"),
  finishTournament,
);

// Xem trước (không ghi DB)
router.post(
  "/users/auto/preview",
  protect,
  authorize("admin"),
  previewAutoUsers,
);

// Tạo thật (ghi DB)
router.post("/users/auto/create", protect, authorize("admin"), createAutoUsers);
router.patch(
  "/users/:id/password",
  protect,
  authorize("admin"),
  adminChangeUserPassword,
);

router.get(
  "/dashboard/metrics",
  protect,
  authorize("admin"),
  getDashboardMetrics,
);
router.get(
  "/dashboard/series",
  protect,
  authorize("admin"),
  getDashboardSeries,
);
router.get(
  "/dashboard/peak-runtime",
  protect,
  authorize("admin"),
  getPeakRuntimeMetrics,
);
router.get(
  "/observer/overview",
  protect,
  requireAdminAndSuperUser,
  getObserverOverviewProxy,
);
router.get(
  "/cache/summary",
  protect,
  requireAdminAndSuperUser,
  getCacheSummary,
);
router.post(
  "/cache/:cacheId/clear",
  protect,
  requireAdminAndSuperUser,
  clearCacheGroupById,
);
router.post(
  "/cache/clear-all",
  protect,
  requireAdminAndSuperUser,
  clearAllCacheGroupsHttp,
);
router.get(
  "/live-playback/config",
  protect,
  requireAdminAndSuperUser,
  getAdminLivePlaybackConfig,
);
router.put(
  "/live-playback/config",
  protect,
  requireAdminAndSuperUser,
  updateAdminLivePlaybackConfig,
);
router.get(
  "/court-stations/free-manager",
  protect,
  requireAdminAndSuperUser,
  listAdminCourtStationFreeManager,
);

router.post(
  "/brackets/:bracketId/matches/batch-delete",
  protect,
  authorize("admin"),
  batchDeleteMatches,
);

// RoundElim helper
router.post(
  "/brackets/:bracketId/round-elim/skeleton",
  protect,
  authorize("admin"),
  buildRoundElimSkeleton,
);

router.post(
  "/brackets/:bracketId/matches/clear",
  protect,
  authorize("admin"),
  clearBracketMatches,
);
//

// /api/tournaments/:id/plan/auto
router.post(
  "/tournaments/:id/plan/auto",
  protect,
  authorize("admin"),
  planAuto,
);

// /api/tournaments/:id/plan/commit
router.post(
  "/tournaments/:id/plan/commit",
  protect,
  authorize("admin"),
  planCommit,
);
router.post(
  "/tournaments/:id/plan/impact",
  protect,
  authorize("admin"),
  planImpact,
);

router
  .route("/tournaments/:id/plan")
  .get(protect, authorize("admin"), planGet)
  .put(protect, authorize("admin"), planUpdate);

router.post(
  "/tournaments/:id/plan/suggest",
  protect,
  authorize("admin"),
  suggestPlan,
);
router.post(
  "/tournaments/:id/plan/suggest-and-commit",
  protect,
  authorize("admin"),
  suggestAndCommit,
);

// auto create registration
router.post(
  "/tournaments/:tourId/registrations/auto",
  protect,
  authorize("admin"),
  autoGenerateRegistrations,
);

router.post(
  "/tournaments/:tourId/registrations/ai-import/preview",
  protect,
  authorize("admin"),
  uploadSingleAiImportFile,
  previewRegistrationImport,
);

router.post(
  "/tournaments/:tourId/registrations/ai-import/preview-stream",
  protect,
  authorize("admin"),
  uploadSingleAiImportFile,
  previewRegistrationImportStream,
);

router.post(
  "/tournaments/:tourId/registrations/ai-import/commit",
  protect,
  authorize("admin"),
  commitRegistrationImport,
);

router.post(
  "/tournaments/:tourId/registrations/ai-import/quick-json",
  protect,
  authorize("admin"),
  quickImportRegistrationJson,
);

router.get(
  "/tournaments/:tourId/registrations/ai-import/user-batches",
  protect,
  authorize("admin"),
  listImportUserBatches,
);

router.get(
  "/tournaments/:tourId/registrations/ai-import/user-batches/:batchId",
  protect,
  authorize("admin"),
  getImportUserBatch,
);

router.patch(
  "/tournaments/:id/overlay",
  protect,
  authorize("admin"),
  updateTournamentOverlay,
);

router.get("/matches/a/:id", protect, authorize("admin"), getMatchAdmin);
router.get("/matches/:id/logs", protect, authorize("admin"), getMatchLogs);
router.get(
  "/matches/:id/rating-changes",
  protect,
  authorize("admin"),
  getMatchRatingChanges,
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

// (Tùy chọn) Giải phóng sân + auto-assign
// router.post("/courts/:courtId/free", freeCourtCtrl);

// Tất cả endpoint yêu cầu quyền admin ở middleware global của bạn
// router.post("/brackets/:bracketId/courts",protect, authorize("admin"), upsertBracketCourts);

// Tất cả require admin

router.post(
  "/tournaments/:tournamentId/queue/groups/build",
  protect,
  authorize("admin"),
  buildGroupsQueueHttp,
);

router.post(
  "/tournaments/:tournamentId/courts/:courtId/assign-next",
  protect,
  authorize("admin"),
  assignNextHttp,
);

router.post(
  "/tournaments/:tournamentId/courts/:courtId/free",
  protect,
  authorize("admin"),
  freeCourtHttp,
);

router.put(
  "/tournaments/:tournamentId/courts/:courtId/match-list",
  protect,
  authorize("admin"),
  setCourtMatchListHttp,
);

router.delete(
  "/tournaments/:tournamentId/courts/:courtId/match-list",
  protect,
  authorize("admin"),
  clearCourtMatchListHttp,
);

router.post(
  "/tournaments/:tournamentId/courts/:courtId/match-list/advance",
  protect,
  authorize("admin"),
  advanceCourtMatchListHttp,
);

// Realtime panel (FE gọíi Đ‘ọƒ lấy state ban Đ‘ầu / fallback polling)
router.get(
  "/tournaments/:tournamentId/scheduler/state",
  protect,
  authorize("admin"),
  getSchedulerState,
);

// POST /api/tournaments/:tournamentId/courts/:courtId/assign-specific
router.post(
  "/tournaments/:tournamentId/courts/:courtId/assign-specific",
  protect,
  authorize("admin"), // nếu bạn có middleware
  assignSpecificHttp,
);

// POST /api/tournaments/:tournamentId/courts/reset
router.post(
  "/tournaments/:tournamentId/courts/reset",
  protect,
  authorize("admin"),
  resetCourtsHttp,
);

router.post(
  "/match/rating/preview",
  protect,
  authorize("admin"),
  previewRatingDelta,
);

router.post("/matches/:id/reset-scores", resetMatchScores);

router.post(
  "/tournaments/:id/reapply-propagation",
  protect,
  authorize("admin"),
  reapplyPropagation,
);
router.post(
  "/tournaments/:id/brackets/:bid/reapply-seeds",
  protect,
  authorize("admin"),
  reapplySeedsForBracket,
);

router.post(
  "/tournaments/:tid/stages/:sourceStage/feed-to/:targetStage",
  protect,
  authorize("admin"),
  feedStageToNext,
);

// Danh sách + filter
router.get("/evaluators/", protect, authorize("admin"), listEvaluators);

// Cập nhật phạm vi chấm
router.patch(
  "/evaluators/:id/scopes",
  protect,
  authorize("admin"),
  updateEvaluatorScopes,
);

// Promote user -> evaluator
router.post(
  "/evaluators/promote",
  protect,
  authorize("admin"),
  promoteToEvaluator,
);

// Demote evaluator -> user/referee
router.patch(
  "/evaluators/:id/demote",
  protect,
  authorize("admin"),
  demoteEvaluator,
);

router.post(
  "/brackets/:bracketId/groups/:groupId/insert-slot",
  protect,
  authorize("admin"),
  insertRegIntoGroupSlot,
);

router.post(
  "/brackets/:bracketId/groups/:groupId/generate-matches",
  protect,
  authorize("admin"),
  generateGroupMatchesForTeam,
);

router.get(
  "/brackets/:bracketId",
  protect,
  authorize("admin"),
  getAdminBracketById,
);

router.get(
  "/courts/matches",
  protect,
  authorize("admin"),
  fetchSchedulerMatches,
);

router.get("/versions/stats", protect, authorize("admin"), getVersionStats);
router.get("/versions/by-user", protect, authorize("admin"), getUsersVersion);

router.get("/settings", protect, authorize("admin"), getSystemSettings);
router.put("/settings", protect, authorize("admin"), updateSystemSettings);
router.get(
  "/recording-drive/oauth/init",
  protect,
  authorize("admin"),
  recordingDriveOAuthInit,
);
router.get(
  "/recording-drive/picker/session",
  protect,
  authorize("admin"),
  recordingDrivePickerSession,
);
router.get(
  "/recording-drive/status",
  protect,
  authorize("admin"),
  getRecordingDriveOAuthStatus,
);
router.post(
  "/recording-drive/disconnect",
  protect,
  authorize("admin"),
  disconnectRecordingDriveOAuth,
);

router.get("/stats/presence", protect, authorize("admin"), getPresenceSummary);
router.get(
  "/stats/presence/users",
  protect,
  authorize("admin"),
  listPresenceUsers,
);
router.get(
  "/stats/presence/search",
  protect,
  authorize("admin"),
  searchPresenceUsers,
);
router.get(
  "/stats/presence/user/:id",
  protect,
  authorize("admin"),
  getPresenceOfUser,
);

router.get(
  "/push/summary",
  protect,
  requireAdminAndSuperUser,
  getAdminPushSummary,
);
router.get(
  "/push/dispatches",
  protect,
  requireAdminAndSuperUser,
  listAdminPushDispatches,
);
router.get(
  "/push/dispatches/:id",
  protect,
  requireAdminAndSuperUser,
  getAdminPushDispatchDetail,
);

router
  .route("/court-clusters")
  .get(protect, authorize("admin"), listAdminCourtClusters)
  .post(protect, authorize("admin"), createAdminCourtCluster);

router
  .route("/court-clusters/:id")
  .put(protect, authorize("admin"), updateAdminCourtCluster)
  .delete(protect, authorize("admin"), deleteAdminCourtCluster);

router.get(
  "/court-clusters/:id/runtime",
  protect,
  authorize("admin"),
  getAdminCourtClusterRuntime,
);

router
  .route("/court-clusters/:id/courts")
  .get(protect, authorize("admin"), listAdminCourtStations)
  .post(protect, authorize("admin"), createAdminCourtStation);

router
  .route("/court-clusters/:id/courts/:stationId")
  .put(protect, authorize("admin"), updateAdminCourtStation)
  .delete(protect, authorize("admin"), deleteAdminCourtStation);

router.post(
  "/court-stations/:id/assign-match",
  protect,
  authorize("admin"),
  assignMatchToCourtStationHttp,
);

router.post(
  "/court-stations/:id/free",
  protect,
  authorize("admin"),
  freeCourtStationHttp,
);
router.post(
  "/court-stations/:id/force-free",
  protect,
  requireAdminAndSuperUser,
  forceFreeAdminCourtStationHttp,
);
router.post(
  "/court-stations/:id/force-release-presence",
  protect,
  requireAdminAndSuperUser,
  forceReleaseAdminCourtStationPresenceHttp,
);

router.get(
  "/court-stations/:id/current-match",
  protect,
  authorize("admin"),
  getAdminCourtStationCurrentMatch,
);

router.get("/fb-live-config", protect, authorize("admin"), getConfig);
router.put("/fb-live-config", protect, authorize("admin"), updateConfig);

router.get("/config", protect, authorize("admin"), getAllConfig); // list (mask secret)
router.get("/config/:key", protect, authorize("admin"), getConfigValue); // get 1 key (không mask — tuỳ policy)
router.post("/config", protect, authorize("admin"), upsertConfig); // upsert { key, value, isSecret? }
router.delete("/config/:key", protect, authorize("admin"), deleteConfig);

router.post("/fb/resync", protect, authorize("admin"), triggerFbResync);

router.get("/youtube/init", protect, authorize("admin"), ytInit);
// router.get("/oauth/google/youtube/callback", ytCallback); // public callback
router.get(
  "/youtube/stream-key",
  protect,
  authorize("admin"),
  ytGetOrCreateStreamKey,
);
router.post("/youtube/revoke", protect, authorize("admin"), ytRevoke);

router.get(
  "/live-sessions/:id([0-9a-fA-F]{24})",
  protect,
  authorize("admin"),
  adminGetLiveSession,
);
router.get(
  "/l/live-sessions/all",
  protect,
  authorize("admin"),
  adminListLiveSessions,
);
router.patch(
  "/live-sessions/:id/stop",
  protect,
  authorize("admin"),
  adminStopLiveSession,
);
router.get(
  "/fb-vod-monitor",
  protect,
  authorize("admin"),
  requireAdminAndSuperUser,
  getFbVodMonitor,
);
router.post(
  "/fb-vod-monitor/:matchId([0-9a-fA-F]{24})/ensure-export",
  protect,
  authorize("admin"),
  requireAdminAndSuperUser,
  ensureFbVodMonitorExport,
);

router.post(
  "/fb/long-user-token/exchange",
  protect,
  authorize("admin"),
  exchangeLongUserToken,
);

router.post(
  "/brackets/:bid/po-plan/bulk-assign",
  protect,
  authorize("admin"),
  requireSuperAdmin,
  bulkAssignPoPlan,
);

router.get("/news/settings", getNewsSettings);
router.put("/news/settings", updateNewsSettings);
router.get("/news/candidates", getNewsCandidates);
router.post("/news/run", runNewsSyncNow);
router.post("/news/run/v2", runNewsSyncNowV2);

router.get("/seo-news/settings", getSeoNewsSettings);
router.put("/seo-news/settings", updateSeoNewsSettings);
router.get("/seo-news/candidates", getSeoNewsCandidates);
router.get("/seo-news/jobs/monitor", getSeoNewsPipelineMonitorNow);
router.post("/seo-news/jobs", queueSeoNewsPipelineJobNow);
router.get("/seo-news/articles", getSeoNewsArticles);
router.post("/seo-news/articles/push", pushSeoNewsDraftsToPublished);
router.post("/seo-news/articles/create-ready", createSeoNewsReadyArticlesNow);
router.post("/seo-news/candidates/run", runSeoNewsPendingCandidates);
router.post(
  "/seo-news/images/cleanup-source",
  cleanupSeoNewsGatewaySourceImagesNow,
);
router.post(
  "/seo-news/images/regeneration-jobs",
  queueSeoNewsImageRegenerationNow,
);
router.post("/seo-news/run", runSeoNewsSyncNow);
router.get("/seo-news/image-stats", getSeoNewsImageStats);

router.post(
  "/users/cccd-backfill",
  protect,
  authorize("admin"),
  backfillUsersFromCccd,
);

// NEW: AI CCCD cho từng user
router.post(
  "/users/:id/ai-cccd",
  protect,
  authorize("admin"),
  aiFillCccdForUser,
);

router.patch(
  "/users/:userId/ranking-search-config",
  protect,
  authorize("admin"),
  adminSetRankingSearchConfig,
);

export default router;
