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

// 🆕 Providers cho YouTube/TikTok (class based)
import { YouTubeProvider } from "../services/liveProviders/youtube.js";
import { TikTokProvider } from "../services/liveProviders/tiktok.js";

const OVERLAY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.HOST;

const OBS_AUTO_START = String(process.env.OBS_AUTO_START || "0") === "1";

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

// Phân loại lỗi tạo live → có phải do page đang bận hay không
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
// Multi-platform create: Facebook + YouTube + TikTok (tuỳ config enable)
export const createFacebookLiveForMatch = async (req, res) => {
  try {
    // 1) Đọc trạng thái bật/tắt từng nền tảng từ Config DB
    const fbEnabled =
      (await getCfgStr("LIVE_FACEBOOK_ENABLED", "1")).trim() === "1";
    const ytEnabled =
      (await getCfgStr("LIVE_YOUTUBE_ENABLED", "0")).trim() === "1";
    const ttEnabled =
      (await getCfgStr("LIVE_TIKTOK_ENABLED", "0")).trim() === "1";

    if (!fbEnabled && !ytEnabled && !ttEnabled) {
      return res.status(400).json({
        message:
          "Không có nền tảng nào được bật. Hãy bật LIVE_FACEBOOK_ENABLED / LIVE_YOUTUBE_ENABLED / LIVE_TIKTOK_ENABLED trong Config.",
      });
    }

    // 2) Load match + build metadata chung
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

    const destinations = []; // [{ platform, id, server_url, stream_key, ... }]
    const platformErrors = []; // [{ platform, message, details? }]

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
        let chosen = null;

        for (const pageId of candidates) {
          tried.push(pageId);
          const label = await getPageLabel(pageId);

          // 3.1 token page (auto refresh)
          let pageAccessToken;
          try {
            pageAccessToken = await getValidPageToken(pageId);
          } catch (e) {
            console.warn(`[FB][token] Skip ${label}: ${e?.message || e}`);
            errors.push({ pageId, message: e?.message || String(e) });
            continue;
          }

          // 3.2 preflight FB graph
          try {
            const state = await getPageLiveState({ pageId, pageAccessToken });
            if (state.busy) {
              const toFull = (u) =>
                u?.startsWith("http") ? u : u ? `https://facebook.com${u}` : "";
              console.warn(
                `[FB][skip] Page busy → ${label}: live=${state.liveNow.length} prepared=${state.prepared.length}`
              );
              state.liveNow.forEach((v) =>
                console.warn(
                  `[FB][skip]   LIVE id=${v.id} status=${v.status} url=${toFull(
                    v.permalink_url
                  )}`
                )
              );
              state.prepared.forEach((v) =>
                console.warn(
                  `[FB][skip]   PREP id=${v.id} status=${v.status} url=${toFull(
                    v.permalink_url
                  )}`
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

          // 3.3 tạo live
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

            console.info(
              `[FB][success] LIVE created on: ${label} ` +
                `liveVideoId=${live.liveVideoId || live.id} ` +
                `permalink=${
                  live.permalink_url?.startsWith("http")
                    ? live.permalink_url
                    : "https://facebook.com" + (live.permalink_url || "")
                }`
            );

            chosen = { pageId, live, pageAccessToken };

            // comment overlay (best-effort)
            try {
              await fbPostComment({
                liveVideoId: live.liveVideoId || live.id,
                pageAccessToken,
                message: `Overlay (OBS Browser Source): ${overlayUrl}`,
              });
            } catch (err) {
              console.log(
                "[FB] comment overlay error:",
                err?.response?.data || err.message
              );
            }

            // save vào match
            const { server, streamKey } = splitServerAndKey(
              live?.secure_stream_url
            );
            match.facebookLive = {
              id: live.liveVideoId || live.id,
              permalink_url: live.permalink_url?.startsWith("http")
                ? live.permalink_url
                : "https://facebook.com" + (live.permalink_url || ""),
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
              id: live.liveVideoId || live.id,
              server_url: server,
              stream_key: streamKey,
              permalink_url: match.facebookLive.permalink_url,
              extras: { pageId },
            });

            break; // đã OK thì dừng thử page khác
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
            details: { tried, busy: busyByGraph, errors },
          });
        }
      }
    }

    // 4) YOUTUBE (nếu bật) — dùng class YouTubeProvider bạn đã có
    if (ytEnabled) {
      try {
        const ytCred = {
          accessToken: await getCfgStr("YT_ACCESS_TOKEN", ""), // có thể rỗng (provider sẽ tự xử lý)
          refreshToken: await getCfgStr("YT_REFRESH_TOKEN", ""), // 🔴 bắt buộc nên chuẩn bị
          expiresAt: await getCfgStr("YT_EXPIRES_AT", ""), // optional ISO
        };
        if (!ytCred.refreshToken) {
          throw new Error(
            "Thiếu YT_REFRESH_TOKEN trong Config (lưu ý nên mã hoá secret)."
          );
        }

        const ytProvider = new YouTubeProvider({ cred: ytCred });

        // check bận
        const ytState = await ytProvider.getChannelLiveState();
        if (ytState?.busy) {
          platformErrors.push({
            platform: "youtube",
            message: "Kênh YouTube đang có broadcast hoạt động.",
            details: ytState?.raw,
          });
        } else {
          // tạo live
          const privacy =
            (await getCfgStr("YT_BROADCAST_PRIVACY", "unlisted")).trim() ||
            "unlisted";
          const r = await ytProvider.createLive({
            title,
            description,
            privacy,
          });

          destinations.push({
            platform: "youtube",
            id: r.platformLiveId,
            server_url: r.serverUrl,
            stream_key: r.streamKey,
            watch_url: r.permalinkUrl,
          });

          // (tuỳ chọn) lưu vào match nếu có schema
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
          } catch {}
        }
      } catch (e) {
        platformErrors.push({
          platform: "youtube",
          message: "Không thể tạo live YouTube",
          details: e?.response?.data || e.message || String(e),
        });
      }
    }

    // 5) TIKTOK (nếu bật) — dùng class TikTokProvider, lấy ingest từ Config
    if (ttEnabled) {
      try {
        const tkServer = await getCfgStr("TIKTOK_SERVER_URL", "");
        const tkKey = await getCfgStr("TIKTOK_STREAM_KEY", "");
        const tkChannelId =
          (await getCfgStr("TIKTOK_CHANNEL_ID", "")).trim() || "tiktok-default";

        if (!tkServer || !tkKey) {
          throw new Error(
            "Thiếu TIKTOK_SERVER_URL / TIKTOK_STREAM_KEY trong Config."
          );
        }

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

          // (tuỳ chọn) lưu vào match nếu có schema
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

    // 6) Không tạo được ở nền tảng nào
    if (destinations.length === 0) {
      return res.status(409).json({
        message: "Không tạo được live trên bất kỳ nền tảng nào.",
        errors: platformErrors,
      });
    }

    // 7) Chọn primary để auto-start OBS (ưu tiên Facebook, sau đó cái đầu tiên)
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

    // Studio URL theo primary (giữ backward-compat)
    const studioUrl =
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3000/studio/live"
        : `${process.env.HOST}/studio/live`) +
      `?matchId=${match._id}&server=${encodeURIComponent(
        primary.server_url || ""
      )}&key=${encodeURIComponent(primary.stream_key || "")}`;

    // 8) Response
    return res.json({
      // backward-compat fields (primary)
      server_url: primary.server_url || "",
      stream_key: primary.stream_key || "",
      overlay_url: overlayUrl,
      studio_url: studioUrl,

      // nếu có facebook sẽ có thêm các field quen thuộc
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

      // multi-platform result
      destinations, // [{ platform, id, server_url, stream_key, ... }]
      errors: platformErrors, // nền tảng nào fail sẽ liệt kê ở đây
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
