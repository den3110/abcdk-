import fs from "fs";
import { google } from "googleapis";

function normalizePrivateKey(raw) {
  return String(raw || "")
    .replace(/\\n/g, "\n")
    .trim();
}

export function getRecordingDriveConfig() {
  return {
    serviceAccountEmail:
      process.env.GOOGLE_DRIVE_RECORDINGS_SERVICE_ACCOUNT_EMAIL || "",
    privateKey: normalizePrivateKey(
      process.env.GOOGLE_DRIVE_RECORDINGS_PRIVATE_KEY || ""
    ),
    sharedDriveId: process.env.GOOGLE_DRIVE_RECORDINGS_SHARED_DRIVE_ID || "",
    folderId: process.env.GOOGLE_DRIVE_RECORDINGS_FOLDER_ID || "",
  };
}

export function isRecordingDriveConfigured() {
  const cfg = getRecordingDriveConfig();
  return Boolean(cfg.serviceAccountEmail && cfg.privateKey && cfg.folderId);
}

function getDriveClient() {
  const cfg = getRecordingDriveConfig();
  if (!isRecordingDriveConfigured()) {
    throw new Error("Google Drive recording destination is not configured");
  }

  const auth = new google.auth.JWT({
    email: cfg.serviceAccountEmail,
    key: cfg.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return {
    drive: google.drive({ version: "v3", auth }),
    cfg,
  };
}

export async function uploadRecordingToDrive({
  filePath,
  fileName,
  mimeType = "video/mp4",
}) {
  const { drive, cfg } = getDriveClient();

  const usingSharedDrive = Boolean(cfg.sharedDriveId);
  const createResp = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [cfg.folderId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    supportsAllDrives: usingSharedDrive,
    fields: "id, webViewLink, webContentLink, size",
  });

  const fileId = createResp?.data?.id;
  if (!fileId) {
    throw new Error("Drive upload completed without returning a file id");
  }

  await drive.permissions.create({
    fileId,
    supportsAllDrives: usingSharedDrive,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return {
    fileId,
    rawUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
    previewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
  };
}
