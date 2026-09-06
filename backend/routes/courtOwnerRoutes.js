import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getMyRequest,
  submitRequest,
} from "../controllers/courtOwnerController.js";

const router = express.Router();

router.get("/request/mine", protect, getMyRequest);
router.post("/request", protect, submitRequest);

export default router;
