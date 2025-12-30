// routes/expoUpdatesRoutes.js
/**
 * Expo Updates Routes
 */

import { Router } from "express";
import multer from "multer";
import {
  getManifest,
  getAsset,
  uploadUpdate,
  listUpdates,
  rollback,
} from "../controllers/expoUpdatesController.js";

const router = Router();

// Multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max per file
});

// ============ CLIENT ENDPOINTS ============

// GET /api/expo-updates/manifest
// Main endpoint - expo-updates client calls this
router.get("/manifest", getManifest);

// GET /api/expo-updates/assets/:platform/:runtimeVersion/:updateId/*
// Serve assets (bundle, images, fonts)
router.get("/assets/:platform/:runtimeVersion/:updateId/*", getAsset);

// ============ ADMIN ENDPOINTS ============

// POST /api/expo-updates/upload
// Upload new update (multipart/form-data)
router.post("/upload", upload.array("files", 100), uploadUpdate);

// GET /api/expo-updates/updates/:platform/:runtimeVersion
// List all updates
router.get("/updates/:platform/:runtimeVersion", listUpdates);

// POST /api/expo-updates/rollback
// Rollback to specific update
router.post("/rollback", rollback);

export default router;