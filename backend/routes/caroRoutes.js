// routes/caroRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listCaroRooms,
  createCaroRoom,
  getCaroRoom,
  sitCaroRoom,
  leaveCaroRoom,
  startCaroHand,
  caroMove,
  chatCaroRoom,
  emojiCaroRoom,
  inviteCaroRoom,
} from "../controllers/caroController.js";

const router = express.Router();

router.get("/rooms", listCaroRooms);
router.post("/rooms", protect, createCaroRoom);
router.get("/rooms/:id", protect, getCaroRoom);
router.post("/rooms/:id/sit", protect, sitCaroRoom);
router.post("/rooms/:id/leave", protect, leaveCaroRoom);
router.post("/rooms/:id/start", protect, startCaroHand);
router.post("/rooms/:id/move", protect, caroMove);
router.post("/rooms/:id/chat", protect, chatCaroRoom);
router.post("/rooms/:id/emoji", protect, emojiCaroRoom);
router.post("/rooms/:id/invite", protect, inviteCaroRoom);

export default router;
