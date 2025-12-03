import express from "express";
import { handleChat } from "../controllers/chatBotController.js";
import { passProtect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", passProtect, handleChat);

export default router;
