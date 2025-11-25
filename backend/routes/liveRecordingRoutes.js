// routes/liveRecordingRoutes.js
import express from "express";
import multer from "multer";
import os from "os";
import {
  uploadChunk,
  getRecordingByMatch,
} from "../controllers/liveRecordingController.js";
import rateLimit from "express-rate-limit";


const router = express.Router();

// ✅ Multer config ĐƠN GIẢN - chỉ lưu tạm vào /tmp
// Go service sẽ lo việc lưu thật vào uploads/recordings/
const upload = multer({
  // ✅ Lưu vào system temp (Node.js sẽ xóa sau khi gửi cho Go)
  dest: os.tmpdir(),
  
  // ✅ Chỉ cho video
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files allowed"), false);
    }
  },
  
  limits: {
    // ✅ 100MB/chunk (đủ cho 60s video chất lượng cao)
    fileSize: 100 * 1024 * 1024,
    files: 1,
  },
});

// ✅ Rate limit cho upload (tránh spam)

const uploadLimiter = rateLimit({
  windowMs: 1000, // 1 giây
  max: 20, // Max 10 requests/giây (vì có thể nhiều matches cùng upload)
  message: "Too many upload requests, please slow down",
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ POST /api/live/recordings/chunk
// Middleware order: rate limit → multer → controller
router.post("/chunk", uploadLimiter, upload.single("file"), uploadChunk);

// ✅ GET /api/live/recordings/by-match/:matchId
router.get("/by-match/:matchId", getRecordingByMatch);

export default router;