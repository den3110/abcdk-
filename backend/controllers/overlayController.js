// src/controllers/overlayController.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Court from "../models/courtModel.js";
import CourtStation from "../models/courtStationModel.js";
import expressAsyncHandler from "express-async-handler";
import { Sponsor } from "../models/sponsorModel.js";
import CmsBlock from "../models/cmsBlockModel.js";
import UserMatch from "../models/userMatchModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";
import { getManualAssignmentItems } from "../services/courtManualAssignment.service.js";
import {
  buildMatchSideDisplayContextFromMatches,
  resolveMatchSideDisplayName,
  resolveMatchSideDisplayPair,
} from "../services/matchSideDisplay.service.js";
const setNoStoreHeaders = (res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");
};
// ===== Helpers =====
const gamesToWin = (bestOf) => Math.floor((Number(bestOf) || 3) / 2) + 1;
const gameWon = (x, y, pts, byTwo) =>
  Number(x) >= Number(pts) && (byTwo ? x - y >= 2 : x - y >= 1);

const resolveOverlayCourt = (match) => {
  const courtId =
    match?.courtStationId ||
    match?.courtStation?._id ||
    match?.courtStation ||
    match?.court?._id ||
    match?.courtId ||
    null;
  const courtNumber = match?.court?.number ?? match?.courtNo ?? undefined;
  const courtName =
    match?.courtStationName ||
    match?.courtStationLabel ||
    match?.courtLabel ||
    match?.court?.name ||
    match?.courtName ||
    (courtNumber != null ? `Sân ${courtNumber}` : "");
  return {
    courtId,
    courtNumber,
    courtName,
    courtExtra: {
      code: match?.court?.code || undefined,
      label:
        match?.courtStationName ||
        match?.courtStationLabel ||
        match?.court?.label ||
        match?.courtLabel ||
        undefined,
      zone: match?.court?.zone || match?.court?.area || undefined,
      venue: match?.court?.venue || undefined,
      building: match?.court?.building || undefined,
      floor: match?.court?.floor || undefined,
      cluster:
        match?.courtClusterName ||
        match?.courtClusterLabel ||
        match?.court?.cluster ||
        match?.courtCluster ||
        undefined,
      group: match?.court?.group || undefined,
    },
  };
};

// tính số set thắng mỗi bên
function setWins(gameScores = [], rules) {
  let a = 0,
    b = 0;
  for (const g of gameScores || []) {
    if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo)) a++;
    else if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
      b++;
  }
  return { a, b };
}

// Ưu tiên nickname
const preferNick = (p) =>
  (
    p?.nickname ||
    p?.nickName ||
    p?.shortName ||
    p?.name ||
    p?.fullName ||
    ""
  ).trim();

// Tên fallback theo eventType
function regName(reg, evType) {
  if (!reg) return "—";
  if (evType === "single") return reg?.player1?.fullName || "N/A";
  const a = reg?.player1?.fullName || "N/A";
  const b = reg?.player2?.fullName || "N/A";
  return `${a} & ${b}`;
}

/* ===== helpers nhỏ ===== */
const pick = (v) => (v && String(v).trim()) || "";

const isReferenceSideName = (value) => {
  const normalized = pick(value)
    .replace(/\s+/g, "")
    .replace(/\([AB]\)$/i, "")
    .toUpperCase();
  if (!normalized) return false;
  return (
    /^(?:[WL]-)?V\d+(?:-[A-Z0-9]+)?(?:-NT)?-T\d+$/.test(normalized) ||
    /^(?:WB|LB)\d+-T\d+$/.test(normalized) ||
    /^GF(?:\d+)?-T\d+$/.test(normalized)
  );
};

const extractReferenceDisplayCode = (value) => {
  const text = pick(value)
    .replace(/^[WL]\s*-\s*/i, "")
    .toUpperCase();
  const match = text.match(/V\d+(?:-[A-Z0-9]+)?(?:-NT)?-T\d+/);
  return match?.[0] || "";
};

const toIdText = (value) => {
  if (!value) return "";
  if (typeof value === "object") {
    return pick(value._id) || pick(value.id) || pick(value.matchId);
  }
  return pick(value);
};

const isGroupishBracketType = (value) =>
  ["group", "round_robin", "gsl"].includes(
    String(value || "")
      .trim()
      .toLowerCase()
  );

const roundsCountForOverlayBracket = (bracket, matches = []) => {
  if (isGroupishBracketType(bracket?.type)) return 1;

  const rounds = (matches || [])
    .map((match) => Number(match?.round || 1))
    .filter(Number.isFinite);
  if (rounds.length) return Math.max(1, Math.max(...rounds));

  const configured =
    Number(bracket?.meta?.maxRounds) ||
    Number(bracket?.config?.roundElim?.maxRounds) ||
    Number(bracket?.rounds) ||
    0;
  if (Number.isFinite(configured) && configured > 0) return configured;

  const drawSize =
    Number(bracket?.meta?.drawSize) ||
    Number(bracket?.config?.roundElim?.drawSize) ||
    Number(bracket?.config?.doubleElim?.drawSize) ||
    Number(bracket?.drawSize) ||
    0;
  if (Number.isFinite(drawSize) && drawSize > 1) {
    return Math.max(1, Math.ceil(Math.log2(drawSize)));
  }

  return 1;
};

const buildOverlayBaseByBracketId = (brackets = [], matchesByBracketId = new Map()) => {
  const sorted = [...(brackets || [])].sort(
    (a, b) =>
      Number(a?.stage || 0) - Number(b?.stage || 0) ||
      Number(a?.order || 0) - Number(b?.order || 0) ||
      String(a?._id || "").localeCompare(String(b?._id || ""))
  );

  const baseByBracketId = new Map();
  let accumulated = 0;
  for (const bracket of sorted) {
    const bracketId = toIdText(bracket);
    if (!bracketId) continue;
    baseByBracketId.set(bracketId, accumulated);
    accumulated += roundsCountForOverlayBracket(
      bracket,
      matchesByBracketId.get(bracketId) || []
    );
  }
  return baseByBracketId;
};

