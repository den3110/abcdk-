import fs from "fs";
import { google } from "googleapis";
import SystemSettings from "../models/systemSettingsModel.js";
import { getCfgStr } from "./config.service.js";

const RECORDING_DRIVE_DEFAULTS = {
  enabled: true,
  mode: "serviceAccount",
  folderId: "",
  sharedDriveId: "",
};

function normalizePrivateKey(raw) {
  return String(raw || "")
    .replace(/\\n/g, "\n")
    .trim();
}

function normalizeDriveMode(value) {
  return String(value || "").trim() === "oauthUser" ? "oauthUser" : "serviceAccount";
}

function asTrimmed(value) {
  return String(value || "").trim();
}

function getEnvServiceAccountConfig() {
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

async function getSharedGoogleOAuthConfig() {
  const [clientId, clientSecret, redirectUrisCsv, refreshToken, connectedEmail, connectedAt] =
    await Promise.all([
      getCfgStr("GOOGLE_CLIENT_ID", ""),
      getCfgStr("GOOGLE_CLIENT_SECRET", ""),
      getCfgStr("GOOGLE_REDIRECT_URI", ""),
      getCfgStr("GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN", ""),
      getCfgStr("GOOGLE_DRIVE_RECORDINGS_CONNECTED_EMAIL", ""),
      getCfgStr("GOOGLE_DRIVE_RECORDINGS_CONNECTED_AT", ""),
    ]);

  const redirectUris = redirectUrisCsv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    clientId,
    clientSecret,
    redirectUris,
    refreshToken,
    connectedEmail,
    connectedAt,
  };
}

export async function getRecordingDriveSettings() {
  const doc = await SystemSettings.findById("system").lean().catch(() => null);
  const raw = doc?.recordingDrive || {};
  return {
    enabled:
      typeof raw.enabled === "boolean"
        ? raw.enabled
        : RECORDING_DRIVE_DEFAULTS.enabled,
    mode: normalizeDriveMode(raw.mode || RECORDING_DRIVE_DEFAULTS.mode),
    folderId: asTrimmed(raw.folderId),
    sharedDriveId: asTrimmed(raw.sharedDriveId),
  };
}

function pickResolvedFolderId(settings, envCfg) {
  return asTrimmed(settings.folderId || envCfg.folderId);
}

function pickResolvedSharedDriveId(settings, envCfg) {
  return asTrimmed(settings.sharedDriveId || envCfg.sharedDriveId);
}

export async function getRecordingDriveRuntimeConfig() {
  const settings = await getRecordingDriveSettings();
  const serviceAccount = getEnvServiceAccountConfig();
  const oauthUser = await getSharedGoogleOAuthConfig();
  const mode = normalizeDriveMode(settings.mode);

  if (mode === "oauthUser") {
    return {
      enabled: settings.enabled,
      mode,
      folderId: pickResolvedFolderId(settings, serviceAccount),
      sharedDriveId: "",
      clientId: asTrimmed(oauthUser.clientId),
      clientSecret: asTrimmed(oauthUser.clientSecret),
      redirectUris: oauthUser.redirectUris,
      refreshToken: asTrimmed(oauthUser.refreshToken),
      connectedEmail: asTrimmed(oauthUser.connectedEmail),
      connectedAt: asTrimmed(oauthUser.connectedAt),
    };
  }

  return {
    enabled: settings.enabled,
    mode,
    folderId: pickResolvedFolderId(settings, serviceAccount),
    sharedDriveId: pickResolvedSharedDriveId(settings, serviceAccount),
    serviceAccountEmail: asTrimmed(serviceAccount.serviceAccountEmail),
    privateKey: asTrimmed(serviceAccount.privateKey),
  };
}

function buildOAuthClient(runtimeConfig) {
  return new google.auth.OAuth2(
    runtimeConfig.clientId,
    runtimeConfig.clientSecret,
    runtimeConfig.redirectUris?.[0] || undefined
  );
}

