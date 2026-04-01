import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";
import { publishFbVodDriveMonitorUpdate } from "../services/fbVodDriveMonitorEvents.service.js";
import { scheduleFacebookVodFallbackForMatch } from "../services/liveRecordingFacebookVodFallback.service.js";

const matchPop = [
  { path: "tournament", select: "name image" },
  { path: "bracket", select: "name type stage order" },
  {
    path: "pairA",
    populate: [
      { path: "player1.user", select: "name nickname avatar" },
      { path: "player2.user", select: "name nickname avatar" },
    ],
  },
  {
    path: "pairB",
    populate: [
      { path: "player1.user", select: "name nickname avatar" },
      { path: "player2.user", select: "name nickname avatar" },
    ],
  },
  { path: "referee", select: "name nickname" },
  { path: "liveBy", select: "name email" },
];

const MATCH_SELECT = [
  "code",
  "shortCode",
  "status",
  "startedAt",
  "liveBy",
  "video",
  "tournament",
  "bracket",
  "pairA",
  "pairB",
  "referee",
  "facebookLive",
  "meta",
  "round",
  "order",
  "pool.name",
  "courtLabel",
  "courtStationLabel",
  "courtClusterLabel",
].join(" ");

const GROUPISH_TYPES = new Set(["group", "round_robin", "gsl"]);

function detectPlatformFromUrl(url = "") {
  const text = String(url || "").toLowerCase();
  if (!text) return null;
  if (text.includes("youtube.com") || text.includes("youtu.be")) return "youtube";
  if (text.includes("facebook.com")) return "facebook";
  if (text.includes("tiktok.com")) return "tiktok";
  if (text.startsWith("rtmp://") || text.startsWith("rtmps://")) return "rtmp";
  return "other";
}

function pick(primary, fallback) {
  return primary != null && primary !== "" ? primary : fallback;
}

async function publishFbVodMonitorMatchUpdate(matchId, reason) {
  const normalizedMatchId = String(matchId || "").trim();
  if (!normalizedMatchId) return;
  await publishFbVodDriveMonitorUpdate({
    reason,
    matchIds: [normalizedMatchId],
  }).catch(() => {});
}

function normalizeStatus(value) {
  return value ? String(value).toUpperCase() : "";
}

function isFbLiveStatus(status) {
  return ["LIVE", "LIVE_NOW", "STREAMING"].includes(normalizeStatus(status));
}

function isFbEndedStatus(status) {
  return ["ENDED", "STOPPED", "FINISHED"].includes(normalizeStatus(status));
}

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

function parseCsv(value, fallback = []) {
  const items = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : fallback;
}

function roundsInBracket(bracket) {
  if (GROUPISH_TYPES.has(bracket?.type)) return 1;
  return bracket?.meta?.maxRounds || bracket?.drawRounds || 1;
}

async function buildBracketIndexByTournament(tournamentIds = []) {
  const ids = (Array.isArray(tournamentIds) ? tournamentIds : [tournamentIds])
    .map((value) =>
      mongoose.isValidObjectId(value)
        ? new mongoose.Types.ObjectId(String(value))
        : null
    )
    .filter(Boolean);
  if (!ids.length) return new Map();

  const rows = await Bracket.find({ tournament: { $in: ids } })
    .select("_id tournament type order meta.maxRounds drawRounds")
    .sort({ tournament: 1, order: 1, _id: 1 })
    .lean();

  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.tournament);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function computeGlobalVForMatch(match, bracketListOfTournament = []) {
  const bracketId = String(match?.bracket?._id || match?.bracket || "");
  let accumulated = 0;
  for (const bracket of bracketListOfTournament) {
    if (String(bracket._id) === bracketId) {
      const localRound = GROUPISH_TYPES.has(bracket.type) ? 1 : match.round || 1;
      return accumulated + localRound;
    }
    accumulated += roundsInBracket(bracket);
  }
  return match.round || 1;
}

