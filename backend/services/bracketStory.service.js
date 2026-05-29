import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import BracketStory from "../models/bracketStoryModel.js";
import { openai, OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";

const PROMPT_VERSION = "bracket-story-v1";
const MODEL =
  process.env.BRACKET_STORY_AI_MODEL ||
  process.env.TOURNAMENT_STORY_AI_MODEL ||
  OPENAI_DEFAULT_MODEL;

function asString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function getId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  return String(value);
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("vi-VN");
}

function compactObject(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function registrationLabel(registration) {
  if (!registration) return "Chưa xác định";
  const code = registration.code ? `#${registration.code}` : "";
  const playerNames = [registration.player1, registration.player2]
    .map((player) => asString(player?.nickName || player?.fullName))
    .filter(Boolean);
  const teamName = asString(registration.teamFactionName);
  const name = playerNames.length ? playerNames.join(" / ") : teamName || "Chưa xác định";

  return [code, teamName && playerNames.length ? `${teamName}:` : "", name]
    .filter(Boolean)
    .join(" ");
}

function seedLabel(seed) {
  if (!seed || typeof seed !== "object") return "";
  return (
    asString(seed.label) ||
    asString(seed.name) ||
    asString(seed.code) ||
    asString(seed.type)
  );
}

function sideLabel(match, side, registrationsById) {
  const pairKey = side === "A" ? "pairA" : "pairB";
  const teamNameKey = side === "A" ? "teamFactionAName" : "teamFactionBName";
  const seedKey = side === "A" ? "seedA" : "seedB";
  const pair = match?.[pairKey];

  if (pair && typeof pair === "object") return registrationLabel(pair);

  const pairId = getId(pair);
  if (pairId && registrationsById.has(pairId)) {
    return registrationLabel(registrationsById.get(pairId));
  }

  return asString(match?.[teamNameKey]) || seedLabel(match?.[seedKey]) || "Chưa xác định";
}

function scoreSummary(gameScores = []) {
  const games = toArray(gameScores)
    .map((game) => ({
      a: Number(game?.a || 0),
      b: Number(game?.b || 0),
    }))
    .filter((game) => game.a > 0 || game.b > 0);

  if (!games.length) {
    return { text: "", totalA: 0, totalB: 0, margin: null, games: 0 };
  }

  const totalA = games.reduce((sum, game) => sum + game.a, 0);
  const totalB = games.reduce((sum, game) => sum + game.b, 0);

  return {
    text: games.map((game) => `${game.a}-${game.b}`).join(", "),
    totalA,
    totalB,
    margin: Math.abs(totalA - totalB),
    games: games.length,
  };
}

function bracketName(match, bracketsById) {
  if (match?.bracket && typeof match.bracket === "object") {
    return asString(match.bracket.name) || asString(match.bracket.type);
  }
  const bracketId = getId(match?.bracket);
  const bracket = bracketId ? bracketsById.get(bracketId) : null;
  return asString(bracket?.name) || asString(bracket?.type) || "Bracket chính";
}

function buildMatchRow(match, registrationsById, bracketsById) {
  const sideA = sideLabel(match, "A", registrationsById);
  const sideB = sideLabel(match, "B", registrationsById);
  const winnerLabel =
    match?.winner === "A" ? sideA : match?.winner === "B" ? sideB : "";
  const loserLabel =
    match?.winner === "A" ? sideB : match?.winner === "B" ? sideA : "";
  const score = scoreSummary(match?.gameScores);
  const round = Number(match?.round || 0);
  const order = Number(match?.order || 0);

  return {
    id: getId(match),
    bracketId: getId(match?.bracket),
    bracketName: bracketName(match, bracketsById),
    code: asString(match?.code),
    round,
    order,
    branch: asString(match?.branch),
    phase: asString(match?.phase),
    status: asString(match?.status),
    sideA,
    sideB,
    winner: asString(match?.winner),
    winnerLabel,
    loserLabel,
    scoreText: score.text,
    scoreMargin: score.margin,
    games: score.games,
    scheduledAt: match?.scheduledAt || null,
    updatedAt: match?.updatedAt || match?.createdAt || null,
  };
}

function matchTitle(match) {
  const label = match.code || `Vòng ${match.round || "?"} - trận ${(match.order || 0) + 1}`;
  const score = match.scoreText ? ` (${match.scoreText})` : "";
  return `${label}: ${match.sideA} vs ${match.sideB}${score}`;
}

function summarizeBrackets(brackets, matchRows) {
  return brackets.map((bracket) => {
    const bracketId = getId(bracket);
    const rows = matchRows.filter((match) => match.bracketId === bracketId);
    const finished = rows.filter((match) => match.status === "finished").length;
    return {
      id: bracketId,
      name: asString(bracket.name) || "Bracket",
      type: asString(bracket.type),
      stage: Number(bracket.stage || 1),
      order: Number(bracket.order || 0),
      teamsCount: Number(bracket.teamsCount || 0),
      matchesCount: rows.length || Number(bracket.matchesCount || 0),
      finishedMatches: finished,
    };
  });
}

function pickFinalMatch(completedMatches) {
  return [...completedMatches].sort((a, b) => {
    if (b.round !== a.round) return b.round - a.round;
    if (b.order !== a.order) return b.order - a.order;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  })[0];
}

function buildSourceSummary({ tournament, brackets, registrations, matchRows }) {
  const completedMatches = matchRows.filter((match) => match.status === "finished");
  const finalMatch = pickFinalMatch(completedMatches);
  const statusCounts = matchRows.reduce((acc, match) => {
    const key = match.status || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const closeMatches = completedMatches
    .filter((match) => Number.isFinite(match.scoreMargin))
    .sort((a, b) => {
      if (a.scoreMargin !== b.scoreMargin) return a.scoreMargin - b.scoreMargin;
      return b.games - a.games;
    })
    .slice(0, 5);

  const decisiveMatches = completedMatches
    .filter((match) => Number.isFinite(match.scoreMargin))
    .sort((a, b) => b.scoreMargin - a.scoreMargin)
    .slice(0, 3);

  const recentFinished = [...completedMatches]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 5);

  return {
    tournament: {
      id: getId(tournament),
      name: asString(tournament.name),
      code: asString(tournament.code),
      sportType: asString(tournament.sportType),
      eventType: asString(tournament.eventType),
      status: asString(tournament.status),
      startDate: formatDate(tournament.startDate),
      endDate: formatDate(tournament.endDate),
      location: asString(tournament.location),
    },
    metrics: {
      brackets: brackets.length,
      registrations: registrations.length,
      totalMatches: matchRows.length,
      completedMatches: completedMatches.length,
      pendingMatches: matchRows.length - completedMatches.length,
      statusCounts,
      champion: finalMatch?.winnerLabel || "",
      runnerUp: finalMatch?.loserLabel || "",
    },
    bracketSummaries: summarizeBrackets(brackets, matchRows),
    notableMatches: closeMatches.map(matchTitle),
    decisiveMatches: decisiveMatches.map(matchTitle),
    recentFinished: recentFinished.map(matchTitle),
  };
}

export async function buildBracketStorySnapshot(tournamentId) {
  const tournament = await Tournament.findById(tournamentId)
    .select("name code sportType startDate endDate eventType status location")
    .lean();

  if (!tournament) {
    const error = new Error("Không tìm thấy giải đấu");
    error.statusCode = 404;
    throw error;
  }

  const [brackets, registrations, matches] = await Promise.all([
    Bracket.find({ tournament: tournamentId })
      .select("name type stage order teamsCount matchesCount drawStatus")
      .sort({ stage: 1, order: 1, createdAt: 1 })
      .lean(),
    Registration.find({ tournament: tournamentId })
      .select("code player1 player2 teamFactionName")
      .sort({ code: 1, createdAt: 1 })
      .limit(600)
      .lean(),
    Match.find({ tournament: tournamentId })
      .select(
        "bracket code round order branch phase pairA pairB teamFactionAName teamFactionBName seedA seedB gameScores status winner scheduledAt createdAt updatedAt"
      )
      .populate("pairA", "code player1 player2 teamFactionName")
      .populate("pairB", "code player1 player2 teamFactionName")
      .populate("bracket", "name type stage order")
      .sort({ round: 1, order: 1, createdAt: 1 })
      .limit(800)
      .lean(),
  ]);

  const registrationsById = new Map(
    registrations.map((registration) => [getId(registration), registration])
  );
  const bracketsById = new Map(brackets.map((bracket) => [getId(bracket), bracket]));
  const matchRows = matches.map((match) =>
    buildMatchRow(match, registrationsById, bracketsById)
  );
  const sourceSummary = buildSourceSummary({
    tournament,
    brackets,
    registrations,
    matchRows,
  });

  return {
    tournament: compactObject(tournament),
    brackets: compactObject(brackets),
    registrations: registrations.map((registration) => ({
      id: getId(registration),
      label: registrationLabel(registration),
    })),
    matches: matchRows,
    sourceSummary,
  };
}

function buildFallbackStory(snapshot, reason = "") {
  const { tournament, metrics } = snapshot.sourceSummary;
  const completed = Number(metrics.completedMatches || 0);
  const total = Number(metrics.totalMatches || 0);
  const champion = asString(metrics.champion);
  const runnerUp = asString(metrics.runnerUp);

  const bracketOverview = snapshot.sourceSummary.bracketSummaries.map((bracket) => {
    const type = bracket.type ? ` (${bracket.type})` : "";
    return `${bracket.name}${type}: ${bracket.finishedMatches}/${bracket.matchesCount} trận đã hoàn tất.`;
  });

  const keyHighlights = [
    total
      ? `Giải có ${total} trận, hiện đã hoàn tất ${completed} trận.`
      : "Chưa có trận đấu nào trong bracket.",
    champion
      ? `${champion} đang là đội nổi bật nhất theo trận cuối cùng đã hoàn tất.`
      : "Chưa đủ dữ liệu để xác định nhà vô địch hoặc đội nổi bật nhất.",
    ...(snapshot.sourceSummary.decisiveMatches || [])
      .slice(0, 2)
      .map((match) => `Trận cách biệt: ${match}`),
  ];

  return {
    title: `AI Bracket Story: ${tournament.name}`,
    summary: `${tournament.name} đang có ${snapshot.sourceSummary.metrics.brackets} bracket, ${snapshot.sourceSummary.metrics.registrations} đăng ký và ${total} trận trong dữ liệu hệ thống.`,
    bracketOverview: bracketOverview.length
      ? bracketOverview
      : ["Chưa có bracket nào để tổng hợp."],
    keyHighlights,
    championPath: champion
      ? [
          `${champion} được ghi nhận là người thắng ở trận sâu nhất đã hoàn tất.`,
          runnerUp ? `Đối thủ đáng chú ý ở trận này là ${runnerUp}.` : "",
        ].filter(Boolean)
      : ["Chưa có đủ trận hoàn tất để dựng hành trình vô địch."],
    notableMatches: snapshot.sourceSummary.notableMatches?.length
      ? snapshot.sourceSummary.notableMatches
      : ["Chưa có trận đủ điểm số để chọn trận đáng chú ý."],
    socialCaption: champion
      ? `${tournament.name}: ${champion} tạo dấu ấn trong bracket. Xem lại các trận đáng chú ý trên PickleTour.`
      : `${tournament.name}: bracket đang được cập nhật, hãy theo dõi các trận tiếp theo trên PickleTour.`,
    adminNotes: [
      reason
        ? `Đang dùng bản fallback vì AI chưa phản hồi ổn định: ${reason}.`
        : "Bản story này được dựng tự động từ dữ liệu bracket hiện có.",
      "Nên tạo lại story sau khi các trận cuối đã được chấm xong.",
    ],
  };
}

function buildPrompt(snapshot) {
  const compactSnapshot = {
    sourceSummary: snapshot.sourceSummary,
    matches: snapshot.matches.slice(0, 120),
  };

  return [
    "Hãy viết AI Bracket Story bằng tiếng Việt có dấu cho admin PickleTour.",
    "Chỉ dựa vào JSON dữ liệu được cung cấp, không bịa tên đội, điểm số hoặc kết quả.",
    "Giọng văn thể thao, rõ ràng, dùng được để admin đọc nhanh và có thể lấy caption đăng tin.",
    "Trả về JSON hợp lệ với schema:",
    JSON.stringify({
      title: "string",
      summary: "string",
      bracketOverview: ["string"],
      keyHighlights: ["string"],
      championPath: ["string"],
      notableMatches: ["string"],
      socialCaption: "string",
      adminNotes: ["string"],
    }),
    "Dữ liệu:",
    JSON.stringify(compactSnapshot),
  ].join("\n\n");
}

function parseJsonContent(content) {
  const raw = asString(content);
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] || raw;
  try {
    return JSON.parse(jsonText);
  } catch {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(jsonText.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeStory(value, fallback) {
  const story = value && typeof value === "object" ? value : fallback;
  return {
    title: asString(story.title) || fallback.title,
    summary: asString(story.summary) || fallback.summary,
    bracketOverview: toArray(story.bracketOverview).map(String),
    keyHighlights: toArray(story.keyHighlights).map(String),
    championPath: toArray(story.championPath).map(String),
    notableMatches: toArray(story.notableMatches).map(String),
    socialCaption: asString(story.socialCaption) || fallback.socialCaption,
    adminNotes: toArray(story.adminNotes).map(String),
  };
}

function aiConfigured() {
  return Boolean(process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY);
}

function getAiErrorMessage(error) {
  const status = error?.status || error?.response?.status || "";
  const message =
    error?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    "AI không phản hồi";
  return [status, message].filter(Boolean).join(" ");
}

async function generateAiStory(snapshot) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Bạn là biên tập viên thể thao cho PickleTour. Luôn trả JSON hợp lệ, tiếng Việt có dấu, không bịa dữ liệu.",
      },
      { role: "user", content: buildPrompt(snapshot) },
    ],
  });

  return parseJsonContent(response?.choices?.[0]?.message?.content);
}

