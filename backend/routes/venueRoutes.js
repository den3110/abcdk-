import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listVenues,
  getVenueById,
  listMyVenues,
  createVenue,
  updateVenue,
  deleteVenue,
  addCourt,
  updateCourt,
  deleteCourt,
} from "../controllers/venueController.js";
import {
  getAvailability,
  listVenueBookings,
  getVenueRevenue,
} from "../controllers/bookingController.js";

const router = express.Router();

// Công khai
router.get("/", listVenues);
// "mine" phải đứng trước "/:id"
router.get("/mine", protect, listMyVenues);
router.post("/", protect, createVenue);

router.get("/:id", getVenueById);
router.put("/:id", protect, updateVenue);
router.delete("/:id", protect, deleteVenue);

router.get("/:id/availability", getAvailability);
router.get("/:id/bookings", protect, listVenueBookings);
router.get("/:id/revenue", protect, getVenueRevenue);

router.post("/:id/courts", protect, addCourt);
router.put("/:id/courts/:courtId", protect, updateCourt);
router.delete("/:id/courts/:courtId", protect, deleteCourt);

export default router;
