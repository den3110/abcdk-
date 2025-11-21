// routes/liveRecordingRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  uploadChunk,
  getRecordingByMatch,
} from "../controllers/liveRecordingController.js";

const router = express.Router();

// ==== Multer config cho recording ====

// thư mục lưu chunk: /uploads/recordings
const uploadRoot = path.join(process.cwd(), "uploads", "recordings");
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    // có thể group theo matchId nếu muốn
    const matchId = req.body.matchId || "unknown";
    const safeMatch =
      typeof matchId === "string"
        ? matchId.replace(/[^0-9a-zA-Z_-]/g, "")
        : "unknown";
    const dir = path.join(uploadRoot, safeMatch);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename(req, file, cb) {
    const chunkIndex = req.body.chunkIndex ?? "0";
    const ext = path.extname(file.originalname || ".mp4") || ".mp4";
    cb(null, `chunk_${chunkIndex}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  // tuỳ bạn: chỉ cho phép video/mp4
  if (file.mimetype.startsWith("video/")) {
    cb(null, true);
  } else {
    cb(new Error("Only video files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    // giới hạn 5GB / chunk (tuỳ bạn)
    fileSize: 1024 * 1024 * 1024 * 5,
  },
});

// POST /api/live/recordings/chunk
router.post("/chunk", upload.single("file"), uploadChunk);

// GET /api/live/recordings/:matchId
router.get("/by-match/:matchId", getRecordingByMatch);

export default router;
