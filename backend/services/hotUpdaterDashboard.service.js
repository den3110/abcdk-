import fs from "fs";
import path from "path";
import HotUpdaterTelemetryEvent from "../models/hotUpdaterTelemetryModel.js";
import HotUpdaterBundle from "../models/hotUpdaterBundleModel.js";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_CHANNEL = "production";
// Self-host trên VPS (đã BỎ Cloudflare D1/R2 — account cũ bị xoá): metadata bundle ở
// Mongo (hotUpdaterBundleModel), file .zip ở HU_DIR. Cùng cấu hình với hotUpdaterController
// để dashboard admin (/api/ota/*) thấy đúng các bundle mà `hot-updater deploy` đẩy lên.
const HU_DIR =
  process.env.HOTUPDATER_STORAGE_DIR ||
  path.join(process.cwd(), "storage", "hot-updater");
const HU_PUBLIC_BASE = (
  process.env.HOTUPDATER_PUBLIC_BASE || "https://pickletour.vn/api/hot-updater"
).replace(/\/+$/, "");
const HOT_UPDATER_TELEMETRY_STATUSES = new Set([
  "checking",
  "up_to_date",
  "update_available",
  "dismissed",
  "downloading",
  "downloaded",
  "installing",
  "promoted",
  "recovered",
  "failed",
  "success",
  "skipped",
]);
const HOT_UPDATER_DOWNLOAD_STATUSES = ["downloaded", "success"];
const HOT_UPDATER_SUCCESS_STATUSES = ["promoted", "success"];
const HOT_UPDATER_FAILURE_STATUSES = ["failed", "recovered"];

