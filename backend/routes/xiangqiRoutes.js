// routes/xiangqiRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listXiangqiRooms,
  createXiangqiRoom,
  getXiangqiRoom,
  sitXiangqiRoom,
  leaveXiangqiRoom,
  startXiangqiHand,
  xiangqiMove,
  xiangqiResign,
  chatXiangqiRoom,
  inviteXiangqiRoom,
} from "../controllers/xiangqiController.js";

const router = express.Router();

router.get("/rooms", listXiangqiRooms);
router.post("/rooms", protect, createXiangqiRoom);
router.get("/rooms/:id", protect, getXiangqiRoom);
router.post("/rooms/:id/sit", protect, sitXiangqiRoom);
router.post("/rooms/:id/leave", protect, leaveXiangqiRoom);
router.post("/rooms/:id/start", protect, startXiangqiHand);
router.post("/rooms/:id/move", protect, xiangqiMove);
router.post("/rooms/:id/resign", protect, xiangqiResign);
router.post("/rooms/:id/chat", protect, chatXiangqiRoom);
router.post("/rooms/:id/invite", protect, inviteXiangqiRoom);

export default router;
