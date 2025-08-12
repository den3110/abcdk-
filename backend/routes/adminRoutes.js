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
  getUsersWithRank,
  updateRanking,
} from "../controllers/rankingController.js";
import {
  createScoreHistory,
  listScoreHistory,
} from "../controllers/scoreHistoryController.js";
import {
  createTournament,
  deleteTournament,
  finishExpiredTournaments,
  finishTournament,
  getTournamentById,
  getTournaments,
  updateTournament,
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

const router = express.Router();

router.post("/login", adminLogin);

router.get("/matches/:id([0-9a-fA-F]{24})", protect, authorize("admin", "referee"), adminGetMatchById);

router.use(protect, authorize("admin")); // tất cả dưới đây cần admin

// router.get("/users", getUsers);
router.get("/users", getUsersWithRank);
router.put("/users/:id/role", updateUserRole);
router.delete("/users/:id", deleteUser);
router.put("/users/:id", updateUserInfo);
router.put("/users/:id/kyc", reviewUserKyc); // approve / reject


router.put("/rankings/:id", updateRanking);

router.get("/score-history", listScoreHistory); // ?user=&page=
router.post("/score-history", createScoreHistory); // body { userId, ... }

router
  .route("/tournaments/:id")
  // .all(validateObjectId)           // (nếu dùng)
  .get(getTournamentById) // GET    /api/admin/tournaments/:id
  .put(updateTournament) // PUT    /api/admin/tournaments/:id
  .delete(deleteTournament); // DELETE /api/admin/tournaments/:id

router
  .route("/tournaments")
  .get(getTournaments) // GET  /api/admin/tournaments
  .post(createTournament); // POST /api/admin/tournaments

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
router.get(
  "/tournaments/:id/brackets",
  protect,
  authorize("admin", "referee", "user"),
  getBracketsWithMatches
);

router.get("/tournaments/:id/registrations", protect, authorize("admin"), getRegistrationsAdmin);

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

router.post("/tournaments/finish-expired", protect, authorize("admin"), finishExpiredTournaments);
router.put("/tournament/:id/finish", protect, authorize("admin"), finishTournament);



export default router;
