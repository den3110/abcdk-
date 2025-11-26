// routes/uploadRoute.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { protect } from "../middleware/authMiddleware.js";
import { cccdUpload } from "../middleware/cccdUpload.js";
import { uploadCccd } from "../controllers/uploadController.js";
import { processAvatarWithLogoAlways } from "../services/avatarProcessor.js"; // ✅ dùng service
import SystemSettings from "../models/systemSettingsModel.js";
import { optimizeImage } from "../middleware/optimizeImage.js";

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

// helper nhỏ trong file uploadRoute.js, đặt trên Routes cũng được
function buildAbsoluteUrl(baseUrl, urlPath) {
  if (!urlPath) return baseUrl;
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
    return urlPath;
  }
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = urlPath.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

// helper đọc flag từ SystemSettings (fail-safe: nếu lỗi thì coi như bật logo)
async function isAvatarLogoEnabled() {
  try {
    const doc = await SystemSettings.findById("system").lean();
    // default: true nếu chưa set
    return doc?.uploads?.avatarLogoEnabled !== false;
  } catch (err) {
    console.error(
      "[upload/avatar] Failed to read system settings, defaulting avatarLogoEnabled = true:",
      err?.message || err
    );
    return true;
  }
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

// CCCD (single file)
const cccdStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, CCCD_DIR);
  },
  filename(req, file, cb) {
    const base =
      slugify(
        path.basename(
          file.originalname || "cccd",
          path.extname(file.originalname || "")
        )
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

/* ✅ Upload theo thư mục uploads/:id */
const perIdStorage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      const rawId = req.params.id || "misc";
      const safeId = slugify(rawId) || "misc";
      const dir = path.join(ROOT_UPLOAD_DIR, safeId);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    const base =
      slugify(
        path.basename(
          file.originalname || "image",
          path.extname(file.originalname || "")
        )
      ) || "image";
    cb(null, `${Date.now()}-${base}.${getExt(file)}`);
  },
});

const perIdUpload = multer({
  storage: perIdStorage,
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
// /api/upload/avatar  → { url }
// /api/upload/avatar  → { url }

router.post("/avatar", (req, res) => {
  avatarUpload.single("avatar")(req, res, async (err) => {
    const baseUrl = getBaseUrl(req);

    try {
      // 1) Multer lỗi hoặc không có file -> dùng service fallback (default avatar, không quan tâm flag)
      if (err || !req.file) {
        if (err) {
          console.warn(
            "[upload/avatar] Multer error, fallback:",
            err.code || err.message
          );
        } else {
          console.warn(
            "[upload/avatar] No file received, fallback to default avatar"
          );
        }

        const { avatarUrl } = await processAvatarWithLogoAlways(
          null,
          AVATAR_DIR,
          `fallback_${Date.now()}`
        );

        const fullUrl = buildAbsoluteUrl(baseUrl, avatarUrl);
        return res.status(200).json({ url: fullUrl });
      }

      // 2) Có file hợp lệ → check config xem có chèn logo không
      const avatarLogoEnabled = await isAvatarLogoEnabled();

      if (!avatarLogoEnabled) {
        // Không chèn logo: trả luôn URL file mà Multer đã lưu
        const rawPath = `/uploads/avatars/${req.file.filename}`;
        const fullUrl = buildAbsoluteUrl(baseUrl, rawPath);
        return res.status(200).json({ url: fullUrl });
      }

      // 3) Có file & được phép chèn logo → giao cho service xử lý full (logo + fallback)
      const safeBaseName = path.basename(
        req.file.filename,
        path.extname(req.file.filename)
      );

      const { avatarUrl } = await processAvatarWithLogoAlways(
        req.file,
        AVATAR_DIR,
        safeBaseName
      );

      const fullUrl = buildAbsoluteUrl(baseUrl, avatarUrl);
      return res.status(200).json({ url: fullUrl });
    } catch (e) {
      console.error(
        "[upload/avatar] Fatal error, hard fallback:",
        e?.message || e
      );

      // 4) Last resort: vẫn trả URL hợp lệ trỏ về default (hoặc file gốc nếu còn)
      const fallbackPath =
        (req.file && `/uploads/avatars/${req.file.filename}`) ||
        "/uploads/avatars/default-avatar.jpg";

      const fullUrl = buildAbsoluteUrl(baseUrl, fallbackPath);
      return res.status(200).json({ url: fullUrl });
    }
  });
});
// /api/upload/register-cccd  → { url } (field 'image')
router.post("/register-cccd", (req, res) => {
  cccdUploadSingle.single("image")(req, res, (err) => {
    if (err) {
      const msg =
        err?.message ||
        (err?.code === "LIMIT_FILE_SIZE"
          ? "Ảnh vượt quá dung lượng tối đa"
          : "Upload thất bại");
      return res.status(400).json({ message: msg });
    }
    if (!req.file)
      return res.status(400).json({ message: "Không nhận được file 'image'" });
    const publicUrl = `${getBaseUrl(req)}/uploads/cccd/${req.file.filename}`;
    res.status(200).json({ url: publicUrl });
  });
});

router.post("/cccd", protect, cccdUpload, uploadCccd);

router.post("/:id", (req, res) => {
  perIdUpload.single("image")(req, res, (err) => {
    if (err) {
      const msg =
        err?.message ||
        (err?.code === "LIMIT_FILE_SIZE"
          ? "Ảnh vượt quá dung lượng tối đa"
          : "Upload thất bại");
      return res.status(400).json({ message: msg });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Không nhận được file 'image'" });
    }

    const rawId = req.params.id || "misc";
    const safeId = slugify(rawId) || "misc";

    // ✅ Thư mục hiện tại (uploads/:id) – optimizeImage sẽ ghi đè trong chính thư mục này
    const outputDir = path.dirname(req.file.path);

    // ✅ middleware optimizeImage: default webp 800x800, nhưng sẽ override bởi
    // form-data: format / width / height / quality nếu bạn gửi lên
    const optimizeMw = optimizeImage({
      maxWidth: 800,
      maxHeight: 800,
      defaultFormat: "webp",
      quality: 80,
      outputDir, // giữ trong uploads/:id
      keepOriginal: false, // xoá file gốc, chỉ giữ file đã nén
    });

    optimizeMw(req, res, (optErr) => {
      if (optErr) {
        console.error("[upload/:id] optimizeImage error:", optErr);
        const msg =
          optErr?.message ||
          (optErr?.code === "LIMIT_FILE_SIZE"
            ? "Ảnh vượt quá dung lượng tối đa"
            : "Tối ưu ảnh thất bại");
        return res.status(400).json({ message: msg });
      }

      // 🔁 Sau optimizeImage, req.file đã update sang file mới (đã nén)
      const baseUrl = getBaseUrl(req);

      // Lấy relative path từ ROOT_UPLOAD_DIR để build URL chuẩn cross-platform
      const relativePath = path
        .relative(ROOT_UPLOAD_DIR, req.file.path)
        .split(path.sep)
        .join("/"); // đổi \ -> / nếu chạy Windows

      const rawPath = `/uploads/${relativePath}`;
      const fullUrl = buildAbsoluteUrl(baseUrl, rawPath);

      return res.status(200).json({
        url: fullUrl,
        id: safeId,
        filename: req.file.filename,
      });
    });
  });
});

export default router;
