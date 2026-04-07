import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  getAzureStatus,
  toggleVmState,
  getAzureBilling,
} from "../controllers/azureAdmin.controller.js";

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/status", getAzureStatus);
router.post("/vm/toggle", toggleVmState);
router.get("/billing", getAzureBilling);

export default router;
