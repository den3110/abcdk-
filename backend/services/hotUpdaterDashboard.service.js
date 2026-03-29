import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import HotUpdaterTelemetryEvent from "../models/hotUpdaterTelemetryModel.js";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_CHANNEL = "production";
const DEFAULT_CHECK_BASE_URL =
  "https://hot-updater.datistpham.workers.dev/api/check-update";
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

function parseStorageUri(storageUri) {
  if (!storageUri) return null;
  try {
    const url = new URL(storageUri);
    return {
      protocol: String(url.protocol || "").replace(/:$/, ""),
      bucket: String(url.host || "").trim(),
      key: String(url.pathname || "").replace(/^\/+/, ""),
    };
  } catch {
    return null;
  }
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
  constructor() {
    this.cachedConfig = null;
    this.r2 = null;
  }

  loadConfig() {
    if (this.cachedConfig) return this.cachedConfig;

    this.cachedConfig = {
      accountId: coalesce(process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID),
      databaseId: coalesce(process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID),
      apiToken: coalesce(process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN),
      bucketName: coalesce(
        process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME,
        process.env.R2_BUCKET_NAME
      ),
      checkBaseUrl: coalesce(process.env.HOT_UPDATER_CHECK_BASE_URL, DEFAULT_CHECK_BASE_URL),
      r2Endpoint: coalesce(process.env.R2_ENDPOINT),
      r2AccessKeyId: coalesce(process.env.R2_ACCESS_KEY_ID),
      r2SecretAccessKey: coalesce(process.env.R2_SECRET_ACCESS_KEY),
    };

    return this.cachedConfig;
  }

  ensureD1Config() {
    const config = this.loadConfig();
    if (!config.accountId || !config.databaseId || !config.apiToken) {
      throw new Error(
        "Hot-updater D1 config is missing in process.env."
      );
    }
    return config;
  }

  getR2Client() {
    if (this.r2) return this.r2;
    const config = this.loadConfig();
    if (
      !config.r2Endpoint ||
      !config.r2AccessKeyId ||
      !config.r2SecretAccessKey
    ) {
      return null;
    }

    this.r2 = new S3Client({
      region: "auto",
      endpoint: config.r2Endpoint,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });

    return this.r2;
  }

  async queryD1(sql, params = []) {
    const config = this.ensureD1Config();
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql,
          params: params.map((value) =>
            value == null ? null : String(value)
          ),
        }),
      }
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const message =
        payload?.errors?.[0]?.message ||
        payload?.result?.[0]?.errors?.[0]?.message ||
        `Cloudflare D1 query failed with status ${response.status}`;
      throw new Error(message);
    }

    const pages = Array.isArray(payload?.result) ? payload.result : [];
    return pages.flatMap((page) =>
      Array.isArray(page?.results) ? page.results : []
    );
  }

  async getObjectHead(storageUri) {
    const parsed = parseStorageUri(storageUri);
    const r2 = this.getR2Client();
    if (!parsed?.bucket || !parsed?.key || !r2) return null;

    try {
      return await r2.send(
        new HeadObjectCommand({
          Bucket: parsed.bucket,
          Key: parsed.key,
        })
      );
    } catch {
      return null;
    }
  }

  async getLatestEnabledBundleIdsByChannel(platform) {
    const rows = await this.queryD1(
      `
        SELECT id, channel
        FROM bundles
        WHERE platform = ? AND enabled = 1
        ORDER BY id DESC
      `,
      [platform]
    );

    const map = new Map();
    rows.forEach((row) => {
      const channel = coalesce(row?.channel, DEFAULT_CHANNEL) || DEFAULT_CHANNEL;
      if (!map.has(channel) && row?.id) {
        map.set(channel, String(row.id));
      }
    });
    return map;
  }

  async normalizeBundle(row, latestEnabledByChannel = new Map(), options = {}) {
    const includeHead = options.includeHead !== false;
    const metadata = parseJsonSafe(row?.metadata, {});
    const createdAtFromId = parseUuidV7Date(row?.id);
    const head = includeHead ? await this.getObjectHead(row?.storage_uri) : null;
    const createdAt = head?.LastModified || createdAtFromId || null;
    const channel = coalesce(row?.channel, DEFAULT_CHANNEL) || DEFAULT_CHANNEL;

    return {
      _id: String(row?.id || ""),
      bundleId: String(row?.id || ""),
      version: coalesce(row?.target_app_version, metadata?.app_version, row?.id),
      targetAppVersion: coalesce(
        row?.target_app_version,
        metadata?.app_version,
        "-"
      ),
      platform: normalizePlatform(row?.platform),
      channel,
      enabled: Boolean(Number(row?.enabled ?? 0)),
      isLatest:
        latestEnabledByChannel.get(channel) === String(row?.id || ""),
      mandatory: Boolean(Number(row?.should_force_update ?? 0)),
      shouldForceUpdate: Boolean(Number(row?.should_force_update ?? 0)),
      description: coalesce(row?.message),
      message: coalesce(row?.message),
      gitCommitHash: coalesce(row?.git_commit_hash),
      fileHash: coalesce(row?.file_hash),
      fingerprintHash: coalesce(row?.fingerprint_hash),
      storageUri: coalesce(row?.storage_uri),
      size:
        Number(head?.ContentLength ?? metadata?.size ?? metadata?.fileSize ?? 0) || 0,
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
    const rows = await this.queryD1(
      `
        SELECT *
        FROM bundles
        WHERE id = ?
        LIMIT 1
      `,
      [bundleId]
    );
    if (!rows[0]) return null;

    const latestEnabledByChannel = await this.getLatestEnabledBundleIdsByChannel(
      normalizePlatform(rows[0]?.platform)
    );
    return this.normalizeBundle(rows[0], latestEnabledByChannel);
  }

  async listVersions(platform, limit = 50) {
    const normalizedPlatform = normalizePlatform(platform);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const latestEnabledByChannel =
      await this.getLatestEnabledBundleIdsByChannel(normalizedPlatform);
    const rows = await this.queryD1(
      `
        SELECT *
        FROM bundles
        WHERE platform = ?
        ORDER BY id DESC
        LIMIT ${safeLimit}
      `,
      [normalizedPlatform]
    );

    const bundles = await Promise.all(
      rows.map((row) => this.normalizeBundle(row, latestEnabledByChannel))
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
    const rows = await this.queryD1(
      `
        SELECT *
        FROM bundles
        WHERE platform = ?
        ORDER BY id DESC
      `,
      [normalizedPlatform]
    );

    const bundles = await Promise.all(
      rows.map((row) =>
        this.normalizeBundle(row, latestEnabledByChannel, { includeHead: false })
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
    const config = this.loadConfig();

    try {
      const url = new URL(
        `${config.checkBaseUrl}/app-version/${normalizedPlatform}/${appVersion}/${channel}/${NIL_UUID}/${bundleId}`
      );
      const response = await fetch(url.toString());
      const payload = await response.json().catch(() => null);

      if (response.ok && payload?.id) {
        const bundle = await this.getBundleById(payload.id);
        return {
          updateAvailable: true,
          bundleId: payload.id,
          version: bundle?.targetAppVersion || payload.id,
          targetAppVersion: bundle?.targetAppVersion || null,
          size: bundle?.size || 0,
          mandatory: Boolean(payload.shouldForceUpdate),
          description: coalesce(payload?.message, bundle?.description),
          hash: coalesce(payload?.fileHash, bundle?.fileHash),
          downloadUrl: coalesce(payload?.fileUrl, bundle?.storageUri),
          status: coalesce(payload?.status),
          channel: bundle?.channel || channel,
        };
      }
    } catch {
      // Fall through to local D1 selection logic.
    }

    const rows = await this.queryD1(
      `
        SELECT *
        FROM bundles
        WHERE platform = ? AND enabled = 1 AND channel = ?
        ORDER BY id DESC
      `,
      [normalizedPlatform, channel]
    );

    const candidates = rows.filter((row) =>
      this.isCompatibleTargetVersion(row?.target_app_version, appVersion)
    );
    const selected = candidates.find(
      (row) => String(row?.id || "").localeCompare(bundleId) > 0
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
      downloadUrl: bundle.storageUri,
      status: "UPDATE",
      channel: bundle.channel,
    };
  }

  async deactivateBundle(platform, bundleId) {
    const normalizedPlatform = normalizePlatform(platform);
    await this.queryD1(
      `
        UPDATE bundles
        SET enabled = 0
        WHERE id = ? AND platform = ?
      `,
      [bundleId, normalizedPlatform]
    );

    return this.getBundleById(bundleId);
  }
}

export default new HotUpdaterDashboardService();
