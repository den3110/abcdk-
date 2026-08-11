// MlpOverlay.jsx — Scoreboard overlay compact cho giải MLP (top-left OBS).
// Style theo bản overlay giải thường: dark navy + gold accent, gọn 1 hàng.
// Hoạt động xuyên suốt sub-match (2v2) và DreamBreaker (1v1 rotating).
// Bind theo courtStationId → tự đọc trận đang diễn ra trên sân đó.
//
// URL: /overlay/mlp/court/:courtStationId
// Query:
//   ?theme=light|dark   (default dark)
//   ?compact=1          (thu nhỏ thêm)
//   ?position=top-left|top-right|bottom-left|bottom-right|center
//   ?hidePlaceholder=1  (không hiện box "chờ trận đấu")
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { BASE_URL } from "../../slices/apiSlice";
import { toHttpsIfNotLocalhost } from "../../utils/url";

const POLL_MS = 2500;

// Palette navy+gold — khớp style overlay giải thường
const NAVY_BG = "#0A1834";
const NAVY_BG_DEEP = "#050D22";
const GOLD = "#F5B94A";
const GOLD_DARK = "#8B6712";
const TEAM_A_ACCENT = "#22c55e";
const TEAM_B_ACCENT = "#ef4444";

export default function MlpOverlay() {
  const { courtStationId } = useParams();
  const [searchParams] = useSearchParams();
  const compact = searchParams.get("compact") === "1";
  const position = (searchParams.get("position") || "top-left").toLowerCase();
  const hidePlaceholder = searchParams.get("hidePlaceholder") === "1";

  const [data, setData] = useState(null);
  const [, setError] = useState(null);
  const [courtInfo, setCourtInfo] = useState(null);

  useEffect(() => {
    if (!courtStationId) return;
    let cancelled = false;
    const fetchOverlay = async () => {
      try {
        const url = `${BASE_URL || ""}/api/live/courts/${courtStationId}/mlp-overlay`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setData(null);
            setError(res.status === 404 ? "no-match" : `HTTP ${res.status}`);
          }
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(String(err?.message || err));
      }
    };
    const fetchCourt = async () => {
      try {
        const url = `${BASE_URL || ""}/api/live/courts/${courtStationId}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setCourtInfo(json);
      } catch {}
    };
    fetchOverlay();
    fetchCourt();
    const timer = setInterval(fetchOverlay, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [courtStationId]);

  // Body background transparent (cho OBS chroma-key) + inject keyframes
  useEffect(() => {
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    // Chỉ inject 1 lần (guard theo id)
    let styleEl = document.getElementById("mlp-overlay-keyframes");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "mlp-overlay-keyframes";
      styleEl.textContent = `
        @keyframes mlpServePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 6px #eab308, 0 0 2px #fff; }
          50% { transform: scale(1.25); box-shadow: 0 0 12px #eab308, 0 0 4px #fff; }
        }
      `;
      document.head.appendChild(styleEl);
    }
    return () => {
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, []);

  // Container position: top-left mặc định, hỗ trợ các preset khác.
  const containerStyle = getContainerStyle(position);

  if (!data) {
    if (hidePlaceholder) return null;
    const stationName =
      courtInfo?.station?.name || courtInfo?.station?.code || "—";
    return (
      <div style={containerStyle}>
        <CompactCard>
          <div
            style={{
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                background: GOLD,
                color: NAVY_BG,
                fontWeight: 900,
                fontSize: 10,
                letterSpacing: 0.6,
                padding: "3px 8px",
                borderRadius: 4,
              }}
            >
              MLP
            </div>
            <div style={{ color: "#fff", fontSize: 12 }}>
              Sân <b>{stationName}</b> · Chờ trận đấu…
            </div>
          </div>
        </CompactCard>
      </div>
    );
  }

  const isSub = data.mode === "sub";
  const isDb = data.mode === "dreambreaker";

  return (
    <div style={containerStyle}>
      {isSub && <CompactSubMatch data={data} compact={compact} />}
      {isDb && <CompactDreamBreaker data={data} compact={compact} />}
    </div>
  );
}

/* ═══════════════════════════════ Container ═══════════════════════════════ */

function getContainerStyle(position) {
  const base = {
    fontFamily:
      "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
    position: "fixed",
    padding: 16,
    zIndex: 100,
  };
  switch (position) {
    case "top-right":
      return { ...base, top: 0, right: 0 };
    case "bottom-left":
      return { ...base, bottom: 0, left: 0 };
    case "bottom-right":
      return { ...base, bottom: 0, right: 0 };
    case "center":
      return {
        ...base,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    case "top-left":
    default:
      return { ...base, top: 0, left: 0 };
  }
}

/* ═══════════════════════════════ Card wrapper ═══════════════════════════════ */

// Card navy với viền gold — dùng chung cho placeholder + sub-match + dreambreaker
function CompactCard({ children, badgeText, badgeColor = GOLD }) {
  return (
    <div style={{ position: "relative" }}>
      {badgeText ? (
        <div
          style={{
            position: "absolute",
            top: -10,
            left: 20,
            background: badgeColor,
            color: NAVY_BG,
            fontWeight: 900,
            fontSize: 11,
            letterSpacing: 1,
            padding: "3px 14px",
            borderRadius: 4,
            border: `1px solid ${GOLD_DARK}`,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            zIndex: 2,
          }}
        >
          {badgeText}
        </div>
      ) : null}
      <div
        style={{
          background: `linear-gradient(135deg, ${NAVY_BG} 0%, ${NAVY_BG_DEEP} 100%)`,
          border: `1.5px solid ${GOLD_DARK}`,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)",
          minWidth: 480,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ═══════════════════════════════ Sub-match ═══════════════════════════════ */

function CompactSubMatch({ data, compact }) {
  const { teamA, teamB, score, slot, tournament, serve } = data;
  const slotKey = String(slot?.key || "MD").toUpperCase();
  const slotLabel = slot?.label || tournament?.name || "";
  const scoreA = Number(score?.currentGameA || 0);
  const scoreB = Number(score?.currentGameB || 0);
  const slotWinsA = Number(teamA?.slotWins || 0);
  const slotWinsB = Number(teamB?.slotWins || 0);
  const isFinished = data.status === "finished";
  const winner = teamA?.isWinner ? "A" : teamB?.isWinner ? "B" : null;
  // Serve indicator: side đang giao + serverId (player)
  const serveSide = String(serve?.side || "").toUpperCase() === "B" ? "B" : "A";
  const serveServerId = serve?.serverId ? String(serve.serverId) : "";

  return (
    <CompactCard>
      {/* Header strip: slot badge + label */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: `1px solid ${GOLD_DARK}55`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(0,0,0,0.35)",
        }}
      >
        <SlotBadge slotKey={slotKey} />
        <div
          style={{
            color: "#cbd5e1",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          {slotLabel}
        </div>
        {isFinished && winner ? (
          <div
            style={{
              color: GOLD,
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: 1,
            }}
          >
            ● KẾT THÚC
          </div>
        ) : (
          <div
            style={{
              color: "#f87171",
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            LIVE
          </div>
        )}
      </div>

      {/* Body: 2 team rows + score box bên phải */}
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ flex: 1, padding: compact ? "6px 12px" : "8px 14px" }}>
          <TeamRowCompact
            team={teamA}
            accent={TEAM_A_ACCENT}
            highlight={winner === "A"}
            compact={compact}
            isServing={!isFinished && serveSide === "A"}
            serveServerId={serveSide === "A" ? serveServerId : ""}
          />
          <div
            style={{
              height: 1,
              background: `linear-gradient(90deg, transparent, ${GOLD_DARK}44 50%, transparent)`,
              margin: compact ? "4px 0" : "6px 0",
            }}
          />
          <TeamRowCompact
            team={teamB}
            accent={TEAM_B_ACCENT}
            highlight={winner === "B"}
            compact={compact}
            isServing={!isFinished && serveSide === "B"}
            serveServerId={serveSide === "B" ? serveServerId : ""}
          />
        </div>
        <ScoreBoxCompact
          scoreA={scoreA}
          scoreB={scoreB}
          slotWinsA={slotWinsA}
          slotWinsB={slotWinsB}
          compact={compact}
        />
      </div>
    </CompactCard>
  );
}

// Quả bóng vàng có glow pulse — indicator tay giao
function ServeBall({ size = 12 }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: "radial-gradient(circle at 30% 30%, #fef08a, #eab308 70%)",
        border: `1px solid ${GOLD_DARK}`,
        boxShadow: `0 0 6px #eab308, 0 0 2px #fff`,
        flexShrink: 0,
        animation: "mlpServePulse 1.2s ease-in-out infinite",
      }}
    />
  );
}

