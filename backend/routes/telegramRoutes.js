// routes/telegram.js  (ESM)
import { Router } from "express";
import { telegramWebhook } from "../controllers/telegramWebhook.js";

const router = Router();
router.post("/webhook", telegramWebhook);
export default router;
