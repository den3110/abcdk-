// controllers/liveMatchesController.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";
import { CACHE_GROUP_IDS } from "../services/cacheGroups.js";
import {
  attachPublicStreamsToMatch,
  getLatestRecordingsByMatchIds,
} from "../services/publicStreams.service.js";
import {
  buildMatchDisplayContextsFromMatches,
  buildMatchSummary,
} from "../services/courtCluster.service.js";

const LIVE_MATCHES_CACHE_TTL_MS = Math.max(
  1000,
  Number(process.env.LIVE_MATCHES_CACHE_TTL_MS || 3000)
);

const liveMatchesCache = createShortTtlCache(LIVE_MATCHES_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.liveMatches,
  label: "Live matches list",
  category: "live",
  scope: "public",
});

const DEFAULT_WINDOW_MS = 8 * 3600 * 1000;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;
const DEFAULT_STATUSES = ["scheduled", "queued", "assigned", "live"];
const RECORDING_STREAM_STATUSES = [
  "recording",
  "uploading",
  "pending_export_window",
  "exporting",
  "ready",
];

const MATCH_LIST_SELECT = [
  "_id",
  "tournament",
  "bracket",
  "status",
  "currentGame",
  "courtStation",
  "courtStationLabel",
  "courtLabel",
  "courtClusterId",
  "courtClusterLabel",
  "labelKey",
  "format",
  "seedA",
  "seedB",
  "phase",
  "groupCode",
  "pool",
  "group",
  "groupNo",
  "groupIndex",
  "orderInGroup",
  "rrRound",
  "round",
  "order",
  "matchNo",
  "index",
  "stageIndex",
  "facebookLive",
  "pairA",
  "pairB",
  "gameScores",
  "live",
  "scheduledAt",
  "startedAt",
  "finishedAt",
  "updatedAt",
  "createdAt",
  "video",
  "playbackUrl",
  "streamUrl",
  "liveUrl",
  "meta",
  "youtubeLive",
  "tiktokLive",
].join(" ");

const MATCH_LIST_POPULATE = [
  {
    path: "tournament",
    select: "name image status eventType nameDisplayMode",
  },
  {
    path: "bracket",
    select: "_id name type stage order",
  },
  {
    path: "pairA",
    populate: [
      {
        path: "player1.user",
        select: "name fullName nickname nickName avatar",
      },
      {
        path: "player2.user",
        select: "name fullName nickname nickName avatar",
      },
    ],
  },
  {
    path: "pairB",
    populate: [
      {
        path: "player1.user",
        select: "name fullName nickname nickName avatar",
      },
      {
        path: "player2.user",
        select: "name fullName nickname nickName avatar",
      },
    ],
  },
];

const STREAM_CANDIDATE_CLAUSES = [
  { "facebookLive.permalink_url": { $exists: true, $ne: "" } },
  { "facebookLive.video_permalink_url": { $exists: true, $ne: "" } },
  { "facebookLive.watch_url": { $exists: true, $ne: "" } },
  { "facebookLive.id": { $exists: true, $ne: "" } },
  { "meta.facebook.permalinkUrl": { $exists: true, $ne: "" } },
  { "meta.youtube.watchUrl": { $exists: true, $ne: "" } },
  { "meta.youtube.videoId": { $exists: true, $ne: "" } },
  { "youtubeLive.watch_url": { $exists: true, $ne: "" } },
  { "youtubeLive.id": { $exists: true, $ne: "" } },
  { "meta.tiktok.watchUrl": { $exists: true, $ne: "" } },
  { "meta.tiktok.username": { $exists: true, $ne: "" } },
  { "tiktokLive.room_url": { $exists: true, $ne: "" } },
  { "tiktokLive.id": { $exists: true, $ne: "" } },
  { "meta.rtmp.publicUrl": { $exists: true, $ne: "" } },
  { "meta.rtmp.viewUrl": { $exists: true, $ne: "" } },
  { "meta.rtmp.url": { $exists: true, $ne: "" } },
  { video: { $exists: true, $ne: "" } },
  { playbackUrl: { $exists: true, $ne: "" } },
  { streamUrl: { $exists: true, $ne: "" } },
  { liveUrl: { $exists: true, $ne: "" } },
];

function parsePositiveInt(
  value,
  fallback,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {}
) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = Math.trunc(number);
  if (normalized < min) return fallback;
  return Math.min(normalized, max);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseCsv(value, fallback = []) {
  const items = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : fallback;
}

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function statusPriority(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "live":
      return 0;
    case "assigned":
      return 1;
    case "queued":
      return 2;
    case "scheduled":
      return 3;
    case "finished":
      return 4;
    default:
      return 5;
  }
}

