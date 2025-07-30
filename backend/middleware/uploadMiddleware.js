// middleware/uploadMiddleware.js
import multer from "multer";
import path from "path";
import fs from "fs";

// Tạo folder nếu chưa tồn tại
const avatarDir = "uploads/avatars";
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, avatarDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

export const uploadAvatars = multer({ storage });
