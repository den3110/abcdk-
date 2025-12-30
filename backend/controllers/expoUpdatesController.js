// controllers/expoUpdatesController.js
/**
 * Expo Updates Controller (Expo Updates v1)
 *
 * Fixes:
 * - send Expo Updates v1 required headers
 * - expo-manifest-filters / expo-server-defined-headers must be Expo SFV dict (use "()" for empty)
 * - content-type negotiation (prefer application/expo+json)
 * - add Vary to avoid cache mixing by platform/runtime
 * - asset fallback: try without extension if not found
 */

import { v4 as uuidv4 } from "uuid";
import expoUpdatesService from "../services/expoUpdates.service.js";

const pickContentType = (accept) => {
  const a = String(accept || "").toLowerCase();
  if (a.includes("application/expo+json")) return "application/expo+json";
  return "application/json";
};

// Empty SFV dictionary
const EMPTY_SFV_DICT = "()";

const setCommonHeaders = (res, contentType) => {
  // Common response headers (Expo Updates v1)
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("expo-manifest-filters", EMPTY_SFV_DICT);
  res.setHeader("expo-server-defined-headers", EMPTY_SFV_DICT);

  // Recommended to prevent stale manifests
  res.setHeader("cache-control", "private, max-age=0");

  // Helpful for CDNs / caches to not mix platforms/runtime
  res.setHeader(
    "vary",
    "accept, expo-platform, expo-runtime-version, expo-current-update-id"
  );

  if (contentType) res.setHeader("content-type", contentType);
};

export const getManifest = async (req, res) => {
  try {
    const platform =
      req.get("expo-platform") || req.query.platform || req.query.expoPlatform;

    const runtimeVersion =
      req.get("expo-runtime-version") ||
      req.query.runtimeVersion ||
      req.query.expoRuntimeVersion;

    if (!platform || !runtimeVersion) {
      return res.status(400).json({
        error:
          "Missing required headers: expo-platform and expo-runtime-version",
      });
    }

    const protocol = req.get("expo-protocol-version");
    if (protocol && String(protocol) !== "1") {
      return res.status(400).json({
        error: `Unsupported expo-protocol-version: ${protocol}`,
      });
    }

    const currentUpdateId = req.get("expo-current-update-id") || null;

    // ✅ IMPORTANT: match service method name
    const result = await expoUpdatesService.generateManifestResponse({
      platform: String(platform).toLowerCase(),
      runtimeVersion: String(runtimeVersion),
      currentUpdateId,
    });

    if (!result || result.noUpdateAvailable) {
      // For "no update", 204 is OK. We still return protocol headers.
      setCommonHeaders(res, null); // no content-type on 204 is fine
      return res.status(204).send();
    }

    const contentType = pickContentType(req.get("accept"));
    setCommonHeaders(res, contentType);

    // send raw json string so content-type stays exactly as set
    return res.status(200).send(JSON.stringify(result));
  } catch (error) {
    console.error("[Expo Updates] Manifest error:", error);
    return res.status(500).json({
      error: "Failed to generate manifest",
      message: error?.message,
    });
  }
};

const safeAssetPath = (raw) => {
  let p = String(raw || "");
  // Express usually decodes, but be defensive
  try {
    p = decodeURIComponent(p);
  } catch {
    // ignore
  }

  // Normalize slashes
  p = p.replace(/\\/g, "/").replace(/^\/+/, "");

  // basic traversal guard
  if (p.includes("..")) return null;

  return p;
};