export async function getLatestBracketStory(tournamentId) {
  const latest = await BracketStory.findOne({ tournament: tournamentId })
    .sort({ createdAt: -1 })
    .lean();

  if (latest) {
    return {
      story: latest,
      sourceSummary: latest.sourceSummary || {},
      hasStory: true,
    };
  }

  const snapshot = await buildBracketStorySnapshot(tournamentId);
  return {
    story: null,
    sourceSummary: snapshot.sourceSummary,
    hasStory: false,
  };
}

export async function createBracketStory({ tournamentId, actorId = null }) {
  const snapshot = await buildBracketStorySnapshot(tournamentId);
  const fallback = buildFallbackStory(snapshot);
  let story = fallback;
  let source = "fallback";
  let status = "fallback";
  let aiError = "";

  if (!aiConfigured()) {
    aiError = "AI chưa được cấu hình bằng CLIPROXY_API_KEY hoặc OPENAI_API_KEY";
  } else {
    try {
      const aiStory = await generateAiStory(snapshot);
      if (!aiStory) {
        aiError = "AI trả về nội dung không phải JSON hợp lệ";
        story = buildFallbackStory(snapshot, aiError);
      } else {
        story = normalizeStory(aiStory, fallback);
        source = "ai";
        status = "ready";
      }
    } catch (error) {
      aiError = getAiErrorMessage(error);
      story = buildFallbackStory(snapshot, aiError);
    }
  }

  const doc = await BracketStory.create({
    tournament: tournamentId,
    generatedBy: actorId,
    promptVersion: PROMPT_VERSION,
    model: MODEL,
    source,
    status,
    story,
    sourceSummary: snapshot.sourceSummary,
    aiError,
  });

  return {
    story: doc.toObject(),
    sourceSummary: snapshot.sourceSummary,
    hasStory: true,
  };
}
