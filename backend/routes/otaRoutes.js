// routes/otaRoutes.js
import { Router } from "express";
import multer from "multer";
import {
  checkOtaUpdate,
  uploadOtaBundle,
  listOtaVersions,
  getOtaLatest,
  rollbackOta,
  downloadOtaBundle,
} from "../controllers/otaController.js";

const router = Router();

// Multer config for bundle upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// GET /api/ota/check
router.get("/check", checkOtaUpdate);

// POST /api/ota/upload (multipart/form-data, field "bundle")
router.post("/upload", upload.single("bundle"), uploadOtaBundle);

// GET /api/ota/versions/:platform
router.get("/versions/:platform", listOtaVersions);

// GET /api/ota/latest/:platform
router.get("/latest/:platform", getOtaLatest);

// POST /api/ota/rollback
router.post("/rollback", rollbackOta);

// GET /api/ota/download/:platform/:version
router.get("/download/:platform/:version", downloadOtaBundle);

export default router;
