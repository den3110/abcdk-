import express from "express";
import {
  handleBotInfo,
  handleChat,
  handleChatStream,
  handleClearChatHistory,
  handleClearLearningMemory,
  handleChatFeedback,
  handleChatTelemetryEvent,
  handleChatTelemetrySummary,
  handleChatTelemetryTurns,
  handleGetChatRolloutConfig,
  handleUpdateChatRolloutConfig,
  handleGetChatHistory,
  handleHealthCheck,
} from "../controllers/chatBotController.js";
import { authorize, passProtect, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", passProtect, handleChat);
router.post("/stream", passProtect, handleChatStream);
router.post("/feedback", protect, handleChatFeedback);
router.post("/telemetry/event", passProtect, handleChatTelemetryEvent);
router.get("/rollout", protect, authorize("admin"), handleGetChatRolloutConfig);
router.put("/rollout", protect, authorize("admin"), handleUpdateChatRolloutConfig);
router.get("/history", protect, handleGetChatHistory);
router.delete("/history", protect, handleClearChatHistory);
router.delete("/learning", protect, handleClearLearningMemory);
router.get("/telemetry/summary", protect, authorize("admin"), handleChatTelemetrySummary);
router.get("/telemetry/turns", protect, authorize("admin"), handleChatTelemetryTurns);
router.get("/health", handleHealthCheck);
router.get("/info", handleBotInfo);

export default router;
