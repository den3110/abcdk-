// routes/networkAccessRoutes.js — Pickletour Network (vé vào tailnet).
import express from "express";
import { protect, adminOrNetworkAccess } from "../middleware/authMiddleware.js";
import {
  networkStatus,
  createNetworkSession,
} from "../controllers/networkAccessController.js";

const router = express.Router();

// Trạng thái: user có được phép + dịch vụ đã cấu hình chưa (mọi user đã đăng nhập).
router.get("/status", protect, networkStatus);
// Cấp auth key: chỉ admin hoặc user được cấp quyền Pickletour Network.
router.post("/session", protect, adminOrNetworkAccess, createNetworkSession);

export default router;
