// backend/routes/cmsRoutes.js
import express from "express";
import { getContact, getHero, updateContact, updateHero } from "../controllers/cmsController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/hero", getHero);
router.put("/hero", protect, authorize("admin"), updateHero); // chỉ admin được update

// 🆕 Contact
router.get("/contact", getContact);
router.put("/contact", protect, authorize("admin"), updateContact);


export default router;
