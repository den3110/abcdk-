import fs from "fs";
import { google } from "googleapis";
import SystemSettings from "../models/systemSettingsModel.js";
import { getCfgStr, setCfg } from "./config.service.js";
import { decryptToken } from "./secret.service.js";

const RECORDING_DRIVE_DEFAULTS = {
  enabled: true,
  mode: "serviceAccount",
  useModernPickerFlow: true,
  folderId: "",
  sharedDriveId: "",
};
const SERVICE_ACCOUNT_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

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

async function getRecordingDriveRefreshTokenState() {
  const fromCfg = asTrimmed(
    await getCfgStr("GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN", "")
  );

  if (!fromCfg) {
    return {
      refreshToken: "",
      normalized: false,
      malformed: false,
    };
  }

  let extraDecrypted = "";
  try {
    const maybePlain = decryptToken(fromCfg);
    if (maybePlain && maybePlain !== fromCfg) {
      extraDecrypted = asTrimmed(maybePlain);
    }
  } catch (_) {}

  if (!extraDecrypted) {
    return {
      refreshToken: fromCfg,
      normalized: false,
      malformed: false,
    };
  }

  try {
    await setCfg({
      key: "GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN",
      value: extraDecrypted,
      isSecret: true,
      updatedBy: "autofix",
    });
    console.info(
      "[RecordingDrive][token] normalized stored refresh token to plaintext contract."
    );
  } catch (error) {
    console.warn(
      "[RecordingDrive][token] normalize writeback failed (non-fatal):",
      error?.message || error
    );
  }

  return {
    refreshToken: extraDecrypted,
    normalized: true,
    malformed: false,
  };
}

