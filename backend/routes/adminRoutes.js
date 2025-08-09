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
  getTournamentById,
  getTournaments,
  updateTournament,
} from "../controllers/admin/adminTournamentController.js";
import {
  adminCheckin,
  adminDeleteRegistration,
  adminUpdatePayment,
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
  adminGetMatchById,
  adminUpdateMatch,
  getMatchesByBracket,
  refereeUpdateScore,
} from "../controllers/admin/matchController.js";

const router = express.Router();

router.post("/login", adminLogin);

router.use(protect, authorize("admin")); // tất cả dưới đây cần admin

// router.get("/users", getUsers);
router.put("/users/:id/role", updateUserRole);
router.delete("/users/:id", deleteUser);
router.put("/users/:id", updateUserInfo);
router.put("/users/:id/kyc", reviewUserKyc); // approve / reject

router.get("/users", getUsersWithRank);
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

// Admin: list all matches
router.get("/matches", protect, authorize("admin"), adminGetAllMatches);

router.get("/matches/:id", protect, authorize("admin"), adminGetMatchById);

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

export default router;
