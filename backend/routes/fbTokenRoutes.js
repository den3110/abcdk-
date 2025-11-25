// routes/fbTokenRoutes.js
import express from "express";
import {
  listFbTokens,
  checkOneFbToken,
  checkAllFbTokens,
  markNeedsReauth,
  clearBusyFlag,
  disableFbToken,
  enableFbToken,
} from "../controllers/fbTokenController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// List + filter
router.get("/", protect, authorize("admin"), listFbTokens);

// Check 1 page (by Mongo _id or pageId)
router.post("/:id/check", protect, authorize("admin"), checkOneFbToken);

// Check all pages (chunked to avoid rate limit)
router.post("/~batch/check-all", protect, authorize("admin"), checkAllFbTokens);

// Manual flags
router.post("/:id/mark-reauth", protect, authorize("admin"), markNeedsReauth);
router.post("/:id/clear-busy", protect, authorize("admin"), clearBusyFlag);

router.post("/:id/disable", protect, authorize("admin"), disableFbToken);
router.post("/:id/enable", protect, authorize("admin"), enableFbToken);

export default router;
