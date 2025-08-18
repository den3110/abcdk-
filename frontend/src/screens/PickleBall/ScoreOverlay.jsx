// src/overlay/ScoreOverlay.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGetOverlaySnapshotQuery } from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";

/* ---------------- utils ---------------- */
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

function codeToRoundLabel(code) {
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
}

function regDisplayName(reg, evType) {
  if (!reg) return "—";
  if (evType === "single") {
    return readStr(reg?.player1?.fullName, reg?.player1?.name, "N/A");
  }
  const a = readStr(reg?.player1?.fullName, reg?.player1?.name, "N/A");
  const b = readStr(reg?.player2?.fullName, reg?.player2?.name, "");
  return b ? `${a} & ${b}` : a;
}

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
    (p?.round_size ? `R${p.round_size}` : "");
  const roundName =
    p?.roundName || p?.round_name || codeToRoundLabel(roundCode) || "";
  const roundNumber = Number.isFinite(+p?.round) ? +p.round : undefined;

  let teams = { A: {}, B: {} };
  if (p?.teams?.A || p?.teams?.B) {
    teams.A.name = readStr(p?.teams?.A?.name);
    teams.B.name = readStr(p?.teams?.B?.name);
    teams.A.players =
      Array.isArray(p?.teams?.A?.players) && p.teams.A.players.length
        ? p.teams.A.players
        : [];
    teams.B.players =
      Array.isArray(p?.teams?.B?.players) && p.teams.B.players.length
        ? p.teams.B.players
        : [];
  } else {
    teams.A = {
      name: regDisplayName(p?.pairA, eventType),
      players: [
        p?.pairA?.player1 && {
          fullName: readStr(
            p?.pairA?.player1?.fullName,
            p?.pairA?.player1?.name
          ),
        },
        p?.pairA?.player2 && {
          fullName: readStr(
            p?.pairA?.player2?.fullName,
            p?.pairA?.player2?.name
          ),
        },
      ].filter(Boolean),
    };
    teams.B = {
      name: regDisplayName(p?.pairB, eventType),
      players: [
        p?.pairB?.player1 && {
          fullName: readStr(
            p?.pairB?.player1?.fullName,
            p?.pairB?.player1?.name
          ),
        },
        p?.pairB?.player2 && {
          fullName: readStr(
            p?.pairB?.player2?.fullName,
            p?.pairB?.player2?.name
          ),
        },
      ].filter(Boolean),
    };
  }

  return {
    matchId: String(p?._id || p?.matchId || ""),
    status: p?.status || "",
    winner: p?.winner || "",
    tournament: {
      id: p?.tournament?._id || p?.tournament?.id || p?.tournamentId || null,
      name: p?.tournament?.name || readStr(p?.tournamentName) || "",
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
  };
}

function teamNameFull(team) {
  return readStr(team?.name, "—");
}

function currentServerName(data) {
  if (!data?.serve?.side) return "";
  const side = String(data.serve.side).toUpperCase() === "B" ? "B" : "A";
  const team = data?.teams?.[side];
  if (!team) return "";

  let idx =
    Number(
      data?.serve?.playerIndex ??
        data?.serve?.server ??
        (data?.tournament?.eventType === "single" ? 1 : 1)
    ) || 1;
  if (idx >= 1) idx = idx - 1;

  const list =
    Array.isArray(team.players) && team.players.length
      ? team.players.map((p) => readStr(p?.fullName, p?.name))
      : null;

  const splitFromName = () =>
    String(team.name || "")
      .split(/\s*(?:&|\/|,| và | and )\s*/i)
      .filter(Boolean);

  const names = list && list.length ? list : splitFromName();
  if (!names || !names.length) return teamNameFull(team);

  const safeIdx =
    idx >= 0 && idx < names.length ? idx : Math.min(0, names.length - 1);
  return names[safeIdx] || names[0] || "";
}

function knockoutRoundLabel(data) {
  const t = (data?.bracketType || "").toLowerCase();
  if (!t || t === "group") return "";
  return readStr(data?.roundName, codeToRoundLabel(data?.roundCode));
}

