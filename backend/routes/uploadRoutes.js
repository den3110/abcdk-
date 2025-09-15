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

// ===== Helpers =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_UPLOAD_DIR = path.join(process.cwd(), "uploads");
const AVATAR_DIR = path.join(ROOT_UPLOAD_DIR, "avatars");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(ROOT_UPLOAD_DIR);
ensureDir(AVATAR_DIR);

function slugify(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function getExt(file) {
  // ưu tiên ext từ originalname, fallback theo mime
  const fromName = path.extname(file.originalname || "").replace(".", "");
  if (fromName) return fromName.toLowerCase();
  return MIME_EXT[file.mimetype] || "jpg";
}

function getBaseUrl(req) {
  // Ưu tiên ENV nếu có (ví dụ khi dùng CDN / domain ngoài)
  if (process.env.EXTERNAL_BASE_URL) return process.env.EXTERNAL_BASE_URL;

  // Hỗ trợ reverse proxy (Nginx/Cloudflare)
  const proto =
    req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

// ===== Multer config cho Avatar =====
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
    const ext = getExt(file);
    cb(null, `${Date.now()}-${base}.${ext}`);
  },
});

const MAX_AVATAR_SIZE =
  parseInt(process.env.MAX_AVATAR_SIZE || "", 10) || 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_MIME = new Set(Object.keys(MIME_EXT));

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_AVATAR_SIZE },
  fileFilter(req, file, cb) {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error("Chỉ cho phép ảnh (jpeg, png, webp, heic/heif)"));
    }
    cb(null, true);
  },
});

// ===== Routes =====

// Upload avatar
// => trả về { url } với URL public tới file
router.post("/avatar", (req, res) => {
  avatarUpload.single("avatar")(req, res, (err) => {
    if (err) {
      const msg =
        err?.message ||
        (err?.code === "LIMIT_FILE_SIZE"
          ? "Ảnh vượt quá dung lượng tối đa"
          : "Upload thất bại");
      return res.status(400).json({ message: msg });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Không nhận được file 'avatar'" });
    }

    const base = getBaseUrl(req);
    const publicUrl = `${base}/uploads/avatars/${req.file.filename}`;

    // Giữ nguyên FE đang dùng .url
    return res.status(200).json({ url: publicUrl });
  });
});

// Upload CCCD (đã có middleware riêng lo thư mục/field/front/back)
router.post("/cccd", protect, cccdUpload, uploadCccd);

export default router;

/*
 * Ghi chú:
 * - Đảm bảo server có phục vụ static cho /uploads (trong server.js):
 *     import path from "path";
 *     app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
 *
 * - Nếu deploy sau reverse proxy, có thể set EXTERNAL_BASE_URL,
 *   ví dụ https://api.example.com để build URL chính xác.
 */