function getMatchSortTime(match) {
  return new Date(
    match?.updatedAt ||
      match?.finishedAt ||
      match?.startedAt ||
      match?.scheduledAt ||
      match?.createdAt ||
      0
  ).getTime();
}

function compareLiveMatches(left, right) {
  const priorityDiff = statusPriority(left?.status) - statusPriority(right?.status);
  if (priorityDiff !== 0) return priorityDiff;

  const timeDiff = getMatchSortTime(right) - getMatchSortTime(left);
  if (timeDiff !== 0) return timeDiff;

  return String(left?._id || "").localeCompare(String(right?._id || ""));
}

function buildTournamentBuckets(items = []) {
  const map = new Map();

  items.forEach((item) => {
    const tournamentId = toIdString(item?.tournament?._id || item?.tournament);
    if (!tournamentId) return;

    const current =
      map.get(tournamentId) ||
      {
        _id: tournamentId,
        name: String(item?.tournament?.name || "Khong ro giai").trim(),
        image: item?.tournament?.image || "",
        count: 0,
        liveCount: 0,
        finishedCount: 0,
      };

    current.count += 1;
    if (String(item?.status || "").toLowerCase() === "live") current.liveCount += 1;
    if (String(item?.status || "").toLowerCase() === "finished") {
      current.finishedCount += 1;
    }

    map.set(tournamentId, current);
  });

  return Array.from(map.values()).sort((left, right) => {
    if (right.liveCount !== left.liveCount) return right.liveCount - left.liveCount;
    if (right.count !== left.count) return right.count - left.count;
    return String(left.name || "").localeCompare(String(right.name || ""), "vi");
  });
}

