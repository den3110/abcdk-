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
  approvePartner,
  rejectPartner,
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
// VĐV gửi yêu cầu ghép cặp vào đăng ký đơn (giải đôi) — chờ VĐV 1 duyệt
router.patch("/:regId/join-as-partner", protect, joinAsPartner);
// VĐV 1 duyệt / từ chối 1 người trong danh sách xin ghép
router.patch("/:regId/approve-partner", protect, approvePartner);
router.patch("/:regId/reject-partner", protect, rejectPartner);
router.get(
  "/:id/registrations/search",
  passProtect,
  searchRegistrations
);

export default router;
