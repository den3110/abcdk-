import express from "express";
import {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  getPublicProfile,
  searchUser,
  listMyTournaments,
  softDeleteMe,
  getMe,
  createEvaluation,
  authUserWeb,
  getMeWithScore,
} from "../controllers/userController.js";
import {
  authorize,
  passProtect,
  protect,
} from "../middleware/authMiddleware.js";
import {
  getMatchHistory,
  getRatingHistory,
} from "../controllers/profileController.js";
import {
  deleteRatingHistoryItem,
  forgotPassword,
  resetPassword,
  verifyResetOtp,
} from "../controllers/passwordController.js";
import { simpleRateLimit } from "../middleware/rateLimit.js";
import { getUserAchievements } from "../controllers/achievements.controller.js";

const router = express.Router();

router.post("/", registerUser);
router.post("/auth", authUser); // mobile
router.post("/auth/web", authUserWeb); // web
router.post("/logout", logoutUser);
router.get("/:id/public", passProtect, getPublicProfile);
router.get("/:id/ratings", passProtect, getRatingHistory);
router.get("/:userId/achievements", passProtect, getUserAchievements);
router.get("/:id/matches", getMatchHistory);
router.get("/me/score", protect, getMeWithScore);

router
  .route("/profile")
  .get(protect, getUserProfile)
  .put(protect, updateUserProfile);

router.get("/search", searchUser);

router.get("/tournaments", protect, listMyTournaments);
router.delete("/me", protect, softDeleteMe);
router.get("/me", protect, getMe);
router.post("/evaluations", protect, createEvaluation);

router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", simpleRateLimit(60_000, 5), resetPassword);

router.delete(
  "/:userId/rating-history/:historyId",
  protect,
  authorize("admin"),
  deleteRatingHistoryItem
);

export default router;
