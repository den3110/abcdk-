// routes/emailRoutes.js — endpoint công khai cho email (hủy nhận).
import express from "express";
import { unsubscribeEmail } from "../controllers/admin/emailCampaignController.js";

const router = express.Router();

// GET /api/email/unsubscribe?u=<token>
router.get("/unsubscribe", unsubscribeEmail);

export default router;
