import { createFacebookLiveForMatch } from "./adminMatchLiveController.js";
import { fbGetLiveVideo } from "../services/facebookLive.service.js";
import IORedis from "ioredis";
import Match from "../models/matchModel.js";
import UserMatch from "../models/userMatchModel.js";
import FbToken from "../models/fbTokenModel.js";
import { YouTubeProvider } from "../services/liveProviders/youtube.js";
import { getCfgStr } from "../services/config.service.js";
import { randomUUID } from "crypto";
import {
  buildLiveAppCourtRuntime,
  buildLiveAppMatchRuntime,
} from "../services/liveAppRuntime.service.js";

const pendingByMatchId = new Map();
const redis = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : null;
const setNoStoreHeaders = (res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");
};

const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function asTrimmed(value) {
  return String(value || "").trim();
}

function buildFacebookWatchUrl(liveId) {
  const normalizedLiveId = asTrimmed(liveId);
  return normalizedLiveId
    ? `https://www.facebook.com/watch/live/?v=${encodeURIComponent(normalizedLiveId)}`
    : "";
}

function buildFacebookPageVideoUrl(pageId, videoId, liveId) {
  const normalizedPageId = asTrimmed(pageId);
  const normalizedVideoId = asTrimmed(videoId) || asTrimmed(liveId);
  return normalizedPageId && normalizedVideoId
    ? `https://www.facebook.com/${encodeURIComponent(normalizedPageId)}/videos/${encodeURIComponent(normalizedVideoId)}/`
    : "";
}

// Dạng `facebook.com/watch/live/?v=<liveId>` là format cũ, Facebook không còn resolve
// (mở link → "Video trực tiếp không khả dụng").
function isLegacyFacebookWatchLiveUrl(url) {
  return /facebook\.com\/(?:watch\/)?live\/?\?/i.test(String(url || ""));
}

function resolveFacebookReuseUrls(facebookLive = {}, metaFacebook = {}) {
  const pageId = asTrimmed(facebookLive?.pageId || metaFacebook?.pageId);
  const liveId = asTrimmed(facebookLive?.id || metaFacebook?.liveId);
  const videoId = asTrimmed(facebookLive?.videoId || metaFacebook?.videoId);
  // Ưu tiên permalink LIVE thật của Facebook (như admin live-test), rồi permalink/watch_url
  // không phải dạng cũ, rồi video permalink; dạng cũ chỉ là fallback cuối.
  const best = [
    facebookLive?.raw_permalink_url,
    facebookLive?.rawPermalinkUrl,
    metaFacebook?.rawPermalink,
    facebookLive?.permalink_url,
    facebookLive?.permalinkUrl,
    metaFacebook?.permalink_url,
    metaFacebook?.permalinkUrl,
    facebookLive?.watch_url,
    facebookLive?.watchUrl,
    metaFacebook?.watch_url,
    metaFacebook?.watchUrl,
    facebookLive?.video_permalink_url,
    facebookLive?.videoPermalinkUrl,
  ]
    .map(asTrimmed)
    .find((u) => u && !isLegacyFacebookWatchLiveUrl(u));
  const url = best || buildFacebookPageVideoUrl(pageId, videoId, liveId) || buildFacebookWatchUrl(liveId);

  return {
    watchUrl: url || null,
    permalinkUrl: url || null,
  };
}

