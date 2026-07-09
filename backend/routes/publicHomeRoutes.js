// routes/publicHomeRoutes.js
import express from "express";
import { getHomeSummary, getHomePulse } from "../controllers/homeController.js";

const router = express.Router();

// /api/public/home
router.get("/home", getHomeSummary);
// /api/public/home/pulse — dữ liệu "sống" cho trang chủ v2 (Astryx)
router.get("/home/pulse", getHomePulse);

export default router;
