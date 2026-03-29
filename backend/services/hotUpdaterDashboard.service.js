import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_CHANNEL = "production";
const DEFAULT_CHECK_BASE_URL =
  process.env.HOT_UPDATER_CHECK_BASE_URL ||
  "https://hot-updater.datistpham.workers.dev/api/check-update";

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

class HotUpdaterDashboardService {
  constructor() {
    this.cachedConfig = null;
    this.r2 = null;
  }

  loadConfig() {
    if (this.cachedConfig) return this.cachedConfig;

    const fallbackEnv = {};
    const fallbackFiles = [
      path.resolve(process.cwd(), "pickletour-app-mobile/.env.hotupdater"),
      path.resolve(process.cwd(), "pickletour-app-mobile/.env"),
    ];

    for (const filePath of fallbackFiles) {
      if (!fs.existsSync(filePath)) continue;
      const parsed = dotenv.parse(fs.readFileSync(filePath, "utf8"));
      Object.assign(fallbackEnv, parsed);
    }

    this.cachedConfig = {
      accountId: coalesce(
        process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID,
        fallbackEnv.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID
      ),
      databaseId: coalesce(
        process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID,
        fallbackEnv.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID
      ),
      apiToken: coalesce(
        process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN,
        fallbackEnv.HOT_UPDATER_CLOUDFLARE_API_TOKEN
      ),
      bucketName: coalesce(
        process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME,
        fallbackEnv.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME,
        process.env.R2_BUCKET_NAME
      ),
      checkBaseUrl: coalesce(
        process.env.HOT_UPDATER_CHECK_BASE_URL,
        fallbackEnv.HOT_UPDATER_CHECK_BASE_URL,
        DEFAULT_CHECK_BASE_URL
      ),
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
        "Hot-updater D1 config is missing. Set HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID, HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID, HOT_UPDATER_CLOUDFLARE_API_TOKEN or provide them in pickletour-app-mobile/.env.hotupdater."
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
    };
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

    return Promise.all(
      rows.map((row) => this.normalizeBundle(row, latestEnabledByChannel))
    );
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
    const windowStart = now - safeDays * 24 * 60 * 60 * 1000;
    const dailyMap = new Map();

    bundles.forEach((bundle) => {
      const createdAt = bundle.createdAt ? new Date(bundle.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return;
      if (createdAt.getTime() < windowStart) return;

      const key = buildDailyKey(createdAt);
      if (!key) return;

      const current = dailyMap.get(key) || {
        date: key,
        enabled: 0,
        disabled: 0,
        force: 0,
      };

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

    return {
      source: "hot-updater",
      totals: {
        deployments: bundles.length,
        enabled: bundles.filter((bundle) => bundle.enabled).length,
        disabled: bundles.filter((bundle) => !bundle.enabled).length,
        force: bundles.filter((bundle) => bundle.shouldForceUpdate).length,
        channels: uniqueChannels.size,
      },
      dailyStats: Array.from(dailyMap.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      ),
      recentDisabledBundles,
      failedUpdates: recentDisabledBundles,
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
