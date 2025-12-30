// services/expoUpdates.service.js
/**
 * Expo Updates Service (Self-hosted)
 * - Stores update files in Cloudflare R2 (S3-compatible)
 * - Serves manifests/assets via your API endpoints
 *
 * Fixes:
 * - asset.hash must be Base64URL-encoded SHA-256 (Expo Updates v1 spec)
 * - asset.fileExtension must be prefixed with "."
 * - avoid double /api/api by using PUBLIC_ORIGIN + API_PREFIX + ROUTE_PREFIX
 */

import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const normalizeRelPath = (p) => {
  const s = String(p || "").replace(/\\/g, "/").trim();
  // remove leading ./ or /
  let out = s.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  // basic path traversal protection (keep it simple)
  out = out.split("/").filter((seg) => seg && seg !== "." && seg !== "..").join("/");
  return out;
};

const ensureLeadingDot = (ext) => {
  if (!ext) return undefined;
  const e = String(ext).trim();
  if (!e) return undefined;
  return e.startsWith(".") ? e : `.${e}`;
};

const toBase64Url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const sha256Base64Url = (buffer) =>
  toBase64Url(crypto.createHash("sha256").update(buffer).digest());

const joinUrl = (...parts) => {
  // joins like: joinUrl("https://x.com/", "/api", "expo-updates/manifest")
  const cleaned = parts
    .filter((p) => p !== undefined && p !== null)
    .map((p) => String(p))
    .filter((p) => p.length > 0);

  if (cleaned.length === 0) return "";
  const first = cleaned[0].replace(/\/+$/g, "");
  const rest = cleaned
    .slice(1)
    .map((p) => p.replace(/^\/+/g, "").replace(/\/+$/g, ""));
  return [first, ...rest].filter(Boolean).join("/");
};

const encodePathForUrl = (relPath) => {
  // encode each segment, keep "/" separators
  const p = normalizeRelPath(relPath);
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
};

const guessExtFromContentType = (ct) => {
  const c = String(ct || "").toLowerCase();
  if (c.includes("image/png")) return ".png";
  if (c.includes("image/jpeg")) return ".jpg";
  if (c.includes("image/webp")) return ".webp";
  if (c.includes("image/svg")) return ".svg";
  if (c.includes("font/ttf")) return ".ttf";
  if (c.includes("font/otf")) return ".otf";
  if (c.includes("font/woff2")) return ".woff2";
  if (c.includes("font/woff")) return ".woff";
  if (c.includes("application/json")) return ".json";
  if (c.includes("application/javascript") || c.includes("text/javascript")) return ".js";
  return undefined;
};

class ExpoUpdatesService {
  constructor() {
    // R2 (S3-compatible)
    this.bucket = process.env.R2_BUCKET || "pickletour";
    this.r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT, // e.g. https://<accountid>.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });

    // Public URL building (avoid double /api/api)
    this.publicOrigin = process.env.EXPO_UPDATES_PUBLIC_ORIGIN || "https://pickletour.vn";
    this.apiPrefix = process.env.EXPO_UPDATES_API_PREFIX || "/api";
    this.routePrefix = process.env.EXPO_UPDATES_ROUTE_PREFIX || "/expo-updates";

    // Storage prefix
    this.storageRoot = "expo-updates";
  }

  getUpdatesBaseUrl() {
    // https://pickletour.vn/api/expo-updates
    return joinUrl(this.publicOrigin, this.apiPrefix, this.routePrefix);
  }

  getAssetPublicUrl(platform, runtimeVersion, updateId, assetPath) {
    const base = this.getUpdatesBaseUrl();
    const encoded = encodePathForUrl(assetPath);
    return joinUrl(base, "assets", platform, runtimeVersion, updateId, encoded);
  }

  getManifestPublicUrl() {
    return joinUrl(this.getUpdatesBaseUrl(), "manifest");
  }

  getUpdatePrefix(platform, runtimeVersion, updateId) {
    return `${this.storageRoot}/${platform}/${runtimeVersion}/${updateId}`;
  }

