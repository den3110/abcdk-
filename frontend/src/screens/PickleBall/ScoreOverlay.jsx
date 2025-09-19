// src/pages/overlay/ScoreOverlay.jsx
/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  // ⬇️ RTK Query hooks (giữ nguyên nếu bạn đã có)
  useGetOverlaySnapshotQuery,
  useLazyGetTournamentQuery,
  // ⬇️ NEW: lazy API để lấy trận kế tiếp theo sân (1 API duy nhất, dùng slice)
  // Endpoint gợi ý: GET /api/courts/:courtId/next?after=:matchId  → { matchId: "..." }
  useLazyGetNextByCourtQuery,
} from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";

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
    (p?.round_size ? `R${p.round_size}` : "") || p?.round;
  const roundName =
    p?.roundName || p?.round_name || codeToRoundLabel(roundCode) || "";
  const roundNumber = Number.isFinite(+p?.round) ? +p?.round : undefined;

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

  // ⬇️ Court thông tin (id & name) để auto-next
  const courtId = p?.court?.id || p?.courtId || null;
  const courtName = p?.court?.name || p?.courtName || "";

  return {
    matchId: String(p?._id || p?.matchId || ""),
    status: p?.status || "",
    winner: p?.winner || "",
    tournament: {
      id: p?.tournament?._id || p?.tournament?.id || p?.tournamentId || null,
      name: p?.tournament?.name || readStr(p?.tournamentName) || "",
      image: p?.tournament?.image || "",
      eventType,
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

// merge helpers (KHÔNG ghi đè bằng chuỗi rỗng/undefined)
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
  const t = (data?.bracketType || "").toLowerCase();
  if (!t || t === "group") return "";
  return readStr(data?.roundName, codeToRoundLabel(data?.roundCode));
};

/* ======================== Component ======================== */
export default function ScoreOverlay() {
  const socket = useSocket();
  const [q] = useSearchParams();
  const navigate = useNavigate();

  const matchId = q.get("matchId") || "";
  const autoNext = parseQPBool(q.get("autoNext")); // true khi autoNext=1|true|on

  const {
    data: snapRaw,
    isLoading: snapLoading,
    isFetching: snapFetching,
  } = useGetOverlaySnapshotQuery(matchId, {
    skip: !matchId,
    refetchOnMountOrArgChange: true,
  });
  const [getTournament] = useLazyGetTournamentQuery();

  // ⬇️ Lazy RTK Query duy nhất để lấy trận kế theo sân
  const [getNextByCourt] = useLazyGetNextByCourtQuery();

  const [data, setData] = useState(null);
  const [overlayBE, setOverlayBE] = useState(null);

  // transparent bg (dùng cho OBS)
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

  // snapshot -> data + overlay  (merge, không replace)
  useEffect(() => {
    if (!snapRaw) return;
    const n = normalizePayload(snapRaw);
    setData((prev) => mergeNormalized(prev, n));
    const snapOverlay = pickOverlay(snapRaw);
    if (snapOverlay) setOverlayBE((p) => ({ ...(p || {}), ...snapOverlay }));
  }, [snapRaw]);

  // fetch tournament overlay + name/image khi có id
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

  // socket live updates  (merge, không replace)
  useEffect(() => {
    if (!matchId || !socket) return;
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
  }, [matchId, socket]);

  /* ---------- Merge: BE overlay > QP > default ---------- */
  const effective = useMemo(() => {
    const theme = (
      (firstDefined(overlayBE?.theme, q.get("theme"), "dark") || "dark") + ""
    ).toLowerCase();
    const size = (
      (firstDefined(
        overlayBE?.size,
        (q.get("size") || "md").toLowerCase(),
        "md"
      ) || "md") + ""
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

    const corner = (
      (firstDefined(overlayBE?.corner, q.get("corner"), "tl") || "tl") + ""
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

    const logoUrl = firstDefined(
      overlayBE?.logoUrl,
      q.get("logo"),
      (typeof window !== "undefined" && data?.tournament?.image) || ""
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
    };
  }, [overlayBE, q, data?.tournament?.image]);

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
    };
  }, [effective]);

  /* ---------- Gate hiển thị ---------- */
  const apiSettled = !snapLoading && !snapFetching;
  const ready = apiSettled && !!data;

  /* ---------- Data hiển thị ---------- */
  const tourName = data?.tournament?.name || "";
  const rawStatus = (data?.status || "").toUpperCase();
  const isFinished = rawStatus === "FINISHED";
  const badgeClass = isFinished ? "ft" : rawStatus === "LIVE" ? "live" : "";

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

  const wrapStyle = {
    position: "fixed",
    ...(effective.corner.includes("t") ? { top: 16 } : { bottom: 16 }),
    ...(effective.corner.includes("l") ? { left: 16 } : { right: 16 }),
    zIndex: 2147483647,
  };

  /* ---------- Auto-next theo sân khi FT ---------- */
  const lastAutoNextFor = useRef(null);
  useEffect(() => {
    if (!autoNext) return; // không bật
    if (!data?.matchId) return;
    const finished = String(data?.status || "").toUpperCase() === "FINISHED";
    if (!finished) return;

    const cid = data?.court?.id || data?.courtId;
    if (!cid) return; // không có sân → bỏ

    // Tránh xử lý lặp cho cùng 1 match
    if (lastAutoNextFor.current === data.matchId) return;
    lastAutoNextFor.current = data.matchId;

    let cancelled = false;
    (async () => {
      try {
        const next = await getNextByCourt({
          courtId: cid,
          after: data.matchId,
        }).unwrap();
        const nextId =
          next?.matchId || next?._id || next?.data?.matchId || next?.data?._id;
        if (cancelled || !nextId || nextId === data.matchId) return;

        const params = new URLSearchParams(window.location.search);
        params.set("matchId", nextId);
        // preserve autoNext để chuỗi tiếp tục
        params.set("autoNext", "1");
        navigate(
          {
            pathname: window.location.pathname,
            search: `?${params.toString()}`,
          },
          { replace: true }
        );
      } catch {
        // không có next hoặc lỗi → bỏ qua
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    autoNext,
    data?.status,
    data?.matchId,
    data?.court?.id,
    getNextByCourt,
    navigate,
  ]);

  if (!ready) return null;

  return (
    <div style={wrapStyle} data-ovl="">
      <div
        data-theme={effective.theme}
        style={{
          ...styles.card,
          ...cssVarStyle,
          fontFamily: effective.fontFamily,
        }}
      >
        {/* Meta */}
        <div style={styles.meta}>
          <span
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
            {effective.logoUrl ? (
              <img
                src={effective.logoUrl}
                alt="logo"
                style={{
                  height: 18,
                  width: "auto",
                  display: "block",
                  borderRadius: 4,
                }}
              />
            ) : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {tourName || "—"}
            </span>
          </span>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {roundLabel ? (
              <span style={{ color: "var(--muted)" }}>Vòng {roundLabel}</span>
            ) : null}
            <span
              style={{
                ...styles.badge,
                ...(badgeClass === "ft"
                  ? styles.badgeFt
                  : badgeClass === "live"
                  ? styles.badgeLive
                  : {}),
              }}
            >
              {badgeClass === "ft" ? "FT" : rawStatus || "—"}
            </span>
          </span>
        </div>

        {/* Team A */}
        <div style={styles.row}>
          <div style={styles.team}>
            <span style={{ ...styles.pill, background: "var(--accent-a)" }} />
            <span style={styles.name} title={nameA}>
              {nameA}
            </span>
            {serveSide === "A" && <ServeBalls count={serveCount} />}
          </div>
          <div style={styles.score}>{scoreA}</div>
        </div>

        {/* Team B */}
        <div style={styles.row}>
          <div style={styles.team}>
            <span style={{ ...styles.pill, background: "var(--accent-b)" }} />
            <span style={styles.name} title={nameB}>
              {nameB}
            </span>
            {serveSide === "B" && <ServeBalls count={serveCount} />}
          </div>
          <div style={styles.score}>{scoreB}</div>
        </div>

        {/* Bảng set */}
        {effective.showSets && (
          <div style={styles.tableWrap}>
            <div style={styles.tableRowHeader}>
              <div style={{ ...styles.th, ...styles.thHidden }} />
              {setSummary.map((s, i) => (
                <div
                  key={`h-${i}`}
                  style={{
                    ...styles.th,
                    ...(i === gi ? styles.thActive : null),
                  }}
                >
                  S{i + 1}
                </div>
              ))}
            </div>

            <div style={styles.tableRow}>
              <div style={{ ...styles.tdTeam, color: "var(--muted)" }}>A</div>
              {setSummary.map((s, i) => (
                <div
                  key={`a-${i}`}
                  style={{
                    ...styles.td,
                    ...(s.winner === "A"
                      ? {
                          background: "var(--accent-a)",
                          color: "#fff",
                          borderColor: "transparent",
                        }
                      : i === gi
                      ? styles.cellActive
                      : {}),
                  }}
                >
                  {Number.isFinite(s.a) ? s.a : "–"}
                </div>
              ))}
            </div>

            <div style={styles.tableRow}>
              <div style={{ ...styles.tdTeam, color: "var(--muted)" }}>B</div>
              {setSummary.map((s, i) => (
                <div
                  key={`b-${i}`}
                  style={{
                    ...styles.td,
                    ...(s.winner === "B"
                      ? {
                          background: "var(--accent-b)",
                          color: "#fff",
                          borderColor: "transparent",
                        }
                      : i === gi
                      ? styles.cellActive
                      : {}),
                  }}
                >
                  {Number.isFinite(s.b) ? s.b : "–"}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* inject customCss của BE (nếu có) */}
      {effective.customCss ? <style>{effective.customCss}</style> : null}
    </div>
  );
}

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
};

/* ---------------- ServeBalls ---------------- */
function ServeBalls({ count = 1 }) {
  const n = Math.max(1, Math.min(2, Number(count) || 1));
  return (
    <span style={styles.serve}>
      <span style={styles.ballsWrap}>
        {Array.from({ length: n }).map((_, i) => (
          <span key={i} style={styles.ball} />
        ))}
      </span>
    </span>
  );
}
