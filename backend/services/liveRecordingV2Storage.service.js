import fs from "fs";
import { pipeline } from "stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const RECORDINGS_BUCKET =
  process.env.R2_RECORDINGS_BUCKET_NAME || process.env.R2_BUCKET_NAME;
const DEFAULT_RECORDING_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

const r2Client =
  process.env.R2_ENDPOINT &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY
    ? new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      })
    : null;

export function isRecordingR2Configured() {
  return Boolean(r2Client && RECORDINGS_BUCKET);
}

export function getRecordingBucketName() {
  if (!RECORDINGS_BUCKET) {
    throw new Error("Recording bucket is not configured");
  }
  return RECORDINGS_BUCKET;
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

export async function createRecordingSegmentUploadUrl({
  objectKey,
  contentType = "video/mp4",
  expiresInSeconds = 60 * 20,
}) {
  if (!isRecordingR2Configured()) {
    throw new Error("Recording R2 storage is not configured");
  }

  const command = new PutObjectCommand({
    Bucket: getRecordingBucketName(),
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, {
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
}) {
  if (!isRecordingR2Configured()) {
    throw new Error("Recording R2 storage is not configured");
  }

  const command = new CreateMultipartUploadCommand({
    Bucket: getRecordingBucketName(),
    Key: objectKey,
    ContentType: contentType,
  });
  const response = await r2Client.send(command);
  if (!response.UploadId) {
    throw new Error("R2 did not return multipart upload id");
  }

  return {
    uploadId: response.UploadId,
    objectKey,
    partSizeBytes: getRecordingMultipartPartSizeBytes(),
    contentType,
  };
}

export async function createRecordingMultipartUploadPartUrl({
  objectKey,
  uploadId,
  partNumber,
  expiresInSeconds = 60 * 20,
}) {
  if (!isRecordingR2Configured()) {
    throw new Error("Recording R2 storage is not configured");
  }
  if (!uploadId) {
    throw new Error("uploadId is required for multipart upload");
  }
  if (!Number.isInteger(partNumber) || partNumber <= 0) {
    throw new Error("partNumber must be >= 1");
  }

  const command = new UploadPartCommand({
    Bucket: getRecordingBucketName(),
    Key: objectKey,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, {
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
  };
}

export async function completeRecordingMultipartUpload({
  objectKey,
  uploadId,
  parts = [],
}) {
  if (!isRecordingR2Configured()) {
    throw new Error("Recording R2 storage is not configured");
  }
  if (!uploadId) {
    throw new Error("uploadId is required for multipart completion");
  }

  const normalizedParts = (parts || [])
    .map((part) => ({
      PartNumber: Number(part.partNumber),
      ETag: String(part.etag || "").trim(),
    }))
    .filter((part) => Number.isInteger(part.PartNumber) && part.PartNumber > 0 && part.ETag)
    .sort((a, b) => a.PartNumber - b.PartNumber);

  if (!normalizedParts.length) {
    throw new Error("Multipart completion requires at least one uploaded part");
  }

  await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: getRecordingBucketName(),
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
}) {
  if (!isRecordingR2Configured()) {
    throw new Error("Recording R2 storage is not configured");
  }
  if (!uploadId) return false;

  await r2Client.send(
    new AbortMultipartUploadCommand({
      Bucket: getRecordingBucketName(),
      Key: objectKey,
      UploadId: uploadId,
    })
  );

  return true;
}

export async function putRecordingManifest({
  objectKey,
  manifest,
}) {
  if (!isRecordingR2Configured()) {
    throw new Error("Recording R2 storage is not configured");
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: getRecordingBucketName(),
      Key: objectKey,
      Body: JSON.stringify(manifest),
      ContentType: "application/json",
    })
  );

  return objectKey;
}

export async function downloadRecordingObjectToFile({
  objectKey,
  targetPath,
}) {
  if (!isRecordingR2Configured()) {
    throw new Error("Recording R2 storage is not configured");
  }

  const response = await r2Client.send(
    new GetObjectCommand({
      Bucket: getRecordingBucketName(),
      Key: objectKey,
    })
  );

  if (!response.Body) {
    throw new Error(`Recording object ${objectKey} has no body`);
  }

  await pipeline(response.Body, fs.createWriteStream(targetPath));
  return targetPath;
}

export async function deleteRecordingObjects(objectKeys = []) {
  const keys = (objectKeys || []).filter(Boolean).map((Key) => ({ Key }));
  if (!keys.length || !isRecordingR2Configured()) return;

  await r2Client.send(
    new DeleteObjectsCommand({
      Bucket: getRecordingBucketName(),
      Delete: {
        Objects: keys,
        Quiet: true,
      },
    })
  );
}
