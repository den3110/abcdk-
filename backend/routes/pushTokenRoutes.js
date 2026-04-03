// src/routes/pushTokenRoutes.js
import { Router } from "express";
import {
  disableAllMyTokens,
  registerPushToken,
  syncMyLiveActivities,
  unregisterMyDeviceToken,
} from "../controllers/pushTokenController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/me/push-token", protect, registerPushToken);
router.post("/me/live-activities/sync", protect, syncMyLiveActivities);
router.delete("/me/push-token", protect, unregisterMyDeviceToken);  // 👈 logout 1 thiết bị
router.delete("/me/push-token/all", protect, disableAllMyTokens);   // 👈 tắt tất cả (tùy chọn)
export default router;