export const getAsset = async (req, res) => {
  try {
    const { platform, runtimeVersion, updateId } = req.params;
    const wildcardPath = req.params[0]; // wildcard from route
    const assetPath = safeAssetPath(wildcardPath);

    if (!platform || !runtimeVersion || !updateId || !assetPath) {
      return res.status(400).json({ error: "Missing asset params" });
    }

    const lowerPlatform = String(platform).toLowerCase();
    const rv = String(runtimeVersion);
    const uid = String(updateId);

    // 1) try exact
    let asset;
    try {
      asset = await expoUpdatesService.getAssetStream(
        lowerPlatform,
        rv,
        uid,
        assetPath
      );
    } catch (e) {
      // 2) fallback: strip extension if present (common self-host mismatch)
      const lastDot = assetPath.lastIndexOf(".");
      if (lastDot > -1) {
        const noExt = assetPath.slice(0, lastDot);
        asset = await expoUpdatesService.getAssetStream(
          lowerPlatform,
          rv,
          uid,
          noExt
        );
      } else {
        throw e;
      }
    }

    const { stream, contentType, contentLength } = asset;

    res.setHeader("content-type", contentType || "application/octet-stream");
    if (contentLength) res.setHeader("content-length", String(contentLength));

    // assets can be cached long-term
    res.setHeader("cache-control", "public, max-age=31536000, immutable");

    stream.on("error", (err) => {
      console.error("[Expo Updates] Asset stream error:", err);
      if (!res.headersSent) res.status(404).end();
      else res.end();
    });

    stream.pipe(res);
  } catch (error) {
    console.error("[Expo Updates] Asset error:", error);
    return res.status(404).json({ error: "Asset not found" });
  }
};

export const uploadUpdate = async (req, res) => {
  try {
    const { platform, runtimeVersion, message, paths } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    if (!platform || !runtimeVersion) {
      return res
        .status(400)
        .json({ error: "Missing platform or runtimeVersion" });
    }

    const updateId = uuidv4();

    // Optional: CLI may send paths JSON to preserve folder structure
    let filePaths = [];
    if (paths) {
      try {
        filePaths = JSON.parse(paths);
        if (!Array.isArray(filePaths)) filePaths = [];
      } catch {
        filePaths = [];
      }
    }

    const files = req.files.map((file, index) => {
      // prefer: originalname contains relativePath (new CLI)
      // fallback: paths[index] (old CLI)
      const chosenPath = file.originalname?.includes("/")
        ? file.originalname
        : filePaths[index] || file.originalname;

      return {
        path: chosenPath,
        buffer: file.buffer,
        contentType: file.mimetype,
      };
    });

    console.log(
      "[Expo Updates] Upload files:",
      files.map((f) => f.path)
    );

    const manifest = await expoUpdatesService.uploadUpdate({
      platform,
      runtimeVersion,
      updateId,
      files,
      metadata: {
        message: message || "",
        uploadedAt: new Date().toISOString(),
      },
    });

    return res.json({ success: true, updateId, manifest });
  } catch (error) {
    console.error("[Expo Updates] Upload error:", error);
    return res.status(500).json({
      error: "Failed to upload update",
      message: error?.message,
    });
  }
};

export const listUpdates = async (req, res) => {
  try {
    const { platform, runtimeVersion } = req.params;

    if (!platform || !runtimeVersion) {
      return res
        .status(400)
        .json({ error: "Missing platform or runtimeVersion" });
    }

    const updates = await expoUpdatesService.listUpdates(
      String(platform).toLowerCase(),
      String(runtimeVersion)
    );

    return res.json({ success: true, updates });
  } catch (error) {
    console.error("[Expo Updates] List error:", error);
    return res.status(500).json({ error: "Failed to list updates" });
  }
};

export const rollback = async (req, res) => {
  try {
    const { platform, runtimeVersion, updateId } = req.body;

    if (!platform || !runtimeVersion || !updateId) {
      return res.status(400).json({
        error: "Missing platform, runtimeVersion, or updateId",
      });
    }

    const result = await expoUpdatesService.rollback(
      String(platform).toLowerCase(),
      String(runtimeVersion),
      String(updateId)
    );

    return res.json(result);
  } catch (error) {
    console.error("[Expo Updates] Rollback error:", error);
    return res.status(500).json({
      error: "Failed to rollback update",
      message: error?.message,
    });
  }
};
