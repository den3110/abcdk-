// controllers/expoUpdatesController.js
/**
 * Expo Updates Controller (Expo Updates v1)
 *
 * Fixes:
 * - send Expo Updates v1 required headers
 * - do NOT use expo-manifest-signature (v1 uses expo-signature only when code signing)
 * - content-type negotiation (prefer application/expo+json)
 */

import { v4 as uuidv4 } from "uuid";
import expoUpdatesService from "../services/expoUpdates.service.js";

const pickContentType = (accept) => {
  const a = String(accept || "").toLowerCase();
  if (a.includes("application/expo+json")) return "application/expo+json";
  return "application/json";
};

const setCommonHeaders = (res, contentType) => {
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  // Expo spec says these should exist; empty dictionary is fine.
  res.setHeader("expo-manifest-filters", "");
  res.setHeader("expo-server-defined-headers", "");
  res.setHeader("cache-control", "private, max-age=0");
  res.setHeader("content-type", contentType);
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

    const manifest = await expoUpdatesService.generateClientManifest(
      String(platform).toLowerCase(),
      String(runtimeVersion),
      currentUpdateId
    );

    if (!manifest) {
      // no update
      res.setHeader("expo-protocol-version", "1");
      res.setHeader("expo-sfv-version", "0");
      res.setHeader("cache-control", "private, max-age=0");
      return res.status(204).send();
    }

    const contentType = pickContentType(req.get("accept"));
    setCommonHeaders(res, contentType);

    return res.status(200).send(JSON.stringify(manifest));
  } catch (error) {
    console.error("[Expo Updates] Manifest error:", error);
    return res.status(500).json({
      error: "Failed to generate manifest",
      message: error?.message,
    });
  }
};

export const getAsset = async (req, res) => {
  try {
    const { platform, runtimeVersion, updateId } = req.params;
    const assetPath = req.params[0]; // wildcard

    if (!platform || !runtimeVersion || !updateId || !assetPath) {
      return res.status(400).json({ error: "Missing asset params" });
    }

    const { stream, contentType, contentLength } =
      await expoUpdatesService.getAssetStream(
        String(platform).toLowerCase(),
        String(runtimeVersion),
        String(updateId),
        assetPath
      );

    res.setHeader("content-type", contentType || "application/octet-stream");
    if (contentLength) res.setHeader("content-length", String(contentLength));

    // assets can be cached long-term
    res.setHeader("cache-control", "public, max-age=31536000, immutable");

    // Pipe stream
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
