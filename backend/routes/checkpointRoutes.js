import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import {
  cancelAdminCheckpointMandate,
  createAdminCheckpointMandate,
  getAdminCheckpointOverview,
  getAdminCheckpointSessionDetail,
  getAdminCheckpointSettings,
  getAdminCheckpointSubjectInsight,
  getCheckpointPolicy,
  getCheckpointStatus,
  listAdminCheckpointMandates,
  listAdminCheckpointEvents,
  listAdminCheckpointSessions,
  recordClientCheckpointEvent,
  resendCheckpointOtp,
  resolveAdminCheckpointSession,
  simulateAdminCheckpointRisk,
  updateAdminCheckpointSettings,
  uploadCheckpointEvidence,
  verifyCheckpointPhone,
} from "../controllers/checkpointController.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

const CHECKPOINT_UPLOAD_DIR = path.join(process.cwd(), "uploads", "checkpoints");
if (!fs.existsSync(CHECKPOINT_UPLOAD_DIR)) {
  fs.mkdirSync(CHECKPOINT_UPLOAD_DIR, { recursive: true });
}

const slugify = (value = "") =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, CHECKPOINT_UPLOAD_DIR);
    },
    filename(req, file, cb) {
      const ext =
        path.extname(file.originalname || "").replace(".", "").toLowerCase() ||
        MIME_EXT[file.mimetype] ||
        "bin";
      const base =
        slugify(
          path.basename(file.originalname || "checkpoint", path.extname(file.originalname || ""))
        ) || "checkpoint";
      cb(null, `${Date.now()}-${base}.${ext}`);
    },
  }),
  limits: {
    fileSize:
      Number.parseInt(process.env.CHECKPOINT_UPLOAD_MAX_BYTES || "", 10) ||
      25 * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    if (!MIME_EXT[file.mimetype]) {
      return cb(new Error("Chỉ cho phép ảnh hoặc video checkpoint hợp lệ."));
    }
    cb(null, true);
  },
});

router.post("/events", recordClientCheckpointEvent);
router.get("/admin/overview", protect, authorize("admin"), getAdminCheckpointOverview);
router.get("/admin/sessions", protect, authorize("admin"), listAdminCheckpointSessions);
router.get("/admin/sessions/:id", protect, authorize("admin"), getAdminCheckpointSessionDetail);
router.get("/admin/events", protect, authorize("admin"), listAdminCheckpointEvents);
router.get("/admin/mandates", protect, authorize("admin"), listAdminCheckpointMandates);
router.post("/admin/mandates", protect, authorize("admin"), createAdminCheckpointMandate);
router.post("/admin/mandates/:id/cancel", protect, authorize("admin"), cancelAdminCheckpointMandate);
router.get("/admin/settings", protect, authorize("admin"), getAdminCheckpointSettings);
router.put("/admin/settings", protect, authorize("admin"), updateAdminCheckpointSettings);
router.post("/admin/simulate", protect, authorize("admin"), simulateAdminCheckpointRisk);
router.get("/admin/subjects/insight", protect, authorize("admin"), getAdminCheckpointSubjectInsight);
router.post(
  "/admin/sessions/:id/resolve",
  protect,
  authorize("admin"),
  resolveAdminCheckpointSession
);
router.get("/policy/summary", protect, authorize("admin"), getCheckpointPolicy);
router.get("/:token", getCheckpointStatus);
router.post("/:token/resend", resendCheckpointOtp);
router.post("/:token/phone", verifyCheckpointPhone);
router.post(
  "/:token/evidence",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  uploadCheckpointEvidence
);

export default router;
