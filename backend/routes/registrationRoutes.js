import express from "express";
import {
  updatePaymentStatus,
  checkinRegistration,
  cancelRegistration,
  updateRegistrationPayment,
  deleteRegistration,
  managerReplacePlayer,
} from "../controllers/registrationController.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// router.patch("/:regId/payment", protect, updatePaymentStatus);
router.patch("/:regId/checkin", protect, checkinRegistration);
router.post("/:regId/cancel", protect, cancelRegistration);

router.patch("/:id/payment", protect, authorize("admin"), updateRegistrationPayment);
router.delete("/:id/admin", protect, authorize("admin"), deleteRegistration);
router.patch("/:regId/manager/replace-player", protect, managerReplacePlayer);

export default router;
