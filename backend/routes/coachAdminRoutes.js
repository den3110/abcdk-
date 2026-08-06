// routes/coachAdminRoutes.js — Admin duyệt HLV + achievements.
import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
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
router.use(protect, authorize("admin"));

router.get("/applications", adminListCoachApplications);
router.post("/applications/:id/approve", adminApproveCoachApplication);
router.post("/applications/:id/reject", adminRejectCoachApplication);

router.get("/achievements", adminListCoachAchievements);
router.post("/achievements", adminCreateCoachAchievement);
router.post("/achievements/:id/approve", adminApproveCoachAchievement);
router.post("/achievements/:id/reject", adminRejectCoachAchievement);
router.patch("/achievements/:id", adminUpdateCoachAchievement);

export default router;
