import fs from "fs";
import { pipeline } from "stream/promises";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const RECORDINGS_BUCKET =
  process.env.R2_RECORDINGS_BUCKET_NAME || process.env.R2_BUCKET_NAME;

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
