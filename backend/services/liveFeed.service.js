import mongoose from "mongoose";

import Match from "../models/matchModel.js";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import {
  attachPublicStreamsToMatch,
  getLatestRecordingsByMatchIds,
} from "./publicStreams.service.js";
import {
  buildMatchDisplayContextsFromMatches,
  buildMatchSummary,
} from "./courtCluster.service.js";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

const LIVE_FEED_MODE_STATUSES = Object.freeze({
  all: ["live", "assigned", "queued", "finished"],
  live: ["live", "assigned", "queued"],
  replay: ["finished"],
});

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

const RECORDING_STREAM_STATUSES = [
  "recording",
  "uploading",
  "pending_export_window",
  "exporting",
  "ready",
];

function ytThumbCandidates(videoId) {
  const normalizedVideoId = asTrimmed(videoId);
  if (!normalizedVideoId) return [];
  return [
    `https://i.ytimg.com/vi/${normalizedVideoId}/maxresdefault_live.jpg`,
    `https://i.ytimg.com/vi/${normalizedVideoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${normalizedVideoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${normalizedVideoId}/hqdefault.jpg`,
  ];
}

function fbThumbFromId(videoId) {
  const normalizedVideoId = asTrimmed(videoId);
  if (!normalizedVideoId) return "";
  return `https://graph.facebook.com/${normalizedVideoId}/picture?type=large`;
}

function asTrimmed(value) {
  return String(value || "").trim();
}

function toIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function parsePositiveInt(
  value,
  fallback,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = Math.trunc(number);
  if (normalized < min) return fallback;
  return Math.min(normalized, max);
}

export function normalizeLiveFeedMode(mode) {
  const normalized = asTrimmed(mode).toLowerCase();
  return LIVE_FEED_MODE_STATUSES[normalized] ? normalized : "all";
}

export function getLiveFeedModeStatuses(mode) {
  return [...LIVE_FEED_MODE_STATUSES[normalizeLiveFeedMode(mode)]];
}

function isReadyStream(stream) {
  return stream?.ready !== false;
}

function getIframeRank(stream) {
  const key = asTrimmed(stream?.key).toLowerCase();
  const kind = asTrimmed(stream?.kind).toLowerCase();
  const provider = asTrimmed(stream?.providerLabel).toLowerCase();

  if (kind === "iframe_html") return 0;
  if (kind === "facebook" || key === "server1" || provider.includes("facebook")) {
    return 1;
  }
  if (key === "youtube" || provider.includes("youtube")) return 2;
  if (key === "tiktok" || provider.includes("tiktok")) return 3;
  if (kind === "iframe") return 4;
  return 5;
}

function getFeedStreamTypeRank(stream) {
  const key = asTrimmed(stream?.key).toLowerCase();
  const kind = asTrimmed(stream?.kind).toLowerCase();

  if (key === "server2") return 0;
  if (kind === "file") return 1;
  if (kind === "hls") return 2;
  if (kind === "delayed_manifest") return 3;
  return 10 + getIframeRank(stream);
}

function compareFeedStreams(left, right) {
  const readyDiff = Number(isReadyStream(right)) - Number(isReadyStream(left));
  if (readyDiff !== 0) return readyDiff;

  const typeDiff = getFeedStreamTypeRank(left) - getFeedStreamTypeRank(right);
  if (typeDiff !== 0) return typeDiff;

  const priorityDiff = Number(left?.priority || 99) - Number(right?.priority || 99);
  if (priorityDiff !== 0) return priorityDiff;

  return asTrimmed(left?.key).localeCompare(asTrimmed(right?.key));
}

function findStreamByKey(streams = [], key = "") {
  const normalizedKey = asTrimmed(key);
  if (!normalizedKey) return null;
  return streams.find((stream) => asTrimmed(stream?.key) === normalizedKey) || null;
}

function isNativeStreamKind(kind) {
  return ["file", "hls", "delayed_manifest"].includes(
    asTrimmed(kind).toLowerCase(),
  );
}

function selectYouTubeVideoId(match = {}) {
  const direct = asTrimmed(
    match?.meta?.youtube?.videoId || match?.youtubeLive?.id,
  );
  if (direct) return direct;

  const watchUrl = asTrimmed(
    match?.meta?.youtube?.watchUrl || match?.youtubeLive?.watch_url,
  );
  if (!watchUrl) return "";

  try {
    const url = new URL(watchUrl);
    if (url.hostname.includes("youtu.be")) {
      return asTrimmed(url.pathname.split("/").filter(Boolean)[0]);
    }
    return asTrimmed(url.searchParams.get("v"));
  } catch {
    const matched =
      watchUrl.match(/[?&]v=([^&]+)/i) ||
      watchUrl.match(/youtu\.be\/([^?&/]+)/i);
    return asTrimmed(matched?.[1]);
  }
}

function selectFacebookVideoId(match = {}) {
  return asTrimmed(
    match?.facebookLive?.videoId ||
      match?.facebookLive?.id ||
      match?.meta?.facebook?.videoId ||
      match?.meta?.facebook?.liveId,
  );
}

