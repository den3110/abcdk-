// services/liveProviders/youtube.js
import { LiveProvider } from "./base.js";
import { google } from "googleapis";
import { getCfgStr, setCfg } from "../config.service.js";

const MASK = (s, head = 6, tail = 6) =>
  typeof s === "string" && s.length > head + tail
    ? `${s.slice(0, head)}…${s.slice(-tail)}`
    : s || null;

// --------------------------------- helpers ------------------------------------
async function importDecrypt() {
  try {
    // path từ liveProviders -> services
    const mod = await import("../secret.service.js");
    if (typeof mod.decryptToken === "function") return mod.decryptToken;
  } catch {}
  return null;
}

function dedup(arr) {
  const out = [];
  for (const v of arr) {
    if (!v) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function splitCsv(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ----------------------- build candidates (client/redirect) --------------------
async function getClientCreds(override) {
  const clientId = (
    override?.clientId ?? (await getCfgStr("GOOGLE_CLIENT_ID", ""))
  ).trim();
  const clientSecret = (
    override?.clientSecret ?? (await getCfgStr("GOOGLE_CLIENT_SECRET", ""))
  ).trim();
  if (!clientId || !clientSecret) {
    throw new Error("Thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.");
  }
  return { clientId, clientSecret };
}

async function getRedirectCandidates(override) {
  // controller của bạn chọn redirect theo host; service không có req → thử tất cả URI trong CSV
  const overrideOne = override?.redirectUri ? [override.redirectUri] : [];
  const csv = await getCfgStr("GOOGLE_REDIRECT_URI", "");
  const fromCsv = splitCsv(csv);
  const candidates = dedup([...overrideOne, ...fromCsv]);
  if (candidates.length === 0) {
    throw new Error("Thiếu GOOGLE_REDIRECT_URI.");
  }
  return candidates;
}

async function getTokenCandidates(cred) {
  const fromProvider = cred?.refreshToken || cred?.cred?.refreshToken || "";
  const fromCfg = (await getCfgStr("YOUTUBE_REFRESH_TOKEN", "")).trim();
  const decryptToken = await importDecrypt();

  // nếu DB đang double-encrypt: getCfgStr trả encrypt(rt) → decrypt thêm 1 lần
  let extraDecrypted = "";
  if (decryptToken && fromCfg) {
    try {
      const maybePlain = decryptToken(fromCfg);
      if (maybePlain && maybePlain !== fromCfg) {
        extraDecrypted = maybePlain;
      }
    } catch {}
  }

  const list = dedup([fromProvider, extraDecrypted, fromCfg]);
  if (list.length === 0) throw new Error("Chưa có YOUTUBE_REFRESH_TOKEN.");
  return {
    tokens: list,
    tokenMeta: {
      fromProvider: !!fromProvider,
      hasExtraDecrypted: !!extraDecrypted,
    },
  };
}

// ------------------------------ preflight OAuth --------------------------------
async function tryPreflight({
  clientId,
  clientSecret,
  redirectUri,
  refreshToken,
}) {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({ refresh_token: refreshToken });
  await oauth2.getRequestHeaders(); // trigger refresh; throw nếu invalid_grant
  return oauth2;
}

async function getOAuthReady(cred) {
  const override = cred?.oauthOverride || null;
  const { clientId, clientSecret } = await getClientCreds(override);
  const redirects = await getRedirectCandidates(override);
  const { tokens, tokenMeta } = await getTokenCandidates(cred);

  const errors = [];
  for (const rt of tokens) {
    for (const ru of redirects) {
      try {
        const oauth2 = await tryPreflight({
          clientId,
          clientSecret,
          redirectUri: ru,
          refreshToken: rt,
        });
        console.info("[YT][oauth] preflight OK", {
          clientId: MASK(clientId),
          redirectUri: ru,
          tokenPreview: MASK(rt, 8, 8),
          source: tokenMeta.fromProvider
            ? "provider"
            : tokenMeta.hasExtraDecrypted
            ? "config.double-decrypted"
            : "config",
        });

        // Nếu dùng token extra-decrypted → normalize lưu lại dạng chuẩn (plaintext → setCfg sẽ mã hoá)
        if (
          tokenMeta.hasExtraDecrypted &&
          rt !== (await getCfgStr("YOUTUBE_REFRESH_TOKEN", "")).trim()
        ) {
          try {
            await setCfg({
              key: "YOUTUBE_REFRESH_TOKEN",
              value: rt,
              isSecret: true,
              updatedBy: "autofix",
            });
            console.info(
              "[YT][token] normalized stored RT to plaintext (service will encrypt)."
            );
          } catch (w) {
            console.warn(
              "[YT][token] normalize writeback failed (non-fatal):",
              w?.message || w
            );
          }
        }

        return { oauth2, clientId, redirectUri: ru }; // success
      } catch (e) {
        const pe = e?.response?.data || e?.errors || e?.message || String(e);
        errors.push({
          redirectUri: ru,
          tokenPreview: MASK(rt, 8, 8),
          error: pe,
        });
      }
    }
  }

  console.error("[YT][oauth] preflight FAILED for all combinations", {
    errors,
  });
  const err = new Error(
    "invalid_grant: Không refresh được access token với bất kỳ redirect URI/token nào. Kiểm tra lại CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI (CSV), refresh token (revoke/hết hạn), và account/brand."
  );
  err.details = errors;
  throw err;
}

// --------------------------------- stream helper --------------------------------
async function getOrCreateReusableStream(yt) {
  let streamId = (await getCfgStr("YOUTUBE_REUSABLE_STREAM_ID", "")).trim();
  let stream = null;

  if (streamId) {
    try {
      const ret = await yt.liveStreams.list({
        id: [streamId],
        part: ["id", "cdn", "snippet", "contentDetails"],
      });
      stream = ret.data.items?.[0] || null;
      if (!stream) {
        console.warn("[YT] saved streamId not found, will recreate", {
          streamId,
        });
        streamId = "";
      } else {
        console.info("[YT] reuse saved streamId", { streamId });
      }
    } catch (e) {
      console.error(
        "[YT] liveStreams.list by id error:",
        e?.response?.data || e?.errors || e?.message || e
      );
    }
  }

  if (!stream) {
    const desiredTitle =
      (await getCfgStr("YOUTUBE_STREAM_TITLE", "")).trim() ||
      "PickleTour Reusable";
    try {
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
      console.info("[YT] search reusable by title", {
        desiredTitle,
        found: !!stream,
      });
    } catch (e) {
      console.error(
        "[YT] liveStreams.list (mine) error:",
        e?.response?.data || e?.errors || e?.message || e
      );
    }

    if (!stream) {
      try {
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
        console.info("[YT] liveStreams.insert created", {
          streamId: stream?.id,
        });
      } catch (e) {
        console.error(
          "[YT] liveStreams.insert error:",
          e?.response?.data || e?.errors || e?.message || e
        );
        throw e;
      }

      if (stream?.id) {
        try {
          await setCfg({
            key: "YOUTUBE_REUSABLE_STREAM_ID",
            value: stream.id,
            isSecret: false,
            updatedBy: "system",
          });
          console.info("[YT] saved YOUTUBE_REUSABLE_STREAM_ID", {
            streamId: stream.id,
          });
        } catch (e) {
          console.error(
            "[YT] save streamId config error (non-fatal):",
            e?.message || e
          );
        }
      }
    }
  }

  const ing = stream?.cdn?.ingestionInfo || {};
  let serverUrl = ing.ingestionAddress || "";
  const streamKey = ing.streamName || "";
  if (serverUrl && serverUrl.startsWith("rtmp://")) {
    serverUrl = serverUrl
      .replace("rtmp://", "rtmps://")
      .replace(".rtmp.", ".rtmps.");
  }
  if (!serverUrl || !streamKey)
    throw new Error("Không lấy được ingestion info từ YouTube.");
  return { stream, serverUrl, streamKey };
}

// ---------------------------------- Provider -----------------------------------
export class YouTubeProvider extends LiveProvider {
  static providerName = "youtube";

  async getChannelLiveState() {
    const { oauth2 } = await getOAuthReady(this.cred || {});
    const yt = google.youtube({ version: "v3", auth: oauth2 });
    try {
      const { data } = await yt.liveBroadcasts.list({
        part: ["id", "snippet", "status"],
        broadcastStatus: "active",
      });
      const busy = (data.items || []).length > 0;
      return { busy, raw: data };
    } catch (e) {
      console.error(
        "[YT] getChannelLiveState error:",
        e?.response?.data || e?.errors || e?.message || e
      );
      throw e;
    }
  }

  async createLive({ title, description, privacy = "public" }) {
    const { oauth2 } = await getOAuthReady(this.cred || {});
    const yt = google.youtube({ version: "v3", auth: oauth2 });
    try {
      const { stream, serverUrl, streamKey } = await getOrCreateReusableStream(
        yt
      );

      const bRes = await yt.liveBroadcasts.insert({
        part: ["snippet", "status", "contentDetails"],
        requestBody: {
          snippet: {
            title,
            description,
            scheduledStartTime: new Date().toISOString(),
          },
          status: { privacyStatus: privacy },
          contentDetails: { enableAutoStart: false, enableAutoStop: false },
        },
      });
      const broadcast = bRes.data;
      console.info("[YT] liveBroadcasts.insert created", {
        broadcastId: broadcast?.id,
      });

      await yt.liveBroadcasts.bind({
        id: broadcast.id,
        part: ["id", "snippet", "contentDetails", "status"],
        streamId: stream.id,
      });
      console.info("[YT] liveBroadcasts.bind OK", {
        broadcastId: broadcast?.id,
        streamId: stream?.id,
      });

      return {
        platformLiveId: broadcast.id,
        serverUrl,
        streamKey,
        secureStreamUrl: null,
        permalinkUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
        raw: { broadcast, stream },
      };
    } catch (e) {
      console.error(
        "[YT] createLive error:",
        e?.response?.data || e?.errors || e?.message || e
      );
      throw e;
    }
  }
}
