import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  createBooking,
  listMyBookings,
  getBooking,
  updateBookingStatus,
  setBookingPayment,
  submitPaymentProof,
  approveBooking,
  rejectBooking,
  checkInBooking,
} from "../controllers/bookingController.js";

const router = express.Router();

router.post("/", protect, createBooking);
router.get("/mine", protect, listMyBookings);
// Chủ sân quét vé QR → check-in (đặt TRƯỚC /:id)
router.post("/checkin", protect, checkInBooking);
router.get("/:id", protect, getBooking);
router.patch("/:id/status", protect, updateBookingStatus);
router.patch("/:id/payment", protect, setBookingPayment);
// Khách gửi bill chuyển khoản → chờ duyệt
router.post("/:id/payment-proof", protect, submitPaymentProof);
// Chủ sân duyệt / từ chối bill
router.patch("/:id/approve", protect, approveBooking);
router.patch("/:id/reject", protect, rejectBooking);

export default router;
