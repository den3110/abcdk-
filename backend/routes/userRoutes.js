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
  issueOsAuthToken,
  reauthUser,
  getKycCheckData,
  updateKycStatus,
  getAdminUsers,
  verifyRegisterOtp,
  resendRegisterOtp,
  registerUserNotOTP,
} from "../controllers/userController.js";
import {
  authorize,
  passProtect,
  protect,
  superUser,
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
import {
  breakdown,
  heatmap,
  overview,
  profile,
  series,
  top,
} from "../controllers/userStatsController.js";
import { loadConfig } from "../middleware/versionGate.js";
import { isWebRequest } from "../utils/isWebRequest.js";

const router = express.Router();

// router.post("/", registerUser);
router.post("/", async (req, res, next) => {
  try {
    const ctrl = isWebRequest(req);
    const appVersion = await loadConfig(); // <-- điều kiện của bạn
    if (appVersion.ios.minSupportedBuild < 22 && ctrl !== true) {
      return await registerUserNotOTP(req, res, next); // controller 2
    } else {
      return await registerUser(req, res, next); // controller 1
    }
  } catch (e) {
    next(e);
  }
});

router.post("/register/verify-otp", verifyRegisterOtp);
router.post("/register/resend-otp", resendRegisterOtp);
router.get("/reauth", protect, reauthUser);
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
router.post("/auth/os-auth-token", protect, issueOsAuthToken);
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

router.get("/stats/:uid/stats/overview", protect, overview);
router.get("/stats/:uid/stats/series", protect, series);
router.get("/stats/:uid/stats/breakdown", protect, breakdown);
router.get("/stats/:uid/stats/heatmap", protect, heatmap);
router.get("/stats/:uid/stats/top", protect, top);
router.get("/stats/:uid/stats/profile", protect, profile);
router.get("/kyc/status/:id", protect, getKycCheckData);
router.put("/kyc/status/:id", protect, authorize("admin"), updateKycStatus);

router.get("/get/all", protect, authorize("admin"), superUser, getAdminUsers);

export default router;
