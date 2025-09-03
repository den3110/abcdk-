import express from "express";
import { setMatchLive } from "../controllers/matchController.js";
import { isManagerTournament, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.patch("/:id/live", protect, isManagerTournament, setMatchLive);

export default router;