async function buildDriveClient(runtimeConfig) {
  if (!runtimeConfig.enabled) {
    throw new Error("Google Drive recording output is disabled");
  }

  if (runtimeConfig.mode === "oauthUser") {
    if (!runtimeConfig.clientId || !runtimeConfig.clientSecret) {
      throw new Error("Google OAuth client is not configured");
    }
    if (!runtimeConfig.refreshToken) {
      throw new Error("My Drive OAuth chua ket noi");
    }
    if (!runtimeConfig.folderId) {
      throw new Error("Google Drive recording folder is not configured");
    }

    const auth = buildOAuthClient(runtimeConfig);
    auth.setCredentials({ refresh_token: runtimeConfig.refreshToken });
    return {
      drive: google.drive({ version: "v3", auth }),
      usingSharedDrive: false,
      driveAuthMode: "oauthUser",
    };
  }

  if (!runtimeConfig.serviceAccountEmail || !runtimeConfig.privateKey) {
    throw new Error("Google Drive service account is not configured");
  }
  if (!runtimeConfig.folderId) {
    throw new Error("Google Drive recording folder is not configured");
  }
  if (!runtimeConfig.sharedDriveId) {
    throw new Error("Mode service account yeu cau Shared Drive");
  }

  const auth = new google.auth.JWT({
    email: runtimeConfig.serviceAccountEmail,
    key: runtimeConfig.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return {
    drive: google.drive({ version: "v3", auth }),
    usingSharedDrive: true,
    driveAuthMode: "serviceAccount",
  };
}

function normalizeDriveError(error, runtimeConfig) {
  const message =
    error?.response?.data?.error?.message ||
    error?.errors?.[0]?.message ||
    error?.message ||
    String(error);

  if (/Service Accounts do not have storage quota/i.test(message)) {
    return new Error(
      "Service account khong the upload vao My Drive. Hay dung Shared Drive hoac chuyen sang My Drive OAuth."
    );
  }
  if (/File not found/i.test(message)) {
    return new Error("Folder dich khong truy cap duoc hoac khong ton tai.");
  }
  if (/invalid_grant/i.test(message)) {
    return new Error("My Drive OAuth het han hoac da bi revoke. Hay ket noi lai.");
  }
  if (
    runtimeConfig?.mode === "oauthUser" &&
    /Login Required|auth/i.test(message)
  ) {
    return new Error("My Drive OAuth chua ket noi hop le.");
  }

  return new Error(message);
}

async function validateDriveFolder(drive, runtimeConfig, usingSharedDrive) {
  const folderId = runtimeConfig.folderId;
  if (!folderId) {
    return {
      ok: false,
      message: "Folder dich chua duoc cau hinh",
      folder: null,
    };
  }

  try {
    const response = await drive.files.get({
      fileId: folderId,
      supportsAllDrives: usingSharedDrive,
      fields: "id,name,mimeType,driveId,parents",
    });
    return {
      ok: true,
      message: "",
      folder: response?.data || null,
    };
  } catch (error) {
    return {
      ok: false,
      message: normalizeDriveError(error, runtimeConfig).message,
      folder: null,
    };
  }
}

export async function getRecordingDriveStatus() {
  const runtimeConfig = await getRecordingDriveRuntimeConfig();
  const base = {
    enabled: runtimeConfig.enabled,
    mode: runtimeConfig.mode,
    folderId: runtimeConfig.folderId || "",
    sharedDriveId: runtimeConfig.sharedDriveId || "",
    connected: false,
    configured: false,
    ready: false,
    accountEmail: "",
    connectedAt: runtimeConfig.connectedAt || "",
    folderAccessible: false,
    folderName: "",
    message: "",
  };

  if (!runtimeConfig.enabled) {
    return {
      ...base,
      configured: false,
      ready: false,
      message: "Drive output dang tat",
    };
  }

  if (runtimeConfig.mode === "oauthUser") {
    const connected = Boolean(runtimeConfig.refreshToken);
    const configured = Boolean(
      connected &&
        runtimeConfig.clientId &&
        runtimeConfig.clientSecret &&
        runtimeConfig.folderId
    );

    if (!connected) {
      return {
        ...base,
        connected: false,
        configured,
        message: "My Drive OAuth chua ket noi",
      };
    }

    try {
      const { drive } = await buildDriveClient(runtimeConfig);
      const [about, folderCheck] = await Promise.all([
        drive.about.get({ fields: "user(displayName,emailAddress)" }),
        validateDriveFolder(drive, runtimeConfig, false),
      ]);

      return {
        ...base,
        connected: true,
        configured,
        ready: configured && folderCheck.ok,
        accountEmail:
          about?.data?.user?.emailAddress ||
          runtimeConfig.connectedEmail ||
          "",
        folderAccessible: folderCheck.ok,
        folderName: folderCheck.folder?.name || "",
        message: folderCheck.ok ? "My Drive OAuth da san sang" : folderCheck.message,
      };
    } catch (error) {
      return {
        ...base,
        connected: true,
        configured,
        ready: false,
        accountEmail: runtimeConfig.connectedEmail || "",
        message: normalizeDriveError(error, runtimeConfig).message,
      };
    }
  }

  const connected = Boolean(
    runtimeConfig.serviceAccountEmail && runtimeConfig.privateKey
  );
  const configured = Boolean(
    connected && runtimeConfig.folderId && runtimeConfig.sharedDriveId
  );

  if (!configured) {
    return {
      ...base,
      connected,
      configured,
      ready: false,
      accountEmail: runtimeConfig.serviceAccountEmail || "",
      message: runtimeConfig.sharedDriveId
        ? "Service account chua du cau hinh"
        : "Mode service account yeu cau Shared Drive",
    };
  }

  try {
    const { drive } = await buildDriveClient(runtimeConfig);
    const folderCheck = await validateDriveFolder(drive, runtimeConfig, true);
    return {
      ...base,
      connected,
      configured,
      ready: folderCheck.ok,
      accountEmail: runtimeConfig.serviceAccountEmail || "",
      folderAccessible: folderCheck.ok,
      folderName: folderCheck.folder?.name || "",
      message: folderCheck.ok
        ? "Service account + Shared Drive da san sang"
        : folderCheck.message,
    };
  } catch (error) {
    return {
      ...base,
      connected,
      configured,
      ready: false,
      accountEmail: runtimeConfig.serviceAccountEmail || "",
      message: normalizeDriveError(error, runtimeConfig).message,
    };
  }
}

export async function isRecordingDriveConfigured() {
  const status = await getRecordingDriveStatus();
  return Boolean(status.enabled && status.configured && status.ready);
}

export async function uploadRecordingToDrive({
  filePath,
  fileName,
  mimeType = "video/mp4",
}) {
  const runtimeConfig = await getRecordingDriveRuntimeConfig();
  const { drive, usingSharedDrive, driveAuthMode } = await buildDriveClient(runtimeConfig);

  const createResp = await drive.files
    .create({
      requestBody: {
        name: fileName,
        parents: [runtimeConfig.folderId],
      },
      media: {
        mimeType,
        body: fs.createReadStream(filePath),
      },
      supportsAllDrives: usingSharedDrive,
      fields: "id, webViewLink, webContentLink, size",
    })
    .catch((error) => {
      throw normalizeDriveError(error, runtimeConfig);
    });

  const fileId = createResp?.data?.id;
  if (!fileId) {
    throw new Error("Drive upload completed without returning a file id");
  }

  await drive.permissions
    .create({
      fileId,
      supportsAllDrives: usingSharedDrive,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    })
    .catch((error) => {
      throw normalizeDriveError(error, runtimeConfig);
    });

  return {
    fileId,
    rawUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
    previewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
    driveAuthMode,
  };
}
