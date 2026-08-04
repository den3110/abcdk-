// routes/adminFeedRoutes.js — moderation
import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  adminListPosts,
  adminPatchPost,
  adminDeletePost,
  adminListReports,
  adminResolveReport,
} from "../controllers/feedController.js";

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/posts", adminListPosts);
router.patch("/posts/:id", adminPatchPost);
router.delete("/posts/:id", adminDeletePost);

router.get("/reports", adminListReports);
router.patch("/reports/:rid", adminResolveReport);

export default router;