/* ---------------- Component ---------------- */
export default function ScoreOverlay() {
  const socket = useSocket();
  const [q] = useSearchParams();
  const matchId = q.get("matchId") || "";

  const theme = (q.get("theme") || "dark").toLowerCase();
  const size = (q.get("size") || "md").toLowerCase();
  const accentA = decodeURIComponent(q.get("accentA") || "#25C2A0");
  const accentB = decodeURIComponent(q.get("accentB") || "#4F46E5");
  const corner = (q.get("corner") || "tl").toLowerCase();
  const rounded = Number(q.get("rounded") || 18);
  const shadow = q.get("shadow") !== "0";
  const showSets = q.get("showSets") !== "0";

  const { data: snapData } = useGetOverlaySnapshotQuery(matchId, {
    skip: !matchId,
    refetchOnMountOrArgChange: true,
  });

  const [data, setData] = useState(null);

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

  useEffect(() => {
    if (!snapData) return;
    setData((prev) => ({ ...(prev || {}), ...normalizePayload(snapData) }));
  }, [snapData]);

  useEffect(() => {
    if (!matchId || !socket) return;
    socket.emit("match:join", { matchId });

    const onSnapshot = (dto) => setData(normalizePayload(dto));
    const onUpdate = (payload) => {
      if (payload?.data) {
        setData((prev) => ({
          ...(prev || {}),
          ...normalizePayload(payload.data),
        }));
      }
    };

    socket.on("match:snapshot", onSnapshot);
    socket.on("match:update", onUpdate);

    return () => {
      socket.off("match:snapshot", onSnapshot);
      socket.off("match:update", onUpdate);
    };
  }, [matchId, socket]);

  const cssVars = useMemo(
    () => ({
      "--accent-a": accentA,
      "--accent-b": accentB,
      "--bg": theme === "light" ? "#ffffffcc" : "#0b0f14cc",
      "--fg": theme === "light" ? "#0b0f14" : "#E6EDF3",
      "--muted": theme === "light" ? "#5c6773" : "#9AA4AF",
      "--radius": `${rounded}px`,
      "--pad":
        size === "lg" ? "14px 16px" : size === "sm" ? "8px 10px" : "12px 14px",
      "--minw": size === "lg" ? "380px" : size === "sm" ? "260px" : "320px",
      "--name": size === "lg" ? "18px" : size === "sm" ? "14px" : "16px",
      "--serve": size === "lg" ? "12px" : size === "sm" ? "10px" : "11px",
      "--score": size === "lg" ? "28px" : size === "sm" ? "20px" : "24px",
      "--meta": size === "lg" ? "12px" : size === "sm" ? "10px" : "11px",
      "--badge": size === "lg" ? "10px" : size === "sm" ? "9px" : "10px",
      "--shadow": shadow ? "0 8px 24px rgba(0,0,0,.25)" : "none",
      "--table": size === "lg" ? "12px" : size === "sm" ? "10px" : "11px",
      "--table-cell": size === "lg" ? "26px" : size === "sm" ? "20px" : "22px",
    }),
    [accentA, accentB, theme, rounded, size, shadow]
  );

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
  const serverName = currentServerName(data);
  const roundLabel = knockoutRoundLabel(data); // rỗng nếu group

  const wrapStyle = {
    position: "fixed",
    ...(corner.includes("t") ? { top: 16 } : { bottom: 16 }),
    ...(corner.includes("l") ? { left: 16 } : { right: 16 }),
    zIndex: 2147483647,
  };

  return (
    <div style={wrapStyle}>
      <div style={styles.card} data-theme={theme}>
        {/* Meta */}
        <div style={styles.meta}>
          <span
            title={tourName}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tourName}
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

        {/* A */}
        <div style={styles.row}>
          <div style={styles.team}>
            <span style={{ ...styles.pill, background: "var(--accent-a)" }} />
            <span style={styles.name} title={nameA}>
              {nameA}
            </span>
            {serveSide === "A" && (
              <span style={styles.serve}>Giao: {serverName || nameA}</span>
            )}
          </div>
          <div style={styles.score}>{scoreA}</div>
        </div>

        {/* B */}
        <div style={styles.row}>
          <div style={styles.team}>
            <span style={{ ...styles.pill, background: "var(--accent-b)" }} />
            <span style={styles.name} title={nameB}>
              {nameB}
            </span>
            {serveSide === "B" && (
              <span style={styles.serve}>Giao: {serverName || nameB}</span>
            )}
          </div>
          <div style={styles.score}>{scoreB}</div>
        </div>

        {/* Bảng set */}
        {showSets && (
          <div style={styles.tableWrap}>
            {/* Header: có ô đầu nhưng ẩn, để giữ căn lề */}
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

            {/* Row A */}
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

            {/* Row B */}
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

      <style>{`
        [data-theme]{
          --bg: ${cssVars["--bg"]};
          --fg: ${cssVars["--fg"]};
          --muted: ${cssVars["--muted"]};
          --radius: ${cssVars["--radius"]};
          --pad: ${cssVars["--pad"]};
          --minw: ${cssVars["--minw"]};
          --name: ${cssVars["--name"]};
          --serve: ${cssVars["--serve"]};
          --score: ${cssVars["--score"]};
          --meta: ${cssVars["--meta"]};
          --badge: ${cssVars["--badge"]};
          --accent-a: ${cssVars["--accent-a"]};
          --accent-b: ${cssVars["--accent-b"]};
          --shadow: ${cssVars["--shadow"]};
          --table: ${cssVars["--table"]};
          --table-cell: ${cssVars["--table-cell"]};
        }
      `}</style>
    </div>
  );
}

/* ---------------- styles ---------------- */
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
  },
  score: {
    fontWeight: 800,
    lineHeight: 1,
    fontSize: "var(--score)",
    minWidth: 36,
    textAlign: "right",
  },

  // ----- bảng set -----
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
  // 👇 ẩn ô đầu header nhưng vẫn giữ chỗ để không lệch
  thHidden: {
    visibility: "hidden",
  },
  thActive: {
    borderColor: "#94a3b8",
    background: "#0ea5e933",
  },
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
  cellActive: {
    borderColor: "#94a3b8",
    background: "#64748b22",
  },

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
