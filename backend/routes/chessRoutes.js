// routes/chessRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listChessRooms,
  createChessRoom,
  getChessRoom,
  sitChessRoom,
  leaveChessRoom,
  startChessHand,
  chessMove,
  chessResign,
  chatChessRoom,
  inviteChessRoom,
} from "../controllers/chessController.js";

const router = express.Router();

router.get("/rooms", listChessRooms);
router.post("/rooms", protect, createChessRoom);
router.get("/rooms/:id", protect, getChessRoom);
router.post("/rooms/:id/sit", protect, sitChessRoom);
router.post("/rooms/:id/leave", protect, leaveChessRoom);
router.post("/rooms/:id/start", protect, startChessHand);
router.post("/rooms/:id/move", protect, chessMove);
router.post("/rooms/:id/resign", protect, chessResign);
router.post("/rooms/:id/chat", protect, chatChessRoom);
router.post("/rooms/:id/invite", protect, inviteChessRoom);

export default router;
