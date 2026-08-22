// routes/chatRoutes.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import {
  listConversations,
  openDmConversation,
  openTournamentConversation,
  getConversation,
  patchConversation,
  listMessages,
  sendMessage,
  markRead,
  deleteMessage,
  reactMessage,
  emitTyping,
} from "../controllers/chatController.js";

const router = express.Router();

/* Media upload — riêng cho chat, dùng chung 50MB/file, ảnh + video + file phổ biến. */
const ROOT_UPLOAD_DIR = path.join(process.cwd(), "uploads");
const CHAT_DIR = path.join(ROOT_UPLOAD_DIR, "chat");
if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR, { recursive: true });

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);
const FILE_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CHAT_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    cb(null, `${stamp}-${rand}${ext}`);
  },
});
const chatUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      IMAGE_MIME.has(file.mimetype) ||
      VIDEO_MIME.has(file.mimetype) ||
      FILE_MIME.has(file.mimetype)
    )
      return cb(null, true);
    cb(new Error(`Loại file ${file.mimetype} không được hỗ trợ`));
  },
});

const perUserKey = (req) => String(req.user?._id || req.ip);
const rlSend = rateLimit({
  windowMs: 60 * 1000,
  max: 40, // 40 tin/phút/người
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn gửi tin nhắn quá nhanh." },
});
const rlTyping = rateLimit({
  windowMs: 10 * 1000,
  max: 20,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
});

/* Upload attachment: POST /api/chat/upload */
router.post(
  "/upload",
  protect,
  (req, res, next) => {
    chatUpload.array("files", 10)(req, res, (err) => {
      if (err) {
        const msg =
          err?.message ||
          (err?.code === "LIMIT_FILE_SIZE" ? "File vượt quá 50MB" : "Upload thất bại");
        return res.status(400).json({ message: msg });
      }
      next();
    });
  },
  (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ message: "Không nhận được file" });
    const attachments = files.map((f) => {
      const type = IMAGE_MIME.has(f.mimetype)
        ? "image"
        : VIDEO_MIME.has(f.mimetype)
          ? "video"
          : "file";
      const rel = path
        .relative(ROOT_UPLOAD_DIR, f.path)
        .split(path.sep)
        .join("/");
      return {
        type,
        url: toPublicUrl(req, `/uploads/${rel}`),
        name: f.originalname,
        mime: f.mimetype,
        sizeBytes: f.size,
      };
    });
    res.json({ attachments });
  }
);

/* Conversations */
router.get("/conversations", protect, listConversations);
router.post("/conversations/dm", protect, openDmConversation);
router.post(
  "/conversations/tournament/:tid",
  protect,
  openTournamentConversation
);
router.get("/conversations/:cid", protect, getConversation);
router.patch("/conversations/:cid", protect, patchConversation);

/* Messages */
router.get("/conversations/:cid/messages", protect, listMessages);
router.post("/conversations/:cid/messages", protect, rlSend, sendMessage);
router.post("/conversations/:cid/read", protect, markRead);
router.post("/conversations/:cid/typing", protect, rlTyping, emitTyping);
router.delete("/messages/:mid", protect, deleteMessage);
router.post("/messages/:mid/react", protect, reactMessage);

export default router;
