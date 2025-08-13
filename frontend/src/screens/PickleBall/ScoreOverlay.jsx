// src/overlay/ScoreOverlay.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGetOverlaySnapshotQuery } from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";

// ---------- utils ----------
const smax = (v) => (Number.isFinite(+v) ? +v : 0);
const gameWon = (x, y, pts, byTwo) =>
  smax(x) >= smax(pts) && (byTwo ? x - y >= 2 : x - y >= 1);

function regName(reg, evType) {
  if (!reg) return "—";
  if (evType === "single") return reg?.player1?.fullName || "N/A";
  const a = reg?.player1?.fullName || "N/A";
  const b = reg?.player2?.fullName || "N/A";
  return `${a} & ${b}`;
}

/** Chuẩn hóa tên hiển thị theo eventType.
 * - single: chỉ hiện player1 (nếu có players[]) hoặc tách chuỗi theo &,/,:,“ và ”… để lấy phần đầu
 * - double: giữ nguyên
 */
function formatTeamName(team, evType) {
  if (!team) return "—";
  // Ưu tiên lấy từ cấu trúc players nếu có
  if (evType === "single") {
    if (Array.isArray(team.players) && team.players[0]?.fullName) {
      return team.players[0].fullName;
    }
    // Nếu chỉ có name là chuỗi, tách theo các dấu phổ biến
    const raw = (team.name || "").trim();
    if (!raw) return "—";
    const parts = raw
      .split(/\s*(?:&|\/|,| và | and | - )\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts[0] || raw;
  }
  // double
  return team.name || "—";
}

// Chuẩn hoá payload từ API hoặc socket DTO về cùng shape
function normalizePayload(p) {
  if (!p) return null;
  // Nếu API /overlay đã build sẵn, giữ nguyên (đã có tournament.eventType, teams.name,...)
  if (p.teams?.A?.name || p.teams?.B?.name) return p;

  // socket DTO: pairA/pairB (đã populate trong server khi match:join)
  const evType = p?.tournament?.eventType === "single" ? "single" : "double";
  const rules = {
    bestOf: Number(p?.rules?.bestOf ?? 3),
    pointsToWin: Number(p?.rules?.pointsToWin ?? 11),
    winByTwo: Boolean(p?.rules?.winByTwo ?? true),
  };
  return {
    matchId: String(p._id),
    status: p.status,
    winner: p.winner || "",
    tournament: {
      id: p?.tournament?._id || p?.tournament?.id || null,
      name: p?.tournament?.name || "",
      eventType: evType,
    },
    teams: {
      A: { name: regName(p.pairA, evType) },
      B: { name: regName(p.pairB, evType) },
    },
    rules,
    serve: p?.serve || { side: "A", server: 2 },
    currentGame: Number.isInteger(p?.currentGame) ? p.currentGame : 0,
    gameScores: Array.isArray(p?.gameScores) ? p.gameScores : [{ a: 0, b: 0 }],
  };
}

export default function ScoreOverlay() {
  const socket = useSocket();
  const [q] = useSearchParams();
  const matchId = q.get("matchId") || "";

  // UI params (tùy chỉnh qua query)
  const theme = (q.get("theme") || "dark").toLowerCase(); // dark|light
  const showSets = q.get("showSets") !== "0";
  const size = (q.get("size") || "md").toLowerCase(); // sm|md|lg
  const accentA = decodeURIComponent(q.get("accentA") || "#25C2A0");
  const accentB = decodeURIComponent(q.get("accentB") || "#4F46E5");
  const corner = (q.get("corner") || "tl").toLowerCase(); // tl|tr|bl|br
  const rounded = Number(q.get("rounded") || 18);
  const shadow = q.get("shadow") !== "0";

  // 1) RTK Query snapshot (server-side snapshot)
  const { data: snapData } = useGetOverlaySnapshotQuery(matchId, {
    skip: !matchId,
    refetchOnMountOrArgChange: true,
  });

  // 2) state overlay
  const [data, setData] = useState(null);

  // Làm nền trong suốt route này (để chèn lên livestream)
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

  // Nhận snapshot từ RTK
  useEffect(() => {
    if (!snapData) return;
    setData((prev) => ({ ...(prev || {}), ...normalizePayload(snapData) }));
  }, [snapData]);

  // Socket realtime: join phòng + nhận snapshot/update
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
      // Không disconnect ở đây vì socket do Provider quản lý
    };
  }, [matchId, socket]);

  // Derive UI vars
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
      "--minw": size === "lg" ? "360px" : size === "sm" ? "240px" : "300px",
      "--name": size === "lg" ? "18px" : size === "sm" ? "14px" : "16px",
      "--serve": size === "lg" ? "12px" : size === "sm" ? "10px" : "11px",
      "--score": size === "lg" ? "28px" : size === "sm" ? "20px" : "24px",
      "--meta": size === "lg" ? "12px" : size === "sm" ? "10px" : "11px",
      "--badge": size === "lg" ? "10px" : size === "sm" ? "9px" : "10px",
      "--shadow": shadow ? "0 8px 24px rgba(0,0,0,.25)" : "none",
    }),
    [accentA, accentB, theme, rounded, size, shadow]
  );

  const tourName = data?.tournament?.name || "";
  const evType = data?.tournament?.eventType === "single" ? "single" : "double";
  const rawStatus = data?.status || "";
  const status = rawStatus.toUpperCase();
  const isFinished = status === "FINISHED";
  const badgeClass = isFinished ? "ft" : status === "LIVE" ? "live" : "";

  // 👉 Tên đội hiển thị đã ẩn player2 nếu single
  const nameA = formatTeamName(data?.teams?.A, evType) || "Team A";
  const nameB = formatTeamName(data?.teams?.B, evType) || "Team B";

  const gi = Number.isInteger(data?.currentGame) ? data.currentGame : 0;
  const cur = (data?.gameScores || [])[gi] || { a: 0, b: 0 };
  const scoreA = smax(cur.a);
  const scoreB = smax(cur.b);

  const rules = {
    bestOf: Number(data?.rules?.bestOf ?? 3),
    pointsToWin: Number(data?.rules?.pointsToWin ?? 11),
    winByTwo: Boolean(data?.rules?.winByTwo ?? true),
  };

  // Số ô set = bestOf (vd BO3 => 3 ô, BO5 => 5 ô)
  const maxSets = Math.max(1, Number(rules.bestOf) || 3);

  const setWinner = (g) => {
    if (!g) return "";
    if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo))
      return "A";
    if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
      return "B";
    return "";
  };

  const fmtScore = (g) => {
    if (!g || (!Number.isFinite(+g.a) && !Number.isFinite(+g.b))) return "—";
    return `${smax(g.a)}–${smax(g.b)}`;
  };

  // Tổng set thắng
  const { setsA, setsB } = useMemo(() => {
    let A = 0,
      B = 0;
    (data?.gameScores || []).forEach((g) => {
      const w = setWinner(g);
      if (w === "A") A += 1;
      else if (w === "B") B += 1;
    });
    return { setsA: A, setsB: B };
  }, [data?.gameScores, rules.pointsToWin, rules.winByTwo]);

  // Tóm tắt từng set để render
  const setSummary = useMemo(() => {
    return Array.from({ length: maxSets }).map((_, i) => {
      const g = (data?.gameScores || [])[i];
      const w = setWinner(g);
      return {
        index: i + 1,
        a: g?.a ?? null,
        b: g?.b ?? null,
        winner: w, // "A" | "B" | ""
        label: fmtScore(g),
      };
    });
  }, [data?.gameScores, maxSets, rules.pointsToWin, rules.winByTwo]);

  const serveSide = data?.serve?.side || "A";

  // corner position
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
          <span title={tourName}>{tourName}</span>
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
            {badgeClass === "ft" ? "FT" : status || "—"}
          </span>
        </div>

        {/* Team A */}
        <div style={styles.row}>
          <div style={styles.team}>
            <span style={{ ...styles.pill, background: "var(--accent-a)" }} />
            <span style={styles.name} title={nameA}>
              {nameA}
            </span>
            <span
              style={{
                ...styles.serve,
                display: serveSide === "A" ? "inline-block" : "none",
              }}
            >
              Giao
            </span>
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
            <span
              style={{
                ...styles.serve,
                display: serveSide === "B" ? "inline-block" : "none",
              }}
            >
              Giao
            </span>
          </div>
          <div style={styles.score}>{scoreB}</div>
        </div>

        {/* Sets */}
        {showSets && (
          <div style={{ ...styles.meta, alignItems: "flex-start" }}>
            <span>
              Sets
              {Number.isFinite(setsA) && Number.isFinite(setsB)
                ? ` (${setsA}–${setsB})`
                : ""}
            </span>

            {/* Nếu đã kết thúc: hiển thị kết quả chi tiết từng set */}
            {isFinished ? (
              <span style={styles.setsWrap}>
                {setSummary.map((s, i) => {
                  const isA = s.winner === "A";
                  const isB = s.winner === "B";
                  const chipStyle = isA
                    ? {
                        ...styles.setChip,
                        background: "var(--accent-a)",
                        color: "#fff",
                        borderColor: "transparent",
                      }
                    : isB
                    ? {
                        ...styles.setChip,
                        background: "var(--accent-b)",
                        color: "#fff",
                        borderColor: "transparent",
                      }
                    : { ...styles.setChip, background: "transparent" };
                  const winnerName = isA ? nameA : isB ? nameB : "";
                  return (
                    <span
                      key={i}
                      style={chipStyle}
                      title={`Set ${s.index}${
                        winnerName ? `: thắng ${winnerName}` : ""
                      }${s.label !== "—" ? ` (${s.label})` : ""}`}
                    >
                      {s.label}
                    </span>
                  );
                })}
              </span>
            ) : (
              // Chưa kết thúc: hiển thị dạng dot (đội thắng set = dot màu)
              <span style={styles.sets}>
                {setSummary.map((s, i) => {
                  const style =
                    s.winner === "A"
                      ? {
                          ...styles.setDot,
                          background: "var(--accent-a)",
                          borderColor: "transparent",
                          opacity: 1,
                        }
                      : s.winner === "B"
                      ? {
                          ...styles.setDot,
                          background: "var(--accent-b)",
                          borderColor: "transparent",
                          opacity: 1,
                        }
                      : {
                          ...styles.setDot,
                          background: "transparent",
                          borderColor: "#cbd5e1",
                          opacity: 0.6,
                        };
                  return <span key={i} style={style} />;
                })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* CSS Variables */}
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
        }
      `}</style>
    </div>
  );
}

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
    pointerEvents: "none", // để overlay không bắt chuột khi chèn lên livestream
  },
  meta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "var(--meta)",
    color: "var(--muted)",
    paddingTop: 2,
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
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "220px",
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

  // ----- Sets UI -----
  sets: { display: "inline-flex", alignItems: "center", gap: 6 },
  setsWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    maxWidth: 220, // tránh tràn overlay; có thể chỉnh qua query nếu cần
  },
  setDot: {
    width: 10,
    height: 10,
    borderRadius: 3, // bo nhẹ; nếu muốn tròn: 999
    border: "1px solid #cbd5e1",
    display: "inline-block",
  },
  setChip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 18,
    minWidth: 30,
    padding: "0 6px",
    fontSize: "var(--badge)",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    lineHeight: 1,
    whiteSpace: "nowrap",
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
