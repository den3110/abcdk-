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
const DEFAULT_SEARCH_LIMIT = 8;

const LIVE_FEED_MODE_STATUSES = Object.freeze({
  all: ["live", "assigned", "queued", "finished"],
  live: ["live", "assigned", "queued"],
  replay: ["finished"],
});
const LIVE_FEED_SORTS = new Set(["smart", "recent"]);
const LIVE_FEED_SOURCE_FILTERS = new Set([
  "all",
  "complete",
  "native",
  "facebook",
  "youtube",
  "tiktok",
  "iframe",
  "other",
]);
const LIVE_FEED_REPLAY_STATE_FILTERS = new Set([
  "all",
  "complete",
  "temporary",
  "processing",
  "none",
]);

const MATCH_LIST_SELECT = [
  "_id",
  "tournament",
  "bracket",
  "status",
  "branch",
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
    select: "_id name type stage order meta config drawRounds",
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function firstText(...values) {
  for (const value of values) {
    const text = asTrimmed(value);
    if (text) return text;
  }
  return "";
}

export function normalizeLiveFeedMode(mode) {
  const normalized = asTrimmed(mode).toLowerCase();
  return LIVE_FEED_MODE_STATUSES[normalized] ? normalized : "all";
}

export function getLiveFeedModeStatuses(mode) {
  return [...LIVE_FEED_MODE_STATUSES[normalizeLiveFeedMode(mode)]];
}

export function normalizeLiveFeedSort(sort) {
  const normalized = asTrimmed(sort).toLowerCase();
  return LIVE_FEED_SORTS.has(normalized) ? normalized : "smart";
}

export function normalizeLiveFeedSourceFilter(source) {
  const normalized = asTrimmed(source).toLowerCase();
  return LIVE_FEED_SOURCE_FILTERS.has(normalized) ? normalized : "all";
}

export function normalizeLiveFeedReplayStateFilter(replayState) {
  const normalized = asTrimmed(replayState).toLowerCase();
  return LIVE_FEED_REPLAY_STATE_FILTERS.has(normalized) ? normalized : "all";
}

function isReadyStream(stream) {
  return stream?.ready !== false;
}

function isCompletedReplayStream(stream) {
  return (
    asTrimmed(stream?.key).toLowerCase() === "full_video" ||
    stream?.meta?.isCompleteVideo === true
  );
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

  if (isCompletedReplayStream(stream)) return 0;
  if (key === "server2") return 1;
  if (kind === "file") return 2;
  if (kind === "hls") return 3;
  if (kind === "delayed_manifest") return 4;
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

function getPrimaryFeedStream(item = {}) {
  const streams = Array.isArray(item?.streams) ? item.streams : [];
  return (
    findStreamByKey(streams, item?.feedPreferredStreamKey) ||
    findStreamByKey(streams, item?.defaultStreamKey) ||
    streams[0] ||
    null
  );
}

function getFeedPrimarySourceTypeFromStream(stream) {
  const key = asTrimmed(stream?.key).toLowerCase();
  const kind = asTrimmed(stream?.kind).toLowerCase();
  const provider = asTrimmed(stream?.providerLabel).toLowerCase();

  if (isCompletedReplayStream(stream)) return "complete";
  if (key === "server2" || isNativeStreamKind(kind)) return "native";
  if (kind === "facebook" || key === "server1" || provider.includes("facebook")) {
    return "facebook";
  }
  if (key === "youtube" || provider.includes("youtube")) return "youtube";
  if (key === "tiktok" || provider.includes("tiktok")) return "tiktok";
  if (kind === "iframe" || kind === "iframe_html") return "iframe";
  return "other";
}

function getFeedPrimarySourceType(item = {}) {
  return getFeedPrimarySourceTypeFromStream(getPrimaryFeedStream(item));
}

function normalizeStageToken(value) {
  return asTrimmed(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function detectKeywordStageLabel(value) {
  const normalized = normalizeStageToken(value);
  if (!normalized) return "";

  if (
    normalized.includes("third place") ||
    normalized.includes("third-place") ||
    normalized.includes("bronze") ||
    normalized.includes("tranh 3") ||
    normalized.includes("hang 3")
  ) {
    return "Tranh 3-4";
  }
  if (
    normalized.includes("grand final") ||
    normalized.includes("grand finale") ||
    normalized.includes("chung ket tong")
  ) {
    return "Chung kết tổng";
  }
  if (
    normalized.includes("losers final") ||
    normalized.includes("loser final") ||
    normalized.includes("lb final") ||
    normalized.includes("chung ket nhanh thua")
  ) {
    return "Chung kết nhánh thua";
  }
  if (
    normalized.includes("winners final") ||
    normalized.includes("winner final") ||
    normalized.includes("wb final") ||
    normalized.includes("chung ket nhanh thang")
  ) {
    return "Chung kết nhánh thắng";
  }
  if (normalized === "qf" || normalized.includes("quarter")) return "Tứ kết";
  if (normalized === "sf" || normalized.includes("semi")) return "Bán kết";
  if (
    normalized === "f" ||
    normalized === "final" ||
    normalized.includes("chung ket")
  ) {
    return "Chung kết";
  }
  if (
    normalized === "group" ||
    normalized.includes("vong bang") ||
    normalized.includes("round robin") ||
    normalized.includes("gsl")
  ) {
    return "Vòng bảng";
  }
  return "";
}

function isGroupStyleMatch(match = {}) {
  const phase = normalizeStageToken(match?.phase);
  const bracketType = normalizeStageToken(match?.bracket?.type || match?.format);

  return Boolean(
    phase === "group" ||
      match?.pool?.name ||
      match?.pool?.index ||
      ["group", "round robin", "gsl"].includes(bracketType) ||
      bracketType.includes("group") ||
      bracketType.includes("round robin") ||
      bracketType.includes("roundrobin"),
  );
}

function inferDrawSize(match = {}) {
  const candidates = [
    match?.bracket?.meta?.drawSize,
    match?.bracket?.meta?.scale,
    match?.bracket?.config?.roundElim?.drawSize,
    match?.bracket?.config?.doubleElim?.drawSize,
    match?.bracket?.config?.blueprint?.drawSize,
  ];

  for (const candidate of candidates) {
    const positive = parsePositiveInt(candidate, null, {
      min: 2,
      max: Number.MAX_SAFE_INTEGER,
    });
    if (positive) return positive;
  }

  const expectedFirstRoundMatches = parsePositiveInt(
    match?.bracket?.meta?.expectedFirstRoundMatches,
    null,
    { min: 1, max: Number.MAX_SAFE_INTEGER },
  );
  if (expectedFirstRoundMatches) return expectedFirstRoundMatches * 2;

  const maxRounds = parsePositiveInt(match?.bracket?.meta?.maxRounds, null, {
    min: 1,
    max: 30,
  });
  if (maxRounds) return 2 ** maxRounds;

  const drawRounds = parsePositiveInt(match?.bracket?.drawRounds, null, {
    min: 1,
    max: 30,
  });
  if (drawRounds) return 2 ** drawRounds;

  return null;
}

function roundSizeToStageLabel(size) {
  const normalized = parsePositiveInt(size, null, {
    min: 2,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (!normalized) return "";

  if (normalized >= 32) return `Vòng ${normalized} đội`;
  if (normalized === 16) return "Vòng 16 đội";
  if (normalized === 8) return "Tứ kết";
  if (normalized === 4) return "Bán kết";
  if (normalized === 2) return "Chung kết";
  return `Vòng ${normalized}`;
}

function inferKnockoutStageLabel(match = {}) {
  const roundNumber = parsePositiveInt(
    match?.round ?? match?.globalRound ?? match?.bracket?.globalRound,
    null,
    { min: 1, max: Number.MAX_SAFE_INTEGER },
  );

  const drawSize = inferDrawSize(match);
  if (roundNumber && drawSize) {
    const roundSize = Math.max(2, Math.floor(drawSize / 2 ** (roundNumber - 1)));
    const label = roundSizeToStageLabel(roundSize);
    if (label) return label;
  }

  return roundNumber ? `Vòng ${roundNumber}` : "";
}

function decorateBranchStageLabel(baseLabel, match = {}) {
  const phase = normalizeStageToken(match?.phase);
  const branch = normalizeStageToken(match?.branch);

  if (
    match?.meta?.thirdPlace === true ||
    branch === "consol" ||
    detectKeywordStageLabel(match?.meta?.stageLabel || match?.labelKey) === "Tranh 3-4"
  ) {
    return "Tranh 3-4";
  }

  if (phase === "grand final" || branch === "gf") {
    return "Chung kết tổng";
  }

  if (phase === "decider") {
    return baseLabel || "Trận quyết định";
  }

  if (phase === "losers" || branch === "lb") {
    if (baseLabel === "Chung kết") return "Chung kết nhánh thua";
    if (baseLabel === "Bán kết") return "Bán kết nhánh thua";
    if (baseLabel === "Tứ kết") return "Tứ kết nhánh thua";
    return baseLabel || "Nhánh thua";
  }

  if (phase === "winners" || branch === "wb") {
    if (baseLabel === "Chung kết") return "Chung kết nhánh thắng";
    if (baseLabel === "Bán kết") return "Bán kết nhánh thắng";
    if (baseLabel === "Tứ kết") return "Tứ kết nhánh thắng";
    return baseLabel || "Nhánh thắng";
  }

  return baseLabel;
}

export function buildFeedStageLabel(match = {}) {
  const explicitKeywordLabel = firstText(
    detectKeywordStageLabel(match?.meta?.stageLabel),
    detectKeywordStageLabel(match?.labelKey),
    detectKeywordStageLabel(match?.bracket?.name),
  );
  if (explicitKeywordLabel === "Tranh 3-4") return explicitKeywordLabel;

  if (isGroupStyleMatch(match)) {
    return "Vòng bảng";
  }

  const phase = normalizeStageToken(match?.phase);
  const branch = normalizeStageToken(match?.branch);
  if (phase === "grand final" || branch === "gf") {
    return "Chung kết tổng";
  }

  const fallbackBaseLabel =
    explicitKeywordLabel ||
    inferKnockoutStageLabel(match) ||
    firstText(match?.meta?.stageLabel);

  return decorateBranchStageLabel(fallbackBaseLabel, match);
}

function getTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getMinutesAgo(value) {
  const timestamp = getTimestamp(value);
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - timestamp) / 60000);
}

function getMinutesUntil(value) {
  const timestamp = getTimestamp(value);
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return (timestamp - Date.now()) / 60000;
}

function getDecayBoost(minutes, maxPoints, windowMinutes) {
  if (!Number.isFinite(minutes)) return 0;
  if (minutes <= 0) return maxPoints;
  if (minutes >= windowMinutes) return 0;
  return Math.round(maxPoints * (1 - minutes / windowMinutes));
}

function getUpcomingBoost(value) {
  const minutesUntil = getMinutesUntil(value);
  if (!Number.isFinite(minutesUntil)) return 0;
  if (minutesUntil <= 0) return minutesUntil >= -30 ? 42 : 0;
  if (minutesUntil <= 10) return 78;
  if (minutesUntil <= 30) return 62;
  if (minutesUntil <= 60) return 44;
  if (minutesUntil <= 180) return 24;
  return 0;
}

function extractFeedScoreTuple(item = {}) {
  const score = item?.score;
  if (!score || typeof score !== "object") return null;

  const left =
    score.scoreA ??
    score.teamA ??
    score.sideA ??
    score.a ??
    score.left ??
    score.home ??
    null;
  const right =
    score.scoreB ??
    score.teamB ??
    score.sideB ??
    score.b ??
    score.right ??
    score.away ??
    null;

  if (Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return [Number(left), Number(right)];
  }

  return null;
}

function getScoreHeatBoost(item = {}) {
  const scoreTuple = extractFeedScoreTuple(item);
  if (!scoreTuple) return 0;

  const totalPoints = scoreTuple[0] + scoreTuple[1];
  const pointGap = Math.abs(scoreTuple[0] - scoreTuple[1]);
  const gameBoost = clamp((Number(item?.currentGame || 0) - 1) * 7, 0, 24);
  const rallyBoost = clamp(totalPoints * 1.2, 0, 32);
  const closeBoost = clamp(14 - pointGap, 0, 14);

  return Math.round(gameBoost + rallyBoost + closeBoost);
}

function getStreamReadinessBoost(item = {}) {
  const streams = Array.isArray(item?.streams) ? item.streams : [];
  const primaryStream = getPrimaryFeedStream(item);
  let boost = 0;

  if (streams.some((stream) => isReadyStream(stream) && isCompletedReplayStream(stream))) {
    boost += 92;
  } else if (item?.replayState === "temporary") {
    boost += 28;
  } else if (item?.replayState === "processing") {
    boost -= 64;
  }

  if (
    streams.some(
      (stream) =>
        isReadyStream(stream) &&
        (isNativeStreamKind(stream?.kind) || isCompletedReplayStream(stream)),
    )
  ) {
    boost += 34;
  } else if (primaryStream && isReadyStream(primaryStream)) {
    boost += 10;
  }

  const primarySourceType = getFeedPrimarySourceTypeFromStream(primaryStream);
  if (primarySourceType === "facebook") boost += 8;
  if (primarySourceType === "youtube") boost += 6;
  if (primarySourceType === "tiktok") boost += 5;
  if (item?.primaryOpenUrl) boost += 4;
  if (item?.posterUrl) boost += 3;

  return boost;
}

function getLiveFeedSmartBadge(item = {}) {
  const status = asTrimmed(item?.status).toLowerCase();
  const replayState = asTrimmed(item?.replayState).toLowerCase();
  const primarySourceType = getFeedPrimarySourceType(item);

  if (status === "live") return "Live";
  if (
    ["assigned", "queued", "scheduled"].includes(status) &&
    getUpcomingBoost(item?.scheduledAt || item?.startedAt) >= 40
  ) {
    return "Sắp vào sân";
  }
  if (status === "finished" && replayState === "complete") return "Replay đầy đủ";
  if (status === "finished" && replayState === "temporary") return "Đang phát bản tạm";
  if (status === "finished" && replayState === "processing") return "Đang xử lý";
  if (primarySourceType === "facebook") return "Facebook Live";
  if (primarySourceType === "youtube") return "YouTube";
  return "Mới cập nhật";
}

export function getLiveFeedSmartScore(item = {}) {
  const status = asTrimmed(item?.status).toLowerCase();
  let score = 0;

  switch (status) {
    case "live":
      score += 420;
      score += getDecayBoost(
        getMinutesAgo(item?.updatedAt || item?.startedAt),
        88,
        120,
      );
      score += getScoreHeatBoost(item);
      break;
    case "assigned":
      score += 282;
      score += getUpcomingBoost(item?.scheduledAt || item?.startedAt);
      score += getDecayBoost(getMinutesAgo(item?.updatedAt), 18, 150);
      break;
    case "queued":
      score += 236;
      score += getUpcomingBoost(item?.scheduledAt || item?.startedAt);
      score += getDecayBoost(getMinutesAgo(item?.updatedAt), 14, 180);
      break;
    case "scheduled":
      score += 188;
      score += getUpcomingBoost(item?.scheduledAt || item?.startedAt);
      break;
    case "finished":
      score += 132;
      score += getDecayBoost(
        getMinutesAgo(item?.finishedAt || item?.updatedAt),
        76,
        12 * 60,
      );
      break;
    default:
      score += 96;
      score += getDecayBoost(getMinutesAgo(item?.updatedAt), 12, 240);
      break;
  }

  score += getStreamReadinessBoost(item);

  return Math.round(score);
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
  const smartDiff =
    getLiveFeedSmartScore(right) - getLiveFeedSmartScore(left);
  if (smartDiff !== 0) return smartDiff;

  const priorityDiff = statusPriority(left?.status) - statusPriority(right?.status);
  if (priorityDiff !== 0) return priorityDiff;

  const timeDiff = getMatchSortTime(right) - getMatchSortTime(left);
  if (timeDiff !== 0) return timeDiff;

  return asTrimmed(left?._id).localeCompare(asTrimmed(right?._id));
}

function compareLiveFeedItemsByRecent(left, right) {
  const timeDiff = getMatchSortTime(right) - getMatchSortTime(left);
  if (timeDiff !== 0) return timeDiff;
  return compareLiveFeedItems(left, right);
}

function getLiveFeedComparator(sort = "smart") {
  return normalizeLiveFeedSort(sort) === "recent"
    ? compareLiveFeedItemsByRecent
    : compareLiveFeedItems;
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
  const completedReplayReady = streams.some(isCompletedReplayStream);
  const temporaryReplayReady = streams.some(
    (stream) =>
      !isCompletedReplayStream(stream) &&
      isReadyStream(stream) &&
      asTrimmed(stream?.key).toLowerCase() !== "server2",
  );
  const normalizedStatus = asTrimmed(match?.status).toLowerCase();
  let replayState = "none";
  if (normalizedStatus === "finished") {
    if (completedReplayReady) replayState = "complete";
    else if (temporaryReplayReady) replayState = "temporary";
    else replayState = "processing";
  }
  const useNativeControls = Boolean(
    primaryStream?.meta?.useNativeControls || isCompletedReplayStream(primaryStream),
  );
  const preferredObjectFit =
    isNativeStreamKind(primaryStream?.kind) || isCompletedReplayStream(primaryStream)
      ? "contain"
      : "cover";
  const feedPrimarySourceType = getFeedPrimarySourceTypeFromStream(primaryStream);
  const stageLabel = buildFeedStageLabel(match);

  const item = {
    ...match,
    posterUrl: buildFeedPosterUrl(match),
    primaryOpenUrl,
    feedPreferredStreamKey: asTrimmed(primaryStream?.key) || null,
    hasNativeAutoplay:
      Boolean(primaryStream) &&
      isReadyStream(primaryStream) &&
      isNativeStreamKind(primaryStream?.kind),
    replayState,
    useNativeControls,
    preferredObjectFit,
    feedPrimarySourceType,
    stageLabel,
    smartBadge: "",
    smartScore: 0,
  };

  item.smartBadge = getLiveFeedSmartBadge(item);
  item.smartScore = getLiveFeedSmartScore(item);

  return item;
}

function matchesSourceFilter(item = {}, sourceFilter = "all") {
  const normalizedFilter = normalizeLiveFeedSourceFilter(sourceFilter);
  if (normalizedFilter === "all") return true;
  return getFeedPrimarySourceType(item) === normalizedFilter;
}

function matchesReplayStateFilter(item = {}, replayStateFilter = "all") {
  const normalizedFilter = normalizeLiveFeedReplayStateFilter(replayStateFilter);
  if (normalizedFilter === "all") return true;
  return asTrimmed(item?.replayState).toLowerCase() === normalizedFilter;
}

function buildFeedMeta(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const statuses = {
    live: 0,
    assigned: 0,
    queued: 0,
    finished: 0,
  };
  const sources = {
    all: safeItems.length,
    complete: 0,
    native: 0,
    facebook: 0,
    youtube: 0,
    tiktok: 0,
    iframe: 0,
    other: 0,
  };
  const replayStates = {
    all: safeItems.length,
    complete: 0,
    temporary: 0,
    processing: 0,
    none: 0,
  };
  const tournamentMap = new Map();

  safeItems.forEach((item) => {
    const normalizedStatus = asTrimmed(item?.status).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(statuses, normalizedStatus)) {
      statuses[normalizedStatus] += 1;
    }

    const primarySourceType = getFeedPrimarySourceType(item);
    if (Object.prototype.hasOwnProperty.call(sources, primarySourceType)) {
      sources[primarySourceType] += 1;
    }

    const replayState = asTrimmed(item?.replayState).toLowerCase() || "none";
    if (Object.prototype.hasOwnProperty.call(replayStates, replayState)) {
      replayStates[replayState] += 1;
    }

    const tournamentId = toIdString(item?.tournament?._id);
    const tournamentName = asTrimmed(item?.tournament?.name);
    if (tournamentId || tournamentName) {
      const key = tournamentId || tournamentName;
      const previous = tournamentMap.get(key) || {
        _id: tournamentId || null,
        name: tournamentName || "Giải đấu",
        image: asTrimmed(item?.tournament?.image) || "",
        count: 0,
      };
      previous.count += 1;
      if (!previous.image && item?.tournament?.image) {
        previous.image = asTrimmed(item.tournament.image);
      }
      tournamentMap.set(key, previous);
    }
  });

  return {
    summary: {
      total: safeItems.length,
      liveLike: statuses.live + statuses.assigned + statuses.queued,
      live: statuses.live,
      replay: statuses.finished,
      completeReplay: replayStates.complete,
      temporaryReplay: replayStates.temporary,
      processingReplay: replayStates.processing,
      nativeReady: sources.complete + sources.native,
    },
    facets: {
      statuses,
      sources,
      replayStates,
      tournaments: [...tournamentMap.values()].sort((left, right) => {
        const countDiff = right.count - left.count;
        if (countDiff !== 0) return countDiff;
        return asTrimmed(left?.name).localeCompare(asTrimmed(right?.name));
      }),
    },
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
  source = "all",
  replayState = "all",
  sort = "smart",
  page = 1,
  limit = DEFAULT_LIMIT,
} = {}) {
  const normalizedMode = normalizeLiveFeedMode(mode);
  const normalizedSource = normalizeLiveFeedSourceFilter(source);
  const normalizedReplayState =
    normalizeLiveFeedReplayStateFilter(replayState);
  const normalizedSort = normalizeLiveFeedSort(sort);
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
          source: normalizedSource,
          replayState: normalizedReplayState,
          sort: normalizedSort,
          statuses,
          q: asTrimmed(q),
          tournamentId: normalizedTournamentId || null,
        },
        ...buildFeedMeta([]),
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
          phase: match.phase || null,
          branch: match.branch || null,
          round: Number.isFinite(Number(match.round)) ? Number(match.round) : null,
          rrRound: Number.isFinite(Number(match.rrRound))
            ? Number(match.rrRound)
            : null,
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

  items = items.filter(
    (item) =>
      matchesSourceFilter(item, normalizedSource) &&
      matchesReplayStateFilter(item, normalizedReplayState),
  );

  items.sort(getLiveFeedComparator(normalizedSort));

  const feedMeta = buildFeedMeta(items);

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
        source: normalizedSource,
        replayState: normalizedReplayState,
        sort: normalizedSort,
        statuses,
        q: asTrimmed(q),
        tournamentId: normalizedTournamentId || null,
      },
      ...feedMeta,
    },
  };
}