function gameWinner(g, rules) {
  if (!g) return null;
  const a = Number(g.a) || 0;
  const b = Number(g.b) || 0;
  // ưu tiên cờ capped lưu trong set
  if (g.capped === true) return a > b ? "A" : b > a ? "B" : null;

  const pts = Number(rules?.pointsToWin ?? 11);
  const byTwo = Boolean(rules?.winByTwo ?? true);

  // hard cap: chạm điểm là thắng
  if (
    rules?.cap?.mode === "hard" &&
    Number.isFinite(+rules?.cap?.points) &&
    (a === +rules.cap.points || b === +rules.cap.points)
  ) {
    return a > b ? "A" : b > a ? "B" : null;
  }

  if (a >= pts || b >= pts) {
    if (byTwo) {
      if (Math.abs(a - b) >= 2) return a > b ? "A" : "B";
    } else {
      if (a !== b) return a > b ? "A" : "B";
    }
  }
  // soft cap: không kéo vô tận → nếu đã vượt cap.points thì hơn điểm là thắng
  if (
    rules?.cap?.mode === "soft" &&
    Number.isFinite(+rules?.cap?.points) &&
    (a >= +rules.cap.points || b >= +rules.cap.points) &&
    a !== b
  ) {
    return a > b ? "A" : "B";
  }
  return null;
}

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const isAutoNextEnabled = (value) => {
  if (Array.isArray(value)) return isAutoNextEnabled(value[0]);
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const activeAutoNextStatuses = ["live", "assigned", "queued", "scheduled"];
const inactiveAutoNextStatuses = ["finished", "cancelled", "canceled"];

function isAutoNextCandidate(match) {
  return activeAutoNextStatuses.includes(
    String(match?.status || "").trim().toLowerCase()
  );
}

function uniqueIds(values = []) {
  const seen = new Set();
  const ids = [];
  for (const value of values) {
    const id = toIdString(value);
    if (!id || seen.has(id) || !mongoose.Types.ObjectId.isValid(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function sortStationQueueItems(items = []) {
  return [...items].sort((left, right) => {
    const orderDelta = toNum(left?.order) - toNum(right?.order);
    if (orderDelta) return orderDelta;
    const queuedDelta = toTs(left?.queuedAt) - toTs(right?.queuedAt);
    if (queuedDelta) return queuedDelta;
    return String(left?.matchId || "").localeCompare(String(right?.matchId || ""));
  });
}

async function loadOverlayUserMatch(matchId) {
  return UserMatch.findById(matchId)
    .populate("participants.user", "name fullName avatar nickname nickName phone")
    .populate({
      path: "referee",
      select: "name fullName nickname nickName",
    })
    .populate({
      path: "liveBy",
      select: "name fullName nickname nickName",
    })
    .populate({
      path: "serve.serverId",
      model: "User",
      select: "name fullName nickname nickName",
    })
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor cluster group",
    })
    .lean();
}

const overlayPairPopulate = (path) => ({
  path,
  select: "player1 player2 seed label teamName",
  populate: [
    {
      path: "player1",
      select: "fullName name shortName nickname nickName user",
      populate: { path: "user", select: "nickname nickName" },
    },
    {
      path: "player2",
      select: "fullName name shortName nickname nickName user",
      populate: { path: "user", select: "nickname nickName" },
    },
  ],
});

const overlayPreviousMatchPopulate = (path) => ({
  path,
  select: "_id round order code status winner seedA seedB pairA pairB previousA previousB",
  populate: [overlayPairPopulate("pairA"), overlayPairPopulate("pairB")],
});

async function buildOverlayMatchReferenceIndex(tournamentId) {
  if (!mongoose.Types.ObjectId.isValid(String(tournamentId || ""))) {
    return { byId: new Map(), byDisplayCode: new Map() };
  }

  const tournamentObjectId = new mongoose.Types.ObjectId(String(tournamentId));
  const [brackets, matches] = await Promise.all([
    Bracket.find({ tournament: tournamentObjectId })
      .select("_id type stage order groups prefill meta config drawSize rounds")
      .lean(),
    Match.find({ tournament: tournamentObjectId })
      .select(
        "_id tournament bracket round order code displayCode codeResolved roundCode matchCode slotCode bracketCode labelKey meta status winner seedA seedB pairA pairB previousA previousB branch phase format pool groupCode groupNo groupIndex"
      )
      .populate({
        path: "bracket",
        select: "_id type stage order groups prefill meta config drawSize rounds",
      })
      .populate(overlayPairPopulate("pairA"))
      .populate(overlayPairPopulate("pairB"))
      .lean(),
  ]);

  const matchesByBracketId = new Map();
  for (const match of matches) {
    const bracketId = toIdText(match?.bracket);
    if (!bracketId) continue;
    if (!matchesByBracketId.has(bracketId)) matchesByBracketId.set(bracketId, []);
    matchesByBracketId.get(bracketId).push(match);
  }

  const baseByBracketId = buildOverlayBaseByBracketId(
    brackets,
    matchesByBracketId
  );

  const byId = new Map();
  const byDisplayCode = new Map();

  const addCode = (match, value) => {
    const code = extractReferenceDisplayCode(value);
    if (code && !byDisplayCode.has(code)) byDisplayCode.set(code, match);
  };

  for (const match of matches) {
    const id = toIdText(match);
    if (id) byId.set(id, match);

    const codePayload = buildMatchCodePayload(match, {
      baseByBracketId,
      matchesByBracketId,
    });

    addCode(match, codePayload?.displayCode);
    addCode(match, codePayload?.code);
    addCode(match, match?.displayCode);
    addCode(match, match?.codeResolved);
    addCode(match, match?.roundCode);
    addCode(match, match?.code);
    addCode(match, match?.matchCode);
    addCode(match, match?.slotCode);
    addCode(match, match?.bracketCode);
    addCode(match, match?.labelKey);
    addCode(match, match?.meta?.code);
    addCode(match, match?.meta?.label);
  }

  return { byId, byDisplayCode };
}

async function loadOverlayTournamentMatch(matchId) {
  return Match.findById(matchId)
    .populate({
      path: "tournament",
      select: "name eventType image overlay nameDisplayMode",
    })
    .populate({
      path: "bracket",
      select:
        "type name order stage overlay config meta drawRounds drawStatus slotPlan groups noRankDelta",
    })
    .populate(overlayPairPopulate("pairA"))
    .populate(overlayPairPopulate("pairB"))
    .populate({
      path: "referee",
      select: "name fullName nickname nickName",
    })
    .populate({
      path: "liveBy",
      select: "name fullName nickname nickName",
    })
    .populate(overlayPreviousMatchPopulate("previousA"))
    .populate(overlayPreviousMatchPopulate("previousB"))
    .populate({ path: "nextMatch", select: "_id round order code" })
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor cluster group",
    })
    .populate({
      path: "serve.serverId",
      model: "User",
      select: "name fullName nickname nickName",
    })
    .lean();
}

async function pickActiveMatchFromOrderedIds(ids, { excludedId, stationId, tournamentId }) {
  const orderedIds = uniqueIds(ids).filter((id) => id !== excludedId);
  if (!orderedIds.length) return null;

  const query = {
    _id: { $in: orderedIds },
    status: { $nin: inactiveAutoNextStatuses },
  };
  if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
    query.tournament = tournamentId;
  }

  const rows = await Match.find(query)
    .select("_id status tournament courtStation queueOrder assignedAt scheduledAt startedAt round order createdAt")
    .lean();

  const byId = new Map(rows.map((row) => [toIdString(row?._id), row]));
  for (const id of orderedIds) {
    const match = byId.get(id);
    if (!match || !isAutoNextCandidate(match)) continue;
    const matchStationId = toIdString(match.courtStation);
    if (stationId && matchStationId && matchStationId !== stationId) continue;
    return {
      matchId: id,
      match,
    };
  }

  return null;
}

