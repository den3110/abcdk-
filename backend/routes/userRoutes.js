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
  getMyRank,
  syncWebViewSession,
  getKycCheckData,
  updateKycStatus,
  getAdminUsers,
  verifyRegisterOtp,
  resendRegisterOtp,
  registerUserNotOTP,
  requestPhoneOtp,
  verifyPhoneOtp,
} from "../controllers/userController.js";
import {
  authorize,
  passProtect,
  protect,
  superUser,
} from "../middleware/authMiddleware.js";
import {
  adjustMatchRatingAlpha,
  adjustMatchRatingTarget,
  getMatchHistory,
  getRatingHistory,
  restoreMatchRatingTarget,
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
// import { resendLoginOtp, verifyLoginOtp } from "../controllers/userLoginController.js"; // OTP tạm tắt
import { authUserWebNoOtp } from "../controllers/userLoginNoOtpController.js";
import { authLog } from "../middleware/authLogMiddleware.js";
import {
  getNotificationPrefs,
  patchNotificationPrefs,
} from "../controllers/notificationPrefsController.js";

const router = express.Router();

// Đăng ký: registerUser tự gate theo SystemSettings.zaloZns.enabled —
// bật ZNS thì chạy luồng OTP, tắt thì delegate registerUserNotOTP (không OTP).
router.post("/", authLog({ action: "register" }), registerUser);
router.post("/register/verify-otp", verifyRegisterOtp);
router.post("/register/resend-otp", resendRegisterOtp);

// Kích hoạt / đổi SĐT cho tài khoản đã đăng nhập
router.post("/phone/request-otp", protect, requestPhoneOtp);
router.post("/phone/verify-otp", protect, verifyPhoneOtp);
// router.post("/login-otp/resend", resendLoginOtp);
// router.post("/login-otp/verify", verifyLoginOtp);

router.get("/reauth", protect, reauthUser);
router.get("/me/rank", protect, getMyRank);
router.post("/webview/session", protect, syncWebViewSession);
router.post("/auth", authLog({ action: "login", channel: "mobile" }), authUser); // mobile
router.post("/auth/web", authLog({ action: "login", channel: "web" }), authUserWebNoOtp); // web — OTP tạm tắt (cũ: authUserWeb)
router.post("/logout", logoutUser);
router.get("/:id/public", passProtect, getPublicProfile);
router.get("/:id/ratings", passProtect, getRatingHistory);
router.get("/:userId/achievements", passProtect, getUserAchievements);
router.post(
  "/:id/matches/rating-target",
  protect,
  superUser,
  adjustMatchRatingTarget,
);
router.post(
  "/:id/matches/rating-target/restore",
  protect,
  superUser,
  restoreMatchRatingTarget,
);
router.post(
  "/:id/matches/:matchId/rating-alpha",
  protect,
  superUser,
  adjustMatchRatingAlpha,
);
router.get("/:id/matches", getMatchHistory);
router.get("/me/score", protect, getMeWithScore);

router
  .route("/notification-prefs")
  .get(protect, getNotificationPrefs)
  .patch(protect, patchNotificationPrefs);

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
  deleteRatingHistoryItem,
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
