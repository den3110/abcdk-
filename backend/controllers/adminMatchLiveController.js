// controllers/adminMatchLiveController.js
import {
  fbCreateLiveOnPage,
  fbPostComment,
} from "../services/facebookLive.service.js";
import Match from "../models/matchModel.js";
import { startObsStreamingWithOverlay } from "../services/obs.service.js";

import FbToken from "../models/fbTokenModel.js";
import { getValidPageToken } from "../services/fbTokenService.js";
import { getPageLiveState } from "../services/facebookApi.js";
import { getCfgStr } from "../services/config.service.js";

// Providers
import { YouTubeProvider } from "../services/liveProviders/youtube.js";
import { TikTokProvider } from "../services/liveProviders/tiktok.js";

const OVERLAY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.HOST;

const OBS_AUTO_START = String(process.env.OBS_AUTO_START || "0") === "1";

// Helpers
const toFullUrl = (u) =>
  u?.startsWith?.("http") ? u : u ? `https://facebook.com${u}` : "";

// ───────────────────────────────────────────────────────────────────────────────
function splitServerAndKey(secureUrl) {
  try {
    const u = new URL(secureUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const keyPart = parts.pop() || "";
    const server = `${u.protocol}//${u.host}/${parts.join("/")}/`;
    const streamKey = `${keyPart}${u.search || ""}`;
    return { server, streamKey };
  } catch {
    return { server: secureUrl, streamKey: "" };
  }
}

async function buildCandidatePageIds(req, tournament) {
  const fromReq = req.body?.pageId || req.query?.pageId || null;
  const fromTournament =
    tournament?.facebookPageId ||
    tournament?.facebook?.pageId ||
    tournament?.meta?.facebook?.pageId ||
    null;

  const tokens = await FbToken.find(
    {},
    { pageId: 1 },
    { sort: { createdAt: 1 } }
  ).lean();
  const all = tokens.map((t) => String(t.pageId)).filter(Boolean);

  const ordered = [];
  const pushUnique = (id) =>
    id && !ordered.includes(String(id)) && ordered.push(String(id));
  pushUnique(fromReq);
  pushUnique(fromTournament);
  all.forEach(pushUnique);
  return ordered;
}

async function getPageLabel(pageId) {
  const doc = await FbToken.findOne({ pageId }, { pageName: 1 }).lean();
  return doc?.pageName ? `${doc.pageName} (${pageId})` : String(pageId);
}

function isBusyCreateError(err) {
  const gErr = err?.response?.data?.error || {};
  const msg = (gErr.message || err.message || "").toLowerCase();
  const patterns = [
    "only one live",
    "already has a live",
    "another live video",
    "is currently live",
    "broadcast",
    "throttle",
    "rate limit",
  ];
  return patterns.some((p) => msg.includes(p));
}

// ───────────────────────────────────────────────────────────────────────────────
export const createFacebookLiveForMatch = async (req, res) => {
  try {
    // 1) enable flags từ Config
    const fbEnabled =
      (await getCfgStr("LIVE_FACEBOOK_ENABLED", "1")).trim() === "1";
    const ytEnabled =
      (await getCfgStr("LIVE_YOUTUBE_ENABLED", "0")).trim() === "1";
    const ttEnabled =
      (await getCfgStr("LIVE_TIKTOK_ENABLED", "0")).trim() === "1";

    if (!fbEnabled && !ytEnabled && !ttEnabled) {
      return res.status(400).json({
        message:
          "Không có nền tảng nào được bật. Bật LIVE_FACEBOOK_ENABLED / LIVE_YOUTUBE_ENABLED / LIVE_TIKTOK_ENABLED trong Config.",
      });
    }

    // 2) match + meta
    const { matchId } = req.params;
    const match = await Match.findById(matchId).populate("tournament court");
    if (!match) return res.status(404).json({ message: "Match not found" });

    const t = match.tournament;
    const overlayUrl = `${OVERLAY_BASE}/overlay/score?matchId=${match._id}&theme=fb&ratio=16:9&safe=1`;
    const courtName = match?.court?.name || "";
    const title = `${t?.name || "PickleTour"} – ${match.roundLabel || ""}${
      courtName ? " · " + courtName : ""
    }`;
    const description = `Trực tiếp trận đấu trên PickleTour.\nScoreboard overlay: ${overlayUrl}`;

    const destinations = [];
    const platformErrors = [];

    // 3) FACEBOOK
    if (fbEnabled) {
      const candidates = await buildCandidatePageIds(req, t);
      if (!candidates.length) {
        platformErrors.push({
          platform: "facebook",
          message:
            "Không tìm thấy Facebook Page để tạo live. Hãy cấu hình pageId ở giải hoặc seed FbToken trước.",
        });
      } else {
        const tried = [];
        const busyByGraph = [];
        const errors = [];
        for (const pageId of candidates) {
          tried.push(pageId);
          const label = await getPageLabel(pageId);

          // token
          let pageAccessToken;
          try {
            pageAccessToken = await getValidPageToken(pageId);
          } catch (e) {
            console.warn(`[FB][token] Skip ${label}: ${e?.message || e}`);
            errors.push({ pageId, message: e?.message || String(e) });
            continue;
          }

          // preflight
          try {
            const state = await getPageLiveState({ pageId, pageAccessToken });
            if (state.busy) {
              console.warn(
                `[FB][skip] Page busy → ${label}: live=${state.liveNow.length} prepared=${state.prepared.length}`
              );
              state.liveNow.forEach((v) =>
                console.warn(
                  `[FB][skip]   LIVE id=${v.id} status=${
                    v.status
                  } url=${toFullUrl(v.permalink_url)}`
                )
              );
              state.prepared.forEach((v) =>
                console.warn(
                  `[FB][skip]   PREP id=${v.id} status=${
                    v.status
                  } url=${toFullUrl(v.permalink_url)}`
                )
              );
              busyByGraph.push({
                pageId,
                liveNow: state.liveNow.map((v) => v.id),
                prepared: state.prepared.map((v) => v.id),
              });
              continue;
            }
          } catch (preflightErr) {
            console.warn(
              `[FB][preflight] ${label} failed, will attempt create anyway:`,
              preflightErr?.message || preflightErr
            );
          }

          // create
          try {
            console.info(
              `[FB][choose] Attempting LIVE on: ${label} — https://facebook.com/${pageId}`
            );
            const live = await fbCreateLiveOnPage({
              pageId,
              pageAccessToken,
              title,
              description,
              status: "LIVE_NOW",
            });

            const liveId = live.liveVideoId || live.id;

            // Resolve permalink chắc chắn:
            let permalinkResolved = "";
            try {
              const s2 = await getPageLiveState({ pageId, pageAccessToken });
              const list = [...(s2.liveNow || []), ...(s2.prepared || [])];
              const found = list.find((v) => String(v.id) === String(liveId));
              if (found?.permalink_url)
                permalinkResolved = toFullUrl(found.permalink_url);
            } catch (e) {
              console.warn(
                "[FB][permalink] lookup failed:",
                e?.response?.data || e?.message || e
              );
            }
            if (!permalinkResolved && live?.permalink_url) {
              permalinkResolved = toFullUrl(live.permalink_url);
            }
            if (!permalinkResolved) {
              permalinkResolved = `https://www.facebook.com/${pageId}/videos/${liveId}/`;
            }

            console.info(
              `[FB][success] LIVE created on: ${label} liveVideoId=${liveId} permalink=${permalinkResolved}`
            );

            try {
              await fbPostComment({
                liveVideoId: liveId,
                pageAccessToken,
                message: `Overlay (OBS Browser Source): ${overlayUrl}`,
              });
            } catch (err) {
              console.log(
                "[FB] comment overlay error:",
                err?.response?.data || err.message
              );
            }

            const { server, streamKey } = splitServerAndKey(
              live?.secure_stream_url
            );
            match.facebookLive = {
              id: liveId,
              permalink_url: permalinkResolved,
              secure_stream_url: live.secure_stream_url,
              server_url: server,
              stream_key: streamKey,
              createdAt: new Date(),
              status: "CREATED",
              pageId,
            };
            await match.save();

            destinations.push({
              platform: "facebook",
              id: liveId,
              server_url: server,
              stream_key: streamKey,
              permalink_url: permalinkResolved,
              extras: { pageId },
            });

            break; // done FB
          } catch (e) {
            if (isBusyCreateError(e)) {
              console.warn(
                `[FB][create-busy] ${label}: ${
                  e?.response?.data?.error?.message || e.message
                }`
              );
              continue;
            }
            console.error(
              `[FB][create-error] ${label}:`,
              e?.response?.data || e.message || e
            );
            errors.push({
              pageId,
              message:
                e?.response?.data?.error?.message || e.message || String(e),
              code: e?.response?.data?.error?.code,
              subcode: e?.response?.data?.error?.error_subcode,
            });
            continue;
          }
        }

        if (!destinations.find((d) => d.platform === "facebook")) {
          platformErrors.push({
            platform: "facebook",
            message:
              "Không thể tạo live Facebook (không còn page trống/khả dụng).",
            details: undefined,
          });
        }
      }
    }

    // 4) YOUTUBE
    if (ytEnabled) {
      const YT_TAG = "[YT][create]";
      const pickErr = (e) => e?.response?.data || e?.errors || e?.message || e;
      const mask = (s, head = 6, tail = 4) =>
        typeof s === "string" && s.length > head + tail
          ? `${s.slice(0, head)}…${s.slice(-tail)}`
          : s || null;

      try {
        console.info(`${YT_TAG} begin`, {
          matchId: String(match?._id || ""),
          tournamentId: String(match?.tournament?._id || ""),
        });

        // Đọc config
        let refreshToken = "";
        let accessExpiresAt = "";
        try {
          refreshToken = await getCfgStr("YOUTUBE_REFRESH_TOKEN", "");
          accessExpiresAt = await getCfgStr("YOUTUBE_ACCESS_EXPIRES_AT", "");
          console.info(`${YT_TAG} config`, {
            hasRefreshToken: !!refreshToken,
            expiresAt: accessExpiresAt || null,
          });
        } catch (e) {
          console.error(`${YT_TAG} read config error:`, pickErr(e));
          throw e;
        }

        if (!refreshToken) {
          const err = new Error(
            "Thiếu YOUTUBE_REFRESH_TOKEN trong Config. Vào YouTube Live Admin để connect."
          );
          console.error(`${YT_TAG} validate error:`, err.message);
          throw err;
        }

        // Init provider (provider tự xử lý redirect CSV + token normalize)
        let ytProvider;
        try {
          ytProvider = new YouTubeProvider({
            refreshToken,
            accessToken: "",
            expiresAt: accessExpiresAt || "",
          });
          console.info(`${YT_TAG} provider inited`);
        } catch (e) {
          console.error(`${YT_TAG} init provider error:`, pickErr(e));
          throw e;
        }

        // Kiểm tra trạng thái kênh
        let ytState;
        try {
          ytState = await ytProvider.getChannelLiveState();
          console.info(`${YT_TAG} channel state`, {
            busy: !!ytState?.busy,
            activeCount: ytState?.raw?.items?.length ?? null,
          });
        } catch (e) {
          console.error(`${YT_TAG} getChannelLiveState error:`, pickErr(e));
          throw e;
        }

        if (ytState?.busy) {
          console.warn(`${YT_TAG} channel busy, skip create`, {
            activeCount: ytState?.raw?.items?.length ?? null,
          });
          platformErrors.push({
            platform: "youtube",
            message: "Kênh YouTube đang có broadcast hoạt động.",
            details: ytState?.raw,
          });
        } else {
          // Privacy
          let privacy = "unlisted";
          try {
            privacy =
              (await getCfgStr("YT_BROADCAST_PRIVACY", "unlisted")).trim() ||
              "unlisted";
          } catch (e) {
            console.warn(
              `${YT_TAG} read privacy error, fallback 'unlisted':`,
              pickErr(e)
            );
          }
          console.info(`${YT_TAG} privacy`, { privacy });

          // Tạo broadcast + lấy server/key
          let r;
          try {
            r = await ytProvider.createLive({ title, description, privacy });
            console.info(`${YT_TAG} createLive OK`, {
              broadcastId: r?.platformLiveId,
              serverUrl: r?.serverUrl,
              streamKeyPreview: mask(r?.streamKey),
              watchUrl: r?.permalinkUrl,
            });
          } catch (e) {
            console.error(`${YT_TAG} createLive error:`, pickErr(e));
            throw e;
          }

          // Lưu xuống match (non-fatal nếu fail)
          try {
            match.youtubeLive = {
              id: r.platformLiveId,
              watch_url: r.permalinkUrl,
              server_url: r.serverUrl,
              stream_key: r.streamKey,
              createdAt: new Date(),
              status: "CREATED",
            };
            await match.save();
            console.info(`${YT_TAG} match saved`, {
              matchId: String(match._id),
              youtubeLiveId: r?.platformLiveId,
            });
          } catch (e) {
            console.error(
              `${YT_TAG} save match error (non-fatal):`,
              pickErr(e)
            );
          }

          // Push destination
          try {
            destinations.push({
              platform: "youtube",
              id: r.platformLiveId,
              server_url: r.serverUrl,
              stream_key: r.streamKey,
              watch_url: r.permalinkUrl,
            });
            console.info(`${YT_TAG} destination appended`);
          } catch (e) {
            console.error(
              `${YT_TAG} push destination error (non-fatal):`,
              pickErr(e)
            );
          }
        }
      } catch (e) {
        console.error(`${YT_TAG} failed:`, pickErr(e));
        platformErrors.push({
          platform: "youtube",
          message: "Không thể tạo live YouTube",
          details: pickErr(e),
        });
      } finally {
        console.info(`${YT_TAG} end`);
      }
    }

    // 5) TIKTOK
    if (ttEnabled) {
      try {
        const tkServer = await getCfgStr("TIKTOK_SERVER_URL", "");
        const tkKey = await getCfgStr("TIKTOK_STREAM_KEY", "");
        const tkChannelId =
          (await getCfgStr("TIKTOK_CHANNEL_ID", "")).trim() || "tiktok-default";

        if (!tkServer || !tkKey)
          throw new Error(
            "Thiếu TIKTOK_SERVER_URL / TIKTOK_STREAM_KEY trong Config."
          );

        const channelDoc = {
          _id: tkChannelId,
          externalId: tkChannelId,
          meta: { manualIngest: { serverUrl: tkServer, streamKey: tkKey } },
        };

        const ttProvider = new TikTokProvider({ cred: null });
        const ttState = await ttProvider.getChannelLiveState(channelDoc);
        if (ttState?.busy) {
          platformErrors.push({
            platform: "tiktok",
            message: "Kênh TikTok đang bận (theo DB LiveSession).",
            details: null,
          });
        } else {
          const r = await ttProvider.createLive({
            channelDoc,
            title,
            description,
          });
          destinations.push({
            platform: "tiktok",
            id: r.platformLiveId,
            server_url: r.serverUrl,
            stream_key: r.streamKey,
            room_url: r.permalinkUrl || null,
          });

          try {
            match.tiktokLive = {
              id: r.platformLiveId,
              room_url: r.permalinkUrl || null,
              server_url: r.serverUrl,
              stream_key: r.streamKey,
              createdAt: new Date(),
              status: "CREATED",
            };
            await match.save();
          } catch {}
        }
      } catch (e) {
        platformErrors.push({
          platform: "tiktok",
          message: "Không thể tạo live TikTok",
          details: e?.response?.data || e.message || String(e),
        });
      }
    }

    // 6) không có dest nào
    if (destinations.length === 0) {
      return res.status(409).json({
        message: "Không tạo được live trên bất kỳ nền tảng nào.",
        errors: platformErrors,
      });
    }

    // 7) primary + OBS
    const primary =
      destinations.find((d) => d.platform === "facebook") || destinations[0];
    if (OBS_AUTO_START && primary?.server_url && primary?.stream_key) {
      try {
        await startObsStreamingWithOverlay({
          server_url: primary.server_url,
          stream_key: primary.stream_key,
          overlay_url: overlayUrl,
        });
      } catch (e) {
        console.error("[OBS] start failed:", e?.message || e);
      }
    }

    const studioUrl =
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3000/studio/live"
        : `${process.env.HOST}/studio/live`) +
      `?matchId=${match._id}&server=${encodeURIComponent(
        primary.server_url || ""
      )}&key=${encodeURIComponent(primary.stream_key || "")}`;

    return res.json({
      server_url: primary.server_url || "",
      stream_key: primary.stream_key || "",
      overlay_url: overlayUrl,
      studio_url: studioUrl,
      ...(destinations.find((d) => d.platform === "facebook")
        ? {
            liveVideoId:
              destinations.find((d) => d.platform === "facebook")?.id ||
              undefined,
            permalink_url: match.facebookLive?.permalink_url,
            secure_stream_url: match.facebookLive?.secure_stream_url,
            pageId: match.facebookLive?.pageId,
          }
        : {}),
      destinations,
      errors: platformErrors,
      note: "Đã tạo live trên các nền tảng được bật. Dán server/key (primary) vào OBS hoặc dùng relay nếu phát đa điểm.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Create Live failed",
      error: err?.response?.data || err.message,
    });
  }
};
