// routes/notificationCenterRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  clearAll,
} from "../controllers/notificationCenterController.js";

const router = express.Router();
router.use(protect);

router.get("/", listNotifications);
router.get("/unread-count", unreadCount);
router.post("/read-all", markAllRead);
router.delete("/clear-all", clearAll);
router.post("/:id/read", markRead);
router.delete("/:id", deleteNotification);

export default router;