async function getSharedGoogleOAuthConfig() {
  const [
    configClientId,
    configClientSecret,
    configRedirectUri,
    refreshTokenState,
    connectedEmail,
    connectedAt,
  ] = await Promise.all([
    getCfgStr("GOOGLE_CLIENT_DRIVE_ID", ""),
    getCfgStr("GOOGLE_CLIENT_DRIVE_SECRET", ""),
    getCfgStr("GOOGLE_REDIRECT_DRIVE_URI", ""),
    getRecordingDriveRefreshTokenState(),
    getCfgStr("GOOGLE_DRIVE_RECORDINGS_CONNECTED_EMAIL", ""),
    getCfgStr("GOOGLE_DRIVE_RECORDINGS_CONNECTED_AT", ""),
  ]);

  const clientId = asTrimmed(configClientId);
  const clientSecret = asTrimmed(configClientSecret);
  const redirectUrisCsv = asTrimmed(configRedirectUri);

  const redirectUris = redirectUrisCsv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    clientId,
    clientSecret,
    redirectUris,
    refreshToken: refreshTokenState.refreshToken,
    refreshTokenNormalized: !!refreshTokenState.normalized,
    refreshTokenMalformed: !!refreshTokenState.malformed,
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
    useModernPickerFlow:
      typeof raw.useModernPickerFlow === "boolean"
        ? raw.useModernPickerFlow
        : RECORDING_DRIVE_DEFAULTS.useModernPickerFlow,
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
      useModernPickerFlow: settings.useModernPickerFlow !== false,
      folderId: asTrimmed(settings.folderId),
      sharedDriveId: "",
      clientId: asTrimmed(oauthUser.clientId),
      clientSecret: asTrimmed(oauthUser.clientSecret),
      redirectUris: oauthUser.redirectUris,
      refreshToken: asTrimmed(oauthUser.refreshToken),
      refreshTokenNormalized: !!oauthUser.refreshTokenNormalized,
      refreshTokenMalformed: !!oauthUser.refreshTokenMalformed,
      connectedEmail: asTrimmed(oauthUser.connectedEmail),
      connectedAt: asTrimmed(oauthUser.connectedAt),
    };
  }

  return {
    enabled: settings.enabled,
    mode,
    useModernPickerFlow: settings.useModernPickerFlow !== false,
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

async function buildDriveClient(
  runtimeConfig,
  { requireFolderId = true, requireSharedDriveId = true } = {}
) {
  if (!runtimeConfig.enabled) {
    throw new Error("Google Drive recording output is disabled");
  }

  if (runtimeConfig.mode === "oauthUser") {
    if (!runtimeConfig.clientId || !runtimeConfig.clientSecret) {
      throw new Error(
        "Thi?u GOOGLE_CLIENT_DRIVE_ID / GOOGLE_CLIENT_DRIVE_SECRET trong System Config"
      );
    }
    if (!runtimeConfig.refreshToken) {
      throw new Error("My Drive OAuth chưa kết nối");
    }
    if (!runtimeConfig.redirectUris?.length) {
      throw new Error("Thi?u GOOGLE_REDIRECT_DRIVE_URI trong System Config");
    }
    if (requireFolderId && !runtimeConfig.folderId) {
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
  if (requireFolderId && !runtimeConfig.folderId) {
    throw new Error("Google Drive recording folder is not configured");
  }
  if (requireSharedDriveId && !runtimeConfig.sharedDriveId) {
    throw new Error("Mode service account yeu cau Shared Drive");
  }

  const auth = new google.auth.JWT({
    email: runtimeConfig.serviceAccountEmail,
    key: runtimeConfig.privateKey,
    scopes: [SERVICE_ACCOUNT_DRIVE_SCOPE],
  });

  return {
    drive: google.drive({ version: "v3", auth }),
    usingSharedDrive: true,
    driveAuthMode: "serviceAccount",
  };
}

function normalizeDriveError(error, runtimeConfig) {
  const reason = String(
    error?.response?.data?.error?.errors?.[0]?.reason ||
      error?.errors?.[0]?.reason ||
      ""
  ).trim();
  const message =
    error?.response?.data?.error?.message ||
    error?.errors?.[0]?.message ||
    error?.message ||
    String(error);

  if (/Service Accounts do not have storage quota/i.test(message)) {
    return new Error(
      "Service account không thể upload vào My Drive. Hãy dùng Shared Drive hoặc chuyển sang My Drive OAuth."
    );
  }
  if (/File not found/i.test(message)) {
    return new Error("Folder ??ch kh?ng truy c?p ???c ho?c kh?ng t?n t?i.");
  }
  if (
    reason === "appNotAuthorizedToFile" ||
    /not granted the app .*access to the file/i.test(message)
  ) {
    return new Error(
      runtimeConfig?.useModernPickerFlow === false
        ? "Folder hi?n t?i kh?ng truy c?p ???c b?ng flow OAuth c?. H?y k?t n?i l?i ho?c chuy?n sang flow m?i."
        : "Folder hi?n t?i ch?a ???c c?p quy?n cho app Recording Drive. H?y ch?n l?i ??ng folder b?ng Google Picker."
    );
  }
  if (/invalid_grant/i.test(message)) {
    if (runtimeConfig?.refreshTokenMalformed) {
      return new Error(
        "Refresh token Recording Drive l?u sai ??nh d?ng. H?y k?t n?i l?i."
      );
    }
    return new Error("My Drive OAuth hết hạn hoặc đã bị revoke. Hãy kết nối lại.");
  }
  if (
    runtimeConfig?.mode === "oauthUser" &&
    /Login Required|auth/i.test(message)
  ) {
    return new Error("My Drive OAuth chưa kết nối hợp lệ.");
  }

  return new Error(message);
}

async function validateDriveFolder(drive, runtimeConfig, usingSharedDrive) {
  const folderId = runtimeConfig.folderId;
  if (!folderId) {
    return {
      ok: false,
      message: "Folder ??ch ch?a ???c c?u h?nh",
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
    useModernPickerFlow: runtimeConfig.useModernPickerFlow !== false,
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
      message: "Drive output ?ang t?t",
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
        message: "My Drive OAuth chưa kết nối",
      };
    }

    if (!runtimeConfig.folderId) {
      return {
        ...base,
        connected: true,
        configured: false,
        ready: false,
        accountEmail: runtimeConfig.connectedEmail || "",
        message:
          runtimeConfig.useModernPickerFlow === false
            ? "My Drive OAuth ?? k?t n?i. H?y nh?p Folder ID r?i l?u."
            : "My Drive OAuth ?? k?t n?i. H?y ch?n ??ng folder b?ng Google Picker.",
      };
    }

    try {
      const { drive } = await buildDriveClient(
        runtimeConfig,
        { requireFolderId: false, requireSharedDriveId: false }
      );
      const [about, folderCheck] = await Promise.all([
        drive.about
          .get({ fields: "user(displayName,emailAddress)" })
          .catch(() => null),
        validateDriveFolder(drive, runtimeConfig, false),
      ]);

      return {
        ...base,
        folderId: runtimeConfig.folderId || "",
        connected: true,
        configured,
        ready: configured && folderCheck.ok,
        accountEmail:
          about?.data?.user?.emailAddress ||
          runtimeConfig.connectedEmail ||
          "",
        folderAccessible: folderCheck.ok,
        folderName: folderCheck.folder?.name || "",
        message: folderCheck.ok ? "My Drive OAuth đã sẵn sàng" : folderCheck.message,
      };
    } catch (error) {
      return {
        ...base,
        folderId: runtimeConfig.folderId || "",
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
        ? "Service account ch?a ?? c?u h?nh"
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
        ? "Service account + Shared Drive ?? s?n s?ng"
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

async function requestRecordingDriveMedia(fileId, { rangeHeader = "" } = {}) {
  const runtimeConfig = await getRecordingDriveRuntimeConfig();
  const { drive, usingSharedDrive, driveAuthMode } = await buildDriveClient(runtimeConfig, {
    requireFolderId: false,
    requireSharedDriveId: false,
  });

  const headers = {};
  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  try {
    const response = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: usingSharedDrive,
        acknowledgeAbuse: true,
      },
      {
        responseType: "stream",
        headers,
      }
    );

    return {
      response,
      driveAuthMode,
    };
  } catch (error) {
    throw normalizeDriveError(error, runtimeConfig);
  }
}

export async function streamRecordingDriveFile({ fileId, rangeHeader = "" }) {
  return requestRecordingDriveMedia(fileId, { rangeHeader });
}

export async function probeRecordingDriveFile(fileId) {
  const { response, driveAuthMode } = await requestRecordingDriveMedia(fileId, {
    rangeHeader: "bytes=0-0",
  });
  const headers = response?.headers || {};

  try {
    response?.data?.destroy?.();
  } catch (_) {}

  return {
    ready: true,
    driveAuthMode,
    statusCode: Number(response?.status) || 200,
    contentType: String(headers["content-type"] || "video/mp4"),
    contentLength: headers["content-length"] || null,
    contentRange: headers["content-range"] || null,
    acceptRanges: headers["accept-ranges"] || "bytes",
    checkedAt: new Date().toISOString(),
  };
}

function normalizeDriveFileMetadata(data = {}) {
  const parents = Array.isArray(data?.parents)
    ? data.parents.map((value) => asTrimmed(value)).filter(Boolean)
    : [];

  return {
    id: asTrimmed(data?.id) || null,
    name: asTrimmed(data?.name) || null,
    mimeType: asTrimmed(data?.mimeType) || null,
    driveId: asTrimmed(data?.driveId) || null,
    parents,
    parentId: parents[0] || null,
    trashed: Boolean(data?.trashed),
    size: data?.size != null ? String(data.size) : null,
    modifiedTime: data?.modifiedTime || null,
    webViewLink: asTrimmed(data?.webViewLink) || null,
    webContentLink: asTrimmed(data?.webContentLink) || null,
  };
}

async function getRecordingDriveAdminClient() {
  const runtimeConfig = await getRecordingDriveRuntimeConfig();
  const { drive, usingSharedDrive, driveAuthMode } = await buildDriveClient(
    runtimeConfig,
    {
      requireFolderId: false,
      requireSharedDriveId: false,
    }
  );

  return {
    runtimeConfig,
    drive,
    usingSharedDrive,
    driveAuthMode,
  };
}

async function requestRecordingDriveFileMetadata(fileId) {
  const normalizedFileId = asTrimmed(fileId);
  if (!normalizedFileId) {
    throw new Error("Drive file id is required");
  }

  const { runtimeConfig, drive, usingSharedDrive, driveAuthMode } =
    await getRecordingDriveAdminClient();

  try {
    const response = await drive.files.get({
      fileId: normalizedFileId,
      supportsAllDrives: usingSharedDrive,
      fields:
        "id,name,mimeType,driveId,parents,trashed,size,modifiedTime,webViewLink,webContentLink",
    });

    return {
      file: normalizeDriveFileMetadata(response?.data || {}),
      driveAuthMode,
    };
  } catch (error) {
    throw normalizeDriveError(error, runtimeConfig);
  }
}

export async function getRecordingDriveFileMetadata(fileId) {
  return requestRecordingDriveFileMetadata(fileId);
}

export async function renameRecordingDriveFile({ fileId, name }) {
  const normalizedFileId = asTrimmed(fileId);
  const normalizedName = asTrimmed(name);
  if (!normalizedFileId) {
    throw new Error("Drive file id is required");
  }
  if (!normalizedName) {
    throw new Error("Drive file name is required");
  }

  const { runtimeConfig, drive, usingSharedDrive, driveAuthMode } =
    await getRecordingDriveAdminClient();

  try {
    const response = await drive.files.update({
      fileId: normalizedFileId,
      supportsAllDrives: usingSharedDrive,
      requestBody: {
        name: normalizedName,
      },
      fields:
        "id,name,mimeType,driveId,parents,trashed,size,modifiedTime,webViewLink,webContentLink",
    });

    return {
      file: normalizeDriveFileMetadata(response?.data || {}),
      driveAuthMode,
    };
  } catch (error) {
    throw normalizeDriveError(error, runtimeConfig);
  }
}

export async function moveRecordingDriveFile({ fileId, folderId = "" }) {
  const normalizedFileId = asTrimmed(fileId);
  if (!normalizedFileId) {
    throw new Error("Drive file id is required");
  }

  const { runtimeConfig, drive, usingSharedDrive, driveAuthMode } =
    await getRecordingDriveAdminClient();
  const targetFolderId = asTrimmed(folderId || runtimeConfig.folderId);
  if (!targetFolderId) {
    throw new Error("Target folder id is required");
  }

  try {
    const current = await drive.files.get({
      fileId: normalizedFileId,
      supportsAllDrives: usingSharedDrive,
      fields: "id,name,parents,driveId,trashed",
    });
    const folder = await drive.files.get({
      fileId: targetFolderId,
      supportsAllDrives: usingSharedDrive,
      fields: "id,name,mimeType,driveId,parents",
    });

    const currentParents = Array.isArray(current?.data?.parents)
      ? current.data.parents.map((value) => asTrimmed(value)).filter(Boolean)
      : [];
    const removeParents = currentParents
      .filter((parentId) => parentId !== targetFolderId)
      .join(",");

    const response = await drive.files.update({
      fileId: normalizedFileId,
      supportsAllDrives: usingSharedDrive,
      addParents: targetFolderId,
      removeParents: removeParents || undefined,
      fields:
        "id,name,mimeType,driveId,parents,trashed,size,modifiedTime,webViewLink,webContentLink",
    });

    return {
      file: normalizeDriveFileMetadata(response?.data || {}),
      targetFolder: normalizeDriveFileMetadata(folder?.data || {}),
      driveAuthMode,
    };
  } catch (error) {
    throw normalizeDriveError(error, runtimeConfig);
  }
}

export async function deleteRecordingDriveFile(fileId) {
  const normalizedFileId = asTrimmed(fileId);
  if (!normalizedFileId) {
    throw new Error("Drive file id is required");
  }

  const { runtimeConfig, drive, usingSharedDrive, driveAuthMode } =
    await getRecordingDriveAdminClient();

  try {
    await drive.files.delete({
      fileId: normalizedFileId,
      supportsAllDrives: usingSharedDrive,
    });

    return {
      file: {
        id: normalizedFileId,
        deleted: true,
      },
      driveAuthMode,
    };
  } catch (error) {
    throw normalizeDriveError(error, runtimeConfig);
  }
}

export async function uploadRecordingToDrive({
  filePath,
  fileName,
  mimeType = "video/mp4",
}) {
  const runtimeConfig = await getRecordingDriveRuntimeConfig();
  const { drive, usingSharedDrive, driveAuthMode } = await buildDriveClient(
    runtimeConfig
  );

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
