import express from "express";
import { handleBotInfo, handleChat, handleClearChatHistory, handleGetChatHistory, handleHealthCheck } from "../controllers/chatBotController.js";
import { passProtect, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", passProtect, handleChat);
router.get("/history", protect, handleGetChatHistory);
router.delete("/history", protect, handleClearChatHistory);
// router.delete("/history", protect, handleDeleteC);
router.get("/health", handleHealthCheck);
router.get("/info", handleBotInfo);

export default router;
