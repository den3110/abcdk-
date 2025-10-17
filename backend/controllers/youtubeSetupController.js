// controllers/youtubeSetupController.js
import { google } from "googleapis";
import { getCfgStr, setCfg } from "../services/config.service.js";
import { encryptToken, decryptToken } from "../services/secret.service.js";

/** Chọn redirect_uri phù hợp theo host hiện tại từ GOOGLE_REDIRECT_URI (CSV) */
async function pickRedirectUriForHost(req) {
  const csv = await getCfgStr("GOOGLE_REDIRECT_URI", "");
  const list = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return "";

  // Lấy host thực tế (qua proxy)
  const host = (
    req.get("x-forwarded-host") ||
    req.get("host") ||
    ""
  ).toLowerCase();

  // Ưu tiên khớp host tuyệt đối
  for (const u of list) {
    try {
      const url = new URL(u);
      if (url.host.toLowerCase() === host) return u;
    } catch {}
  }
  // Fallback: nếu không match host → trả phần tử đầu tiên
  return list[0];
}

async function makeOAuth(req) {
  const [id, secret] = await Promise.all([
    getCfgStr("GOOGLE_CLIENT_ID", ""),
    getCfgStr("GOOGLE_CLIENT_SECRET", ""),
  ]);
  const redirect = await pickRedirectUriForHost(req);

  if (!id || !secret || !redirect) {
    throw new Error(
      "Thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI trong Config"
    );
  }
  return new google.auth.OAuth2(id, secret, redirect);
}

// Scopes tối thiểu để tạo stream + đọc
const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
];

/** GET /admin/youtube/init → trả authUrl để admin click login */
export async function ytInit(req, res) {
  try {
    const oauth2 = await makeOAuth(req);
    const who = encodeURIComponent(req.user?.email || "admin"); // biết ai bấm

    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // để chắc chắn trả refresh_token
      include_granted_scopes: true,
      scope: YT_SCOPES,
      state: who,
    });
    res.json({ authUrl });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
}

/** GET /oauth/google/youtube/callback?code=...
 *  Đổi code ↔ token, lưu YOUTUBE_REFRESH_TOKEN (mã hoá) + meta channel
 */
export async function ytCallback(req, res) {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");
    const who = req.query.state
      ? decodeURIComponent(req.query.state)
      : "unknown";

    const oauth2 = await makeOAuth(req);
    const { tokens } = await oauth2.getToken(code);

    if (tokens.expiry_date) {
      await setCfg({
        key: "YOUTUBE_ACCESS_EXPIRES_AT",
        value: new Date(tokens.expiry_date).toISOString(),
        isSecret: false,
        updatedBy: `oauth:${who}`,
      });
    }

    if (!tokens?.refresh_token) {
      // Người dùng đã cấp quyền trước đó → Google không trả refresh_token
      return res
        .status(400)
        .send(
          "Google không trả refresh_token. Vào https://myaccount.google.com/permissions → tìm app của bạn → Remove access, rồi authorize lại."
        );
    }

    await setCfg({
      key: "YOUTUBE_REFRESH_TOKEN",
      value: encryptToken(tokens.refresh_token),
      isSecret: true,
      updatedBy: `oauth:${who}`,
    });

    // lấy thông tin channel cho đẹp
    oauth2.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    const yt = google.youtube({ version: "v3", auth: oauth2 });
    const { data } = await yt.channels.list({
      part: ["id", "snippet"],
      mine: true,
      maxResults: 1,
    });
    const ch = data.items?.[0];
    if (ch?.id) {
      await setCfg({
        key: "YOUTUBE_CHANNEL_ID",
        value: ch.id,
        isSecret: false,
        updatedBy: `oauth:${who}`,
      });
      await setCfg({
        key: "YOUTUBE_CHANNEL_TITLE",
        value: ch.snippet?.title || "",
        isSecret: false,
        updatedBy: `oauth:${who}`,
      });
    }

    // Thông báo cho cửa sổ mở (opener) rồi tự đóng
    const html = `
<!doctype html><meta charset="utf-8" />
<body style="font-family:system-ui;padding:24px">
  <h3>✅ Lưu refresh token thành công</h3>
  <p>Bạn có thể đóng cửa sổ này.</p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: "yt-auth-done", ok: true }, location.origin);
      }
      setTimeout(() => window.close(), 600);
    } catch (e) {
      setTimeout(() => window.close(), 800);
    }
  </script>
</body>`;
    res.send(html);
  } catch (e) {
    res
      .status(500)
      .send(`<pre style="white-space:pre-wrap">${e?.message || e}</pre>`);
  }
}

/** GET /admin/youtube/stream-key
 *  Trả về RTMP(S) server + stream key. Tạo/lưu stream reusable nếu chưa có.
 */
