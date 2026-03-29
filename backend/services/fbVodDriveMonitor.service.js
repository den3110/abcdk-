import Match from "../models/matchModel.js";
import LiveRecordingV2 from "../models/liveRecordingV2Model.js";
import { scheduleFacebookVodFallbackForMatch } from "./liveRecordingFacebookVodFallback.service.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingRawStreamUrl,
} from "./liveRecordingV2Export.service.js";
import { getLiveRecordingExportQueueSnapshot } from "./liveRecordingV2Queue.service.js";
import { getLiveRecordingWorkerHealth } from "./liveRecordingWorkerHealth.service.js";
import { buildExportPipelineInfo } from "./liveRecordingMonitor.service.js";
import {
  getFacebookLiveIdentifiers,
  getFacebookVodRetryMeta,
  getRecordingSourceMeta,
  getUploadedRecordingSegments,
  hasDriveRecordingOutput,
  RECORDING_SOURCE_FACEBOOK_VOD,
} from "./liveRecordingFacebookVodShared.service.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";

const FACEBOOK_ENDED_STATUSES = ["ENDED", "STOPPED", "FINISHED"];
const RANGE_TO_DAYS = {
  "7d": 7,
  "30d": 30,
  all: null,
};
const VALID_STATUS_FILTERS = new Set([
  "all",
  "missing_fallback",
  "failed",
  "waiting_facebook_vod",
  "exporting",
  "ready",
]);
const STATE_PRIORITY = {
  missing_fallback: 0,
  failed: 1,
  waiting_facebook_vod: 2,
  exporting: 3,
  ready: 4,
};

const MATCH_SELECT = [
  "code",
  "displayCode",
  "shortCode",
  "labelKey",
  "status",
  "format",
  "round",
  "rrRound",
  "order",
  "globalRound",
  "stageIndex",
  "pool.name",
  "pool.index",
  "pool.idx",
  "pool.no",
  "pool.order",
  "pool.code",
  "courtLabel",
  "facebookLive",
  "pairA",
  "pairB",
  "court",
  "bracket",
  "tournament",
  "meta",
  "updatedAt",
  "createdAt",
].join(" ");

const MATCH_POPULATE = [
  { path: "tournament", select: "name" },
  { path: "bracket", select: "name stage type" },
  {
    path: "pairA",
    select: "teamName label player1 player2",
    populate: [
      {
        path: "player1",
        select: "fullName name shortName nickname nickName user",
        populate: {
          path: "user",
          select: "name fullName nickname nickName",
        },
      },
      {
        path: "player2",
        select: "fullName name shortName nickname nickName user",
        populate: {
          path: "user",
          select: "name fullName nickname nickName",
        },
      },
    ],
  },
  {
    path: "pairB",
    select: "teamName label player1 player2",
    populate: [
      {
        path: "player1",
        select: "fullName name shortName nickname nickName user",
        populate: {
          path: "user",
          select: "name fullName nickname nickName",
        },
      },
      {
        path: "player2",
        select: "fullName name shortName nickname nickName user",
        populate: {
          path: "user",
          select: "name fullName nickname nickName",
        },
      },
    ],
  },
  { path: "court", select: "name label number" },
];

