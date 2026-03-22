import fs from "fs";
import { pipeline } from "stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  getLiveMultiSourceTargetPublicBaseUrlSync,
  getLiveServer2ManifestNameSync,
} from "./liveMultiSourceConfig.service.js";

const DEFAULT_RECORDING_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_RECORDING_TARGET_ID = "default";
const RECORDING_STORAGE_USAGE_PREFIX = "recordings/v2/";
const MAX_DELETE_OBJECTS_PER_REQUEST = 1000;
const DEFAULT_RECORDING_STORAGE_SCAN_TTL_MS = 15_000;
const MIN_RECORDING_STORAGE_SCAN_TTL_MS = 5_000;
let recordingStorageUsageCache = {
  value: null,
  expiresAt: 0,
  promise: null,
};

function asTrimmed(value) {
  return String(value || "").trim();
}

function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return null;
}

function getRecordingStorageScanTtlMs() {
  const configured = parsePositiveInteger(
    process.env.LIVE_RECORDING_R2_STORAGE_SCAN_TTL_MS
  );
  return Math.max(
    MIN_RECORDING_STORAGE_SCAN_TTL_MS,
    configured || DEFAULT_RECORDING_STORAGE_SCAN_TTL_MS
  );
}

function chunkArray(items = [], size = 1) {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function parseRecordingIdFromObjectKey(objectKey) {
  const matched = /^recordings\/v2\/matches\/[^/]+\/([^/]+)\//.exec(
    String(objectKey || "").trim()
  );
  return matched?.[1] || "";
}

function normalizeRecordingStorageTarget(rawTarget = {}, index = 0) {
  const endpoint = asTrimmed(rawTarget.endpoint);
  const accessKeyId = asTrimmed(rawTarget.accessKeyId);
  const secretAccessKey = asTrimmed(rawTarget.secretAccessKey);
  const bucketName = asTrimmed(rawTarget.bucketName || rawTarget.bucket);
  const publicBaseUrl =
    asTrimmed(rawTarget.publicBaseUrl) ||
    asTrimmed(rawTarget.cdnBaseUrl) ||
    asTrimmed(process.env.LIVE_RECORDING_PUBLIC_CDN_BASE_URL);
  const enabled = rawTarget.enabled !== false;

  if (!enabled || !endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  const id =
    asTrimmed(rawTarget.id) || `${DEFAULT_RECORDING_TARGET_ID}_${index + 1}`;

  return {
    id,
    label: asTrimmed(rawTarget.label) || id,
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicBaseUrl,
    capacityBytes:
      parsePositiveInteger(
        rawTarget.capacityBytes || rawTarget.capacity || rawTarget.maxBytes
      ) || null,
  };
}

function getExplicitRecordingTargetsFromEnv() {
  const raw = asTrimmed(
    process.env.R2_RECORDINGS_TARGETS_JSON || process.env.R2_RECORDINGS_TARGETS
  );
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(
        "[live-recording-r2] R2_RECORDINGS_TARGETS_JSON must be a JSON array."
      );
      return [];
    }

    return parsed
      .map((target, index) => normalizeRecordingStorageTarget(target, index))
      .filter(Boolean);
  } catch (error) {
    console.warn(
      "[live-recording-r2] Failed to parse R2_RECORDINGS_TARGETS_JSON:",
      error?.message || error
    );
    return [];
  }
}

function buildFallbackRecordingTarget() {
  const endpoint =
    asTrimmed(process.env.R2_RECORDINGS_ENDPOINT) || asTrimmed(process.env.R2_ENDPOINT);
  const accessKeyId =
    asTrimmed(process.env.R2_RECORDINGS_ACCESS_KEY_ID) ||
    asTrimmed(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey =
    asTrimmed(process.env.R2_RECORDINGS_SECRET_ACCESS_KEY) ||
    asTrimmed(process.env.R2_SECRET_ACCESS_KEY);
  const bucketName =
    asTrimmed(process.env.R2_RECORDINGS_BUCKET_NAME) ||
    asTrimmed(process.env.R2_BUCKET_NAME);

  return normalizeRecordingStorageTarget(
    {
      id: DEFAULT_RECORDING_TARGET_ID,
      label: asTrimmed(process.env.R2_RECORDINGS_TARGET_LABEL) || "default",
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucketName,
      capacityBytes:
        parsePositiveInteger(process.env.R2_RECORDINGS_STORAGE_TOTAL_BYTES) ||
        parsePositiveInteger(process.env.R2_STORAGE_TOTAL_BYTES),
    },
    0
  );
}

const configuredRecordingTargets = (() => {
  const explicitTargets = getExplicitRecordingTargetsFromEnv();
  if (explicitTargets.length) return explicitTargets;

  const fallbackTarget = buildFallbackRecordingTarget();
  return fallbackTarget ? [fallbackTarget] : [];
})();

const recordingS3ClientCache = new Map();

function getRecordingStorageTargetInternal(storageTargetId = null) {
  if (!configuredRecordingTargets.length) return null;

  const normalizedTargetId = asTrimmed(storageTargetId);
  if (normalizedTargetId) {
    return configuredRecordingTargets.find((target) => target.id === normalizedTargetId) || null;
  }

  return configuredRecordingTargets[0] || null;
}

function requireRecordingStorageTarget(storageTargetId = null) {
  const target = getRecordingStorageTargetInternal(storageTargetId);
  if (!target) {
    if (asTrimmed(storageTargetId)) {
      throw new Error(`Recording R2 target "${asTrimmed(storageTargetId)}" is not configured`);
    }
    throw new Error("Recording R2 storage is not configured");
  }
  return target;
}

function getRecordingS3Client(storageTargetId = null) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const cacheKey = target.id;
  if (recordingS3ClientCache.has(cacheKey)) {
    return recordingS3ClientCache.get(cacheKey);
  }

  const client = new S3Client({
    region: "auto",
    endpoint: target.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
  });

  recordingS3ClientCache.set(cacheKey, client);
  return client;
}

