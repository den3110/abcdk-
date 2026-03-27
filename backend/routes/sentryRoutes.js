import express from "express";
import { sentryIssueWebhookHandler } from "../controllers/sentryWebhookController.js";

const router = express.Router();

router.post("/issues/webhook", sentryIssueWebhookHandler);

export default router;
