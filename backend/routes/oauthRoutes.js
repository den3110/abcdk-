import { Router } from "express";
import { ytCallback } from "../controllers/youtubeSetupController.js";

const router = Router();

router.get("/google/youtube/callback", ytCallback); // public callback


export default router;
