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
  listRecurringGroups,
  updateRecurringGroup,
  cancelRecurringGroup,
  myVenuesOverview,
} from "../controllers/venueOpsController.js";
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  createSale,
  listSales,
} from "../controllers/venuePosController.js";
import {
  listPackages,
  createPackage,
  updatePackage,
  deletePackage,
  purchasePackage,
  listVenuePurchases,
  activatePurchase,
} from "../controllers/venuePackageController.js";
import { getVenueAnalytics } from "../controllers/venueAnalyticsController.js";
import {
  toggleFavoriteVenue,
  listFavoriteVenues,
  getVenueWeather,
  getVenueNoShowReport,
} from "../controllers/bookingExtraController.js";
import {
  createEvent,
  updateEvent,
  cancelEvent,
  listVenueEvents,
  listEventRegistrations,
  updateRegistration,
} from "../controllers/venueEventController.js";
import {
  listStaff,
  addStaff,
  updateStaff,
  removeStaff,
  getMyVenueAccess,
} from "../controllers/venueStaffController.js";
import { attachJwtIfPresent } from "../middleware/authMiddleware.js";

const router = express.Router();

// Công khai
router.get("/", listVenues);
// "mine"/"favorites" phải đứng trước "/:id"
router.get("/mine", protect, listMyVenues);
router.get("/mine/overview", protect, myVenuesOverview);
router.get("/favorites/mine", protect, listFavoriteVenues);
router.post("/", protect, createVenue);

router.get("/:id", getVenueById);
// Sân yêu thích + thời tiết + báo cáo no-show
router.post("/:id/favorite", protect, toggleFavoriteVenue);
router.get("/:id/weather", getVenueWeather);
router.get("/:id/no-show-report", protect, getVenueNoShowReport);
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

// Đặt định kỳ / lịch cố định
router.get("/:id/recurring", protect, listRecurringGroups);
router.post("/:id/recurring", protect, createRecurring);
router.patch("/:id/recurring/:group", protect, updateRecurringGroup);
router.delete("/:id/recurring/:group", protect, cancelRecurringGroup);

// Bán hàng / kho (POS)
router.get("/:id/products", protect, listProducts);
router.post("/:id/products", protect, createProduct);
router.patch("/:id/products/:productId", protect, updateProduct);
router.delete("/:id/products/:productId", protect, deleteProduct);
router.get("/:id/sales", protect, listSales);
router.post("/:id/sales", protect, createSale);

// Gói giờ / thẻ tháng
router.get("/:id/packages", attachJwtIfPresent, listPackages); // public (active) hoặc owner all=1
router.post("/:id/packages", protect, createPackage);
router.patch("/:id/packages/:packageId", protect, updatePackage);
router.delete("/:id/packages/:packageId", protect, deletePackage);
router.post("/:id/packages/:packageId/purchase", protect, purchasePackage);
router.get("/:id/package-purchases", protect, listVenuePurchases);
router.patch("/:id/package-purchases/:purchaseId/activate", protect, activatePurchase);

// Phân tích lấp đầy + doanh thu gộp
router.get("/:id/analytics", protect, getVenueAnalytics);

// Sự kiện xé vé / social (chủ sân)
router.get("/:id/events", protect, listVenueEvents);
router.post("/:id/events", protect, createEvent);
router.patch("/:id/events/:eventId", protect, updateEvent);
router.delete("/:id/events/:eventId", protect, cancelEvent);
router.get("/:id/events/:eventId/registrations", protect, listEventRegistrations);
router.patch("/:id/events/:eventId/registrations/:regId", protect, updateRegistration);

// Nhân viên & phân quyền
router.get("/:id/my-access", protect, getMyVenueAccess);
router.get("/:id/staff", protect, listStaff);
router.post("/:id/staff", protect, addStaff);
router.patch("/:id/staff/:staffId", protect, updateStaff);
router.delete("/:id/staff/:staffId", protect, removeStaff);

export default router;
