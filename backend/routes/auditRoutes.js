import express from "express";
import { authorize, protect } from "../middleware/authMiddleware.js";
import {
  getUserProfileAudit,
  getMyProfileAudit,
  getAuditDetail,
  getAuditUsersSummary,
} from "../controllers/auditController.js";

const router = express.Router();

// user tự xem log của mình
router.get("/me", protect, getMyProfileAudit);

// super user xem log của user bất kỳ
router.get("/users/summary", protect, authorize("admin"), getAuditUsersSummary);
router.get(
  "/users/:userId",
  protect,
  authorize("admin"),
  (req, res, next) => {
    const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;
    if (!OBJECT_ID_REGEX.test(String(req.params.userId || ""))) {
      return res.status(400).json({ message: "userId không hợp lệ" });
    }
    next();
  },
  getUserProfileAudit
);

// chi tiết 1 log (tuỳ bạn: có thể chỉ superUser, hoặc cho user xem nếu log thuộc về họ)
router.get("/:id", protect, authorize("admin"), getAuditDetail);

export default router;
