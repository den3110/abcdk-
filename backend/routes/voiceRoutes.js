import express from "express";

import { parseVoiceCommandIntent } from "../controllers/voiceController.js";

const router = express.Router();

router.post("/parse", parseVoiceCommandIntent);

export default router;