function buildSearchText(item = {}) {
  const streams = Array.isArray(item?.streams) ? item.streams : [];
  return [
    item?._id,
    item?.code,
    item?.displayCode,
    item?.globalCode,
    item?.labelKey,
    item?.status,
    item?.courtLabel,
    item?.courtStationName,
    item?.courtClusterName,
    item?.tournament?.name,
    item?.bracket?.name,
    item?.pool?.name,
    item?.pairA?.name,
    item?.pairB?.name,
    item?.pairA?.player1?.user?.name,
    item?.pairA?.player2?.user?.name,
    item?.pairB?.player1?.user?.name,
    item?.pairB?.player2?.user?.name,
    ...streams.map((stream) =>
      [
        stream?.key,
        stream?.displayLabel,
        stream?.providerLabel,
        stream?.playUrl,
        stream?.openUrl,
      ]
        .filter(Boolean)
        .join(" ")
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function paginate(items = [], page = 1, limit = DEFAULT_LIMIT) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * limit;

  return {
    items: items.slice(start, start + limit),
    total,
    page: safePage,
    pages,
    limit,
  };
}

async function getStreamRecordingMatchIds() {
  const ids = await LiveRecordingV2.distinct("match", {
    status: { $in: RECORDING_STREAM_STATUSES },
  });
  return ids.map((id) => toIdString(id)).filter(Boolean);
}

export async function listLiveMatches(req, res) {
  try {
    const statuses = parseCsv(req.query.statuses, DEFAULT_STATUSES);
    const q = String(req.query.q || req.query.keyword || "").trim();
    const selectedTournamentIds = new Set(
      parseCsv(req.query.tournamentId).filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
      )
    );
    const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, {
      min: 1,
      max: MAX_LIMIT,
    });
    const page = parsePositiveInt(req.query.page, 1, { min: 1 });
    const excludeFinished = parseBoolean(req.query.excludeFinished, true);
    const includeAll = parseBoolean(req.query.all, false);
    const windowMs = parsePositiveInt(req.query.windowMs, DEFAULT_WINDOW_MS, {
      min: 1,
      max: 365 * 24 * 3600 * 1000,
    });

    const cacheKey = JSON.stringify({
      statuses,
      q,
      tournamentIds: Array.from(selectedTournamentIds).sort(),
      limit,
      page,
      excludeFinished,
      includeAll,
      windowMs,
    });

    const cached = liveMatchesCache.get(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=2, stale-while-revalidate=5");
      res.setHeader("X-PKT-Cache", "HIT");
      return res.json(cached);
    }

    const recordingMatchIds = await getStreamRecordingMatchIds();
    const candidateClauses = [...STREAM_CANDIDATE_CLAUSES];
    if (recordingMatchIds.length > 0) {
      candidateClauses.push({ _id: { $in: recordingMatchIds } });
    }

    const candidateQuery = {
      $and: [
        { $or: candidateClauses },
        statuses.length > 0
          ? { status: { $in: statuses } }
          : excludeFinished
            ? { status: { $ne: "finished" } }
            : {},
        !includeAll
          ? {
              $or: [
                { updatedAt: { $gte: new Date(Date.now() - windowMs) } },
                { startedAt: { $gte: new Date(Date.now() - windowMs) } },
                { finishedAt: { $gte: new Date(Date.now() - windowMs) } },
                { createdAt: { $gte: new Date(Date.now() - windowMs) } },
              ],
            }
          : {},
      ].filter((clause) => Object.keys(clause).length > 0),
    };

    const matches = await Match.find(candidateQuery)
      .select(MATCH_LIST_SELECT)
      .populate(MATCH_LIST_POPULATE)
      .sort({ updatedAt: -1, startedAt: -1, createdAt: -1 })
      .lean();

    if (!matches.length) {
      const emptyPayload = {
        count: 0,
        countLive: 0,
        items: [],
        page,
        pages: 1,
        limit,
        tournaments: [],
        meta: {
          at: new Date().toISOString(),
          filter: {
            statuses,
            excludeFinished,
            includeAll,
            windowMs: includeAll ? null : windowMs,
            q,
            tournamentIds: Array.from(selectedTournamentIds),
          },
        },
      };

      liveMatchesCache.set(cacheKey, emptyPayload);
      res.setHeader("Cache-Control", "public, max-age=2, stale-while-revalidate=5");
      res.setHeader("X-PKT-Cache", "MISS");
      return res.json(emptyPayload);
    }

    const latestRecordingsByMatchId = await getLatestRecordingsByMatchIds(matches);
    const matchDisplayContexts = await buildMatchDisplayContextsFromMatches(matches);

    let items = matches
      .map((match) => {
        const summary = buildMatchSummary(match, { matchDisplayContexts });
        return attachPublicStreamsToMatch(
          {
            ...summary,
            meta: match.meta || {},
            video: match.video || "",
            playbackUrl: match.playbackUrl || "",
            streamUrl: match.streamUrl || "",
            liveUrl: match.liveUrl || "",
            youtubeLive: match.youtubeLive || null,
            tiktokLive: match.tiktokLive || null,
            courtLabel: summary?.courtLabel || summary?.courtStationName || "",
          },
          latestRecordingsByMatchId.get(String(match._id))
        );
      })
      .filter((item) => Array.isArray(item?.streams) && item.streams.length > 0);

    if (q) {
      const normalizedQuery = q.toLowerCase();
      items = items.filter((item) => buildSearchText(item).includes(normalizedQuery));
    }

    const tournaments = buildTournamentBuckets(items);

    if (selectedTournamentIds.size > 0) {
      items = items.filter((item) =>
        selectedTournamentIds.has(toIdString(item?.tournament?._id || item?.tournament))
      );
    }

    items.sort(compareLiveMatches);

    const { items: pageItems, total, pages, page: safePage } = paginate(
      items,
      page,
      limit
    );

    const countLive = items.filter(
      (item) => String(item?.status || "").toLowerCase() === "live"
    ).length;

    const payload = {
      count: total,
      countLive,
      items: pageItems,
      page: safePage,
      pages,
      limit,
      tournaments,
      meta: {
        source: "match-streams",
        filter: {
          statuses,
          excludeFinished,
          includeAll,
          windowMs: includeAll ? null : windowMs,
          q,
          tournamentIds: Array.from(selectedTournamentIds),
        },
        at: new Date().toISOString(),
      },
    };

    liveMatchesCache.set(cacheKey, payload);
    res.setHeader("Cache-Control", "public, max-age=2, stale-while-revalidate=5");
    res.setHeader("X-PKT-Cache", "MISS");
    res.json(payload);
  } catch (e) {
    console.error("listLiveMatches error:", e);
    res.status(500).json({ error: e.message });
  }
}

export async function deleteLiveVideoForMatch(req, res) {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ message: "matchId is required" });
    }

    const updated = await Match.findByIdAndUpdate(
      matchId,
      {
        $unset: {
          facebookLive: 1,
        },
      },
      {
        new: true,
      }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: "Match khong ton tai" });
    }

    liveMatchesCache.clear();

    return res.json({
      message: "Da xoa thong tin video khoi match",
      matchId: updated._id,
      facebookLive: updated.facebookLive || null,
    });
  } catch (e) {
    console.error("deleteLiveVideoForMatch error:", e);
    return res.status(500).json({ message: e.message || "Server error" });
  }
}
