import fs from "fs";
import path from "path";
import expressAsyncHandler from "express-async-handler";
import { resolveTournamentImageDiskPath } from "../../utils/adminTournamentImageProxy.js";

const MIME_TYPES = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

export const getAdminTournamentImageProxy = expressAsyncHandler(
  async (req, res) => {
    const src = String(req.query.src || "").trim();
    if (!src) {
      res.status(400);
      throw new Error("Missing src query");
    }

    const resolved = resolveTournamentImageDiskPath(src);
    if (!resolved) {
      res.status(400);
      throw new Error("Invalid tournament image source");
    }

    let stat;
    try {
      stat = await fs.promises.stat(resolved.filePath);
    } catch {
      res.status(404);
      throw new Error("Tournament image not found");
    }

    if (!stat.isFile()) {
      res.status(404);
      throw new Error("Tournament image not found");
    }

    res.setHeader("Content-Type", getMimeType(resolved.filePath));
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Last-Modified", stat.mtime.toUTCString());
    res.setHeader("X-Content-Type-Options", "nosniff");

    const stream = fs.createReadStream(resolved.filePath);
    stream.on("error", (error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.status(500).json({ message: "Cannot stream tournament image" });
    });
    stream.pipe(res);
  }
);