async function acquireRedisLock(key, ttlMs, maxWaitMs) {
  if (!redis) return null;
  const token = randomUUID();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const ok = await redis.set(key, token, "PX", ttlMs, "NX").catch(() => null);
    if (ok === "OK") {
      return async () => {
        await redis.eval(RELEASE_LOCK_LUA, 1, key, token).catch(() => {});
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function matchKindIsUser(req) {
  return (
    String(req.get("x-pkt-match-kind") || req.headers["x-pkt-match-kind"] || "")
      .trim()
      .toLowerCase() === "user"
  );
}

// Đè link "clip/live" của trận về nền tảng vừa live (mới nhất) + xoá block live
// của nền tảng cũ. Dùng khi live lại 1 trận sang nền tảng khác (vd FB lỗi → YouTube).
async function applyLatestLiveLinkToMatch({ matchId, isUserMatch, platform, watchUrl }) {
  try {
    if (!matchId) return;
    const M = isUserMatch ? UserMatch : Match;
    const set = {};
    if (watchUrl) set.video = watchUrl;
    const unset = {};
    if (platform === "youtube") {
      unset.facebookLive = "";
      unset["meta.facebook"] = "";
    } else {
      unset.youtubeLive = "";
      unset["meta.youtube"] = "";
    }
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) {
      await M.updateOne({ _id: matchId }, update);
    }
  } catch (e) {
    console.error("[live-app] applyLatestLiveLinkToMatch error", e?.message || e);
  }
}

export const createLiveSessionForLiveApp = async (req, res) => {
  const matchId = String(req.params?.matchId || "").trim();
  if (!matchId) return res.status(400).json({ message: "matchId is required" });

  const forceNew =
    ["1", "true", "yes"].includes(String(req.query?.force || req.query?.refresh || "").toLowerCase());

  const releaseLock = await acquireRedisLock(
    `lock:live-app:create:${matchId}`,
    20000,
    10000
  );

  const existing = pendingByMatchId.get(matchId);
  if (existing) await existing.catch(() => {});

  let statusCode = 200;
  let payload = null;
  let runnerError = null;
  const runner = (async () => {
    const requestedUserMatch =
      String(req.get("x-pkt-match-kind") || req.headers["x-pkt-match-kind"] || "")
        .trim()
        .toLowerCase() === "user";

    const MatchModel = requestedUserMatch ? UserMatch : Match;
    let sourceDoc = await MatchModel.findById(matchId)
      .select("facebookLive youtubeLive meta")
      .lean()
      .catch(() => null);

    if (!sourceDoc && !requestedUserMatch) {
      sourceDoc = await UserMatch.findById(matchId)
        .select("facebookLive youtubeLive meta")
        .lean()
        .catch(() => null);
      if (sourceDoc) {
        req.headers["x-pkt-match-kind"] = "user";
      }
    }

    const fbLive = sourceDoc?.facebookLive || null;
    const metaFb = sourceDoc?.meta?.facebook || null;

    // ===== Nhánh YouTube: mỗi trận 1 broadcast + liveStream mới (dedicated) =====
    const requestedPlatform = String(req.body?.platform || "").trim().toLowerCase();
    if (requestedPlatform === "youtube") {
      const ytLive = sourceDoc?.youtubeLive || null;
      const ytCreatedMs = ytLive?.createdAt ? new Date(ytLive.createdAt).getTime() : 0;
      const ytFresh =
        Number.isFinite(ytCreatedMs) && ytCreatedMs > 0 && Date.now() - ytCreatedMs <= 60_000;
      const ytStatusUp = String(ytLive?.status || "").toUpperCase();
      const ytAllowReuse =
        !forceNew &&
        ytStatusUp !== "ENDED" &&
        ytStatusUp !== "STOPPED" &&
        (ytStatusUp === "LIVE" || ytFresh);
      if (ytAllowReuse && ytLive?.server_url && ytLive?.stream_key) {
        payload = {
          platform: "youtube",
          youtube: {
            id: ytLive.id || null,
            server_url: ytLive.server_url,
            stream_key: ytLive.stream_key,
            watch_url: ytLive.watch_url || null,
          },
        };
        return;
      }

      const refreshToken = await getCfgStr("YOUTUBE_REFRESH_TOKEN", "");
      if (!refreshToken) {
        statusCode = 400;
        payload = {
          message:
            "Chưa kết nối kênh YouTube. Vào Admin → YouTube Live để kết nối trước.",
        };
        return;
      }
      const accessExpiresAt = await getCfgStr("YOUTUBE_ACCESS_EXPIRES_AT", "");
      const privacy =
        (await getCfgStr("YT_BROADCAST_PRIVACY", "public")).trim() || "public";

      // Tiêu đề broadcast từ thông tin trận
      let ytTitle = "PickleTour Live";
      try {
        if (requestedUserMatch) {
          const um = await UserMatch.findById(matchId)
            .select("title customLeague code labelKey")
            .lean();
          ytTitle =
            (um?.customLeague?.name || um?.title || "Trận đấu") +
            " – " +
            (um?.labelKey || um?.code || "Live");
        } else {
          const m = await Match.findById(matchId)
            .populate("tournament", "name")
            .select("tournament roundLabel labelKey code")
            .lean();
          ytTitle =
            (m?.tournament?.name || "PickleTour") +
            " – " +
            (m?.roundLabel || m?.labelKey || m?.code || "Live");
        }
      } catch {}
      ytTitle = String(ytTitle).slice(0, 120);

      const ytProvider = new YouTubeProvider({
        refreshToken,
        accessToken: "",
        expiresAt: accessExpiresAt || "",
      });
      const r = await ytProvider.createLive({
        title: ytTitle,
        description: "Trực tiếp trận đấu trên PickleTour.",
        privacy,
        dedicatedStream: true,
      });

      try {
        const saveDoc = requestedUserMatch
          ? await UserMatch.findById(matchId)
          : await Match.findById(matchId);
        if (saveDoc) {
          saveDoc.youtubeLive = {
            id: r.platformLiveId,
            watch_url: r.permalinkUrl,
            server_url: r.serverUrl,
            stream_key: r.streamKey,
            createdAt: new Date(),
            status: "CREATED",
          };
          await saveDoc.save();
        }
      } catch (e) {
        console.error("[live-app][yt] save match error", e?.message || e);
      }

      payload = {
        platform: "youtube",
        youtube: {
          id: r.platformLiveId,
          server_url: r.serverUrl,
          stream_key: r.streamKey,
          watch_url: r.permalinkUrl,
        },
      };
      return;
    }

    // Hành xử như trang admin FB Live Test (không bao giờ dính "video không khả dụng"):
    // mặc định TẠO LIVE MỚI. Chỉ tái dùng live vừa tạo (<60s) VÀ phải hỏi Graph xác nhận
    // live còn nhận stream. KHÔNG tin status "LIVE" trong DB: phiên app chết không gọi
    // /live/end để lại status LIVE tới ~5 phút → tái dùng key đó = đẩy vào live FB đã kết thúc.
    const fbStatus = String(fbLive?.status || "CREATED").toUpperCase();
    const createdAtMs = fbLive?.createdAt ? new Date(fbLive.createdAt).getTime() : 0;
    const createdAtOk = Number.isFinite(createdAtMs) && createdAtMs > 0;
    const maxReuseMs = 60_000;
    const freshEnough = createdAtOk && Date.now() - createdAtMs <= maxReuseMs;
    let allowReuse =
      !forceNew &&
      fbStatus !== "ENDED" &&
      fbStatus !== "STOPPED" &&
      fbStatus !== "STALE" &&
      freshEnough &&
      !!fbLive?.id;

    if (allowReuse) {
      const reusePageToken = fbLive?.pageAccessToken || metaFb?.pageAccessToken || null;
      const info = reusePageToken
        ? await fbGetLiveVideo({
            liveVideoId: fbLive.id,
            pageAccessToken: reusePageToken,
            fields: "id,status,secure_stream_url",
          }).catch(() => null)
        : null;
      const graphStatus = String(info?.status || "").toUpperCase();
      allowReuse = ["LIVE", "LIVE_NOW", "UNPUBLISHED", "SCHEDULED_UNPUBLISHED"].includes(graphStatus);
      if (!allowReuse) {
        // Đánh dấu để không tái dùng nữa (và để thấy rõ trong DB vì sao tạo live mới).
        await MatchModel.updateOne(
          { _id: matchId },
          { $set: { "facebookLive.status": "STALE" } }
        ).catch(() => null);
      }
    }

    if (
      allowReuse &&
      fbLive &&
      (fbLive.secure_stream_url || (fbLive.server_url && fbLive.stream_key))
    ) {
      const reuseUrls = resolveFacebookReuseUrls(fbLive, metaFb);
      payload = {
        facebook: {
          liveId: fbLive.id || null,
          secure_stream_url: fbLive.secure_stream_url || null,
          server_url: fbLive.server_url || null,
          stream_key: fbLive.stream_key || null,
          pageId: fbLive.pageId || metaFb?.pageId || null,
          pageName: metaFb?.pageName || null,
          watch_url: reuseUrls.watchUrl,
          permalink_url: reuseUrls.permalinkUrl,
        },
      };
      return;
    }

    const captureRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(obj) {
        payload = obj;
        return obj;
      },
    };
    await createFacebookLiveForMatch(req, captureRes);
  })().catch((error) => {
    runnerError = error;
    const candidateStatus = Number(error?.statusCode || error?.status || 500);
    statusCode =
      Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 600
        ? candidateStatus
        : 500;
    payload = {
      message: error?.message || "Create live failed",
      detail: {
        matchId,
        source: "live-app/create-session",
      },
    };
    console.error("[live-app] create live session failed", {
      matchId,
      statusCode,
      error: error?.stack || error,
    });
  });

  pendingByMatchId.set(matchId, runner);
  await runner.finally(() => pendingByMatchId.delete(matchId));
  if (releaseLock) await releaseLock();

  if (!payload) {
    return res.status(500).json({
      message: runnerError?.message || "Create live failed",
      detail: {
        matchId,
        source: "live-app/create-session",
      },
    });
  }
  if (statusCode !== 200) {
    return res.status(statusCode).json(payload);
  }

  // YouTube → trả nguyên khối youtube (app build RTMP từ đây)
  if (payload?.platform === "youtube" || payload?.youtube) {
    const yt = payload.youtube || {};
    const yServer = yt.server_url || yt.serverUrl || null;
    const yKey = yt.stream_key || yt.streamKey || null;
    const ySecure = yt.secure_stream_url || yt.secureStreamUrl || null;
    if (ySecure == null && (!yServer || !yKey)) {
      return res.status(409).json({ message: "Không nhận được RTMP URL từ YouTube" });
    }
    await applyLatestLiveLinkToMatch({
      matchId,
      isUserMatch: matchKindIsUser(req),
      platform: "youtube",
      watchUrl: yt.watch_url || yt.watchUrl || null,
    });
    return res.json({
      platform: "youtube",
      youtube: {
        id: yt.id || yt.platformLiveId || null,
        secure_stream_url: ySecure,
        server_url: yServer,
        stream_key: yKey,
        watch_url: yt.watch_url || yt.watchUrl || null,
      },
    });
  }

  const fb =
    payload?.facebook ||
    payload?.platforms?.facebook?.live ||
    payload?.platforms?.facebook ||
    null;
  const primary = payload?.primary || null;

  const secure_stream_url =
    fb?.secure_stream_url || fb?.secureStreamUrl || primary?.secure_stream_url || primary?.secureStreamUrl || null;
  const server_url = fb?.server_url || fb?.serverUrl || primary?.server_url || primary?.serverUrl || null;
  const stream_key = fb?.stream_key || fb?.streamKey || primary?.stream_key || primary?.streamKey || null;
  const watch_url =
    fb?.watch_url ||
    fb?.watchUrl ||
    payload?.facebook_watch_url ||
    payload?.facebookWatchUrl ||
    payload?.platforms?.facebook?.live?.watch_url ||
    payload?.platforms?.facebook?.live?.watchUrl ||
    null;
  const permalink_url =
    fb?.permalink_url ||
    fb?.permalinkUrl ||
    payload?.facebook_permalink_url ||
    payload?.facebookPermalinkUrl ||
    payload?.platforms?.facebook?.live?.permalink_url ||
    payload?.platforms?.facebook?.live?.permalinkUrl ||
    null;

  if (secure_stream_url == null && (!server_url || !stream_key)) {
    return res.status(409).json({
      message: "Không nhận được RTMP URL từ server",
      detail: { hasFacebook: !!fb, hasPrimary: !!primary },
    });
  }

  await applyLatestLiveLinkToMatch({
    matchId,
    isUserMatch: matchKindIsUser(req),
    platform: "facebook",
    watchUrl: watch_url || permalink_url || null,
  });

  return res.json({
    platform: "facebook",
    facebook: {
      secure_stream_url,
      server_url,
      stream_key,
      pageId: fb?.pageId || fb?.page_id || primary?.pageId || primary?.page_id || null,
      pageName: fb?.pageName || fb?.page_name || primary?.pageName || primary?.page_name || null,
      watch_url,
      permalink_url,
    },
  });
};

export const getCourtRuntimeForLiveApp = async (req, res) => {
  setNoStoreHeaders(res);
  const courtId = String(req.params?.courtId || "").trim();
  if (!courtId) {
    return res.status(400).json({ message: "courtId is required" });
  }

  const runtime = await buildLiveAppCourtRuntime(courtId);
  if (!runtime) {
    return res.status(404).json({ message: "Court not found" });
  }

  return res.json(runtime);
};

export const getMatchRuntimeForLiveApp = async (req, res) => {
  setNoStoreHeaders(res);
  const matchId = String(req.params?.matchId || "").trim();
  if (!matchId) {
    return res.status(400).json({ message: "matchId is required" });
  }

  const prefersUserMatch =
    String(req.get("x-pkt-match-kind") || req.query?.matchKind || "")
      .trim()
      .toLowerCase() === "user";
  const runtime = await buildLiveAppMatchRuntime(matchId, {
    userMatch: prefersUserMatch,
  });
  if (!runtime) {
    return res.status(404).json({ message: "Match not found" });
  }

  return res.json(runtime);
};

// GET /api/live-app/facebook-pages
// Danh sách fanpage do admin liên kết (pool FbToken) để operator chọn khi live.
// Chỉ trả field an toàn — KHÔNG kèm access token.
export const listLiveAppFacebookPages = async (req, res) => {
  const docs = await FbToken.find({ disabled: { $ne: true } })
    .select("pageId pageName isBusy needsReauth")
    .sort({ pageName: 1 })
    .lean()
    .catch(() => []);
  const pages = (Array.isArray(docs) ? docs : [])
    .filter((d) => d && d.pageId)
    .map((d) => ({
      id: String(d.pageId),
      pageId: String(d.pageId),
      pageName: d.pageName || String(d.pageId),
      isBusy: !!d.isBusy,
      needsReauth: !!d.needsReauth,
    }));
  return res.json(pages);
};
