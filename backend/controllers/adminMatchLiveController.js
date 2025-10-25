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

/* ───────────────────────── Config helpers (dùng DB Config) ───────────────────────── */
async function resolveOverlayBase() {
  const overlay = (await getCfgStr("LIVE_OVERLAY_BASE", "")).trim();
  if (overlay) return overlay.replace(/\/+$/, "");
  const host = (await getCfgStr("HOST", "")).trim();
  if (host) return host.replace(/\/+$/, "");
  return "http://localhost:3000";
}
async function resolveStudioBase() {
  const studio = (await getCfgStr("LIVE_STUDIO_BASE", "")).trim();
  if (studio) return studio.replace(/\/+$/, "");
  const host = (await getCfgStr("HOST", "")).trim();
  if (host) return host.replace(/\/+$/, "");
  return "http://localhost:3000";
}
async function isObsAutoStart() {
  const v = (await getCfgStr("LIVE_OBS_AUTO_START", "0")).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

/* ───────────────────────── Utils ───────────────────────── */
const toFullUrl = (u) =>
  u?.startsWith?.("http") ? u : u ? `https://facebook.com${u}` : "";

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

// Gom page theo từng "user" dựa trên longUserToken, sắp theo createdAt
async function buildCandidateUserBuckets(req, tournament) {
  const fromReq = req.body?.pageId || req.query?.pageId || null;
  const fromTournament =
    tournament?.facebookPageId ||
    tournament?.facebook?.pageId ||
    tournament?.meta?.facebook?.pageId ||
    null;

  const tokens = await FbToken.find(
    {},
    { pageId: 1, longUserToken: 1, createdAt: 1 },
    { sort: { createdAt: 1 } }
  ).lean();

  const pageToUser = new Map();
  const userOrder = [];
  const userPages = new Map();

  const getUserKey = (t) =>
    t?.longUserToken
      ? `user:${t.longUserToken}`
      : `page:${t?.pageId || "unknown"}`;

  // seed từ DB
  for (const t of tokens) {
    const pid = String(t?.pageId || "").trim();
    if (!pid) continue;
    const ukey = getUserKey(t);
    pageToUser.set(pid, ukey);
    if (!userPages.has(ukey)) {
      userPages.set(ukey, []);
      userOrder.push(ukey);
    }
    userPages.get(ukey).push(pid);
  }

  // Ưu tiên user chứa fromReq / fromTournament (nếu có)
  const prioritize = (pid) => {
    if (!pid) return;
    const ukey = pageToUser.get(pid) || `page:${pid}`; // nếu page chưa có trong DB, coi như 1 bucket riêng
    if (!userPages.has(ukey)) userPages.set(ukey, [pid]);
    const idx = userOrder.indexOf(ukey);
    if (idx > 0) {
      userOrder.splice(idx, 1);
      userOrder.unshift(ukey);
    } else if (idx === -1) {
      userOrder.unshift(ukey);
    }
  };

  prioritize(fromTournament);
  prioritize(fromReq);

  // Trả mảng bucket theo thứ tự user → pages
  return userOrder.map((ukey) => ({
    userKey: ukey,
    pages: [...new Set(userPages.get(ukey) || [])],
  }));
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

const mask = (s, head = 6, tail = 4) =>
  typeof s === "string" && s.length > head + tail
    ? `${s.slice(0, head)}…${s.slice(-tail)}`
    : s || null;

function sanitizeRaw(raw) {
  if (!raw || typeof raw !== "object") return raw ?? null;
  const clone = JSON.parse(JSON.stringify(raw));
  const redact = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      const lk = k.toLowerCase();
      if (
        [
          "key",
          "stream_key",
          "streamkey",
          "secure_stream_url",
          "server_url",
        ].some((x) => lk.includes(x))
      ) {
        obj[k] = "•••";
      } else if (typeof obj[k] === "object") {
        redact(obj[k]);
      }
    }
  };
  redact(clone);
  return clone;
}

/* ───────────── Meta helpers (ghi đầy đủ, có streamKey raw) ───────────── */
function ensureMeta(obj) {
  if (!obj.meta || typeof obj.meta !== "object") obj.meta = {};
  return obj.meta;
}

