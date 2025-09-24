// src/routes/filesRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import FileAsset from "../models/fileAssetModel.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================
 * Helpers & Directories
 * ========================= */
const UPLOAD_DIR = path.resolve("uploads/public");
const CHUNK_TMP_DIR = path.resolve("uploads/chunks");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(CHUNK_TMP_DIR, { recursive: true });

function hostFrom(req) {
  return (
    process.env.HOST ??
    process.env.WEB_URL ??
    `${req.protocol}://${req.get("host")}`
  ).replace(/\/+$/, "");
}

const DEFAULT_CHUNK = 8 * 1024 * 1024; // 8MB
const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const UP_EXPIRE_MS = 24 * 60 * 60 * 1000; // 24h

const safeBase = (name = "file") =>
  (path.parse(name).name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);

/* =========================
 * Legacy multi-upload (multer)
 * ========================= */
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const parsed = path.parse(file.originalname);
    const safe = safeBase(parsed.name);
    const ext = parsed.ext || "";
    const stamp = Date.now().toString(36);
    const rand = crypto.randomBytes(4).toString("hex");
    cb(null, `${safe}-${stamp}-${rand}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB/file
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
            publicUrl: `${base}/dl/file/${doc._id}`, // ép tải về (X-Accel-Redirect ở Nginx/BE)
            staticUrl: `${base}/uploads/public/${encodeURIComponent(
              doc.fileName
            )}`,
          };
        })
      );

      res.status(201).json({ items, count: items.length });
    } catch (err) {
      next(err);
    }
  }
);

/* =========================
 * Multipart (chunk) PRO – self-hosted
 * Prefix: /api/files/multipart/*
 * ========================= */

// ===== INIT =====
// POST /api/files/multipart/init
// body: { fileName, size, mime, category?, chunkSize? }
// res:  { uploadId, chunkSize, totalParts, expiresAt }
router.post(
  "/multipart/init",
  protect,
  authorize("admin"),
  express.json(),
  async (req, res) => {
    const {
      fileName,
      size,
      mime,
      category = "general",
      chunkSize,
    } = req.body || {};
    if (!fileName || !size)
      return res.status(400).json({ message: "Thiếu fileName/size" });
    if (Number(size) > MAX_SIZE)
      return res.status(413).json({ message: "File quá lớn" });

    const useChunk = Math.max(
      512 * 1024,
      Math.min(Number(chunkSize) || DEFAULT_CHUNK, 16 * 1024 * 1024)
    );
    const totalParts = Math.ceil(Number(size) / useChunk);
    const uploadId = crypto.randomBytes(16).toString("hex");

    const dir = path.join(CHUNK_TMP_DIR, uploadId);
    await fsp.mkdir(dir, { recursive: true });

    const meta = {
      uploadId,
      fileName,
      size: Number(size),
      mime: mime || "application/octet-stream",
      category,
      chunkSize: useChunk,
      totalParts,
      received: {},
      createdAt: Date.now(),
    };
    await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
    res.json({
      uploadId,
      chunkSize: useChunk,
      totalParts,
      expiresAt: meta.createdAt + UP_EXPIRE_MS,
    });
  }
);

// ===== UPLOAD CHUNK =====
// PUT /api/files/multipart/:uploadId/:partNo  (body=raw bytes)
// Headers: Content-Type: application/octet-stream
//          Content-Range: bytes start-end/size  (khuyến nghị)
//          X-Chunk-Checksum: sha256-<base64>    (tuỳ chọn)
router.put(
  "/multipart/:uploadId/:partNo",
  protect,
  authorize("admin"),
  async (req, res) => {
    const { uploadId, partNo } = req.params;
    const dir = path.join(CHUNK_TMP_DIR, uploadId);
    const metaPath = path.join(dir, "meta.json");

    let meta;
    try {
      meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    } catch {
      return res.status(404).json({ message: "UploadId không tồn tại" });
    }

    const part = Number(partNo);
    if (!Number.isInteger(part) || part < 1 || part > meta.totalParts)
      return res.status(400).json({ message: "partNo không hợp lệ" });

    const partPath = path.join(dir, `part-${part}`);
    if (fs.existsSync(partPath)) {
      // idempotent
      return res.status(204).end();
    }

    // Content-Range validation (nhẹ)
    const range = req.headers["content-range"];
    if (range) {
      try {
        const m = /bytes\s+(\d+)-(\d+)\/(\d+)/i.exec(range);
        if (m) {
          const start = Number(m[1]),
            end = Number(m[2]),
            total = Number(m[3]);
          if (total !== meta.size)
            return res
              .status(400)
              .json({ message: "Content-Range size mismatch" });
          const expectedStart = (part - 1) * meta.chunkSize;
          if (start !== expectedStart)
            return res.status(416).json({ message: "Offset mismatch" });
          if (end + 1 - start > meta.chunkSize && part !== meta.totalParts) {
            return res
              .status(400)
              .json({ message: "Chunk vượt quá chunkSize" });
          }
        }
      } catch {
        /* ignore */
      }
    }

    // stream to file + optional checksum
    const checksum = req.headers["x-chunk-checksum"]; // sha256-<base64>
    const hasher = checksum ? crypto.createHash("sha256") : null;
    const ws = fs.createWriteStream(partPath, { flags: "wx" }); // tránh ghi đè

    req.on("data", (buf) => {
      if (hasher) hasher.update(buf);
    });
    req.pipe(ws);

    ws.on("finish", async () => {
      try {
        if (hasher && checksum?.startsWith("sha256-")) {
          const expect = checksum.split("sha256-")[1];
          const got = hasher.digest("base64");
          if (expect !== got) {
            await fsp.unlink(partPath).catch(() => {});
            return res.status(400).json({ message: "Checksum mismatch" });
          }
        }
        meta.received[part] = true;
        await fsp.writeFile(metaPath, JSON.stringify(meta));
        return res.status(204).end();
      } catch (e) {
        console.error("chunk finish error", e);
        await fsp.unlink(partPath).catch(() => {});
        return res.status(500).json({ message: "Lỗi ghi chunk" });
      }
    });

    ws.on("error", async (e) => {
      console.error("write chunk error", e?.message);
      await fsp.unlink(partPath).catch(() => {});
      return res.status(500).json({ message: "Lỗi ghi chunk" });
    });
  }
);

// ===== STATUS (resume) =====
// GET /api/files/multipart/:uploadId/status
// -> { receivedParts:[...], totalParts, chunkSize, size }
router.get(
  "/multipart/:uploadId/status",
  protect,
  authorize("admin"),
  async (req, res) => {
    const dir = path.join(CHUNK_TMP_DIR, req.params.uploadId);
    const metaPath = path.join(dir, "meta.json");
    try {
      const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
      const receivedParts = Object.keys(meta.received || {})
        .map(Number)
        .filter(Boolean)
        .sort((a, b) => a - b);
      res.json({
        receivedParts,
        totalParts: meta.totalParts,
        chunkSize: meta.chunkSize,
        size: meta.size,
      });
    } catch {
      res.status(404).json({ message: "UploadId không tồn tại" });
    }
  }
);

// ===== COMPLETE (merge + create record) =====
// POST /api/files/multipart/:uploadId/complete
// -> { item }
router.post(
  "/multipart/:uploadId/complete",
  protect,
  authorize("admin"),
  async (req, res) => {
    const { uploadId } = req.params;
    const dir = path.join(CHUNK_TMP_DIR, uploadId);
    const metaPath = path.join(dir, "meta.json");
    let meta;
    try {
      meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    } catch {
      return res.status(404).json({ message: "UploadId không tồn tại" });
    }

    // verify đủ part
    const missing = [];
    for (let p = 1; p <= meta.totalParts; p++) {
      if (!fs.existsSync(path.join(dir, `part-${p}`))) missing.push(p);
    }
    if (missing.length) {
      return res
        .status(400)
        .json({
          message: `Thiếu chunk: ${missing.slice(0, 10).join(", ")}${
            missing.length > 10 ? "..." : ""
          }`,
        });
    }

    // merge stream (rất nhẹ RAM)
    const base = safeBase(meta.fileName);
    const ext = path.extname(meta.fileName);
    const finalName = `${base}-${Date.now().toString(36)}-${crypto
      .randomBytes(4)
      .toString("hex")}${ext}`;
    const finalPath = path.join(UPLOAD_DIR, finalName);

    const out = fs.createWriteStream(finalPath, { flags: "wx" });
    for (let p = 1; p <= meta.totalParts; p++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(path.join(dir, `part-${p}`));
        rs.on("error", reject);
        rs.on("end", resolve);
        rs.pipe(out, { end: false });
      });
    }
    await new Promise((r) => out.end(r));

    // lưu DB
    const doc = await FileAsset.create({
      originalName: meta.fileName,
      fileName: finalName,
      size: meta.size,
      mime: meta.mime,
      path: finalPath,
      isPublic: true,
      category: meta.category,
      uploadedBy: req.user?._id,
    });

    // cleanup temp
    try {
      const files = await fsp.readdir(dir);
      await Promise.all(
        files.map((f) =>
          f !== "meta.json" ? fsp.unlink(path.join(dir, f)) : null
        )
      );
      await fsp.unlink(metaPath).catch(() => {});
      await fsp.rmdir(dir).catch(() => {});
    } catch (e) {
      console.warn("cleanup chunk dir failed", e?.message);
    }

    const baseUrl = hostFrom(req);
    const item = {
      _id: doc._id,
      originalName: doc.originalName,
      fileName: doc.fileName,
      size: doc.size,
      mime: doc.mime,
      category: doc.category,
      createdAt: doc.createdAt,
      publicUrl: `${baseUrl}/dl/file/${doc._id}`,
      staticUrl: `${baseUrl}/uploads/public/${encodeURIComponent(
        doc.fileName
      )}`,
    };
    res.status(201).json({ item });
  }
);

// ===== CANCEL =====
// POST /api/files/multipart/:uploadId/cancel
router.post(
  "/multipart/:uploadId/cancel",
  protect,
  authorize("admin"),
  async (req, res) => {
    const dir = path.join(CHUNK_TMP_DIR, req.params.uploadId);
    if (!fs.existsSync(dir)) return res.status(204).end();
    try {
      const files = await fsp.readdir(dir);
      await Promise.all(
        files.map((f) => fsp.unlink(path.join(dir, f)).catch(() => {}))
      );
      await fsp.rmdir(dir).catch(() => {});
    } catch {}
    res.status(204).end();
  }
);

/* =========================
 * LIST + DELETE (giữ nguyên)
 * ========================= */

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
