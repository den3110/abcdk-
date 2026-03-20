import { google } from "googleapis";
import { getCfgStr, setCfg } from "../services/config.service.js";
import { getRecordingDriveStatus } from "../services/driveRecordings.service.js";
import SystemSettings from "../models/systemSettingsModel.js";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];


async function makeRecordingDriveOAuth(req) {
  const [id, secret, redirect] = await Promise.all([
    getCfgStr("GOOGLE_CLIENT_DRIVE_ID", ""),
    getCfgStr("GOOGLE_CLIENT_DRIVE_SECRET", ""),
    getCfgStr("GOOGLE_REDIRECT_DRIVE_URI", ""),
  ]);

  if (!id || !secret || !redirect) {
    throw new Error(
      "Thieu GOOGLE_CLIENT_DRIVE_ID / GOOGLE_CLIENT_DRIVE_SECRET / GOOGLE_REDIRECT_DRIVE_URI trong System Config cho recording drive",
    );
  }

  return new google.auth.OAuth2(id, secret, redirect);
}

export async function recordingDriveOAuthInit(req, res) {
  try {
    const oauth2 = await makeRecordingDriveOAuth(req);
    const who = encodeURIComponent(req.user?.email || "admin");
    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: DRIVE_SCOPES,
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
          "Google khong tra refresh_token. Hay Remove access roi ket noi lai.",
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
    const about = await drive.about.get({
      fields: "user(displayName,emailAddress)",
    });

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

    const html = `
<!doctype html><meta charset="utf-8" />
<body style="font-family:system-ui;padding:24px">
  <h3>Ket noi Google Drive recording thanh cong</h3>
  <p>Ban co the dong cua so nay.</p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: "recording-drive-auth-done", ok: true }, location.origin);
      }
      setTimeout(() => window.close(), 600);
    } catch (e) {
      setTimeout(() => window.close(), 800);
    }
  </script>
</body>`;
    return res.send(html);
  } catch (e) {
    return res
      .status(500)
      .send(`<pre style="white-space:pre-wrap">${e?.message || e}</pre>`);
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
      message: "Da ngat ket noi Google Drive recording",
    });
  } catch (e) {
    return res.status(500).json({
      message: e?.message || "Disconnect Google Drive recording failed",
    });
  }
}