export function getRecordingStorageTargets() {
  return configuredRecordingTargets.map((target) => ({
    id: target.id,
    label: target.label,
    endpoint: target.endpoint,
    bucketName: target.bucketName,
    publicBaseUrl: target.publicBaseUrl || null,
    capacityBytes: target.capacityBytes,
  }));
}

export function getRecordingStorageTarget(storageTargetId = null) {
  const target = getRecordingStorageTargetInternal(storageTargetId);
  if (!target) return null;

  return {
    id: target.id,
    label: target.label,
    endpoint: target.endpoint,
    bucketName: target.bucketName,
    publicBaseUrl: target.publicBaseUrl || null,
    capacityBytes: target.capacityBytes,
  };
}

export function getRecordingStorageConfiguredCapacityTotalBytes() {
  const explicitCapacities = configuredRecordingTargets
    .map((target) => target.capacityBytes)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (explicitCapacities.length) {
    return explicitCapacities.reduce((sum, value) => sum + value, 0);
  }

  return (
    parsePositiveInteger(process.env.R2_RECORDINGS_STORAGE_TOTAL_BYTES) ||
    parsePositiveInteger(process.env.R2_STORAGE_TOTAL_BYTES) ||
    null
  );
}

export function isRecordingR2Configured() {
  return configuredRecordingTargets.length > 0;
}

export function getRecordingBucketName(storageTargetId = null) {
  return requireRecordingStorageTarget(storageTargetId).bucketName;
}

export function getRecordingPublicBaseUrl(storageTargetId = null) {
  const target = requireRecordingStorageTarget(storageTargetId);
  return getLiveMultiSourceTargetPublicBaseUrlSync(
    target?.id,
    target?.publicBaseUrl || ""
  );
}

export function invalidateRecordingStorageUsageCache() {
  recordingStorageUsageCache = {
    value: null,
    expiresAt: 0,
    promise: null,
  };
}

export function buildRecordingPrefix({ recordingId, matchId }) {
  return `recordings/v2/matches/${String(matchId)}/${String(recordingId)}`;
}

export function buildRecordingSegmentObjectKey({
  recordingId,
  matchId,
  segmentIndex,
}) {
  const prefix = buildRecordingPrefix({ recordingId, matchId });
  const padded = String(segmentIndex).padStart(5, "0");
  return `${prefix}/segments/segment_${padded}.mp4`;
}

export function buildRecordingManifestObjectKey({ recordingId, matchId }) {
  const prefix = buildRecordingPrefix({ recordingId, matchId });
  return `${prefix}/manifest.json`;
}

export function buildRecordingLiveManifestObjectKey({ recordingId, matchId }) {
  const prefix = buildRecordingPrefix({ recordingId, matchId });
  const manifestName = getLiveServer2ManifestNameSync();
  return `${prefix}/${manifestName}`;
}

