// routes/otaRoutes.js
import { Router } from "express";
import multer from "multer";
import {
  checkOtaUpdate,
  reportUpdateStatus,
  uploadOtaBundle,
  listOtaVersions,
  getOtaLatest,
  rollbackOta,
  deactivateOtaVersion,
  downloadOtaBundle,
  getOtaAnalytics,
} from "../controllers/otaController.js";

const router = Router();

// Multer config for bundle upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// ============ PUBLIC ROUTES (Client App) ============

// GET /api/ota/check?platform=ios&bundleVersion=1.0.0&appVersion=1.0.0
router.get("/check", checkOtaUpdate);

// POST /api/ota/report-status { logId, status, errorMessage?, errorCode?, duration? }
router.post("/report-status", reportUpdateStatus);

// GET /api/ota/download/:platform/:version
router.get("/download/:platform/:version", downloadOtaBundle);

// ============ ADMIN ROUTES ============
// TODO: Add requireAdmin middleware

// POST /api/ota/upload (multipart/form-data, field "bundle")
router.post("/upload", upload.single("bundle"), uploadOtaBundle);

// GET /api/ota/versions/:platform?limit=50
router.get("/versions/:platform", listOtaVersions);

// GET /api/ota/latest/:platform
router.get("/latest/:platform", getOtaLatest);

// POST /api/ota/rollback { platform, version, reason? }
router.post("/rollback", rollbackOta);

// POST /api/ota/deactivate { platform, version }
router.post("/deactivate", deactivateOtaVersion);

// GET /api/ota/analytics/:platform?days=7
router.get("/analytics/:platform", getOtaAnalytics);

export default router;
