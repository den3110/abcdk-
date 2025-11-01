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
import { toHttpsIfNotLocalhost } from "../../utils/url";

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

const preferNick = (p) =>
  readStr(
    p?.nickname,
    p?.nickName,
    p?.nick,
    p?.shortName,
    p?.name,
    p?.fullName
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
    return `1/${denom}`;
  }
  return rc;
};

const parseRoundSize = (roundCode) => {
  if (!roundCode) return null;
  const m = String(roundCode).toUpperCase().match(/^R(\d+)$/);
  return m ? +m[1] : null;
};

const labelForRoundSize = (size) => {
  if (!size) return "";
  if (size >= 16) return `Vòng ${size} đội`;
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

const regDisplayNick = (reg, evType) => {
  if (!reg) return "—";
  if (evType === "single") return preferNick(reg?.player1) || "N/A";
  const a = preferNick(reg?.player1) || "N/A";
  const b = preferNick(reg?.player2) || "";
  return b ? `${a} & ${b}` : a;
};

function normalizePayload(p) {
  if (!p) return null;

  const eventType =
    (p?.tournament?.eventType || p?.eventType || "").toLowerCase() === "single"
      ? "single"
      : "double";

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

    const nameA = playersA.length
      ? playersA.map(preferNick).filter(Boolean).join(" & ")
      : readStr(p?.teams?.A?.name);
    const nameB = playersB.length
      ? playersB.map(preferNick).filter(Boolean).join(" & ")
      : readStr(p?.teams?.B?.name);

    teams.A = { name: nameA || "—", players: playersA };
    teams.B = { name: nameB || "—", players: playersB };
  } else {
    const a1 = p?.pairA?.player1
      ? {
          nickname: preferNick(p?.pairA?.player1),
          name: readStr(p?.pairA?.player1?.name, p?.pairA?.player1?.fullName),
        }
      : null;
    const a2 = p?.pairA?.player2
      ? {
          nickname: preferNick(p?.pairA?.player2),
          name: readStr(p?.pairA?.player2?.name, p?.pairA?.player2?.fullName),
        }
      : null;

    const b1 = p?.pairB?.player1
      ? {
          nickname: preferNick(p?.pairB?.player1),
          name: readStr(p?.pairB?.player1?.name, p?.pairB?.player1?.fullName),
        }
      : null;
    const b2 = p?.pairB?.player2
      ? {
          nickname: preferNick(p?.pairB?.player2),
          name: readStr(p?.pairB?.player2?.name, p?.pairB?.player2?.fullName),
        }
      : null;

    const listA = [a1, a2].filter(Boolean);
    const listB = [b1, b2].filter(Boolean);

    teams.A = {
      name:
        listA.map(preferNick).filter(Boolean).join(" & ") ||
        regDisplayNick(p?.pairA, eventType),
      players: listA,
    };
    teams.B = {
      name:
        listB.map(preferNick).filter(Boolean).join(" & ") ||
        regDisplayNick(p?.pairB, eventType),
      players: listB,
    };
  }

  const courtId = p?.court?.id || p?.courtId || null;
  const courtName = p?.court?.name || p?.courtName || "";

  return {
    matchId: String(p?._id || p?.matchId || ""),
    status: p?.status || "",
    winner: p?.winner || "",
    isBreak: normBreak, // ✅ luôn có dạng chuẩn hoặc null
    tournament: {
      id: p?.tournament?._id || p?.tournament?.id || p?.tournamentId || null,
      name: p?.tournament?.name || readStr(p?.tournamentName) || "",
      image: p?.tournament?.image || "",
      eventType:
        (p?.tournament?.eventType || p?.eventType || "").toLowerCase() ===
        "single"
          ? "single"
          : "double",
    },
    teams,
    rules,
    serve: p?.serve || { side: "A", server: 1 },
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
  v !== null && v !== undefined && (typeof v !== "string" || v.trim() !== "");
const keep = (prev, next) => (hasVal(next) ? next : prev);

const mergeTournament = (prev = {}, next = {}) => ({
  id: keep(prev?.id, next?.id),
  name: keep(prev?.name, next?.name),
  image: keep(prev?.image, next?.image),
  eventType: keep(prev?.eventType, next?.eventType),
});

const mergeTeam = (prev = {}, next = {}) => ({
  name: keep(prev?.name, next?.name),
  players: Array.isArray(next?.players) ? next.players : prev?.players,
});

const mergeNormalized = (prev, next) => {
  if (!prev) return next || null;
  if (!next) return prev;
  return {
    ...prev,
    ...next,
    tournament: mergeTournament(prev.tournament, next.tournament),
    teams: {
      A: mergeTeam(prev?.teams?.A, next?.teams?.A),
      B: mergeTeam(prev?.teams?.B, next?.teams?.B),
    },
    // ✅ giữ isBreak nếu BE không bắn mới
    isBreak: next?.isBreak != null ? next.isBreak : prev?.isBreak ?? null,
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

const teamNameFull = (team) => {
  if (Array.isArray(team?.players) && team.players.length) {
    const nicks = team.players.map(preferNick).filter(Boolean);
    if (nicks.length) return nicks.join(" & ");
  }
  return readStr(team?.name, "—");
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

/* ======================== Component ======================== */
const ScoreOverlay = forwardRef(function ScoreOverlay(props, overlayRef) {
  const socket = useSocket();
  const [q] = useSearchParams();
  const navigate = useNavigate();

  const matchId = props?.matchIdProp || q.get("matchId") || "";
  const replay = parseQPBool(q.get("replay")) === true;

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

  // ✅ chỉ bật break nếu URL cho phép
  const isActiveBreakQP = parseQPBool(q.get("isActiveBreak")) === true || (q.get("isactivebreak")) == 1;

  const { data: snapRaw } = useGetOverlaySnapshotQuery(matchId, {
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

  // Bật overlay extras khi &overlay=1
  const overlayEnabled =
    String(q.get("overlay") || "").trim() === "1" ||
    String(q.get("overlay") || "").toLowerCase() === "true";

  // Tham số gọi API công khai (RTK Query)
  const overlayParams = useMemo(() => {
    const limit = Number.isFinite(+q.get("sLimit")) ? +q.get("sLimit") : 12;
    const featured = q.get("sFeatured") ?? "1"; // "1" | "0"
    const tier = q.get("sTier") || undefined; // "gold,silver"
    return { limit, featured, tier };
  }, [q]);

  // RTK Query: lấy webLogo + sponsors (chỉ khi overlayEnabled)
  const { data: overlayCfg } = useGetOverlayConfigQuery(overlayParams, {
    skip: !overlayEnabled,
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
            i === 0 ? { a: 0, b: 0 } : { a: null, b: null }
          ),
        }
      : n;

    setData((prev) => (replay ? prev || nSeed : mergeNormalized(prev, n)));
    const snapOverlay = pickOverlay(snapRaw);
    if (snapOverlay) setOverlayBE((p) => ({ ...(p || {}), ...snapOverlay }));
  }, [snapRaw, replay]);

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
    socket.emit("match:join", { matchId });

    const onSnapshot = (dto) => {
      const n = normalizePayload(dto);
      setData((prev) => mergeNormalized(prev, n));
      const o = pickOverlay(dto);
      if (o) setOverlayBE((p) => ({ ...(p || {}), ...o }));
    };
    const onUpdate = (payload) => {
      const dto = payload?.data || payload;
      const n = normalizePayload(dto);
      setData((prev) => mergeNormalized(prev, n));
      const o = pickOverlay(dto);
      if (o) setOverlayBE((p) => ({ ...(p || {}), ...o }));
    };

    socket.on("match:snapshot", onSnapshot);
    socket.on("match:update", onUpdate);
    return () => {
      socket.off("match:snapshot", onSnapshot);
      socket.off("match:update", onUpdate);
    };
  }, [matchId, socket, replay]);

  /* ---------- Merge: BE overlay > QP > default ---------- */
  const effective = useMemo(() => {
    const theme = String(
      firstDefined(overlayBE?.theme, q.get("theme"), "dark")
    ).toLowerCase();

    const size = String(
      firstDefined(overlayBE?.size, q.get("size") || "md", "md")
    ).toLowerCase();

    const accentA = firstDefined(
      overlayBE?.accentA,
      q.get("accentA") && decodeURIComponent(q.get("accentA")),
      "#25C2A0"
    );
    const accentB = firstDefined(
      overlayBE?.accentB,
      q.get("accentB") && decodeURIComponent(q.get("accentB")),
      "#4F46E5"
    );

    const corner = String(
      firstDefined(overlayBE?.corner, q.get("corner"), "tl")
    ).toLowerCase();

    const rounded = Number(
      firstDefined(overlayBE?.rounded, q.get("rounded"), 18)
    );
    const shadow = firstDefined(
      overlayBE?.shadow,
      parseQPBool(q.get("shadow")),
      true
    );
    const showSets = firstDefined(
      overlayBE?.showSets,
      parseQPBool(q.get("showSets")),
      true
    );

    const fontFamily = firstDefined(
      overlayBE?.fontFamily,
      q.get("font"),
      'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial'
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
          (typeof window !== "undefined" && data?.tournament?.image) || ""
        );

    // Logo website (top-right). Cho phép override qua ?webLogo=..., fallback RTK Query
    const webLogoUrl = firstDefined(
      q.get("webLogo"),
      q.get("webLogoUrl"),
      overlayBE?.webLogoUrl,
      overlayCfg?.webLogoUrl,
      ""
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
      effective.size === "lg" ? 34 : effective.size === "sm" ? 24 : 28;
    const webLogoH =
      effective.size === "lg" ? 32 : effective.size === "sm" ? 22 : 26;

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
  const nameA = teamNameFull(data?.teams?.A) || "Team A";
  const nameB = teamNameFull(data?.teams?.B) || "Team B";

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

  const setWinner = (g) => {
    if (!g) return "";
    if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo))
      return "A";
    if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
      return "B";
    return "";
  };

  const setSummary = useMemo(() => {
    return Array.from({ length: maxSets }).map((_, i) => {
      const g = (data?.gameScores || [])[i];
      return {
        index: i + 1,
        a: Number.isFinite(+g?.a) ? +g.a : null,
        b: Number.isFinite(+g?.b) ? +g.b : null,
        winner: setWinner(g),
      };
    });
  }, [data?.gameScores, maxSets, rules.pointsToWin, rules.winByTwo]);

  const serveSide =
    (data?.serve?.side || "A").toUpperCase() === "B" ? "B" : "A";
  const serveCount = Math.max(
    1,
    Math.min(
      2,
      Number(data?.serve?.playerIndex ?? data?.serve?.server ?? 1) || 1
    )
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
            { replace: true }
          );
        }
      } catch {
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
        i === 0 ? { a: 0, b: 0 } : { a: null, b: null }
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
            replayMaxMs != null ? replayMaxMs : Number.MAX_SAFE_INTEGER
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
          replayMaxMs != null ? replayMaxMs : Number.MAX_SAFE_INTEGER
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
    [scaleScore, scaleOrigin]
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
                    {tourName || "Giải đấu"}
                  </div>
                  {data?.court?.name ? (
                    <div
                      style={{
                        fontSize: "var(--meta)",
                        color: "var(--muted)",
                      }}
                    >
                      Sân: <strong>{data.court.name}</strong>
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
                  ĐANG TẠM NGHỈ
                </div>
                <div style={{ fontSize: "var(--meta)", lineHeight: 1.25 }}>
                  Chờ trọng tài bắt đầu game tiếp theo...
                </div>
                {data?.isBreak?.note ? (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: "var(--meta)",
                      opacity: 0.7,
                    }}
                  >
                    Ghi chú: {data.isBreak.note}
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
                      display: "flex", justifyContent: "center", alignItems: "center"
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

  // ✅ BÌNH THƯỜNG: render scoreboard như cũ
  return (
    <>
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
            <div
              className="ovl-row ovl-row--a"
              style={styles.row}
            >
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
            <div
              className="ovl-row ovl-row--b"
              style={styles.row}
            >
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
            borderRadius: 12,
            background: "var(--bg)",
            boxShadow: "var(--shadow)",
            zIndex: 2147483646,
            pointerEvents: "none",
            ...cssVarStyle,
          }}
        >
          {sponsorLogos.slice(0, overlayParams.limit).map((src, idx) => (
            <img
              key={idx}
              src={src}
              alt={`sponsor-${idx}`}
              style={{
                height: "var(--sponsor-h)",
                width: "auto",
                display: "block",
                borderRadius: 8,
                filter: effective.theme === "dark" ? "brightness(1.1)" : "none",
              }}
            />
          ))}
        </div>
      ) : null}
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
