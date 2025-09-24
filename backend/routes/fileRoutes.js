// src/routes/filesRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import FileAsset from "../models/fileAssetModel.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ===== Helpers =====
const UPLOAD_DIR = path.resolve("uploads/public");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function hostFrom(req) {
  return (
    process.env.HOST ??
    process.env.WEB_URL ??
    `${req.protocol}://${req.get("host")}`
  ).replace(/\/+$/, "");
}

// Multer storage & naming
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const parsed = path.parse(file.originalname);
    const safeBase = (parsed.name || "file")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 80);
    const ext = parsed.ext || "";
    const stamp = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString("hex");
    cb(null, `${safeBase}-${stamp}-${rand}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB/file (tuỳ chỉnh)
});

// ===== CREATE (multi upload) =====
// POST /api/files  (multipart/form-data, field name: "files")
router.post(
  "/",
  protect,
  authorize("admin"),
  upload.array("files", 20),
  async (req, res, next) => {
    try {
      const category = String(req.body?.category || "general");
      if (!req.files?.length)
        return res.status(400).json({ message: "Không có file nào" });

      const base = hostFrom(req);

      const items = await Promise.all(
        req.files.map(async (f) => {
          const doc = await FileAsset.create({
            originalName: f.originalname,
            fileName: path.basename(f.path),
            size: f.size,
            mime: f.mimetype || "application/octet-stream",
            path: f.path,
            isPublic: true,
            category,
            uploadedBy: req.user?._id,
          });

          return {
            _id: doc._id,
            originalName: doc.originalName,
            size: doc.size,
            mime: doc.mime,
            category: doc.category,
            createdAt: doc.createdAt,
            publicUrl: `${base}/dl/file/${doc._id}`, // ép tải về
            staticUrl: `${base}/uploads/public/${encodeURIComponent(
              doc.fileName
            )}`, // nếu có serve static
          };
        })
      );

      res.status(201).json({ items, count: items.length });
    } catch (err) {
      next(err);
    }
  }
);

// ===== LIST =====
// GET /api/files?q=term&category=app&limit=20&page=1
router.get("/", protect, authorize("admin"), async (req, res, next) => {
  try {
    const { q = "", category, limit = 20, page = 1 } = req.query;
    const lim = Math.min(Number(limit) || 20, 100);
    const skip = Math.max(0, (Number(page) - 1) * lim);

    const filter = {};
    if (category) filter.category = category;
    if (q) {
      filter.$or = [
        { originalName: { $regex: q, $options: "i" } },
        { fileName: { $regex: q, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      FileAsset.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim),
      FileAsset.countDocuments(filter),
    ]);

    const base = hostFrom(req);

    res.json({
      items: items.map((d) => ({
        _id: d._id,
        originalName: d.originalName,
        fileName: d.fileName,
        size: d.size,
        mime: d.mime,
        category: d.category,
        createdAt: d.createdAt,
        publicUrl: `${base}/dl/file/${d._id}`,
        staticUrl: `${base}/uploads/public/${encodeURIComponent(d.fileName)}`,
      })),
      total,
      page: Number(page),
      limit: lim,
    });
  } catch (err) {
    next(err);
  }
});

// ===== DELETE =====
// DELETE /api/files/:id
router.delete("/:id", protect, authorize("admin"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await FileAsset.findById(id);
    if (!doc) return res.status(404).json({ message: "Không tìm thấy file" });

    await doc.deleteOne();

    try {
      if (doc.path && fs.existsSync(doc.path)) fs.unlinkSync(doc.path);
    } catch (e) {
      console.warn("unlink failed", e?.message);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
