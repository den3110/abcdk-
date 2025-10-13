import express from "express";
import {
  adminListSponsors,
  adminGetSponsor,
  adminCreateSponsor,
  adminUpdateSponsor,
  adminDeleteSponsor,
  adminReorderSponsors,
} from "../controllers/sponsorController.js";
// Giả sử bạn đã có middleware protect/admin
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();


router.use(protect, authorize("admin")); // Tất cả route dưới đây đều cần admin
router.get("/", adminListSponsors);
router.post("/", adminCreateSponsor);
router.get("/:id", adminGetSponsor);
router.put("/:id", adminUpdateSponsor);
router.delete("/:id", adminDeleteSponsor);
router.post("/reorder", adminReorderSponsors);

export default router;