function TeamRowCompact({
  team,
  accent,
  highlight,
  compact,
  isServing,
  serveServerId,
}) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const playersText = players.length
    ? players.map((p) => p.nickname || p.name).filter(Boolean).join(" / ")
    : "—";
  const initial = String(team?.shortName || team?.name || "?")
    .charAt(0)
    .toUpperCase();
  // Nếu có serveServerId khớp với 1 player → highlight tên player đó
  const serverIdx = serveServerId
    ? players.findIndex(
        (p) => String(p?._id || p?.id || "") === String(serveServerId),
      )
    : -1;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: highlight === false ? 0.7 : 1,
      }}
    >
      {team?.logo ? (
        <img
          src={toHttpsIfNotLocalhost(team.logo)}
          alt=""
          style={{
            width: compact ? 22 : 26,
            height: compact ? 22 : 26,
            borderRadius: "50%",
            objectFit: "cover",
            border: `2px solid ${accent}`,
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: compact ? 22 : 26,
            height: compact ? 22 : 26,
            borderRadius: "50%",
            background: accent,
            color: "#fff",
            fontWeight: 900,
            fontSize: compact ? 10 : 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          lineHeight: 1.15,
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: accent,
            fontSize: compact ? 10 : 11,
            fontWeight: 900,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          <span>{team?.name || "Team"}</span>
          {isServing && <ServeBall size={compact ? 9 : 11} />}
        </div>
        <div
          style={{
            color: "#fff",
            fontSize: compact ? 13 : 14,
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 340,
          }}
        >
          {players.length ? (
            players.map((p, i) => {
              const label = p.nickname || p.name || "?";
              const isServerP = serverIdx === i;
              return (
                <span key={p?._id || i}>
                  {i > 0 ? " / " : ""}
                  <span
                    style={
                      isServerP
                        ? {
                            color: GOLD,
                            textDecoration: "underline",
                            textDecorationColor: GOLD,
                            textDecorationThickness: 2,
                          }
                        : undefined
                    }
                  >
                    {label}
                  </span>
                </span>
              );
            })
          ) : (
            "—"
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreBoxCompact({ scoreA, scoreB, slotWinsA, slotWinsB, compact }) {
  const boxW = compact ? 46 : 52;
  const boxH = compact ? 34 : 38;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderLeft: `1.5px solid ${GOLD_DARK}`,
        background: "rgba(0,0,0,0.3)",
      }}
    >
      <ScoreCell value={scoreA} width={boxW} height={boxH} />
      <div
        style={{
          height: 1,
          background: GOLD_DARK,
          opacity: 0.7,
        }}
      />
      <ScoreCell value={scoreB} width={boxW} height={boxH} />
      {(slotWinsA > 0 || slotWinsB > 0) && (
        <div
          style={{
            padding: "3px 6px",
            fontSize: 9,
            color: GOLD,
            fontWeight: 900,
            textAlign: "center",
            letterSpacing: 0.6,
            background: "rgba(0,0,0,0.4)",
            borderTop: `1px solid ${GOLD_DARK}`,
          }}
        >
          {slotWinsA}-{slotWinsB}
        </div>
      )}
    </div>
  );
}

function ScoreCell({ value, width, height }) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 900,
        fontSize: Math.floor(height * 0.6),
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
      }}
    >
      {value}
    </div>
  );
}

