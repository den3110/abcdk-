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
} from "../controllers/pokerController.js";

const router = express.Router();

router.get("/rooms", listPokerRooms);
router.post("/rooms", protect, createPokerRoom);
router.get("/rooms/:id", protect, getPokerRoom);
router.post("/rooms/:id/sit", protect, sitPokerRoom);
router.post("/rooms/:id/leave", protect, leavePokerRoom);
router.post("/rooms/:id/start", protect, startPokerHand);
router.post("/rooms/:id/action", protect, pokerAction);

export default router;
