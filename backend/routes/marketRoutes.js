// routes/marketRoutes.js — Chợ PickleTour (mua bán / trao đổi đồ pickleball)
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import rateLimit from "express-rate-limit";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import {
  listListings,
  getListing,
  createListing,
  updateListing,
  updateStatus,
  deleteListing,
  toggleSave,
  listSaved,
  myListings,
  createOffer,
  listListingOffers,
  myOffers,
  respondOffer,
  cancelOffer,
  canPost,
} from "../controllers/marketController.js";

const router = express.Router();

/* ─────────── KYC gate ─────────── */
// Chỉ user đã xác minh CCCD/KYC mới được đăng / sửa tin.
const requireKyc = (req, res, next) => {
  const u = req.user;
  const verified = u && (u.cccdStatus === "verified" || u.verified === "verified");
  if (!verified) {
    return res.status(403).json({
      code: "KYC_REQUIRED",
      message: "Bạn cần xác minh danh tính (CCCD/KYC) trước khi đăng tin mua bán.",
    });
  }
  next();
};

/* ─────────── Media upload ─────────── */
const ROOT_UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MARKET_DIR = path.join(ROOT_UPLOAD_DIR, "market");
for (const d of [ROOT_UPLOAD_DIR, MARKET_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const marketStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MARKET_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    cb(null, `${stamp}-${rand}${ext}`);
  },
});
const marketUpload = multer({
  storage: marketStorage,
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB/ảnh
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Định dạng ảnh ${file.mimetype} không được hỗ trợ`));
  },
});

/* ─────────── Rate limits ─────────── */
const perUserKey = (req) => String(req.user?._id || req.ip);
const rlCreate = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 30,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn đăng tin quá nhiều hôm nay, vui lòng thử lại sau." },
});
const rlOffer = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn thao tác quá nhanh, thử lại sau." },
});

/* ─────────── Upload route ─────────── */
// POST /api/market/upload  form-data: files[] (tối đa 12 ảnh)
router.post(
  "/upload",
  protect,
  requireKyc,
  (req, res, next) => {
    marketUpload.array("files", 12)(req, res, (err) => {
      if (err) {
        const msg =
          err?.code === "LIMIT_FILE_SIZE"
            ? "Ảnh vượt quá 12MB"
            : err?.message || "Upload thất bại";
        return res.status(400).json({ message: msg });
      }
      next();
    });
  },
  async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ message: "Không nhận được ảnh" });
    // Chuẩn hoá mọi ảnh về WebP (fix HEIC không xem được trên web + auto-xoay + nén)
    const images = [];
    for (const f of files) {
      const base = path.basename(f.filename, path.extname(f.filename));
      const outName = `${base}.webp`;
      const outPath = path.join(MARKET_DIR, outName);
      try {
        await sharp(f.path)
          .rotate() // auto-orient theo EXIF
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(outPath);
        // Xoá file gốc (heic/jpg) sau khi convert thành công
        if (outPath !== f.path) fs.promises.unlink(f.path).catch(() => {});
        const rel = path.relative(ROOT_UPLOAD_DIR, outPath).split(path.sep).join("/");
        images.push({ url: toPublicUrl(req, `/uploads/${rel}`), mime: "image/webp" });
      } catch (e) {
        // Fallback: giữ nguyên file gốc nếu sharp không xử lý được
        const rel = path.relative(ROOT_UPLOAD_DIR, f.path).split(path.sep).join("/");
        images.push({ url: toPublicUrl(req, `/uploads/${rel}`), mime: f.mimetype });
      }
    }
    res.json({ images });
  }
);

/* ─────────── Routes (thứ tự param quan trọng) ─────────── */
// Static / collection routes trước "/:id"
router.get("/", optionalAuth, listListings);
router.get("/saved", protect, listSaved);
router.get("/mine", protect, myListings);
router.get("/offers/mine", protect, myOffers);
router.get("/me/can-post", protect, canPost);

router.post("/", protect, requireKyc, rlCreate, createListing);

// Offers (static path segments trước param generic)
router.patch("/offers/:offerId", protect, respondOffer);
router.delete("/offers/:offerId", protect, cancelOffer);

router.get("/:id/offers", protect, listListingOffers);
router.post("/:id/offers", protect, rlOffer, createOffer);
router.post("/:id/save", protect, toggleSave);
router.patch("/:id/status", protect, updateStatus);
router.put("/:id", protect, requireKyc, updateListing);
router.delete("/:id", protect, deleteListing);
router.get("/:id", optionalAuth, getListing);

export default router;
