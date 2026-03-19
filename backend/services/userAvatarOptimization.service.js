import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import User from "../models/userModel.js";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const AVATAR_PUBLIC_DIR = "/uploads/avatars";
const AVATAR_DIR = path.join(UPLOADS_ROOT, "avatars");
const OPTIMIZED_PUBLIC_DIR = `${AVATAR_PUBLIC_DIR}/optimized`;
const OPTIMIZED_DIR = path.join(AVATAR_DIR, "optimized");
const TRASH_DIR = path.join(AVATAR_DIR, "_trash");

const MAX_SOURCE_BYTES = Math.max(
  128 * 1024,
  Number.parseInt(
    process.env.USER_AVATAR_OPTIMIZE_THRESHOLD_BYTES || "716800",
    10
  ) || 716800
);
const MAX_DIMENSION = Math.max(
  256,
  Number.parseInt(
    process.env.USER_AVATAR_OPTIMIZE_MAX_DIMENSION || "1200",
    10
  ) || 1200
);
const WEBP_QUALITY = Math.max(
  50,
  Math.min(
    95,
    Number.parseInt(process.env.USER_AVATAR_OPTIMIZE_QUALITY || "80", 10) || 80
  )
);
const MIN_SAVED_BYTES = Math.max(
  8 * 1024,
  Number.parseInt(
    process.env.USER_AVATAR_OPTIMIZE_MIN_SAVED_BYTES || "32768",
    10
  ) || 32768
);
const DELETE_ORIGINALS =
  String(process.env.USER_AVATAR_DELETE_ORIGINAL || "1").trim() !== "0";
const DEFAULT_BATCH_SIZE = Math.max(
  1,
  Number.parseInt(process.env.USER_AVATAR_OPTIMIZE_BATCH_SIZE || "25", 10) ||
    25
);

const queuedUserIds = new Set();

export function getUserAvatarOptimizationConfig() {
  return {
    thresholdBytes: MAX_SOURCE_BYTES,
    maxDimension: MAX_DIMENSION,
    quality: WEBP_QUALITY,
    minSavedBytes: MIN_SAVED_BYTES,
    deleteOriginals: DELETE_ORIGINALS,
    batchSize: DEFAULT_BATCH_SIZE,
    optimizedDir: OPTIMIZED_DIR,
    optimizedPublicDir: OPTIMIZED_PUBLIC_DIR,
    trashDir: TRASH_DIR,
  };
}

export function getQueuedUserAvatarOptimizationCount() {
  return queuedUserIds.size;
}

export function buildPendingUserAvatarOptimizationFilter() {
  return {
    avatar: { $type: "string", $ne: "" },
    $or: [
      { "avatarOptimization.done": { $ne: true } },
      {
        $expr: {
          $ne: [
            { $ifNull: ["$avatarOptimization.optimizedFor", ""] },
            { $ifNull: ["$avatar", ""] },
          ],
        },
      },
    ],
  };
}

function normalizeAvatarValue(raw) {
  return String(raw || "").trim();
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAbsoluteHttpUrl(raw) {
  return /^https?:\/\//i.test(String(raw || "").trim());
}

function extractAvatarUploadsPath(raw) {
  const value = normalizeAvatarValue(raw);
  if (!value) return "";

  if (value.startsWith(`${AVATAR_PUBLIC_DIR}/`)) return value;
  if (value === AVATAR_PUBLIC_DIR) return value;

  if (value.startsWith("uploads/avatars/")) return `/${value}`;

  if (isAbsoluteHttpUrl(value)) {
    try {
      const parsed = new URL(value);
      return parsed.pathname.startsWith(`${AVATAR_PUBLIC_DIR}/`)
        ? parsed.pathname
        : "";
    } catch {
      return "";
    }
  }

  return "";
}

function isOptimizedAvatarPath(uploadsPath) {
  return String(uploadsPath || "").startsWith(`${OPTIMIZED_PUBLIC_DIR}/`);
}

function isDefaultAvatarPath(uploadsPath) {
  const fileName = path.basename(String(uploadsPath || "")).toLowerCase();
  return (
    fileName === "default-avatar.jpg" ||
    fileName === "default-avatar.jpeg" ||
    fileName === "default-avatar.png" ||
    fileName === "default-avatar.webp"
  );
}

function uploadsPathToFsPath(uploadsPath) {
  return path.join(process.cwd(), String(uploadsPath || "").replace(/^\/+/, ""));
}

function buildStoredAvatarValue(currentAvatar, optimizedUploadsPath) {
  const nextValue = normalizeAvatarValue(optimizedUploadsPath);
  const currentValue = normalizeAvatarValue(currentAvatar);

  if (!currentValue || !isAbsoluteHttpUrl(currentValue)) {
    return nextValue;
  }

  try {
    const currentUrl = new URL(currentValue);
    if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
      currentUrl.protocol = "https:";
    }
    return new URL(nextValue, `${currentUrl.origin}/`).toString();
  } catch {
    return nextValue;
  }
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}

