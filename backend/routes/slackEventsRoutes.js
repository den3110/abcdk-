import express from "express";
import { slackEventsHandler } from "../controllers/slackEventsController.js";
import { verifySlackRequest } from "../middleware/verifySlack.js";

const router = express.Router();

// QUAN TRỌNG: phải dùng raw để verify signature chuẩn
router.post(
  "/events",
  // , verifySlackRequest
  slackEventsHandler
);

export default router;
