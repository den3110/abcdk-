import express from "express";
import {
  handleBotInfo,
  handleChat,
  handleChatStream,
  handleClearChatHistory,
  handleClearLearningMemory,
  handleGetChatHistory,
  handleHealthCheck,
} from "../controllers/chatBotController.js";
import { passProtect, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", passProtect, handleChat);
router.post("/stream", passProtect, handleChatStream);
router.get("/history", protect, handleGetChatHistory);
router.delete("/history", protect, handleClearChatHistory);
router.delete("/learning", protect, handleClearLearningMemory);
router.get("/health", handleHealthCheck);
router.get("/info", handleBotInfo);

export default router;