function buildFeedSearchText(item = {}) {
  return [
    item?._id,
    item?.status,
    item?.code,
    item?.displayCode,
    item?.globalCode,
    item?.labelKey,
    item?.tournament?.name,
    item?.bracket?.name,
    item?.pool?.name,
    item?.courtLabel,
    item?.courtStationName,
    item?.courtClusterName,
    item?.teamAName,
    item?.teamBName,
    item?.pairA?.name,
    item?.pairB?.name,
    ...(Array.isArray(item?.streams)
      ? item.streams.flatMap((stream) => [
          stream?.key,
          stream?.displayLabel,
          stream?.providerLabel,
          stream?.openUrl,
        ])
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getMatchSortTime(match) {
  return new Date(
    match?.updatedAt ||
      match?.finishedAt ||
      match?.startedAt ||
      match?.scheduledAt ||
      match?.createdAt ||
      0,
  ).getTime();
}

function statusPriority(status) {
  switch (asTrimmed(status).toLowerCase()) {
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

export function compareLiveFeedItems(left, right) {
  const priorityDiff = statusPriority(left?.status) - statusPriority(right?.status);
  if (priorityDiff !== 0) return priorityDiff;

  const timeDiff = getMatchSortTime(right) - getMatchSortTime(left);
  if (timeDiff !== 0) return timeDiff;

  return asTrimmed(left?._id).localeCompare(asTrimmed(right?._id));
}

export function pickFeedPreferredStream(streams = [], defaultStreamKey = "") {
  const items = Array.isArray(streams) ? streams.filter(Boolean) : [];
  if (!items.length) return null;

  const explicitDefault = findStreamByKey(items, defaultStreamKey);
  const preferred = [...items].sort(compareFeedStreams)[0] || null;
  return preferred || explicitDefault || items[0] || null;
}

export function buildFeedPosterUrl(match = {}) {
  const youtubeVideoId = selectYouTubeVideoId(match);
  if (youtubeVideoId) {
    const candidates = ytThumbCandidates(youtubeVideoId);
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates[0];
    }
  }

  const facebookVideoId = selectFacebookVideoId(match);
  if (facebookVideoId) {
    return fbThumbFromId(facebookVideoId) || "";
  }

  return asTrimmed(match?.tournament?.image);
}

export function buildLiveFeedItem(match = {}) {
  const streams = Array.isArray(match?.streams) ? match.streams : [];
  const preferredStream =
    pickFeedPreferredStream(streams, match?.defaultStreamKey) ||
    findStreamByKey(streams, match?.defaultStreamKey) ||
    streams[0] ||
    null;
  const defaultStream =
    findStreamByKey(streams, match?.defaultStreamKey) || streams[0] || null;
  const primaryStream = preferredStream || defaultStream;
  const primaryOpenUrl =
    asTrimmed(primaryStream?.openUrl) ||
    asTrimmed(primaryStream?.playUrl) ||
    asTrimmed(defaultStream?.openUrl) ||
    asTrimmed(defaultStream?.playUrl);

  return {
    ...match,
    posterUrl: buildFeedPosterUrl(match),
    primaryOpenUrl,
    feedPreferredStreamKey: asTrimmed(primaryStream?.key) || null,
    hasNativeAutoplay:
      Boolean(primaryStream) &&
      isReadyStream(primaryStream) &&
      isNativeStreamKind(primaryStream?.kind),
  };
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

export async function listLiveFeed({
  q = "",
  tournamentId = "",
  mode = "all",
  page = 1,
  limit = DEFAULT_LIMIT,
} = {}) {
  const normalizedMode = normalizeLiveFeedMode(mode);
  const statuses = getLiveFeedModeStatuses(normalizedMode);
  const safeLimit = parsePositiveInt(limit, DEFAULT_LIMIT, {
    min: 1,
    max: MAX_LIMIT,
  });
  const safePage = parsePositiveInt(page, 1, { min: 1 });
  const normalizedQuery = asTrimmed(q).toLowerCase();
  const normalizedTournamentId = asTrimmed(tournamentId);

  const recordingMatchIds = await getStreamRecordingMatchIds();
  const candidateClauses = [...STREAM_CANDIDATE_CLAUSES];
  if (recordingMatchIds.length > 0) {
    candidateClauses.push({ _id: { $in: recordingMatchIds } });
  }

  const matchQuery = {
    $and: [
      { $or: candidateClauses },
      { status: { $in: statuses } },
      mongoose.Types.ObjectId.isValid(normalizedTournamentId)
        ? { tournament: normalizedTournamentId }
        : {},
    ].filter((clause) => Object.keys(clause).length > 0),
  };

  const matches = await Match.find(matchQuery)
    .select(MATCH_LIST_SELECT)
    .populate(MATCH_LIST_POPULATE)
    .sort({ updatedAt: -1, finishedAt: -1, startedAt: -1, createdAt: -1 })
    .lean();

  if (!matches.length) {
    return {
      count: 0,
      items: [],
      page: safePage,
      pages: 1,
      limit: safeLimit,
      meta: {
        at: new Date().toISOString(),
        filter: {
          mode: normalizedMode,
          statuses,
          q: asTrimmed(q),
          tournamentId: normalizedTournamentId || null,
        },
      },
    };
  }

  const latestRecordingsByMatchId = await getLatestRecordingsByMatchIds(matches);
  const matchDisplayContexts = await buildMatchDisplayContextsFromMatches(matches);

  let items = matches
    .map((match) => {
      const summary = buildMatchSummary(match, { matchDisplayContexts });
      const attached = attachPublicStreamsToMatch(
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
        latestRecordingsByMatchId.get(String(match._id)),
      );

      return buildLiveFeedItem(attached);
    })
    .filter((item) => Array.isArray(item?.streams) && item.streams.length > 0);

  if (normalizedQuery) {
    items = items.filter((item) =>
      buildFeedSearchText(item).includes(normalizedQuery),
    );
  }

  items.sort(compareLiveFeedItems);

  const paginated = paginate(items, safePage, safeLimit);

  return {
    count: paginated.total,
    items: paginated.items,
    page: paginated.page,
    pages: paginated.pages,
    limit: paginated.limit,
    meta: {
      at: new Date().toISOString(),
      filter: {
        mode: normalizedMode,
        statuses,
        q: asTrimmed(q),
        tournamentId: normalizedTournamentId || null,
      },
    },
  };
}
