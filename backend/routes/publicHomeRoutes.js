// routes/publicHomeRoutes.js
import express from "express";
import { getHomeSummary } from "../controllers/homeController.js";

const router = express.Router();

// /api/public/home
router.get("/home", getHomeSummary);

export default router;
