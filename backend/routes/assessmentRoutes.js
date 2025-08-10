// routes/assessmentRoutes.js
import express from "express";
import {
  createAssessment,
  getLatestAssessment,
  getAssessmentHistory,
  updateAssessment,
} from "../controllers/assessmentController.js";
import { canScore, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/:userId", protect, canScore, createAssessment);
router.get("/:userId/latest", protect, getLatestAssessment);
router.get("/:userId/history", protect, getAssessmentHistory);
router.put("/:id", protect, updateAssessment); // bạn có thể thêm check role

export default router;