function asTrimmed(value) {
  return String(value || "").trim();
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

function parseCsv(value, fallback = []) {
  const items = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : fallback;
}

function normalizeRange(value) {
  const normalized = asTrimmed(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANGE_TO_DAYS, normalized)
    ? normalized
    : "7d";
}

function normalizeStatusFilter(value) {
  const normalized = asTrimmed(value).toLowerCase();
  return VALID_STATUS_FILTERS.has(normalized) ? normalized : "all";
}

function getCutoffDate(range) {
  const days = RANGE_TO_DAYS[range];
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function pickPersonName(person) {
  return (
    person?.nickname ||
    person?.nickName ||
    person?.fullName ||
    person?.name ||
    person?.shortName ||
    person?.displayName ||
    ""
  );
}

function buildPairLabel(pair) {
  if (!pair) return "";
  if (pair.teamName) return pair.teamName;
  if (pair.label) return pair.label;

  const p1 = pickPersonName(pair.player1?.user || pair.player1);
  const p2 = pickPersonName(pair.player2?.user || pair.player2);
  return [p1, p2].filter(Boolean).join(" / ");
}

function buildParticipantsLabel(match) {
  const sideA = buildPairLabel(match?.pairA);
  const sideB = buildPairLabel(match?.pairB);
  return [sideA, sideB].filter(Boolean).join(" vs ");
}

function buildCourtLabel(match) {
  if (match?.courtLabel) return match.courtLabel;
  if (match?.court?.name) return match.court.name;
  if (match?.court?.label) return match.court.label;
  if (Number.isFinite(Number(match?.court?.number))) {
    return `Court ${Number(match.court.number)}`;
  }
  return "";
}

function buildMatchCode(match) {
  const codePayload = buildMatchCodePayload(match);
  return (
    asTrimmed(codePayload?.displayCode) ||
    asTrimmed(codePayload?.code) ||
    asTrimmed(match?.shortCode) ||
    asTrimmed(match?.code) ||
    (match?._id ? String(match._id).slice(-6) : "")
  );
}

function hasUploadedSegments(recording) {
  return getUploadedRecordingSegments(recording).length > 0;
}

function getRecordingRank(recording) {
  const status = asTrimmed(recording?.status).toLowerCase();
  const hasRaw = Boolean(recording?.driveFileId || recording?.driveRawUrl);
  const hasPlayable = Boolean(
    hasRaw ||
    recording?.drivePreviewUrl ||
    recording?.playbackUrl ||
    recording?._id,
  );

  if (hasRaw) return 500;
  if (status === "ready" && hasPlayable) return 450;
  if (status === "ready") return 400;
  if (status === "exporting") return 300;
  if (status === "pending_export_window") return 250;
  if (status === "uploading") return 200;
  if (status === "recording") return 150;
  return 100;
}

function pickPreferredRecording(recordings = []) {
  return (
    [...recordings].sort((a, b) => {
      const rankCmp = getRecordingRank(b) - getRecordingRank(a);
      if (rankCmp !== 0) return rankCmp;
      return (
        new Date(b?.createdAt || 0).getTime() -
        new Date(a?.createdAt || 0).getTime()
      );
    })[0] || null
  );
}

function buildMatchFilter(range) {
  const cutoff = getCutoffDate(range);
  const filter = {
    $and: [
      {
        $or: [
          { "facebookLive.videoId": { $type: "string" } },
          { "facebookLive.id": { $type: "string" } },
          { "facebookLive.liveVideoId": { $type: "string" } },
        ],
      },
      {
        $or: [
          { "facebookLive.endedAt": { $type: "date" } },
          { "facebookLive.status": { $in: FACEBOOK_ENDED_STATUSES } },
        ],
      },
    ],
  };

  if (cutoff) {
    filter.$and.push({
      $or: [
        { "facebookLive.endedAt": { $gte: cutoff } },
        { updatedAt: { $gte: cutoff } },
      ],
    });
  }

  return filter;
}

function buildContext(workerHealth, queueSnapshot) {
  return {
    workerHealth: workerHealth || null,
    queueSnapshot: queueSnapshot || null,
  };
}

function determineRowState(recording, exportPipeline) {
  const fallbackConfigured =
    getRecordingSourceMeta(recording).type === RECORDING_SOURCE_FACEBOOK_VOD;
  const pipelineStage = asTrimmed(exportPipeline?.stage).toLowerCase();
  const recordingStatus = asTrimmed(recording?.status).toLowerCase();

  if (!recording) {
    return {
      state: "missing_fallback",
      stateLabel: "Chưa tạo fallback",
    };
  }

  if (hasDriveRecordingOutput(recording) || recordingStatus === "ready") {
    return {
      state: "ready",
      stateLabel: "Đã có video trên Drive",
    };
  }

  if (recordingStatus === "failed" && fallbackConfigured) {
    return {
      state: "failed",
      stateLabel: exportPipeline?.label || "Xuất thất bại",
    };
  }

  if (pipelineStage === "waiting_facebook_vod") {
    return {
      state: "waiting_facebook_vod",
      stateLabel: exportPipeline?.label || "Đang chờ video Facebook hoàn tất",
    };
  }

  if (
    fallbackConfigured &&
    ["pending_export_window", "exporting"].includes(recordingStatus)
  ) {
    return {
      state: "exporting",
      stateLabel: exportPipeline?.label || "Đang xuất",
    };
  }

  if (
    fallbackConfigured &&
    ["recording", "uploading"].includes(recordingStatus)
  ) {
    return {
      state: "exporting",
      stateLabel: exportPipeline?.label || "Đang xử lý fallback",
    };
  }

  return {
    state: "missing_fallback",
    stateLabel: "Chưa bootstrap fallback",
  };
}

function buildSearchText(row) {
  return [
    row.matchId,
    row.recordingId,
    row.matchCode,
    row.participantsLabel,
    row.tournamentName,
    row.bracketName,
    row.courtLabel,
    row.state,
    row.stateLabel,
    row.recordingStatus,
    row.pipelineStage,
    row.lastError,
    row.facebook?.videoId,
    row.facebook?.watchUrl,
    row.facebook?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesStatusFilter(row, statusFilter) {
  if (statusFilter === "all") return true;
  return row.state === statusFilter;
}

function paginate(items = [], page = 1, limit = 20) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * limit;
  return {
    total,
    page: safePage,
    pages,
    items: items.slice(start, start + limit),
  };
}

function buildSummary(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.state === "missing_fallback") acc.missingFallback += 1;
      if (row.state === "waiting_facebook_vod") acc.waitingFacebookVod += 1;
      if (row.state === "failed") acc.failed += 1;
      if (row.state === "ready") acc.ready += 1;
      if (row.state === "exporting") acc.exporting += 1;
      return acc;
    },
    {
      total: 0,
      missingFallback: 0,
      waitingFacebookVod: 0,
      exporting: 0,
      ready: 0,
      failed: 0,
    },
  );
}

