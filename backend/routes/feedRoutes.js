// routes/feedRoutes.js
// Public + user Bảng tin. Admin routes riêng: adminFeedRoutes.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { protect, optionalAuth } from "../middleware/authMiddleware.js";
import { optimizeImage } from "../middleware/optimizeImage.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import {
  listFeed,
  getPost,
  createPost,
  updatePost,
  deletePost,
  reactPost,
  sharePost,
  reactComment,
  listComments,
  createComment,
  deleteComment,
  reportTarget,
} from "../controllers/feedController.js";

const router = express.Router();

/* ─────────────────── Media upload ─────────────────── */

const ROOT_UPLOAD_DIR = path.join(process.cwd(), "uploads");
const FEED_DIR = path.join(ROOT_UPLOAD_DIR, "feed");
const FEED_IMG_DIR = path.join(FEED_DIR, "images");
const FEED_VID_DIR = path.join(FEED_DIR, "videos");
for (const d of [ROOT_UPLOAD_DIR, FEED_DIR, FEED_IMG_DIR, FEED_VID_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);

const feedStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype)) return cb(null, FEED_IMG_DIR);
    if (VIDEO_MIME.has(file.mimetype)) return cb(null, FEED_VID_DIR);
    cb(new Error("Định dạng file không được hỗ trợ"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    cb(null, `${stamp}-${rand}${ext}`);
  },
});

const feedUpload = multer({
  storage: feedStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB, chung cho ảnh và video
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype) || VIDEO_MIME.has(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error(`File type ${file.mimetype} không được hỗ trợ`));
  },
});

// POST /api/feed/upload/media  form-data: files[]  (tối đa 10, 50MB/file)
router.post(
  "/upload/media",
  protect,
  (req, res, next) => {
    feedUpload.array("files", 10)(req, res, (err) => {
      if (err) {
        const msg =
          err?.message ||
          (err?.code === "LIMIT_FILE_SIZE" ? "File vượt quá 50MB" : "Upload thất bại");
        return res.status(400).json({ message: msg });
      }
      next();
    });
  },
  async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ message: "Không nhận được file" });
    }
    // Ảnh: optimize từng cái riêng (không dùng optimizeImage middleware vì
    // nó expect req.file single). Đơn giản: trả về URL nguyên bản, FE có thể
    // dùng imgproxy nếu có. Video: giữ nguyên.
    const media = files.map((f) => {
      const type = IMAGE_MIME.has(f.mimetype) ? "image" : "video";
      const rel = path
        .relative(ROOT_UPLOAD_DIR, f.path)
        .split(path.sep)
        .join("/");
      return {
        type,
        url: toPublicUrl(req, `/uploads/${rel}`),
        mime: f.mimetype,
        sizeBytes: f.size,
      };
    });
    res.json({ media });
  }
);

/* ─────────────────── Rate limits ─────────────────── */

const perUserKey = (req) => String(req.user?._id || req.ip);

const rlPost = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24h
  max: 10,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Bạn chỉ được đăng tối đa 10 bài / ngày. Vui lòng thử lại sau.",
  },
});
const rlComment = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn bình luận quá nhanh, thử lại sau." },
});
// Rate limit riêng cho bình luận CÓ đính kèm ảnh/video — chống spam media
// nặng đô. Chỉ count khi body.media không rỗng.
const rlCommentMedia = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24h
  max: 100,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    !Array.isArray(req.body?.media) || req.body.media.length === 0,
  message: {
    message:
      "Bạn chỉ được bình luận kèm ảnh/video tối đa 100 lần / ngày. Vui lòng thử lại sau.",
  },
});
const rlReaction = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Thao tác quá nhanh." },
});
const rlReport = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn đã báo cáo quá nhiều lần, thử lại sau." },
});

/* ─────────────────── Routes ─────────────────── */

// LIST
router.get("/", optionalAuth, listFeed);

// COMMENTS list phải nằm TRƯỚC "/:id" để không bị nuốt
router.get("/:id/comments", optionalAuth, listComments);

router.post("/:id/comments", protect, rlComment, rlCommentMedia, createComment);
router.delete("/comments/:cid", protect, deleteComment);
router.post("/comments/:cid/reactions", protect, rlReaction, reactComment);
router.post("/comments/:cid/reports", protect, rlReport, reportTarget("comment"));

// POST reactions + reports + share
router.post("/:id/reactions", protect, rlReaction, reactPost);
router.post("/:id/reports", protect, rlReport, reportTarget("post"));
// Share: cho phép guest cũng ping (dùng optionalAuth). Chỉ tracking shareCount.
router.post("/:id/share", optionalAuth, sharePost);

// POST CRUD
router.post("/", protect, rlPost, createPost);
router.get("/:id", optionalAuth, getPost);
router.patch("/:id", protect, updatePost);
router.delete("/:id", protect, deletePost);

export default router;
