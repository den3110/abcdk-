/**
 * OTA Update Service for PickleTour
 * Cloudflare R2 Storage Integration
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

class OTAService {
  constructor() {
    // R2 uses S3-compatible API
    this.r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT, // https://<account_id>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    this.bucket = process.env.R2_BUCKET_NAME;
  }

  /**
   * Upload new bundle to R2
   */
  async uploadBundle({ platform, version, bundleBuffer, metadata = {} }) {
    const bundleHash = crypto
      .createHash("sha256")
      .update(bundleBuffer)
      .digest("hex");
    const key = `bundles/${platform}/${version}/bundle.js`;

    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bundleBuffer,
        ContentType: "application/javascript",
        Metadata: {
          version,
          platform,
          hash: bundleHash,
          uploadedAt: new Date().toISOString(),
          ...metadata,
        },
      })
    );

    // Save metadata separately for quick lookup
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

    // Update latest pointer
    await this.updateLatestPointer(platform, version);

    return bundleMetadata;
  }

  /**
   * Update latest version pointer
   */
  async updateLatestPointer(platform, version) {
    const key = `latest/${platform}.json`;

    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify({ version, updatedAt: new Date().toISOString() }),
        ContentType: "application/json",
      })
    );
  }

  /**
   * Get latest version info for platform
   */
  async getLatestVersion(platform) {
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
   * Check for updates
   */
  async checkUpdate({ platform, currentBundleVersion, appVersion }) {
    const latest = await this.getLatestVersion(platform);

    if (!latest) {
      return { updateAvailable: false };
    }

    const latestMetadata = await this.getBundleMetadata(
      platform,
      latest.version
    );

    if (!latestMetadata) {
      return { updateAvailable: false };
    }

    // Compare versions
    const hasUpdate =
      this.compareVersions(latest.version, currentBundleVersion) > 0;
    const isCompatible =
      this.compareVersions(appVersion, latestMetadata.minAppVersion) >= 0;

    if (hasUpdate && isCompatible) {
      // Generate signed download URL (valid for 1 hour)
      const downloadUrl = await this.getSignedDownloadUrl(
        platform,
        latest.version
      );

      return {
        updateAvailable: true,
        version: latest.version,
        downloadUrl,
        hash: latestMetadata.hash,
        size: latestMetadata.size,
        mandatory: latestMetadata.mandatory,
        description: latestMetadata.description,
      };
    }

    return { updateAvailable: false };
  }

  /**
   * Generate signed download URL
   */
  async getSignedDownloadUrl(platform, version, expiresIn = 3600) {
    const key = `bundles/${platform}/${version}/bundle.js`;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.r2, command, { expiresIn });
  }

  /**
   * List all versions for a platform
   */
  async listVersions(platform) {
    const prefix = `metadata/${platform}/`;

    const response = await this.r2.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      })
    );

    const versions = [];

    for (const obj of response.Contents || []) {
      const version = obj.Key.replace(prefix, "").replace(".json", "");
      const metadata = await this.getBundleMetadata(platform, version);
      if (metadata) {
        versions.push(metadata);
      }
    }

    // Sort by version descending
    versions.sort((a, b) => this.compareVersions(b.version, a.version));

    return versions;
  }

  /**
   * Rollback to specific version
   */
  async rollback(platform, version) {
    const metadata = await this.getBundleMetadata(platform, version);

    if (!metadata) {
      throw new Error(`Version ${version} not found for ${platform}`);
    }

    await this.updateLatestPointer(platform, version);

    return metadata;
  }

  /**
   * Compare semantic versions
   * Returns: 1 if a > b, -1 if a < b, 0 if equal
   */
  compareVersions(a, b) {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);

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
