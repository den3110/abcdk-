// routes/scheduleRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getMyMatchSchedule,
  getMatchesByDate,
  getUpcomingMatches,
  getMarkedDates,
} from "../controllers/scheduleController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// @route   GET /api/schedule/my-matches
router.get("/my-matches", getMyMatchSchedule);

// @route   GET /api/schedule/date/:date
router.get("/date/:date", getMatchesByDate);

// @route   GET /api/schedule/upcoming
router.get("/upcoming", getUpcomingMatches);

// @route   GET /api/schedule/marked-dates
router.get("/marked-dates", getMarkedDates);

export default router;
