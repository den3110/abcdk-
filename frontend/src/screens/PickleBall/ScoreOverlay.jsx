// src/pages/overlay/ScoreOverlay.jsx
/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useState, useRef, forwardRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  useGetOverlaySnapshotQuery,
  useLazyGetTournamentQuery,
  useLazyGetNextByCourtQuery,
} from "../../slices/tournamentsApiSlice";
import { useGetOverlayConfigQuery } from "../../slices/overlayApiSlice";
import { useSocket } from "../../context/SocketContext";
import { useLanguage } from "../../context/LanguageContext";
import { toHttpsIfNotLocalhost } from "../../utils/url";
import {
  getTournamentNameDisplayMode,
  getTournamentTeamName,
} from "../../utils/tournamentName";
import {
  extractMatchPatchPayload,
  extractMatchPayload,
  getMatchCourtStationName,
  getMatchPayloadId,
  getMatchSideDisplayName,
  getPairDisplayName,
  isLightweightMatchPayload,
  isNewerOrEqualMatchPayload,
} from "../../utils/matchDisplay";

/* ========================== Utils ========================== */
const smax = (v) => (Number.isFinite(+v) ? +v : 0);
const gameWon = (x, y, pts, byTwo) =>
  smax(x) >= smax(pts) && (byTwo ? x - y >= 2 : x - y >= 1);

const readStr = (...cands) => {
  for (const x of cands) {
    if (!x) continue;
    const v = String(x).trim();
    if (v) return v;
  }
  return "";
};

