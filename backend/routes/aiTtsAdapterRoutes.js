import express from "express";

import {
  createAiTtsAdapterSpeech,
  getAiTtsAdapterModels,
} from "../controllers/aiTtsAdapterController.js";

const router = express.Router();

router.get("/models", getAiTtsAdapterModels);
router.post("/audio/speech", createAiTtsAdapterSpeech);

export default router;