function sortRows(rows = []) {
  return [...rows].sort((a, b) => {
    const stateCmp =
      (STATE_PRIORITY[a.state] ?? 99) - (STATE_PRIORITY[b.state] ?? 99);
    if (stateCmp !== 0) return stateCmp;
    return (
      new Date(b?.updatedAt || 0).getTime() -
      new Date(a?.updatedAt || 0).getTime()
    );
  });
}

function buildRowFromMatch(match, recordings = [], context = {}) {
  const hasInternalSegments = recordings.some((recording) =>
    hasUploadedSegments(recording),
  );
  if (hasInternalSegments) return null;

  const preferredRecording = pickPreferredRecording(recordings);
  const exportPipeline = preferredRecording
    ? buildExportPipelineInfo(preferredRecording, context)
    : null;
  const rowState = determineRowState(preferredRecording, exportPipeline);
  const retryMeta = getFacebookVodRetryMeta(preferredRecording);
  const facebook = getFacebookLiveIdentifiers(match);
  const matchId = String(match?._id || "");
  const recordingId = preferredRecording?._id
    ? String(preferredRecording._id)
    : null;
  const driveReady = Boolean(
    preferredRecording &&
    (hasDriveRecordingOutput(preferredRecording) ||
      asTrimmed(preferredRecording?.status).toLowerCase() === "ready"),
  );
  const fallbackConfigured =
    getRecordingSourceMeta(preferredRecording).type ===
    RECORDING_SOURCE_FACEBOOK_VOD;
  const updatedAt =
    preferredRecording?.updatedAt ||
    preferredRecording?.readyAt ||
    preferredRecording?.createdAt ||
    facebook?.endedAt ||
    match?.updatedAt ||
    null;

  return {
    id: matchId,
    matchId,
    recordingId,
    matchCode: buildMatchCode(match),
    participantsLabel: buildParticipantsLabel(match) || "Unknown match",
    tournamentName: asTrimmed(match?.tournament?.name),
    bracketName: asTrimmed(match?.bracket?.name),
    courtLabel: buildCourtLabel(match),
    facebook: {
      videoId: facebook.videoId,
      watchUrl: facebook.watchUrl,
      status: facebook.status,
      endedAt: facebook.endedAt,
    },
    state: rowState.state,
    stateLabel: rowState.stateLabel,
    recordingStatus: preferredRecording?.status || null,
    pipelineStage: exportPipeline?.stage || null,
    pipelineDetail: exportPipeline?.detail || null,
    nextAttemptAt:
      retryMeta.nextAttemptAt ||
      preferredRecording?.scheduledExportAt ||
      exportPipeline?.scheduledExportAt ||
      null,
    deadlineAt: retryMeta.deadlineAt || null,
    lastError:
      retryMeta.lastError || asTrimmed(preferredRecording?.error) || null,
    driveRawUrl: preferredRecording?.driveRawUrl || null,
    drivePreviewUrl: preferredRecording?.drivePreviewUrl || null,
    playbackUrl:
      driveReady && recordingId ? buildRecordingPlaybackUrl(recordingId) : null,
    rawStreamUrl:
      preferredRecording?.driveFileId && recordingId
        ? buildRecordingRawStreamUrl(recordingId)
        : preferredRecording?.driveRawUrl || null,
    updatedAt,
    canEnsureExport:
      !preferredRecording ||
      (!fallbackConfigured &&
        !hasDriveRecordingOutput(preferredRecording) &&
        !hasUploadedSegments(preferredRecording)),
    canRetryExport: Boolean(
      recordingId &&
      fallbackConfigured &&
      (preferredRecording?.status === "failed" ||
        preferredRecording?.status === "pending_export_window" ||
        ["stale_no_job", "worker_offline"].includes(
          asTrimmed(exportPipeline?.stage).toLowerCase(),
        )),
    ),
    canForceExport: Boolean(
      recordingId &&
      fallbackConfigured &&
      preferredRecording?.status === "pending_export_window",
    ),
  };
}

