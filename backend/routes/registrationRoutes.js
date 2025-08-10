import express from "express";
import {
  updatePaymentStatus,
  checkinRegistration,
  cancelRegistration,
} from "../controllers/registrationController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.patch("/:regId/payment", protect, updatePaymentStatus);
router.patch("/:regId/checkin", protect, checkinRegistration);
router.post("/:regId/cancel", protect, cancelRegistration);

export default router;
