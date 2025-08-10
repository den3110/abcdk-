import express from "express";
import {
  getTournamentById,
  getTournaments,
} from "../controllers/tournamentController.js";
import {
  createRegistration,
  getRegistrations,
} from "../controllers/registrationController.js";
import { getMatchesByTournament, getTournamentMatchesForCheckin } from "../controllers/matchController.js";
import { uploadAvatars } from "../middleware/uploadMiddleware.js";
import { searchUserMatches, userCheckinRegistration } from "../controllers/admin/matchController.js";

const router = express.Router();

router.route("/").get(getTournaments);
router.route("/:id").get(getTournamentById); // 💡  chi tiết
// sau này thêm POST / PUT / DELETE nếu cần
router
  .route("/:id/registrations")
  .post(createRegistration)
  .get(getRegistrations);

router.route("/:id/matches").get(getMatchesByTournament);
// routes/tournamentRoutes.js
router.get("/:id/checkin-matches", getTournamentMatchesForCheckin);

// Tìm theo SĐT/Nickname → trả matches theo từng registration
router.get("/checkin/search", searchUserMatches);

// Check-in 1 registration (cần q để xác thực)
router.post("/checkin", userCheckinRegistration);

export default router;
