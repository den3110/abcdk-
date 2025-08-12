import express from "express";
import {
  updatePaymentStatus,
  checkinRegistration,
  cancelRegistration,
  updateRegistrationPayment,
  deleteRegistration,
} from "../controllers/registrationController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// router.patch("/:regId/payment", protect, updatePaymentStatus);
router.patch("/:regId/checkin", protect, checkinRegistration);
router.post("/:regId/cancel", protect, cancelRegistration);

router.patch("/:id/payment", protect, updateRegistrationPayment);
router.delete("/:id/admin", protect, deleteRegistration);

export default router;
