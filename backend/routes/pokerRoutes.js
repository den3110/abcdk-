// routes/pokerRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listPokerRooms,
  createPokerRoom,
  getPokerRoom,
  sitPokerRoom,
  leavePokerRoom,
  startPokerHand,
  pokerAction,
  chatPokerRoom,
  emojiPokerRoom,
  revealPokerCards,
  invitePokerRoom,
} from "../controllers/pokerController.js";

const router = express.Router();

router.get("/rooms", listPokerRooms);
router.post("/rooms", protect, createPokerRoom);
router.get("/rooms/:id", protect, getPokerRoom);
router.post("/rooms/:id/sit", protect, sitPokerRoom);
router.post("/rooms/:id/leave", protect, leavePokerRoom);
router.post("/rooms/:id/start", protect, startPokerHand);
router.post("/rooms/:id/action", protect, pokerAction);
router.post("/rooms/:id/chat", protect, chatPokerRoom);
router.post("/rooms/:id/emoji", protect, emojiPokerRoom);
router.post("/rooms/:id/reveal", protect, revealPokerCards);
router.post("/rooms/:id/invite", protect, invitePokerRoom);

export default router;
