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
import { canManageTournament } from "../utils/tournamentAuth.js";

const router = express.Router();

// router.patch("/:regId/payment", protect, updatePaymentStatus);
router.patch("/:regId/checkin", protect, checkinRegistration);
router.post("/:regId/cancel", protect, cancelRegistration);

router.patch("/:id/payment", protect, updateRegistrationPayment); // update payment
router.delete("/:id/admin", protect, deleteRegistration);
router.patch("/:regId/manager/replace-player", protect, managerReplacePlayer);

export default router;
