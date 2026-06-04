import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  createBooking,
  listMyBookings,
  updateBookingStatus,
  setBookingPayment,
} from "../controllers/bookingController.js";

const router = express.Router();

router.post("/", protect, createBooking);
router.get("/mine", protect, listMyBookings);
router.patch("/:id/status", protect, updateBookingStatus);
router.patch("/:id/payment", protect, setBookingPayment);

export default router;
