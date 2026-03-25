import express from "express";
import {
  getTournamentById,
  getTeamRoster,
  getTeamStandings,
  getTournaments,
  listTournamentBrackets,
  listTournamentMatches,
  searchTournaments,
} from "../controllers/tournamentController.js";
import {
  createRegistration,
  getRegistrations,
} from "../controllers/registrationController.js";
import {
  getMatchesByTournament,
  getMatchPublic,
  getTournamentMatchesForCheckin,
} from "../controllers/matchController.js";
import { uploadAvatars } from "../middleware/uploadMiddleware.js";
import {
  searchUserMatches,
  userCheckinRegistration,
} from "../controllers/admin/matchController.js";
import { optionalAuth, protect } from "../middleware/authMiddleware.js";
import {
  addManager,
  listManagers,
  removeManager,
  verifyTournamentManager,
  verifyTournamentReferee,
} from "../controllers/tournamentManagerController.js";
import {
  createRegistrationInvite,
  listMyInvites,
  respondInvite,
} from "../controllers/regInvitesController.js";
import {
  createComplaint,
  listComplaints,
} from "../controllers/complaintsController.js";
import { createTeamMatch } from "../controllers/teamTournamentController.js";

const router = express.Router();

router.route("/").get(getTournaments);
router.route("/:id([0-9a-fA-F]{24})").get(getTournamentById); // 💡  chi tiết
// sau này thêm POST / PUT / DELETE nếu cần
router
  .route("/:id/registrations")
  .post(protect, createRegistration)
  .get(optionalAuth, getRegistrations);
router.get("/:id/team-roster", optionalAuth, getTeamRoster);
router.get("/:id/team-standings", optionalAuth, getTeamStandings);
router.post("/:id/team-matches", protect, createTeamMatch);

// routes/tournamentRoutes.js
router.get("/:id/checkin-matches", getTournamentMatchesForCheckin);

// Tìm theo SĐT/Nickname → trả matches theo từng registration
router.get("/checkin/search", searchUserMatches);

// Check-in 1 registration (cần q để xác thực)
router.post("/checkin", protect, userCheckinRegistration);

// /api/tournaments/:id/brackets
router.get("/:id/brackets", listTournamentBrackets);

// /api/tournaments/:id/matches
router.get("/:id/matches", listTournamentMatches);
// router.get("/:id/matches", getMatchesByTournament);

router.get("/matches/:id", getMatchPublic);

router.get("/:id/managers", protect, listManagers);
router.post("/:id/managers", protect, addManager);
router.delete("/:id/managers/:userId", protect, removeManager);

router.post("/:id/registration-invites", protect, createRegistrationInvite);
router.get("/get/registration-invites", protect, listMyInvites); // GLOBAL
router.post("/registration-invites/:id/respond", protect, respondInvite);

router.post(
  "/:tournamentId/registrations/:regId/complaints",
  protect,
  createComplaint
);

router.get("/:tournamentId/complaints", protect, listComplaints);
router.get("/:tid/is-manager", protect, verifyTournamentManager);
router.get("/:tid/is-referee", protect, verifyTournamentReferee);
router.get("/search", searchTournaments);

export default router;
