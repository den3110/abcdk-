import express from "express";
import {
  updatePaymentStatus,
  checkinRegistration,
  cancelRegistration,
  updateRegistrationPayment,
  deleteRegistration,
  managerUpdateRegPlayerAvatar,
  managerReplacePlayer,
  joinAsPartner,
  searchRegistrations,
} from "../controllers/registrationController.js";
import { authorize, passProtect, protect } from "../middleware/authMiddleware.js";
import { canManageTournament } from "../utils/tournamentAuth.js";

const router = express.Router();

// router.patch("/:regId/payment", protect, updatePaymentStatus);
router.patch("/:regId/checkin", protect, checkinRegistration);
router.post("/:regId/cancel", protect, cancelRegistration);

router.patch("/:id/payment", protect, updateRegistrationPayment); // update payment
router.delete("/:id/admin", protect, deleteRegistration);
router.patch("/:regId/manager/player-avatar", protect, managerUpdateRegPlayerAvatar);
router.patch("/:regId/manager/replace-player", protect, managerReplacePlayer);
// VĐV tự bấm "Tham gia" ghép vào slot VĐV 2 của đăng ký đơn (giải đôi)
router.patch("/:regId/join-as-partner", protect, joinAsPartner);
router.get(
  "/:id/registrations/search",
  passProtect,
  searchRegistrations
);

export default router;
