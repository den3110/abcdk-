// services/liveMatches.service.js
// ✅ Thu thập candidate KHÔNG đụng tới field `video`
// ✅ Dựa vào facebookLive / youtubeLive / tiktokLive và meta.*
// ✅ Verify STRICT (no-API): có id hoặc watchUrl/roomUrl là pass
// ✅ NEW: Mã trận dạng VT
//     - Knockout/...:   V{virtualRound}-T{indexInRound}
//     - Group (vòng bảng): V{virtualRound}-B{groupIndex}-T{indexInGroup}
//   Trong đó virtualRound (V) được CỘNG DỒN giữa các bracket trong cùng giải:
//     - Bracket type !== "group": trọng số = số vòng của bracket (meta.maxRounds || drawRounds || 1)
//     - Bracket type === "group": trọng số = 1 (như bạn yêu cầu)
//   Ví dụ: Giải có 2 bracket, bracket1 có 2 vòng → bracket2 bắt đầu từ V3 (trận đầu: V3-T1)

import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";
import pLimit from "p-limit"; // giữ import để tương thích nơi khác
import {
  verifyFacebookLiveWithBestToken,
  verifyYouTubeLive,
  parseFacebookVideoIdFromUrl,
  parseFacebookPageIdFromUrl,
} from "./liveVerify.service.js";
import { fbThumbFromId, fetchOgImage, ytThumbCandidates } from "./thumb.service.js";

/* ───────────────────────── Helpers ───────────────────────── */
const isNonEmpty = (v) =>
  v !== undefined && v !== null && String(v).trim().length > 0;

function buildFacebookWatchUrl({ id, permalink_url, pageId }) {
  if (isNonEmpty(permalink_url)) return permalink_url;
  if (isNonEmpty(pageId) && isNonEmpty(id))
    return `https://www.facebook.com/${pageId}/videos/${id}/`;
  if (isNonEmpty(id)) return `https://www.facebook.com/video.php?v=${id}`;
  return null;
}
const buildYouTubeWatchUrl = (id) =>
  isNonEmpty(id)
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
    : null;

const buildTikTokWatchUrl = ({ watchUrl, username }) => {
  if (isNonEmpty(watchUrl)) return watchUrl;
  if (isNonEmpty(username)) return `https://www.tiktok.com/@${username}/live`;
  return null;
};

/** Lấy trọng số số vòng của một bracket để cộng dồn V */
function weightOfBracket(br) {
  if (!br) return 1;
  if (br.type === "group") return 1; // vòng bảng tính 1 vòng như yêu cầu
  const metaRounds = br?.meta?.maxRounds;
  const drawRounds = br?.drawRounds;
  if (Number.isInteger(metaRounds) && metaRounds > 0) return metaRounds;
  if (Number.isInteger(drawRounds) && drawRounds > 0) return drawRounds;
  // fallback an toàn
  return 1;
}

/** Xây map virtual V start cho từng bracket theo GIẢI (tournament) */
async function buildVirtualVIndexMap(rows) {
  // gom tournamentIds & bracketIds từ danh sách match
  const tourSet = new Set();
  const bracketSet = new Set();
  for (const m of rows) {
    if (m.tournament) tourSet.add(String(m.tournament));
    if (m.bracket) bracketSet.add(String(m.bracket));
  }
  const tournamentIds = [...tourSet];

  // fetch toàn bộ brackets của các giải liên quan (để cộng dồn theo stage/order)
  const brackets = await Bracket.find({
    tournament: { $in: tournamentIds },
  })
    .select({
      _id: 1,
      tournament: 1,
      type: 1,
      stage: 1,
      order: 1,
      meta: 1, // meta.maxRounds
      drawRounds: 1,
      groups: 1, // để map B (group index) nếu có
    })
    .sort({ tournament: 1, stage: 1, order: 1, createdAt: 1 })
    .lean();

  // group theo tournament
  const byTournament = new Map();
  for (const br of brackets) {
    const tId = String(br.tournament);
    if (!byTournament.has(tId)) byTournament.set(tId, []);
    byTournament.get(tId).push(br);
  }

  // tính V-start cho từng bracket
  const vStartMap = new Map(); // key: bracketId -> { vStart, weight, type, groups }
  for (const [tId, list] of byTournament.entries()) {
    let acc = 1; // V bắt đầu từ 1 trong mỗi giải
    for (const br of list) {
      const w = weightOfBracket(br);
      vStartMap.set(String(br._id), {
        vStart: acc,
        weight: w,
        type: br.type,
        groups: Array.isArray(br.groups) ? br.groups.map((g) => g?.name) : [],
      });
      acc += w; // cộng dồn
    }
  }
  return vStartMap;
}

/** Chuẩn hoá B (group index):
 *  - Nếu match.pool.name trùng group name trong bracket → dùng index+1
 *  - Nếu name là chữ cái (A/B/...) → A→1, B→2...
 *  - Nếu là số → Number(name)
 *  - Fallback = 1
 */