async function loadAutoNextStation(baseMatch) {
  const stationId = toIdString(baseMatch?.courtStation);
  const projection =
    "_id name code clusterId assignmentMode assignmentQueue currentMatch currentTournament status";

  if (stationId && mongoose.Types.ObjectId.isValid(stationId)) {
    const station = await CourtStation.findById(stationId)
      .select(projection)
      .lean();
    if (station) return station;
  }

  const baseMatchId = toIdString(baseMatch?._id);
  if (!baseMatchId || !mongoose.Types.ObjectId.isValid(baseMatchId)) return null;

  return CourtStation.findOne({
    $or: [
      { currentMatch: baseMatchId },
      { "assignmentQueue.items.matchId": baseMatchId },
    ],
  })
    .select(projection)
    .lean();
}

async function resolveAutoNextOverlayMatch(baseMatch) {
  const baseMatchId = toIdString(baseMatch?._id);
  if (!baseMatchId || !mongoose.Types.ObjectId.isValid(baseMatchId)) return null;

  const tournamentId = toIdString(baseMatch?.tournament?._id || baseMatch?.tournament);
  const station = await loadAutoNextStation(baseMatch);
  const stationId = toIdString(station?._id);
  const stationName = String(station?.name || station?.code || "").trim() || null;
  const clusterId =
    toIdString(station?.clusterId) || toIdString(baseMatch?.courtClusterId);
  const clusterName =
    String(baseMatch?.courtClusterLabel || baseMatch?.courtCluster || "").trim() ||
    null;

  if (stationId) {
    const queueItems = sortStationQueueItems(
      Array.isArray(station?.assignmentQueue?.items)
        ? station.assignmentQueue.items
        : []
    );
    const orderedStationIds = [
      station.currentMatch,
      ...queueItems.map((item) => item?.matchId),
    ];
    const selected = await pickActiveMatchFromOrderedIds(orderedStationIds, {
      excludedId: baseMatchId,
      stationId,
      tournamentId,
    });
    if (selected?.matchId) {
      return {
        matchId: selected.matchId,
        stationId,
        stationName,
        clusterId,
        clusterName,
        source: "court_station_queue",
      };
    }

    const directStationCandidates = await Match.find({
      _id: { $ne: baseMatchId },
      ...(tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)
        ? { tournament: tournamentId }
        : {}),
      courtStation: stationId,
      status: { $nin: inactiveAutoNextStatuses },
    })
      .select("_id status queueOrder assignedAt scheduledAt startedAt round order createdAt")
      .lean();

    const directStationNext = directStationCandidates
      .filter(isAutoNextCandidate)
      .sort(lexCmp)[0];
    if (directStationNext?._id) {
      return {
        matchId: toIdString(directStationNext._id),
        stationId,
        stationName,
        clusterId,
        clusterName,
        source: "court_station_direct",
      };
    }
  }

  if (clusterId && mongoose.Types.ObjectId.isValid(clusterId)) {
    const clusterCandidates = await Match.find({
      _id: { $ne: baseMatchId },
      ...(tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)
        ? { tournament: tournamentId }
        : {}),
      courtClusterId: clusterId,
      status: { $nin: inactiveAutoNextStatuses },
      $or: stationId
        ? [{ courtStation: stationId }, { courtStation: null }, { courtStation: { $exists: false } }]
        : [{ courtStation: null }, { courtStation: { $exists: false } }],
    })
      .select("_id status queueOrder assignedAt scheduledAt startedAt round order createdAt")
      .lean();

    const clusterNext = clusterCandidates.filter(isAutoNextCandidate).sort(lexCmp)[0];
    if (clusterNext?._id) {
      return {
        matchId: toIdString(clusterNext._id),
        stationId: stationId || null,
        stationName,
        clusterId,
        clusterName,
        source: "court_cluster_queue",
      };
    }
  }

  return null;
}

function applyAutoNextCourtContext(match, context) {
  if (!match || !context?.stationId) return match;

  if (!toIdString(match.courtStation)) {
    match.courtStation = context.stationId;
  }
  if (!String(match.courtStationLabel || "").trim() && context.stationName) {
    match.courtStationLabel = context.stationName;
  }
  if (!String(match.courtLabel || "").trim() && context.stationName) {
    match.courtLabel = context.stationName;
  }
  if (!toIdString(match.courtClusterId) && context.clusterId) {
    match.courtClusterId = context.clusterId;
  }
  if (!String(match.courtClusterLabel || "").trim() && context.clusterName) {
    match.courtClusterLabel = context.clusterName;
  }
  if (!String(match.courtCluster || "").trim() && context.clusterName) {
    match.courtCluster = context.clusterName;
  }

  return match;
}

