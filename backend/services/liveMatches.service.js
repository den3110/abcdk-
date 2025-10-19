// services/liveMatches.service.js
// ✅ Thu thập candidate từ Match KHÔNG ràng buộc status=live
// ✅ Mặc định lấy tất cả trận CHƯA finished (scheduled/queued/assigned/live)
// ✅ Sau đó verify STRICT trên platform (FB/YT). TikTok mặc định loại (chưa có API verify).

import Match from "../models/matchModel.js";
import pLimit from "p-limit";
import {
  verifyFacebookLiveWithBestToken,
  verifyYouTubeLive,
  parseFacebookVideoIdFromUrl,
  parseFacebookPageIdFromUrl,
} from "./liveVerify.service.js";

// Heuristics nhận diện platform trong field `video`
const isFacebookUrl = (u = "") => /facebook\.com/i.test(u || "");
const isYouTubeUrl = (u = "") => /(youtube\.com|youtu\.be)/i.test(u || "");
const isTikTokUrl = (u = "") => /tiktok\.com/i.test(u || "");

function buildFacebookWatchUrl({ id, permalink_url, pageId }) {
  if (permalink_url) return permalink_url;
  if (pageId && id) return `https://www.facebook.com/${pageId}/videos/${id}/`;
  if (id) return `https://www.facebook.com/video.php?v=${id}`;
  return null;
}
const buildYouTubeWatchUrl = (id) =>
  id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : null;

/**
 * Thu thập các trận có dấu hiệu stream từ Match.
 * @param {Object} opt
 * @param {number} opt.windowMs - chỉ lấy match cập nhật gần đây (mặc định 8h)
 * @param {boolean} opt.excludeFinished - mặc định true (loại status="finished")
 * @param {string[]|null} opt.statuses - nếu truyền mảng, chỉ lấy các status này (ví dụ ["scheduled","queued","assigned","live"])
 */