const isReferenceSideName = (value) => {
  const normalized = readStr(value)
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

const isPlaceholderName = (value) => {
  const text = readStr(value);
  if (!text) return true;
  const lower = text.toLowerCase();
  return [
    "-",
    "—",
    "â€”",
    "n/a",
    "na",
    "tbd",
    "team a",
    "team b",
    "đội a",
    "đội b",
    "chưa có đội",
    "chua co doi",
    "registration",
  ].includes(lower);
};

const usefulName = (...values) => {
  for (const value of values) {
    const text = readStr(value);
    if (text && !isPlaceholderName(text)) return text;
  }
  return "";
};

const pairDisplayName = (reg, evType, displayMode = "nickname") => {
  if (!reg) return "";
  return (
    getPairDisplayName(reg, {
      eventType: evType,
      nameDisplayMode: displayMode,
      tournament: {
        eventType: evType,
        nameDisplayMode: displayMode,
      },
    }) || ""
  );
};

const sideDisplayName = (payload, side, evType, displayMode) => {
  const key = String(side).toUpperCase() === "B" ? "B" : "A";
  const team = payload?.teams?.[key] || {};
  const pair = payload?.[`pair${key}`];
  return usefulName(
    payload?.[`resolvedSideName${key}`],
    payload?.[`__side${key}`],
    payload?.[`team${key}Name`],
    payload?.[`pair${key}Name`],
    payload?.[`side${key}Name`],
    team?.displayName,
    team?.teamName,
    team?.label,
    team?.name,
    pair?.displayName,
    pair?.teamName,
    pair?.label,
    pairDisplayName(pair, evType, displayMode),
    getMatchSideDisplayName(payload, key, ""),
  );
};

const preferNick = (p) =>
  readStr(
    p?.nickname,
    p?.nickName,
    p?.nick,
    p?.shortName,
    p?.name,
    p?.fullName,
  );

const codeToRoundLabel = (code) => {
  if (!code) return "";
  const rc = String(code).toUpperCase();
  if (rc === "F") return "Chung kết";
  if (rc === "SF") return "Bán kết";
  if (rc === "QF") return "Tứ kết";
  const m = rc.match(/^R(\d+)$/);
  if (m) {
    const size = +m[1];
  if (size === 8) return "Tứ kết";
  if (size === 4) return "Bán kết";
  if (size === 2) return "Chung kết";
  const denom = Math.max(2, size / 2);
  return `Vòng 1/${denom}`;
  }
  return rc;
};

const parseRoundSize = (roundCode) => {
  if (!roundCode) return null;
  const m = String(roundCode)
    .toUpperCase()
    .match(/^R(\d+)$/);
  return m ? +m[1] : null;
};

const labelForRoundSize = (size) => {
  if (!size) return "";
  if (size >= 16) return `Vòng 1/${Math.max(2, size / 2)}`;
  if (size === 8) return "Tứ kết";
  if (size === 4) return "Bán kết";
  if (size === 2) return "Chung kết";
  return `Vòng ${size}`;
};

// Ưu tiên roundName, rồi QF/SF/F, rồi R\d+
const canonicalRoundLabel = (data) => {
  const byName = readStr(data?.roundName);
  if (byName) return byName;

  const rc = String(data?.roundCode || "").toUpperCase();
  if (rc === "QF") return "Tứ kết";
  if (rc === "SF") return "Bán kết";
  if (rc === "F" || rc === "GF") return "Chung kết";

  const m = rc.match(/^R(\d+)$/);
  if (m) return labelForRoundSize(+m[1]);

  return "";
};

// Chip phase
const phaseLabelFromData = (data) => {
  const bt = (data?.bracketType || data?.bracket?.type || "").toLowerCase();
  if (bt === "group") return "Vòng bảng";

  if (bt === "roundelim") {
    const byOrdinal = roundElimOrdinalLabel(data);
    if (byOrdinal) return byOrdinal;
    const byName = readStr(data?.roundName);
    if (byName) return byName;
    const byCode = codeToRoundLabel(data?.roundCode);
    return byCode || "Vòng loại";
  }

  const roundLabel = canonicalRoundLabel(data);
  if (
    bt === "po" ||
    bt === "playoff" ||
    bt === "play-offs" ||
    bt === "knockout" ||
    bt === "ko" ||
    bt === "single" ||
    bt === "singleelimination" ||
    bt === "double" ||
    bt === "doubleelimination"
  ) {
    return roundLabel || "Vòng loại trực tiếp";
  }
  return roundLabel || "";
};

function normalizePayload(p) {
  if (!p) return null;

  const eventType =
    (p?.tournament?.eventType || p?.eventType || "").toLowerCase() === "single"
      ? "single"
      : "double";
  const displayMode = getTournamentNameDisplayMode(p?.tournament || p);

  const rules = {
    bestOf: Number(p?.rules?.bestOf ?? 3),
    pointsToWin: Number(p?.rules?.pointsToWin ?? 11),
    winByTwo: Boolean(p?.rules?.winByTwo ?? true),
  };

  const bracketType = (p?.bracket?.type || p?.bracketType || "").toLowerCase();
  const roundCode =
    p?.roundCode ||
    p?.round_code ||
    (p?.roundSize ? `R${p.roundSize}` : "") ||
    (p?.round_size ? `R${p.round_size}` : "") ||
    p?.round;
  const roundName =
    p?.roundName || p?.round_name || codeToRoundLabel(roundCode) || "";
  const roundNumber = Number.isFinite(+p?.round) ? +p?.round : undefined;

  // ✅ normalize isBreak về 1 kiểu duy nhất
  const rawBreak =
    p?.isBreak ?? p?.isbreak ?? p?.is_break ?? p?.break ?? p?.pause ?? null;
  let normBreak = null;
  if (rawBreak) {
    if (typeof rawBreak === "object") {
      normBreak = {
        active:
          rawBreak.active === true ||
          rawBreak.isActive === true ||
          rawBreak.enabled === true,
        afterGame:
          typeof rawBreak.afterGame === "number" ? rawBreak.afterGame : null,
        note: rawBreak.note || "",
        startedAt: rawBreak.startedAt || rawBreak.startAt || null,
        expectedResumeAt:
          rawBreak.expectedResumeAt || rawBreak.resumeAt || null,
      };
    } else {
      // true / "1" / "true"
      const s = String(rawBreak).toLowerCase();
      if (s === "1" || s === "true") {
        normBreak = { active: true, afterGame: null, note: "" };
      }
    }
  }

  let teams = { A: {}, B: {} };
  if (p?.teams?.A || p?.teams?.B) {
    const playersA =
      Array.isArray(p?.teams?.A?.players) && p.teams.A.players.length
        ? p.teams.A.players
        : [];
    const playersB =
      Array.isArray(p?.teams?.B?.players) && p.teams.B.players.length
        ? p.teams.B.players
        : [];

    const nameA = readStr(
      p?.teams?.A?.teamName,
      p?.teams?.A?.label,
      p?.teams?.A?.name,
    );
    const nameB = readStr(
      p?.teams?.B?.teamName,
      p?.teams?.B?.label,
      p?.teams?.B?.name,
    );

    teams.A = { name: nameA || "—", players: playersA };
    teams.B = { name: nameB || "—", players: playersB };
  } else {
    const a1 = p?.pairA?.player1
      ? {
          nickname: preferNick(p?.pairA?.player1),
          name: readStr(p?.pairA?.player1?.fullName, p?.pairA?.player1?.name),
        }
      : null;
    const a2 = p?.pairA?.player2
      ? {
          nickname: preferNick(p?.pairA?.player2),
          name: readStr(p?.pairA?.player2?.fullName, p?.pairA?.player2?.name),
        }
      : null;

    const b1 = p?.pairB?.player1
      ? {
          nickname: preferNick(p?.pairB?.player1),
          name: readStr(p?.pairB?.player1?.fullName, p?.pairB?.player1?.name),
        }
      : null;
    const b2 = p?.pairB?.player2
      ? {
          nickname: preferNick(p?.pairB?.player2),
          name: readStr(p?.pairB?.player2?.fullName, p?.pairB?.player2?.name),
        }
      : null;

    const listA = [a1, a2].filter(Boolean);
    const listB = [b1, b2].filter(Boolean);

    teams.A = {
      name: pairDisplayName(p?.pairA, eventType, displayMode),
      players: listA,
    };
    teams.B = {
      name: pairDisplayName(p?.pairB, eventType, displayMode),
      players: listB,
    };
  }

  const teamAFallbackName = sideDisplayName(p, "A", eventType, displayMode);
  const teamBFallbackName = sideDisplayName(p, "B", eventType, displayMode);

  teams = {
    A: {
      ...teams.A,
      name: teamAFallbackName || usefulName(teams.A?.name),
      teamName: readStr(
        teams.A?.teamName,
        p?.teamAName,
        p?.teams?.A?.teamName,
        p?.pairA?.teamName,
      ),
      label: readStr(
        teams.A?.label,
        p?.resolvedSideNameA,
        p?.__sideA,
        p?.teams?.A?.label,
        p?.pairA?.label,
      ),
    },
    B: {
      ...teams.B,
      name: teamBFallbackName || usefulName(teams.B?.name),
      teamName: readStr(
        teams.B?.teamName,
        p?.teamBName,
        p?.teams?.B?.teamName,
        p?.pairB?.teamName,
      ),
      label: readStr(
        teams.B?.label,
        p?.resolvedSideNameB,
        p?.__sideB,
        p?.teams?.B?.label,
        p?.pairB?.label,
      ),
    },
  };

  const courtId =
    p?.courtStationId || p?.court?.id || p?.court?._id || p?.courtId || null;
  const courtName =
    getMatchCourtStationName(p) || p?.courtName || p?.court?.name || "";

  return {
    _id: String(p?._id || p?.matchId || ""),
    matchId: String(p?._id || p?.matchId || ""),
    status: p?.status || "",
    winner: p?.winner || "",
    liveVersion: p?.liveVersion ?? p?.version,
    version: p?.liveVersion ?? p?.version,
    updatedAt: p?.updatedAt ?? p?.liveAt ?? p?.updated_at,
    isBreak: normBreak, // ✅ luôn có dạng chuẩn hoặc null
    tournament: {
      id: p?.tournament?._id || p?.tournament?.id || p?.tournamentId || null,
      name: p?.tournament?.name || readStr(p?.tournamentName) || "",
      image: p?.tournament?.image || "",
      nameDisplayMode: displayMode,
      eventType:
        (p?.tournament?.eventType || p?.eventType || "").toLowerCase() ===
        "single"
          ? "single"
          : "double",
    },
    teams,
    pairA: p?.pairA || null,
    pairB: p?.pairB || null,
    seedA: p?.seedA || p?.seeds?.A || null,
    seedB: p?.seedB || p?.seeds?.B || null,
    seeds: {
      A: p?.seeds?.A || p?.seedA || null,
      B: p?.seeds?.B || p?.seedB || null,
    },
    previousA: p?.previousA || null,
    previousB: p?.previousB || null,
    rules,
    serve:
      p?.serve ||
      {
        side: "A",
        server:
          (p?.tournament?.eventType || p?.eventType || "").toLowerCase() ===
          "single"
            ? 1
            : 2,
        opening:
          (p?.tournament?.eventType || p?.eventType || "").toLowerCase() !==
          "single",
      },
    currentGame: Number.isInteger(p?.currentGame) ? p.currentGame : 0,
    gameScores:
      Array.isArray(p?.gameScores) && p.gameScores.length
        ? p.gameScores
        : [{ a: 0, b: 0 }],
    bracketType,
    roundCode,
    roundName,
    roundNumber,
    court: { id: courtId, name: courtName },
    liveLog:
      p?.liveLog ||
      p?.livelog ||
      p?.live_log ||
      p?.logs ||
      p?.events ||
      p?.timeline ||
      null,
    scoreHistory: p?.scoreHistory || p?.history || p?.pointHistory || null,
  };
}

/* ==== pick overlay từ root / .overlay / .tournament.overlay ==== */
const OVERLAY_KEYS = new Set([
  "theme",
  "size",
  "accentA",
  "accentB",
  "corner",
  "rounded",
  "shadow",
  "showSets",
  "fontFamily",
  "nameScale",
  "scoreScale",
  "customCss",
  "logoUrl",
  "webLogoUrl",
]);

const looksLikeOverlay = (obj) =>
  obj &&
  typeof obj === "object" &&
  [...OVERLAY_KEYS].some((k) => obj[k] != null);

const pickOverlay = (obj) => {
  if (!obj || typeof obj !== "object") return null;
  const src =
    (obj.overlay && looksLikeOverlay(obj.overlay) && obj.overlay) ||
    (obj.tournament &&
      obj.tournament.overlay &&
      looksLikeOverlay(obj.tournament.overlay) &&
      obj.tournament.overlay) ||
    (looksLikeOverlay(obj) && obj) ||
    null;
  if (!src) return null;
  const out = {};
  OVERLAY_KEYS.forEach((k) => {
    if (src[k] != null) out[k] = src[k];
  });
  return out;
};

// merge helpers
const hasVal = (v) =>
  v !== null &&
  v !== undefined &&
  (typeof v !== "string" || !isPlaceholderName(v));
const keep = (prev, next) => (hasVal(next) ? next : prev);

const mergeTournament = (prev = {}, next = {}) => ({
  id: keep(prev?.id, next?.id),
  name: keep(prev?.name, next?.name),
  image: keep(prev?.image, next?.image),
  eventType: keep(prev?.eventType, next?.eventType),
  nameDisplayMode: keep(prev?.nameDisplayMode, next?.nameDisplayMode),
});

const mergeTeam = (prev = {}, next = {}) => ({
  name: keep(prev?.name, next?.name),
  teamName: keep(prev?.teamName, next?.teamName),
  label: keep(prev?.label, next?.label),
  players: Array.isArray(next?.players) ? next.players : prev?.players,
});

const mergeNormalized = (prev, next) => {
  if (!prev) return next || null;
  if (!next) return prev;
  if (!isNewerOrEqualMatchPayload(prev, next)) return prev;
  return {
    ...prev,
    ...next,
    tournament: mergeTournament(prev.tournament, next.tournament),
    pairA: next?.pairA ?? prev?.pairA ?? null,
    pairB: next?.pairB ?? prev?.pairB ?? null,
    seedA: next?.seedA ?? next?.seeds?.A ?? prev?.seedA ?? prev?.seeds?.A ?? null,
    seedB: next?.seedB ?? next?.seeds?.B ?? prev?.seedB ?? prev?.seeds?.B ?? null,
    seeds: {
      A: next?.seeds?.A ?? next?.seedA ?? prev?.seeds?.A ?? prev?.seedA ?? null,
      B: next?.seeds?.B ?? next?.seedB ?? prev?.seeds?.B ?? prev?.seedB ?? null,
    },
    previousA: next?.previousA ?? prev?.previousA ?? null,
    previousB: next?.previousB ?? prev?.previousB ?? null,
    teams: {
      A: mergeTeam(prev?.teams?.A, next?.teams?.A),
      B: mergeTeam(prev?.teams?.B, next?.teams?.B),
    },
    // ✅ giữ isBreak nếu BE không bắn mới
    isBreak: next?.isBreak != null ? next.isBreak : (prev?.isBreak ?? null),
  };
};

const firstDefined = (...vals) => {
  for (const v of vals) if (v !== null && v !== undefined && v !== "") return v;
  return undefined;
};
const parseQPBool = (raw) => {
  if (raw == null) return undefined;
  const s = String(raw).toLowerCase();
  if (s === "0" || s === "false" || s === "off" || s === "no") return false;
  return true;
};

const teamNameFull = (team, eventType = "double", displayMode = "nickname") => {
  return getTournamentTeamName(team, eventType, displayMode, {
    fallback: readStr(team?.name, "—"),
  }); /*
  if (Array.isArray(team?.players) && team.players.length) {
    const nicks = team.players.map(preferNick).filter(Boolean);
    if (nicks.length) return nicks.join(" & ");
  }
  return readStr(team?.name, "—");
*/
};

const sideKeyOf = (side) => (String(side).toUpperCase() === "B" ? "B" : "A");

const idTextOf = (value) => {
  if (!value) return "";
  if (typeof value === "object") {
    return readStr(value.id, value._id, value.matchId, value.value);
  }
  return readStr(value);
};

const seedForSide = (match, side) => {
  const key = sideKeyOf(side);
  return key === "B"
    ? match?.seedB || match?.seeds?.B || null
    : match?.seedA || match?.seeds?.A || null;
};

const previousForSide = (match, side) =>
  sideKeyOf(side) === "B" ? match?.previousB : match?.previousA;

const isDependentSeed = (seed) => {
  const type = readStr(seed?.type).toLowerCase();
  return [
    "stagematchwinner",
    "stagematchloser",
    "matchwinner",
    "matchloser",
  ].includes(type);
};

const wantsLoserSeed = (seed, currentName) => {
  const type = readStr(seed?.type).toLowerCase();
  return (
    type === "stagematchloser" ||
    type === "matchloser" ||
    /^L\s*-/i.test(readStr(currentName))
  );
};

const statusTextOf = (match) => readStr(match?.status).toLowerCase();

const sourceSideForSeed = (source, seed, currentName) => {
  if (statusTextOf(source) !== "finished") return "";
  const winner = String(source?.winner || "").toUpperCase();
  if (winner !== "A" && winner !== "B") return "";
  if (!wantsLoserSeed(seed, currentName)) return winner;
  return winner === "A" ? "B" : "A";
};

const teamDisplayNameFromMatch = (
  match,
  side,
  fallbackEventType,
  fallbackMode,
) => {
  const key = sideKeyOf(side);
  const eventType = match?.tournament?.eventType || fallbackEventType;
  const displayMode = match?.tournament?.nameDisplayMode || fallbackMode;
  return teamNameFull(match?.teams?.[key], eventType, displayMode);
};

const needsSeedHydration = (match, side, currentName) => {
  const previousId = idTextOf(previousForSide(match, side));
  if (!previousId) return false;
  if (isReferenceSideName(currentName) || isPlaceholderName(currentName)) {
    return true;
  }
  return isDependentSeed(seedForSide(match, side)) && !readStr(currentName);
};

const needsTournamentContextHydration = (match, side, currentName) =>
  isReferenceSideName(currentName) ||
  isPlaceholderName(currentName) ||
  (isDependentSeed(seedForSide(match, side)) && !readStr(currentName));

const matchIdTextOf = (match) => idTextOf(match?._id || match?.id || match);

const normalizeMatchRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const extractDisplayCodeText = (value) => {
  const text = readStr(value)
    .replace(/^[WL]\s*-\s*/i, "")
    .toUpperCase();
  const match = text.match(/V\d+(?:-[A-Z0-9]+)?(?:-NT)?-T\d+/);
  return match?.[0] || "";
};

const buildMatchIndex = (matches) => {
  const byId = new Map();
  const byDisplayCode = new Map();
  const byBracketRoundOrder = new Map();
  const byStageRoundOrder = new Map();

  const addDisplayCode = (match, value) => {
    const code = extractDisplayCodeText(value);
    if (code) byDisplayCode.set(code, match);
  };

  (matches || []).forEach((match) => {
    const id = matchIdTextOf(match);
    if (id) byId.set(id, match);

    addDisplayCode(match, match?.displayCode);
    addDisplayCode(match, match?.codeResolved);
    addDisplayCode(match, match?.code);
    addDisplayCode(match, match?.roundCode);
    addDisplayCode(match, match?.matchCode);
    addDisplayCode(match, match?.slotCode);
    addDisplayCode(match, match?.bracketCode);
    addDisplayCode(match, match?.labelKey);
    addDisplayCode(match, match?.meta?.code);
    addDisplayCode(match, match?.meta?.label);

    const globalRound = numberOrNull(match?.globalRound);
    const order = numberOrNull(match?.order);
    if (globalRound != null && order != null) {
      addDisplayCode(match, `V${globalRound}-T${order + 1}`);
    }

    const bracketId = idTextOf(match?.bracket?._id, match?.bracket);
    const round = numberOrNull(match?.round);
    if (bracketId && round != null && order != null) {
      byBracketRoundOrder.set(`${bracketId}:${round}:${order}`, match);
    }

    const stage = numberOrNull(match?.bracket?.stage ?? match?.stage);
    if (stage != null && round != null && order != null) {
      byStageRoundOrder.set(`${stage}:${round}:${order}`, match);
    }
  });

  byId.byDisplayCode = byDisplayCode;
  byId.byBracketRoundOrder = byBracketRoundOrder;
  byId.byStageRoundOrder = byStageRoundOrder;
  return byId;
};

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const seedRefMatchId = (seed) =>
  idTextOf(
    seed?.ref?.matchId,
    seed?.ref?.match,
    seed?.ref?.sourceMatchId,
    seed?.ref?.sourceMatch,
    seed?.ref?.previousMatchId,
    seed?.ref?.previousMatch,
    seed?.matchId,
    seed?.sourceMatchId,
  );

const sameBracketOrStage = (match, owner, seed) => {
  const seedBracket = idTextOf(seed?.ref?.bracket, seed?.ref?.bracketId);
  const ownerBracket = idTextOf(owner?.bracket?._id, owner?.bracket);
  const matchBracket = idTextOf(match?.bracket?._id, match?.bracket);
  if (seedBracket && matchBracket) return seedBracket === matchBracket;
  if (ownerBracket && matchBracket) return ownerBracket === matchBracket;

  const seedStage = numberOrNull(seed?.ref?.stageIndex ?? seed?.ref?.stage);
  const ownerStage = numberOrNull(owner?.bracket?.stage ?? owner?.stage);
  const matchStage = numberOrNull(match?.bracket?.stage ?? match?.stage);
  if (seedStage != null && matchStage != null) return seedStage === matchStage;
  if (ownerStage != null && matchStage != null) return ownerStage === matchStage;
  return true;
};

const matchOrderMatchesRef = (matchOrder, refOrder) => {
  if (matchOrder == null || refOrder == null) return false;
  return matchOrder === refOrder || matchOrder === refOrder + 1;
};

const findSourceMatchFromSeedInList = (owner, seed, matchIndex, matches) => {
  if (!isDependentSeed(seed)) return null;

  const refId = seedRefMatchId(seed);
  if (refId) {
    const byRef = matchIndex?.get(refId);
    if (byRef) return byRef;
  }

  const labelCode = extractDisplayCodeText(seed?.label);
  if (labelCode) {
    const labelHit = matchIndex?.byDisplayCode?.get(labelCode);
    if (labelHit) return labelHit;
  }

  const refRound = numberOrNull(seed?.ref?.round);
  const refOrder = numberOrNull(seed?.ref?.order);
  if (refRound == null || refOrder == null) return null;

  const stageNum = numberOrNull(seed?.ref?.stageIndex ?? seed?.ref?.stage);
  if (stageNum != null) {
    const stageHit = matchIndex?.byStageRoundOrder?.get(
      `${stageNum}:${refRound}:${refOrder}`,
    );
    if (stageHit) return stageHit;
  }

  const bracketId = idTextOf(owner?.bracket?._id, owner?.bracket);
  if (bracketId) {
    const bracketHit = matchIndex?.byBracketRoundOrder?.get(
      `${bracketId}:${refRound}:${refOrder}`,
    );
    if (bracketHit) return bracketHit;
  }

  const candidates = (matches || []).filter((match) => {
    if (!sameBracketOrStage(match, owner, seed)) return false;
    const round = numberOrNull(match?.round);
    const order = numberOrNull(match?.order);
    return (
      (round === refRound || round === refRound + 1) &&
      matchOrderMatchesRef(order, refOrder)
    );
  });

  return candidates.length === 1 ? candidates[0] : null;
};

const findSourceMatchInList = (owner, side, matchIndex, matches) => {
  const previous = previousForSide(owner, side);
  const previousId = idTextOf(previous);
  if (previousId && matchIndex?.has(previousId)) return matchIndex.get(previousId);
  if (previous && typeof previous === "object" && statusTextOf(previous)) {
    return previous;
  }

  return findSourceMatchFromSeedInList(
    owner,
    seedForSide(owner, side),
    matchIndex,
    matches,
  );
};

const knockoutRoundLabel = (data) => {
  const t = (data?.bracketType || data?.bracket?.type || "").toLowerCase();
  if (!t || t === "group") return "";
  if (t === "roundelim") {
    const ord = roundElimOrdinalLabel(data);
    if (ord) return ord;
  }
  return readStr(data?.roundName, codeToRoundLabel(data?.roundCode));
};

// --- helpers cho roundElim
const ordFromSize = (size) => {
  const s = Number(size);
  if (!Number.isFinite(s) || s <= 0) return null;
  const lg = Math.log2(s);
  return Number.isFinite(lg) ? lg : null;
};

const inferMaxRounds = (data) => {
  const mr = Number(data?.bracket?.meta?.maxRounds);
  if (Number.isFinite(mr) && mr > 0) return mr;

  const m = Number(data?.bracket?.meta?.expectedFirstRoundMatches);
  if (Number.isFinite(m) && m > 0) {
    const drawSize = m * 2;
    const lg = Math.log2(drawSize);
    if (Number.isFinite(lg) && lg > 0) return lg;
  }

  const ds = Number(data?.bracket?.config?.roundElim?.drawSize);
  if (Number.isFinite(ds) && ds > 1) {
    const lg = Math.log2(ds);
    if (Number.isFinite(lg) && lg > 0) return lg;
  }
  return null;
};

const roundElimOrdinal = (data) => {
  const bt = (data?.bracketType || data?.bracket?.type || "").toLowerCase();
  if (bt !== "roundelim") return null;

  const rnRaw = data?.roundNumber ?? data?.round;
  const rn = Number(rnRaw);
  if (Number.isInteger(rn) && rn > 0) return rn;

  const size = parseRoundSize(data?.roundCode);
  const lgSize = ordFromSize(size);
  const maxR = inferMaxRounds(data);

  if (lgSize && maxR) {
    const ord = maxR - lgSize + 1;
    if (ord >= 1 && ord <= maxR) return ord;
  }
  return null;
};

const roundElimOrdinalLabel = (data) => {
  const n = roundElimOrdinal(data);
  return Number.isInteger(n) && n > 0 ? `Vòng ${n}` : "";
};

/* ======================== REPLAY helpers ======================== */
const pickLiveLog = (obj) => {
  const cands = [
    obj?.liveLog,
    obj?.livelog,
    obj?.live_log,
    obj?.logs,
    obj?.events,
    obj?.timeline,
  ];
  for (const x of cands) if (Array.isArray(x) && x.length) return x;
  return [];
};
const toMs = (t) => (t ? Date.parse(t) : NaN);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function buildSortedLog(raw, startAtMs) {
  const arr = (Array.isArray(raw) ? raw : []).filter(Boolean);
  const sorted = arr
    .filter((e) => toMs(e?.at))
    .sort((a, b) => toMs(a.at) - toMs(b.at));
  return Number.isFinite(startAtMs)
    ? sorted.filter((e) => toMs(e.at) >= startAtMs)
    : sorted;
}

function applyLiveEvent(state, ev, rules) {
  const type = String(ev?.type || "").toLowerCase();

  if (type === "serve") {
    const next = ev?.payload?.next || {};
    const side = String(next?.side || state?.serve?.side || "A").toUpperCase();
    const server = Number(next?.server ?? state?.serve?.server ?? 1) || 1;
    state.serve = { side, server };
    return state;
  }

  if (type === "point") {
    const team =
      String(ev?.payload?.team || "").toUpperCase() === "B" ? "b" : "a";
    const stepRaw = Number(ev?.payload?.step ?? 1);
    const step = Number.isFinite(stepRaw) ? stepRaw : 1;

    const gi = Number.isInteger(state.currentGame) ? state.currentGame : 0;
    const gs = Array.isArray(state.gameScores)
      ? [...state.gameScores]
      : [{ a: 0, b: 0 }];
    const cur = { ...(gs[gi] || { a: 0, b: 0 }) };

    cur[team] = Math.max(0, (Number(cur[team]) || 0) + step);
    gs[gi] = cur;

    const pts = Number(rules.pointsToWin || 11);
    const byTwo = !!rules.winByTwo;
    const aWin = gameWon(cur.a, cur.b, pts, byTwo);
    const bWin = gameWon(cur.b, cur.a, pts, byTwo);
    if (aWin || bWin) {
      const maxSets = Math.max(1, Number(rules.bestOf) || 3);
      const nextGi = gi + 1;
      if (nextGi < maxSets) {
        state.currentGame = nextGi;
        if (!gs[nextGi]) gs[nextGi] = { a: 0, b: 0 };
      }
    }

    state.gameScores = gs;
    return state;
  }
  return state;
}

function buildFramesFromFinalScores(base) {
  const finalGames = Array.isArray(base?.gameScores)
    ? base.gameScores
    : [{ a: 0, b: 0 }];
  const frames = [];

  const safeNum = (n) => (Number.isFinite(+n) ? Math.max(0, +n) : 0);
  const cloneWith = (gi, a, b) => {
    const arr = finalGames.map((g, idx) => {
      if (idx < gi) return { a: safeNum(g.a), b: safeNum(g.b) };
      if (idx === gi) return { a: safeNum(a), b: safeNum(b) };
      return { a: null, b: null };
    });
    return { currentGame: gi, gameScores: arr };
  };

  for (let i = 0; i < finalGames.length; i += 1) {
    const g = finalGames[i] || { a: 0, b: 0 };
    const A = safeNum(g.a);
    const B = safeNum(g.b);

    frames.push(cloneWith(i, 0, 0));

    let a = 0,
      b = 0;
    let turn = A >= B ? "A" : "B";
    while (a < A || b < B) {
      if (turn === "A" && a < A) a += 1;
      else if (turn === "B" && b < B) b += 1;
      frames.push(cloneWith(i, a, b));
      turn = turn === "A" ? "B" : "A";
    }

    frames.push(cloneWith(i, A, B));
    frames.push(cloneWith(i, A, B));
  }
  return frames;
}

const ClockBox = React.memo(function ClockBox({
  show = true,
  cssVarStyle,
  corner = "tl",
}) {
  const [nowMs, setNowMs] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const text = React.useMemo(
    () =>
      new Date(nowMs).toLocaleTimeString("vi-VN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [nowMs],
  );

  const pos = React.useMemo(() => {
    const isBR = String(corner).includes("b") && String(corner).includes("r");
    return { right: 16, bottom: isBR ? 132 : 16 };
  }, [corner]);

  const style = React.useMemo(
    () => ({
      position: "fixed",
      ...pos,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 12,
      background: "var(--bg)",
      color: "var(--fg)",
      boxShadow: "var(--shadow)",
      fontSize: "var(--meta)",
      zIndex: 2147483646,
      pointerEvents: "none",
      ...cssVarStyle,
    }),
    [pos, cssVarStyle],
  );

  if (!show) return null;
  return (
    <div className="ovl-clock" style={style}>
      <span style={{ opacity: 0.7 }}>🕒</span>
      <strong style={{ letterSpacing: 0.3 }}>{text}</strong>
    </div>
  );
});

import SEOHead from "../../components/SEOHead";

/* ======================== Component ======================== */
const ScoreOverlay = forwardRef(function ScoreOverlay(props, overlayRef) {
  const { t } = useLanguage();
  const socket = useSocket();
  const [q] = useSearchParams();
  const navigate = useNavigate();

  const matchId = props?.matchIdProp || q.get("matchId") || "";
  const replay = parseQPBool(q.get("replay")) === true;
  const showClock = parseQPBool(q.get("clock")) == 1;
  const replayLoop = parseQPBool(q.get("replayLoop"));
  const replayRate = Math.max(0.01, Number(q.get("replayRate") || 1));
  const replayMinMs =
    q.get("replayMinMs") != null
      ? Math.max(0, Number(q.get("replayMinMs")))
      : undefined;
  const replayMaxMs =
    q.get("replayMaxMs") != null
      ? Math.max(0, Number(q.get("replayMaxMs")))
      : undefined;
  const replayStartParam = q.get("replayStart");
  const replayStartMs = replayStartParam
    ? Number.isFinite(+replayStartParam)
      ? +replayStartParam
      : Date.parse(replayStartParam)
    : undefined;

  const stepMsQP = q.get("replayMs") || q.get("ms");
  const replayStepMs = Number.isFinite(+stepMsQP)
    ? Math.max(100, +stepMsQP)
    : 700;

  const autoNext = !replay && parseQPBool(q.get("autoNext"));

  // bật layout default khi ?default=1
  const isDefaultDesign = parseQPBool(q.get("default")) === true;

  // ✅ chỉ bật break nếu URL cho phép
  const isActiveBreakQP =
    parseQPBool(q.get("isActiveBreak")) === true || q.get("isactivebreak") == 1;

  const { data: snapRaw, refetch: refetchOverlaySnapshot } =
    useGetOverlaySnapshotQuery(matchId, {
    skip: !matchId,
    refetchOnMountOrArgChange: !replay,
    refetchOnFocus: !replay,
    refetchOnReconnect: !replay,
    pollingInterval: replay ? undefined : 3000,
  });
  const [getTournament] = useLazyGetTournamentQuery();
  const [getNextByCourt] = useLazyGetNextByCourtQuery();

  const [data, setData] = useState(null);
  const [overlayBE, setOverlayBE] = useState(null);
  const seedHydrationInFlightRef = useRef(new Set());
  const tournamentHydrationInFlightRef = useRef(new Set());
  const displayMode = getTournamentNameDisplayMode(data?.tournament);
  const eventType =
    String(
      data?.tournament?.eventType || data?.eventType || "",
    ).toLowerCase() === "single"
      ? "single"
      : "double";

  // Bật overlay extras khi &overlay=1
  const overlayEnabled =
    String(q.get("overlay") || "").trim() === "1" ||
    String(q.get("overlay") || "").toLowerCase() === "true";
  const tidFromQP = q.get("tournamentId") || q.get("tid") || undefined;
  const overlayTid = tidFromQP || data?.tournament?.id || undefined;

  // Tham số gọi API công khai (RTK Query)
  const overlayParams = useMemo(() => {
    const limit = Number.isFinite(+q.get("slimit")) ? +q.get("slimit") : 12;
    const featured = q.get("sFeatured") ?? "1"; // "1" | "0"
    const tier = q.get("sTier") || undefined; // "gold,silver"
    const tidFromQP = q.get("tournamentId") || q.get("tid") || undefined;
    const tid = tidFromQP || data?.tournament?.id || undefined;

    return {
      limit,
      featured,
      tier,
      ...(tid ? { tournamentId: tid } : {}),
    };
  }, [q, data?.tournament?.id]);

  // RTK Query: lấy webLogo + sponsors (chỉ khi overlayEnabled)
  const { data: overlayCfg } = useGetOverlayConfigQuery(overlayParams, {
    skip: !overlayEnabled || !overlayTid,
  });

  // transparent bg (OBS)
  useEffect(() => {
    const prevBodyBg = document.body.style.background;
    const root = document.getElementById("root");
    const prevRootBg = root?.style?.background;
    document.body.style.background = "transparent";
    if (root) root.style.background = "transparent";
    return () => {
      document.body.style.background = prevBodyBg;
      if (root) root.style.background = prevRootBg || "";
    };
  }, []);

  // snapshot -> data + overlay
  useEffect(() => {
    if (!snapRaw) return;
    const n = normalizePayload(snapRaw);
    const maxSets = Math.max(1, Number(n?.rules?.bestOf || 3));
    const nSeed = replay
      ? {
          ...n,
          currentGame: 0,
          gameScores: Array.from({ length: maxSets }, (_, i) =>
            i === 0 ? { a: 0, b: 0 } : { a: null, b: null },
          ),
        }
      : n;

    setData((prev) => (replay ? prev || nSeed : mergeNormalized(prev, n)));
    const snapOverlay = pickOverlay(snapRaw);
    if (snapOverlay) setOverlayBE((p) => ({ ...(p || {}), ...snapOverlay }));
  }, [snapRaw, replay]);

  useEffect(() => {
    if (!data || replay) return;

    const sides = ["A", "B"]
      .map((side) => {
        const currentName = teamDisplayNameFromMatch(
          data,
          side,
          eventType,
          displayMode,
        );
        if (!needsSeedHydration(data, side, currentName)) return null;
        const previousId = idTextOf(previousForSide(data, side));
        if (!previousId) return null;
        return {
          side,
          currentName,
          previousId,
          seed: seedForSide(data, side),
        };
      })
      .filter(Boolean);

    if (!sides.length) return;

    let cancelled = false;

    const hydrateSides = async () => {
      const patches = [];

      await Promise.all(
        sides.map(async ({ side, currentName, previousId, seed }) => {
          const key = [
            data?.matchId || matchId,
            side,
            previousId,
            readStr(seed?.type),
            currentName,
          ].join(":");

          if (seedHydrationInFlightRef.current.has(key)) return;
          seedHydrationInFlightRef.current.add(key);

          try {
            const response = await fetch(
              `/api/overlay/match/${encodeURIComponent(previousId)}`,
              { cache: "no-store" },
            );
            if (!response.ok) return;

            const raw = await response.json();
            const source = normalizePayload(raw);
            const sourceSide = sourceSideForSeed(source, seed, currentName);
            if (!sourceSide) return;

            const sourceTeam = source?.teams?.[sourceSide];
            const resolvedName = teamDisplayNameFromMatch(
              source,
              sourceSide,
              eventType,
              displayMode,
            );
            if (
              !resolvedName ||
              isPlaceholderName(resolvedName) ||
              isReferenceSideName(resolvedName)
            )
              return;

            patches.push({
              side,
              team: {
                ...sourceTeam,
                name: resolvedName,
                teamName: resolvedName,
                label: resolvedName,
              },
            });
          } catch {
            // Ignore transient overlay fetch errors; the normal poll will retry.
          } finally {
            seedHydrationInFlightRef.current.delete(key);
          }
        }),
      );

      if (cancelled || !patches.length) return;

      setData((prev) => {
        if (!prev) return prev;
        const nextTeams = { ...(prev.teams || {}) };
        let changed = false;
        patches.forEach(({ side, team }) => {
          const key = sideKeyOf(side);
          const currentName = teamDisplayNameFromMatch(
            prev,
            key,
            eventType,
            displayMode,
          );
          if (!needsSeedHydration(prev, key, currentName)) return;
          nextTeams[key] = { ...(nextTeams[key] || {}), ...team };
          changed = true;
        });
        return changed ? { ...prev, teams: nextTeams } : prev;
      });
    };

    hydrateSides();

    return () => {
      cancelled = true;
    };
  }, [data, displayMode, eventType, matchId, replay]);

  useEffect(() => {
    if (!data || replay) return;

    const unresolvedSides = ["A", "B"]
      .map((side) => {
        const currentName = teamDisplayNameFromMatch(
          data,
          side,
          eventType,
          displayMode,
        );
        if (!needsTournamentContextHydration(data, side, currentName)) {
          return null;
        }
        return { side, currentName };
      })
      .filter(Boolean);

    const tournamentId = idTextOf(data?.tournament?.id);
    if (!tournamentId || !unresolvedSides.length) return;

    const key = [
      data?.matchId || matchId,
      tournamentId,
      unresolvedSides.map((item) => `${item.side}:${item.currentName}`).join("|"),
    ].join(":");

    if (tournamentHydrationInFlightRef.current.has(key)) return;
    tournamentHydrationInFlightRef.current.add(key);

    let cancelled = false;

    const hydrateFromTournamentMatches = async () => {
      try {
        const response = await fetch(
          `/api/tournaments/${encodeURIComponent(tournamentId)}/matches?view=bracket`,
          { cache: "no-store" },
        );
        if (!response.ok) return;

        const payload = await response.json();
        const matches = normalizeMatchRows(payload);
        const matchIndex = buildMatchIndex(matches);
        const current =
          matchIndex.get(idTextOf(data?.matchId)) ||
          matchIndex.get(idTextOf(matchId)) ||
          data;

        const patches = [];

        unresolvedSides.forEach(({ side, currentName }) => {
          const owner = {
            ...data,
            ...current,
            tournament: data?.tournament || current?.tournament,
            seedA: current?.seedA ?? data?.seedA,
            seedB: current?.seedB ?? data?.seedB,
            seeds: current?.seeds ?? data?.seeds,
            previousA: current?.previousA ?? data?.previousA,
            previousB: current?.previousB ?? data?.previousB,
          };
          const sourceMatch = findSourceMatchInList(
            owner,
            side,
            matchIndex,
            matches,
          );
          if (!sourceMatch) return;

          const seed = seedForSide(owner, side);
          const source = normalizePayload({
            ...sourceMatch,
            tournament: data?.tournament || sourceMatch?.tournament,
          });
          const sourceSide = sourceSideForSeed(source, seed, currentName);
          if (!sourceSide) return;

          const sourceTeam = source?.teams?.[sourceSide];
          const resolvedName = teamDisplayNameFromMatch(
            source,
            sourceSide,
            eventType,
            displayMode,
          );
          if (
            !resolvedName ||
            isPlaceholderName(resolvedName) ||
            isReferenceSideName(resolvedName)
          )
            return;

          patches.push({
            side,
            team: {
              ...sourceTeam,
              name: resolvedName,
              teamName: resolvedName,
              label: resolvedName,
            },
          });
        });

        if (cancelled || !patches.length) return;

        setData((prev) => {
          if (!prev) return prev;
          const nextTeams = { ...(prev.teams || {}) };
          let changed = false;
          patches.forEach(({ side, team }) => {
            const key = sideKeyOf(side);
            const currentName = teamDisplayNameFromMatch(
              prev,
              key,
              eventType,
              displayMode,
            );
            if (!needsTournamentContextHydration(prev, key, currentName)) return;
            nextTeams[key] = { ...(nextTeams[key] || {}), ...team };
            changed = true;
          });
          return changed ? { ...prev, teams: nextTeams } : prev;
        });
      } catch {
        // The normal overlay polling still keeps the score current.
      } finally {
        tournamentHydrationInFlightRef.current.delete(key);
      }
    };

    hydrateFromTournamentMatches();

    return () => {
      cancelled = true;
      tournamentHydrationInFlightRef.current.delete(key);
    };
  }, [data, displayMode, eventType, matchId, replay]);

  // fetch tournament overlay + name/image
  useEffect(() => {
    const tId = data?.tournament?.id;
    if (!tId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getTournament(tId).unwrap();
        if (cancelled) return;

        const tourOverlay = pickOverlay(detail);
        if (tourOverlay)
          setOverlayBE((p) => ({ ...(p || {}), ...tourOverlay }));

        setData((p) => {
          const cur = p || {};
          return mergeNormalized(cur, {
            tournament: {
              id: cur?.tournament?.id ?? detail?._id ?? detail?.id ?? null,
              name: detail?.name,
              image: detail?.image,
              eventType: detail?.eventType || cur?.tournament?.eventType,
              nameDisplayMode:
                detail?.nameDisplayMode || cur?.tournament?.nameDisplayMode,
            },
          });
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.tournament?.id, getTournament]);

  // socket live updates (merge) — disabled when replay
  useEffect(() => {
    if (!matchId || !socket || replay) return;
    const requestSnapshot = () => {
      socket.emit?.("match:snapshot:request", { matchId });
      if (typeof refetchOverlaySnapshot === "function") {
        refetchOverlaySnapshot();
      }
    };

    const isForThisMatch = (payload) => {
      const got = getMatchPayloadId(payload);
      return Boolean(got) && String(got) === String(matchId);
    };

    const hasOwn = (obj, key) =>
      obj && Object.prototype.hasOwnProperty.call(obj, key);

    const hydratePatchSource = (prev, dto) => {
      if (!prev || !dto || typeof dto !== "object") return dto;
      return {
        ...prev,
        ...dto,
        tournament: hasOwn(dto, "tournament") ? dto.tournament : prev.tournament,
        teams: hasOwn(dto, "teams") ? dto.teams : prev.teams,
        pairA: hasOwn(dto, "pairA") ? dto.pairA : prev.pairA,
        pairB: hasOwn(dto, "pairB") ? dto.pairB : prev.pairB,
        seedA: hasOwn(dto, "seedA") ? dto.seedA : prev.seedA,
        seedB: hasOwn(dto, "seedB") ? dto.seedB : prev.seedB,
        seeds: hasOwn(dto, "seeds") ? dto.seeds : prev.seeds,
        previousA: hasOwn(dto, "previousA") ? dto.previousA : prev.previousA,
        previousB: hasOwn(dto, "previousB") ? dto.previousB : prev.previousB,
        rules: hasOwn(dto, "rules") ? dto.rules : prev.rules,
        gameScores: hasOwn(dto, "gameScores") ? dto.gameScores : prev.gameScores,
        currentGame: hasOwn(dto, "currentGame")
          ? dto.currentGame
          : prev.currentGame,
        status: hasOwn(dto, "status") ? dto.status : prev.status,
        winner: hasOwn(dto, "winner") ? dto.winner : prev.winner,
        liveVersion: hasOwn(dto, "liveVersion")
          ? dto.liveVersion
          : prev.liveVersion,
        version: hasOwn(dto, "version") ? dto.version : prev.version,
        updatedAt: hasOwn(dto, "updatedAt") ? dto.updatedAt : prev.updatedAt,
      };
    };

    const applyDto = (dto, { patch = false } = {}) => {
      if (!dto) return;
      setData((prev) => {
        const source = patch ? hydratePatchSource(prev, dto) : dto;
        const n = normalizePayload(source);
        return mergeNormalized(prev, n);
      });
      const o = pickOverlay(dto);
      if (o) setOverlayBE((p) => ({ ...(p || {}), ...o }));
    };

    const onSnapshot = (dto) => {
      if (!isForThisMatch(dto)) return;
      applyDto(extractMatchPayload(dto));
    };
    const onUpdate = (payload) => {
      if (!isForThisMatch(payload)) return;
      if (isLightweightMatchPayload(payload)) {
        requestSnapshot();
        return;
      }
      applyDto(extractMatchPayload(payload));
    };
    const onPatched = (payload) => {
      if (!isForThisMatch(payload)) return;
      const patch = extractMatchPatchPayload(payload);
      if (!patch) {
        requestSnapshot();
        return;
      }
      applyDto(patch, { patch: true });
    };
    const onConnect = () => {
      socket.emit("match:join", { matchId });
      requestSnapshot();
    };

    socket.emit("match:join", { matchId });
    requestSnapshot();
    socket.on("connect", onConnect);
    socket.on("match:snapshot", onSnapshot);
    socket.on("match:update", onUpdate);
    socket.on("score:updated", onUpdate);
    socket.on("score:added", onUpdate);
    socket.on("score:undone", onUpdate);
    socket.on("score:reset", onUpdate);
    socket.on("match:started", onUpdate);
    socket.on("match:finished", onUpdate);
    socket.on("match:forfeited", onUpdate);
    socket.on("status:updated", onUpdate);
    socket.on("winner:updated", onUpdate);
    socket.on("match:patched", onPatched);
    socket.on("score:patched", onPatched);
    socket.on("video:set", onPatched);
    socket.on("stream:updated", onPatched);
    socket.on("match:teamsUpdated", onPatched);
    return () => {
      socket.emit("match:leave", { matchId });
      socket.off("connect", onConnect);
      socket.off("match:snapshot", onSnapshot);
      socket.off("match:update", onUpdate);
      socket.off("score:updated", onUpdate);
      socket.off("score:added", onUpdate);
      socket.off("score:undone", onUpdate);
      socket.off("score:reset", onUpdate);
      socket.off("match:started", onUpdate);
      socket.off("match:finished", onUpdate);
      socket.off("match:forfeited", onUpdate);
      socket.off("status:updated", onUpdate);
      socket.off("winner:updated", onUpdate);
      socket.off("match:patched", onPatched);
      socket.off("score:patched", onPatched);
      socket.off("video:set", onPatched);
      socket.off("stream:updated", onPatched);
      socket.off("match:teamsUpdated", onPatched);
    };
  }, [matchId, socket, replay, refetchOverlaySnapshot]);

  /* ---------- Merge: BE overlay > QP > default ---------- */
  const effective = useMemo(() => {
    const theme = String(
      firstDefined(overlayBE?.theme, q.get("theme"), "dark"),
    ).toLowerCase();

    const size = String(
      firstDefined(overlayBE?.size, q.get("size") || "md", "md"),
    ).toLowerCase();

    const accentA = firstDefined(
      overlayBE?.accentA,
      q.get("accentA") && decodeURIComponent(q.get("accentA")),
      "#25C2A0",
    );
    const accentB = firstDefined(
      overlayBE?.accentB,
      q.get("accentB") && decodeURIComponent(q.get("accentB")),
      "#4F46E5",
    );

    const corner = String(
      firstDefined(overlayBE?.corner, q.get("corner"), "tl"),
    ).toLowerCase();

    const rounded = Number(
      firstDefined(overlayBE?.rounded, q.get("rounded"), 18),
    );
    const shadow = firstDefined(
      overlayBE?.shadow,
      parseQPBool(q.get("shadow")),
      true,
    );
    const showSets = firstDefined(
      overlayBE?.showSets,
      parseQPBool(q.get("showSets")),
      true,
    );

    const fontFamily = firstDefined(
      overlayBE?.fontFamily,
      q.get("font"),
      'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
    );

    const nameScale =
      Number(firstDefined(overlayBE?.nameScale, q.get("nameScale"), 1)) || 1;
    const scoreScale =
      Number(firstDefined(overlayBE?.scoreScale, q.get("scoreScale"), 1)) || 1;

    const logoUrl = props?.disableLogo
      ? ""
      : firstDefined(
          overlayBE?.logoUrl,
          q.get("logo"),
          (typeof window !== "undefined" && data?.tournament?.image) || "",
        );

    // Logo website (top-right). Cho phép override qua ?webLogo=..., fallback RTK Query
    const webLogoUrl = firstDefined(
      q.get("webLogo"),
      q.get("webLogoUrl"),
      overlayBE?.webLogoUrl,
      overlayCfg?.webLogoUrl,
      "",
    );

    const customCss = overlayBE?.customCss || "";

    return {
      theme,
      size,
      accentA,
      accentB,
      corner,
      rounded,
      shadow,
      showSets,
      fontFamily,
      nameScale,
      scoreScale,
      logoUrl,
      customCss,
      webLogoUrl,
    };
  }, [
    overlayBE,
    q,
    data?.tournament?.image,
    overlayCfg?.webLogoUrl,
    props?.disableLogo,
  ]);

  /* ---------- CSS variables (inline) ---------- */
  const cssVarStyle = useMemo(() => {
    const baseName =
      effective.size === "lg" ? 18 : effective.size === "sm" ? 14 : 16;
    const baseServe =
      effective.size === "lg" ? 12 : effective.size === "sm" ? 10 : 11;
    const baseScore =
      effective.size === "lg" ? 28 : effective.size === "sm" ? 20 : 24;
    const baseMeta =
      effective.size === "lg" ? 12 : effective.size === "sm" ? 10 : 11;
    const baseBadge =
      effective.size === "lg" ? 10 : effective.size === "sm" ? 9 : 10;
    const baseTable =
      effective.size === "lg" ? 12 : effective.size === "sm" ? 10 : 11;
    const baseCell =
      effective.size === "lg" ? 26 : effective.size === "sm" ? 20 : 22;

    // chiều cao logo sponsor theo size
    const sponsorH =
      effective.size === "lg" ? 34 : effective.size === "sm" ? 24 : 32;
    const webLogoH =
      effective.size === "lg" ? 32 : effective.size === "sm" ? 22 : 40;

    return {
      "--accent-a": effective.accentA,
      "--accent-b": effective.accentB,
      "--bg": effective.theme === "light" ? "#ffffffcc" : "#0b0f14cc",
      "--fg": effective.theme === "light" ? "#0b0f14" : "#E6EDF3",
      "--muted": effective.theme === "light" ? "#5c6773" : "#9AA4AF",
      "--radius": `${effective.rounded}px`,
      "--pad":
        effective.size === "lg"
          ? "14px 16px"
          : effective.size === "sm"
            ? "8px 10px"
            : "12px 14px",
      "--minw":
        effective.size === "lg"
          ? "380px"
          : effective.size === "sm"
            ? "260px"
            : "320px",
      "--name": `${Math.round(baseName * effective.nameScale)}px`,
      "--serve": `${baseServe}px`,
      "--score": `${Math.round(baseScore * effective.scoreScale)}px`,
      "--meta": `${baseMeta}px`,
      "--badge": `${baseBadge}px`,
      "--shadow": effective.shadow ? "0 8px 24px rgba(0,0,0,.25)" : "none",
      "--table": `${baseTable}px`,
      "--table-cell": `${baseCell}px`,
      "--sponsor-h": `${sponsorH}px`,
      "--weblogo-h": `${webLogoH}px`,
    };
  }, [effective]);

  /* ---------- Gate hiển thị ---------- */
  const ready = !!(data || snapRaw);

  /* ---------- Data hiển thị ---------- */
  const tourName = data?.tournament?.name || "";
  const rawStatus = (data?.status || "").toUpperCase();
  const nameA =
    teamNameFull(data?.teams?.A, eventType, displayMode) || "Team A";
  const nameB =
    teamNameFull(data?.teams?.B, eventType, displayMode) || "Team B";

  const gi = Number.isInteger(data?.currentGame) ? data.currentGame : 0;
  const cur = (data?.gameScores || [])[gi] || { a: 0, b: 0 };
  const scoreA = smax(cur.a);
  const scoreB = smax(cur.b);

  const rules = {
    bestOf: Number(data?.rules?.bestOf ?? 3),
    pointsToWin: Number(data?.rules?.pointsToWin ?? 11),
    winByTwo: Boolean(data?.rules?.winByTwo ?? true),
  };
  const maxSets = Math.max(1, Number(rules.bestOf) || 3);

  const setSummary = useMemo(() => {
    const getWinner = (g) => {
      if (!g) return "";
      if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo))
        return "A";
      if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
        return "B";
      return "";
    };

    return Array.from({ length: maxSets }).map((_, i) => {
      const g = (data?.gameScores || [])[i];
      return {
        index: i + 1,
        a: Number.isFinite(+g?.a) ? +g.a : null,
        b: Number.isFinite(+g?.b) ? +g.b : null,
        winner: getWinner(g),
      };
    });
  }, [data?.gameScores, maxSets, rules.pointsToWin, rules.winByTwo]);

  const serveSide =
    (data?.serve?.side || "A").toUpperCase() === "B" ? "B" : "A";
  const serveCount = Math.max(
    1,
    Math.min(
      2,
      Number(data?.serve?.playerIndex ?? data?.serve?.server ?? 1) || 1,
    ),
  );

  const roundLabel = knockoutRoundLabel(data);
  const phaseText = phaseLabelFromData(data);

  const wrapStyle = {
    position: "fixed",
    ...(effective.corner.includes("t") ? { top: 16 } : { bottom: 16 }),
    ...(effective.corner.includes("l") ? { left: 16 } : { right: 16 }),
    zIndex: 2147483647,
  };

  /* ---------- Auto-next theo sân khi FT ---------- */
  const pollRef = useRef(null);
  useEffect(() => {
    if (!autoNext) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    const finished = String(rawStatus) === "FINISHED";
    const cid = data?.court?.id || data?.courtId || null;
    const afterId = data?.matchId || matchId || null;
    if (!finished || !cid || !afterId) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;

    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await getNextByCourt({
          courtId: cid,
          after: afterId,
        }).unwrap();
        const nextId =
          next?.matchId || next?._id || next?.data?.matchId || next?.data?._id;

        if (nextId && nextId !== afterId) {
          clearInterval(pollRef.current);
          pollRef.current = null;

          const params = new URLSearchParams(window.location.search);
          params.set("matchId", nextId);
          params.set("autoNext", "1");
          navigate(
            {
              pathname: window.location.pathname,
              search: `?${params.toString()}`,
            },
            { replace: true },
          );
        }
      } catch {
        // ignore auto-next navigation failures
      } finally {
        inFlight = false;
      }
    };
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [
    autoNext,
    rawStatus,
    data?.court?.id,
    data?.courtId,
    data?.matchId,
    matchId,
    getNextByCourt,
    navigate,
  ]);

  /* ---------- REPLAY driver ---------- */
  const replayTimerRef = useRef(null);
  const replayIndexRef = useRef(0);

  useEffect(() => {
    if (!replay || !snapRaw) {
      if (replayTimerRef.current) {
        clearTimeout(replayTimerRef.current);
        replayTimerRef.current = null;
      }
      return;
    }
    if (replayTimerRef.current) {
      clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    replayIndexRef.current = 0;

    let sim = normalizePayload(snapRaw);
    const rulesLocal = {
      bestOf: Number(sim?.rules?.bestOf ?? 3),
      pointsToWin: Number(sim?.rules?.pointsToWin ?? 11),
      winByTwo: Boolean(sim?.rules?.winByTwo ?? true),
    };

    const maxSetsLocal = Math.max(1, Number(rulesLocal.bestOf) || 3);
    sim = mergeNormalized(sim, {
      currentGame: 0,
      gameScores: Array.from({ length: maxSetsLocal }, (_, i) =>
        i === 0 ? { a: 0, b: 0 } : { a: null, b: null },
      ),
    });

    setData((prev) => mergeNormalized(prev || {}, sim));

    const rawLog = pickLiveLog(sim) || pickLiveLog(snapRaw);
    const log = buildSortedLog(rawLog, replayStartMs);

    if (!log.length) {
      const frames = buildFramesFromFinalScores(sim);
      let i = 0;
      const tick = () => {
        const patch = frames[i];
        setData((prev) => mergeNormalized(prev || sim, patch));
        i += 1;
        if (i >= frames.length) {
          if (replayLoop) i = 0;
          else return;
        }
        replayTimerRef.current = setTimeout(tick, replayStepMs);
      };
      replayTimerRef.current = setTimeout(tick, Math.max(100, replayStepMs));
      return () => {
        if (replayTimerRef.current) {
          clearTimeout(replayTimerRef.current);
          replayTimerRef.current = null;
        }
      };
    }

    const step = () => {
      const i = replayIndexRef.current;
      if (i >= log.length) {
        if (replayLoop) {
          replayIndexRef.current = 0;
          sim = normalizePayload(snapRaw);
        } else {
          replayTimerRef.current = null;
          return;
        }
      }

      const ev = log[replayIndexRef.current];
      sim = applyLiveEvent({ ...(sim || {}) }, ev, rulesLocal);
      setData((prev) => mergeNormalized(prev || {}, sim));

      const j = replayIndexRef.current + 1;
      let wait = 0;
      if (j < log.length) {
        const t1 = toMs(log[j].at) || 0;
        const t0 = toMs(ev.at) || 0;
        const realDelta = Math.max(0, t1 - t0);
        wait = realDelta / replayRate;

        if (replayMinMs != null || replayMaxMs != null) {
          wait = clamp(
            wait,
            replayMinMs != null ? replayMinMs : 0,
            replayMaxMs != null ? replayMaxMs : Number.MAX_SAFE_INTEGER,
          );
        }
      }
      replayIndexRef.current = j;
      replayTimerRef.current = setTimeout(step, Math.max(0, wait));
    };

    const firstAt = toMs(log[0]?.at);
    const startAt = Number.isFinite(replayStartMs) ? replayStartMs : firstAt;
    let initialWait = 0;
    if (Number.isFinite(firstAt) && Number.isFinite(startAt)) {
      initialWait = Math.max(0, (firstAt - startAt) / replayRate);
      if (replayMinMs != null || replayMaxMs != null) {
        initialWait = clamp(
          initialWait,
          replayMinMs != null ? replayMinMs : 0,
          replayMaxMs != null ? replayMaxMs : Number.MAX_SAFE_INTEGER,
        );
      }
    }
    replayTimerRef.current = setTimeout(step, initialWait);

    return () => {
      if (replayTimerRef.current) {
        clearTimeout(replayTimerRef.current);
        replayTimerRef.current = null;
      }
    };
  }, [
    replay,
    replayLoop,
    replayRate,
    replayMinMs,
    replayMaxMs,
    replayStartMs,
    replayStepMs,
    snapRaw,
  ]);

  /* ---------- NEW: scale-score (transform scale) ---------- */
  const scaleScoreParam = q.get("scale-score");
  const scaleScore = useMemo(() => {
    const hasParam =
      typeof q.has === "function"
        ? q.has("scale-score")
        : scaleScoreParam != null;
    if (!hasParam) return 1; // mặc định 1 khi KHÔNG có param
    const n = Number(scaleScoreParam);
    return Number.isFinite(n) ? clamp(n, 0.25, 4) : 1; // có param nhưng sai -> 1
  }, [q, scaleScoreParam]);

  const scaleOrigin = useMemo(() => {
    const c = String(effective.corner || "tl");
    const vert = c.includes("t") ? "top" : "bottom";
    const hori = c.includes("l") ? "left" : "right";
    return `${vert} ${hori}`;
  }, [effective.corner]);

  const scaleWrapStyle = useMemo(
    () => ({
      transform: `scale(${scaleScore})`,
      transformOrigin: scaleOrigin,
      willChange: "transform",
    }),
    [scaleScore, scaleOrigin],
  );

  /* ---------- SPONSORS (BOTTOM-LEFT, fixed) — overlay=1, chỉ lấy s.logoUrl ---------- */
  const sponsorLogos = useMemo(() => {
    return Array.isArray(overlayCfg?.sponsors)
      ? overlayCfg.sponsors
          .map((s) => (s?.logoUrl ? toHttpsIfNotLocalhost(s.logoUrl) : ""))
          .filter(Boolean)
      : [];
  }, [overlayCfg]);

  if (!ready) return null;

  /* ---------- TÍNH CỜ BREAK ---------- */
  const isBreakFromData =
    data?.isBreak?.active === true || data?.isBreak?.isActive === true;

  // ✅ chỉ khi URL cho phép & API báo nghỉ thì mới show giao diện chờ
  const showBreak = isActiveBreakQP && isBreakFromData;

  /* ---------- UI ---------- */
  const tourLogoUrl = effective.logoUrl
    ? toHttpsIfNotLocalhost(effective.logoUrl)
    : "";
  const webLogoUrl = effective.webLogoUrl
    ? toHttpsIfNotLocalhost(effective.webLogoUrl)
    : "";

  // ✅ GIAO DIỆN BREAK
  if (showBreak) {
    return (
      <>
        <div
          className="ovl-wrap"
          style={wrapStyle}
          ref={overlayRef}
          data-ovl=""
          data-theme={effective.theme}
          data-size={effective.size}
          data-break="1"
        >
          <div style={scaleWrapStyle}>
            <div
              className={`ovl ovl--${effective.theme} ovl--${effective.size} ovl-card ovl-card--break`}
              style={{
                ...styles.card,
                ...cssVarStyle,
                fontFamily: effective.fontFamily,
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {tourLogoUrl ? (
                  <img
                    src={tourLogoUrl}
                    alt="logo"
                    style={{
                      height: 26,
                      width: "auto",
                      borderRadius: 6,
                      display: "block",
                    }}
                  />
                ) : null}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "var(--meta)",
                      color: "var(--muted)",
                      lineHeight: 1.1,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      overflow: "hidden",
                      maxWidth: 260,
                    }}
                  >
                    {tourName || t("scoreOverlay.fallbackTournament")}
                  </div>
                  {data?.court?.name ? (
                    <div
                      style={{
                        fontSize: "var(--meta)",
                        color: "var(--muted)",
                      }}
                    >
                      {t("scoreOverlay.courtLabel")}:{" "}
                      <strong>{data.court.name}</strong>
                    </div>
                  ) : null}
                </div>
              </div>

              <div style={{ marginTop: 2 }}>
                <div
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 700,
                    marginBottom: 4,
                  }}
                >
                  {t("scoreOverlay.breakTitle")}
                </div>
                <div style={{ fontSize: "var(--meta)", lineHeight: 1.25 }}>
                  {t("scoreOverlay.breakSubtitle")}
                </div>
                {data?.isBreak?.note ? (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: "var(--meta)",
                      opacity: 0.7,
                    }}
                  >
                    {t("scoreOverlay.breakNote", { note: data.isBreak.note })}
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {nameA || nameB ? (
                  <div
                    style={{
                      background: "rgba(148, 163, 184, .06)",
                      border: "1px solid rgba(148,163,184,.35)",
                      borderRadius: 999,
                      padding: "2px 10px 2px 2px",
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      fontSize: "var(--meta)",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 28,
                        background: "var(--accent-a)",
                        borderRadius: 999,
                        display: "block",
                      }}
                    />
                    <span style={{ fontWeight: 600, lineHeight: 1.1 }}>
                      {nameA}
                    </span>
                    <span style={{ opacity: 0.5 }}>vs</span>
                    <span style={{ fontWeight: 600, lineHeight: 1.1 }}>
                      {nameB}
                    </span>
                  </div>
                ) : null}

                {roundLabel || phaseText ? (
                  <div
                    style={{
                      ...styles.badge,
                      background:
                        effective.theme === "dark" ? "#1f2937" : "#e2e8f0",
                      color: effective.theme === "dark" ? "#fff" : "#0f172a",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    {roundLabel || phaseText}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* ❗️Break thì KHÔNG render web logo và sponsor */}
        {effective.customCss ? <style>{effective.customCss}</style> : null}
      </>
    );
  }

  // ✅ GIAO DIỆN DEFAULT=1 (theo hình PBTv)
  if (isDefaultDesign) {
    // Title trên cùng (white bar)
    const qpTitle = q.get("title");
    const topTitleBase =
      qpTitle || tourName || "Pickleball World Championships";
    const topTitle = String(topTitleBase).toUpperCase();

    // Label dưới cùng (MEN'S DOUBLES - SEMIFINALS)
    const evType = (
      data?.tournament?.eventType ||
      data?.eventType ||
      ""
    ).toLowerCase();
    let evCore = "";
    if (evType === "single") evCore = "SINGLES";
    else if (evType === "double") evCore = "DOUBLES";
    else evCore = "MATCH";

    const roundOrPhase = String(roundLabel || phaseText || "").toUpperCase();

    const bottomOverride = q.get("bottom") || q.get("bottomText");
    const bottomText = bottomOverride
      ? String(bottomOverride).toUpperCase()
      : [evCore && `PICKLEBALL ${evCore}`, roundOrPhase]
          .filter(Boolean)
          .join(" - ")
          .toUpperCase();

    // Optional: seed nếu BE có (không có thì ẩn, không crash)
    const seedA =
      data?.teams?.A?.seed ??
      data?.teams?.A?.seedNo ??
      data?.teams?.A?.seedNumber;
    const seedB =
      data?.teams?.B?.seed ??
      data?.teams?.B?.seedNo ??
      data?.teams?.B?.seedNumber;

    return (
      <>
        <div
          className="ovl-wrap ovl-wrap--default"
          style={wrapStyle}
          ref={overlayRef}
          data-ovl=""
          data-theme={effective.theme}
          data-size={effective.size}
          data-default="1"
        >
          {/* scale theo ?scale-score=... */}
          <div style={scaleWrapStyle}>
            <div
              className="ovl-default"
              style={{
                minWidth: 380,
                maxWidth: 520,
                overflow: "hidden",
                fontFamily: effective.fontFamily,
                pointerEvents: "none",
              }}
            >
              {/* Thanh trắng trên: tên giải */}
              <div
                className="ovl-default-top"
                style={{
                  background: "#ffffff",
                  color: "#000000",
                  padding: "4px 14px",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  width: "max-content",
                }}
                title={topTitle}
              >
                {topTitle}
              </div>

              {/* Khối giữa: logo giải (pbtv) + tên đội + cột điểm xanh */}
              <div
                className="ovl-default-middle"
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  background: "#000000",
                }}
              >
                {/* Logo giải bên trái (pbtv) */}
                {tourLogoUrl ? (
                  <div
                    style={{
                      paddingRight: 10,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <img
                      src={tourLogoUrl}
                      alt="tournament-logo"
                      style={{
                        height: "100%",
                        width: 56,
                        objectFit: "cover",
                        borderRadius: 4,
                        display: "block",
                      }}
                    />
                  </div>
                ) : null}

                {/* Tên đội (khối đen ở giữa) */}
                <div
                  className="ovl-default-names"
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    paddingRight: 10,
                  }}
                >
                  {/* Row A */}
                  <div
                    className="ovl-default-row ovl-default-row--a"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "4px 0",
                      gap: 6,
                      color: "#ffffff",
                    }}
                  >
                    {seedA != null && seedA !== "" && (
                      <span
                        style={{
                          fontSize: 12,
                          opacity: 0.9,
                          minWidth: 12,
                          textAlign: "right",
                        }}
                      >
                        {seedA}
                      </span>
                    )}
                    <span
                      style={{
                        flex: 1,
                        fontSize: 16,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={nameA}
                    >
                      {nameA}
                    </span>
                    {/* chấm xanh chỉ đội đang giao bóng (giống chấm xanh trong hình) */}
                    {serveSide === "A" && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "#22c55e",
                          marginLeft: 4,
                        }}
                      />
                    )}
                  </div>

                  {/* Row B */}
                  <div
                    className="ovl-default-row ovl-default-row--b"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "4px 0",
                      gap: 6,
                      color: "#ffffff",
                    }}
                  >
                    {seedB != null && seedB !== "" && (
                      <span
                        style={{
                          fontSize: 12,
                          opacity: 0.9,
                          minWidth: 12,
                          textAlign: "right",
                        }}
                      >
                        {seedB}
                      </span>
                    )}
                    <span
                      style={{
                        flex: 1,
                        fontSize: 16,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={nameB}
                    >
                      {nameB}
                    </span>
                    {serveSide === "B" && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: "#22c55e",
                          marginLeft: 4,
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Cột điểm màu xanh bên phải */}
                <div
                  className="ovl-default-scores"
                  style={{
                    minWidth: 50,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "stretch",
                    background: "rgb(65 147 93)",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: 22,
                      fontWeight: 600,
                    }}
                  >
                    {scoreA}
                  </div>
                  <div
                    style={{
                      height: 1,
                      width: "100%",
                      background: "rgba(255,255,255,.3)",
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: 22,
                      fontWeight: 600,
                    }}
                  >
                    {scoreB}
                  </div>
                </div>
              </div>

              {/* Thanh trắng dưới: info event + round */}
              {bottomText ? (
                <div
                  className="ovl-default-bottom"
                  style={{
                    background: "#ffffff",
                    color: "#000000",
                    padding: "4px 14px",
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    maxWidth: "max-content",
                  }}
                  title={bottomText}
                >
                  {bottomText}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* custom css từ BE nếu có */}
        {effective.customCss ? <style>{effective.customCss}</style> : null}

        {/* Clock nếu ?clock=1 */}
        <ClockBox
          show={showClock}
          cssVarStyle={cssVarStyle}
          corner={effective.corner}
        />
      </>
    );
  }

  // ✅ BÌNH THƯỜNG: render scoreboard như cũ
  return (
    <>
      <SEOHead title={t("scoreOverlay.seoTitle")} noIndex={true} />
      {/* CARD CHÍNH */}
      <div
        className="ovl-wrap"
        style={wrapStyle}
        ref={overlayRef}
        data-ovl=""
        data-theme={effective.theme}
        data-size={effective.size}
        data-bracket-type={data?.bracketType || ""}
        data-round-code={data?.roundCode || ""}
      >
        {/* ✅ LỚP SCALE BÊN NGOÀI CARD */}
        <div style={scaleWrapStyle}>
          <div
            className={`ovl ovl--${effective.theme} ovl--${effective.size} ovl-card`}
            data-theme={effective.theme}
            style={{
              ...styles.card,
              ...cssVarStyle,
              fontFamily: effective.fontFamily,
            }}
          >
            {/* Meta */}
            <div className="ovl-meta" style={styles.meta}>
              <span
                className="ovl-meta-left ovl-brand"
                title={tourName}
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {tourLogoUrl ? (
                  <img
                    className="ovl-logo"
                    src={tourLogoUrl}
                    alt="logo"
                    style={{
                      height: 18,
                      width: "auto",
                      display: "block",
                      borderRadius: 4,
                    }}
                  />
                ) : null}
                <span
                  className="ovl-tournament"
                  style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {tourName || "—"}
                </span>
              </span>

              {/* CHIP PHASE */}
              <span
                className="ovl-meta-right"
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                {phaseText ? (
                  <span
                    className="ovl-phase chip"
                    style={{ ...styles.badge, ...styles.badgePhase }}
                  >
                    {phaseText}
                  </span>
                ) : null}
              </span>
            </div>

            {/* Team A */}
            <div className="ovl-row ovl-row--a" style={styles.row}>
              <div
                className="ovl-team ovl-team--a"
                style={styles.team}
                data-team="A"
              >
                <span
                  className="ovl-pill ovl-pill--a"
                  style={{ ...styles.pill, background: "var(--accent-a)" }}
                />
                <span className="ovl-name" style={styles.name} title={nameA}>
                  {nameA}
                </span>
                {serveSide === "A" && (
                  <ServeBalls count={serveCount} team="A" />
                )}
              </div>
              <div className="ovl-score ovl-score--a" style={styles.score}>
                {scoreA}
              </div>
            </div>

            {/* Team B */}
            <div className="ovl-row ovl-row--b" style={styles.row}>
              <div
                className="ovl-team ovl-team--b"
                style={styles.team}
                data-team="B"
              >
                <span
                  className="ovl-pill ovl-pill--b"
                  style={{ ...styles.pill, background: "var(--accent-b)" }}
                />
                <span className="ovl-name" style={styles.name} title={nameB}>
                  {nameB}
                </span>
                {serveSide === "B" && (
                  <ServeBalls count={serveCount} team="B" />
                )}
              </div>
              <div className="ovl-score ovl-score--b" style={styles.score}>
                {scoreB}
              </div>
            </div>

            {/* Bảng set */}
            {effective.showSets && (
              <div className="ovl-sets" style={styles.tableWrap}>
                <div className="ovl-sets-head" style={styles.tableRowHeader}>
                  <div
                    className="ovl-sets-head-gap"
                    style={{ ...styles.th, ...styles.thHidden }}
                  />
                  {setSummary.map((s, i) => (
                    <div
                      key={`h-${i}`}
                      className={`ovl-th ${i === gi ? "ovl-th--active" : ""}`}
                      style={{
                        ...styles.th,
                        ...(i === gi ? styles.thActive : null),
                      }}
                    >
                      S{i + 1}
                    </div>
                  ))}
                </div>

                <div
                  className="ovl-sets-row ovl-sets-row--a"
                  style={styles.tableRow}
                  data-team="A"
                >
                  <div
                    className="ovl-sets-label ovl-sets-label--a"
                    style={{ ...styles.tdTeam, color: "var(--muted)" }}
                  >
                    A
                  </div>
                  {setSummary.map((s, i) => {
                    const isWin = s.winner === "A";
                    const isCur = i === gi;
                    return (
                      <div
                        key={`a-${i}`}
                        className={`ovl-td ${
                          isWin ? "ovl-td--win ovl-td--a" : ""
                        } ${isCur ? "ovl-td--active" : ""}`}
                        style={{
                          ...styles.td,
                          ...(isWin
                            ? {
                                background: "var(--accent-a)",
                                color: "#fff",
                                borderColor: "transparent",
                              }
                            : isCur
                              ? styles.cellActive
                              : {}),
                        }}
                      >
                        {Number.isFinite(s.a) ? s.a : "–"}
                      </div>
                    );
                  })}
                </div>

                <div
                  className="ovl-sets-row ovl-sets-row--b"
                  style={styles.tableRow}
                  data-team="B"
                >
                  <div
                    className="ovl-sets-label ovl-sets-label--b"
                    style={{ ...styles.tdTeam, color: "var(--muted)" }}
                  >
                    B
                  </div>
                  {setSummary.map((s, i) => {
                    const isWin = s.winner === "B";
                    const isCur = i === gi;
                    return (
                      <div
                        key={`b-${i}`}
                        className={`ovl-td ${
                          isWin ? "ovl-td--win ovl-td--b" : ""
                        } ${isCur ? "ovl-td--active" : ""}`}
                        style={{
                          ...styles.td,
                          ...(isWin
                            ? {
                                background: "var(--accent-b)",
                                color: "#fff",
                                borderColor: "transparent",
                              }
                            : isCur
                              ? styles.cellActive
                              : {}),
                        }}
                      >
                        {Number.isFinite(s.b) ? s.b : "–"}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* inject customCss của BE (nếu có) */}
        {effective.customCss ? <style>{effective.customCss}</style> : null}
      </div>

      {/* WEB LOGO (TOP-RIGHT, fixed) — chỉ hiện nếu overlay=1 & có webLogoUrl */}
      {overlayEnabled && webLogoUrl ? (
        <img
          src={webLogoUrl}
          alt="web-logo"
          className="ovl-weblogo"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            height: "var(--weblogo-h)",
            width: "auto",
            display: "block",
            borderRadius: 6,
            background: "rgba(0,0,0,.0)",
            zIndex: 2147483646,
            pointerEvents: "none",
            ...cssVarStyle,
          }}
        />
      ) : null}

      {/* SPONSORS (BOTTOM-LEFT, fixed) — overlay=1, chỉ lấy s.logoUrl */}
      {overlayEnabled && sponsorLogos.length ? (
        <div
          className="ovl-sponsors"
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px",
            // borderRadius: 12,
            background: "transparent",
            // boxShadow: "var(--shadow)",
            zIndex: 2147483646,
            pointerEvents: "none",
            ...cssVarStyle,
          }}
        >
          {sponsorLogos.slice(0, overlayParams.limit || 12).map((src, idx) => (
            <img
              key={idx}
              src={src}
              alt={`sponsor-${idx}`}
              style={{
                height: "var(--sponsor-h)",
                width: "auto",
                display: "block",
                borderRadius: 0,
                filter: effective.theme === "dark" ? "brightness(1.1)" : "none",
              }}
            />
          ))}
        </div>
      ) : null}
      <ClockBox
        show={showClock}
        cssVarStyle={cssVarStyle}
        corner={effective.corner}
      />
    </>
  );
});

export default ScoreOverlay;

/* ========================== Styles ========================== */
const styles = {
  card: {
    display: "inline-flex",
    flexDirection: "column",
    gap: 6,
    background: "var(--bg)",
    color: "var(--fg)",
    backdropFilter: "blur(8px)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow)",
    padding: "var(--pad)",
    minWidth: "var(--minw)",
    fontFamily:
      'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
    pointerEvents: "none",
  },
  meta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "var(--meta)",
    color: "var(--muted)",
    paddingTop: 2,
    gap: 8,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: 12,
  },
  team: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  pill: { width: 10, height: 10, borderRadius: 999 },
  name: {
    fontWeight: 600,
    letterSpacing: 0.2,
    fontSize: "var(--name)",
    whiteSpace: "normal",
    overflow: "visible",
    textOverflow: "clip",
  },
  serve: {
    fontSize: "var(--serve)",
    color: "var(--muted)",
    border: "1px solid currentColor",
    borderRadius: 6,
    padding: "1px 6px",
    marginLeft: 6,
    display: "inline-flex",
    alignItems: "center",
  },
  ballsWrap: { display: "inline-flex", gap: 4, alignItems: "center" },
  ball: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "currentColor",
    display: "inline-block",
  },
  score: {
    fontWeight: 800,
    lineHeight: 1,
    fontSize: "var(--score)",
    minWidth: 36,
    textAlign: "right",
  },
  tableWrap: {
    display: "grid",
    gap: 4,
    fontSize: "var(--table)",
    marginTop: 4,
  },
  tableRowHeader: {
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: "minmax(var(--table-cell), auto)",
    columnGap: 4,
    alignItems: "center",
  },
  tableRow: {
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: "minmax(var(--table-cell), auto)",
    columnGap: 4,
    alignItems: "center",
  },
  th: {
    padding: "4px 6px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    textAlign: "center",
    color: "var(--muted)",
  },
  thHidden: { visibility: "hidden" },
  thActive: { borderColor: "#94a3b8", background: "#0ea5e933" },
  tdTeam: {
    padding: "4px 6px",
    borderRadius: 6,
    border: "1px solid transparent",
    textAlign: "center",
    fontWeight: 600,
  },
  td: {
    padding: "4px 6px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    textAlign: "center",
    minWidth: 24,
  },
  cellActive: { borderColor: "#94a3b8", background: "#64748b22" },
  badge: {
    fontWeight: 700,
    fontSize: "var(--badge)",
    padding: "2px 6px",
    borderRadius: 999,
    background: "#0ea5e9",
    color: "#fff",
  },
  badgeFt: { background: "#16a34a" },
  badgeLive: { background: "#ef4444" },
  badgePhase: {
    background: "#334155",
  },
};

/* ---------------- ServeBalls ---------------- */
function ServeBalls({ count = 1, team }) {
  const n = Math.max(1, Math.min(2, Number(count) || 1));
  return (
    <span
      className={`ovl-serve ${
        team ? `ovl-serve--${String(team).toLowerCase()}` : ""
      }`}
      style={styles.serve}
    >
      <span className="ovl-serve-balls" style={styles.ballsWrap}>
        {Array.from({ length: n }).map((_, i) => (
          <span key={i} className="ovl-serve-ball" style={styles.ball} />
        ))}
      </span>
    </span>
  );
}
