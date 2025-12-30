// controllers/expoUpdatesController.js

/**
 * Expo Updates Controller
 * Handles manifest requests and asset serving
 */

import expoUpdatesService from "../services/expoUpdates.service.js";
import crypto from "crypto";

/**
 * GET /api/expo-updates/manifest
 * Main endpoint that expo-updates client calls
 */
export const getManifest = async (req, res) => {
  try {
    // Extract headers from expo-updates client
    const platform = req.headers["expo-platform"] || req.query.platform;
    const runtimeVersion =
      req.headers["expo-runtime-version"] || req.query.runtimeVersion;
    const currentUpdateId =
      req.headers["expo-current-update-id"] || req.query.currentUpdateId;

    console.log("[Expo Updates] Manifest request:", {
      platform,
      runtimeVersion,
      currentUpdateId,
    });

    if (!platform || !runtimeVersion) {
      return res.status(400).json({
        error:
          "Missing required: expo-platform and expo-runtime-version headers",
      });
    }

    const manifest = await expoUpdatesService.generateManifestResponse({
      platform,
      runtimeVersion,
      currentUpdateId,
    });

    if (manifest.noUpdateAvailable) {
      // Return 204 No Content when no update
      return res.status(204).end();
    }

    // Sign the manifest (required by expo-updates)
    const manifestString = JSON.stringify(manifest);
    const signature = crypto
      .createHash("sha256")
      .update(manifestString)
      .digest("hex");

    res.setHeader("expo-protocol-version", "1");
    res.setHeader("expo-sfv-version", "0");
    res.setHeader("expo-manifest-signature", signature);
    res.setHeader("cache-control", "private, max-age=0");
    res.setHeader("content-type", "application/json");

    return res.json(manifest);
  } catch (error) {
    console.error("[Expo Updates] Manifest error:", error);
    return res.status(500).json({ error: "Failed to get manifest" });
  }
};

/**
 * GET /api/expo-updates/assets/:platform/:runtimeVersion/:updateId/*
 * Serve assets (JS bundle, images, fonts, etc.)
 */
export const getAsset = async (req, res) => {
  try {
    const { platform, runtimeVersion, updateId } = req.params;
    const assetPath = req.params[0]; // Wildcard path

    console.log("[Expo Updates] Asset request:", {
      platform,
      runtimeVersion,
      updateId,
      assetPath,
    });

    if (!platform || !runtimeVersion || !updateId || !assetPath) {
      return res.status(400).json({ error: "Invalid asset path" });
    }

    // Option 1: Redirect to signed URL (recommended for large files)
    // const signedUrl = await expoUpdatesService.getAssetUrl(platform, runtimeVersion, updateId, assetPath);
    // return res.redirect(signedUrl);

    // Option 2: Proxy the asset (better for caching/CDN)
    const asset = await expoUpdatesService.getAssetStream(
      platform,
      runtimeVersion,
      updateId,
      assetPath
    );

    res.setHeader(
      "content-type",
      asset.contentType || "application/octet-stream"
    );
    res.setHeader("content-length", asset.contentLength);
    res.setHeader("cache-control", "public, max-age=31536000, immutable");

    asset.stream.pipe(res);
  } catch (error) {
    console.error("[Expo Updates] Asset error:", error);
    if (error.name === "NoSuchKey") {
      return res.status(404).json({ error: "Asset not found" });
    }
    return res.status(500).json({ error: "Failed to get asset" });
  }
};

/**
 * POST /api/expo-updates/upload
 * Upload new update (called by CLI)
 */
export const uploadUpdate = async (req, res) => {
  try {
    const { platform, runtimeVersion, message } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    if (!platform || !runtimeVersion) {
      return res
        .status(400)
        .json({ error: "Missing platform or runtimeVersion" });
    }

    // Generate unique update ID
    const updateId = crypto.randomUUID();

    // Process uploaded files
    const files = req.files.map((file) => ({
      path: file.originalname,
      buffer: file.buffer,
      contentType: file.mimetype,
    }));

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

    console.log("[Expo Updates] Uploaded:", {
      platform,
      runtimeVersion,
      updateId,
    });

    return res.json({
      success: true,
      updateId,
      manifest,
    });
  } catch (error) {
    console.error("[Expo Updates] Upload error:", error);
    return res.status(500).json({ error: "Failed to upload update" });
  }
};

/**
 * GET /api/expo-updates/updates/:platform/:runtimeVersion
 * List all updates
 */
export const listUpdates = async (req, res) => {
  try {
    const { platform, runtimeVersion } = req.params;
    const { limit = 20 } = req.query;

    const updates = await expoUpdatesService.listUpdates(
      platform,
      runtimeVersion,
      parseInt(limit)
    );

    return res.json({ updates });
  } catch (error) {
    console.error("[Expo Updates] List error:", error);
    return res.status(500).json({ error: "Failed to list updates" });
  }
};

/**
 * POST /api/expo-updates/rollback
 * Rollback to specific update
 */
export const rollback = async (req, res) => {
  try {
    const { platform, runtimeVersion, updateId } = req.body;

    if (!platform || !runtimeVersion || !updateId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const manifest = await expoUpdatesService.rollback(
      platform,
      runtimeVersion,
      updateId
    );

    return res.json({
      success: true,
      message: `Rolled back to ${updateId}`,
      manifest,
    });
  } catch (error) {
    console.error("[Expo Updates] Rollback error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to rollback" });
  }
};
