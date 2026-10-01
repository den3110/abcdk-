import express from "express";
import { commentaryInfo, commentaryOffer } from "../controllers/commentaryController.js";

// Công khai (token-gated) — trình duyệt BLV gọi. Không cần đăng nhập PickleTour.
const router = express.Router();

router.get("/info/:token", commentaryInfo);
router.post("/offer", express.json({ limit: "256kb" }), commentaryOffer);

export default router;