function coalesce(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizePlatform(platform) {
  const value = String(platform || "").trim().toLowerCase();
  return value === "ios" || value === "android" ? value : "";
}

function parseJsonSafe(raw, fallback = {}) {
  if (!raw) return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildDailyKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/** storageUri "vps://<key>" → đường dẫn file trên đĩa (chống path traversal). */
function diskPathForStorageUri(storageUri) {
  const cleaned = String(storageUri || "")
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
  return path.join(HU_DIR, norm);
}

/** URL công khai để tải bundle (app + nút Download ở admin). */
function fileUrlForStorageUri(storageUri) {
  const key = String(storageUri || "").replace(/^vps:\/\//, "");
  return key ? `${HU_PUBLIC_BASE}/file/${key}` : "";
}

function parseUuidV7Date(bundleId) {
  const cleaned = String(bundleId || "").replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(cleaned)) return null;
  const millisHex = cleaned.slice(0, 12);
  const millis = parseInt(millisHex, 16);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function buildEmptyBundleStats() {
  return {
    downloads: 0,
    successfulUpdates: 0,
    failedUpdates: 0,
    updateAvailable: 0,
    dismissed: 0,
  };
}

class HotUpdaterDashboardService {
  /** Kích thước file bundle trên đĩa VPS (0 nếu không có). */
  getFileSize(storageUri) {
    const filePath = diskPathForStorageUri(storageUri);
    if (!filePath) return 0;
    try {
      return fs.statSync(filePath).size || 0;
    } catch {
      return 0;
    }
  }

  /** Bundle mới nhất ĐANG BẬT của từng channel (để gắn nhãn "latest" ở admin). */
  async getLatestEnabledBundleIdsByChannel(platform) {
    const docs = await HotUpdaterBundle.find({ platform, enabled: true })
      .sort({ _id: -1 })
      .select("_id channel")
      .lean();

    const map = new Map();
    docs.forEach((doc) => {
      const channel = coalesce(doc?.channel, DEFAULT_CHANNEL) || DEFAULT_CHANNEL;
      if (!map.has(channel) && doc?._id) {
        map.set(channel, String(doc._id));
      }
    });
    return map;
  }

  /** Chuẩn hoá doc Mongo → shape mà admin (OTAAdminPage) đang dùng. */
  async normalizeBundle(doc, latestEnabledByChannel = new Map(), options = {}) {
    const includeHead = options.includeHead !== false;
    const metadata = parseJsonSafe(doc?.metadata, {});
    const id = String(doc?._id || "");
    const createdAt = doc?.createdAt || parseUuidV7Date(id) || null;
    const channel = coalesce(doc?.channel, DEFAULT_CHANNEL) || DEFAULT_CHANNEL;
    const storageUri = coalesce(doc?.storageUri);
    const size = includeHead
      ? this.getFileSize(storageUri) ||
        Number(metadata?.size ?? metadata?.fileSize ?? 0) ||
        0
      : Number(metadata?.size ?? metadata?.fileSize ?? 0) || 0;

    return {
      _id: id,
      bundleId: id,
      version: coalesce(doc?.targetAppVersion, metadata?.app_version, id),
      targetAppVersion: coalesce(doc?.targetAppVersion, metadata?.app_version, "-"),
      platform: normalizePlatform(doc?.platform),
      channel,
      enabled: Boolean(doc?.enabled),
      isLatest: latestEnabledByChannel.get(channel) === id,
      mandatory: Boolean(doc?.shouldForceUpdate),
      shouldForceUpdate: Boolean(doc?.shouldForceUpdate),
      description: coalesce(doc?.message),
      message: coalesce(doc?.message),
      gitCommitHash: coalesce(doc?.gitCommitHash),
      fileHash: coalesce(doc?.fileHash),
      fingerprintHash: coalesce(doc?.fingerprintHash),
      storageUri,
      downloadUrl: fileUrlForStorageUri(storageUri),
      size,
      createdAt: createdAt ? new Date(createdAt).toISOString() : null,
      metadata,
      stats: buildEmptyBundleStats(),
    };
  }

  async recordTelemetryEvent(payload = {}) {
    const platform = normalizePlatform(payload.platform);
    const status = String(payload.status || "")
      .trim()
      .toLowerCase();

    if (!platform) {
      throw new Error("Telemetry platform must be ios or android.");
    }

    if (!HOT_UPDATER_TELEMETRY_STATUSES.has(status)) {
      throw new Error("Telemetry status is invalid.");
    }

    const eventId = coalesce(payload.eventId);
    if (eventId) {
      const existing = await HotUpdaterTelemetryEvent.findOne({ eventId }).lean();
      if (existing) return existing;
    }

    const event = await HotUpdaterTelemetryEvent.create({
      eventId: eventId || undefined,
      platform,
      bundleId: coalesce(payload.bundleId) || undefined,
      currentBundleId: coalesce(payload.currentBundleId) || undefined,
      appVersion: coalesce(payload.appVersion) || undefined,
      channel: coalesce(payload.channel, DEFAULT_CHANNEL) || DEFAULT_CHANNEL,
      status,
      message: coalesce(payload.message),
      errorMessage: coalesce(payload.errorMessage),
      errorCode: coalesce(payload.errorCode),
      duration:
        payload.duration == null || payload.duration === ""
          ? undefined
          : toPositiveNumber(payload.duration),
      deviceInfo: {
        deviceId: coalesce(payload.deviceInfo?.deviceId) || undefined,
        model:
          coalesce(payload.deviceInfo?.model, payload.deviceInfo?.deviceName) || undefined,
        osVersion: coalesce(payload.deviceInfo?.osVersion) || undefined,
        brand: coalesce(payload.deviceInfo?.brand) || undefined,
      },
      ip: coalesce(payload.ip) || undefined,
      userAgent: coalesce(payload.userAgent) || undefined,
    });

    return event.toObject();
  }

  async getBundleStats(platform, bundleIds = []) {
    const normalizedPlatform = normalizePlatform(platform);
    const uniqueBundleIds = Array.from(
      new Set(bundleIds.map((bundleId) => coalesce(bundleId)).filter(Boolean))
    );

    const statsMap = new Map();
    uniqueBundleIds.forEach((bundleId) => {
      statsMap.set(bundleId, buildEmptyBundleStats());
    });

    if (!normalizedPlatform || uniqueBundleIds.length === 0) {
      return statsMap;
    }

    const rows = await HotUpdaterTelemetryEvent.aggregate([
      {
        $match: {
          platform: normalizedPlatform,
          bundleId: { $in: uniqueBundleIds },
        },
      },
      {
        $group: {
          _id: "$bundleId",
          downloads: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_DOWNLOAD_STATUSES] }, 1, 0],
            },
          },
          successfulUpdates: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_SUCCESS_STATUSES] }, 1, 0],
            },
          },
          failedUpdates: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_FAILURE_STATUSES] }, 1, 0],
            },
          },
          updateAvailable: {
            $sum: {
              $cond: [{ $eq: ["$status", "update_available"] }, 1, 0],
            },
          },
          dismissed: {
            $sum: {
              $cond: [{ $eq: ["$status", "dismissed"] }, 1, 0],
            },
          },
        },
      },
    ]);

    rows.forEach((row) => {
      const bundleId = coalesce(row?._id);
      if (!bundleId) return;
      statsMap.set(bundleId, {
        downloads: toPositiveNumber(row?.downloads),
        successfulUpdates: toPositiveNumber(row?.successfulUpdates),
        failedUpdates: toPositiveNumber(row?.failedUpdates),
        updateAvailable: toPositiveNumber(row?.updateAvailable),
        dismissed: toPositiveNumber(row?.dismissed),
      });
    });

    return statsMap;
  }

  async getBundleById(bundleId) {
    const doc = await HotUpdaterBundle.findById(String(bundleId || "")).lean();
    if (!doc) return null;

    const latestEnabledByChannel = await this.getLatestEnabledBundleIdsByChannel(
      normalizePlatform(doc?.platform)
    );
    return this.normalizeBundle(doc, latestEnabledByChannel);
  }

  async listVersions(platform, limit = 50) {
    const normalizedPlatform = normalizePlatform(platform);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const latestEnabledByChannel =
      await this.getLatestEnabledBundleIdsByChannel(normalizedPlatform);
    const docs = await HotUpdaterBundle.find({ platform: normalizedPlatform })
      .sort({ _id: -1 })
      .limit(safeLimit)
      .lean();

    const bundles = await Promise.all(
      docs.map((doc) => this.normalizeBundle(doc, latestEnabledByChannel))
    );

    const statsMap = await this.getBundleStats(
      normalizedPlatform,
      bundles.map((bundle) => bundle.bundleId)
    );

    return bundles.map((bundle) => ({
      ...bundle,
      stats: statsMap.get(bundle.bundleId) || buildEmptyBundleStats(),
    }));
  }

  async getLatest(platform) {
    const versions = await this.listVersions(platform, 1);
    return versions[0] || null;
  }

  async getAnalytics(platform, days = 7) {
    const normalizedPlatform = normalizePlatform(platform);
    const safeDays = Math.min(90, Math.max(1, Number(days) || 7));
    const latestEnabledByChannel =
      await this.getLatestEnabledBundleIdsByChannel(normalizedPlatform);
    const docs = await HotUpdaterBundle.find({ platform: normalizedPlatform })
      .sort({ _id: -1 })
      .lean();

    const bundles = await Promise.all(
      docs.map((doc) =>
        this.normalizeBundle(doc, latestEnabledByChannel, { includeHead: false })
      )
    );

    const now = Date.now();
    const windowStart = new Date(now - safeDays * 24 * 60 * 60 * 1000);
    const dailyMap = new Map();
    const bundleMap = new Map();

    bundles.forEach((bundle) => {
      bundleMap.set(bundle.bundleId, bundle);
      const createdAt = bundle.createdAt ? new Date(bundle.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return;
      if (createdAt < windowStart) return;

      const key = buildDailyKey(createdAt);
      if (!key) return;

      const current = dailyMap.get(key) || {
        date: key,
        deployments: 0,
        enabled: 0,
        disabled: 0,
        force: 0,
        downloads: 0,
        success: 0,
        failed: 0,
      };

      current.deployments += 1;
      if (bundle.enabled) current.enabled += 1;
      else current.disabled += 1;
      if (bundle.shouldForceUpdate) current.force += 1;

      dailyMap.set(key, current);
    });

    const uniqueChannels = new Set(
      bundles.map((bundle) => bundle.channel).filter(Boolean)
    );
    const recentDisabledBundles = bundles
      .filter((bundle) => !bundle.enabled)
      .slice(0, 20);

    const telemetryDailyRows = await HotUpdaterTelemetryEvent.aggregate([
      {
        $match: {
          platform: normalizedPlatform,
          createdAt: { $gte: windowStart },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
            },
          },
          downloads: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_DOWNLOAD_STATUSES] }, 1, 0],
            },
          },
          success: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_SUCCESS_STATUSES] }, 1, 0],
            },
          },
          failed: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_FAILURE_STATUSES] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    telemetryDailyRows.forEach((row) => {
      const key = coalesce(row?._id);
      if (!key) return;
      const current = dailyMap.get(key) || {
        date: key,
        deployments: 0,
        enabled: 0,
        disabled: 0,
        force: 0,
        downloads: 0,
        success: 0,
        failed: 0,
      };

      current.downloads += toPositiveNumber(row?.downloads);
      current.success += toPositiveNumber(row?.success);
      current.failed += toPositiveNumber(row?.failed);
      dailyMap.set(key, current);
    });

    const telemetryTotals = await HotUpdaterTelemetryEvent.aggregate([
      {
        $match: {
          platform: normalizedPlatform,
          createdAt: { $gte: windowStart },
        },
      },
      {
        $group: {
          _id: null,
          downloads: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_DOWNLOAD_STATUSES] }, 1, 0],
            },
          },
          success: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_SUCCESS_STATUSES] }, 1, 0],
            },
          },
          failed: {
            $sum: {
              $cond: [{ $in: ["$status", HOT_UPDATER_FAILURE_STATUSES] }, 1, 0],
            },
          },
          updateAvailable: {
            $sum: {
              $cond: [{ $eq: ["$status", "update_available"] }, 1, 0],
            },
          },
          dismissed: {
            $sum: {
              $cond: [{ $eq: ["$status", "dismissed"] }, 1, 0],
            },
          },
        },
      },
    ]);

    const totalTelemetry = telemetryTotals[0] || {};
    const failedTelemetryEvents = await HotUpdaterTelemetryEvent.find({
      platform: normalizedPlatform,
      status: { $in: HOT_UPDATER_FAILURE_STATUSES },
      createdAt: { $gte: windowStart },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const failedUpdates = failedTelemetryEvents.map((event) => {
      const bundleId = coalesce(event?.bundleId);
      const bundle = bundleMap.get(bundleId);
      return {
        _id: String(event?._id || ""),
        eventId: coalesce(event?.eventId),
        bundleId,
        targetAppVersion: bundle?.targetAppVersion || coalesce(event?.appVersion, "-"),
        channel: bundle?.channel || coalesce(event?.channel, DEFAULT_CHANNEL) || DEFAULT_CHANNEL,
        message: coalesce(event?.message, bundle?.message),
        errorMessage: coalesce(event?.errorMessage),
        errorCode: coalesce(event?.errorCode),
        status: coalesce(event?.status),
        deviceInfo: {
          deviceId: coalesce(event?.deviceInfo?.deviceId),
          model: coalesce(event?.deviceInfo?.model),
          brand: coalesce(event?.deviceInfo?.brand),
          osVersion: coalesce(event?.deviceInfo?.osVersion),
        },
        createdAt: event?.createdAt ? new Date(event.createdAt).toISOString() : null,
      };
    });

    return {
      source: "hot-updater",
      totals: {
        deployments: bundles.length,
        enabled: bundles.filter((bundle) => bundle.enabled).length,
        disabled: bundles.filter((bundle) => !bundle.enabled).length,
        force: bundles.filter((bundle) => bundle.shouldForceUpdate).length,
        channels: uniqueChannels.size,
        downloads: toPositiveNumber(totalTelemetry?.downloads),
        success: toPositiveNumber(totalTelemetry?.success),
        failed: toPositiveNumber(totalTelemetry?.failed),
        updateAvailable: toPositiveNumber(totalTelemetry?.updateAvailable),
        dismissed: toPositiveNumber(totalTelemetry?.dismissed),
      },
      dailyStats: Array.from(dailyMap.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      ),
      recentDisabledBundles,
      failedUpdates,
    };
  }

  isCompatibleTargetVersion(targetVersion, appVersion) {
    const target = String(targetVersion || "").trim();
    const current = String(appVersion || "").trim();
    if (!target || !current) return false;
    if (target === "*" || target.toLowerCase() === "latest") return true;

    const targetParts = target.split(".");
    const currentParts = current.split(".");
    const length = Math.max(targetParts.length, currentParts.length);

    for (let i = 0; i < length; i += 1) {
      const expected = String(targetParts[i] ?? "").trim().toLowerCase();
      const actual = String(currentParts[i] ?? "0").trim().toLowerCase();
      if (!expected || expected === "*" || expected === "x") continue;
      if (expected !== actual) return false;
    }
    return true;
  }

  async checkUpdate({
    platform,
    currentBundleVersion,
    appVersion,
    channel = DEFAULT_CHANNEL,
  }) {
    const normalizedPlatform = normalizePlatform(platform);
    const bundleId = coalesce(currentBundleVersion, NIL_UUID) || NIL_UUID;
    const safeChannel = coalesce(channel, DEFAULT_CHANNEL) || DEFAULT_CHANNEL;

    // Cùng logic chọn bundle với /api/hot-updater/check-update (appVersion strategy):
    // bundle ĐANG BẬT, đúng channel, targetAppVersion khớp app (hỗ trợ 1.1.x), và
    // id (uuidv7, tăng theo thời gian) mới hơn bundle máy đang chạy.
    const docs = await HotUpdaterBundle.find({
      platform: normalizedPlatform,
      enabled: true,
      channel: safeChannel,
    })
      .sort({ _id: -1 })
      .lean();

    const candidates = docs.filter((doc) =>
      this.isCompatibleTargetVersion(doc?.targetAppVersion, appVersion)
    );
    const selected = candidates.find(
      (doc) => String(doc?._id || "").localeCompare(bundleId) > 0
    );

    if (!selected) {
      return { updateAvailable: false };
    }

    const bundle = await this.normalizeBundle(selected, new Map(), {
      includeHead: true,
    });
    return {
      updateAvailable: true,
      bundleId: bundle.bundleId,
      version: bundle.targetAppVersion || bundle.bundleId,
      targetAppVersion: bundle.targetAppVersion,
      size: bundle.size,
      mandatory: bundle.shouldForceUpdate,
      description: bundle.description,
      hash: bundle.fileHash,
      downloadUrl: bundle.downloadUrl,
      status: "UPDATE",
      channel: bundle.channel,
    };
  }

  async deactivateBundle(platform, bundleId) {
    const normalizedPlatform = normalizePlatform(platform);
    await HotUpdaterBundle.updateOne(
      { _id: String(bundleId || ""), platform: normalizedPlatform },
      { $set: { enabled: false } }
    );

    return this.getBundleById(bundleId);
  }
}

export default new HotUpdaterDashboardService();
