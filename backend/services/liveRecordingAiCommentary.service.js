import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import axios from "axios";

import SystemSettings from "../models/systemSettingsModel.js";
import {
  uploadRecordingToDrive,
  streamRecordingDriveFile,
} from "./driveRecordings.service.js";
import {
  buildRecordingAiCommentaryPlaybackUrl,
  buildRecordingAiCommentaryRawUrl,
} from "./liveRecordingAiCommentaryPlayback.service.js";
import {
  getLiveRecordingAiCommentaryRuntime,
  resolveAiCommentaryTonePreset,
  resolveAiCommentaryVoicePreset,
} from "./liveRecordingAiCommentaryGateway.service.js";

export const DEFAULT_AI_COMMENTARY_SETTINGS = {
  enabled: false,
  autoGenerateAfterDriveUpload: true,
  defaultLanguage: "vi",
  defaultVoicePreset: "vi_male_pro",
  scriptBaseUrl: "",
  scriptModel: "",
  ttsBaseUrl: "",
  ttsModel: "",
  defaultTonePreset: "professional",
  keepOriginalAudioBed: true,
  audioBedLevelDb: -18,
  duckAmountDb: -12,
};

const SCRIPT_PROMPT = `
Bạn là bình luận viên pickleball chuyên nghiệp cho video highlight/trận đấu đầy đủ.

Mục tiêu:
- Viết lời bình luận có cảm xúc, giàu nhịp điệu, như BLV thể thao chuyên nghiệp.
- Chỉ dùng dữ kiện có trong payload: tên VĐV, tỷ số, timeline, giải đấu, court, thời lượng video, diễn biến thật.
- Không bịa chi tiết ngoài payload.
- Không nhắc mình là AI.
- Không lặp lại cùng ý quá nhiều.

Yêu cầu:
- Trả đúng JSON.
- Viết bằng ngôn ngữ yêu cầu.
- Mỗi segment phải phù hợp với startSec/endSec, không quá dài so với thời lượng nói thực tế.
- Có intro, diễn biến giữa trận, nhấn mạnh thời khắc then chốt và outro.

Schema:
{
  "segments": [
    {
      "startSec": number,
      "endSec": number,
      "text": "string",
      "emotion": "string",
      "energy": number
    }
  ]
}
`;

const SCRIPT_PROMPT_APPENDIX = `
Treat sceneWindows as the primary timing grid for the script. Prefer one or
more segments that stay inside their corresponding scene window, and keep the
commentary synchronized to the rhythm of those windows.
Use visualMoments when they exist. Treat them as visual evidence from real video
keyframes and prioritize them when describing momentum, crowd energy, shot pace,
court positioning, and late-match tension. Stay factual and avoid inventing
specific shot outcomes that are not supported by score timeline or visualMoments.
Use audioTranscriptMoments when they exist to capture real referee calls, crowd
reactions, existing venue commentary, or audible shifts in tension.
`;

const VISION_PROMPT = `
You are analyzing pickleball match keyframes before a commentary script is
written. Use the provided frames and match context to describe only what is
visually supportable.

Return strict JSON with this schema:
{
  "visualMoments": [
    {
      "timestampSec": number,
      "summary": "string",
      "emphasis": "string",
      "atmosphere": "string",
      "shotType": "string"
    }
  ]
}

Rules:
- Be concise and factual.
- Focus on posture, court occupation, rally intensity, celebration, scoreboard
  visibility, crowd/stadium mood, and endgame tension.
- Do not identify impossible details from a still frame.
- Do not invent winners, scores, or rally outcomes beyond the supplied context.
`;

const MAX_VISUAL_MOMENTS = 6;
const MAX_SCENE_WINDOWS = 6;
const MAX_AUDIO_TRANSCRIPT_MOMENTS = 4;
const DEFAULT_TRANSCRIBE_MODEL =
  process.env.LIVE_RECORDING_AI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const SCENE_DETECTION_THRESHOLD = Math.max(
  0.08,
  Math.min(0.6, Number(process.env.LIVE_RECORDING_AI_SCENE_THRESHOLD) || 0.18)
);
const MIN_SCENE_GAP_SECONDS = Math.max(
  3,
  Number(process.env.LIVE_RECORDING_AI_SCENE_MIN_GAP_SECONDS) || 6
);

function safeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampSecond(value, totalDurationSeconds = 0) {
  return Math.max(
    0,
    Math.min(
      Math.max(0, Math.round(asNumber(totalDurationSeconds, 0))),
      Math.round(asNumber(value, 0))
    )
  );
}

function uniqueSortedSeconds(
  values = [],
  minGapSeconds = MIN_SCENE_GAP_SECONDS
) {
  const sorted = [
    ...new Set(
      (Array.isArray(values) ? values : []).map((value) =>
        clampSecond(value, 86_400)
      )
    ),
  ]
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
  const output = [];
  for (const value of sorted) {
    if (!output.length || value - output[output.length - 1] >= minGapSeconds) {
      output.push(value);
    }
  }
  return output;
}

function limitEvenlySpaced(items = [], maxItems = MAX_SCENE_WINDOWS) {
  if (!Array.isArray(items) || items.length <= maxItems) return items || [];
  if (maxItems <= 1) return [items[0]];

  const picked = [];
  for (let index = 0; index < maxItems; index += 1) {
    const sourceIndex = Math.round(
      (index * (items.length - 1)) / (maxItems - 1)
    );
    picked.push(items[sourceIndex]);
  }
  return picked.filter(
    (item, index) =>
      index === 0 || JSON.stringify(item) !== JSON.stringify(picked[index - 1])
  );
}

function sanitizeSettings(source = {}) {
  const next = {
    ...DEFAULT_AI_COMMENTARY_SETTINGS,
    ...(source || {}),
  };
  next.enabled = next.enabled === true;
  next.autoGenerateAfterDriveUpload =
    next.autoGenerateAfterDriveUpload !== false;
  next.defaultLanguage = ["vi", "en"].includes(
    safeText(next.defaultLanguage).toLowerCase()
  )
    ? safeText(next.defaultLanguage).toLowerCase()
    : DEFAULT_AI_COMMENTARY_SETTINGS.defaultLanguage;
  next.defaultVoicePreset =
    resolveAiCommentaryVoicePreset(
      next.defaultVoicePreset,
      next.defaultLanguage
    )?.id || DEFAULT_AI_COMMENTARY_SETTINGS.defaultVoicePreset;
  next.scriptBaseUrl = safeText(next.scriptBaseUrl);
  next.scriptModel = safeText(next.scriptModel);
  next.ttsBaseUrl = safeText(next.ttsBaseUrl);
  next.ttsModel = safeText(next.ttsModel);
  next.defaultTonePreset =
    resolveAiCommentaryTonePreset(next.defaultTonePreset)?.id ||
    DEFAULT_AI_COMMENTARY_SETTINGS.defaultTonePreset;
  next.keepOriginalAudioBed = next.keepOriginalAudioBed !== false;
  next.audioBedLevelDb = Math.max(
    -40,
    Math.min(0, Math.round(asNumber(next.audioBedLevelDb, -18)))
  );
  next.duckAmountDb = Math.max(
    -30,
    Math.min(0, Math.round(asNumber(next.duckAmountDb, -12)))
  );
  return next;
}

