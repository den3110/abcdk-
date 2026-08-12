// routes/phomRoutes.js — Phỏm (Tá lả)
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listPhomRooms,
  createPhomRoom,
  getPhomRoom,
  sitPhomRoom,
  leavePhomRoom,
  startPhomHand,
  phomAction,
  chatPhomRoom,
  emojiPhomRoom,
  invitePhomRoom,
} from "../controllers/phomController.js";

const router = express.Router();

router.get("/rooms", listPhomRooms);
router.post("/rooms", protect, createPhomRoom);
router.get("/rooms/:id", protect, getPhomRoom);
router.post("/rooms/:id/sit", protect, sitPhomRoom);
router.post("/rooms/:id/leave", protect, leavePhomRoom);
router.post("/rooms/:id/start", protect, startPhomHand);
router.post("/rooms/:id/action", protect, phomAction);
router.post("/rooms/:id/chat", protect, chatPhomRoom);
router.post("/rooms/:id/emoji", protect, emojiPhomRoom);
router.post("/rooms/:id/invite", protect, invitePhomRoom);

export default router;