function computeBIndex(poolName, bracketGroups = []) {
  if (isNonEmpty(poolName)) {
    // thử map theo groups trong bracket
    const idx = bracketGroups.findIndex(
      (n) => String(n || "").toUpperCase() === String(poolName).toUpperCase()
    );
    if (idx >= 0) return idx + 1;

    const s = String(poolName).trim().toUpperCase();
    if (/^[A-Z]$/.test(s)) return s.charCodeAt(0) - 64; // 'A'->1
    if (/^\d+$/.test(s)) return Math.max(1, parseInt(s, 10));
  }
  return 1;
}

/** Mã trận VT / VBT tuỳ theo bracket type */
function buildVTCodeForMatch(m, vInfo) {
  const order0 = Number.isInteger(m.order) ? m.order : 0; // 0-based
  const round = Number.isInteger(m.round) && m.round > 0 ? m.round : 1;

  const vBase = vInfo?.vStart || 1;
  const isGroup = vInfo?.type === "group";

  if (isGroup) {
    // Vòng bảng: V{vBase}-B{groupIndex}-T{indexInGroup}
    const bIndex = computeBIndex(m?.pool?.name, vInfo?.groups || []);
    const tIndex = order0 + 1; // đơn giản: theo order trong pool/rrRound
    return `V${vBase}-B${bIndex}-T${tIndex}`;
  }

  // Knockout/...: V cộng dồn theo round trong bracket
  const v = vBase + (round - 1);
  const tIndex = order0 + 1;
  return `V${v}-T${tIndex}`;
}

/* ───────────────────────── Core ───────────────────────── */

/**
 * Thu thập các trận có dấu hiệu stream từ DB (FB/YT/TikTok).
 * @param {Object} opt
 * @param {number} opt.windowMs - chỉ lấy match cập nhật gần đây (mặc định 8h) — đang TẮT để lấy đủ
 * @param {boolean} opt.excludeFinished - mặc định true (loại status="finished")
 * @param {string[]|null} opt.statuses - nếu có sẽ lọc theo các status này
 * @param {string} opt.sortField - "updatedAt" | "createdAt" | "startedAt" ...
 */
