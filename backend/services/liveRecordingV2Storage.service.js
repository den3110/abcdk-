import fs from "fs";
import { pipeline } from "stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
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
import {
  getLiveRecordingStorageTargetsConfig,
  getLiveRecordingStorageTargetsConfigSync,
  getRuntimeRecordingStorageTargetsSync,
} from "./liveRecordingStorageTargetsConfig.service.js";

const DEFAULT_RECORDING_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_DELETE_OBJECTS_PER_REQUEST = 1000;
const DEFAULT_RECORDING_STORAGE_SCAN_TTL_MS = 15_000;
const MIN_RECORDING_STORAGE_SCAN_TTL_MS = 5_000;
const DEFAULT_RECORDING_STORAGE_HEALTH_TTL_MS = 10_000;
const MIN_RECORDING_STORAGE_HEALTH_TTL_MS = 3_000;
const DEFAULT_RECORDING_STORAGE_HEALTH_TIMEOUT_MS = 5_000;
const MIN_RECORDING_STORAGE_HEALTH_TIMEOUT_MS = 1_000;
const MAX_RECORDING_STORAGE_HEALTH_TIMEOUT_MS = 20_000;
let recordingStorageUsageCache = {
  value: null,
  expiresAt: 0,
  promise: null,
};
let recordingStorageHealthCache = {
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

function getRecordingStorageHealthTtlMs() {
  const configured = parsePositiveInteger(
    process.env.LIVE_RECORDING_R2_HEALTH_TTL_MS
  );
  return Math.max(
    MIN_RECORDING_STORAGE_HEALTH_TTL_MS,
    configured || DEFAULT_RECORDING_STORAGE_HEALTH_TTL_MS
  );
}

function getRecordingStorageHealthTimeoutMs() {
  const configured = parsePositiveInteger(
    process.env.LIVE_RECORDING_R2_HEALTH_TIMEOUT_MS
  );
  return Math.max(
    MIN_RECORDING_STORAGE_HEALTH_TIMEOUT_MS,
    Math.min(
      MAX_RECORDING_STORAGE_HEALTH_TIMEOUT_MS,
      configured || DEFAULT_RECORDING_STORAGE_HEALTH_TIMEOUT_MS
    )
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

const recordingS3ClientCache = new Map();

function getConfiguredRecordingTargets() {
  return getRuntimeRecordingStorageTargetsSync();
}

function getAllConfiguredRecordingTargets() {
  return getLiveRecordingStorageTargetsConfigSync().targets || [];
}

function getRecordingStorageTargetInternal(storageTargetId = null) {
  const configuredRecordingTargets = getConfiguredRecordingTargets();
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
  return getRecordingS3ClientForTarget(target);
}

function getRecordingS3ClientForTarget(target) {
  const cacheKey = [
    target.id,
    target.endpoint,
    target.bucketName,
    target.accessKeyId,
    target.secretAccessKey,
  ].join("|");
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
  const configuredRecordingTargets = getConfiguredRecordingTargets();
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
  const configuredRecordingTargets = getConfiguredRecordingTargets();
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
  return getConfiguredRecordingTargets().length > 0;
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
  recordingStorageHealthCache = {
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

export function buildRecordingLiveHlsObjectKey({ recordingId, matchId }) {
  const prefix = buildRecordingPrefix({ recordingId, matchId });
  return `${prefix}/live.m3u8`;
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
  contentType = "application/json; charset=utf-8",
  cacheControl = "public, max-age=2, stale-while-revalidate=4",
}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);

  const command = new PutObjectCommand({
    Bucket: target.bucketName,
    Key: objectKey,
    ContentType: contentType,
    CacheControl: cacheControl,
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

export async function listRecordingMultipartUploads({
  storageTargetId = null,
  prefix = "",
  limit = null,
} = {}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);
  const normalizedPrefix = String(prefix || "").trim();
  const maxItems =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : null;

  const uploads = [];
  let keyMarker = undefined;
  let uploadIdMarker = undefined;
  let truncated = false;

  do {
    const response = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: target.bucketName,
        Prefix: normalizedPrefix || undefined,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
        MaxUploads: MAX_DELETE_OBJECTS_PER_REQUEST,
      })
    );

    for (const item of response?.Uploads || []) {
      const upload = {
        key: String(item?.Key || ""),
        uploadId: String(item?.UploadId || ""),
        initiatedAt: item?.Initiated || null,
      };
      if (!upload.key || !upload.uploadId) continue;

      uploads.push(upload);

      if (maxItems && uploads.length >= maxItems) {
        truncated = true;
        return {
          targetId: target.id,
          targetLabel: target.label,
          bucketName: target.bucketName,
          prefix: normalizedPrefix,
          truncated,
          uploadCount: uploads.length,
          uploads,
        };
      }
    }

    keyMarker =
      response?.IsTruncated && response?.NextKeyMarker
        ? response.NextKeyMarker
        : undefined;
    uploadIdMarker =
      response?.IsTruncated && response?.NextUploadIdMarker
        ? response.NextUploadIdMarker
        : undefined;
  } while (keyMarker || uploadIdMarker);

  return {
    targetId: target.id,
    targetLabel: target.label,
    bucketName: target.bucketName,
    prefix: normalizedPrefix,
    truncated,
    uploadCount: uploads.length,
    uploads,
  };
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
  prefix = "",
} = {}) {
  const configuredRecordingTargets = getConfiguredRecordingTargets();
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

    const capacityBytes = Number(target.capacityBytes) || null;
    const remainingBytes =
      capacityBytes != null ? Math.max(0, capacityBytes - targetUsedBytes) : null;
    const percentUsed =
      capacityBytes && capacityBytes > 0
        ? Math.max(0, Math.min(100, Math.round((targetUsedBytes / capacityBytes) * 100)))
        : null;

    targetSummaries.push({
      id: target.id,
      label: target.label,
      bucketName: target.bucketName,
      publicBaseUrl: target.publicBaseUrl || null,
      capacityBytes,
      usedBytes: targetUsedBytes,
      remainingBytes,
      percentUsed,
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

function buildUnprobeableRecordingStorageHealthTarget(
  target,
  message = "Missing endpoint, access key, secret key or bucket"
) {
  return {
    id: target.id,
    label: target.label,
    bucketName: target.bucketName || "",
    endpoint: target.endpoint || "",
    enabled: target.enabled !== false,
    probeable: false,
    alive: false,
    status: target.enabled === false ? "disabled" : "unprobeable",
    latencyMs: null,
    checkedAt: new Date(),
    message,
    errorCode: null,
  };
}

async function probeRecordingStorageTarget(target) {
  const hasRequiredFields = Boolean(
    asTrimmed(target?.endpoint) &&
      asTrimmed(target?.accessKeyId) &&
      asTrimmed(target?.secretAccessKey) &&
      asTrimmed(target?.bucketName)
  );

  if (!hasRequiredFields) {
    return buildUnprobeableRecordingStorageHealthTarget(target);
  }

  const client = getRecordingS3ClientForTarget(target);
  const timeoutMs = getRecordingStorageHealthTimeoutMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    await client.send(
      new ListObjectsV2Command({
        Bucket: target.bucketName,
        MaxKeys: 1,
      }),
      {
        abortSignal: controller.signal,
      }
    );

    return {
      id: target.id,
      label: target.label,
      bucketName: target.bucketName || "",
      endpoint: target.endpoint || "",
      enabled: target.enabled !== false,
      probeable: true,
      alive: true,
      status: "alive",
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date(),
      message: "R2 reachable",
      errorCode: null,
    };
  } catch (error) {
    const isTimeout =
      error?.name === "AbortError" ||
      error?.code === "AbortError" ||
      /abort/i.test(String(error?.message || ""));

    return {
      id: target.id,
      label: target.label,
      bucketName: target.bucketName || "",
      endpoint: target.endpoint || "",
      enabled: target.enabled !== false,
      probeable: true,
      alive: false,
      status: "dead",
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date(),
      message: isTimeout
        ? `Probe timeout after ${timeoutMs}ms`
        : String(error?.message || error || "Probe failed"),
      errorCode:
        error?.name ||
        error?.code ||
        error?.Code ||
        (isTimeout ? "AbortError" : "ProbeFailed"),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scanRecordingStorageHealthUncached() {
  const configuredTargets = getAllConfiguredRecordingTargets();
  const targets = await Promise.all(
    configuredTargets.map((target) => probeRecordingStorageTarget(target))
  );

  return {
    healthyTargetCount: targets.filter((target) => target.alive).length,
    deadTargetCount: targets.filter((target) => target.status === "dead").length,
    unprobeableTargetCount: targets.filter((target) => !target.probeable).length,
    targets,
    checkedAt: new Date(),
    source: "r2_probe",
  };
}

export async function getRecordingStorageUsageSummary({
  forceRefresh = false,
  prefix = "",
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

export async function getRecordingStorageHealthSummary({
  forceRefresh = false,
} = {}) {
  await getLiveRecordingStorageTargetsConfig();
  const configuredTargets = getAllConfiguredRecordingTargets();
  if (!configuredTargets.length) {
    return {
      healthyTargetCount: 0,
      deadTargetCount: 0,
      unprobeableTargetCount: 0,
      targets: [],
      checkedAt: new Date(),
      source: "unconfigured",
    };
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    recordingStorageHealthCache.value &&
    now < recordingStorageHealthCache.expiresAt
  ) {
    return recordingStorageHealthCache.value;
  }

  if (!forceRefresh && recordingStorageHealthCache.promise) {
    return recordingStorageHealthCache.promise;
  }

  const probePromise = scanRecordingStorageHealthUncached()
    .then((summary) => {
      recordingStorageHealthCache = {
        value: summary,
        expiresAt: Date.now() + getRecordingStorageHealthTtlMs(),
        promise: null,
      };
      return summary;
    })
    .catch((error) => {
      recordingStorageHealthCache = {
        value: null,
        expiresAt: 0,
        promise: null,
      };
      throw error;
    });

  recordingStorageHealthCache = {
    ...recordingStorageHealthCache,
    promise: probePromise,
  };

  return probePromise;
}

export async function listRecordingObjects({
  storageTargetId = null,
  prefix = "",
  limit = null,
} = {}) {
  const target = requireRecordingStorageTarget(storageTargetId);
  const client = getRecordingS3Client(target.id);
  const normalizedPrefix = String(prefix || "").trim();
  const maxItems =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : null;

  const objects = [];
  let totalBytes = 0;
  let continuationToken = undefined;
  let truncated = false;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: target.bucketName,
        Prefix: normalizedPrefix || undefined,
        ContinuationToken: continuationToken,
        MaxKeys: MAX_DELETE_OBJECTS_PER_REQUEST,
      })
    );

    for (const item of response?.Contents || []) {
      const object = {
        key: String(item?.Key || ""),
        sizeBytes: Number(item?.Size) || 0,
        lastModified: item?.LastModified || null,
        etag: item?.ETag ? String(item.ETag).replace(/^"+|"+$/g, "") : null,
      };
      if (!object.key) continue;

      objects.push(object);
      totalBytes += object.sizeBytes;

      if (maxItems && objects.length >= maxItems) {
        truncated = true;
        return {
          targetId: target.id,
          targetLabel: target.label,
          bucketName: target.bucketName,
          prefix: normalizedPrefix,
          truncated,
          objectCount: objects.length,
          totalBytes,
          objects,
        };
      }
    }

    continuationToken =
      response?.IsTruncated && response?.NextContinuationToken
        ? response.NextContinuationToken
        : undefined;
  } while (continuationToken);

  return {
    targetId: target.id,
    targetLabel: target.label,
    bucketName: target.bucketName,
    prefix: normalizedPrefix,
    truncated,
    objectCount: objects.length,
    totalBytes,
    objects,
  };
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