  async putJson(key, obj, contentType = "application/json") {
    await this.r2.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: Buffer.from(JSON.stringify(obj, null, 2)),
        ContentType: contentType,
      })
    );
  }

  async getJson(key) {
    const res = await this.r2.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    const body = await this.streamToBuffer(res.Body);
    return JSON.parse(body.toString("utf-8"));
  }

  async streamToBuffer(streamOrBody) {
    if (!streamOrBody) return Buffer.from("");
    // Node stream
    if (typeof streamOrBody.pipe === "function") {
      const chunks = [];
      for await (const chunk of streamOrBody) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    // Uint8Array / Buffer
    return Buffer.from(streamOrBody);
  }

  /**
   * Upload an update build output (dist folder files)
   * files: [{ path, buffer, contentType }]
   */
  async uploadUpdate({ platform, runtimeVersion, updateId, files, metadata = {} }) {
    platform = String(platform || "").toLowerCase();
    runtimeVersion = String(runtimeVersion || "");
    updateId = String(updateId || "");

    if (!platform || !runtimeVersion || !updateId) {
      throw new Error("Missing platform/runtimeVersion/updateId");
    }
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("No files to upload");
    }

    // Parse Expo metadata.json if present
    let expoMetadata = null;
    const metadataFile = files.find((f) => normalizeRelPath(f.path) === "metadata.json");
    if (metadataFile?.buffer) {
      try {
        expoMetadata = JSON.parse(Buffer.from(metadataFile.buffer).toString("utf-8"));
      } catch (e) {
        console.warn("[Expo Updates] Failed to parse metadata.json:", e?.message);
      }
    }

    // Map: asset.path -> ext (from metadata.json)
    const assetExtensions = {};
    const platformMeta = expoMetadata?.fileMetadata?.[platform];
    if (platformMeta?.assets) {
      for (const a of platformMeta.assets) {
        if (a?.path && a?.ext) assetExtensions[String(a.path)] = String(a.ext);
      }
    }

    const prefix = this.getUpdatePrefix(platform, runtimeVersion, updateId);

    const uploadedAssets = [];
    for (const f of files) {
      const relPath = normalizeRelPath(f.path);
      if (!relPath) continue;

      const buf = Buffer.from(f.buffer || []);
      const declaredCt = String(f.contentType || "").trim();
      let contentType = declaredCt || "application/octet-stream";

      // make JS bundle content type more consistent
      if (
        relPath.endsWith(".bundle") ||
        relPath.endsWith(".hbc") ||
        relPath.endsWith(".js") ||
        relPath.endsWith(".jsbundle")
      ) {
        contentType = "application/javascript";
      }

      // Determine fileExtension (for manifest assets, not required for storing)
      // Prefer real ext in path, else metadata.json ext, else guess from contentType
      let ext = "";
      const dotExtFromPath = (() => {
        const last = relPath.split("/").pop() || "";
        const idx = last.lastIndexOf(".");
        return idx >= 0 ? last.slice(idx) : "";
      })();

      if (dotExtFromPath) {
        ext = dotExtFromPath; // includes "."
      } else if (assetExtensions[relPath]) {
        ext = ensureLeadingDot(assetExtensions[relPath]) || "";
      } else {
        ext = guessExtFromContentType(contentType) || "";
      }

      // Expo Updates v1: hash = Base64URL sha256
      const hash = sha256Base64Url(buf);

      const key = `${prefix}/${relPath}`;

      await this.r2.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buf,
          ContentType: contentType,
          // Cache could be long, but safe to keep default; assets endpoint will set cache headers anyway
        })
      );

      uploadedAssets.push({
        path: relPath,
        contentType,
        size: buf.length,
        hash,
        // store normalized ext with leading dot (or empty)
        ext: ext || "",
      });
    }

    const createdAt = new Date().toISOString();

    // Store "server manifest" (internal)
    const serverManifest = {
      id: updateId,
      createdAt,
      platform,
      runtimeVersion,
      metadata,
      assets: uploadedAssets,
      expoMetadata,
    };

    await this.putJson(`${prefix}/manifest.json`, serverManifest);

    // Update pointer to latest
    await this.putJson(`${this.storageRoot}/${platform}/${runtimeVersion}/current.json`, {
      updateId,
      updatedAt: createdAt,
    });

    return serverManifest;
  }

  async getLatestUpdate(platform, runtimeVersion) {
    platform = String(platform || "").toLowerCase();
    runtimeVersion = String(runtimeVersion || "");

    const pointerKey = `${this.storageRoot}/${platform}/${runtimeVersion}/current.json`;
    let updateId = null;

    try {
      const ptr = await this.getJson(pointerKey);
      updateId = ptr?.updateId || null;
    } catch (e) {
      // no pointer, fallback to listing
    }

    if (!updateId) {
      // fallback: list update folders
      const prefix = `${this.storageRoot}/${platform}/${runtimeVersion}/`;
      const list = await this.r2.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
        })
      );

      const keys = (list.Contents || []).map((x) => x.Key).filter(Boolean);

      // find ".../<updateId>/manifest.json"
      const manifestKeys = keys.filter((k) => k.endsWith("/manifest.json"));
      if (manifestKeys.length === 0) return null;

      // pick latest by LastModified if available
      const latest = (list.Contents || [])
        .filter((x) => x.Key && x.Key.endsWith("/manifest.json"))
        .sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0))[0];

      if (!latest?.Key) return null;
      const parts = latest.Key.split("/");
      updateId = parts[parts.length - 2]; // .../<updateId>/manifest.json
    }

    if (!updateId) return null;

    const manifestKey = `${this.getUpdatePrefix(platform, runtimeVersion, updateId)}/manifest.json`;
    return await this.getJson(manifestKey);
  }

  /**
   * Build client manifest (Expo Updates v1)
   */
  async generateClientManifest(platform, runtimeVersion, currentUpdateId) {
    const latest = await this.getLatestUpdate(platform, runtimeVersion);
    if (!latest) return null;

    if (currentUpdateId && String(currentUpdateId) === String(latest.id)) {
      return null; // no update
    }

    // Find launch asset (bundle)
    const launchAsset =
      latest.assets.find((a) => a.path.endsWith(".bundle")) ||
      latest.assets.find((a) => a.path.endsWith(".hbc")) ||
      latest.assets.find((a) => a.path.endsWith(".jsbundle")) ||
      latest.assets.find((a) => a.path.includes("entry-") && a.path.endsWith(".js")) ||
      latest.assets.find((a) => a.path.endsWith(".js"));

    if (!launchAsset) {
      throw new Error("Launch asset not found (expected .bundle/.hbc/.jsbundle/.js)");
    }

    const toClientAsset = (a) => {
      const fileExtension = ensureLeadingDot(a.ext) || undefined;

      return {
        hash: a.hash, // Base64URL sha256
        key: a.path, // keep original key/path from export
        contentType: a.contentType || "application/octet-stream",
        fileExtension,
        url: this.getAssetPublicUrl(platform, runtimeVersion, latest.id, a.path),
      };
    };

    // Assets list: exclude launchAsset + metadata.json + source maps by default
    const assets = latest.assets
      .filter((a) => a.path !== launchAsset.path)
      .filter((a) => a.path !== "metadata.json")
      .filter((a) => !a.path.endsWith(".map"))
      .map(toClientAsset);

    // launchAsset: fileExtension should be omitted (ignored by client)
    const launchAssetClient = {
      hash: launchAsset.hash,
      key: launchAsset.path,
      contentType: "application/javascript",
      url: this.getAssetPublicUrl(platform, runtimeVersion, latest.id, launchAsset.path),
    };

    // metadata must be string dictionary (best-effort)
    const md = latest.metadata || {};
    const metadata = {};
    for (const [k, v] of Object.entries(md)) {
      metadata[String(k)] = v == null ? "" : String(v);
    }

    return {
      id: latest.id,
      createdAt: latest.createdAt,
      runtimeVersion: latest.runtimeVersion,
      launchAsset: launchAssetClient,
      assets,
      metadata,
      extra: {}, // optional
    };
  }

  /**
   * Get an asset stream by relative assetPath
   */
  async getAssetStream(platform, runtimeVersion, updateId, assetPath) {
    const rel = normalizeRelPath(assetPath);
    const key = `${this.getUpdatePrefix(platform, runtimeVersion, updateId)}/${rel}`;

    const response = await this.r2.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    return {
      stream: response.Body,
      contentType: response.ContentType || "application/octet-stream",
      contentLength: response.ContentLength,
    };
  }

  async listUpdates(platform, runtimeVersion) {
    platform = String(platform || "").toLowerCase();
    runtimeVersion = String(runtimeVersion || "");

    const prefix = `${this.storageRoot}/${platform}/${runtimeVersion}/`;

    const list = await this.r2.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      })
    );

    const manifestKeys = (list.Contents || [])
      .map((x) => x.Key)
      .filter((k) => k && k.endsWith("/manifest.json"));

    const updates = [];
    for (const k of manifestKeys) {
      try {
        const mf = await this.getJson(k);
        updates.push(mf);
      } catch (e) {
        // ignore broken
      }
    }

    // newest first
    updates.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return updates;
  }

  async rollback(platform, runtimeVersion, updateId) {
    platform = String(platform || "").toLowerCase();
    runtimeVersion = String(runtimeVersion || "");
    updateId = String(updateId || "");

    if (!updateId) throw new Error("Missing updateId");

    // validate manifest exists
    const mfKey = `${this.getUpdatePrefix(platform, runtimeVersion, updateId)}/manifest.json`;
    await this.getJson(mfKey);

    await this.putJson(`${this.storageRoot}/${platform}/${runtimeVersion}/current.json`, {
      updateId,
      updatedAt: new Date().toISOString(),
      rolledBack: true,
    });

    return { success: true, updateId };
  }
}

export default new ExpoUpdatesService();
