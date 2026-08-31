// routes/eventLiveRoutes.js — Xem live giải đấu (public, read-only)
import express from "express";
import {
  getEventLive,
  getEventLiveConfigPublic,
} from "../controllers/eventLiveController.js";

const router = express.Router();

router.get("/", getEventLive);
router.get("/config", getEventLiveConfigPublic);

export default router;