function computePoolIndex(poolName) {
  const text = String(poolName || "").trim();
  if (!text) return 1;

  const numberMatch = text.match(/(\d+)/);
  if (numberMatch) return Math.max(1, Number(numberMatch[1]));

  if (/^[A-Za-z]$/.test(text)) {
    return text.toUpperCase().charCodeAt(0) - 64;
  }

  return 1;
}

function renderNewMatchCode({ bracketType, poolName, order0, v }) {
  const matchOrder = (Number.isFinite(order0) ? order0 : 0) + 1;
  if (GROUPISH_TYPES.has(bracketType)) {
    return `V${v}-B${computePoolIndex(poolName)}-T${matchOrder}`;
  }
  return `V${v}-T${matchOrder}`;
}

function applyNewCodeOnMatch(match, bracketsOfTournament = []) {
  const v = computeGlobalVForMatch(match, bracketsOfTournament);
  const bracketType = match?.bracket?.type || match?.format;
  const poolName = match?.pool?.name || null;
  match.code = renderNewMatchCode({
    bracketType,
    poolName,
    order0: match.order,
    v,
  });
  match.shortCode = match.code;
}

function applyNewCodeOnMatches(matches = [], bracketIndexByTournament = new Map()) {
  matches.forEach((match) => {
    const tournamentKey = String(match?.tournament?._id || match?.tournament || "");
    applyNewCodeOnMatch(match, bracketIndexByTournament.get(tournamentKey) || []);
  });
}

function extractFacebookOutputsFromMatch(match) {
  const outputs = [];
  const fbLive = match?.facebookLive || {};
  const metaFb = match?.meta?.facebook || {};
  const metaFbLive = metaFb?.live || {};

  const pageId = pick(fbLive.pageId, metaFb.pageId);
  const pageName = pick(metaFb.pageName, pageId);
  const permalink = pick(metaFb.permalinkUrl, fbLive.permalink_url);
  const liveId = pick(fbLive.id, metaFbLive.id);
  const status = pick(fbLive.status, metaFbLive.status);

  if (pageId || permalink || liveId) {
    outputs.push({
      platform: "facebook",
      targetName: pageName || "Facebook Page",
      pageId,
      publicUrl: permalink || "",
      url: permalink || "",
      meta: { liveId, status },
    });
  }

  return outputs;
}

function extractYouTubeOutputsFromMatch(match) {
  const youtube = match?.meta?.youtube || {};
  const url = youtube.watchUrl || youtube.url;
  if (!url) return [];
  return [
    {
      platform: "youtube",
      targetName: youtube.channelName || youtube.channelId || "YouTube",
      publicUrl: url,
      url,
      meta: { videoId: youtube.videoId, status: youtube?.live?.status },
    },
  ];
}

function extractOtherOutputsFromMatch(match) {
  const outputs = [];

  if (match.video) {
    outputs.push({
      platform: detectPlatformFromUrl(match.video),
      targetName: "",
      publicUrl: match.video,
      url: match.video,
    });
  }

  const tiktok = match?.meta?.tiktokLive || match?.meta?.tiktok || null;
  if (tiktok?.url || tiktok?.watchUrl) {
    outputs.push({
      platform: "tiktok",
      targetName: tiktok.account || tiktok.username || "TikTok",
      publicUrl: tiktok.watchUrl || tiktok.url,
      url: tiktok.watchUrl || tiktok.url,
    });
  }

  const rtmp = match?.meta?.rtmp || null;
  if (rtmp?.publicUrl || rtmp?.viewUrl || rtmp?.url) {
    outputs.push({
      platform: "rtmp",
      targetName: rtmp.targetName || rtmp.channel || "RTMP",
      publicUrl: rtmp.publicUrl || rtmp.viewUrl || "",
      viewUrl: rtmp.viewUrl || "",
      url: rtmp.url || rtmp.publicUrl || "",
    });
  }

  return outputs;
}

