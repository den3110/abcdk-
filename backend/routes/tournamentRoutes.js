import express from "express";
import {
  getTournamentById,
  getTournaments,
} from "../controllers/tournamentController.js";
import {
  createRegistration,
  getRegistrations,
} from "../controllers/registrationController.js";
import { getMatchesByTournament } from "../controllers/matchController.js";
import { uploadAvatars } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.route("/").get(getTournaments);
router.route("/:id").get(getTournamentById); // 💡  chi tiết
// sau này thêm POST / PUT / DELETE nếu cần
router
  .route("/:id/registrations")
  .post(createRegistration)
  .get(getRegistrations);

router.route("/:id/matches").get(getMatchesByTournament);
export default router;