export async function loadLiveRecordingAiCommentarySettings() {
  const doc =
    (await SystemSettings.findById("system")
      .lean()
      .catch(() => null)) || {};
  return sanitizeSettings(doc?.liveRecording?.aiCommentary || {});
}

export function computeLiveRecordingAiCommentarySettingsHash({
  language,
  voicePreset,
  scriptBaseUrl,
  scriptModel,
  tonePreset,
  ttsBaseUrl,
  ttsModel,
  keepOriginalAudioBed,
  audioBedLevelDb,
  duckAmountDb,
} = {}) {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        language,
        voicePreset,
        scriptBaseUrl,
        scriptModel,
        tonePreset,
        ttsBaseUrl,
        ttsModel,
        keepOriginalAudioBed,
        audioBedLevelDb,
        duckAmountDb,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

export function buildLiveRecordingAiCommentaryFingerprint(
  recording = {},
  settings = {}
) {
  const sourceKey =
    safeText(recording?.driveFileId) ||
    safeText(recording?.driveRawUrl) ||
    safeText(recording?._id);
  const settingsHash = computeLiveRecordingAiCommentarySettingsHash({
    language: settings.defaultLanguage,
    voicePreset: settings.defaultVoicePreset,
    scriptBaseUrl: settings.scriptBaseUrl,
    scriptModel: settings.scriptModel,
    tonePreset: settings.defaultTonePreset,
    ttsBaseUrl: settings.ttsBaseUrl,
    ttsModel: settings.ttsModel,
    keepOriginalAudioBed: settings.keepOriginalAudioBed,
    audioBedLevelDb: settings.audioBedLevelDb,
    duckAmountDb: settings.duckAmountDb,
  });
  return {
    sourceFingerprint: `${sourceKey}:${settingsHash}`,
    settingsHash,
  };
}

export function buildAiCommentarySummary(recording = {}) {
  const ai = recording?.aiCommentary || {};
  const playbackUrl =
    safeText(ai.dubbedPlaybackUrl) ||
    (recording?._id &&
    (safeText(ai.dubbedDriveFileId) || safeText(ai.dubbedDriveRawUrl))
      ? buildRecordingAiCommentaryPlaybackUrl(recording._id)
      : null);
  return {
    status: safeText(ai.status || "idle") || "idle",
    latestJobId: ai.latestJobId ? String(ai.latestJobId) : null,
    sourceDriveFileId: safeText(ai.sourceDriveFileId) || null,
    language: safeText(ai.language) || null,
    voicePreset: safeText(ai.voicePreset) || null,
    tonePreset: safeText(ai.tonePreset) || null,
    sourceFingerprint: safeText(ai.sourceFingerprint) || null,
    dubbedDriveFileId: safeText(ai.dubbedDriveFileId) || null,
    dubbedDriveRawUrl: safeText(ai.dubbedDriveRawUrl) || null,
    dubbedDrivePreviewUrl: safeText(ai.dubbedDrivePreviewUrl) || null,
    dubbedPlaybackUrl: playbackUrl,
    outputSizeBytes: Math.max(0, Number(ai.outputSizeBytes) || 0),
    rawUrl:
      safeText(ai.dubbedDriveRawUrl) ||
      (recording?._id ? buildRecordingAiCommentaryRawUrl(recording._id) : null),
    renderedAt: ai.renderedAt || null,
    error: safeText(ai.error) || null,
    ready: Boolean(
      safeText(ai.dubbedDriveFileId) ||
        safeText(ai.dubbedDriveRawUrl) ||
        safeText(ai.dubbedPlaybackUrl)
    ),
  };
}

function extractJsonFromResponse(response) {
  if (
    typeof response?.output_text === "string" &&
    response.output_text.trim()
  ) {
    try {
      return JSON.parse(response.output_text);
    } catch {
      // ignore
    }
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_json" && part?.json) {
        return part.json;
      }
      const maybeText =
        part?.text?.value ||
        (typeof part?.text === "string" ? part.text : "") ||
        "";
      if (!maybeText) continue;
      try {
        return JSON.parse(maybeText);
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function getDisplayName(value) {
  return safeText(value);
}

function pickPlayerName(player, mode = "full") {
  if (!player) return "";
  const normalizedMode = safeText(mode).toLowerCase();
  const candidates =
    normalizedMode === "nickname"
      ? [
          player?.nickname,
          player?.nickName,
          player?.user?.nickname,
          player?.user?.nickName,
          player?.shortName,
          player?.fullName,
          player?.name,
          player?.user?.fullName,
          player?.user?.name,
        ]
      : [
          player?.fullName,
          player?.name,
          player?.user?.fullName,
          player?.user?.name,
          player?.nickname,
          player?.nickName,
          player?.user?.nickname,
          player?.user?.nickName,
          player?.shortName,
        ];
  return getDisplayName(candidates.find((item) => safeText(item)));
}

function registrationToLabel(registration, displayMode = "fullName") {
  if (!registration) return "Chưa có đội";
  const teamName =
    safeText(registration?.teamName) ||
    safeText(registration?.label) ||
    safeText(registration?.displayName) ||
    safeText(registration?.title);
  if (teamName) return teamName;

  const names = [registration?.player1, registration?.player2]
    .map((player) => pickPlayerName(player, displayMode))
    .filter(Boolean);

  if (names.length >= 2) return `${names[0]} / ${names[1]}`;
  if (names.length === 1) return names[0];
  return "Chưa có đội";
}

function buildGameResults(match) {
  const scores = Array.isArray(match?.gameScores) ? match.gameScores : [];
  return scores
    .map((game, index) => ({
      index: index + 1,
      a: asNumber(game?.a),
      b: asNumber(game?.b),
      winner:
        asNumber(game?.a) > asNumber(game?.b)
          ? "A"
          : asNumber(game?.b) > asNumber(game?.a)
          ? "B"
          : "",
    }))
    .filter((game) => game.a > 0 || game.b > 0);
}

function summarizeLiveLog(match) {
  const logs = Array.isArray(match?.liveLog) ? match.liveLog : [];
  const summary = {
    totalEntries: logs.length,
    pointEvents: 0,
    serveEvents: 0,
    sideoutEvents: 0,
    rotateEvents: 0,
    finishEvents: 0,
  };

  for (const entry of logs) {
    const type = safeText(entry?.type).toLowerCase();
    if (type === "point") summary.pointEvents += 1;
    else if (type === "serve") summary.serveEvents += 1;
    else if (type === "sideout") summary.sideoutEvents += 1;
    else if (type === "rotate") summary.rotateEvents += 1;
    else if (type === "finish") summary.finishEvents += 1;
  }

  return summary;
}

function buildTimelineHints(recording, match) {
  const totalDurationSeconds = Math.max(
    45,
    Math.round(asNumber(recording?.durationSeconds, 0) || 180)
  );
  const games = buildGameResults(match);
  const anchors = [];
  anchors.push({
    startSec: 0,
    endSec: Math.min(10, totalDurationSeconds * 0.12),
    kind: "intro",
  });
  if (games.length >= 1) {
    anchors.push({
      startSec: Math.min(
        totalDurationSeconds * 0.22,
        Math.max(12, totalDurationSeconds - 35)
      ),
      endSec: Math.min(totalDurationSeconds * 0.32, totalDurationSeconds - 20),
      kind: "early",
    });
  }
  if (games.length >= 2) {
    anchors.push({
      startSec: Math.min(
        totalDurationSeconds * 0.48,
        totalDurationSeconds - 25
      ),
      endSec: Math.min(totalDurationSeconds * 0.6, totalDurationSeconds - 15),
      kind: "middle",
    });
  }
  anchors.push({
    startSec: Math.max(0, totalDurationSeconds * 0.78),
    endSec: Math.max(8, totalDurationSeconds - 6),
    kind: "closing",
  });
  anchors.push({
    startSec: Math.max(0, totalDurationSeconds - 8),
    endSec: totalDurationSeconds,
    kind: "outro",
  });

  return anchors.map((anchor) => ({
    ...anchor,
    startSec: Math.max(0, Math.round(anchor.startSec)),
    endSec: Math.max(
      Math.round(anchor.startSec + 4),
      Math.round(anchor.endSec)
    ),
  }));
}

function buildFallbackVisualMoments({ recording, match }) {
  const totalDurationSeconds = Math.max(
    45,
    Math.round(asNumber(recording?.durationSeconds, 180))
  );
  return buildTimelineHints(recording, match)
    .slice(0, MAX_VISUAL_MOMENTS)
    .map((anchor, index) => ({
      timestampSec: clampSecond(
        Math.round((asNumber(anchor.startSec) + asNumber(anchor.endSec)) / 2),
        totalDurationSeconds
      ),
      summary:
        anchor.kind === "intro"
          ? "Wide setup of the court and player positioning before the match rhythm settles."
          : anchor.kind === "closing"
          ? "Late-match frame with visible tension as the rally phases tighten."
          : anchor.kind === "outro"
          ? "Post-match or near-finish frame suited for wrap-up commentary."
          : "In-play moment that helps describe tempo and tactical balance.",
      emphasis:
        anchor.kind === "intro"
          ? "opening setup"
          : anchor.kind === "closing"
          ? "late pressure"
          : anchor.kind === "outro"
          ? "finish and reaction"
          : "mid-match tempo",
      atmosphere:
        anchor.kind === "closing" || anchor.kind === "outro"
          ? "tense"
          : "competitive",
      shotType:
        index === 0 ? "wide" : anchor.kind === "outro" ? "reaction" : "rally",
    }));
}

function buildFallbackSceneSeeds({ recording, match }) {
  const totalDurationSeconds = Math.max(
    45,
    Math.round(asNumber(recording?.durationSeconds, 180))
  );
  return buildTimelineHints(recording, match)
    .slice(0, MAX_SCENE_WINDOWS)
    .map((anchor, index) => ({
      peakSec: clampSecond(
        Math.round((asNumber(anchor.startSec) + asNumber(anchor.endSec)) / 2),
        totalDurationSeconds
      ),
      kind: safeText(anchor.kind) || (index === 0 ? "intro" : "rally"),
      confidence: 0.35,
      source: "timeline_hint",
    }));
}

function classifySceneKind(peakSec, totalDurationSeconds) {
  const ratio =
    totalDurationSeconds > 0 ? asNumber(peakSec, 0) / totalDurationSeconds : 0;
  if (ratio <= 0.12) return "intro";
  if (ratio >= 0.93) return "outro";
  if (ratio >= 0.75) return "closing";
  if (ratio >= 0.42) return "middle";
  return "early";
}

function normalizeSceneSeeds(seeds = [], totalDurationSeconds = 180) {
  return (Array.isArray(seeds) ? seeds : [])
    .map((seed, index) => ({
      peakSec: clampSecond(
        seed?.peakSec ?? seed?.timestampSec ?? index * 15,
        totalDurationSeconds
      ),
      kind:
        safeText(seed?.kind).toLowerCase() ||
        classifySceneKind(
          seed?.peakSec ?? seed?.timestampSec ?? 0,
          totalDurationSeconds
        ),
      confidence: Math.max(
        0,
        Math.min(
          1,
          asNumber(
            seed?.confidence,
            seed?.source === "scene_detect" ? 0.82 : 0.35
          )
        )
      ),
      source: safeText(seed?.source) || "timeline_hint",
    }))
    .sort((a, b) => a.peakSec - b.peakSec);
}

function clampVisualMoments(moments = [], totalDurationSeconds = 180) {
  return (Array.isArray(moments) ? moments : [])
    .map((moment, index) => ({
      timestampSec: clampSecond(
        moment?.timestampSec ?? moment?.startSec ?? index * 15,
        totalDurationSeconds
      ),
      summary: safeText(moment?.summary),
      emphasis: safeText(moment?.emphasis || moment?.kind),
      atmosphere: safeText(moment?.atmosphere),
      shotType: safeText(moment?.shotType),
    }))
    .filter((moment) => moment.summary)
    .slice(0, MAX_VISUAL_MOMENTS);
}

function clampAudioTranscriptMoments(moments = [], totalDurationSeconds = 180) {
  return (Array.isArray(moments) ? moments : [])
    .map((moment, index) => {
      const startSec = clampSecond(
        moment?.startSec ?? moment?.timestampSec ?? index * 18,
        totalDurationSeconds
      );
      const endSec = Math.max(
        startSec + 2,
        clampSecond(moment?.endSec ?? startSec + 10, totalDurationSeconds)
      );
      return {
        startSec,
        endSec,
        text: safeText(moment?.text),
        emphasis: safeText(moment?.emphasis),
      };
    })
    .filter((moment) => moment.text)
    .slice(0, MAX_AUDIO_TRANSCRIPT_MOMENTS);
}

function buildScoreContextSummary(match, kind = "") {
  const games = buildGameResults(match);
  const gameSummary = games.length
    ? games
        .map(
          (game) =>
            `G${game.index} ${game.a}-${game.b}${
              game.winner ? ` (${game.winner})` : ""
            }`
        )
        .join(", ")
    : "No completed games recorded";
  const liveSummary = summarizeLiveLog(match);
  const phaseLabel =
    kind === "intro"
      ? "Opening"
      : kind === "closing" || kind === "outro"
      ? "Late-match / finish"
      : kind === "middle"
      ? "Mid-match"
      : "Early pressure";

  return `${phaseLabel}. Winner side: ${
    safeText(match?.winner) || "unknown"
  }. Games: ${gameSummary}. Live log: ${liveSummary.pointEvents} points, ${
    liveSummary.serveEvents
  } serves, ${liveSummary.sideoutEvents} sideouts, ${
    liveSummary.finishEvents
  } finishes.`;
}

function pickBestVisualMomentForWindow(window, visualMoments = []) {
  const candidates = (Array.isArray(visualMoments) ? visualMoments : []).filter(
    (moment) =>
      asNumber(moment?.timestampSec, -1) >= asNumber(window?.startSec, 0) &&
      asNumber(moment?.timestampSec, -1) <= asNumber(window?.endSec, 0)
  );
  if (candidates.length) return candidates[0];

  return (Array.isArray(visualMoments) ? visualMoments : [])
    .slice()
    .sort(
      (a, b) =>
        Math.abs(asNumber(a?.timestampSec, 0) - asNumber(window?.peakSec, 0)) -
        Math.abs(asNumber(b?.timestampSec, 0) - asNumber(window?.peakSec, 0))
    )[0];
}

function pickBestTranscriptForWindow(window, audioTranscriptMoments = []) {
  const candidates = (
    Array.isArray(audioTranscriptMoments) ? audioTranscriptMoments : []
  ).filter(
    (moment) =>
      asNumber(moment?.startSec, -1) <= asNumber(window?.endSec, 0) &&
      asNumber(moment?.endSec, -1) >= asNumber(window?.startSec, 0)
  );
  if (candidates.length) return candidates[0];

  return (Array.isArray(audioTranscriptMoments) ? audioTranscriptMoments : [])
    .slice()
    .sort(
      (a, b) =>
        Math.abs(asNumber(a?.startSec, 0) - asNumber(window?.peakSec, 0)) -
        Math.abs(asNumber(b?.startSec, 0) - asNumber(window?.peakSec, 0))
    )[0];
}

function buildSceneWindows({
  recording,
  match,
  sceneSeeds = [],
  visualMoments = [],
  audioTranscriptMoments = [],
}) {
  const totalDurationSeconds = Math.max(
    45,
    Math.round(asNumber(recording?.durationSeconds, 180))
  );
  const seeds = normalizeSceneSeeds(sceneSeeds, totalDurationSeconds);
  if (!seeds.length) return [];

  return seeds.map((seed, index) => {
    const previous = seeds[index - 1] || null;
    const next = seeds[index + 1] || null;
    const startSec =
      index === 0
        ? 0
        : Math.max(0, Math.round((previous.peakSec + seed.peakSec) / 2));
    const endSec =
      index === seeds.length - 1
        ? totalDurationSeconds
        : Math.min(
            totalDurationSeconds,
            Math.max(
              startSec + 4,
              Math.round((seed.peakSec + next.peakSec) / 2)
            )
          );
    const window = {
      sceneIndex: index,
      startSec,
      endSec,
      peakSec: clampSecond(seed.peakSec, totalDurationSeconds),
      kind: seed.kind,
      confidence: seed.confidence,
      source: seed.source,
    };
    const visual = pickBestVisualMomentForWindow(window, visualMoments);
    const audio = pickBestTranscriptForWindow(window, audioTranscriptMoments);
    return {
      ...window,
      visualSummary: safeText(visual?.summary) || "",
      audioSnippet: safeText(audio?.text) || "",
      scoreContext: buildScoreContextSummary(match, seed.kind),
    };
  });
}

function buildCommentaryPayload({
  recording,
  match,
  settings,
  visualMoments = [],
  audioTranscriptMoments = [],
  sceneWindows = [],
}) {
  const displayMode = safeText(
    match?.tournament?.nameDisplayMode || "fullName"
  );
  const pairA = registrationToLabel(match?.pairA, displayMode);
  const pairB = registrationToLabel(match?.pairB, displayMode);
  const games = buildGameResults(match);
  const durationSeconds = Math.max(
    45,
    Math.round(asNumber(recording?.durationSeconds, 180))
  );
  return {
    language: settings.defaultLanguage,
    tonePreset: settings.defaultTonePreset,
    voicePreset: settings.defaultVoicePreset,
    analysisMode:
      Array.isArray(sceneWindows) && sceneWindows.length
        ? Array.isArray(audioTranscriptMoments) && audioTranscriptMoments.length
          ? "scene_synced_vision_audio"
          : "scene_synced_vision"
        : Array.isArray(visualMoments) && visualMoments.length
        ? Array.isArray(audioTranscriptMoments) && audioTranscriptMoments.length
          ? "vision_audio_assisted"
          : "vision_assisted"
        : Array.isArray(audioTranscriptMoments) && audioTranscriptMoments.length
        ? "audio_assisted"
        : "metadata_fallback",
    match: {
      code: safeText(match?.code),
      status: safeText(match?.status),
      participants: `${pairA} vs ${pairB}`,
      pairA,
      pairB,
      tournamentName: safeText(match?.tournament?.name),
      bracketName: safeText(match?.bracket?.name),
      bracketStage: safeText(match?.bracket?.stage),
      courtLabel:
        safeText(match?.courtLabel) ||
        safeText(match?.court?.label) ||
        safeText(match?.court?.name),
      durationSeconds,
      winnerSide: safeText(match?.winner),
      gameResults: games,
      liveLogSummary: summarizeLiveLog(match),
      timelineHints: buildTimelineHints(recording, match),
    },
    visualMoments: clampVisualMoments(visualMoments, durationSeconds),
    audioTranscriptMoments: clampAudioTranscriptMoments(
      audioTranscriptMoments,
      durationSeconds
    ),
    sceneWindows: (Array.isArray(sceneWindows) ? sceneWindows : [])
      .map((window, index) => ({
        sceneIndex: Number.isInteger(window?.sceneIndex)
          ? window.sceneIndex
          : index,
        startSec: clampSecond(window?.startSec, durationSeconds),
        endSec: Math.max(
          clampSecond(window?.startSec, durationSeconds) + 3,
          clampSecond(window?.endSec, durationSeconds)
        ),
        peakSec: clampSecond(window?.peakSec, durationSeconds),
        kind: safeText(window?.kind),
        confidence: Math.max(0, Math.min(1, asNumber(window?.confidence, 0.3))),
        visualSummary: safeText(window?.visualSummary),
        audioSnippet: safeText(window?.audioSnippet),
        scoreContext: safeText(window?.scoreContext),
      }))
      .slice(0, MAX_SCENE_WINDOWS),
  };
}

function clampSegments(segments = [], totalDurationSeconds = 180) {
  const normalized = (Array.isArray(segments) ? segments : [])
    .map((segment, index) => {
      const startSec = Math.max(
        0,
        Math.round(asNumber(segment?.startSec, index * 12))
      );
      const endSec = Math.min(
        totalDurationSeconds,
        Math.max(
          startSec + 3,
          Math.round(asNumber(segment?.endSec, startSec + 8))
        )
      );
      return {
        startSec,
        endSec,
        text: safeText(segment?.text),
        emotion: safeText(segment?.emotion),
        sceneIndex: Number.isInteger(Number(segment?.sceneIndex))
          ? Number(segment.sceneIndex)
          : null,
        windowKind: safeText(segment?.windowKind || segment?.kind),
        energy: Math.max(
          1,
          Math.min(10, Math.round(asNumber(segment?.energy, 6)))
        ),
      };
    })
    .filter((segment) => segment.text);

  const output = [];
  let lastEnd = 0;
  for (const segment of normalized) {
    const startSec = Math.max(lastEnd, segment.startSec);
    const endSec = Math.max(startSec + 3, segment.endSec);
    output.push({
      ...segment,
      startSec,
      endSec: Math.min(totalDurationSeconds, endSec),
    });
    lastEnd = Math.min(totalDurationSeconds, endSec);
  }
  return output;
}

function alignSegmentsToSceneWindows(
  segments = [],
  sceneWindows = [],
  totalDurationSeconds = 180
) {
  const normalized = clampSegments(segments, totalDurationSeconds);
  if (!Array.isArray(sceneWindows) || !sceneWindows.length) return normalized;

  const windows = [...sceneWindows].sort(
    (a, b) => asNumber(a?.startSec, 0) - asNumber(b?.startSec, 0)
  );

  const aligned = normalized
    .map((segment, index) => {
      const explicitIndex = Number.isInteger(segment?.sceneIndex)
        ? segment.sceneIndex
        : null;
      const fallbackIndex = Math.min(index, windows.length - 1);
      const window =
        (explicitIndex != null && windows[explicitIndex]) ||
        windows.find(
          (item) =>
            segment.startSec >= asNumber(item?.startSec, 0) &&
            segment.startSec <= asNumber(item?.endSec, totalDurationSeconds)
        ) ||
        windows[fallbackIndex];
      if (!window) return segment;

      let startSec = Math.max(segment.startSec, asNumber(window.startSec, 0));
      let endSec = Math.min(
        asNumber(window.endSec, totalDurationSeconds),
        Math.max(startSec + 3, segment.endSec)
      );
      if (endSec - startSec < 3) {
        endSec = Math.min(
          asNumber(window.endSec, totalDurationSeconds),
          Math.max(startSec + 3, asNumber(window.startSec, 0) + 3)
        );
        startSec = Math.max(
          asNumber(window.startSec, 0),
          Math.min(startSec, endSec - 3)
        );
      }

      return {
        ...segment,
        startSec,
        endSec,
        sceneIndex: Number(window.sceneIndex) || 0,
        windowKind: safeText(window.kind),
      };
    })
    .sort((a, b) => a.startSec - b.startSec);

  const output = [];
  let lastEnd = 0;
  for (const segment of aligned) {
    const startSec = Math.max(lastEnd, segment.startSec);
    const endSec = Math.max(startSec + 3, segment.endSec);
    output.push({
      ...segment,
      startSec,
      endSec: Math.min(totalDurationSeconds, endSec),
    });
    lastEnd = Math.min(totalDurationSeconds, endSec);
  }
  return output;
}

function buildFallbackSegments({
  recording,
  match,
  settings,
  visualMoments = [],
  sceneWindows = [],
}) {
  const payload = buildCommentaryPayload({
    recording,
    match,
    settings,
    visualMoments,
    sceneWindows,
  });
  const total = payload.match.durationSeconds;
  const games = payload.match.gameResults;
  const pairA = payload.match.pairA;
  const pairB = payload.match.pairB;
  const openingMoment = payload.visualMoments[0];
  const middleMoment = payload.visualMoments[1] || payload.visualMoments[0];
  const closingMoment =
    payload.visualMoments[payload.visualMoments.length - 1] ||
    payload.visualMoments[0];
  const openingScene = payload.sceneWindows[0];
  const middleScene = payload.sceneWindows[1] || payload.sceneWindows[0];
  const closingScene =
    payload.sceneWindows[payload.sceneWindows.length - 1] ||
    payload.sceneWindows[0];
  const winner =
    payload.match.winnerSide === "A"
      ? pairA
      : payload.match.winnerSide === "B"
      ? pairB
      : "đội thắng trận";

  return clampSegments(
    [
      {
        startSec: 0,
        endSec: 8,
        text:
          settings.defaultLanguage === "en"
            ? `Welcome to ${
                payload.match.tournamentName || "PickleTour"
              } as ${pairA} face ${pairB}.${
                openingMoment?.summary ? ` ${openingMoment.summary}` : ""
              }${
                openingScene?.scoreContext
                  ? ` ${openingScene.scoreContext}`
                  : ""
              }`
            : `Chúng ta đến với trận đấu giữa ${pairA} và ${pairB} tại ${
                payload.match.tournamentName || "PickleTour"
              }.`,
        emotion: "intro",
        energy: 5,
      },
      {
        startSec: Math.round(total * 0.28),
        endSec: Math.round(total * 0.4),
        text:
          settings.defaultLanguage === "en"
            ? `The match stays tense through the early exchanges, with both sides forcing long rallies and constant adjustments.${
                middleMoment?.summary ? ` ${middleMoment.summary}` : ""
              }${
                middleScene?.audioSnippet
                  ? ` Audio cue: ${middleScene.audioSnippet}`
                  : ""
              }`
            : `Thế trận giữ nhịp khá căng ngay từ đầu, hai bên liên tục điều chỉnh chiến thuật và kéo những pha bóng dài.`,
        emotion: "mid",
        energy: 6,
      },
      games.length > 1
        ? {
            startSec: Math.round(total * 0.58),
            endSec: Math.round(total * 0.72),
            text:
              settings.defaultLanguage === "en"
                ? `After multiple swings in momentum, every point starts to matter more as the score tightens late in the match.`
                : `Sau nhiều lần đổi nhịp thế trận, từng điểm số bắt đầu trở nên cực kỳ quan trọng ở giai đoạn cuối của trận.`,
            emotion: "build",
            energy: 7,
          }
        : null,
      {
        startSec: Math.max(0, total - 9),
        endSec: total,
        text:
          settings.defaultLanguage === "en"
            ? `${winner} close it out to finish a hard-fought match.${
                closingMoment?.summary ? ` ${closingMoment.summary}` : ""
              }${
                closingScene?.audioSnippet
                  ? ` ${closingScene.audioSnippet}`
                  : ""
              }`
            : `${winner} là bên khép lại trận đấu sau một màn so tài rất nỗ lực.`,
        emotion: "outro",
        energy: 6,
      },
    ].filter(Boolean),
    total
  );
}

async function writeBufferToFile(filePath, buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

async function runFfmpeg(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) {
        resolve({ code, stderr });
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

async function detectSceneChangePeaks(sourceVideoPath, totalDurationSeconds) {
  const detection = await runFfmpeg(
    [
      "-hide_banner",
      "-i",
      sourceVideoPath,
      "-filter:v",
      `select='gt(scene,${SCENE_DETECTION_THRESHOLD})',showinfo`,
      "-an",
      "-f",
      "null",
      "-",
    ],
    { allowFailure: true }
  );

  const matches = [
    ...String(detection?.stderr || "").matchAll(
      /pts_time:([0-9]+(?:\.[0-9]+)?)/g
    ),
  ];
  const rawSeconds = matches
    .map((match) => Math.round(asNumber(match?.[1], -1)))
    .filter(
      (value) =>
        Number.isFinite(value) && value > 1 && value < totalDurationSeconds - 1
    );

  return uniqueSortedSeconds(rawSeconds, MIN_SCENE_GAP_SECONDS);
}

function mergeSceneSeeds({
  recording,
  match,
  detectedPeaks = [],
  totalDurationSeconds = 180,
}) {
  const fallbackSeeds = buildFallbackSceneSeeds({ recording, match });
  const detectedSeeds = (Array.isArray(detectedPeaks) ? detectedPeaks : []).map(
    (peakSec) => ({
      peakSec,
      kind: classifySceneKind(peakSec, totalDurationSeconds),
      confidence: 0.82,
      source: "scene_detect",
    })
  );

  const combined = normalizeSceneSeeds(
    [...fallbackSeeds, ...detectedSeeds],
    totalDurationSeconds
  );
  const deduped = [];
  for (const seed of combined) {
    const previous = deduped[deduped.length - 1];
    if (!previous || seed.peakSec - previous.peakSec >= MIN_SCENE_GAP_SECONDS) {
      deduped.push(seed);
      continue;
    }
    if (seed.confidence > previous.confidence) {
      deduped[deduped.length - 1] = seed;
    }
  }

  return limitEvenlySpaced(deduped, MAX_SCENE_WINDOWS);
}

async function extractFrameAtTimestamp({
  sourceVideoPath,
  timestampSec,
  outputPath,
}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runFfmpeg([
    "-y",
    "-ss",
    String(Math.max(0, asNumber(timestampSec, 0))),
    "-i",
    sourceVideoPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outputPath,
  ]);
  return outputPath;
}

async function readFileAsDataUrl(filePath, mimeType = "image/jpeg") {
  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function downloadResponseStreamToFile(response, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await new Promise((resolve, reject) => {
    const output = createWriteStream(filePath);
    response.data.pipe(output);
    response.data.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
  });
}

async function downloadRecordingSourceVideo(recording, targetPath) {
  if (safeText(recording?.driveFileId)) {
    const { response } = await streamRecordingDriveFile({
      fileId: recording.driveFileId,
      rangeHeader: "",
    });
    if (!response?.data?.pipe) {
      throw new Error("Drive stream response is invalid");
    }
    await downloadResponseStreamToFile(response, targetPath);
    return targetPath;
  }

  if (safeText(recording?.driveRawUrl)) {
    const response = await axios.get(recording.driveRawUrl, {
      responseType: "arraybuffer",
      timeout: 180000,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    await writeBufferToFile(targetPath, Buffer.from(response.data));
    return targetPath;
  }

  throw new Error("recording_source_video_not_ready");
}

async function analyzeVideoVisualMoments({
  sourceVideoPath,
  recording,
  match,
  settings,
  workDir,
  sceneSeeds = [],
}) {
  const runtime = await getLiveRecordingAiCommentaryRuntime();
  const totalDurationSeconds = Math.max(
    45,
    Math.round(asNumber(recording?.durationSeconds, 180))
  );
  const activeSceneSeeds = normalizeSceneSeeds(
    Array.isArray(sceneSeeds) && sceneSeeds.length
      ? sceneSeeds
      : buildFallbackSceneSeeds({ recording, match }),
    totalDurationSeconds
  );
  const fallbackVisualMoments = activeSceneSeeds.map((seed, index) => ({
    timestampSec: clampSecond(seed.peakSec, totalDurationSeconds),
    summary:
      seed.kind === "intro"
        ? "Wide setup of the court and player positioning before the match rhythm settles."
        : seed.kind === "closing" || seed.kind === "outro"
        ? "Late-match frame with visible tension as the rally phases tighten."
        : "In-play moment that helps describe tempo and tactical balance.",
    emphasis: seed.kind || (index === 0 ? "intro" : "rally"),
    atmosphere:
      seed.kind === "closing" || seed.kind === "outro"
        ? "tense"
        : "competitive",
    shotType:
      seed.kind === "intro"
        ? "wide"
        : seed.kind === "outro"
        ? "reaction"
        : "rally",
  }));

  if (!runtime.script.client || !runtime.script.effectiveModel) {
    return fallbackVisualMoments;
  }

  const basePayload = buildCommentaryPayload({
    recording,
    match,
    settings,
    visualMoments: [],
  });

  const extractedFrames = [];
  for (let index = 0; index < activeSceneSeeds.length; index += 1) {
    const seed = activeSceneSeeds[index];
    const moment = fallbackVisualMoments[index];
    const timestampSec = clampSecond(seed.peakSec, totalDurationSeconds);
    const framePath = path.join(
      workDir,
      `frame-${String(index + 1).padStart(2, "0")}.jpg`
    );
    try {
      await extractFrameAtTimestamp({
        sourceVideoPath,
        timestampSec,
        outputPath: framePath,
      });
      const stat = await fs.stat(framePath).catch(() => null);
      if (!stat?.size) continue;
      extractedFrames.push({
        timestampSec,
        hint: moment.emphasis || moment.summary,
        dataUrl: await readFileAsDataUrl(framePath),
      });
    } catch {
      // Ignore individual frame extraction failures and keep other anchors.
    }
  }

  if (!extractedFrames.length) {
    return fallbackVisualMoments;
  }

  try {
    const content = [
      {
        type: "input_text",
        text: JSON.stringify({
          language: settings.defaultLanguage,
          match: basePayload.match,
          instructions:
            "Analyze the attached keyframes and summarize visually grounded match moments for later commentary.",
        }),
      },
    ];

    extractedFrames.forEach((frame, index) => {
      content.push({
        type: "input_text",
        text: `Frame ${index + 1} at ${frame.timestampSec}s. Hint: ${
          frame.hint
        }.`,
      });
      content.push({
        type: "input_image",
        image_url: frame.dataUrl,
      });
    });

    const response = await runtime.script.client.responses.create({
      model: runtime.script.effectiveModel,
      instructions: VISION_PROMPT,
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "live_recording_ai_commentary_visual_moments",
          strict: false,
          schema: {
            type: "object",
            properties: {
              visualMoments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timestampSec: { type: "number" },
                    summary: { type: "string" },
                    emphasis: { type: "string" },
                    atmosphere: { type: "string" },
                    shotType: { type: "string" },
                  },
                  required: ["timestampSec", "summary"],
                  additionalProperties: false,
                },
              },
            },
            required: ["visualMoments"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = extractJsonFromResponse(response);
    const visualMoments = clampVisualMoments(
      parsed?.visualMoments || [],
      totalDurationSeconds
    );
    return visualMoments.length ? visualMoments : fallbackVisualMoments;
  } catch {
    return fallbackVisualMoments;
  }
}

function buildAudioMomentWindows(recording, match, sceneSeeds = []) {
  const totalDurationSeconds = Math.max(
    45,
    Math.round(asNumber(recording?.durationSeconds, 180))
  );
  const seeds = normalizeSceneSeeds(
    Array.isArray(sceneSeeds) && sceneSeeds.length
      ? sceneSeeds
      : buildFallbackSceneSeeds({ recording, match }),
    totalDurationSeconds
  ).slice(0, MAX_AUDIO_TRANSCRIPT_MOMENTS);

  const windows = seeds.map((seed) => {
    const center = clampSecond(seed.peakSec, totalDurationSeconds);
    const clipDuration = Math.min(14, seed.kind === "intro" ? 10 : 12);
    return {
      startSec: clampSecond(
        Math.max(0, center - Math.round(clipDuration / 2)),
        totalDurationSeconds
      ),
      endSec: clampSecond(
        center + Math.round(clipDuration / 2),
        totalDurationSeconds
      ),
      emphasis:
        seed.kind === "intro"
          ? "opening audio and court ambience"
          : seed.kind === "closing" || seed.kind === "outro"
          ? "late-match pressure and reactions"
          : "rally rhythm and court sound",
    };
  });

  return windows.filter((window) => window.endSec > window.startSec + 1);
}

async function extractAudioPreviewClip({
  sourceVideoPath,
  startSec,
  endSec,
  outputPath,
}) {
  const clipDuration = Math.max(2, asNumber(endSec, 0) - asNumber(startSec, 0));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runFfmpeg([
    "-y",
    "-ss",
    String(Math.max(0, asNumber(startSec, 0))),
    "-i",
    sourceVideoPath,
    "-t",
    String(clipDuration),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "mp3",
    outputPath,
  ]);
  return outputPath;
}

async function analyzeAudioTranscriptMoments({
  sourceVideoPath,
  recording,
  match,
  settings,
  workDir,
  sceneSeeds = [],
}) {
  const runtime = await getLiveRecordingAiCommentaryRuntime();
  if (!runtime.script.client) {
    return [];
  }

  const windows = buildAudioMomentWindows(recording, match, sceneSeeds);
  if (!windows.length) {
    return [];
  }

  const transcriptMoments = [];
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    const clipPath = path.join(
      workDir,
      `audio-preview-${String(index + 1).padStart(2, "0")}.mp3`
    );
    try {
      await extractAudioPreviewClip({
        sourceVideoPath,
        startSec: window.startSec,
        endSec: window.endSec,
        outputPath: clipPath,
      });
      const transcription =
        await runtime.script.client.audio.transcriptions.create({
          file: createReadStream(clipPath),
          model: DEFAULT_TRANSCRIBE_MODEL,
          language: settings.defaultLanguage,
          prompt:
            settings.defaultLanguage === "en"
              ? "Transcribe audible commentary, referee calls, reactions, and short court sounds relevant to pickleball."
              : "Chep lai phan co the nghe duoc tu binh luan san dau, trong tai, tieng co vu va am thanh lien quan den tran pickleball.",
        });
      const text = safeText(transcription?.text);
      if (!text) continue;
      transcriptMoments.push({
        startSec: window.startSec,
        endSec: window.endSec,
        text,
        emphasis: window.emphasis,
      });
    } catch {
      // Skip ASR failure for a single clip; fallback remains available.
    }
  }

  return clampAudioTranscriptMoments(
    transcriptMoments,
    Math.max(45, Math.round(asNumber(recording?.durationSeconds, 180)))
  );
}

function buildAnalysisPreview({
  sceneWindows = [],
  audioTranscriptMoments = [],
}) {
  return {
    sceneWindows: (Array.isArray(sceneWindows) ? sceneWindows : [])
      .slice(0, MAX_SCENE_WINDOWS)
      .map((window) => ({
        sceneIndex: Number(window?.sceneIndex) || 0,
        startSec: Math.max(0, Number(window?.startSec) || 0),
        endSec: Math.max(0, Number(window?.endSec) || 0),
        peakSec: Math.max(0, Number(window?.peakSec) || 0),
        kind: safeText(window?.kind),
        confidence: Math.max(0, Math.min(1, asNumber(window?.confidence, 0))),
        visualSummary: safeText(window?.visualSummary),
        audioSnippet: safeText(window?.audioSnippet),
        scoreContext: safeText(window?.scoreContext),
      })),
    transcriptSnippets: (Array.isArray(audioTranscriptMoments)
      ? audioTranscriptMoments
      : []
    )
      .slice(0, MAX_AUDIO_TRANSCRIPT_MOMENTS)
      .map((snippet) => ({
        startSec: Math.max(0, Number(snippet?.startSec) || 0),
        endSec: Math.max(0, Number(snippet?.endSec) || 0),
        text: safeText(snippet?.text),
        emphasis: safeText(snippet?.emphasis),
      })),
  };
}

async function detectHasAudioStream(inputPath) {
  const { stderr } = await runFfmpeg(["-i", inputPath, "-f", "null", "-"], {
    allowFailure: true,
  });
  return /Audio:/i.test(String(stderr || ""));
}

async function renderNarrationTrack({
  segments,
  audioFiles,
  totalDurationSeconds,
  outputPath,
}) {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-t",
    String(Math.max(15, totalDurationSeconds)),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=24000",
  ];

  audioFiles.forEach((file) => {
    args.push("-i", file.filePath);
  });

  const filterParts = [];
  audioFiles.forEach((file, index) => {
    const segment = segments[index];
    const delayMs = Math.max(0, Math.round(asNumber(segment?.startSec) * 1000));
    filterParts.push(
      `[${index + 1}:a]adelay=${delayMs}|${delayMs},volume=1[a${index}]`
    );
  });
  const mixInputs = [
    "[0:a]",
    ...audioFiles.map((_, index) => `[a${index}]`),
  ].join("");
  filterParts.push(
    `${mixInputs}amix=inputs=${
      audioFiles.length + 1
    }:duration=longest:normalize=0[narr]`
  );

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[narr]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath
  );

  await runFfmpeg(args);
  return outputPath;
}

async function renderFinalDubbedVideo({
  sourceVideoPath,
  narrationPath,
  outputPath,
  settings,
}) {
  const hasAudio = await detectHasAudioStream(sourceVideoPath);
  const args = ["-y", "-i", sourceVideoPath, "-i", narrationPath];

  if (hasAudio && settings.keepOriginalAudioBed) {
    const bedVolume = Math.pow(10, settings.audioBedLevelDb / 20).toFixed(4);
    const ratio = Math.max(2, Math.abs(settings.duckAmountDb) / 2 + 2).toFixed(
      2
    );
    const filter = [
      `[0:a]volume=${bedVolume}[bed]`,
      `[bed][1:a]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=20:release=350[ducked]`,
      `[ducked][1:a]amix=inputs=2:duration=first:normalize=0[aout]`,
    ].join(";");

    args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
  } else {
    args.push("-map", "0:v:0", "-map", "1:a:0");
  }

  args.push(
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath
  );

  await runFfmpeg(args);
  return outputPath;
}

async function generateScriptSegments({
  recording,
  match,
  settings,
  visualMoments = [],
  audioTranscriptMoments = [],
  sceneWindows = [],
}) {
  const runtime = await getLiveRecordingAiCommentaryRuntime();
  const payload = buildCommentaryPayload({
    recording,
    match,
    settings,
    visualMoments,
    audioTranscriptMoments,
    sceneWindows,
  });
  const totalDurationSeconds = payload.match.durationSeconds;
  const fallbackSegments = buildFallbackSegments({
    recording,
    match,
    settings,
    visualMoments,
    sceneWindows,
  });

  if (!runtime.script.client || !runtime.script.effectiveModel) {
    return fallbackSegments;
  }

  try {
    const response = await runtime.script.client.responses.create({
      model: runtime.script.effectiveModel,
      instructions: `${SCRIPT_PROMPT}\n${SCRIPT_PROMPT_APPENDIX}`,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(payload),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "live_recording_ai_commentary",
          strict: false,
          schema: {
            type: "object",
            properties: {
              segments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    startSec: { type: "number" },
                    endSec: { type: "number" },
                    text: { type: "string" },
                    emotion: { type: "string" },
                    energy: { type: "number" },
                    sceneIndex: { type: "number" },
                    windowKind: { type: "string" },
                  },
                  required: ["startSec", "endSec", "text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["segments"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = extractJsonFromResponse(response);
    const segments = alignSegmentsToSceneWindows(
      parsed?.segments || [],
      payload.sceneWindows,
      totalDurationSeconds
    );
    return segments.length ? segments : fallbackSegments;
  } catch {
    return fallbackSegments;
  }
}

async function synthesizeSegments({ segments, settings, workDir }) {
  const runtime = await getLiveRecordingAiCommentaryRuntime();
  const voicePreset = resolveAiCommentaryVoicePreset(
    settings.defaultVoicePreset,
    settings.defaultLanguage
  );
  const tonePreset = resolveAiCommentaryTonePreset(settings.defaultTonePreset);

  if (!runtime.tts.client || !runtime.tts.effectiveModel) {
    throw new Error("ai_commentary_tts_not_configured");
  }

  const rendered = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const filePath = path.join(
      workDir,
      `tts-${String(index + 1).padStart(2, "0")}.mp3`
    );
    const response = await runtime.tts.client.audio.speech.create({
      model: runtime.tts.effectiveModel,
      voice: voicePreset.providerVoiceId,
      input: segment.text,
      instructions: `${voicePreset.stylePrompt} ${tonePreset.instructions}`,
      response_format: "mp3",
      speed: Math.max(
        0.8,
        Math.min(1.1, tonePreset.speed || voicePreset.defaultSpeed || 1)
      ),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeBufferToFile(filePath, buffer);
    rendered.push({
      filePath,
      sizeBytes: buffer.length,
    });
  }

  return rendered;
}

function buildDriveFileName(recording, settings) {
  const language = safeText(settings.defaultLanguage || "vi").toLowerCase();
  const voice = safeText(settings.defaultVoicePreset || "voice").toLowerCase();
  return `match_${String(
    recording.match
  )}_${language}_${voice}_ai-commentary_${Date.now()}.mp4`;
}

export async function generateLiveRecordingAiCommentaryArtifact({
  recording,
  match,
  settings,
  onProgress = null,
}) {
  const activeSettings = sanitizeSettings(settings);
  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pickletour-recording-ai-commentary-")
  );
  const notifyProgress =
    typeof onProgress === "function" ? onProgress : async () => {};

  try {
    const sourceVideoPath = path.join(workDir, "source.mp4");
    const totalDurationSeconds = Math.max(
      45,
      Math.round(asNumber(recording?.durationSeconds, 180))
    );
    await notifyProgress({
      key: "resolve_source",
      label: "Chuẩn bị video nguồn",
      progressPercent: 10,
    });
    await downloadRecordingSourceVideo(recording, sourceVideoPath);

    const detectedScenePeaks = await detectSceneChangePeaks(
      sourceVideoPath,
      totalDurationSeconds
    ).catch(() => []);
    const sceneSeeds = mergeSceneSeeds({
      recording,
      match,
      detectedPeaks: detectedScenePeaks,
      totalDurationSeconds,
    });

    await notifyProgress({
      key: "analyze_video",
      label: "Phý¢n tý­ch khung hý¬nh video",
      progressPercent: 22,
    });
    const visualMoments = await analyzeVideoVisualMoments({
      sourceVideoPath,
      recording,
      match,
      settings: activeSettings,
      workDir,
      sceneSeeds,
    });

    await notifyProgress({
      key: "analyze_audio",
      label: "Phan tich am thanh va transcript",
      progressPercent: 26,
    });
    const audioTranscriptMoments = await analyzeAudioTranscriptMoments({
      sourceVideoPath,
      recording,
      match,
      settings: activeSettings,
      workDir,
      sceneSeeds,
    });

    const sceneWindows = buildSceneWindows({
      recording,
      match,
      sceneSeeds,
      visualMoments,
      audioTranscriptMoments,
    });

    await notifyProgress({
      key: "write_script",
      label: "Viết kịch bản bình luận",
      progressPercent: 30,
    });
    const scriptSegments = await generateScriptSegments({
      recording,
      match,
      settings: activeSettings,
      visualMoments,
      audioTranscriptMoments,
      sceneWindows,
    });
    if (!scriptSegments.length) {
      throw new Error("ai_commentary_script_empty");
    }

    await notifyProgress({
      key: "tts",
      label: "Render giọng đọc AI",
      progressPercent: 55,
    });
    const audioFiles = await synthesizeSegments({
      segments: scriptSegments,
      settings: activeSettings,
      workDir,
    });
    if (!audioFiles.length) {
      throw new Error("ai_commentary_audio_empty");
    }

    const narrationPath = path.join(workDir, "narration.m4a");
    await notifyProgress({
      key: "mix_video",
      label: "Ghép giọng đọc vào video",
      progressPercent: 78,
    });
    await renderNarrationTrack({
      segments: scriptSegments,
      audioFiles,
      totalDurationSeconds,
      outputPath: narrationPath,
    });

    const outputPath = path.join(workDir, "dubbed.mp4");
    await renderFinalDubbedVideo({
      sourceVideoPath,
      narrationPath,
      outputPath,
      settings: activeSettings,
    });

    await notifyProgress({
      key: "upload_drive",
      label: "Upload bản BLV AI lên Drive",
      progressPercent: 92,
    });
    const outputStat = await fs.stat(outputPath);
    const driveInfo = await uploadRecordingToDrive({
      filePath: outputPath,
      fileName: buildDriveFileName(recording, activeSettings),
    });

    const alignedSceneCount = new Set(
      scriptSegments
        .map((segment) =>
          Number.isInteger(segment?.sceneIndex) ? segment.sceneIndex : null
        )
        .filter((value) => value != null)
    ).size;

    return {
      scriptSegments,
      analysisPreview: buildAnalysisPreview({
        sceneWindows,
        audioTranscriptMoments,
      }),
      artifacts: {
        dubbedDriveFileId: driveInfo.fileId,
        dubbedDriveRawUrl: driveInfo.rawUrl,
        dubbedDrivePreviewUrl: driveInfo.previewUrl,
        dubbedPlaybackUrl: buildRecordingAiCommentaryPlaybackUrl(recording._id),
        outputSizeBytes: outputStat.size,
      },
      summary: {
        segmentCount: scriptSegments.length,
        sceneCount: Array.isArray(sceneWindows) ? sceneWindows.length : 0,
        alignedSceneCount,
        visualMomentCount: Array.isArray(visualMoments)
          ? visualMoments.length
          : 0,
        keyframeCount: Array.isArray(visualMoments) ? visualMoments.length : 0,
        transcriptSnippetCount: Array.isArray(audioTranscriptMoments)
          ? audioTranscriptMoments.length
          : 0,
        renderedDurationSeconds: Math.max(
          45,
          Math.round(asNumber(recording?.durationSeconds, 0) || 0)
        ),
      },
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
