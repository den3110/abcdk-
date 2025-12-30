/**
 * Expo Updates Service - Self-hosted
 * Implements Expo Updates Protocol
 */
// services/expoUpdates.service.js

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

class ExpoUpdatesService {
  constructor() {
    this.r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    this.bucket = process.env.R2_BUCKET_NAME;
    this.baseUrl = process.env.R2_PUBLIC_URL || process.env.API_URL;
  }

  /**
   * Upload update bundle (from expo export)
   */
  async uploadUpdate({ platform, runtimeVersion, updateId, files, metadata }) {
    const prefix = `expo-updates/${platform}/${runtimeVersion}/${updateId}`;

    // Upload each file
    const uploadedAssets = [];
    for (const file of files) {
      const key = `${prefix}/${file.path}`;

      await this.r2.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.contentType || "application/octet-stream",
        })
      );

      const hash = crypto
        .createHash("sha256")
        .update(file.buffer)
        .digest("base64url");

      uploadedAssets.push({
        path: file.path,
        key,
        hash,
        contentType: file.contentType,
        size: file.buffer.length,
      });
    }

    // Save manifest
    const manifest = {
      id: updateId,
      createdAt: new Date().toISOString(),
      runtimeVersion,
      platform,
      metadata: metadata || {},
      assets: uploadedAssets,
    };

    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${prefix}/manifest.json`,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
      })
    );

    // Update latest pointer
    await this.setLatest(platform, runtimeVersion, updateId);

    return manifest;
  }

  /**
   * Set latest update for platform/runtime
   */
  async setLatest(platform, runtimeVersion, updateId) {
    const key = `expo-updates/${platform}/${runtimeVersion}/latest.json`;

    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify({
          updateId,
          updatedAt: new Date().toISOString(),
        }),
        ContentType: "application/json",
      })
    );
  }

  /**
   * Get latest update ID
   */
  async getLatestUpdateId(platform, runtimeVersion) {
    try {
      const key = `expo-updates/${platform}/${runtimeVersion}/latest.json`;
      const response = await this.r2.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      const body = await response.Body.transformToString();
      const data = JSON.parse(body);
      return data.updateId;
    } catch (error) {
      if (error.name === "NoSuchKey") return null;
      throw error;
    }
  }

  /**
   * Get manifest for specific update
   */
  async getManifest(platform, runtimeVersion, updateId) {
    try {
      const key = `expo-updates/${platform}/${runtimeVersion}/${updateId}/manifest.json`;
      const response = await this.r2.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      const body = await response.Body.transformToString();
      return JSON.parse(body);
    } catch (error) {
      if (error.name === "NoSuchKey") return null;
      throw error;
    }
  }

  /**
   * Generate Expo Updates manifest response
   * Following: https://docs.expo.dev/technical-specs/expo-updates-1/
   */
  async generateManifestResponse({
    platform,
    runtimeVersion,
    currentUpdateId,
  }) {
    const latestUpdateId = await this.getLatestUpdateId(
      platform,
      runtimeVersion
    );

    if (!latestUpdateId) {
      return { noUpdateAvailable: true };
    }

    // Same version, no update
    if (latestUpdateId === currentUpdateId) {
      return { noUpdateAvailable: true };
    }

    const manifest = await this.getManifest(
      platform,
      runtimeVersion,
      latestUpdateId
    );
    if (!manifest) {
      return { noUpdateAvailable: true };
    }

    // Build Expo Updates format manifest
    const launchAsset = manifest.assets.find(
      (a) => a.path.endsWith(".bundle") || a.path.endsWith(".hbc")
    );

    const assets = manifest.assets
      .filter((a) => !a.path.endsWith(".bundle") && !a.path.endsWith(".hbc"))
      .map((a) => ({
        hash: a.hash,
        key: a.path,
        contentType: a.contentType || "application/octet-stream",
        url: `${this.baseUrl}/api/expo-updates/assets/${platform}/${runtimeVersion}/${latestUpdateId}/${a.path}`,
      }));

    return {
      id: latestUpdateId,
      createdAt: manifest.createdAt,
      runtimeVersion,
      launchAsset: launchAsset
        ? {
            hash: launchAsset.hash,
            key: launchAsset.path,
            contentType: "application/javascript",
            url: `${this.baseUrl}/api/expo-updates/assets/${platform}/${runtimeVersion}/${latestUpdateId}/${launchAsset.path}`,
          }
        : undefined,
      assets,
      metadata: manifest.metadata || {},
    };
  }

  /**
   * Get signed URL for asset download
   */
  async getAssetUrl(platform, runtimeVersion, updateId, assetPath) {
    const key = `expo-updates/${platform}/${runtimeVersion}/${updateId}/${assetPath}`;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.r2, command, { expiresIn: 3600 });
  }

  /**
   * Get asset stream for proxying
   */
  async getAssetStream(platform, runtimeVersion, updateId, assetPath) {
    const key = `expo-updates/${platform}/${runtimeVersion}/${updateId}/${assetPath}`;

    const response = await this.r2.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    return {
      stream: response.Body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  /**
   * List all updates for platform/runtime
   */
  async listUpdates(platform, runtimeVersion, limit = 20) {
    const prefix = `expo-updates/${platform}/${runtimeVersion}/`;

    const response = await this.r2.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        Delimiter: "/",
      })
    );

    const updates = [];
    for (const obj of response.CommonPrefixes || []) {
      const updateId = obj.Prefix.replace(prefix, "").replace("/", "");
      if (updateId === "latest.json") continue;

      const manifest = await this.getManifest(
        platform,
        runtimeVersion,
        updateId
      );
      if (manifest) {
        updates.push({
          id: updateId,
          createdAt: manifest.createdAt,
          metadata: manifest.metadata,
        });
      }
    }

    return updates
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  /**
   * Rollback to specific update
   */
  async rollback(platform, runtimeVersion, updateId) {
    const manifest = await this.getManifest(platform, runtimeVersion, updateId);
    if (!manifest) {
      throw new Error(`Update ${updateId} not found`);
    }

    await this.setLatest(platform, runtimeVersion, updateId);
    return manifest;
  }
}

export default new ExpoUpdatesService();