export async function collectStreamCandidatesFromDB({
  windowMs = 8 * 3600 * 1000,
  excludeFinished = true,
  statuses = null,
} = {}) {
  const since = new Date(Date.now() - windowMs);

  // Điều kiện nhận diện "có dấu hiệu stream"
  const streamOr = [
    { "facebookLive.id": { $exists: true, $ne: null } },
    { "facebookLive.permalink_url": { $exists: true, $ne: "" } },
    {
      video: { $regex: /(youtube\.com|youtu\.be|facebook\.com|tiktok\.com)/i },
    },
  ];
  const and = [];
  // có dấu hiệu stream
  and.push({ $or: streamOr });
  // cửa sổ thời gian
  and.push({
    $or: [{ updatedAt: { $gte: since } }, { createdAt: { $gte: since } }],
  });
  // lọc status
  if (Array.isArray(statuses) && statuses.length > 0) {
    and.push({ status: { $in: statuses } });
  } else if (excludeFinished) {
    and.push({ status: { $ne: "finished" } });
  }
  const query = { $and: and };
  // nếu muốn lấy tất cả mọi status (kể cả finished), truyền excludeFinished=false và không set statuses

  const rows = await Match.find(query)
    .select(
      [
        "_id",
        "tournament",
        "bracket",
        "code",
        "status",
        "scheduledAt",
        "startedAt",
        "court",
        "courtLabel",
        "stageIndex",
        "labelKey",
        "video",
        "facebookLive",
        "meta",
        "updatedAt",
      ].join(" ")
    )
    .lean();

  const items = [];
  for (const m of rows) {
    const sessions = [];

    // FACEBOOK từ facebookLive
    if (m.facebookLive?.id || m.facebookLive?.permalink_url) {
      const pageIdFromLink = parseFacebookPageIdFromUrl(
        m.facebookLive?.permalink_url
      );
      const liveId =
        m.facebookLive?.id ||
        parseFacebookVideoIdFromUrl(m.facebookLive?.permalink_url);

      sessions.push({
        provider: "facebook",
        platformLiveId: liveId || null,
        pageId: pageIdFromLink || m.meta?.facebook?.pageId || null,
        watchUrl: buildFacebookWatchUrl({
          id: liveId,
          permalink_url: m.facebookLive?.permalink_url,
          pageId: pageIdFromLink,
        }),
      });
    }

    // FACEBOOK từ field `video`
    if (m.video && isFacebookUrl(m.video)) {
      const liveId = parseFacebookVideoIdFromUrl(m.video);
      const pageId = parseFacebookPageIdFromUrl(m.video);
      sessions.push({
        provider: "facebook",
        platformLiveId: liveId || null,
        pageId: pageId || m.meta?.facebook?.pageId || null,
        watchUrl: buildFacebookWatchUrl({
          id: liveId,
          permalink_url: m.video,
          pageId,
        }),
      });
    }

    // YOUTUBE từ field `video` (hoặc meta.youtube.videoId nếu bạn có)
    if (m.video && isYouTubeUrl(m.video)) {
      const yid = (() => {
        try {
          const u = new URL(m.video);
          if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
          if (u.hostname.includes("youtube.com")) {
            if (u.pathname.startsWith("/watch")) return u.searchParams.get("v");
            if (u.pathname.startsWith("/live/"))
              return u.pathname.split("/").pop();
          }
        } catch (_) {}
        const rx = m.video.match(
          /(?:youtu\.be\/|v=|\/live\/)([A-Za-z0-9_\-]{6,})/
        );
        return rx?.[1] || m?.meta?.youtube?.videoId || null;
      })();

      if (yid) {
        sessions.push({
          provider: "youtube",
          platformLiveId: yid,
          watchUrl: buildYouTubeWatchUrl(yid),
        });
      }
    }

    // TikTok (chưa có verify công khai → sẽ bị loại ở strict)
    if (m.video && isTikTokUrl(m.video)) {
      sessions.push({
        provider: "tiktok",
        platformLiveId: null,
        watchUrl: m.video,
      });
    }

    if (sessions.length === 0) continue;

    items.push({
      matchId: m._id,
      match: {
        _id: m._id,
        code: m.code,
        status: m.status,
        tournamentId: m.tournament,
        bracketId: m.bracket,
        courtId: m.court,
        courtLabel: m.courtLabel || "",
        stageIndex: m.stageIndex,
        labelKey: m.labelKey,
        scheduledAt: m.scheduledAt,
        startedAt: m.startedAt,
        updatedAt: m.updatedAt,
      },
      platforms: [...new Set(sessions.map((s) => s.provider))],
      sessions,
    });
  }

  // sort mới nhất lên
  items.sort(
    (a, b) => new Date(b.match.updatedAt) - new Date(a.match.updatedAt)
  );
  return items;
}

/**
 * Verify STRICT:
 *  - Facebook: verifyGraph ok → giữ
 *  - YouTube: videos.list ok (đang live) → giữ
 *  - TikTok: loại (mặc định, vì chưa verify chắc chắn)
 */
export async function verifyStrict(rows, { concurrency = 4 } = {}) {
  const limit = pLimit(concurrency);
  const tasks = [];

  for (const row of rows) {
    for (const s of row.sessions) {
      tasks.push(
        limit(async () => {
          if (s.provider === "facebook") {
            const v = await verifyFacebookLiveWithBestToken({
              liveId: s.platformLiveId,
              pageId: s.pageId || null,
            });
            s.platformVerified = !!v.ok;
            s.platformRaw = v.raw ?? null;
            if (!s.watchUrl && v.raw?.permalink_url)
              s.watchUrl = v.raw.permalink_url;
          } else if (s.provider === "youtube") {
            const v = await verifyYouTubeLive(s.platformLiveId);
            s.platformVerified = !!v.ok;
            s.platformRaw = v.raw ?? null;
          } else {
            s.platformVerified = false; // tiktok & others → loại trong strict
          }
        })
      );
    }
  }
  await Promise.all(tasks);

  // Lọc nghiêm
  for (const row of rows) {
    row.sessions = row.sessions.filter((s) => s.platformVerified === true);
    row.platforms = [...new Set(row.sessions.map((s) => s.provider))];
  }
  return rows.filter((r) => r.sessions.length > 0);
}