function setMetaFacebook(match, { pageId, pageName, permalinkUrl, live, raw }) {
  const meta = ensureMeta(match);
  meta.facebook = meta.facebook || {};
  if (pageId) meta.facebook.pageId = String(pageId);
  if (pageName) meta.facebook.pageName = pageName;
  if (permalinkUrl) meta.facebook.permalinkUrl = permalinkUrl;

  if (live) {
    const serverUrl = live.server_url ?? live.serverUrl ?? null;
    const streamKey = live.stream_key ?? live.streamKey ?? null;
    meta.facebook.live = {
      id: live.id || null,
      serverUrl, // raw
      streamKey, // raw
      streamKeyMasked: mask(streamKey),
      status: live.status || "CREATED",
      createdAt: live.createdAt || new Date(),
      permalinkUrl: permalinkUrl || null,
    };
  }
  if (raw) meta.facebook.raw = sanitizeRaw(raw);
  match.markModified?.("meta");
}

function setMetaYouTube(match, { videoId, watchUrl, channelId, live, raw }) {
  const meta = ensureMeta(match);
  meta.youtube = meta.youtube || {};
  if (videoId) meta.youtube.videoId = String(videoId);
  if (watchUrl) meta.youtube.watchUrl = watchUrl;
  if (channelId) meta.youtube.channelId = String(channelId);

  if (live) {
    const serverUrl = live.server_url ?? live.serverUrl ?? null;
    const streamKey = live.stream_key ?? live.streamKey ?? null;
    meta.youtube.live = {
      serverUrl, // raw
      streamKey, // raw
      streamKeyMasked: mask(streamKey),
      status: live.status || "CREATED",
      createdAt: live.createdAt || new Date(),
    };
  }
  if (raw) meta.youtube.raw = sanitizeRaw(raw);
  match.markModified?.("meta");
}

