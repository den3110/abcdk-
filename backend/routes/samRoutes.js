// routes/samRoutes.js — Sâm Lốc
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listSamRooms,
  createSamRoom,
  getSamRoom,
  sitSamRoom,
  leaveSamRoom,
  startSamHand,
  samAction,
  chatSamRoom,
  emojiSamRoom,
  inviteSamRoom,
  xinSam,
  batSam,
  skipXinSam,
} from "../controllers/samController.js";

const router = express.Router();

router.get("/rooms", listSamRooms);
router.post("/rooms", protect, createSamRoom);
router.get("/rooms/:id", protect, getSamRoom);
router.post("/rooms/:id/sit", protect, sitSamRoom);
router.post("/rooms/:id/leave", protect, leaveSamRoom);
router.post("/rooms/:id/start", protect, startSamHand);
router.post("/rooms/:id/action", protect, samAction);
router.post("/rooms/:id/chat", protect, chatSamRoom);
router.post("/rooms/:id/emoji", protect, emojiSamRoom);
router.post("/rooms/:id/invite", protect, inviteSamRoom);
router.post("/rooms/:id/xin-sam", protect, xinSam);
router.post("/rooms/:id/bat-sam", protect, batSam);
router.post("/rooms/:id/skip-xin-sam", protect, skipXinSam);

export default router;
