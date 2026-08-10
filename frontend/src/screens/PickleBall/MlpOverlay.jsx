// MlpOverlay.jsx — Scoreboard overlay cho giải MLP, hoạt động xuyên
// suốt sub-match (2v2) và DreamBreaker (1v1 rotating). Bind theo
// courtStationId → tự đọc trận đang diễn ra trên sân đó.
//
// URL: /overlay/mlp/court/:courtStationId?theme=dark
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { BASE_URL } from "../../slices/apiSlice";
import { toHttpsIfNotLocalhost } from "../../utils/url";

const POLL_MS = 2500;

export default function MlpOverlay() {
  const { courtStationId } = useParams();
  const [searchParams] = useSearchParams();
  const theme = String(searchParams.get("theme") || "dark").toLowerCase();
  const compact = searchParams.get("compact") === "1";

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [courtInfo, setCourtInfo] = useState(null);

  // Poll cả endpoint MLP overlay và fallback court info.
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

  // Body background transparent (cho OBS chroma-key)
  useEffect(() => {
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, []);

  const dark = theme !== "light";
  const hidePlaceholder = searchParams.get("hidePlaceholder") === "1";

  if (!data) {
    // Không có trận đang diễn ra — hiện placeholder "Chờ trận đấu"
    // để trình duyệt không trắng hoàn toàn (OBS chroma-key vẫn OK vì
    // background transparent). Có thể tắt bằng ?hidePlaceholder=1.
    if (hidePlaceholder) return null;
    const stationName =
      courtInfo?.station?.name || courtInfo?.station?.code || "—";
    const clusterName =
      courtInfo?.cluster?.name || courtInfo?.cluster?.venueName || "";
    return (
      <div
        style={{
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "flex-end",
          padding: 16,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            margin: "0 auto",
            background: dark ? "rgba(11, 18, 32, 0.85)" : "rgba(255,255,255,0.96)",
            border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
            borderRadius: 16,
            padding: 20,
            textAlign: "center",
            color: dark ? "#fff" : "#0F172A",
            backdropFilter: "blur(12px)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "3px 10px",
              background: "#F59E0B",
              color: dark ? "#0F172A" : "#fff",
              fontWeight: 900,
              fontSize: 11,
              borderRadius: 999,
              letterSpacing: 0.5,
              marginBottom: 10,
            }}
          >
            MLP OVERLAY
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
            Sân {stationName}
          </div>
          {clusterName ? (
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
              {clusterName}
            </div>
          ) : null}
          <div style={{ fontSize: 14, opacity: 0.85 }}>
            Chờ trận đấu MLP…
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
            Overlay sẽ tự hiện khi sub-match live hoặc dual vào DreamBreaker.
          </div>
        </div>
      </div>
    );
  }

  const isSub = data.mode === "sub";
  const isDb = data.mode === "dreambreaker";

  return (
    <div
      style={{
        fontFamily:
          "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
        color: dark ? "#fff" : "#0F172A",
        padding: 16,
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: compact ? 760 : 900,
          margin: "0 auto",
        }}
      >
        {isSub && <SubMatchScoreboard data={data} dark={dark} compact={compact} />}
        {isDb && <DreamBreakerScoreboard data={data} dark={dark} compact={compact} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════ SUB-MATCH ═══════════════════════════════ */
function SubMatchScoreboard({ data, dark, compact }) {
  const { teamA, teamB, score, slot, tournament, station } = data;
  const bg = dark ? "rgba(11, 18, 32, 0.92)" : "rgba(255, 255, 255, 0.96)";
  const border = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  return (
    <div
      style={{
        background: bg,
        borderRadius: 16,
        border: `1px solid ${border}`,
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        overflow: "hidden",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Top strip */}
      <TopStrip
        left={
          <>
            <BadgeChip
              label={slot?.key || "MLP"}
              color="#F59E0B"
              dark={dark}
            />
            <span style={{ opacity: 0.75, fontSize: 12, marginLeft: 8 }}>
              {slot?.label || tournament?.name}
            </span>
          </>
        }
        right={
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            {station?.name || ""}
          </span>
        }
        dark={dark}
      />

      {/* Body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 120px 1fr",
          alignItems: "center",
          gap: 0,
          padding: compact ? 10 : 14,
        }}
      >
        <TeamBlockDouble team={teamA} dark={dark} align="left" />
        <ScoreCol
          a={score?.currentGameA}
          b={score?.currentGameB}
          slotWinsA={teamA?.slotWins}
          slotWinsB={teamB?.slotWins}
          dark={dark}
        />
        <TeamBlockDouble team={teamB} dark={dark} align="right" />
      </div>
    </div>
  );
}

function TeamBlockDouble({ team, dark, align }) {
  const teamColor = team?.color || (align === "left" ? "#3B82F6" : "#EF4444");
  const players = Array.isArray(team?.players) ? team.players : [];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "flex-start",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexDirection: align === "right" ? "row-reverse" : "row",
        }}
      >
        {team?.logo ? (
          <img
            src={toHttpsIfNotLocalhost(team.logo)}
            alt=""
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              objectFit: "cover",
              border: `2px solid ${teamColor}`,
            }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              background: teamColor,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 14,
              border: `2px solid ${teamColor}`,
            }}
          >
            {(team?.shortName || team?.name || "?")
              .charAt(0)
              .toUpperCase()}
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: teamColor,
          }}
        >
          {team?.name || "Team"}
        </div>
      </div>
      <div
        style={{
          textAlign: align,
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.25,
          color: dark ? "#fff" : "#0F172A",
        }}
      >
        {players.length ? (
          players.map((p) => p.nickname || p.name).join(" – ")
        ) : (
          <span style={{ opacity: 0.6 }}>—</span>
        )}
      </div>
    </div>
  );
}

function ScoreCol({ a, b, slotWinsA, slotWinsB, dark }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontWeight: 900,
          lineHeight: 1,
          color: dark ? "#fff" : "#0F172A",
          fontVariantNumeric: "tabular-nums",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span>{Number(a || 0)}</span>
        <span style={{ opacity: 0.5, fontSize: 22 }}>·</span>
        <span>{Number(b || 0)}</span>
      </div>
      <div
        style={{
          fontSize: 11,
          opacity: 0.8,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}
      >
        SLOT {slotWinsA || 0} — {slotWinsB || 0}
      </div>
    </div>
  );
}

/* ═════════════════════════════ DREAM BREAKER ═════════════════════════════ */
function DreamBreakerScoreboard({ data, dark, compact }) {
  const { teamA, teamB, dreamBreaker, station } = data;
  const bg = dark ? "rgba(11, 18, 32, 0.92)" : "rgba(255, 255, 255, 0.96)";
  const border = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const winner = dreamBreaker?.winner;

  return (
    <div
      style={{
        background: bg,
        borderRadius: 16,
        border: `1px solid ${border}`,
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        overflow: "hidden",
        backdropFilter: "blur(12px)",
      }}
    >
      <TopStrip
        left={
          <>
            <BadgeChip
              label="🏆 DREAM BREAKER"
              color="#F59E0B"
              dark={dark}
            />
            <span style={{ opacity: 0.75, fontSize: 12, marginLeft: 8 }}>
              1v1 tới {dreamBreaker?.target || 21} · Rotate mỗi{" "}
              {dreamBreaker?.rotate || 4}đ
            </span>
          </>
        }
        right={
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            {station?.name || ""}
          </span>
        }
        dark={dark}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 140px 1fr",
          alignItems: "center",
          padding: compact ? 10 : 14,
        }}
      >
        <TeamBlockSingle
          team={teamA}
          dark={dark}
          align="left"
          scoreInBlock={dreamBreaker?.pointsInBlockA}
          rotate={dreamBreaker?.rotate}
          isWinner={winner === "A"}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "0 8px",
          }}
        >
          <div
            style={{
              fontSize: 54,
              fontWeight: 900,
              lineHeight: 1,
              color: dark ? "#fff" : "#0F172A",
              fontVariantNumeric: "tabular-nums",
              display: "flex",
              alignItems: "baseline",
              gap: 10,
            }}
          >
            <span>{dreamBreaker?.scoreA ?? 0}</span>
            <span style={{ opacity: 0.5, fontSize: 24 }}>—</span>
            <span>{dreamBreaker?.scoreB ?? 0}</span>
          </div>
          <div
            style={{
              fontSize: 10,
              opacity: 0.7,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            Target {dreamBreaker?.target || 21}
          </div>
        </div>
        <TeamBlockSingle
          team={teamB}
          dark={dark}
          align="right"
          scoreInBlock={dreamBreaker?.pointsInBlockB}
          rotate={dreamBreaker?.rotate}
          isWinner={winner === "B"}
        />
      </div>
      {winner && (
        <div
          style={{
            padding: 10,
            textAlign: "center",
            background: "#F59E0B",
            color: "#78350F",
            fontWeight: 900,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          🏆 Winner: {winner === "A" ? teamA?.name : teamB?.name}
        </div>
      )}
    </div>
  );
}

function TeamBlockSingle({
  team,
  dark,
  align,
  scoreInBlock,
  rotate,
  isWinner,
}) {
  const teamColor = team?.color || (align === "left" ? "#3B82F6" : "#EF4444");
  const player = team?.currentPlayer;
  const lineupCount = Array.isArray(team?.lineup) ? team.lineup.length : 0;
  const rotationIdx = Number(team?.currentPlayerIdx || 0);
  const untilRotate = Math.max(
    0,
    Number(rotate || 4) - Number(scoreInBlock || 0),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "flex-start",
        gap: 6,
        opacity: isWinner === false && team?.isWinner === false ? 1 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexDirection: align === "right" ? "row-reverse" : "row",
        }}
      >
        {player?.avatar ? (
          <img
            src={toHttpsIfNotLocalhost(player.avatar)}
            alt=""
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              objectFit: "cover",
              border: `3px solid ${teamColor}`,
            }}
          />
        ) : (
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              background: teamColor,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 18,
            }}
          >
            {(player?.nickname || player?.name || "?")
              .charAt(0)
              .toUpperCase()}
          </div>
        )}
        <div
          style={{
            textAlign: align,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: teamColor,
            }}
          >
            {team?.name || "Team"}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              lineHeight: 1.15,
              color: dark ? "#fff" : "#0F172A",
            }}
          >
            {player?.nickname || player?.name || "—"}
          </div>
          <div
            style={{
              fontSize: 10,
              opacity: 0.7,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            #{rotationIdx + 1}/{lineupCount} · còn {untilRotate}đ nữa xoay
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ COMMON ═══════════════════════════════ */
function TopStrip({ left, right, dark }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 14px",
        borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
        background: dark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>{left}</div>
      <div style={{ display: "flex", alignItems: "center" }}>{right}</div>
    </div>
  );
}

function BadgeChip({ label, color, dark }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        background: color,
        color: dark ? "#0F172A" : "#fff",
        fontWeight: 900,
        fontSize: 11,
        borderRadius: 999,
        letterSpacing: 0.5,
      }}
    >
      {label}
    </span>
  );
}
