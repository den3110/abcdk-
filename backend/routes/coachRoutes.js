// routes/coachRoutes.js — Huấn luyện viên (public + user + admin).
import express from "express";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import {
  listCoaches,
  listCoachProvinces,
  applyToBeCoach,
  getMyCoachApplication,
  cancelMyCoachApplication,
  listCoachAchievements,
  createCoachAchievement,
  deleteMyCoachAchievement,
  adminListCoachApplications,
  adminApproveCoachApplication,
  adminRejectCoachApplication,
  adminListCoachAchievements,
  adminApproveCoachAchievement,
  adminRejectCoachAchievement,
  adminUpdateCoachAchievement,
  adminCreateCoachAchievement,
} from "../controllers/coachController.js";

const router = express.Router();

/* Public + user */
router.get("/provinces", optionalAuth, listCoachProvinces);
router.get("/my-application", protect, getMyCoachApplication);
router.delete("/my-application", protect, cancelMyCoachApplication);
router.post("/apply", protect, applyToBeCoach);
router.get("/:userId/achievements", optionalAuth, listCoachAchievements);
router.post("/achievements", protect, createCoachAchievement);
router.delete("/achievements/:id", protect, deleteMyCoachAchievement);
router.get("/", optionalAuth, listCoaches);

export default router;
