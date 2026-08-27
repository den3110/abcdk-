// routes/nameStyleRoutes.js — Bản đồ hiệu ứng tên VĐV (public, đọc-only)
import express from "express";
import { getNameStyles } from "../controllers/nameStyleController.js";

const router = express.Router();

// GET /api/name-styles
router.get("/", getNameStyles);

export default router;
