// routes/uploadRoute.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { protect } from "../middleware/authMiddleware.js";
import { cccdUpload } from "../middleware/cccdUpload.js";
import { uploadCccd } from "../controllers/uploadController.js";

const router = express.Router();

/* ===== Helpers ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_UPLOAD_DIR = path.join(process.cwd(), "uploads");
const AVATAR_DIR = path.join(ROOT_UPLOAD_DIR, "avatars");
const CCCD_DIR = path.join(ROOT_UPLOAD_DIR, "cccd");

for (const d of [ROOT_UPLOAD_DIR, AVATAR_DIR, CCCD_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function slugify(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}
function getExt(file) {
  const fromName = path.extname(file.originalname || "").replace(".", "");
  if (fromName) return fromName.toLowerCase();
  return MIME_EXT[file.mimetype] || "jpg";
}
function getBaseUrl(req) {
  if (process.env.EXTERNAL_BASE_URL) return process.env.EXTERNAL_BASE_URL;
  const proto =
    req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

const ALLOWED_IMAGE_MIME = new Set(Object.keys(MIME_EXT));
const MAX_IMG_SIZE =
  parseInt(process.env.MAX_AVATAR_SIZE || "", 10) || 10 * 1024 * 1024;

/* ===== Multer storages ===== */
// Avatar
const avatarStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, AVATAR_DIR);
  },
  filename(req, file, cb) {
    const base =
      slugify(
        path.basename(
          file.originalname || "avatar",
          path.extname(file.originalname || "")
        )
      ) || "avatar";
    cb(null, `${Date.now()}-${base}.${getExt(file)}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_IMG_SIZE },
  fileFilter(req, file, cb) {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error("Chỉ cho phép ảnh (jpeg, png, webp, heic/heif)"));
    }
    cb(null, true);
  },
});

// CCCD (single file)  👇 **ĐƯỢC KHAI BÁO TRƯỚC KHI DÙNG**
const cccdStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, CCCD_DIR);
  },
  filename(req, file, cb) {
    const base =
      slugify(
        path.basename(file.originalname || "cccd", path.extname(file.originalname || ""))
      ) || "cccd";
    cb(null, `${Date.now()}-${base}.${getExt(file)}`);
  },
});
const cccdUploadSingle = multer({
  storage: cccdStorage,
  limits: { fileSize: MAX_IMG_SIZE },
  fileFilter(req, file, cb) {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error("Chỉ cho phép ảnh (jpeg, png, webp, heic/heif)"));
    }
    cb(null, true);
  },
});

/* ===== Routes ===== */
// /api/upload/avatar  → { url }
router.post("/avatar", (req, res) => {
  avatarUpload.single("avatar")(req, res, (err) => {
    if (err) {
      const msg =
        err?.message ||
        (err?.code === "LIMIT_FILE_SIZE" ? "Ảnh vượt quá dung lượng tối đa" : "Upload thất bại");
      return res.status(400).json({ message: msg });
    }
    if (!req.file) return res.status(400).json({ message: "Không nhận được file 'avatar'" });
    const publicUrl = `${getBaseUrl(req)}/uploads/avatars/${req.file.filename}`;
    res.status(200).json({ url: publicUrl });
  });
});

// /api/upload/register-cccd  → { url } (field 'image')
router.post("/register-cccd", (req, res) => {
  cccdUploadSingle.single("image")(req, res, (err) => {
    if (err) {
      const msg =
        err?.message ||
        (err?.code === "LIMIT_FILE_SIZE" ? "Ảnh vượt quá dung lượng tối đa" : "Upload thất bại");
      return res.status(400).json({ message: msg });
    }
    if (!req.file) return res.status(400).json({ message: "Không nhận được file 'image'" });
    const publicUrl = `${getBaseUrl(req)}/uploads/cccd/${req.file.filename}`;
    res.status(200).json({ url: publicUrl });
  });
});

router.post("/cccd", protect, cccdUpload, uploadCccd);

export default router;