export function buildRecordingPublicObjectUrl({
  objectKey,
  storageTargetId = null,
}) {
  if (!objectKey) return null;
  const baseUrl = getRecordingPublicBaseUrl(storageTargetId);
  if (!baseUrl) return null;
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedObjectKey = String(objectKey).replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedObjectKey}`;
}

export async function createRecordingSegmentUploadUrl({
  objectKey,
  contentType = "video/mp4",
  expiresInSeconds = 60 * 20,
  storageTargetId = null,
}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  const command = new PutObjectCommand({
    Bucket: target.bucketName,
    Key: objectKey,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return {
    uploadUrl,
    objectKey,
    expiresInSeconds,
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    storageTargetId: target.id,
    bucketName: target.bucketName,
  };
}

export async function createRecordingLiveManifestUploadUrl({
  objectKey,
  expiresInSeconds = 60 * 60 * 12,
  storageTargetId = null,
}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  const command = new PutObjectCommand({
    Bucket: target.bucketName,
    Key: objectKey,
    ContentType: "application/json; charset=utf-8",
    CacheControl: "public, max-age=2, stale-while-revalidate=4",
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return {
    uploadUrl,
    objectKey,
    expiresInSeconds,
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    storageTargetId: target.id,
    bucketName: target.bucketName,
  };
}

export async function createRecordingObjectDownloadUrl({
  objectKey,
  expiresInSeconds = 60 * 60 * 12,
  storageTargetId = null,
}) {
  if (!objectKey) {
    throw new Error("objectKey is required");
  }

  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  const downloadUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: target.bucketName,
      Key: objectKey,
    }),
    {
      expiresIn: expiresInSeconds,
    }
  );

  return {
    downloadUrl,
    objectKey,
    expiresInSeconds,
    method: "GET",
    storageTargetId: target.id,
    bucketName: target.bucketName,
  };
}

export function getRecordingMultipartPartSizeBytes() {
  const raw = Number(process.env.R2_RECORDINGS_PART_SIZE_BYTES || 0);
  if (Number.isFinite(raw) && raw >= MIN_MULTIPART_PART_SIZE_BYTES) {
    return Math.floor(raw);
  }
  return DEFAULT_RECORDING_PART_SIZE_BYTES;
}

export async function createRecordingMultipartUpload({
  objectKey,
  contentType = "video/mp4",
  storageTargetId = null,
}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  const command = new CreateMultipartUploadCommand({
    Bucket: target.bucketName,
    Key: objectKey,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });
  const response = await client.send(command);
  if (!response.UploadId) {
    throw new Error("R2 did not return multipart upload id");
  }

  return {
    uploadId: response.UploadId,
    objectKey,
    partSizeBytes: getRecordingMultipartPartSizeBytes(),
    contentType,
    storageTargetId: target.id,
    bucketName: target.bucketName,
  };
}

export async function createRecordingMultipartUploadPartUrl({
  objectKey,
  uploadId,
  partNumber,
  expiresInSeconds = 60 * 20,
  storageTargetId = null,
}) {
  if (!uploadId) {
    throw new Error("uploadId is required for multipart upload");
  }
  if (!Number.isInteger(partNumber) || partNumber <= 0) {
    throw new Error("partNumber must be >= 1");
  }

  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  const command = new UploadPartCommand({
    Bucket: target.bucketName,
    Key: objectKey,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return {
    uploadUrl,
    objectKey,
    uploadId,
    partNumber,
    expiresInSeconds,
    method: "PUT",
    headers: {},
    storageTargetId: target.id,
    bucketName: target.bucketName,
  };
}

export async function completeRecordingMultipartUpload({
  objectKey,
  uploadId,
  parts = [],
  storageTargetId = null,
}) {
  if (!uploadId) {
    throw new Error("uploadId is required for multipart completion");
  }

  const normalizedParts = (parts || [])
    .map((part) => ({
      PartNumber: Number(part.partNumber),
      ETag: String(part.etag || "").trim(),
    }))
    .filter(
      (part) => Number.isInteger(part.PartNumber) && part.PartNumber > 0 && part.ETag
    )
    .sort((a, b) => a.PartNumber - b.PartNumber);

  if (!normalizedParts.length) {
    throw new Error("Multipart completion requires at least one uploaded part");
  }

  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: target.bucketName,
      Key: objectKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: normalizedParts,
      },
    })
  );
}

export async function abortRecordingMultipartUpload({
  objectKey,
  uploadId,
  storageTargetId = null,
}) {
  if (!uploadId) return false;

  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: target.bucketName,
      Key: objectKey,
      UploadId: uploadId,
    })
  );

  return true;
}

export async function putRecordingManifest({
  objectKey,
  manifest,
  storageTargetId = null,
}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  await client.send(
    new PutObjectCommand({
      Bucket: target.bucketName,
      Key: objectKey,
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
    })
  );

  return objectKey;
}

async function scanRecordingStorageUsageUncached({
  prefix = RECORDING_STORAGE_USAGE_PREFIX,
} = {}) {
  const targetSummaries = [];
  const uniqueRecordingIds = new Set();
  let usedBytes = 0;
  let objectCount = 0;

  for (const target of configuredRecordingTargets) {
    const client = getRecordingS3Client(target.id);
    const targetRecordingIds = new Set();
    let targetUsedBytes = 0;
    let targetObjectCount = 0;
    let continuationToken = undefined;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: target.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: MAX_DELETE_OBJECTS_PER_REQUEST,
        })
      );

      for (const object of response?.Contents || []) {
        const objectSize = Number(object?.Size) || 0;
        const objectKey = String(object?.Key || "");
        targetUsedBytes += objectSize;
        targetObjectCount += 1;
        usedBytes += objectSize;
        objectCount += 1;

        const recordingId = parseRecordingIdFromObjectKey(objectKey);
        if (recordingId) {
          targetRecordingIds.add(recordingId);
          uniqueRecordingIds.add(recordingId);
        }
      }

      continuationToken =
        response?.IsTruncated && response?.NextContinuationToken
          ? response.NextContinuationToken
          : undefined;
    } while (continuationToken);

    targetSummaries.push({
      id: target.id,
      label: target.label,
      bucketName: target.bucketName,
      usedBytes: targetUsedBytes,
      objectCount: targetObjectCount,
      recordingsWithSourceOnR2: targetRecordingIds.size,
    });
  }

  return {
    usedBytes,
    objectCount,
    recordingsWithSourceOnR2: uniqueRecordingIds.size,
    targets: targetSummaries,
    scannedAt: new Date(),
    source: "r2_scan",
  };
}

export async function getRecordingStorageUsageSummary({
  forceRefresh = false,
  prefix = RECORDING_STORAGE_USAGE_PREFIX,
} = {}) {
  if (!isRecordingR2Configured()) {
    return {
      usedBytes: 0,
      objectCount: 0,
      recordingsWithSourceOnR2: 0,
      targets: [],
      scannedAt: new Date(),
      source: "unconfigured",
    };
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    recordingStorageUsageCache.value &&
    now < recordingStorageUsageCache.expiresAt
  ) {
    return recordingStorageUsageCache.value;
  }

  if (!forceRefresh && recordingStorageUsageCache.promise) {
    return recordingStorageUsageCache.promise;
  }

  const scanPromise = scanRecordingStorageUsageUncached({ prefix })
    .then((summary) => {
      recordingStorageUsageCache = {
        value: summary,
        expiresAt: Date.now() + getRecordingStorageScanTtlMs(),
        promise: null,
      };
      return summary;
    })
    .catch((error) => {
      recordingStorageUsageCache = {
        value: null,
        expiresAt: 0,
        promise: null,
      };
      throw error;
    });

  recordingStorageUsageCache = {
    ...recordingStorageUsageCache,
    promise: scanPromise,
  };

  return scanPromise;
}

export async function downloadRecordingObjectToFile({
  objectKey,
  targetPath,
  storageTargetId = null,
}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  const response = await client.send(
    new GetObjectCommand({
      Bucket: target.bucketName,
      Key: objectKey,
    })
  );

  if (!response.Body) {
    throw new Error(`Recording object ${objectKey} has no body`);
  }

  await pipeline(response.Body, fs.createWriteStream(targetPath));
  return targetPath;
}

export async function deleteRecordingObjects(
  objectKeys = [],
  { storageTargetId = null } = {}
) {
  const keys = [...new Set((objectKeys || []).filter(Boolean).map(String))].map(
    (Key) => ({ Key })
  );
  if (!keys.length || !isRecordingR2Configured()) {
    return {
      deletedObjectCount: 0,
      deletedKeys: [],
      errors: [],
    };
  }

  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);
  const deletedKeys = [];
  const errors = [];

  for (const batch of chunkArray(keys, MAX_DELETE_OBJECTS_PER_REQUEST)) {
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: target.bucketName,
        Delete: {
          Objects: batch,
          Quiet: false,
        },
      })
    );

    for (const deleted of response?.Deleted || []) {
      if (deleted?.Key) {
        deletedKeys.push(String(deleted.Key));
      }
    }

    for (const error of response?.Errors || []) {
      errors.push({
        key: String(error?.Key || ""),
        code: String(error?.Code || ""),
        message: String(error?.Message || ""),
      });
    }
  }

  invalidateRecordingStorageUsageCache();

  if (errors.length) {
    const errorPreview = errors
      .slice(0, 3)
      .map((item) => item.key || item.code || "unknown")
      .join(", ");
    const deleteError = new Error(
      `Failed to delete ${errors.length} recording object(s) from R2: ${errorPreview}`
    );
    deleteError.details = errors;
    deleteError.deletedKeys = deletedKeys;
    throw deleteError;
  }

  return {
    deletedObjectCount: deletedKeys.length,
    deletedKeys,
    errors: [],
  };
}
