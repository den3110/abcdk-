/**
 * Expo Updates Service - Self-hosted
 * Implements Expo Updates Protocol
 */

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
    this.baseUrl = process.env.API_URL || "https://pickletour.vn/api";
  }

  /**
   * Upload update bundle (from expo export)
   */
  async uploadUpdate({ platform, runtimeVersion, updateId, files, metadata }) {
    const prefix = `expo-updates/${platform}/${runtimeVersion}/${updateId}`;

    // Find and parse metadata.json first to get extensions
    const metadataFile = files.find(f => f.path === "metadata.json");
    let expoMetadata = null;
    let assetExtensions = {};

    if (metadataFile) {
      try {
        expoMetadata = JSON.parse(metadataFile.buffer.toString());
        // Build extension map from metadata
        const platformMeta = expoMetadata?.fileMetadata?.[platform];
        if (platformMeta?.assets) {
          for (const asset of platformMeta.assets) {
            // asset.path = "assets/xxxxx", asset.ext = "png"
            assetExtensions[asset.path] = asset.ext;
          }
        }
        console.log("[Expo Updates] Parsed metadata, found", Object.keys(assetExtensions).length, "asset extensions");
      } catch (e) {
        console.error("[Expo Updates] Failed to parse metadata.json:", e);
      }
    }

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

      // Expo uses base64 (not base64url)
      const hash = crypto.createHash("sha256").update(file.buffer).digest("base64");
      
      // Get extension from metadata or from filename
      let ext = assetExtensions[file.path] || null;
      if (!ext) {
        const parts = file.path.split(".");
        if (parts.length > 1 && parts[parts.length - 1].length <= 5) {
          ext = parts[parts.length - 1];
        }
      }
      
      uploadedAssets.push({
        path: file.path,
        key,
        hash,
        contentType: file.contentType,
        size: file.buffer.length,
        ext: ext, // Store extension
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
      expoMetadata: expoMetadata, // Store original expo metadata
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
          updatedAt: new Date().toISOString() 
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
  async generateManifestResponse({ platform, runtimeVersion, currentUpdateId }) {
    const latestUpdateId = await this.getLatestUpdateId(platform, runtimeVersion);

    if (!latestUpdateId) {
      return { noUpdateAvailable: true };
    }

    // Same version, no update
    if (latestUpdateId === currentUpdateId) {
      return { noUpdateAvailable: true };
    }

    const manifest = await this.getManifest(platform, runtimeVersion, latestUpdateId);
    if (!manifest) {
      return { noUpdateAvailable: true };
    }

    // Build extension map from expoMetadata if available
    const assetExtensions = {};
    const platformMeta = manifest.expoMetadata?.fileMetadata?.[platform];
    if (platformMeta?.assets) {
      for (const asset of platformMeta.assets) {
        assetExtensions[asset.path] = asset.ext;
      }
    }

    // Find launch asset (JS bundle)
    const launchAsset = manifest.assets.find(a => 
      a.path.endsWith(".bundle") || a.path.endsWith(".hbc")
    );

    // Helper to get file extension
    const getFileExtension = (asset) => {
      // First check stored ext
      if (asset.ext) return asset.ext;
      
      // Then check expoMetadata
      if (assetExtensions[asset.path]) return assetExtensions[asset.path];
      
      // Then check filename
      const parts = asset.path.split(".");
      if (parts.length > 1 && parts[parts.length - 1].length <= 5) {
        return parts[parts.length - 1];
      }
      
      // Guess from contentType
      const ctMap = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "font/ttf": "ttf",
        "font/otf": "otf",
        "audio/mpeg": "mp3",
        "application/json": "json",
      };
      if (asset.contentType && ctMap[asset.contentType]) {
        return ctMap[asset.contentType];
      }
      
      return "bundle";
    };

    // Build assets array (exclude launch asset and metadata.json)
    const assets = manifest.assets
      .filter(a => !a.path.endsWith(".bundle") && !a.path.endsWith(".hbc") && a.path !== "metadata.json")
      .map(a => ({
        hash: a.hash,
        key: a.path,
        contentType: a.contentType || "application/octet-stream",
        fileExtension: getFileExtension(a),
        url: `${this.baseUrl}/api/expo-updates/assets/${platform}/${runtimeVersion}/${latestUpdateId}/${a.path}`,
      }));

    return {
      id: latestUpdateId,
      createdAt: manifest.createdAt,
      runtimeVersion,
      launchAsset: launchAsset ? {
        hash: launchAsset.hash,
        key: launchAsset.path,
        contentType: "application/javascript",
        fileExtension: launchAsset.path.endsWith(".hbc") ? "hbc" : "bundle",
        url: `${this.baseUrl}/api/expo-updates/assets/${platform}/${runtimeVersion}/${latestUpdateId}/${launchAsset.path}`,
      } : undefined,
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
    
    console.log("[Expo Updates] Getting asset:", key);
    
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
      
      const manifest = await this.getManifest(platform, runtimeVersion, updateId);
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