function setMetaTikTok(match, { roomId, username, watchUrl, live, raw }) {
  const meta = ensureMeta(match);
  meta.tiktok = meta.tiktok || {};
  if (roomId != null) meta.tiktok.roomId = String(roomId);
  if (username) meta.tiktok.username = username;
  if (watchUrl) meta.tiktok.watchUrl = watchUrl;

  if (live) {
    const serverUrl = live.server_url ?? live.serverUrl ?? null;
    const streamKey = live.stream_key ?? live.streamKey ?? null;
    meta.tiktok.live = {
      serverUrl, // raw
      streamKey, // raw
      streamKeyMasked: mask(streamKey),
      status: live.status || "CREATED",
      createdAt: live.createdAt || new Date(),
    };
  }
  if (raw) meta.tiktok.raw = sanitizeRaw(raw);
  match.markModified?.("meta");
}
/* ───────────────────────── Controller ───────────────────────── */
export const createFacebookLiveForMatch = async (req, res) => {
  try {
    // 1) flags từ Config
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

    // 2) match
    const { matchId } = req.params;
    const match = await Match.findById(matchId).populate("tournament court");
    if (!match) return res.status(404).json({ message: "Match not found" });

    // 3) bases & flags
    const OVERLAY_BASE = await resolveOverlayBase();
    const STUDIO_BASE = await resolveStudioBase();
    const OBS_AUTO_START = await isObsAutoStart();

    // 4) metadata title/desc
    const t = match.tournament;
    const overlayUrl = `${OVERLAY_BASE}/overlay/score?matchId=${match._id}&theme=fb&ratio=16:9&safe=1`;
    const courtName = match?.court?.name || match?.courtLabel || "";
    const roundLabel =
      match?.roundLabel || match?.labelKey || match?.code || "Match";
    const title = `${t?.name || "PickleTour"} – ${roundLabel}${
      courtName ? " · " + courtName : ""
    }`;
    const description = `Trực tiếp trận đấu trên PickleTour.\nScoreboard overlay: ${overlayUrl}`;

    const destinations = [];
    const platformErrors = [];

    /* ───── 5) FACEBOOK ───── */
    /* ───── 5) FACEBOOK ───── */
    if (fbEnabled) {
      // ❗ Duyệt theo từng USER → từng PAGE của user đó
      const buckets = await buildCandidateUserBuckets(req, t);

      if (!buckets.length) {
        platformErrors.push({
          platform: "facebook",
          message:
            "Không tìm thấy Facebook Page để tạo live. Hãy cấu hình pageId ở giải/req hoặc seed FbToken trước.",
        });
      } else {
        let createdForSomeUser = false;

        // Lần lượt theo từng user
        for (const bucket of buckets) {
          const { userKey, pages } = bucket;

          // 5.1) Kiểm tra: nếu user này đã có live ở BẤT KỲ page nào → bỏ qua toàn bộ user
          let userBusy = false;
          for (const pid of pages) {
            try {
              const pat = await getValidPageToken(pid);
              const st = await getPageLiveState({
                pageId: pid,
                pageAccessToken: pat,
              });
              if (st?.busy) {
                userBusy = true;
                break;
              }
            } catch {
              // ignore preflight lỗi, không xem là busy
            }
          }
          if (userBusy) {
            console.warn(
              `[FB][user-skip] ${userKey} đang có live → bỏ qua user này`
            );
            continue; // sang user kế tiếp
          }

          // 5.2) Thử tạo live trên CÁC PAGE của user này (tối đa 1 live cho user)
          let created = false;
          for (const pageId of pages) {
            const label = await getPageLabel(pageId);

            // token cho page
            let pageAccessToken;
            try {
              pageAccessToken = await getValidPageToken(pageId);
            } catch (e) {
              console.warn(`[FB][token] Skip ${label}: ${e?.message || e}`);
              continue;
            }

            // preflight: nếu page riêng đang bận thì thử page kế tiếp (vẫn trong cùng user)
            try {
              const state = await getPageLiveState({ pageId, pageAccessToken });
              if (state.busy) {
                console.warn(
                  `[FB][skip] Page busy → ${label}: live=${state.liveNow.length} prepared=${state.prepared.length}`
                );
                continue;
              }
            } catch (preflightErr) {
              console.warn(
                `[FB][preflight] ${label} failed, vẫn thử create:`,
                preflightErr?.message || preflightErr
              );
            }

            try {
              // Tạo live
              const live = await fbCreateLiveOnPage({
                pageId,
                pageAccessToken,
                title,
                description,
                status: "LIVE_NOW",
              });
              const liveId = live.liveVideoId || live.id;

              // permalink chắc chắn
              let permalinkResolved = "";
              try {
                const s2 = await getPageLiveState({ pageId, pageAccessToken });
                const list = [...(s2.liveNow || []), ...(s2.prepared || [])];
                const found = list.find((v) => String(v.id) === String(liveId));
                if (found?.permalink_url)
                  permalinkResolved = toFullUrl(found.permalink_url);
              } catch {}
              if (!permalinkResolved && live?.permalink_url) {
                permalinkResolved = toFullUrl(live.permalink_url);
              }
              if (!permalinkResolved) {
                permalinkResolved = `https://www.facebook.com/${pageId}/videos/${liveId}/`;
              }

              // comment overlay (non-fatal)
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

              // server/key
              const { server, streamKey } = splitServerAndKey(
                live?.secure_stream_url
              );

              // save match + meta
              try {
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
              } catch {}
              const pageName = await getPageLabel(pageId);
              setMetaFacebook(match, {
                pageId,
                pageName,
                permalinkUrl: permalinkResolved,
                live: {
                  id: liveId,
                  server_url: server,
                  stream_key: streamKey,
                  status: "CREATED",
                  createdAt: new Date(),
                },
                raw: live,
              });
              await match.save();

              // push destination
              destinations.push({
                platform: "facebook",
                id: liveId,
                server_url: server,
                stream_key: streamKey,
                permalink_url: permalinkResolved,
                extras: { pageId, pageName, userKey },
              });

              created = true;
              createdForSomeUser = true;
              break; // ✅ đã tạo xong cho user này → không tạo thêm page khác của user này
            } catch (e) {
              if (isBusyCreateError(e)) {
                console.warn(
                  `[FB][create-busy] ${label}: ${
                    e?.response?.data?.error?.message || e.message
                  }`
                );
                continue; // thử page khác trong cùng user
              }
              console.error(
                `[FB][create-error] ${label}:`,
                e?.response?.data || e.message || e
              );
              continue;
            }
          } // end for pages

          if (created) break; // ✅ đã tạo xong cho 1 user → không xét user tiếp theo (FB là primary)
          // nếu không tạo được ở bất kỳ page nào của user này → chuyển user tiếp theo
        }

        if (!createdForSomeUser) {
          platformErrors.push({
            platform: "facebook",
            message:
              "Không thể tạo live Facebook (tất cả user/page đều bận hoặc lỗi).",
          });
        }
      }
    }
    /* ───── 6) YOUTUBE ───── */
    if (ytEnabled) {
      const pickErr = (e) => e?.response?.data || e?.errors || e?.message || e;

      try {
        const refreshToken = await getCfgStr("YOUTUBE_REFRESH_TOKEN", "");
        const accessExpiresAt = await getCfgStr(
          "YOUTUBE_ACCESS_EXPIRES_AT",
          ""
        );
        if (!refreshToken) {
          throw new Error(
            "Thiếu YOUTUBE_REFRESH_TOKEN trong Config. Vào YouTube Live Admin để connect."
          );
        }

        const ytProvider = new YouTubeProvider({
          refreshToken,
          accessToken: "",
          expiresAt: accessExpiresAt || "",
        });

        const ytState = await ytProvider.getChannelLiveState();
        if (ytState?.busy) {
          platformErrors.push({
            platform: "youtube",
            message: "Kênh YouTube đang có broadcast hoạt động.",
            details: ytState?.raw,
          });
        } else {
          const privacy =
            (await getCfgStr("YT_BROADCAST_PRIVACY", "unlisted")).trim() ||
            "unlisted";

          const r = await ytProvider.createLive({
            title,
            description,
            privacy,
          });
          // r = { platformLiveId, serverUrl, streamKey, permalinkUrl, channelId?, raw? }

          // save to match + meta (đầy đủ)
          try {
            match.youtubeLive = {
              id: r.platformLiveId,
              watch_url: r.permalinkUrl,
              server_url: r.serverUrl,
              stream_key: r.streamKey,
              createdAt: new Date(),
              status: "CREATED",
            };
          } catch {}
          setMetaYouTube(match, {
            videoId: r.platformLiveId,
            watchUrl: r.permalinkUrl,
            channelId: r.channelId || null,
            live: {
              server_url: r.serverUrl,
              stream_key: r.streamKey,
              status: "CREATED",
              createdAt: new Date(),
            },
            raw: r.raw || r, // nếu provider trả raw riêng
          });
          try {
            await match.save();
          } catch (e) {
            console.error("[YT] save match error:", pickErr(e));
          }

          // push
          destinations.push({
            platform: "youtube",
            id: r.platformLiveId,
            server_url: r.serverUrl,
            stream_key: r.streamKey,
            watch_url: r.permalinkUrl,
            extras: { channelId: r.channelId || null },
          });
        }
      } catch (e) {
        platformErrors.push({
          platform: "youtube",
          message: "Không thể tạo live YouTube",
          details: pickErr(e),
        });
      }
    }

    /* ───── 7) TIKTOK ───── */
    if (ttEnabled) {
      try {
        const tkServer = await getCfgStr("TIKTOK_SERVER_URL", "");
        const tkKey = await getCfgStr("TIKTOK_STREAM_KEY", "");
        const tkChannelId = (await getCfgStr("TIKTOK_CHANNEL_ID", "")).trim();
        const tkUsername = (await getCfgStr("TIKTOK_USERNAME", "")).trim();

        if (!tkServer || !tkKey)
          throw new Error(
            "Thiếu TIKTOK_SERVER_URL / TIKTOK_STREAM_KEY trong Config."
          );

        const channelDoc = {
          _id: tkChannelId || "tiktok-default",
          externalId: tkChannelId || "tiktok-default",
          meta: { manualIngest: { serverUrl: tkServer, streamKey: tkKey } },
        };

        const ttProvider = new TikTokProvider({ cred: null });
        const ttState = await ttProvider.getChannelLiveState(channelDoc);
        if (ttState?.busy) {
          platformErrors.push({
            platform: "tiktok",
            message: "Kênh TikTok đang bận (theo DB LiveSession).",
          });
        } else {
          const r = await ttProvider.createLive({
            channelDoc,
            title,
            description,
          });
          // r = { platformLiveId, serverUrl, streamKey, permalinkUrl?, raw? }

          // push
          destinations.push({
            platform: "tiktok",
            id: r.platformLiveId,
            server_url: r.serverUrl,
            stream_key: r.streamKey,
            room_url: r.permalinkUrl || null,
          });

          // Save vào match + meta (đầy đủ)
          try {
            match.tiktokLive = {
              id: r.platformLiveId,
              room_url: r.permalinkUrl || null,
              server_url: r.serverUrl,
              stream_key: r.streamKey,
              createdAt: new Date(),
              status: "CREATED",
            };
          } catch {}
          setMetaTikTok(match, {
            roomId: r.platformLiveId,
            username: tkUsername || null,
            watchUrl:
              r.permalinkUrl ||
              (tkUsername ? `https://www.tiktok.com/@${tkUsername}/live` : ""),
            live: {
              server_url: r.serverUrl,
              stream_key: r.streamKey,
              status: "CREATED",
              createdAt: new Date(),
            },
            raw: r.raw || r,
          });
          try {
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

    // 8) không có dest nào
    if (destinations.length === 0) {
      return res.status(409).json({
        message: "Không tạo được live trên bất kỳ nền tảng nào.",
        errors: platformErrors,
      });
    }

    // 9) Primary & OBS
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
      `${STUDIO_BASE}/studio/live` +
      `?matchId=${match._id}&server=${encodeURIComponent(
        primary.server_url || ""
      )}&key=${encodeURIComponent(primary.stream_key || "")}`;

    // 10) Tổng hợp meta/platforms để trả về
    const metaSafe = match.meta || {};
    const fbPageId =
      match.facebookLive?.pageId || metaSafe?.facebook?.pageId || null;
    const fbPageName = fbPageId ? await getPageLabel(fbPageId) : null;

    const matchInfo = {
      id: String(match._id),
      code: match.code,
      status: match.status,
      labelKey: match.labelKey,
      stageIndex: match.stageIndex,
      round: match.round ?? null,
      courtId: match.court?._id || match.court || null,
      courtName: match.court?.name || match.courtLabel || "",
      tournamentId: match.tournament?._id || match.tournament || null,
      tournamentName: match.tournament?.name || null,
      scheduledAt: match.scheduledAt,
      startedAt: match.startedAt,
      updatedAt: match.updatedAt,
      createdAt: match.createdAt,
    };

    const facebook = match.facebookLive
      ? {
          live: {
            id: match.facebookLive.id || null,
            pageId: fbPageId,
            pageName: fbPageName,
            permalink_url: match.facebookLive.permalink_url || null,
            secure_stream_url: match.facebookLive.secure_stream_url || null,
            server_url: match.facebookLive.server_url || null,
            stream_key: match.facebookLive.stream_key || null,
            stream_key_masked: mask(match.facebookLive.stream_key),
            status: match.facebookLive.status || "CREATED",
            createdAt: match.facebookLive.createdAt || null,
          },
          meta: {
            ...(metaSafe.facebook || {}),
            pageId: fbPageId,
            pageName: fbPageName,
          },
        }
      : metaSafe.facebook
      ? { live: null, meta: { ...metaSafe.facebook, pageName: fbPageName } }
      : null;

    const youtube = match.youtubeLive
      ? {
          live: {
            id: match.youtubeLive.id || null,
            watch_url: match.youtubeLive.watch_url || null,
            server_url: match.youtubeLive.server_url || null,
            stream_key: match.youtubeLive.stream_key || null,
            stream_key_masked: mask(match.youtubeLive.stream_key),
            status: match.youtubeLive.status || "CREATED",
            createdAt: match.youtubeLive.createdAt || null,
          },
          meta: {
            ...(metaSafe.youtube || {}),
            videoId:
              (metaSafe.youtube && metaSafe.youtube.videoId) ||
              match.youtubeLive.id ||
              null,
            watchUrl:
              (metaSafe.youtube && metaSafe.youtube.watchUrl) ||
              match.youtubeLive.watch_url ||
              null,
          },
        }
      : metaSafe.youtube
      ? { live: null, meta: { ...metaSafe.youtube } }
      : null;

    const tiktok = match.tiktokLive
      ? {
          live: {
            id: match.tiktokLive.id || null,
            room_url: match.tiktokLive.room_url || null,
            server_url: match.tiktokLive.server_url || null,
            stream_key: match.tiktokLive.stream_key || null,
            stream_key_masked: mask(match.tiktokLive.stream_key),
            status: match.tiktokLive.status || "CREATED",
            createdAt: match.tiktokLive.createdAt || null,
          },
          meta: {
            ...(metaSafe.tiktok || {}),
            roomId:
              (metaSafe.tiktok && metaSafe.tiktok.roomId) ||
              match.tiktokLive.id ||
              null,
            watchUrl:
              (metaSafe.tiktok && metaSafe.tiktok.watchUrl) ||
              match.tiktokLive.room_url ||
              null,
          },
        }
      : metaSafe.tiktok
      ? { live: null, meta: { ...metaSafe.tiktok } }
      : null;

    const destinationsFull = destinations.map((d) => ({
      ...d,
      stream_key_masked: mask(d.stream_key),
    }));

    const obs = {
      autoStart: OBS_AUTO_START,
      primaryPlatform: primary.platform,
      primaryServer: primary.server_url || null,
      primaryKeyMasked: mask(primary.stream_key),
    };

    const platformsEnabled = {
      facebook: fbEnabled,
      youtube: ytEnabled,
      tiktok: ttEnabled,
    };

    return res.json({
      ok: true,

      // tổng quan
      match: matchInfo,
      overlay_url: overlayUrl,
      studio_url: studioUrl,

      // server/key chính để phát (ưu tiên FB nếu có)
      primary: {
        platform: primary.platform,
        server_url: primary.server_url,
        stream_key: primary.stream_key,
        stream_key_masked: mask(primary.stream_key),
      },

      // FULL META theo từng nền tảng (live + meta.*)
      platforms: {
        facebook,
        youtube,
        tiktok,
      },

      // trả nguyên khối match.meta cho client nào cần
      meta: metaSafe,

      // multi-destination (dùng relay/đa điểm)
      destinations: destinationsFull,

      // cờ bật/tắt, info OBS
      platformsEnabled,
      obs,

      // tiện lợi cho UI
      facebook_permalink_url:
        (facebook && facebook.live && facebook.live.permalink_url) || null,
      youtube_watch_url:
        (youtube && youtube.live && youtube.live.watch_url) ||
        (youtube && youtube.meta && youtube.meta.watchUrl) ||
        null,
      tiktok_room_url:
        (tiktok && tiktok.live && tiktok.live.room_url) ||
        (tiktok && tiktok.meta && tiktok.meta.watchUrl) ||
        null,

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

// ⬇️ THÊM VÀO CUỐI FILE: controllers/adminMatchLiveController.js
export const createFacebookLiveForCourt = async (req, res) => {
  try {
    // Chỉ dùng Facebook cho flow theo sân (map mỗi sân → 1 page)
    const fbEnabled =
      (await getCfgStr("LIVE_FACEBOOK_ENABLED", "1")).trim() === "1";
    if (!fbEnabled) {
      return res.status(400).json({
        message:
          "LIVE_FACEBOOK_ENABLED=0. Bật cờ này trong Config để tạo live theo sân.",
      });
    }

    const { courtId } = req.params;
    const explicitMatchId = req.body?.matchId || req.query?.matchId || null;

    // Dynamic import để không thay import đầu file
    const Court = (await import("../models/courtModel.js")).default;

    // 1) Court + (optional) Match để dựng title/overlay
    const court = await Court.findById(courtId).lean();
    if (!court) return res.status(404).json({ message: "Court not found" });

    const matchId = explicitMatchId || court.currentMatch || null;
    const match = matchId
      ? await Match.findById(matchId).populate("tournament court")
      : null;

    const OVERLAY_BASE = await resolveOverlayBase();
    const STUDIO_BASE = await resolveStudioBase();
    const OBS_AUTO_START = await isObsAutoStart();

    const t = match?.tournament;
    const tName = t?.name || "PickleTour";
    const courtName = match?.court?.name || court?.name || "";
    const overlayUrl = match
      ? `${OVERLAY_BASE}/overlay/score?matchId=${match._id}&theme=fb&ratio=16:9&safe=1`
      : ""; // không có match thì bỏ overlay

    const roundLabel = match
      ? match?.roundLabel || match?.labelKey || match?.code || "Match"
      : "Court Live";
    const title = `${tName} – ${roundLabel}${
      courtName ? " · " + courtName : ""
    }`;
    const description = `Trực tiếp sân ${courtName} trên PickleTour.${
      overlayUrl ? `\nScoreboard overlay: ${overlayUrl}` : ""
    }`;

    // 2) Xây danh sách pageId candidate cho SÂN
    const candidates = [];
    const pushUnique = (id) =>
      id && !candidates.includes(String(id)) && candidates.push(String(id));

    // a) ưu tiên req.body/query
    pushUnique(req.body?.pageId || req.query?.pageId);

    // b) Config mapping theo sân (3 biến thể)
    const safeName = String(court.name || "")
      .trim()
      .replace(/\s+/g, "_")
      .toUpperCase();
    const cfgKeys = [
      `LIVE_COURT_PAGE_${courtId}`,
      `LIVE_COURT_PAGE_${court.tournament}_${safeName}`,
      `LIVE_COURT_PAGE_${court.bracket}_${safeName}`,
    ];
    for (const k of cfgKeys) {
      try {
        const v = (await getCfgStr(k, "")).trim();
        pushUnique(v);
      } catch {}
    }

    // c) Fallback: dùng buildCandidatePageIds (theo giải) nếu có match.tournament
    if (t) {
      const byTournament = await buildCandidatePageIds(req, t);
      byTournament.forEach(pushUnique);
    } else {
      const tokens = await FbToken.find(
        {},
        { pageId: 1 },
        { sort: { createdAt: 1 } }
      ).lean();
      tokens
        .map((x) => x.pageId)
        .filter(Boolean)
        .forEach(pushUnique);
    }

    if (!candidates.length) {
      return res.status(400).json({
        message:
          "Không tìm thấy Facebook Page cho sân này. Truyền pageId hoặc cấu hình LIVE_COURT_PAGE_*.",
      });
    }

    // 3) Thử tạo live trên từng page theo thứ tự ưu tiên
    let created = null;
    let usedPageId = null;
    const platformErrors = [];

    for (const pageId of candidates) {
      const label = await getPageLabel(pageId);

      // token
      let pageAccessToken;
      try {
        pageAccessToken = await getValidPageToken(pageId);
      } catch (e) {
        platformErrors.push({
          platform: "facebook",
          pageId,
          message: e?.message || String(e),
        });
        continue;
      }

      // preflight: skip nếu bận
      try {
        const state = await getPageLiveState({ pageId, pageAccessToken });
        if (state.busy) {
          platformErrors.push({
            platform: "facebook",
            pageId,
            message: `[FB][skip] Page busy → ${label}: live=${state.liveNow.length} prepared=${state.prepared.length}`,
          });
          continue;
        }
      } catch {
        // preflight fail thì vẫn thử tạo
      }

      try {
        // create
        const live = await fbCreateLiveOnPage({
          pageId,
          pageAccessToken,
          title,
          description,
          status: "LIVE_NOW",
        });
        const liveId = live.liveVideoId || live.id;

        // permalink chắc chắn
        let permalinkResolved = "";
        try {
          const s2 = await getPageLiveState({ pageId, pageAccessToken });
          const list = [...(s2.liveNow || []), ...(s2.prepared || [])];
          const found = list.find((v) => String(v.id) === String(liveId));
          if (found?.permalink_url)
            permalinkResolved = toFullUrl(found.permalink_url);
        } catch {}
        if (!permalinkResolved && live?.permalink_url) {
          permalinkResolved = toFullUrl(live.permalink_url);
        }
        if (!permalinkResolved) {
          permalinkResolved = `https://www.facebook.com/${pageId}/videos/${liveId}/`;
        }

        // comment overlay (nếu có)
        if (overlayUrl) {
          try {
            await fbPostComment({
              liveVideoId: liveId,
              pageAccessToken,
              message: `Overlay (OBS Browser Source): ${overlayUrl}`,
            });
          } catch {}
        }

        // tách server/key
        const { server, streamKey } = splitServerAndKey(
          live?.secure_stream_url
        );

        // nếu có match → lưu vào match.meta để client phát OBS/relay
        if (match?._id) {
          try {
            const mm = await Match.findById(match._id);
            if (mm) {
              mm.facebookLive = {
                id: liveId,
                pageId,
                permalink_url: permalinkResolved,
                secure_stream_url: live.secure_stream_url,
                server_url: server,
                stream_key: streamKey,
                createdAt: new Date(),
                status: "CREATED",
              };
              const pageName = await getPageLabel(pageId);
              setMetaFacebook(mm, {
                pageId,
                pageName,
                permalinkUrl: permalinkResolved,
                live: {
                  id: liveId,
                  server_url: server,
                  stream_key: streamKey,
                  status: "CREATED",
                  createdAt: new Date(),
                },
                raw: live,
              });
              await mm.save();
            }
          } catch {}

          // cập nhật Court: status + videoUrl (non-blocking)
          try {
            await Court.updateOne(
              { _id: court._id },
              {
                $set: {
                  status: "live",
                  "liveConfig.videoUrl": permalinkResolved,
                },
              }
            );
          } catch {}
        }

        created = { liveId, permalinkResolved, server, streamKey, raw: live };
        usedPageId = pageId;
        break;
      } catch (e) {
        if (isBusyCreateError(e)) {
          platformErrors.push({
            platform: "facebook",
            pageId,
            message:
              e?.response?.data?.error?.message || e?.message || "Page busy",
          });
          continue;
        }
        platformErrors.push({
          platform: "facebook",
          pageId,
          message: e?.response?.data || e?.message || String(e),
        });
      }
    }

    if (!created) {
      return res.status(409).json({
        message: "Không thể tạo live Facebook cho sân này.",
        errors: platformErrors,
      });
    }

    // 4) OBS auto-start + studio URL
    const pageName = await getPageLabel(usedPageId);
    const studioUrl =
      `${STUDIO_BASE}/studio/live` +
      `?courtId=${court._id}` +
      (match?._id ? `&matchId=${match._id}` : "") +
      `&server=${encodeURIComponent(created.server || "")}` +
      `&key=${encodeURIComponent(created.streamKey || "")}`;

    if (OBS_AUTO_START && created.server && created.streamKey) {
      try {
        await startObsStreamingWithOverlay({
          server_url: created.server,
          stream_key: created.streamKey,
          overlay_url: overlayUrl || "",
        });
      } catch {}
    }

    return res.json({
      ok: true,
      court: {
        id: String(court._id),
        name: court.name,
        bracketId: court.bracket,
        tournamentId: court.tournament,
      },
      match: match
        ? {
            id: String(match._id),
            code: match.code,
            labelKey: match.labelKey,
            courtName,
            tournamentName: tName,
          }
        : null,
      primary: {
        platform: "facebook",
        pageId: usedPageId,
        pageName,
        server_url: created.server,
        stream_key: created.streamKey,
        stream_key_masked: mask(created.streamKey),
        permalink_url: created.permalinkResolved,
        live_id: created.liveId,
      },
      overlay_url: overlayUrl || null,
      studio_url: studioUrl,
      errors: platformErrors,
      note: "Đã tạo live cho SÂN. Dùng server/key phía trên để phát (OBS/relay).",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Create Court Live failed",
      error: err?.response?.data || err.message,
    });
  }
};