export async function getOverlayMatch(req, res) {
  try {
    const { id } = req.params;
    const normalizePublicAssetUrl = (value) =>
      toPublicUrl(req, value, { absolute: false });

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid match id" });
    }

    // 🟢 1) ƯU TIÊN USER MATCH
    let autoNext = null;
    const autoNextRequested = isAutoNextEnabled(req.query?.autoNext);

    let m = await loadOverlayUserMatch(id);

    const isUserMatch = !!m;

    // 🔵 2) NẾU KHÔNG PHẢI USER MATCH → FALLBACK MATCH CŨ
    if (!m) {
      m = await Match.findById(id)
        .populate({
          path: "tournament",
          // ✅ tournament có overlay.logoUrl (theo schema bạn gửi)
          select: "name eventType image overlay nameDisplayMode",
        })
        .populate({
          path: "bracket",
          select:
            "type name order stage overlay config meta drawRounds drawStatus slotPlan groups noRankDelta",
        })
        .populate(overlayPairPopulate("pairA"))
        .populate(overlayPairPopulate("pairB"))
        .populate({
          path: "referee",
          select: "name fullName nickname nickName",
        })
        .populate({
          path: "liveBy",
          select: "name fullName nickname nickName",
        })
        .populate(overlayPreviousMatchPopulate("previousA"))
        .populate(overlayPreviousMatchPopulate("previousB"))
        .populate({ path: "nextMatch", select: "_id round order code" })
        .populate({
          path: "court",
          select:
            "name number code label zone area venue building floor cluster group",
        })
        .populate({
          path: "serve.serverId",
          model: "User",
          select: "name fullName nickname nickName",
        })
        .lean();
    }

    if (autoNextRequested) {
      if (m && !isUserMatch) {
        autoNext = {
          requested: true,
          fromMatchId: toIdString(m._id),
          selectedMatchId: null,
          source: null,
        };

        const resolvedAutoNext = await resolveAutoNextOverlayMatch(m);
        if (resolvedAutoNext?.matchId) {
          const nextMatch = await loadOverlayTournamentMatch(resolvedAutoNext.matchId);
          if (nextMatch) {
            m = applyAutoNextCourtContext(nextMatch, resolvedAutoNext);
            autoNext = {
              ...autoNext,
              selectedMatchId: toIdString(nextMatch._id),
              stationId: resolvedAutoNext.stationId || null,
              stationName: resolvedAutoNext.stationName || null,
              clusterId: resolvedAutoNext.clusterId || null,
              clusterName: resolvedAutoNext.clusterName || null,
              source: resolvedAutoNext.source,
            };
          } else {
            autoNext.reason = "selected_match_not_found";
          }
        } else {
          autoNext.reason = "no_next_match";
        }
      } else if (m) {
        autoNext = {
          requested: true,
          fromMatchId: toIdString(m._id),
          selectedMatchId: null,
          source: null,
          reason: "user_match_not_supported",
        };
      }
    }

    if (!m) return res.status(404).json({ message: "Match not found" });

    /* ==========================
     * Logo + Sponsor (y hệt getOverlayConfig)
     * ========================== */
    const FALLBACK_LOGO = "https://placehold.co/240x60/png?text=PickleTour";

    let webLogoUrl = FALLBACK_LOGO;
    let webLogoAlt = "";

    try {
      const heroBlock = await CmsBlock.findOne({ slug: "hero" }).lean();
      if (heroBlock?.data) {
        webLogoUrl = heroBlock.data.overlayLogoUrl || FALLBACK_LOGO;
        webLogoAlt =
          heroBlock.data.overlayLogoAlt || heroBlock.data.imageAlt || "";
      }
    } catch (e) {
      console.error(
        "[overlayMatch] load hero CmsBlock failed:",
        e?.message || e
      );
    }

    // ✅ tid chỉ có với Match cũ
    const tid = !isUserMatch
      ? m?.tournament?._id || m?.tournament || null
      : null;

    // ✅ luôn query Tournament để chắc chắn có overlay.logoUrl (đúng schema bạn gửi)
    let tournamentDoc = null;
    if (!isUserMatch && tid) {
      tournamentDoc = await Tournament.findById(tid)
        .select("name eventType image overlay nameDisplayMode")
        .lean();

      // fallback nếu query fail mà populate có sẵn object
      if (!tournamentDoc && m?.tournament && typeof m.tournament === "object") {
        tournamentDoc = m.tournament;
      }
    }

    let sponsors = [];
    if (tid && !isUserMatch) {
      const filter = { tournaments: tid };
      sponsors = await Sponsor.find(filter)
        .select(
          "_id name slug logoUrl websiteUrl refLink tier weight featured tournaments updatedAt"
        )
        .sort({ featured: -1, weight: -1, updatedAt: -1, name: 1 })
        .limit(12)
        .lean();
    }

    webLogoUrl = normalizePublicAssetUrl(webLogoUrl);
    sponsors = sponsors.map((s) => ({
      ...s,
      logoUrl: normalizePublicAssetUrl(s.logoUrl),
      websiteUrl: normalizePublicAssetUrl(s.websiteUrl),
      refLink: normalizePublicAssetUrl(s.refLink),
    }));

    const sponsorLogos = sponsors
      .map((s) => (s.logoUrl || "").trim())
      .filter(Boolean)
      .slice(0, 12);

    /* ==========================
     * Helpers
     * ========================== */
    const pick = (v) => (v == null ? "" : String(v).trim());

    const preferNick = (p) =>
      pick(p?.nickname) ||
      pick(p?.nickName) ||
      pick(p?.user?.nickname) ||
      pick(p?.user?.nickName);

    const fillNick = (p) => {
      if (!p) return p;
      const n =
        pick(p.nickname) ||
        pick(p.nickName) ||
        pick(p.user?.nickname) ||
        pick(p.user?.nickName);
      if (n) {
        p.nickname = n;
        p.nickName = n;
      }
      return p;
    };

    if (m?.pairA) {
      m.pairA.player1 = fillNick(m.pairA.player1);
      m.pairA.player2 = fillNick(m.pairA.player2);
    }
    if (m?.pairB) {
      m.pairB.player1 = fillNick(m.pairB.player1);
      m.pairB.player2 = fillNick(m.pairB.player2);
    }

    /* ==========================
     * Event type + Rules
     * ========================== */
    const evType =
      (
        tournamentDoc?.eventType ||
        m?.tournament?.eventType ||
        ""
      ).toLowerCase() === "single"
        ? "single"
        : "double";
    const displayMode =
      tournamentDoc?.nameDisplayMode === "fullName" ||
      m?.tournament?.nameDisplayMode === "fullName"
        ? "fullName"
        : "nickname";

    const rules = {
      bestOf: Number(m?.rules?.bestOf ?? 3),
      pointsToWin: Number(m?.rules?.pointsToWin ?? 11),
      winByTwo: Boolean(m?.rules?.winByTwo ?? true),
      cap:
        m?.rules?.cap && typeof m.rules.cap === "object"
          ? {
              mode: m.rules.cap.mode || "none",
              points:
                m.rules.cap.points == null ? null : Number(m.rules.cap.points),
            }
          : { mode: "none", points: null },
    };

    const setWins = (gameScores = [], rulesObj) => {
      const pts = Number(rulesObj.pointsToWin || 11);
      const byTwo = !!rulesObj.winByTwo;
      let a = 0;
      let b = 0;
      for (const g of gameScores) {
        const ga = Number(g?.a ?? 0);
        const gb = Number(g?.b ?? 0);
        const max = Math.max(ga, gb);
        const min = Math.min(ga, gb);
        const done = max >= pts && (byTwo ? max - min >= 2 : true);
        if (!done) continue;
        if (ga > gb) a += 1;
        else b += 1;
      }
      return { a, b };
    };

    const gamesToWin = (bestOf = 1) => Math.floor(Number(bestOf) / 2) + 1;
    const { a: setsA, b: setsB } = setWins(m?.gameScores || [], rules);

    const fullNameOf = (p) =>
      pick(p?.fullName) ||
      pick(p?.name) ||
      pick(p?.shortName) ||
      preferNick(p) ||
      "";

    const displayNameOf = (p) => {
      const nickname = preferNick(p);
      const fullName = fullNameOf(p);
      if (displayMode === "fullName") return fullName || nickname || "";
      return nickname || pick(p?.shortName) || fullName || "";
    };

    const playersFromReg = (reg) => {
      if (!reg) return [];
      return [reg.player1, reg.player2].filter(Boolean).map((p) => ({
        id: String(p?._id || p?.user || ""),
        nickname: preferNick(p),
        fullName: fullNameOf(p),
        name: fullNameOf(p),
        displayName: displayNameOf(p),
        displayNameMode: displayMode,
        shortName: p?.shortName || undefined,
      }));
    };

    const regName = (reg) => {
      if (!reg) return "";
      if (evType === "single") {
        return displayNameOf(reg?.player1);
      }
      const a = displayNameOf(reg?.player1);
      const b = displayNameOf(reg?.player2);
      return [a, b].filter(Boolean).join(" & ");
    };

    const teamName = (reg) => {
      return (
        pick(reg?.teamName) ||
        pick(reg?.label) ||
        pick(reg?.title) ||
        regName(reg)
      );
    };

    const hasDisplayableReg = (reg) => {
      if (!reg || typeof reg !== "object") return false;
      const hasPlayer = (player) =>
        Boolean(
          player &&
            typeof player === "object" &&
            (player.user ||
              player._id ||
              player.id ||
              player.fullName ||
              player.name ||
              player.shortName ||
              player.nickname ||
              player.nickName ||
              player.displayName)
        );
      if (hasPlayer(reg.player1) || hasPlayer(reg.player2)) return true;
      return Boolean(
        [
          reg.teamName,
          reg.label,
          reg.title,
          reg.displayName,
          reg.name,
        ].some((value) => {
          const text = pick(value);
          return text && !isReferenceSideName(text);
        })
      );
    };

    const sourceSideFromFinishedMatch = (sourceMatch, seed) => {
      if (!sourceMatch) return "";
      if (
        String(sourceMatch.status || "").toLowerCase() !== "finished" ||
        !sourceMatch.winner
      ) {
        return "";
      }
      const winnerSide = sourceMatch.winner === "B" ? "B" : "A";
      const seedType = String(seed?.type || "");
      const wantsLoser =
        seedType === "stageMatchLoser" || seedType === "matchLoser";
      if (!wantsLoser) return winnerSide;
      return winnerSide === "A" ? "B" : "A";
    };

    let referenceIndexPromise = null;
    const getReferenceIndex = () => {
      if (!referenceIndexPromise) {
        const tournamentId = m?.tournament?._id || m?.tournament || m?.tournamentId;
        referenceIndexPromise = buildOverlayMatchReferenceIndex(tournamentId);
      }
      return referenceIndexPromise;
    };

    const findSourceMatchFromSeed = async (seed) => {
      if (!seed) return null;
      const type = String(seed?.type || "");
      if (
        type !== "stageMatchWinner" &&
        type !== "stageMatchLoser" &&
        type !== "matchWinner" &&
        type !== "matchLoser"
      ) {
        return null;
      }

      const index = await getReferenceIndex();
      const refId =
        toIdText(seed?.ref?.matchId) ||
        toIdText(seed?.ref?.match) ||
        toIdText(seed?.ref?.sourceMatchId) ||
        toIdText(seed?.matchId) ||
        toIdText(seed?.sourceMatchId);
      if (refId && index.byId.has(refId)) return index.byId.get(refId);

      const refCode =
        extractReferenceDisplayCode(seed?.label) ||
        extractReferenceDisplayCode(seed?.ref?.label) ||
        extractReferenceDisplayCode(seed?.ref?.code);
      if (refCode && index.byDisplayCode.has(refCode)) {
        return index.byDisplayCode.get(refCode);
      }

      return null;
    };

    const resolvedPairForSide = async (side) => {
      const normalizedSide = side === "B" ? "B" : "A";
      const pair = normalizedSide === "A" ? m?.pairA : m?.pairB;
      if (hasDisplayableReg(pair)) return pair;

      const seed = normalizedSide === "A" ? m?.seedA : m?.seedB;
      let sourceMatch = normalizedSide === "A" ? m?.previousA : m?.previousB;
      let sourceSide = sourceSideFromFinishedMatch(sourceMatch, seed);

      if (!sourceSide) {
        sourceMatch = await findSourceMatchFromSeed(seed);
        sourceSide = sourceSideFromFinishedMatch(sourceMatch, seed);
      }

      if (!sourceSide) return null;

      const sourcePair = sourceSide === "A" ? sourceMatch?.pairA : sourceMatch?.pairB;
      return hasDisplayableReg(sourcePair) ? sourcePair : null;
    };

    const sideDisplayContext = await buildMatchSideDisplayContextFromMatches(
      [m],
      { includeScope: true }
    );
    const displayPairA =
      resolveMatchSideDisplayPair(m, "A", sideDisplayContext) ||
      (await resolvedPairForSide("A"));
    const displayPairB =
      resolveMatchSideDisplayPair(m, "B", sideDisplayContext) ||
      (await resolvedPairForSide("B"));
    const displayTeamNameA = resolveMatchSideDisplayName(m, "A", {
      ...sideDisplayContext,
      fallback: teamName(displayPairA) || teamName(m?.pairA) || "",
    });
    const displayTeamNameB = resolveMatchSideDisplayName(m, "B", {
      ...sideDisplayContext,
      fallback: teamName(displayPairB) || teamName(m?.pairB) || "",
    });

    /* ==========================
     * Serve
     * ========================== */
    const serve =
      m?.serve && (m.serve.side || m.serve.server || m.serve.playerIndex)
        ? m.serve
        : {
            side: "A",
            server:
              String(m?.tournament?.eventType || "").toLowerCase() === "single"
                ? 1
                : 2,
            opening:
              String(m?.tournament?.eventType || "").toLowerCase() !== "single",
          };

    const serveUser =
      m?.serve?.serverId && typeof m.serve.serverId === "object"
        ? {
            id: String(m.serve.serverId._id),
            name:
              m.serve.serverId.name ||
              m.serve.serverId.fullName ||
              preferNick(m.serve.serverId) ||
              "",
            nickname:
              pick(m.serve.serverId.nickname) ||
              pick(m.serve.serverId.nickName) ||
              undefined,
          }
        : undefined;

    /* ==========================
     * Court
     * ========================== */
    let courtId = m?.court?._id || m?.courtId || null;
    let courtNumber = m?.court?.number ?? m?.courtNo ?? undefined;
    let courtName =
      m?.court?.name ??
      m?.courtName ??
      (courtNumber != null ? `Sân ${courtNumber}` : "");

    const courtExtra = {
      code: m?.court?.code || undefined,
      label: m?.court?.label || m?.courtLabel || undefined,
      zone: m?.court?.zone || m?.court?.area || undefined,
      venue: m?.court?.venue || undefined,
      building: m?.court?.building || undefined,
      floor: m?.court?.floor || undefined,
      cluster: m?.court?.cluster || m?.courtCluster || undefined,
      group: m?.court?.group || undefined,
    };
    {
      const resolvedCourt = resolveOverlayCourt(m);
      courtId = resolvedCourt.courtId;
      courtNumber = resolvedCourt.courtNumber;
      courtName = resolvedCourt.courtName;
      Object.assign(courtExtra, resolvedCourt.courtExtra);
    }

    /* ==========================
     * Streams + Video
     * ========================== */
    const streams =
      (Array.isArray(m?.streams) && m.streams.length && m.streams) ||
      (Array.isArray(m?.meta?.streams) && m.meta.streams) ||
      [];
    const video = pick(m?.video);

    /* ==========================
     * Overlay (theme + logo + sponsors + clock)
     * ========================== */
    const baseOverlay =
      m?.overlay ||
      tournamentDoc?.overlay ||
      m?.tournament?.overlay ||
      m?.bracket?.overlay ||
      {};

    const overlayEnabled =
      typeof baseOverlay.enabled === "boolean" ? !!baseOverlay.enabled : true;

    const showClock =
      typeof baseOverlay.showClock === "boolean"
        ? !!baseOverlay.showClock
        : true;

    // ✅ RULE LOGO:
    // - UserMatch: baseOverlay.logoUrl
    // - Match: Tournament.overlay.logoUrl (query Tournament)
    let resolvedLogoUrl = isUserMatch
      ? String(baseOverlay?.logoUrl || "").trim()
      : String(tournamentDoc?.overlay?.logoUrl || "").trim();

    resolvedLogoUrl = normalizePublicAssetUrl(resolvedLogoUrl);

    const rootOverlay = {
      theme: baseOverlay.theme || "dark",
      accentA: baseOverlay.accentA || "#25C2A0",
      accentB: baseOverlay.accentB || "#4F46E5",
      corner: baseOverlay.corner || "tl",
      rounded:
        typeof baseOverlay.rounded === "number" ? baseOverlay.rounded : 18,
      shadow:
        typeof baseOverlay.shadow === "boolean" ? baseOverlay.shadow : true,
      showSets:
        typeof baseOverlay.showSets === "boolean" ? baseOverlay.showSets : true,
      fontFamily: baseOverlay.fontFamily || "",
      nameScale:
        typeof baseOverlay.nameScale === "number" ? baseOverlay.nameScale : 1,
      scoreScale:
        typeof baseOverlay.scoreScale === "number" ? baseOverlay.scoreScale : 1,
      overlayNameStyle: ["1", "2", "3", "4"].includes(
        String(baseOverlay.overlayNameStyle || "")
      )
        ? String(baseOverlay.overlayNameStyle)
        : "1",
      customCss: baseOverlay.customCss || "",

      // ✅ đúng yêu cầu
      // logoUrl: resolvedLogoUrl || webLogoUrl,

      size: baseOverlay.size || "md",
      scaleScore:
        typeof baseOverlay.scaleScore === "number" ? baseOverlay.scaleScore : 1,
      enabled: overlayEnabled,
      showClock,

      webLogoUrl,
      webLogoAlt,
      sponsorLogos,
    };

    /* ==========================
     * Round / Seeds / Logs
     * ========================== */
    const brType = (m?.bracket?.type || m?.format || "").toString();
    const drawSize =
      Number(m?.bracket?.meta?.drawSize) > 0
        ? Number(m.bracket.meta.drawSize)
        : Number.isInteger(+m?.bracket?.drawRounds)
        ? 1 << +m.bracket.drawRounds
        : 0;
    const roundNo = Number.isFinite(+m?.round) ? +m.round : 1;

    let roundSize;
    if (drawSize && ["knockout", "double_elim", "roundElim"].includes(brType)) {
      roundSize = Math.max(2, drawSize >> (roundNo - 1));
    }
    const roundCode =
      m?.roundCode ||
      (Number.isFinite(roundSize) ? `R${roundSize}` : undefined);

    const seeds = {
      A: m?.seedA || undefined,
      B: m?.seedB || undefined,
    };

    const liveLogTail = Array.isArray(m?.liveLog)
      ? m.liveLog.slice(-10)
      : undefined;

    /* ==========================
     * Stage
     * ========================== */
    const format = (m?.format || m?.bracket?.type || "").toString() || brType;

    let stageType = null;
    let stageName = "";

    if (isUserMatch) {
      stageType = "user_match";
      stageName = "Trận đấu PickleTour";
    } else {
      const isGroupLike =
        ["group", "round_robin", "gsl", "swiss"].includes(format) ||
        m?.phase === "group";

      const isKnockoutLike =
        ["knockout", "roundElim"].includes(format) ||
        ["knockout", "roundElim"].includes(brType);

      const isDoubleElim = format === "double_elim" || brType === "double_elim";

      const isThirdPlaceMatch =
        !!m?.isThirdPlace ||
        !!m?.meta?.thirdPlace ||
        (m?.branch === "consol" &&
          (roundSize === 2 ||
            (m?.roundName || "").toLowerCase().includes("3/4")));

      if (isGroupLike) {
        stageType = "group";
        stageName = "Vòng bảng";
      } else if (isThirdPlaceMatch && (isKnockoutLike || isDoubleElim)) {
        stageType = "third_place";
        stageName = "Tranh hạng 3/4";
      } else if (isKnockoutLike) {
        stageType = "playoff";
        if (roundSize >= 16) stageName = `Vòng 1/${Math.max(2, roundSize / 2)}`;
        else if (roundSize === 8) stageName = "Tứ kết";
        else if (roundSize === 4) stageName = "Bán kết";
        else if (roundSize === 2) {
          stageName =
            m?.branch === "gf" || m?.phase === "grand_final"
              ? "Chung kết tổng"
              : "Chung kết";
        } else stageName = "Playoff";
      } else if (isDoubleElim) {
        stageType = "playoff";
        const branch = m?.branch || "main";
        if (branch === "wb" || branch === "main")
          stageName = "Playoff – Nhánh thắng";
        else if (branch === "lb") stageName = "Playoff – Nhánh thua";
        else if (branch === "gf") stageName = "Chung kết tổng";
        else stageName = "Playoff";
      } else if (
        ["winners", "losers", "decider", "grand_final"].includes(m?.phase)
      ) {
        stageType = "playoff";
        if (m.phase === "grand_final") stageName = "Chung kết";
        else if (m.phase === "decider") stageName = "Trận quyết định";
        else stageName = "Playoff";
      }
    }

    /* ==========================
     * Referees + chain
     * ========================== */
    const referees =
      Array.isArray(m?.referee) && m.referee.length
        ? m.referee.map((r) => ({
            id: String(r?._id),
            name: r?.name || r?.fullName || "",
            nickname: pick(r?.nickname) || pick(r?.nickName) || undefined,
          }))
        : [];

    const referee =
      referees[0] ||
      (m?.referee
        ? {
            id: String(m.referee?._id || ""),
            name: m.referee?.name || m.referee?.fullName || "",
            nickname:
              pick(m.referee?.nickname) ||
              pick(m.referee?.nickName) ||
              undefined,
          }
        : undefined);

    const previousA = m?.previousA
      ? {
          id: String(m.previousA._id),
          round: m.previousA.round,
          order: m.previousA.order,
          code: m.previousA.code || undefined,
        }
      : undefined;

    const previousB = m?.previousB
      ? {
          id: String(m.previousB._id),
          round: m.previousB.round,
          order: m.previousB.order,
          code: m.previousB.code || undefined,
        }
      : undefined;

    const nextMatch = m?.nextMatch
      ? {
          id: String(m.nextMatch._id),
          round: m.nextMatch.round,
          order: m.nextMatch.order,
          code: m.nextMatch.code || undefined,
          slot: m?.nextSlot || undefined,
        }
      : undefined;

    /* ==========================
     * Times
     * ========================== */
    const times = {
      scheduledAt: m?.scheduledAt || null,
      assignedAt: m?.assignedAt || null,
      startedAt: m?.startedAt || null,
      finishedAt: m?.finishedAt || null,
      updatedAt: m?.updatedAt || null,
      createdAt: m?.createdAt || null,
    };

    /* ==========================
     * Break
     * ========================== */
    const isBreak = m?.isBreak
      ? {
          active: !!m.isBreak.active,
          afterGame:
            m.isBreak.afterGame != null
              ? Number(m.isBreak.afterGame)
              : m.currentGame ?? null,
          note: m.isBreak.note || "",
          startedAt: m.isBreak.startedAt || null,
          expectedResumeAt: m.isBreak.expectedResumeAt || null,
        }
      : {
          active: false,
          afterGame: null,
          note: "",
          startedAt: null,
          expectedResumeAt: null,
        };

    /* ==========================
     * Response
     * ========================== */
    const payload = {
      matchId: String(m._id),
      status: (m.status || "").toUpperCase(),
      winner: m.winner || "",

      tournament: isUserMatch
        ? {
            id: null,
            name: m?.title || "",
            image: "",
            nameDisplayMode: "nickname",
            displayNameMode: "nickname",
            eventType: evType,
            overlay: undefined,
            webLogoUrl,
            webLogoAlt,
            sponsors: undefined,
          }
        : {
            id: tournamentDoc?._id || m?.tournament?._id || tid || null,
            name: tournamentDoc?.name || m?.tournament?.name || "",
            image: tournamentDoc?.image || m?.tournament?.image || "",
            nameDisplayMode:
              tournamentDoc?.nameDisplayMode === "fullName" ||
              m?.tournament?.nameDisplayMode === "fullName"
                ? "fullName"
                : "nickname",
            displayNameMode: displayMode,
            eventType: evType,
            overlay:
              tournamentDoc?.overlay || m?.tournament?.overlay || undefined,
            webLogoUrl,
            webLogoAlt,
            sponsors:
              sponsors.length > 0
                ? sponsors.map((s) => ({
                    id: String(s._id),
                    name: s.name,
                    slug: s.slug,
                    logoUrl: s.logoUrl || "",
                    websiteUrl: s.websiteUrl || "",
                    refLink: s.refLink || "",
                    tier: s.tier,
                    featured: !!s.featured,
                    weight: s.weight ?? 0,
                  }))
                : undefined,
          },

      bracket: m?.bracket
        ? {
            id: String(m.bracket._id),
            type: m.bracket.type || "",
            name: m.bracket.name || "",
            order: m.bracket.order ?? undefined,
            stage: m.bracket.stage ?? undefined,
            overlay: m.bracket.overlay || undefined,
            drawRounds: m.bracket.drawRounds ?? undefined,
            drawStatus: m.bracket.drawStatus || undefined,
            noRankDelta: !!m.bracket.noRankDelta,
            config: m.bracket.config || undefined,
            meta: m.bracket.meta || undefined,
            groups:
              Array.isArray(m.bracket.groups) && m.bracket.groups.length
                ? m.bracket.groups.map((g) => ({
                    id: String(g._id),
                    name: g.name,
                    expectedSize: g.expectedSize,
                    size:
                      Number.isFinite(g.expectedSize) && g.expectedSize > 0
                        ? g.expectedSize
                        : Array.isArray(g.regIds)
                        ? g.regIds.length
                        : 0,
                  }))
                : undefined,
          }
        : undefined,

      bracketType: m?.bracket?.type || "",
      format: m?.format || m?.bracket?.type || "",
      branch: m?.branch || "main",
      phase: m?.phase || null,
      pool: m?.pool || { id: null, name: "" },

      roundCode,
      roundName: m?.roundName || "",
      round: roundNo,
      roundSize: roundSize || undefined,

      stageType: stageType || undefined,
      stageName: stageName || undefined,

      seeds,

      code: m?.code || undefined,
      labelKey: m?.labelKey || undefined,
      stageIndex: m?.stageIndex || undefined,

      teams: {
        A: {
          name: displayTeamNameA,
          displayName: displayTeamNameA,
          displayNameMode: displayMode,
          players: playersFromReg(displayPairA),
          seed: displayPairA?.seed ?? m?.pairA?.seed ?? undefined,
          label: displayPairA?.label ?? m?.pairA?.label ?? undefined,
          teamName: displayPairA?.teamName ?? m?.pairA?.teamName ?? undefined,
        },
        B: {
          name: displayTeamNameB,
          displayName: displayTeamNameB,
          displayNameMode: displayMode,
          players: playersFromReg(displayPairB),
          seed: displayPairB?.seed ?? m?.pairB?.seed ?? undefined,
          label: displayPairB?.label ?? m?.pairB?.label ?? undefined,
          teamName: displayPairB?.teamName ?? m?.pairB?.teamName ?? undefined,
        },
      },

      teamAName: displayTeamNameA || undefined,
      teamBName: displayTeamNameB || undefined,
      resolvedSideNameA: displayTeamNameA || undefined,
      resolvedSideNameB: displayTeamNameB || undefined,
      overlayNameStyle: rootOverlay.overlayNameStyle,

      pairA: m?.pairA
        ? {
            id: String(m.pairA._id || ""),
            seed: m.pairA.seed ?? undefined,
            label: m.pairA.label ?? undefined,
            teamName: m.pairA.teamName ?? undefined,
            displayName: teamName(m.pairA),
            displayNameMode: displayMode,
          }
        : null,

      pairB: m?.pairB
        ? {
            id: String(m.pairB._id || ""),
            seed: m.pairB.seed ?? undefined,
            label: m.pairB.label ?? undefined,
            teamName: m.pairB.teamName ?? undefined,
            displayName: teamName(m.pairB),
            displayNameMode: displayMode,
          }
        : null,

      rules,
      currentGame: Number.isInteger(m?.currentGame) ? m.currentGame : 0,

      serve: {
        side: (serve?.side || "A").toUpperCase() === "B" ? "B" : "A",
        server: Number(serve?.server ?? serve?.playerIndex ?? 1) || 1,
        serverId:
          serveUser || (m?.serve?.serverId ? String(m.serve.serverId) : null),
      },

      gameScores: Array.isArray(m?.gameScores) ? m.gameScores : [],
      sets: { A: setsA, B: setsB },
      needSetsToWin: gamesToWin(rules.bestOf),

      court: courtId
        ? { id: courtId, name: courtName, number: courtNumber, ...courtExtra }
        : null,
      courtId: courtId || undefined,
      courtName: courtName || undefined,
      courtNo: courtNumber ?? undefined,
      queueOrder: m?.queueOrder ?? undefined,
      autoNext: autoNext || undefined,

      referees,
      referee,

      liveBy: m?.liveBy
        ? {
            id: String(m.liveBy._id),
            name: m.liveBy.name || m.liveBy.fullName || "",
            nickname:
              pick(m.liveBy.nickname) || pick(m.liveBy.nickName) || undefined,
          }
        : undefined,

      previousA,
      previousB,
      nextMatch,

      ...times,

      video: video || undefined,
      streams,
      liveVersion: m?.liveVersion ?? undefined,
      liveLogTail,
      liveLog: undefined,

      participants:
        Array.isArray(m?.participants) && m.participants.length && !isUserMatch
          ? m.participants.map((x) => String(x))
          : undefined,

      overlay: rootOverlay || undefined,
      meta: m?.meta || undefined,
      note: m?.note || undefined,

      rating: {
        delta: m?.ratingDelta ?? 0,
        applied: !!m?.ratingApplied,
        appliedAt: m?.ratingAppliedAt || null,
      },

      isBreak,
    };

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-PKT-Cache", "BYPASS");
    res.json(payload);
  } catch (err) {
    console.error("GET /overlay/match error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

const FINISHED = "finished";
const STATUS_RANK = {
  assigned: 0,
  queued: 1,
  scheduled: 2,
  live: 3,
};

const toTs = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
const toNum = (v) => (Number.isFinite(+v) ? +v : Number.POSITIVE_INFINITY);

/** Xây dựng key sort đa tiêu chí (lexicographic) */
function sortKey(m) {
  return [
    STATUS_RANK[m?.status] ?? 99,
    toNum(m?.queueOrder),
    toTs(m?.assignedAt),
    toTs(m?.scheduledAt),
    toTs(m?.startedAt),
    toNum(m?.round),
    toNum(m?.order),
    toTs(m?.createdAt),
    String(m?._id || ""),
  ];
}
function lexCmp(a, b) {
  const ka = sortKey(a),
    kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/**
 * GET /api/courts/:courtId/next?after=:matchId
 * Trả { matchId: "..." } | { matchId: null }
 */
export const getNextMatchByCourt = expressAsyncHandler(async (req, res) => {
  setNoStoreHeaders(res);
  const { courtId } = req.params;
  const { after } = req.query;
  const sendNoStoreJson = (payload) => {
    return res.json(payload);
  };

  if (!courtId || !mongoose.Types.ObjectId.isValid(courtId)) {
    return res.status(400).json({ message: "Invalid courtId" });
  }
  const cid = new mongoose.Types.ObjectId(courtId);

  const court = await Court.findById(cid)
    .select("currentMatch manualAssignment")
    .lean();

  if (court?.manualAssignment?.enabled) {
    const pendingIds = getManualAssignmentItems(court)
      .filter((item) => item.state === "pending")
      .map((item) => String(item.matchId))
      .filter(Boolean);

    if (pendingIds.length) {
      const cursorId =
        after && mongoose.Types.ObjectId.isValid(after)
          ? String(after)
          : String(court.currentMatch || "");

      const startIndex = cursorId ? pendingIds.findIndex((id) => id === cursorId) : -1;
      const candidateIds =
        startIndex >= 0
          ? pendingIds.slice(startIndex + 1)
          : pendingIds.filter((id) => id !== String(court.currentMatch || ""));

      if (candidateIds.length) {
        const manualCandidates = await Match.find({
          _id: { $in: candidateIds },
          status: { $nin: [FINISHED, "cancelled", "canceled"] },
        })
          .select("_id")
          .lean();

        const availableSet = new Set(manualCandidates.map((match) => String(match._id)));
        const nextManualId = candidateIds.find((id) => availableSet.has(id));
        if (nextManualId) {
          return sendNoStoreJson({ matchId: nextManualId });
        }
      }
    }
  }

  // Lấy toàn bộ ứng viên trên cùng sân, chưa finished
  // Query both old `court` and new `courtStation` fields for cluster migration
  const candidates = await Match.find({
    $or: [{ court: cid }, { courtStation: cid }],
    status: { $ne: FINISHED },
  })
    .select(
      "_id status queueOrder assignedAt scheduledAt startedAt round order createdAt court courtStation"
    )
    .lean();

  if (!candidates.length) {
    return sendNoStoreJson({ matchId: null });
  }

  candidates.sort(lexCmp);

  // Nếu có "after" và tồn tại trong tập → lấy phần tử đứng sau nó
  if (after && mongoose.Types.ObjectId.isValid(after)) {
    const idx = candidates.findIndex((m) => String(m._id) === String(after));
    if (idx >= 0) {
      const next = candidates[idx + 1];
      return sendNoStoreJson({ matchId: next ? String(next._id) : null });
    }
    // Nếu "after" không nằm trong tập (vì đã finished/khác sân), ta lấy phần tử đầu
  }

  // Mặc định: trả trận "đầu hàng" theo tiêu chí sort
  return sendNoStoreJson({ matchId: String(candidates[0]._id) });
});
