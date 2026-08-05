// routes/coachRoutes.js — Huấn luyện viên (public directory).
import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import { listCoaches, listCoachProvinces } from "../controllers/coachController.js";

const router = express.Router();

router.get("/provinces", optionalAuth, listCoachProvinces);
router.get("/", optionalAuth, listCoaches);

export default router;
