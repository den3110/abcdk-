// services/avatarProcessor.js
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { avatarConfig as cfg } from "../config/avatarConfig.js";
import { logInfo, logWarn, logError } from "../utils/logger.js";

// ============ Helpers chung ============

function sanitizeFileName(name = "") {
  if (!name) name = `avatar_${Date.now()}`;
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function safeUnlink(p) {
  if (!p) return;
  try {
    await fs.unlink(p);
  } catch {
    // ignore
  }
}

async function safeCopy(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

function decideOutputFormat(inputFormat) {
  const f = (cfg.OUTPUT_FORMAT || "jpeg").toLowerCase();
  if (f === "png") return "png";
  if (f === "webp") return "webp";
  return "jpeg";
}

function extFromFormat(fmt) {
  fmt = (fmt || "").toLowerCase();
  if (fmt === "jpeg" || fmt === "jpg") return "jpg";
  if (fmt === "png") return "png";
  if (fmt === "webp") return "webp";
  return "jpg";
}

function getMaxOutputDimension() {
  const value = Number(cfg.MAX_OUTPUT_DIMENSION || 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function getResolvedLogoPath() {
  const raw = String(cfg.LOGO_PATH || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

const MAX_LOGO_VARIANTS = 32;
const logoSourceCache = {
  resolvedPath: "",
  mtimeMs: 0,
  buffer: null,
  width: 0,
  height: 0,
};
const logoVariantCache = new Map();

function clearLogoVariantCache() {
  logoVariantCache.clear();
}

function setLogoVariantCache(key, value) {
  if (logoVariantCache.has(key)) {
    logoVariantCache.delete(key);
  }
  logoVariantCache.set(key, value);

  while (logoVariantCache.size > MAX_LOGO_VARIANTS) {
    const firstKey = logoVariantCache.keys().next().value;
    if (!firstKey) break;
    logoVariantCache.delete(firstKey);
  }
}

async function loadLogoSource() {
  const resolvedPath = getResolvedLogoPath();
  if (!resolvedPath) {
    logWarn("LOGO_PATH not configured, skip logo");
    return null;
  }

  let stat = null;
  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    logWarn("Logo file not found at LOGO_PATH, skip logo:", resolvedPath);
    return null;
  }

  if (
    logoSourceCache.buffer &&
    logoSourceCache.resolvedPath === resolvedPath &&
    logoSourceCache.mtimeMs === stat.mtimeMs
  ) {
    return logoSourceCache;
  }

  try {
    const fileBuffer = await fs.readFile(resolvedPath);
    const meta = await sharp(fileBuffer, { failOnError: true }).metadata();

    if (!meta.width || !meta.height) {
      logWarn("Logo file invalid dimensions");
      return null;
    }

    logoSourceCache.resolvedPath = resolvedPath;
    logoSourceCache.mtimeMs = stat.mtimeMs;
    logoSourceCache.buffer = fileBuffer;
    logoSourceCache.width = meta.width;
    logoSourceCache.height = meta.height;
    clearLogoVariantCache();

    return logoSourceCache;
  } catch (err) {
    logError("loadLogoSource error:", err?.message || err);
    return null;
  }
}

async function getRoundedLogoVariant(logoTarget) {
  const source = await loadLogoSource();
  if (!source?.buffer) return null;

  const ratio =
    typeof cfg.LOGO_CORNER_RADIUS_RATIO === "number"
      ? Math.max(0, Math.min(0.5, cfg.LOGO_CORNER_RADIUS_RATIO))
      : 0.25;

  const cacheKey = [
    source.resolvedPath,
    source.mtimeMs,
    logoTarget,
    ratio,
  ].join(":");
  const cached = logoVariantCache.get(cacheKey);
  if (cached) return cached;

  try {
    const { data: resizedBuffer, info: resizedInfo } = await sharp(source.buffer, {
      failOnError: true,
    })
      .resize({ width: logoTarget })
      .png()
      .toBuffer({ resolveWithObject: true });

    if (!resizedInfo.width || !resizedInfo.height) {
      logWarn("Resized logo invalid");
      return null;
    }

    const radius = Math.round(
      Math.min(resizedInfo.width, resizedInfo.height) * ratio
    );
    const svg = `
      <svg width="${resizedInfo.width}" height="${resizedInfo.height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${resizedInfo.width}" height="${resizedInfo.height}" rx="${radius}" ry="${radius}" fill="white" />
      </svg>
    `;

    const { data: roundedBuffer, info: roundedInfo } = await sharp(resizedBuffer)
      .composite([
        {
          input: Buffer.from(svg),
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer({ resolveWithObject: true });

    if (!roundedInfo.width || !roundedInfo.height) {
      logWarn("Rounded logo invalid");
      return null;
    }

    const variant = {
      buffer: roundedBuffer,
      width: roundedInfo.width,
      height: roundedInfo.height,
    };
    setLogoVariantCache(cacheKey, variant);
    return variant;
  } catch (err) {
    logError("getRoundedLogoVariant error:", err?.message || err);
    return null;
  }
}

// ============ Bước 1: đọc base image an toàn ============

async function tryLoadBaseImage(tmpPath) {
  if (!tmpPath) {
    logWarn("No tmpPath provided to tryLoadBaseImage");
    return null;
  }

  try {
    let instance = sharp(tmpPath, {
      failOnError: true,
      animated: cfg.HANDLE_ANIMATED,
    }).rotate();

    // Tùy version sharp, có thể có hoặc không limitInputPixels
    if (
      typeof instance.limitInputPixels === "function" &&
      cfg.MAX_INPUT_PIXELS
    ) {
      instance = instance.limitInputPixels(cfg.MAX_INPUT_PIXELS);
    }

    const maxOutputDimension = getMaxOutputDimension();
    if (maxOutputDimension > 0) {
      instance = instance.resize({
        width: maxOutputDimension,
        height: maxOutputDimension,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const { data, info } = await instance.toBuffer({ resolveWithObject: true });

    if (!info.width || !info.height) {
      logWarn("Invalid image dimensions", info);
      return null;
    }

    return { buffer: data, info };
  } catch (err) {
    logError("tryLoadBaseImage error:", err?.message || err);
    return null;
  }
}

// ============ Bước 2: chuẩn bị logo ============

async function tryBuildLogoForImage(imgW, imgH) {
  if (!imgW || !imgH) {
    logWarn("tryBuildLogoForImage: missing imgW/imgH");
    return null;
  }

  const shortSide = Math.min(imgW, imgH);
  let logoTarget = Math.round(shortSide * cfg.LOGO_RATIO);

  if (logoTarget < cfg.LOGO_MIN) logoTarget = cfg.LOGO_MIN;
  if (logoTarget > cfg.LOGO_MAX) logoTarget = cfg.LOGO_MAX;

  const padding = Math.max(
    cfg.PADDING_MIN,
    Math.round(shortSide * cfg.PADDING_RATIO)
  );

  try {
    const roundedLogo = await getRoundedLogoVariant(logoTarget);
    if (!roundedLogo?.width || !roundedLogo?.height) return null;
    return {
      buffer: roundedLogo.buffer,
      width: roundedLogo.width,
      height: roundedLogo.height,
      padding,
    };
    /*

    // check tồn tại logo gốc


    // 1) Resize logo THEO WIDTH, giữ tỉ lệ

    // 2) Tạo mask bo góc
    return {
      typeof cfg.LOGO_CORNER_RADIUS_RATIO === "number"
        ? Math.max(0, Math.min(0.5, cfg.LOGO_CORNER_RADIUS_RATIO))
        : 0.25; // mặc định bo 25% cạnh ngắn

    const radius = Math.round(Math.min(w, h) * ratio);

    const svg = `
      <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="white" />
      </svg>
    `;

    const rounded = await sharp(resized)
      .composite([
        {
          input: Buffer.from(svg),
          blend: "dest-in", // dùng mask để bo góc
        },
      ])
      .png()
      .toBuffer();

    const roundedMeta = await sharp(rounded).metadata();
    if (!roundedMeta.width || !roundedMeta.height) {
      logWarn("Rounded logo invalid");
      return null;
    }

    return {
      buffer: rounded,
      width: roundedMeta.width,
      height: roundedMeta.height,
      padding,
    };
    */
  } catch (err) {
    logError("tryBuildLogoForImage error:", err?.message || err);
    return null;
  }
}

// ============ Bước 3: composite logo ============

async function tryCompositeLogo(baseBuffer, baseInfo, logo) {
  if (!baseBuffer || !baseInfo || !logo) return null;

  const imgW = baseInfo.width;
  const imgH = baseInfo.height;

  const left = imgW - logo.width - logo.padding;
  const top = logo.padding;

  if (left < 0 || top < 0) {
    logWarn("Image too small for logo, skip logo", {
      imgW,
      imgH,
      logoW: logo.width,
      logoH: logo.height,
      padding: logo.padding,
    });
    return null;
  }

  try {
    const fmt = decideOutputFormat(baseInfo.format);
    let pipeline = sharp(baseBuffer).composite([
      {
        input: logo.buffer,
        top,
        left,
      },
    ]);

    if (fmt === "jpeg") {
      pipeline = pipeline.jpeg({
        quality: cfg.JPEG_QUALITY,
        mozjpeg: true,
      });
    } else if (fmt === "webp") {
      pipeline = pipeline.webp({
        quality: cfg.WEBP_QUALITY,
      });
    } else if (fmt === "png") {
      pipeline = pipeline.png({
        compressionLevel: cfg.PNG_COMPRESSION_LEVEL,
      });
    }

    const out = await pipeline.toBuffer();
    return { buffer: out, format: fmt };
  } catch (err) {
    logError("tryCompositeLogo error:", err?.message || err);
    return null;
  }
}

// ============ Bước 4: fallback: normalize không logo ============

async function tryNormalizeWithoutLogo(baseBuffer, baseInfo) {
  if (!baseBuffer || !baseInfo) return null;

  try {
    const fmt = decideOutputFormat(baseInfo.format);
    let pipeline = sharp(baseBuffer);

    if (fmt === "jpeg") {
      pipeline = pipeline.jpeg({
        quality: cfg.JPEG_QUALITY,
        mozjpeg: true,
      });
    } else if (fmt === "webp") {
      pipeline = pipeline.webp({
        quality: cfg.WEBP_QUALITY,
      });
    } else if (fmt === "png") {
      pipeline = pipeline.png({
        compressionLevel: cfg.PNG_COMPRESSION_LEVEL,
      });
    }

    const out = await pipeline.toBuffer();
    return { buffer: out, format: fmt };
  } catch (err) {
    logError("tryNormalizeWithoutLogo error:", err?.message || err);
    return null;
  }
}

// ============ Bước 5: fallback cuối: default avatar ============

async function useDefaultAvatar(finalDir, finalBaseName) {
  const safeName = sanitizeFileName(finalBaseName);
  await ensureDir(finalDir);

  // Nếu cấu hình DEFAULT_AVATAR_PATH và file tồn tại -> copy
  if (cfg.DEFAULT_AVATAR_PATH) {
    try {
      await fs.access(cfg.DEFAULT_AVATAR_PATH);
      const ext = path.extname(cfg.DEFAULT_AVATAR_PATH) || ".jpg";
      const finalPath = path.join(finalDir, `${safeName}${ext}`);
      await safeCopy(cfg.DEFAULT_AVATAR_PATH, finalPath);
      logInfo("Fallback to DEFAULT_AVATAR", { finalPath });
      return finalPath;
    } catch {
      logWarn(
        "DEFAULT_AVATAR_PATH not found or unreadable, will create empty fallback:",
        cfg.DEFAULT_AVATAR_PATH
      );
    }
  }

  // Nếu không có default hoặc copy fail → tạo file rỗng
  const finalPath = path.join(finalDir, `${safeName}_empty.jpg`);
  try {
    await fs.writeFile(finalPath, Buffer.alloc(0));
    logInfo("Fallback to EMPTY_AVATAR", { finalPath });
    return finalPath;
  } catch (err) {
    logError("useDefaultAvatar final error:", err?.message || err);
    return finalPath; // vẫn trả path cho chắc
  }
}

// ============ API chính ============

/**
 * Xử lý avatar:
 * - Không throw ra ngoài.
 * - Luôn trả về { success: true, avatarUrl }.
 * - Pipeline:
 *   1) Load base từ file upload (file.path) nếu có.
 *   2) Thử dán logo.
 *   3) Nếu fail -> normalize không logo.
 *   4) Nếu vẫn fail / không có file -> dùng default avatar.
 *
 * @param {object|null} file - Multer file (đã lưu ra đĩa) hoặc null để dùng default.
 * @param {string} finalDir - Thư mục lưu avatar cuối (ví dụ: AVATAR_DIR).
 * @param {string} finalFileName - Base name mong muốn cho file output (không ext).
 */
export async function processAvatarWithLogoAlways(
  file,
  finalDir,
  finalFileName
) {
  await ensureDir(finalDir);

  const tmpPath = file?.path || null;

  // base name để đặt file output (luôn khác file tạm)
  const rawBase =
    finalFileName ||
    (file?.filename
      ? path.basename(file.filename, path.extname(file.filename))
      : `avatar_${Date.now()}`);

  const safeBase = sanitizeFileName(rawBase);
  const finalBase = `${safeBase}_final`; // tránh trùng tên file upload gốc

  let chosenPath = null;

  try {
    // 1) Nếu có file: thử đọc
    const base = await tryLoadBaseImage(tmpPath);

    if (base) {
      // 2) Logo
      const logo = await tryBuildLogoForImage(
        base.info.width,
        base.info.height
      );

      let result = null;

      if (logo) {
        result = await tryCompositeLogo(base.buffer, base.info, logo);
      }

      // 3) Nếu không có logo hoặc composite fail → normalize
      if (!result) {
        result = await tryNormalizeWithoutLogo(base.buffer, base.info);
      }

      // 4) Nếu có buffer kết quả → ghi file output
      if (result && result.buffer?.length) {
        const ext = extFromFormat(result.format);
        const finalPath = path.join(finalDir, `${finalBase}.${ext}`);
        await fs.writeFile(finalPath, result.buffer);
        chosenPath = finalPath;
        logInfo("Avatar processed OK", {
          finalPath,
          format: result.format,
          withLogo: !!logo,
        });
      }
    }

    // 5) Nếu không có base hoặc xử lý fail → dùng default
    if (!chosenPath) {
      chosenPath = await useDefaultAvatar(finalDir, finalBase);
    }
  } catch (err) {
    logError(
      "processAvatarWithLogoAlways unexpected error:",
      err?.message || err
    );
    if (!chosenPath) {
      chosenPath = await useDefaultAvatar(finalDir, finalBase);
    }
  } finally {
    // Xoá file tạm nếu khác file output
    if (tmpPath) {
      try {
        if (!chosenPath || path.resolve(tmpPath) !== path.resolve(chosenPath)) {
          await safeUnlink(tmpPath);
        }
      } catch {
        // ignore
      }
    }
  }

  // ===== Chuẩn hoá path trả ra thành URL tương đối =====

  if (!chosenPath) {
    logError(
      "processAvatarWithLogoAlways: chosenPath is empty after all fallbacks"
    );
    return {
      success: true,
      avatarUrl: "/uploads/avatars/default-avatar.jpg",
    };
  }

  let relativePath = path
    .relative(process.cwd(), chosenPath)
    .replace(/\\/g, "/");

  // Nếu relativePath trỏ ra ngoài (bắt đầu bằng ..) thì ép về uploads/avatars
  if (!relativePath || relativePath.startsWith("..")) {
    const baseName = path.basename(chosenPath);
    const fallbackDir = "uploads/avatars";
    relativePath = `${fallbackDir}/${baseName}`;
  }

  const urlPath = "/" + relativePath.replace(/^\/+/, "");

  return {
    success: true,
    avatarUrl: urlPath,
  };
}
