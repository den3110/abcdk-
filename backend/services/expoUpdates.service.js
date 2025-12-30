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
import path from "path";

const normalizePath = (p) => {
  const s = String(p || "").replace(/\\/g, "/").trim();
  const cleaned = s.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  return cleaned
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
};

const encodePathForUrl = (relPath) => {
  const p = normalizePath(relPath);
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
};

const basenamePosix = (p) => {
  const s = String(p || "").replace(/\\/g, "/");
  const parts = s.split("/");
  return parts[parts.length - 1] || s;
};

// SHA-256 -> base64url (no padding)
const sha256Base64Url = (buf) => {
  const b64 = crypto.createHash("sha256").update(buf).digest("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const ensureDotExt = (ext) => {
  if (!ext) return null;
  const e = String(ext).trim();
  if (!e) return null;
  return e.startsWith(".") ? e : `.${e}`;
};

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

    // ✅ GIỮ NGUYÊN theo yêu cầu của bạn
    this.baseUrl = process.env.API_URL || "https://pickletour.vn/api";
  }

  /**
   * Upload update bundle (from expo export)
   */
  async uploadUpdate({ platform, runtimeVersion, updateId, files, metadata }) {
    const safePlatform = String(platform || "").toLowerCase();
    const safeRuntime = String(runtimeVersion || "");
    const safeUpdateId = String(updateId || "");
    const prefix = `expo-updates/${safePlatform}/${safeRuntime}/${safeUpdateId}`;

    // Find and parse metadata.json first to get extensions
    const metadataFile = files.find((f) => normalizePath(f.path) === "metadata.json");
    let expoMetadata = null;
    const assetExtensions = {};

    if (metadataFile) {
      try {
        expoMetadata = JSON.parse(Buffer.from(metadataFile.buffer).toString("utf-8"));
        // Build extension map from metadata
        const platformMeta = expoMetadata?.fileMetadata?.[safePlatform];
        if (platformMeta?.assets) {
          for (const asset of platformMeta.assets) {
            if (asset?.path && asset?.ext) {
              assetExtensions[String(asset.path)] = String(asset.ext);
            }
          }
        }
        console.log(
          "[Expo Updates] Parsed metadata, found",
          Object.keys(assetExtensions).length,
          "asset extensions"
        );
      } catch (e) {
        console.error("[Expo Updates] Failed to parse metadata.json:", e);
      }
    }

    // Upload each file
    const uploadedAssets = [];
    for (const file of files) {
      const relPath = normalizePath(file.path);
      if (!relPath) continue;

      const key = `${prefix}/${relPath}`;

      // normalize contentType for bundles
      let contentType = file.contentType || "application/octet-stream";
      if (
        relPath.endsWith(".bundle") ||
        relPath.endsWith(".hbc") ||
        relPath.endsWith(".jsbundle")
      ) {
        contentType = "application/javascript";
      }

      await this.r2.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: contentType,
        })
      );

      // ✅ FIX: hash chuẩn base64url sha256 (no padding)
      const hash = sha256Base64Url(file.buffer);

      // Get extension from metadata or from filename
      let ext = assetExtensions[relPath] || null;
      if (!ext) {
        const parts = relPath.split(".");
        if (parts.length > 1 && parts[parts.length - 1].length <= 5) {
          ext = parts[parts.length - 1];
        }
      }

      uploadedAssets.push({
        path: relPath,
        key, // storage key (debug/admin)
        hash,
        contentType,
        size: file.buffer.length,
        ext: ext, // store without dot; we'll add dot when generating manifest
      });
    }

    // Save manifest
    const manifest = {
      id: safeUpdateId,
      createdAt: new Date().toISOString(),
      runtimeVersion: safeRuntime,
      platform: safePlatform,
      metadata: metadata || {},
      assets: uploadedAssets,
      expoMetadata: expoMetadata,
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
    await this.setLatest(safePlatform, safeRuntime, safeUpdateId);

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
        Body: JSON.stringify(
          {
            updateId,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
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
   */
  async generateManifestResponse({ platform, runtimeVersion, currentUpdateId }) {
    const safePlatform = String(platform || "").toLowerCase();
    const safeRuntime = String(runtimeVersion || "");

    const latestUpdateId = await this.getLatestUpdateId(safePlatform, safeRuntime);

    if (!latestUpdateId) return { noUpdateAvailable: true };

    // Same version, no update
    if (latestUpdateId === currentUpdateId) return { noUpdateAvailable: true };

    const manifest = await this.getManifest(safePlatform, safeRuntime, latestUpdateId);
    if (!manifest) return { noUpdateAvailable: true };

    // Build extension map from expoMetadata if available
    const assetExtensions = {};
    const platformMeta = manifest.expoMetadata?.fileMetadata?.[safePlatform];
    if (platformMeta?.assets) {
      for (const asset of platformMeta.assets) {
        if (asset?.path && asset?.ext) assetExtensions[String(asset.path)] = String(asset.ext);
      }
    }

    // Find launch asset (JS bundle)
    const bundlePathFromMetadata = platformMeta?.bundle;
    let launchAsset =
      (bundlePathFromMetadata &&
        manifest.assets.find((a) => a.path === bundlePathFromMetadata)) ||
      manifest.assets.find((a) => a.path.endsWith(".bundle")) ||
      manifest.assets.find((a) => a.path.endsWith(".hbc")) ||
      manifest.assets.find(
        (a) =>
          a.contentType === "application/javascript" &&
          (a.path.includes("bundles/") || a.path.includes("static/js/"))
      );

    if (!launchAsset) {
      launchAsset = manifest.assets.find((a) => a.path.endsWith(".js"));
    }

    const getFileExtension = (asset) => {
      if (asset.ext) return ensureDotExt(asset.ext);

      if (assetExtensions[asset.path]) return ensureDotExt(assetExtensions[asset.path]);

      const parts = asset.path.split(".");
      if (parts.length > 1 && parts[parts.length - 1].length <= 5) {
        return ensureDotExt(parts[parts.length - 1]);
      }

      const ctMap = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "font/ttf": ".ttf",
        "font/otf": ".otf",
        "audio/mpeg": ".mp3",
        "application/json": ".json",
      };
      if (asset.contentType && ctMap[asset.contentType]) return ctMap[asset.contentType];

      return ".bin";
    };

    const buildAssetUrl = (assetPath) =>
      `${this.baseUrl}/api/expo-updates/assets/${safePlatform}/${safeRuntime}/${latestUpdateId}/${encodePathForUrl(
        assetPath
      )}`;

    // Build assets array (exclude launch asset and metadata.json)
    const assets = manifest.assets
      .filter((a) => a.path !== "metadata.json")
      .filter((a) => !a.path.endsWith(".map"))
      .filter((a) => !launchAsset || a.path !== launchAsset.path)
      .map((a) => ({
        hash: a.hash,
        // ✅ FIX: key dùng basename để tránh iOS phải tạo folder lồng nhau
        key: basenamePosix(a.path),
        contentType: a.contentType || "application/octet-stream",
        // ✅ FIX: fileExtension phải có dấu chấm
        fileExtension: getFileExtension(a),
        url: buildAssetUrl(a.path),
      }));

    return {
      id: latestUpdateId,
      createdAt: manifest.createdAt,
      runtimeVersion: safeRuntime,
      launchAsset: launchAsset
        ? {
            hash: launchAsset.hash,
            // ✅ FIX: key basename
            key: basenamePosix(launchAsset.path),
            contentType: "application/javascript",
            // (khuyến nghị: không cần fileExtension cho launchAsset)
            url: buildAssetUrl(launchAsset.path),
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
    const rel = normalizePath(assetPath);
    const key = `expo-updates/${platform}/${runtimeVersion}/${updateId}/${rel}`;

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
    const rel = normalizePath(assetPath);
    const key = `expo-updates/${platform}/${runtimeVersion}/${updateId}/${rel}`;

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
