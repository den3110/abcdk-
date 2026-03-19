import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { toPublicUrl } from "./publicUrl.js";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const OPTIMIZED_PUBLIC_DIR = "/uploads/optimized/rankings";
const OPTIMIZED_DIR = path.join(UPLOADS_ROOT, "optimized", "rankings");
const AVATAR_WIDTH = 512;
const AVATAR_HEIGHT = 512;
const AVATAR_QUALITY = 78;

function extractUploadsPath(raw) {
  if (!raw) return "";
  const value = String(raw).trim();
  if (!value) return "";

  if (value.startsWith("/uploads/")) return value;

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.pathname.startsWith("/uploads/") ? parsed.pathname : "";
    } catch {
      return "";
    }
  }

  return value.startsWith("uploads/") ? `/${value}` : "";
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export async function ensureRankingAvatarUrl(req, raw) {
  const fallbackUrl = toPublicUrl(req, raw);
  const uploadsPath = extractUploadsPath(raw);

  if (!uploadsPath || uploadsPath.startsWith(OPTIMIZED_PUBLIC_DIR)) {
    return fallbackUrl;
  }

  const sourcePath = path.join(process.cwd(), uploadsPath.replace(/^\/+/, ""));
  const sourceStat = await safeStat(sourcePath);
  if (!sourceStat?.isFile()) return fallbackUrl;

  const parsed = path.parse(sourcePath);
  const suffix = crypto
    .createHash("sha1")
    .update(uploadsPath)
    .digest("hex")
    .slice(0, 10);
  const outputFileName = `${parsed.name}-${suffix}-${AVATAR_WIDTH}w.webp`;
  const outputPath = path.join(OPTIMIZED_DIR, outputFileName);
  const outputStat = await safeStat(outputPath);

  if (!outputStat || outputStat.mtimeMs < sourceStat.mtimeMs) {
    try {
      await fs.mkdir(OPTIMIZED_DIR, { recursive: true });
      await sharp(sourcePath)
        .rotate()
        .resize({
          width: AVATAR_WIDTH,
          height: AVATAR_HEIGHT,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: AVATAR_QUALITY, effort: 4 })
        .toFile(outputPath);
    } catch (error) {
      console.error(
        "[rankingAvatarVariant] optimize failed:",
        error?.message || error
      );
      return fallbackUrl;
    }
  }

  return toPublicUrl(req, `${OPTIMIZED_PUBLIC_DIR}/${outputFileName}`);
}
