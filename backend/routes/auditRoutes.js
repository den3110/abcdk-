import express from "express";
import { authorize, protect } from "../middleware/authMiddleware.js";
import {
  getUserProfileAudit,
  getMyProfileAudit,
  getAuditDetail,
} from "../controllers/auditController.js";

const router = express.Router();

// user tự xem log của mình
router.get("/me", protect, getMyProfileAudit);

// super user xem log của user bất kỳ
router.get("/users/:userId", protect, authorize("admin"), getUserProfileAudit);

// chi tiết 1 log (tuỳ bạn: có thể chỉ superUser, hoặc cho user xem nếu log thuộc về họ)
router.get("/:id", protect, authorize("admin"), getAuditDetail);

export default router;
