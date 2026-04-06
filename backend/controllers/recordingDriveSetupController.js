import { google } from "googleapis";
import { getCfgStr, setCfg } from "../services/config.service.js";
import {
  getRecordingDriveSettings,
  getRecordingDriveRuntimeConfig,
  getRecordingDriveStatus,
} from "../services/driveRecordings.service.js";
import SystemSettings from "../models/systemSettingsModel.js";

const DRIVE_FILE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const LEGACY_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

function asTrimmed(value) {
  return String(value || "").trim();
}

function derivePickerAppId(clientId) {
  const match = asTrimmed(clientId).match(/^(\d+)-/);
  return match?.[1] || "";
}

async function getRecordingDriveOAuthScopes() {
  const settings = await getRecordingDriveSettings();
  return settings.useModernPickerFlow === false
    ? LEGACY_DRIVE_SCOPES
    : DRIVE_FILE_SCOPES;
}


async function makeRecordingDriveOAuth(req) {
  const [id, secret, redirect] = await Promise.all([
    getCfgStr("GOOGLE_CLIENT_DRIVE_ID", ""),
    getCfgStr("GOOGLE_CLIENT_DRIVE_SECRET", ""),
    getCfgStr("GOOGLE_REDIRECT_DRIVE_URI", ""),
  ]);

  if (!id || !secret || !redirect) {
    throw new Error(
      "Thiếu GOOGLE_CLIENT_DRIVE_ID / GOOGLE_CLIENT_DRIVE_SECRET / GOOGLE_REDIRECT_DRIVE_URI trong System Config cho Recording Drive",
    );
  }

  return new google.auth.OAuth2(id, secret, redirect);
}

export async function recordingDriveOAuthInit(req, res) {
  try {
    const oauth2 = await makeRecordingDriveOAuth(req);
    const who = encodeURIComponent(req.user?.email || "admin");
    const scopes = await getRecordingDriveOAuthScopes();
    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: scopes,
      state: who,
    });
    res.json({ authUrl });
  } catch (e) {
    res
      .status(400)
      .json({ message: e?.message || "Init Google Drive OAuth failed" });
  }
}