function toSessionDTO(match) {
  const seen = new Set();
  const outputs = [
    ...extractFacebookOutputsFromMatch(match),
    ...extractYouTubeOutputsFromMatch(match),
    ...extractOtherOutputsFromMatch(match),
  ].filter((output) => {
    const key = `${output.platform}|${output.url || output.publicUrl || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    id: match._id,
    status: match.status,
    startedAt: match.startedAt,
    startedBy: match.liveBy || null,
    tournament: match.tournament,
    bracket: match.bracket,
    match,
    outputs,
  };
}

function isSessionLiveable(session, options = {}) {
  const allowFinished = options?.allowFinished === true;
  if (!session || (!allowFinished && session.match?.status === "finished")) {
    return false;
  }

  const outputs = (session.outputs || []).filter(
    (output) => !!(output.publicUrl || output.viewUrl || output.url)
  );
  if (outputs.length === 0) return false;

  for (const output of outputs) {
    if (output.platform !== "facebook") return true;
    const status = normalizeStatus(output?.meta?.status);
    if (!isFbEndedStatus(status) && status !== "CREATED") return true;
  }

  return false;
}

function derivePagesLiveFromSessions(sessions = []) {
  const map = new Map();

  for (const session of sessions) {
    for (const output of session.outputs || []) {
      if (output.platform !== "facebook") continue;
      if (!isFbLiveStatus(output?.meta?.status)) continue;

      const key =
        output.pageId || output.publicUrl || output.url || Math.random().toString(36);
      if (!map.has(key)) {
        map.set(key, {
          pageId: output.pageId || null,
          pageName: output.targetName || "Facebook Page",
          permalink_url: output.publicUrl || output.url || "",
          liveIds: new Set(),
          matches: [],
        });
      }

      const current = map.get(key);
      if (output?.meta?.liveId) current.liveIds.add(output.meta.liveId);
      current.matches.push({
        id: session.id,
        code: session.match?.code,
        tournament: session.tournament?.name,
        bracket: session.bracket?.name,
      });
    }
  }

  return Array.from(map.values()).map((value) => ({
    pageId: value.pageId,
    pageName: value.pageName,
    permalink_url: value.permalink_url,
    liveIds: [...value.liveIds],
    matchCount: value.matches.length,
    matches: value.matches,
  }));
}

function buildSessionSearchText(session) {
  const match = session?.match || {};
  const outputs = Array.isArray(session?.outputs) ? session.outputs : [];
  return [
    match?.code,
    match?.shortCode,
    match?._id,
    session?.tournament?.name,
    session?.bracket?.name,
    match?.courtLabel,
    match?.courtStationLabel,
    match?.courtClusterLabel,
    match?.pairA?.player1?.user?.nickname,
    match?.pairA?.player1?.user?.name,
    match?.pairA?.player2?.user?.nickname,
    match?.pairA?.player2?.user?.name,
    match?.pairB?.player1?.user?.nickname,
    match?.pairB?.player1?.user?.name,
    match?.pairB?.player2?.user?.nickname,
    match?.pairB?.player2?.user?.name,
    session?.startedBy?.name,
    ...outputs.map((output) =>
      [
        output?.platform,
        output?.targetName,
        output?.pageId,
        output?.publicUrl,
        output?.url,
      ]
        .filter(Boolean)
        .join(" ")
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildTournamentBuckets(sessions = []) {
  const map = new Map();

  sessions.forEach((session) => {
    const tournament = session?.match?.tournament || session?.tournament;
    const tournamentId = String(tournament?._id || "").trim();
    if (!tournamentId) return;

    const current =
      map.get(tournamentId) ||
      {
        _id: tournamentId,
        name: tournament?.name || "Kh?ng r? gi?i",
        count: 0,
        liveCount: 0,
      };

    current.count += 1;
    if (String(session?.status || "").toLowerCase() === "live") {
      current.liveCount += 1;
    }
    map.set(tournamentId, current);
  });

  return Array.from(map.values()).sort((left, right) => {
    if (right.liveCount !== left.liveCount) return right.liveCount - left.liveCount;
    if (right.count !== left.count) return right.count - left.count;
    return String(left.name || "").localeCompare(String(right.name || ""), "vi");
  });
}

function buildPlatformBuckets(sessions = []) {
  const map = new Map();

  sessions.forEach((session) => {
    const seen = new Set();

    (session.outputs || []).forEach((output) => {
      const platform = String(output?.platform || "").trim().toLowerCase();
      if (!platform || seen.has(platform)) return;

      seen.add(platform);
      const current =
        map.get(platform) ||
        {
          key: platform,
          label: platform,
          count: 0,
        };

      current.count += 1;
      map.set(platform, current);
    });
  });

  return Array.from(map.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return String(left.label || "").localeCompare(String(right.label || ""), "vi");
  });
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

export const adminListLivePages = expressAsyncHandler(async (_req, res) => {
  try {
    const matches = await Match.find({
      status: { $ne: "finished" },
      $or: [
        { "facebookLive.id": { $type: "string" } },
        { "meta.facebook.live.id": { $exists: true } },
        { "meta.facebook.permalinkUrl": { $type: "string" } },
      ],
    })
      .select(
        "code shortCode status tournament bracket round order pool.name facebookLive meta startedAt"
      )
      .populate([
        { path: "tournament", select: "name" },
        { path: "bracket", select: "name type order" },
      ])
      .lean({ getters: true, virtuals: true });

    const tournamentIds = [
      ...new Set(
        matches
          .map((match) => match?.tournament?._id || match.tournament)
          .filter((value) => mongoose.isValidObjectId(value))
          .map(String)
      ),
    ];
    const bracketIndexByTournament = await buildBracketIndexByTournament(tournamentIds);
    applyNewCodeOnMatches(matches, bracketIndexByTournament);

    const sessions = matches
      .map((match) => toSessionDTO(match))
      .filter((session) => isSessionLiveable(session));

    return res.json({ items: derivePagesLiveFromSessions(sessions) });
  } catch (err) {
    console.error("[adminListLivePages] error:", err);
    const isProd =
      String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      message: "Internal error",
      code: "ADMIN_LIVE_PAGES_LIST_FAILED",
      error: isProd ? undefined : err?.message || String(err),
    });
  }
});

export const adminListLiveSessions = expressAsyncHandler(async (req, res) => {
  try {
    const {
      status = "live",
      tournamentId,
      q = "",
      platform,
      page = 1,
      limit = 20,
      includePages = "1",
    } = req.query;

    const normalizedStatuses = parseCsv(status, ["live"]);
    const pageNumber = parsePositiveInt(page, 1, { min: 1 });
    const limitNumber = parsePositiveInt(limit, 20, { min: 1, max: 100 });
    const selectedTournamentIds = new Set(
      parseCsv(tournamentId).filter((id) => mongoose.isValidObjectId(id))
    );

    const filter = normalizedStatuses.length
      ? { status: { $in: normalizedStatuses } }
      : { status: { $ne: "finished" } };

    const matches = await Match.find(filter)
      .select(MATCH_SELECT)
      .populate(matchPop)
      .sort({ startedAt: -1, createdAt: -1 })
      .lean({ getters: true, virtuals: true });

    const tournamentIds = [
      ...new Set(
        matches
          .map((match) => match?.tournament?._id || match.tournament)
          .filter((value) => mongoose.isValidObjectId(value))
          .map(String)
      ),
    ];
    const bracketIndexByTournament = await buildBracketIndexByTournament(tournamentIds);
    applyNewCodeOnMatches(matches, bracketIndexByTournament);

    let sessions = matches
      .map((match) => toSessionDTO(match))
      .filter((session) =>
        isSessionLiveable(session, {
          allowFinished: normalizedStatuses.includes("finished"),
        })
      );

    if (q && String(q).trim()) {
      const keyword = String(q).trim().toLowerCase();
      sessions = sessions.filter((session) =>
        buildSessionSearchText(session).includes(keyword)
      );
    }

    const tournaments = buildTournamentBuckets(sessions);

    if (selectedTournamentIds.size > 0) {
      sessions = sessions.filter((session) => {
        const id = String(
          session?.match?.tournament?._id || session?.tournament?._id || ""
        ).trim();
        return selectedTournamentIds.has(id);
      });
    }

    const platforms = buildPlatformBuckets(sessions);

    if (platform) {
      const selectedPlatforms = parseCsv(platform).map((value) => value.toLowerCase());
      if (selectedPlatforms.length) {
        sessions = sessions.filter((session) =>
          (session.outputs || []).some((output) =>
            selectedPlatforms.includes(String(output.platform || "").toLowerCase())
          )
        );
      }
    }

    const paged = paginate(sessions, pageNumber, limitNumber);

    const pagesLive =
      String(includePages) === "1" ||
      String(includePages).toLowerCase() === "true"
        ? derivePagesLiveFromSessions(sessions)
        : [];

    return res.status(200).json({
      items: paged.items,
      count: paged.total,
      page: paged.page,
      pages: paged.pages,
      limit: limitNumber,
      tournaments,
      platforms,
      pagesLive,
    });
  } catch (err) {
    console.error("[adminListLiveSessions] error:", err);
    const isProd =
      String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      message: "Internal error",
      code: "ADMIN_LIVE_SESSIONS_LIST_FAILED",
      error: isProd ? undefined : err?.message || String(err),
    });
  }
});

export const adminGetLiveSession = expressAsyncHandler(async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .select(MATCH_SELECT)
      .populate(matchPop)
      .lean({ getters: true, virtuals: true });

    if (!match || match.status === "finished") return res.json({});

    const tournamentId = mongoose.isValidObjectId(match?.tournament?._id || match.tournament)
      ? String(match?.tournament?._id || match.tournament)
      : null;
    const bracketIndexByTournament = await buildBracketIndexByTournament(
      tournamentId ? [tournamentId] : []
    );
    applyNewCodeOnMatch(match, bracketIndexByTournament.get(tournamentId) || []);

    const dto = toSessionDTO(match);
    if (!isSessionLiveable(dto)) return res.json({});

    return res.json(dto);
  } catch (err) {
    console.error("[adminGetLiveSession] error:", err);
    const isProd =
      String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      message: "Internal error",
      code: "ADMIN_LIVE_SESSION_GET_FAILED",
      error: isProd ? undefined : err?.message || String(err),
    });
  }
});

export const adminStopLiveSession = expressAsyncHandler(async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: "Kh?ng t?m th?y tr?n" });
    }

    const facebookLive = match.facebookLive || {};
    facebookLive.status = "ENDED";
    facebookLive.endedAt = new Date();
    facebookLive.secure_stream_url = "";
    facebookLive.server_url = "";
    facebookLive.stream_key = "";
    match.facebookLive = facebookLive;
    await match.save();
    await publishFbVodMonitorMatchUpdate(match._id, "facebook_live_ended");
    await scheduleFacebookVodFallbackForMatch(match).catch((error) => {
      console.warn(
        "[adminStopLiveSession] schedule facebook vod fallback failed:",
        error?.message || error
      );
    });

    return res.json({
      message: "?? d?ng live Facebook cho tr?n",
      id: match._id,
      facebook: facebookLive,
    });
  } catch (err) {
    console.error("[adminStopLiveSession] error:", err);
    const isProd =
      String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(500).json({
      message: "Internal error",
      code: "ADMIN_LIVE_SESSION_STOP_FAILED",
      error: isProd ? undefined : err?.message || String(err),
    });
  }
});
