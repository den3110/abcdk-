/**
 * OTA Update Service for PickleTour
 * Cloudflare R2 Storage + MongoDB Integration
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { OTABundle, OTAUpdateLog, OTARollback } from "../models/otaBundleModel.js";

class OTAService {
  constructor() {
    // R2 uses S3-compatible API
    this.r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    this.bucket = process.env.R2_BUCKET_NAME;
  }

  /**
   * Upload new bundle to R2 + save to MongoDB
   */
  async uploadBundle({ platform, version, bundleBuffer, metadata = {}, uploadedBy = null }) {
    const bundleHash = crypto
      .createHash("sha256")
      .update(bundleBuffer)
      .digest("hex");
    const r2Key = `bundles/${platform}/${version}/bundle.js`;

    // Upload to R2
    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: r2Key,
        Body: bundleBuffer,
        ContentType: "application/javascript",
        Metadata: {
          version,
          platform,
          hash: bundleHash,
          uploadedAt: new Date().toISOString(),
        },
      })
    );

    // Save metadata to R2 (for backup/redundancy)
    const metadataKey = `metadata/${platform}/${version}.json`;
    const bundleMetadata = {
      version,
      platform,
      hash: bundleHash,
      size: bundleBuffer.length,
      uploadedAt: new Date().toISOString(),
      mandatory: metadata.mandatory || false,
      description: metadata.description || "",
      minAppVersion: metadata.minAppVersion || "1.0.0",
    };

    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: metadataKey,
        Body: JSON.stringify(bundleMetadata),
        ContentType: "application/json",
      })
    );

    // Save to MongoDB
    const bundle = await OTABundle.findOneAndUpdate(
      { platform, version },
      {
        $set: {
          hash: bundleHash,
          size: bundleBuffer.length,
          r2Key,
          mandatory: metadata.mandatory || false,
          description: metadata.description || "",
          minAppVersion: metadata.minAppVersion || "1.0.0",
          isActive: true,
          uploadedBy,
        },
      },
      { upsert: true, new: true }
    );

    // Set as latest
    await this.setAsLatest(platform, version);

    return {
      ...bundleMetadata,
      _id: bundle._id,
    };
  }

  /**
   * Set version as latest (both R2 pointer and MongoDB)
   */
  async setAsLatest(platform, version) {
    // Update R2 pointer
    const key = `latest/${platform}.json`;
    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify({ version, updatedAt: new Date().toISOString() }),
        ContentType: "application/json",
      })
    );

    // Update MongoDB
    await OTABundle.setAsLatest(platform, version);
  }

  /**
   * Get latest version info for platform
   */
  async getLatestVersion(platform) {
    // Try MongoDB first (faster)
    const mongoLatest = await OTABundle.getLatest(platform);
    if (mongoLatest) {
      return {
        version: mongoLatest.version,
        updatedAt: mongoLatest.updatedAt,
      };
    }

    // Fallback to R2
    try {
      const key = `latest/${platform}.json`;
      const response = await this.r2.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const body = await response.Body.transformToString();
      return JSON.parse(body);
    } catch (error) {
      if (error.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get bundle metadata
   */
  async getBundleMetadata(platform, version) {
    // Try MongoDB first
    const bundle = await OTABundle.findOne({ platform, version, isActive: true }).lean();
    if (bundle) {
      return {
        version: bundle.version,
        platform: bundle.platform,
        hash: bundle.hash,
        size: bundle.size,
        mandatory: bundle.mandatory,
        description: bundle.description,
        minAppVersion: bundle.minAppVersion,
        uploadedAt: bundle.createdAt,
        stats: bundle.stats,
      };
    }

    // Fallback to R2
    try {
      const key = `metadata/${platform}/${version}.json`;
      const response = await this.r2.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const body = await response.Body.transformToString();
      return JSON.parse(body);
    } catch (error) {
      if (error.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check for updates + log the check
   */
  async checkUpdate({ platform, currentBundleVersion, appVersion, deviceInfo, ip, userAgent }) {
    const latest = await this.getLatestVersion(platform);

    if (!latest) {
      return { updateAvailable: false };
    }

    const latestMetadata = await this.getBundleMetadata(platform, latest.version);

    if (!latestMetadata) {
      return { updateAvailable: false };
    }

    // Compare versions
    const hasUpdate = this.compareVersions(latest.version, currentBundleVersion) > 0;
    const isCompatible = this.compareVersions(appVersion, latestMetadata.minAppVersion) >= 0;

    if (hasUpdate && isCompatible) {
      // Log the update check
      const log = await OTAUpdateLog.logCheck({
        platform,
        fromVersion: currentBundleVersion,
        toVersion: latest.version,
        appVersion,
        deviceInfo,
        ip,
        userAgent,
      });

      // Generate signed download URL
      const downloadUrl = await this.getSignedDownloadUrl(platform, latest.version);

      return {
        updateAvailable: true,
        version: latest.version,
        downloadUrl,
        hash: latestMetadata.hash,
        size: latestMetadata.size,
        mandatory: latestMetadata.mandatory,
        description: latestMetadata.description,
        logId: log._id, // Client can use this to report status
      };
    }

    return { updateAvailable: false };
  }

  /**
   * Report update status (called by client after update attempt)
   */
  async reportUpdateStatus({ logId, status, errorMessage, errorCode, duration }) {
    if (!logId) return null;

    const log = await OTAUpdateLog.updateStatus(logId, status, {
      errorMessage,
      errorCode,
      duration,
    });

    // Update bundle stats
    if (log && log.toVersion) {
      await OTABundle.updateStats(
        log.platform,
        log.toVersion,
        status === "success"
      );
    }

    return log;
  }

  /**
   * Generate signed download URL + track download
   */
  async getSignedDownloadUrl(platform, version, expiresIn = 3600) {
    const key = `bundles/${platform}/${version}/bundle.js`;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    // Increment download count
    await OTABundle.incrementDownload(platform, version);

    return getSignedUrl(this.r2, command, { expiresIn });
  }

  /**
   * List all versions for a platform (from MongoDB)
   */
  async listVersions(platform, limit = 50) {
    return OTABundle.getVersionHistory(platform, limit);
  }

  /**
   * Rollback to specific version + log it
   */
  async rollback(platform, version, { reason, performedBy } = {}) {
    const bundle = await OTABundle.findOne({ platform, version, isActive: true });

    if (!bundle) {
      throw new Error(`Version ${version} not found for ${platform}`);
    }

    // Get current latest for logging
    const currentLatest = await OTABundle.getLatest(platform);

    // Set as latest
    await this.setAsLatest(platform, version);

    // Log rollback
    await OTARollback.create({
      platform,
      fromVersion: currentLatest?.version || "unknown",
      toVersion: version,
      reason,
      performedBy,
    });

    return {
      version: bundle.version,
      hash: bundle.hash,
      rolledBackFrom: currentLatest?.version,
    };
  }

  /**
   * Deactivate a version (soft delete)
   */
  async deactivateVersion(platform, version) {
    const bundle = await OTABundle.findOneAndUpdate(
      { platform, version },
      { $set: { isActive: false, isLatest: false } },
      { new: true }
    );

    if (!bundle) {
      throw new Error(`Version ${version} not found for ${platform}`);
    }

    return bundle;
  }

  /**
   * Get analytics/stats for dashboard
   */
  async getAnalytics(platform, days = 7) {
    const [updateStats, bundles, failedUpdates] = await Promise.all([
      OTAUpdateLog.getStats(platform, days),
      OTABundle.find({ platform, isActive: true })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      OTAUpdateLog.getFailedUpdates(platform, 20),
    ]);

    // Calculate totals
    const totals = updateStats.reduce(
      (acc, item) => {
        acc[item._id.status] = (acc[item._id.status] || 0) + item.count;
        return acc;
      },
      {}
    );

    return {
      totals,
      dailyStats: updateStats,
      recentBundles: bundles,
      failedUpdates,
    };
  }

  /**
   * Compare semantic versions
   */
  compareVersions(a, b) {
    const partsA = String(a).split(".").map(Number);
    const partsB = String(b).split(".").map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;

      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }

    return 0;
  }
}

export default new OTAService();