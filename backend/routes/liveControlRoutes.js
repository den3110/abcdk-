import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { registerMachine, listMachines, proxyCall } from "../controllers/liveControlController.js";
import { createCommentaryToken } from "../controllers/commentaryController.js";

const router = express.Router();
const admin = authorize("admin");

// Desktop app đăng ký máy (admin auth — desktop đã đăng nhập admin).
router.post("/register", protect, admin, express.json(), registerMachine);
// App liệt kê máy + proxy điều khiển.
router.get("/machines", protect, admin, listMachines);
router.post("/:machineId/call", protect, admin, express.json(), proxyCall);
// Tạo liên kết bình luận viên (mic → luồng live) cho 1 sân đang live.
router.post("/:machineId/commentary-token", protect, admin, express.json(), createCommentaryToken);

export default router;