export function buildLiveFeedSearchItem(item = {}) {
  return {
    _id: item?._id || null,
    status: item?.status || "",
    smartBadge: item?.smartBadge || "",
    displayCode: item?.displayCode || "",
    stageLabel: item?.stageLabel || "",
    courtLabel: item?.courtLabel || "",
    updatedAt: item?.updatedAt || null,
    teamAName: item?.teamAName || "",
    teamBName: item?.teamBName || "",
    pairA: item?.pairA || null,
    pairB: item?.pairB || null,
    tournament: item?.tournament
      ? {
          _id: item.tournament?._id || null,
          name: item.tournament?.name || "",
          image: item.tournament?.image || "",
        }
      : null,
  };
}

export async function searchLiveFeed({
  q = "",
  tournamentId = "",
  mode = "all",
  source = "all",
  replayState = "all",
  sort = "smart",
  limit = DEFAULT_SEARCH_LIMIT,
} = {}) {
  const keyword = asTrimmed(q);
  const safeLimit = parsePositiveInt(limit, DEFAULT_SEARCH_LIMIT, {
    min: 1,
    max: 20,
  });

  if (!keyword) {
    return {
      count: 0,
      items: [],
      limit: safeLimit,
      meta: {
        at: new Date().toISOString(),
        filter: {
          q: "",
          tournamentId: asTrimmed(tournamentId) || null,
          mode: normalizeLiveFeedMode(mode),
          source: normalizeLiveFeedSourceFilter(source),
          replayState: normalizeLiveFeedReplayStateFilter(replayState),
          sort: normalizeLiveFeedSort(sort),
        },
      },
    };
  }

  const payload = await listLiveFeed({
    q: keyword,
    tournamentId,
    mode,
    source,
    replayState,
    sort,
    page: 1,
    limit: safeLimit,
  });

  return {
    count: Number(payload?.count || 0),
    items: (Array.isArray(payload?.items) ? payload.items : []).map(buildLiveFeedSearchItem),
    limit: safeLimit,
    meta: {
      at: new Date().toISOString(),
      filter: payload?.meta?.filter || {
        q: keyword,
      },
    },
  };
}