export async function recordingDriveOAuthCallback(req, res) {
  try {
    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.status(400).send("Missing code");
    }

    const who = req.query.state ? decodeURIComponent(req.query.state) : "admin";
    const oauth2 = await makeRecordingDriveOAuth(req);
    const { tokens } = await oauth2.getToken(code);

    if (!tokens?.refresh_token) {
      return res
        .status(400)
        .send(
          "Google không trả về refresh_token. Hãy Remove access rồi kết nối lại.",
        );
    }

    await setCfg({
      key: "GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN",
      value: tokens.refresh_token,
      isSecret: true,
      updatedBy: `oauth:${who}`,
    });

    oauth2.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });

    const drive = google.drive({ version: "v3", auth: oauth2 });
    const about = await drive.about
      .get({
        fields: "user(displayName,emailAddress)",
      })
      .catch(() => null);

    await setCfg({
      key: "GOOGLE_DRIVE_RECORDINGS_CONNECTED_EMAIL",
      value: about?.data?.user?.emailAddress || "",
      updatedBy: `oauth:${who}`,
    });
    await setCfg({
      key: "GOOGLE_DRIVE_RECORDINGS_CONNECTED_NAME",
      value: about?.data?.user?.displayName || "",
      updatedBy: `oauth:${who}`,
    });
    await setCfg({
      key: "GOOGLE_DRIVE_RECORDINGS_CONNECTED_AT",
      value: new Date().toISOString(),
      updatedBy: `oauth:${who}`,
    });

    await SystemSettings.findByIdAndUpdate(
      "system",
      {
        $set: {
          "recordingDrive.enabled": true,
          "recordingDrive.mode": "oauthUser",
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch(() => null);

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kết nối Google Drive</title>
  <style>
    body { font-family: "Inter", system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f8fafc; color: #0f172a; text-align: center; padding: 24px; box-sizing: border-box; }
    h3 { font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #1e293b; }
    p { font-size: 16px; color: #64748b; margin-bottom: 24px; }
    .btn { display: none; padding: 10px 20px; font-size: 14px; font-weight: 600; color: #fff; background-color: #3b82f6; border: none; border-radius: 8px; cursor: pointer; transition: background-color 0.2s; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.4); }
    .btn:hover { background-color: #2563eb; }
    .loader { border: 3px solid #e2e8f0; border-top: 3px solid #3b82f6; border-radius: 50%; width: 32px; height: 32px; animation: spin 1s linear infinite; margin-bottom: 20px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loader" id="loader"></div>
  <h3>Kết nối Google Drive thành công</h3>
  <p id="status-text">Cửa sổ này sẽ tự động đóng trong giây lát...</p>
  <button id="close-btn" class="btn" type="button">Đóng cửa sổ</button>
  <script>
    (function () {
      // Primary: use localStorage (works even when window.opener is destroyed by Brave/Chrome after OAuth redirects)
      function signalViaStorage() {
        try {
          localStorage.setItem("recording-drive-auth-done", JSON.stringify({ ok: true, t: Date.now() }));
        } catch (e) {}
      }

      // Secondary: try postMessage (works in browsers that preserve window.opener)
      function signalViaPostMessage() {
        try {
          if (window.opener && typeof window.opener.postMessage === "function") {
            window.opener.postMessage({ type: "recording-drive-auth-done", ok: true }, "*");
          }
        } catch (e) {}
      }

      function notifyParent() {
        signalViaStorage();
        signalViaPostMessage();
      }

      // Signal immediately
      notifyParent();

      // The parent window will close us. But also try self-close as backup.
      var attempts = 0;
      var timer = setInterval(function () {
        attempts++;
        notifyParent();
        // Try self-close
        try { window.close(); } catch (e) {}
        if (window.closed || attempts > 30) {
          clearInterval(timer);
        }
      }, 600);

      // After 3s show manual close button
      setTimeout(function () {
        if (window.closed) return;
        var btn = document.getElementById("close-btn");
        var loader = document.getElementById("loader");
        var statusText = document.getElementById("status-text");
        if (btn) btn.style.display = "inline-block";
        if (loader) loader.style.display = "none";
        if (statusText) statusText.textContent = "Kết nối thành công! Nếu cửa sổ không tự đóng, hãy bấm nút bên dưới hoặc đóng tab này.";
        if (btn) {
          btn.addEventListener("click", function () {
            notifyParent();
            try { window.close(); } catch (e) {}
            setTimeout(function () { window.location.href = "about:blank"; }, 500);
          });
        }
      }, 3000);
    })();
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    return res
      .status(500)
      .send(`<pre style="white-space:pre-wrap">${e?.message || e}</pre>`);
  }
}

export async function recordingDrivePickerSession(req, res) {
  try {
    const runtimeConfig = await getRecordingDriveRuntimeConfig();
    if (runtimeConfig.mode !== "oauthUser") {
      return res.status(400).json({
        message: "Recording Drive đang ở chế độ service account.",
      });
    }
    if (!runtimeConfig.refreshToken) {
      return res.status(400).json({
        message: "My Drive OAuth chưa kết nối.",
      });
    }
    if (runtimeConfig.useModernPickerFlow === false) {
      return res.status(400).json({
        message: "Đang dùng flow OAuth cũ. Bật flow mới để dùng Google Picker.",
      });
    }

    const oauth2 = await makeRecordingDriveOAuth(req);
    oauth2.setCredentials({
      refresh_token: runtimeConfig.refreshToken,
    });

    const accessTokenResponse = await oauth2.getAccessToken();
    const accessToken = asTrimmed(
      typeof accessTokenResponse === "string"
        ? accessTokenResponse
        : accessTokenResponse?.token ||
            accessTokenResponse?.res?.data?.access_token ||
            ""
    );

    if (!accessToken) {
      throw new Error("Không lấy được access token cho Google Picker.");
    }

    const pickerApiKey = asTrimmed(
      await getCfgStr(
        "GOOGLE_DRIVE_PICKER_API_KEY",
        process.env.GOOGLE_DRIVE_PICKER_API_KEY || ""
      )
    );
    if (!pickerApiKey) {
      throw new Error(
        "Thiếu GOOGLE_DRIVE_PICKER_API_KEY trong System Config hoặc ENV."
      );
    }

    const pickerAppId = asTrimmed(
      await getCfgStr(
        "GOOGLE_DRIVE_PICKER_APP_ID",
        process.env.GOOGLE_DRIVE_PICKER_APP_ID ||
          derivePickerAppId(runtimeConfig.clientId)
      )
    );
    if (!pickerAppId) {
      throw new Error(
        "Thiếu GOOGLE_DRIVE_PICKER_APP_ID trong System Config hoặc ENV."
      );
    }

    return res.json({
      accessToken,
      developerKey: pickerApiKey,
      appId: pickerAppId,
      folderId: runtimeConfig.folderId || "",
    });
  } catch (e) {
    return res.status(400).json({
      message: e?.message || "Get Google Picker session failed",
    });
  }
}

export async function getRecordingDriveOAuthStatus(_req, res) {
  const status = await getRecordingDriveStatus();
  return res.json(status);
}

export async function disconnectRecordingDriveOAuth(req, res) {
  try {
    const updatedBy = req.user?.email || "admin";
    let enc = "";
    try {
      enc = await getCfgStr("GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN", "");
    } catch (_) {
      enc = "";
    }

    if (enc) {
      try {
        const oauth2 = await makeRecordingDriveOAuth(req);
        await oauth2.revokeToken(enc).catch(() => {});
      } catch (_) {}
    }

    const clears = [
      ["GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN", "", true],
      ["GOOGLE_DRIVE_RECORDINGS_CONNECTED_EMAIL", "", false],
      ["GOOGLE_DRIVE_RECORDINGS_CONNECTED_NAME", "", false],
      ["GOOGLE_DRIVE_RECORDINGS_CONNECTED_AT", "", false],
    ];

    for (const [key, value, isSecret] of clears) {
      await setCfg({ key, value, isSecret, updatedBy }).catch(() => {});
    }

    return res.json({
      ok: 1,
      message: "Đã ngắt kết nối Google Drive recording",
    });
  } catch (e) {
    return res.status(500).json({
      message: e?.message || "Disconnect Google Drive recording failed",
    });
  }
}