function SlotBadge({ slotKey }) {
  return (
    <div
      style={{
        background: GOLD,
        color: NAVY_BG,
        padding: "2px 8px",
        fontWeight: 900,
        fontSize: 10,
        letterSpacing: 0.6,
        borderRadius: 3,
        border: `1px solid ${GOLD_DARK}`,
        minWidth: 36,
        textAlign: "center",
      }}
    >
      {slotKey}
    </div>
  );
}

/* ═══════════════════════════════ Dream Breaker ═══════════════════════════════ */

function CompactDreamBreaker({ data, compact }) {
  const { teamA, teamB, dreamBreaker, serve } = data;
  const winner = dreamBreaker?.winner;
  const scoreA = Number(dreamBreaker?.scoreA || 0);
  const scoreB = Number(dreamBreaker?.scoreB || 0);
  const target = Number(dreamBreaker?.target || 21);
  // Serve side ưu tiên serve.side; nếu không có → suy từ dreamBreaker.currentServeSide
  const serveSide =
    String(serve?.side || dreamBreaker?.currentServeSide || "A").toUpperCase() ===
    "B"
      ? "B"
      : "A";

  return (
    <CompactCard badgeText="🏆 DREAM BREAKER">
      {/* Header info: target + rotate */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: `1px solid ${GOLD_DARK}55`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          1v1 → Target {target} · Rotate {dreamBreaker?.rotate || 4}
        </div>
        <div
          style={{
            color: "#f87171",
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: 1,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
          {winner ? "ĐÃ KẾT THÚC" : "LIVE"}
        </div>
      </div>

      {/* Body: 2 player rows + score box */}
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ flex: 1, padding: compact ? "6px 12px" : "8px 14px" }}>
          <PlayerRowCompact
            team={teamA}
            accent={TEAM_A_ACCENT}
            highlight={winner === "A"}
            rotate={dreamBreaker?.rotate}
            pointsInBlock={dreamBreaker?.pointsInBlockA}
            compact={compact}
            isServing={!winner && serveSide === "A"}
          />
          <div
            style={{
              height: 1,
              background: `linear-gradient(90deg, transparent, ${GOLD_DARK}44 50%, transparent)`,
              margin: compact ? "4px 0" : "6px 0",
            }}
          />
          <PlayerRowCompact
            team={teamB}
            accent={TEAM_B_ACCENT}
            highlight={winner === "B"}
            rotate={dreamBreaker?.rotate}
            pointsInBlock={dreamBreaker?.pointsInBlockB}
            compact={compact}
            isServing={!winner && serveSide === "B"}
          />
        </div>
        <ScoreBoxCompact
          scoreA={scoreA}
          scoreB={scoreB}
          slotWinsA={0}
          slotWinsB={0}
          compact={compact}
        />
      </div>
      {winner && (
        <div
          style={{
            padding: 6,
            textAlign: "center",
            background: GOLD,
            color: NAVY_BG,
            fontWeight: 900,
            fontSize: 11,
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          🏆 Winner: {winner === "A" ? teamA?.name : teamB?.name}
        </div>
      )}
    </CompactCard>
  );
}

function PlayerRowCompact({
  team,
  accent,
  highlight,
  rotate,
  pointsInBlock,
  compact,
  isServing,
}) {
  const player = team?.currentPlayer;
  const lineupCount = Array.isArray(team?.lineup) ? team.lineup.length : 0;
  const rotationIdx = Number(team?.currentPlayerIdx || 0);
  const untilRotate = Math.max(
    0,
    Number(rotate || 4) - Number(pointsInBlock || 0),
  );
  const playerName = player?.nickname || player?.name || "—";
  const initial = String(playerName).charAt(0).toUpperCase();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: highlight === false ? 0.7 : 1,
      }}
    >
      {player?.avatar ? (
        <img
          src={toHttpsIfNotLocalhost(player.avatar)}
          alt=""
          style={{
            width: compact ? 24 : 28,
            height: compact ? 24 : 28,
            borderRadius: "50%",
            objectFit: "cover",
            border: `2px solid ${accent}`,
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: compact ? 24 : 28,
            height: compact ? 24 : 28,
            borderRadius: "50%",
            background: accent,
            color: "#fff",
            fontWeight: 900,
            fontSize: compact ? 11 : 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          lineHeight: 1.15,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: accent,
            fontSize: compact ? 10 : 11,
            fontWeight: 900,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          <span>{team?.name || "Team"}</span>
          {isServing && <ServeBall size={compact ? 9 : 11} />}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
          }}
        >
          <div
            style={{
              color: "#fff",
              fontSize: compact ? 13 : 14,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 300,
            }}
          >
            {playerName}
          </div>
          <div
            style={{
              color: GOLD,
              fontSize: 9,
              fontWeight: 900,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              opacity: 0.9,
            }}
          >
            #{rotationIdx + 1}/{lineupCount} · {untilRotate}đ
          </div>
        </div>
      </div>
    </div>
  );
}
