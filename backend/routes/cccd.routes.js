// routes/cccd.routes.js
import express from "express";
import multer from "multer";
import { extractCCCD, getCCCDResult } from "../controllers/cccd.controller.js";
import { extractCCCDOpenAI } from "../controllers/cccd.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/cccd/extract  (form-data: image=@/path/to/file.jpg)
router.post("/extract", upload.single("image"), extractCCCD);

router.post("/extract-openai", upload.single("image"), extractCCCDOpenAI);

// GET /api/cccd/result/:id
router.get("/result/:id", getCCCDResult);

export default router;
