import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { listMyPackages } from "../controllers/venuePackageController.js";

const router = express.Router();

router.get("/mine", protect, listMyPackages);

export default router;
