import express from "express";
import { protect, authorize, adminOrCommentator } from "../middleware/authMiddleware.js";
import { registerMachine, listMachines, proxyCall, sessionRtsp } from "../controllers/liveControlController.js";
import { createCommentaryToken } from "../controllers/commentaryController.js";

const router = express.Router();
const admin = authorize("admin");

// Desktop app đăng ký máy (admin auth — desktop đã đăng nhập admin).
router.post("/register", protect, admin, express.json(), registerMachine);
// Liệt kê máy: admin + bình luận viên (BLV cần chọn máy để xem phiên).
router.get("/machines", protect, adminOrCommentator, listMachines);
// Proxy điều khiển: admin + BLV. BLV chỉ được path đọc (giới hạn trong proxyCall).
router.post("/:machineId/call", protect, adminOrCommentator, express.json(), proxyCall);
// Tạo liên kết bình luận viên: admin + BLV.
router.post("/:machineId/commentary-token", protect, adminOrCommentator, express.json(), createCommentaryToken);
// RTSP nguồn (chứa creds) — CHỈ admin, để xem trực tiếp mượt khi cùng Tailscale.
router.get("/:machineId/session-rtsp", protect, admin, sessionRtsp);

export default router;
