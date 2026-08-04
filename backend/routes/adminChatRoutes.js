// routes/adminChatRoutes.js — moderation nhắn tin
import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  adminListConversations,
  adminListMessages,
  adminPatchConversation,
  adminDeleteMessage,
} from "../controllers/chatController.js";

const router = express.Router();
router.use(protect, authorize("admin"));

router.get("/conversations", adminListConversations);
router.get("/conversations/:cid/messages", adminListMessages);
router.patch("/conversations/:cid", adminPatchConversation);
router.delete("/messages/:mid", adminDeleteMessage);

export default router;