async function safeRename(sourcePath, targetPath) {
  try {
    await fs.rename(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

async function markAvatarProcessed(userId, currentAvatar) {
  const avatarValue = normalizeAvatarValue(currentAvatar);
  await User.updateOne(
    { _id: userId, avatar: currentAvatar },
    {
      $set: {
        "avatarOptimization.done": !!avatarValue,
        "avatarOptimization.optimizedFor": avatarValue,
        "avatarOptimization.optimizedAt": avatarValue ? new Date() : null,
      },
    }
  );
}

async function buildOptimizedAvatarFile(currentAvatar) {
  const uploadsPath = extractAvatarUploadsPath(currentAvatar);
  if (!uploadsPath) {
    return { action: "skip-non-local" };
  }

  if (isDefaultAvatarPath(uploadsPath) || isOptimizedAvatarPath(uploadsPath)) {
    return { action: "skip-existing" };
  }

  const sourcePath = uploadsPathToFsPath(uploadsPath);
  const sourceStat = await safeStat(sourcePath);
  if (!sourceStat?.isFile()) {
    return { action: "skip-missing" };
  }

  let metadata = null;
  try {
    metadata = await sharp(sourcePath).metadata();
  } catch {
    return { action: "skip-unreadable" };
  }

  const maxDimension = Math.max(metadata?.width || 0, metadata?.height || 0);
  const needsOptimize =
    sourceStat.size > MAX_SOURCE_BYTES || maxDimension > MAX_DIMENSION;

  if (!needsOptimize) {
    return { action: "skip-light" };
  }

  const parsed = path.parse(sourcePath);
  const suffix = crypto
    .createHash("sha1")
    .update(`${uploadsPath}:${sourceStat.size}:${sourceStat.mtimeMs}`)
    .digest("hex")
    .slice(0, 12);
  const outputFileName = `${parsed.name}-${suffix}.webp`;
  const outputPath = path.join(OPTIMIZED_DIR, outputFileName);
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;

  await fs.mkdir(OPTIMIZED_DIR, { recursive: true });

  try {
    await sharp(sourcePath)
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toFile(tempPath);

    await safeUnlink(outputPath);
    await fs.rename(tempPath, outputPath);
  } catch (error) {
    await safeUnlink(tempPath);
    throw error;
  }

  const optimizedStat = await safeStat(outputPath);
  if (!optimizedStat?.isFile()) {
    await safeUnlink(outputPath);
    return { action: "skip-no-output" };
  }

  const hasMaterialSavings =
    optimizedStat.size <= sourceStat.size - MIN_SAVED_BYTES ||
    maxDimension > MAX_DIMENSION;

  if (!hasMaterialSavings) {
    await safeUnlink(outputPath);
    return { action: "skip-no-gain" };
  }

  const nextUploadsPath = `${OPTIMIZED_PUBLIC_DIR}/${outputFileName}`;

  return {
    action: "optimized",
    currentAvatar: normalizeAvatarValue(currentAvatar),
    nextAvatar: buildStoredAvatarValue(currentAvatar, nextUploadsPath),
    outputPath,
    sourcePath,
    sourceSize: sourceStat.size,
    optimizedSize: optimizedStat.size,
  };
}

async function maybeArchiveOriginalAvatar(userId, currentAvatar) {
  if (!DELETE_ORIGINALS) {
    return false;
  }

  const uploadsPath = extractAvatarUploadsPath(currentAvatar);
  if (
    !uploadsPath ||
    isDefaultAvatarPath(uploadsPath) ||
    isOptimizedAvatarPath(uploadsPath)
  ) {
    return false;
  }

  const fileName = path.basename(uploadsPath);
  const candidates = await User.find({
    _id: { $ne: userId },
    avatar: {
      $type: "string",
      $regex: escapeRegExp(fileName),
      $options: "i",
    },
  })
    .select("avatar")
    .lean();

  const shared = candidates.some(
    (doc) => extractAvatarUploadsPath(doc?.avatar) === uploadsPath
  );
  if (shared) return false;

  const sourcePath = uploadsPathToFsPath(uploadsPath);
  const sourceStat = await safeStat(sourcePath);
  if (!sourceStat?.isFile()) return false;

  const parsed = path.parse(sourcePath);
  const suffix = crypto
    .createHash("sha1")
    .update(`${uploadsPath}:${sourceStat.size}:${sourceStat.mtimeMs}`)
    .digest("hex")
    .slice(0, 10);
  const trashFileName = `${parsed.name}-${Date.now()}-${suffix}${parsed.ext}`;
  const trashPath = path.join(TRASH_DIR, trashFileName);

  await fs.mkdir(TRASH_DIR, { recursive: true });

  const renamed = await safeRename(sourcePath, trashPath);
  if (renamed) return true;

  try {
    await fs.copyFile(sourcePath, trashPath);
    await safeUnlink(sourcePath);
    return true;
  } catch {
    await safeUnlink(trashPath);
    return false;
  }
}

export async function processUserAvatarOptimization(userLike) {
  const userId = userLike?._id;
  const currentAvatar = normalizeAvatarValue(userLike?.avatar);

  if (!userId || !currentAvatar) {
    return { action: "skip-empty" };
  }

  const job = await buildOptimizedAvatarFile(currentAvatar);

  if (job.action !== "optimized") {
    await markAvatarProcessed(userId, currentAvatar);
    return {
      action: job.action,
      userId: String(userId),
      avatar: currentAvatar,
    };
  }

  try {
    const updateResult = await User.updateOne(
      { _id: userId, avatar: currentAvatar },
      {
        $set: {
          avatar: job.nextAvatar,
          "avatarOptimization.done": true,
          "avatarOptimization.optimizedFor": job.nextAvatar,
          "avatarOptimization.optimizedAt": new Date(),
        },
      }
    );

    if (!updateResult.modifiedCount) {
      await safeUnlink(job.outputPath);
      return {
        action: "skip-race",
        userId: String(userId),
        avatar: currentAvatar,
      };
    }

    const archivedOriginal = await maybeArchiveOriginalAvatar(
      userId,
      currentAvatar
    );
    return {
      action: "optimized",
      userId: String(userId),
      from: currentAvatar,
      to: job.nextAvatar,
      archivedOriginal,
      savedBytes: Math.max(0, job.sourceSize - job.optimizedSize),
    };
  } catch (error) {
    await safeUnlink(job.outputPath);
    throw error;
  }
}

export async function processUserAvatarOptimizationById(userId) {
  const user = await User.findById(userId)
    .select("_id avatar avatarOptimization")
    .lean();
  if (!user?._id) {
    return { action: "skip-missing-user", userId: String(userId || "") };
  }
  return processUserAvatarOptimization(user);
}

export function queueUserAvatarOptimizationById(userId) {
  const id = String(userId || "").trim();
  if (!id || queuedUserIds.has(id)) return false;

  queuedUserIds.add(id);
  setImmediate(async () => {
    try {
      await processUserAvatarOptimizationById(id);
    } catch (error) {
      console.error(
        "[avatar-optimize][queue] failed:",
        id,
        error?.message || error
      );
    } finally {
      queuedUserIds.delete(id);
    }
  });

  return true;
}

export async function runPendingUserAvatarOptimizationSweep(options = {}) {
  const batchSize = Math.max(
    1,
    Number.parseInt(options.batchSize ?? DEFAULT_BATCH_SIZE, 10) ||
      DEFAULT_BATCH_SIZE
  );
  const stats = {
    scanned: 0,
    optimized: 0,
    skipped: 0,
    archivedOriginals: 0,
    savedBytes: 0,
  };

  // Process until the queue is empty; each processed user marks its current avatar as done.
  for (;;) {
    const batch = await User.find(buildPendingUserAvatarOptimizationFilter())
      .sort({ _id: 1 })
      .limit(batchSize)
      .select("_id avatar avatarOptimization")
      .lean();

    if (!batch.length) {
      return stats;
    }

    for (const user of batch) {
      try {
        const result = await processUserAvatarOptimization(user);
        stats.scanned += 1;
        if (result.action === "optimized") {
          stats.optimized += 1;
          stats.savedBytes += result.savedBytes || 0;
          if (result.archivedOriginal) stats.archivedOriginals += 1;
        } else {
          stats.skipped += 1;
        }
      } catch (error) {
        stats.scanned += 1;
        stats.skipped += 1;
        console.error(
          "[avatar-optimize][sweep] failed:",
          user?._id,
          error?.message || error
        );
        await markAvatarProcessed(user?._id, user?.avatar || "");
      }
    }
  }
}
