// src/routes/subscriptionsRoutes.js
import { Router } from "express";
import {
  subscribe,
  unsubscribe,
  listMySubscriptions,
} from "../controllers/subscriptionsController.js";

const router = Router();
router.post("/", subscribe);
router.delete("/", unsubscribe);
router.get("/me/subscriptions", listMySubscriptions);
export default router;
