import express from "express";
import { handleBotInfo, handleChat, handleGetChatHistory, handleHealthCheck } from "../controllers/chatBotController.js";
import { passProtect, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", passProtect, handleChat);
router.get("/history", protect, handleGetChatHistory);
router.get("/health", handleHealthCheck);
router.get("/info", handleBotInfo);

export default router;
