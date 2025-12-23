import express from "express";
import { slackEventsHandler } from "../controllers/slackEventsController.js";

const router = express.Router();

// QUAN TRỌNG: phải dùng raw để verify signature chuẩn
router.post("/events", slackEventsHandler);

export default router;