async function loadMonitorContext() {
  const [workerHealth, queueSnapshot] = await Promise.all([
    getLiveRecordingWorkerHealth().catch(() => null),
    getLiveRecordingExportQueueSnapshot().catch(() => null),
  ]);
  return buildContext(workerHealth, queueSnapshot);
}

async function loadMatches(range) {
  return Match.find(buildMatchFilter(range))
    .select(MATCH_SELECT)
    .populate(MATCH_POPULATE)
    .sort({ "facebookLive.endedAt": -1, updatedAt: -1, createdAt: -1 })
    .lean({ getters: true, virtuals: true });
}

async function loadRecordingsByMatchIds(matchIds = []) {
  if (!matchIds.length) return new Map();

  const recordings = await LiveRecordingV2.find({
    match: { $in: matchIds },
  })
    .select(
      [
        "_id",
        "match",
        "status",
        "driveFileId",
        "driveRawUrl",
        "drivePreviewUrl",
        "playbackUrl",
        "scheduledExportAt",
        "readyAt",
        "error",
        "meta.source",
        "meta.facebookVod",
        "meta.exportPipeline",
        "segments.index",
        "segments.uploadStatus",
        "segments.durationSeconds",
        "segments.objectKey",
        "createdAt",
        "updatedAt",
      ].join(" "),
    )
    .lean();

  const byMatchId = new Map();
  for (const recording of recordings) {
    const key = asTrimmed(recording?.match);
    if (!key) continue;
    if (!byMatchId.has(key)) byMatchId.set(key, []);
    byMatchId.get(key).push(recording);
  }
  return byMatchId;
}

async function buildRowsForMatches(matches = [], context = {}) {
  const matchIds = matches.map((match) => match?._id).filter(Boolean);
  const recordingsByMatchId = await loadRecordingsByMatchIds(matchIds);

  return sortRows(
    matches
      .map((match) =>
        buildRowFromMatch(
          match,
          recordingsByMatchId.get(String(match._id)) || [],
          context,
        ),
      )
      .filter(Boolean),
  );
}

export async function getFbVodDriveMonitorSnapshot({
  range = "7d",
  status = "all",
  q = "",
  page = 1,
  limit = 20,
} = {}) {
  const normalizedRange = normalizeRange(range);
  const normalizedStatus = normalizeStatusFilter(status);
  const keyword = asTrimmed(q).toLowerCase();
  const pageNumber = parsePositiveInt(page, 1, { min: 1 });
  const limitNumber = parsePositiveInt(limit, 20, { min: 1, max: 100 });
  const context = await loadMonitorContext();
  const matches = await loadMatches(normalizedRange);
  const allRows = await buildRowsForMatches(matches, context);

  const summary = buildSummary(allRows);
  const filteredRows = allRows.filter((row) => {
    if (!matchesStatusFilter(row, normalizedStatus)) return false;
    if (!keyword) return true;
    return buildSearchText(row).includes(keyword);
  });
  const paged = paginate(filteredRows, pageNumber, limitNumber);

  return {
    summary,
    rows: paged.items,
    count: paged.total,
    page: paged.page,
    pages: paged.pages,
    limit: limitNumber,
    filters: {
      range: normalizedRange,
      status: normalizedStatus,
      q: asTrimmed(q),
    },
    meta: {
      generatedAt: new Date(),
      workerHealth: context.workerHealth,
    },
  };
}

export async function getFbVodDriveMonitorRowByMatchId(matchId) {
  const match = await Match.findById(matchId)
    .select(MATCH_SELECT)
    .populate(MATCH_POPULATE)
    .lean({ getters: true, virtuals: true });
  if (!match) return null;

  const context = await loadMonitorContext();
  const recordingsByMatchId = await loadRecordingsByMatchIds([matchId]);
  return buildRowFromMatch(
    match,
    recordingsByMatchId.get(String(matchId)) || [],
    context,
  );
}

export async function ensureFbVodDriveMonitorExport(matchId) {
  const result = await scheduleFacebookVodFallbackForMatch(matchId);
  const row = await getFbVodDriveMonitorRowByMatchId(matchId);
  return {
    ...result,
    row,
  };
}