export async function ytGetOrCreateStreamKey(req, res) {
  try {
    const enc = await getCfgStr("YOUTUBE_REFRESH_TOKEN", "");
    if (!enc) {
      return res.status(400).json({
        message: "Chưa có YOUTUBE_REFRESH_TOKEN. Hãy chạy bước OAuth trước.",
      });
    }

    const refresh_token = decryptToken(enc);
    const oauth2 = await makeOAuth(req);
    oauth2.setCredentials({ refresh_token });

    const yt = google.youtube({ version: "v3", auth: oauth2 });

    // 1) Nếu đã lưu stream id → cố gắng lấy lại
    let streamId = (await getCfgStr("YOUTUBE_REUSABLE_STREAM_ID", "")).trim();
    let stream = null;

    if (streamId) {
      const ret = await yt.liveStreams.list({
        id: [streamId],
        part: ["id", "cdn", "snippet", "contentDetails"],
      });
      stream = ret.data.items?.[0] || null;
      if (!stream) streamId = ""; // không tồn tại nữa
    }

    // 2) Nếu chưa có, thử tìm theo title
    if (!stream) {
      const desiredTitle =
        (await getCfgStr("YOUTUBE_STREAM_TITLE", ""))?.trim() ||
        "PickleTour Reusable";
      const list = await yt.liveStreams.list({
        part: ["id", "cdn", "snippet", "contentDetails"],
        mine: true,
        maxResults: 50,
      });
      stream =
        (list.data.items || []).find(
          (s) =>
            s.snippet?.title === desiredTitle && s.contentDetails?.isReusable
        ) || null;

      // 3) Nếu vẫn chưa có → tạo mới
      if (!stream) {
        const ins = await yt.liveStreams.insert({
          part: ["snippet", "cdn", "contentDetails"],
          requestBody: {
            snippet: { title: desiredTitle },
            cdn: {
              ingestionType: "rtmp",
              resolution: "variable",
              frameRate: "variable",
            },
            contentDetails: { isReusable: true },
          },
        });
        stream = ins.data;
      }

      // Lưu id
      if (stream?.id) {
        await setCfg({
          key: "YOUTUBE_REUSABLE_STREAM_ID",
          value: stream.id,
          isSecret: false,
          updatedBy: "system",
        });
      }
    }

    const ing = stream?.cdn?.ingestionInfo || {};
    const server = ing.ingestionAddress || ""; // ví dụ: rtmp://a.rtmp.youtube.com/live2
    const key = ing.streamName || "";
    const server_rtmps = server
      ? server.startsWith("rtmp://")
        ? server.replace("rtmp://", "rtmps://").replace(".rtmp.", ".rtmps.")
        : server // nếu YouTube đã trả sẵn rtmps
      : "";

    if (!server || !key) {
      return res
        .status(500)
        .json({ message: "Không lấy được ingestion info từ YouTube." });
    }

    res.json({
      stream_id: stream.id,
      server_url: server,
      server_url_secure: server_rtmps, // dùng cái này cho TLS
      stream_key: key,
      note: "Dán server_url_secure + stream_key vào encoder/OBS. Đây là stream key reusable.",
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

/** GET /admin/youtube/revoke — Revoke refresh token đang lưu */
// controllers/youtubeSetupController.js
export async function ytRevoke(req, res) {
  try {
    const updatedBy = req.user?.email || "admin";

    // Lấy refresh token (nếu có)
    let enc = "";
    try {
      enc = await getCfgStr("YOUTUBE_REFRESH_TOKEN", "");
    } catch {
      enc = "";
    }

    // Thử revoke với Google (best-effort, không bắt buộc)
    if (enc) {
      try {
        const refresh_token = decryptToken(enc);
        // Tránh rủi ro lib nội bộ gọi .get ở chỗ nào đó → gói try/catch riêng
        const oauth2 = await makeOAuth();
        // Hầu hết bản googleapis hỗ trợ chuỗi trực tiếp; nếu lỗi vẫn bỏ qua
        await oauth2.revokeToken(refresh_token).catch(() => {});
      } catch (e) {
        // Chỉ cảnh báo, KHÔNG fail request
        console.warn("[YT] revoke warn:", e?.message || e);
      }
    }

    // Dọn toàn bộ key YouTube (không chạm vào GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI)
    const clears = [
      ["YOUTUBE_REFRESH_TOKEN", "", true],
      ["YOUTUBE_CHANNEL_ID", "", false],
      ["YOUTUBE_CHANNEL_TITLE", "", false],
      ["YOUTUBE_REUSABLE_STREAM_ID", "", false],
      ["YOUTUBE_ACCESS_EXPIRES_AT", "", false],
    ];

    for (const [key, value, isSecret] of clears) {
      try {
        await setCfg({ key, value, isSecret, updatedBy });
      } catch (e) {
        console.warn("[CFG] clear warn:", key, e?.message || e);
      }
    }

    return res.json({
      ok: 1,
      message: "Đã ngắt kết nối & xoá cấu hình YouTube.",
      cleared: clears.map(([k]) => k),
    });
  } catch (e) {
    // Đảm bảo luôn trả message đơn giản, tránh vỡ do e undefined
    return res.status(500).json({ message: e?.message || "YT revoke failed" });
  }
}
