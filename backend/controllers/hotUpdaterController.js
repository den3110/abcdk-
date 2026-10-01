import fs from "fs";
import path from "path";
import semver from "semver";
import asyncHandler from "express-async-handler";
import HotUpdaterBundle from "../models/hotUpdaterBundleModel.js";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Thư mục lưu file bundle .zip trên VPS (ngoài git, tồn tại qua các lần deploy).
const HU_DIR =
  process.env.HOTUPDATER_STORAGE_DIR ||
  path.join(process.cwd(), "storage", "hot-updater");
// Base công khai để app tải file.
const HU_PUBLIC_BASE = (
  process.env.HOTUPDATER_PUBLIC_BASE || "https://pickletour.vn/api/hot-updater"
).replace(/\/+$/, "");

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}
ensureDir(HU_DIR);

function keyFromStorageUri(storageUri) {
  if (!storageUri) return null;
  return String(storageUri).replace(/^vps:\/\//, "");
}

/** Chống path traversal: chuẩn hoá key về relative an toàn. */
function safeRelKey(key) {
  const cleaned = String(key || "")
    .replace(/^vps:\/\//, "")
    .replace(/^\/+/, "");
  const norm = path.posix.normalize(cleaned);
  if (
    !norm ||
    norm === "." ||
    norm.startsWith("..") ||
    norm.includes("/../") ||
    path.isAbsolute(norm)
  ) {
    return null;
  }
  return norm;
}

function diskPathForKey(key) {
  const rel = safeRelKey(key);
  if (!rel) return null;
  return path.join(HU_DIR, rel);
}

function fileUrlForStorageUri(storageUri) {
  const key = keyFromStorageUri(storageUri);
  if (!key) return null;
  return `${HU_PUBLIC_BASE}/file/${key}`;
}

function toBundle(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    platform: doc.platform,
    shouldForceUpdate: !!doc.shouldForceUpdate,
    enabled: !!doc.enabled,
    fileHash: doc.fileHash || "",
    storageUri: doc.storageUri || "",
    gitCommitHash: doc.gitCommitHash ?? null,
    message: doc.message ?? null,
    channel: doc.channel || "production",
    targetAppVersion: doc.targetAppVersion ?? null,
    fingerprintHash: doc.fingerprintHash ?? null,
    metadata: doc.metadata ?? {},
  };
}

/** Giống filterCompatibleAppVersions của hot-updater. */
function filterCompatibleAppVersions(targetList, appVersion) {
  const av = semver.valid(semver.coerce(appVersion)) || appVersion;
  return (targetList || []).filter((t) => {
    if (!t) return false;
    if (t === "*") return true;
    if (t === appVersion) return true;
    try {
      if (semver.validRange(t)) {
        return semver.satisfies(av, t, { includePrerelease: true });
      }
    } catch (_) {}
    return false;
  });
}

function nilRollback() {
  return {
    id: NIL_UUID,
    shouldForceUpdate: true,
    status: "ROLLBACK",
    message: null,
    storageUri: null,
    fileHash: null,
  };
}

async function appVersionStrategy({
  platform,
  appVersion,
  bundleId,
  minBundleId,
  channel,
}) {
  const distinct = await HotUpdaterBundle.distinct("targetAppVersion", {
    platform,
  });
  const compatible = filterCompatibleAppVersions(distinct, appVersion);

  let update = null;
  if (compatible.length) {
    update = await HotUpdaterBundle.findOne({
      enabled: true,
      platform,
      channel,
      targetAppVersion: { $in: compatible },
      _id: { $gte: bundleId },
    })
      .sort({ _id: -1 })
      .lean();
  }

  if (update) {
    if (update._id === bundleId) return null; // đã ở bản mới nhất
    return {
      id: update._id,
      shouldForceUpdate: !!update.shouldForceUpdate,
      status: "UPDATE",
      message: update.message ?? null,
      storageUri: update.storageUri || null,
      fileHash: update.fileHash || null,
    };
  }

  const rollback = await HotUpdaterBundle.findOne({
    enabled: true,
    platform,
    _id: { $lt: bundleId, $gte: minBundleId },
  })
    .sort({ _id: -1 })
    .lean();

  if (rollback && rollback._id !== bundleId) {
    return {
      id: rollback._id,
      shouldForceUpdate: true,
      status: "ROLLBACK",
      message: rollback.message ?? null,
      storageUri: rollback.storageUri || null,
      fileHash: rollback.fileHash || null,
    };
  }

  if (bundleId > minBundleId) return nilRollback();
  return null;
}

async function fingerprintStrategy({
  platform,
  fingerprintHash,
  bundleId,
  minBundleId,
  channel,
}) {
  const update = await HotUpdaterBundle.findOne({
    enabled: true,
    platform,
    channel,
    fingerprintHash,
    _id: { $gte: bundleId },
  })
    .sort({ _id: -1 })
    .lean();

  if (update) {
    if (update._id === bundleId) return null;
    return {
      id: update._id,
      shouldForceUpdate: !!update.shouldForceUpdate,
      status: "UPDATE",
      message: update.message ?? null,
      storageUri: update.storageUri || null,
      fileHash: update.fileHash || null,
    };
  }

  const rollback = await HotUpdaterBundle.findOne({
    enabled: true,
    platform,
    channel,
    fingerprintHash,
    _id: { $lt: bundleId, $gte: minBundleId },
  })
    .sort({ _id: -1 })
    .lean();

  if (rollback && rollback._id !== bundleId) {
    return {
      id: rollback._id,
      shouldForceUpdate: true,
      status: "ROLLBACK",
      message: rollback.message ?? null,
      storageUri: rollback.storageUri || null,
      fileHash: rollback.fileHash || null,
    };
  }

  if (bundleId > minBundleId) return nilRollback();
  return null;
}

function withFileUrl(info) {
  if (!info) return null;
  const { storageUri, ...rest } = info;
  if (info.id === NIL_UUID || !storageUri) {
    return { ...rest, fileUrl: null };
  }
  return { ...rest, fileUrl: fileUrlForStorageUri(storageUri) };
}

/* ============================ PUBLIC (app gọi) ============================ */

// GET /api/hot-updater/check-update
export const checkUpdate = asyncHandler(async (req, res) => {
  const h = req.headers;
  const bundleId = h["x-bundle-id"];
  const appPlatform = h["x-app-platform"];
  const minBundleId = h["x-min-bundle-id"] || NIL_UUID;
  const appVersion = h["x-app-version"];
  const channel = h["x-channel"] || "production";
  const fingerprintHash = h["x-fingerprint-hash"] || null;

  if (!bundleId || !appPlatform) {
    return res.status(400).json({
      error: "Missing required headers (x-app-platform, x-bundle-id).",
    });
  }
  if (!appVersion && !fingerprintHash) {
    return res.status(400).json({
      error: "Missing required headers (x-app-version or x-fingerprint-hash).",
    });
  }

  // [TẠM] Log để chẩn đoán vì sao app nhận null — gỡ sau khi xác định.
  console.log(
    `[hotupdater][check] platform=${appPlatform} ver=${appVersion} channel=${channel} ` +
    `bundleId=${bundleId} minBundleId=${minBundleId} fp=${fingerprintHash || "-"} ` +
    `ua=${(h["user-agent"] || "").slice(0, 40)}`
  );

  const info = fingerprintHash
    ? await fingerprintStrategy({
        platform: appPlatform,
        fingerprintHash,
        bundleId,
        minBundleId,
        channel,
      })
    : await appVersionStrategy({
        platform: appPlatform,
        appVersion,
        bundleId,
        minBundleId,
        channel,
      });

  console.log(`[hotupdater][check] → ${info ? (info.status + " " + info.id) : "NULL (no update)"}`);
  return res.status(200).json(withFileUrl(info));
});

// Client hot-updater (DefaultResolver) gọi theo ĐƯỜNG DẪN, KHÔNG dùng header:
//   GET /check-update/app-version/<platform>/<appVersion>/<channel>/<minBundleId>/<bundleId>
//   GET /check-update/fingerprint/<platform>/<fingerprintHash>/<channel>/<minBundleId>/<bundleId>
// (Thiếu 2 route này là lý do app nhận null từ 28/9 — self-host chỉ có /check-update header.)
export const checkUpdateAppVersionPath = asyncHandler(async (req, res) => {
  const { platform, appVersion, channel, minBundleId, bundleId } = req.params;
  console.log(
    `[hotupdater][check-path] app-version platform=${platform} ver=${appVersion} ` +
    `channel=${channel} bundleId=${bundleId} minBundleId=${minBundleId}`
  );
  if (!platform || !bundleId || !appVersion) {
    return res.status(400).json({ error: "Missing path params" });
  }
  const info = await appVersionStrategy({
    platform,
    appVersion,
    bundleId,
    minBundleId: minBundleId || NIL_UUID,
    channel: channel || "production",
  });
  console.log(`[hotupdater][check-path] → ${info ? info.status + " " + info.id : "NULL (no update)"}`);
  return res.status(200).json(withFileUrl(info));
});

export const checkUpdateFingerprintPath = asyncHandler(async (req, res) => {
  const { platform, fingerprintHash, channel, minBundleId, bundleId } = req.params;
  console.log(
    `[hotupdater][check-path] fingerprint platform=${platform} fp=${fingerprintHash} ` +
    `channel=${channel} bundleId=${bundleId} minBundleId=${minBundleId}`
  );
  if (!platform || !bundleId || !fingerprintHash) {
    return res.status(400).json({ error: "Missing path params" });
  }
  const info = await fingerprintStrategy({
    platform,
    fingerprintHash,
    bundleId,
    minBundleId: minBundleId || NIL_UUID,
    channel: channel || "production",
  });
  console.log(`[hotupdater][check-path] → ${info ? info.status + " " + info.id : "NULL (no update)"}`);
  return res.status(200).json(withFileUrl(info));
});

// GET /api/hot-updater/file/* -> stream file .zip
export const downloadFile = asyncHandler(async (req, res) => {
  const key = req.params[0] || "";
  const filePath = diskPathForKey(key);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  const fileName = path.basename(filePath);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  fs.createReadStream(filePath).pipe(res);
});

/* ==================== DEPLOY PLUGIN API (cần key) ==================== */

function requireDeployKey(req, res) {
  const expected = process.env.HOTUPDATER_DEPLOY_KEY;
  const got = req.headers["x-hotupdater-key"];
  if (!expected || got !== expected) {
    res.status(401).json({ error: "Invalid hot-updater deploy key" });
    return false;
  }
  return true;
}

// GET /_db/bundles/:id
export const dbGetBundleById = asyncHandler(async (req, res) => {
  if (!requireDeployKey(req, res)) return;
  const doc = await HotUpdaterBundle.findById(req.params.id).lean();
  res.json({ data: toBundle(doc) });
});

// GET /_db/bundles?limit&offset&channel&platform
export const dbGetBundles = asyncHandler(async (req, res) => {
  if (!requireDeployKey(req, res)) return;
  const limit = Math.max(1, Number(req.query.limit) || 20);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const where = {};
  if (req.query.channel) where.channel = String(req.query.channel);
  if (req.query.platform) where.platform = String(req.query.platform);

  const [docs, total] = await Promise.all([
    HotUpdaterBundle.find(where)
      .sort({ _id: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    HotUpdaterBundle.countDocuments(where),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  res.json({
    data: docs.map(toBundle),
    pagination: {
      total,
      hasNextPage: offset + limit < total,
      hasPreviousPage: offset > 0,
      currentPage,
      totalPages,
    },
  });
});

// GET /_db/channels
export const dbGetChannels = asyncHandler(async (req, res) => {
  if (!requireDeployKey(req, res)) return;
  const channels = await HotUpdaterBundle.distinct("channel");
  res.json({ data: channels.filter(Boolean) });
});

// POST /_db/commit  { changedSets: [{operation, data}] }
export const dbCommit = asyncHandler(async (req, res) => {
  if (!requireDeployKey(req, res)) return;
  const changedSets = Array.isArray(req.body?.changedSets)
    ? req.body.changedSets
    : [];
  const ops = [];
  for (const cs of changedSets) {
    const b = cs?.data || {};
    if (!b.id) continue;
    if (cs.operation === "delete") {
      ops.push({ deleteOne: { filter: { _id: b.id } } });
      continue;
    }
    const doc = {
      _id: b.id,
      platform: b.platform,
      channel: b.channel || "production",
      targetAppVersion: b.targetAppVersion ?? null,
      fingerprintHash: b.fingerprintHash ?? null,
      enabled: !!b.enabled,
      shouldForceUpdate: !!b.shouldForceUpdate,
      fileHash: b.fileHash || "",
      gitCommitHash: b.gitCommitHash ?? null,
      message: b.message ?? null,
      storageUri: b.storageUri || "",
      metadata: b.metadata ?? {},
    };
    ops.push({
      replaceOne: { filter: { _id: b.id }, replacement: doc, upsert: true },
    });
  }
  if (ops.length) await HotUpdaterBundle.bulkWrite(ops, { ordered: false });
  res.json({ ok: true, applied: ops.length });
});

// POST /_storage/upload?key=...  (body: raw bytes)
export const storageUpload = asyncHandler(async (req, res) => {
  if (!requireDeployKey(req, res)) return;
  const key = req.query.key;
  const filePath = diskPathForKey(key);
  if (!filePath) return res.status(400).json({ error: "Invalid key" });
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: "Empty body" });
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, req.body);
  res.json({ ok: true, storageUri: `vps://${safeRelKey(key)}` });
});

// DELETE /_storage  { storageUri }
export const storageDelete = asyncHandler(async (req, res) => {
  if (!requireDeployKey(req, res)) return;
  const filePath = diskPathForKey(
    keyFromStorageUri(req.body?.storageUri || req.query.storageUri),
  );
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
  res.json({ ok: true });
});
