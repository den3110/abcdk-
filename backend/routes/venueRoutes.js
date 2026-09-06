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
import {
  listBlocks,
  createBlock,
  deleteBlock,
  listPromos,
  createPromo,
  updatePromo,
  deletePromo,
  validatePromo,
  createRecurring,
  myVenuesOverview,
} from "../controllers/venueOpsController.js";

const router = express.Router();

// Công khai
router.get("/", listVenues);
// "mine" phải đứng trước "/:id"
router.get("/mine", protect, listMyVenues);
router.get("/mine/overview", protect, myVenuesOverview);
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

// Khoá sân / bảo trì
router.get("/:id/blocks", protect, listBlocks);
router.post("/:id/blocks", protect, createBlock);
router.delete("/:id/blocks/:blockId", protect, deleteBlock);

// Mã giảm giá
router.get("/:id/promos", protect, listPromos);
router.post("/:id/promos", protect, createPromo);
router.patch("/:id/promos/:promoId", protect, updatePromo);
router.delete("/:id/promos/:promoId", protect, deletePromo);
router.get("/:id/promos/validate", validatePromo); // khách kiểm tra mã (public)

// Đặt định kỳ
router.post("/:id/recurring", protect, createRecurring);

export default router;
