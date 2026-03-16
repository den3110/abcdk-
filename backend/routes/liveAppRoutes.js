import express from "express";
import { createLiveSessionForLiveApp } from "../controllers/liveAppController.js";

const router = express.Router();

router.post("/matches/:matchId/live/create", createLiveSessionForLiveApp);

export default router;