export async function collectStreamCandidatesFromDB({
  windowMs = 8 * 3600 * 1000,
  excludeFinished = true,
  statuses = null,
  sortField = "updatedAt",
} = {}) {
  // Có dấu hiệu stream trên BẤT KỲ nền tảng nào
  const streamOr = [
    // Facebook
    { "facebookLive.id": { $type: "string" } },
    { "facebookLive.permalink_url": { $type: "string" } },
    { "meta.facebook.pageId": { $type: "string" } },
    { "meta.facebook.permalinkUrl": { $type: "string" } },

    // YouTube
    { "youtubeLive.id": { $type: "string" } },
    { "youtubeLive.watch_url": { $type: "string" } },
    { "meta.youtube.videoId": { $type: "string" } },
    { "meta.youtube.watchUrl": { $type: "string" } },

    // TikTok
    { "tiktokLive.id": { $type: "string" } },
    { "tiktokLive.room_url": { $type: "string" } },
    { "meta.tiktok.roomId": { $type: "string" } },
    { "meta.tiktok.watchUrl": { $type: "string" } },
    { "meta.tiktok.username": { $type: "string" } },
  ];

  const and = [{ $or: streamOr }];

  // Đã tắt filter theo thời gian để gom cả live cũ/mới
  // if (windowMs > 0) {
  //   const since = new Date(Date.now() - windowMs);
  //   and.push({
  //     $or: [{ [sortField]: { $gte: since } }, { createdAt: { $gte: since } }],
  //   });
  // }

  if (Array.isArray(statuses) && statuses.length > 0) {
    and.push({ status: { $in: statuses } });
  } else if (excludeFinished) {
    and.push({ status: { $ne: "finished" } });
  }

  const query = { $and: and };

  // Chỉ lấy trường cần thiết (thêm round/order/pool để build VT code)
  const rows = await Match.find(query)
    .sort({ [sortField]: -1 })
    .select({
      _id: 1,
      tournament: 1,
      bracket: 1,

      // VT code fields
      round: 1, // 1-based trong bracket (KO)
      order: 1, // 0-based vị trí trong round/pool
      pool: 1, // { name, id } cho vòng bảng

      code: 1, // giữ raw DB nếu cần đối chiếu
      status: 1,
      scheduledAt: 1,
      startedAt: 1,
      court: 1,
      courtLabel: 1,

      stageIndex: 1, // vẫn trả về để tương thích FE cũ nếu dùng
      labelKey: 1,

      facebookLive: 1,
      youtubeLive: 1,
      tiktokLive: 1,

      // Meta tối giản theo provider
      "meta.facebook.pageId": 1,
      "meta.facebook.permalinkUrl": 1,
      "meta.facebook.pageName": 1,

      "meta.youtube.videoId": 1,
      "meta.youtube.watchUrl": 1,
      "meta.youtube.channelId": 1,

      "meta.tiktok.roomId": 1,
      "meta.tiktok.username": 1,
      "meta.tiktok.watchUrl": 1,

      updatedAt: 1,
      createdAt: 1,
    })
    .lean();

  if (!rows.length) return [];

  // Tính map V-start cho từng bracket trong các giải liên quan
  const vStartMap = await buildVirtualVIndexMap(rows);

  const items = [];
  for (const m of rows) {
    const sessions = [];

    /* ───── Facebook ───── */
    if (
      m.facebookLive?.id ||
      m.facebookLive?.permalink_url ||
      m?.meta?.facebook?.permalinkUrl
    ) {
      const pageIdFromLink =
        m.facebookLive?.pageId || m?.meta?.facebook?.pageId || null;
      const liveId =
        m.facebookLive?.id ||
        parseFacebookVideoIdFromUrl(
          m.facebookLive?.permalink_url || m?.meta?.facebook?.permalinkUrl
        );

      const watchUrl = buildFacebookWatchUrl({
        id: liveId,
        permalink_url:
          m.facebookLive?.permalink_url ||
          m?.meta?.facebook?.permalinkUrl ||
          null,
        pageId: pageIdFromLink,
      });

      if (liveId || watchUrl) {
        const fbThumb = fbThumbFromId(liveId);
        let thumbnails = [];
        if (fbThumb) thumbnails = [fbThumb];
        else if (watchUrl) {
          const og = await fetchOgImage(watchUrl); // ✅ 1 request, có cache
          if (og) thumbnails = [og];
        }

        sessions.push({
          provider: "facebook",
          platformLiveId: liveId || null,
          pageId: pageIdFromLink,
          watchUrl: watchUrl,
          thumbnails,
        });
      }
    }

    /* ───── YouTube ───── */
    {
      const yId = m.youtubeLive?.id || m?.meta?.youtube?.videoId || null;

      const yWatch =
        m.youtubeLive?.watch_url ||
        m?.meta?.youtube?.watchUrl ||
        buildYouTubeWatchUrl(yId);

      if (yId || yWatch) {
        sessions.push({
          provider: "youtube",
          platformLiveId: yId || null,
          watchUrl: yWatch || null,
          channelId: m?.meta?.youtube?.channelId || null,
          thumbnails: ytThumbCandidates(yId), // ✅ không cần fetch
        });
      }
    }

    /* ───── TikTok ───── */
    {
      const roomId = m.tiktokLive?.id || m?.meta?.tiktok?.roomId || null;

      const username = m?.meta?.tiktok?.username || null;

      const roomUrl =
        m.tiktokLive?.room_url ||
        m?.meta?.tiktok?.watchUrl ||
        buildTikTokWatchUrl({ watchUrl: null, username });

      if (roomId || roomUrl) {
        let thumbnails = [];
        if (roomUrl) {
          const og = await fetchOgImage(roomUrl);
          if (og) thumbnails = [og];
        }
        sessions.push({
          provider: "tiktok",
          platformLiveId: roomId || null,
          watchUrl: roomUrl || null,
          username: username || null,
          thumbnails,
        });
      }
    }

    if (sessions.length === 0) continue;

    // ✅ Build VT code theo quy tắc cộng dồn giữa các bracket
    const vInfo = vStartMap.get(String(m.bracket)) || { vStart: 1, type: "" };
    const codeVT = buildVTCodeForMatch(m, vInfo);

    items.push({
      matchId: m._id,
      match: {
        _id: m._id,

        // === MÃ HIỂN THỊ MỚI ===
        code: codeVT, // ví dụ: V3-T1 hoặc V1-B2-T3

        // Thông tin tham chiếu / tương thích
        codeRaw: m.code || "",
        labelKey: m.labelKey || "",
        stageIndex: m.stageIndex,
        round: Number.isInteger(m.round) ? m.round : null,
        order0: Number.isInteger(m.order) ? m.order : null,
        order1: Number.isInteger(m.order) && m.order >= 0 ? m.order + 1 : null,
        pool: m.pool || null, // giữ pool cho FE nếu cần

        status: m.status,
        tournamentId: m.tournament,
        bracketId: m.bracket,
        courtId: m.court,
        courtLabel: m.courtLabel || "",
        scheduledAt: m.scheduledAt,
        startedAt: m.startedAt,
        updatedAt: m.updatedAt,
        createdAt: m.createdAt,
      },
      platforms: [...new Set(sessions.map((s) => s.provider))],
      sessions,
    });
  }

  // DB đã sort rồi
  return items;
}

/**
 * Verify STRICT (no-API):
 *  - Facebook/YouTube/TikTok: chỉ cần có id HOẶC có watchUrl/roomUrl là pass
 *  - Tránh gọi API để không ăn rate limit
 */
export async function verifyStrict(rows, { concurrency = 4 } = {}) {
  for (const row of rows) {
    for (const s of row.sessions || []) {
      const hasId = isNonEmpty(s.platformLiveId);
      const hasUrl = isNonEmpty(s.watchUrl);
      s.platformVerified = Boolean(hasId || hasUrl);
      s.platformState = s.platformVerified ? "assumed" : "invalid";
    }
    row.sessions = (row.sessions || []).filter((s) => s.platformVerified);
    row.platforms = [...new Set(row.sessions.map((s) => s.provider))];
  }
  return rows.filter((r) => (r.sessions || []).length > 0);
}
