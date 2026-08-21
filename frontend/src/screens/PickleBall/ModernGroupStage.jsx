/* eslint-disable react/prop-types */
// ModernGroupStage.jsx
// Bản v4 — layer HIỂN THỊ mới cho VÒNG BẢNG (group stage).
// KHÔNG đụng logic tính standings / sinh matchRows — nhận payload `groupEntries`
// đã chuẩn hoá từ TournamentBracket.jsx và chỉ lo render đẹp hơn.
// Giữ nguyên bản classic/board — component này chỉ hiện khi gate v4 bật.

import { useMemo } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Typography,
  Stack,
  Tooltip,
  Paper,
  alpha,
  darken,
  lighten,
  useTheme,
  LinearProgress,
} from "@mui/material";
import {
  EmojiEvents as TrophyIcon,
  AccessTime as ClockIcon,
  Stadium as CourtIcon,
  OndemandVideo as VideoIcon,
  FiberManualRecord as LiveDotIcon,
  CheckCircleRounded as AdvanceIcon,
  Groups as TeamsIcon,
} from "@mui/icons-material";

/* ================= palette accent theo index bảng (xuôi, giống RE) ======= */
const GROUP_ACCENTS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // rose
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#f97316", // orange
];
const accentForGroup = (i) => GROUP_ACCENTS[Math.max(0, i) % GROUP_ACCENTS.length];

/* Avatar màu ổn định theo tên đội (đồng bộ ModernKnockoutBracket) */
const AVATAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];
function colorForName(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initialsOf(name) {
  if (!name) return "?";
  const t = String(name)
    .replace(/\(.*?\)/g, "")
    .trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/* Placeholder "Đội X" / mã tham chiếu → style nhạt italic */
const PLACEHOLDER_RE = /^(Đội\s+\d+|TBD|Chưa có đội|Registration.*)$/i;
const isPlaceholderName = (s) => PLACEHOLDER_RE.test(String(s || "").trim());

/* ================= status meta ================= */
function statusMetaOf(m, isDark) {
  const st = String(m?.status || "").toLowerCase();
  if (st === "finished")
    return {
      key: "finished",
      label: "Đã đấu",
      color: "#22c55e",
      bg: alpha("#22c55e", 0.14),
      fg: isDark ? "#86efac" : "#166534",
    };
  if (st === "live")
    return {
      key: "live",
      label: "Đang đấu",
      color: "#f59e0b",
      bg: alpha("#f59e0b", 0.18),
      fg: isDark ? "#fbbf24" : "#b45309",
    };
  if (st === "assigned" || st === "queued")
    return {
      key: "ready",
      label: "Sẵn sàng",
      color: "#3b82f6",
      bg: alpha("#3b82f6", 0.12),
      fg: isDark ? "#93c5fd" : "#1d4ed8",
    };
  return {
    key: "planned",
    label: "Chưa diễn ra",
    color: "#94a3b8",
    bg: alpha("#94a3b8", 0.16),
    fg: isDark ? "#cbd5e1" : "#475569",
  };
}

/* ================= tiny pieces ================= */
function TeamAvatar({ name, size = 26, muted }) {
  const c = muted ? "#94a3b8" : colorForName(name);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: size * 0.42,
        color: "#fff",
        background: muted
          ? alpha("#94a3b8", 0.45)
          : `linear-gradient(135deg, ${lighten(c, 0.12)} 0%, ${darken(c, 0.18)} 100%)`,
        boxShadow: `0 0 0 2px ${alpha(c, 0.25)}`,
        userSelect: "none",
      }}
    >
      {muted ? "⏳" : initialsOf(name)}
    </Box>
  );
}

function LivePulse() {
  return (
    <LiveDotIcon
      sx={{
        fontSize: 12,
        color: "#f59e0b",
        animation: "mgsPulse 1.2s ease-in-out infinite",
        "@keyframes mgsPulse": {
          "0%, 100%": { opacity: 0.45, transform: "scale(0.85)" },
          "50%": { opacity: 1, transform: "scale(1.15)" },
        },
      }}
    />
  );
}

/* ================= Match card ================= */
function ModernGroupMatchCard({ row, accent, isDark, onOpenMatch }) {
  const m = row.match;
  const meta = statusMetaOf(m, isDark);
  const isLive = meta.key === "live";
  const isFinished = meta.key === "finished";
  const clickable = !row.isPlaceholder && !!m;
  const winner = isFinished ? String(m?.winner || "") : "";
  const phA = isPlaceholderName(row.aName);
  const phB = isPlaceholderName(row.bName);

  // Tách score "a-b" nếu có để render đôi bên; fallback text nguyên gốc
  const scorePair = useMemo(() => {
    const s = String(row.score || "").trim();
    const mm = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    return mm ? [mm[1], mm[2]] : null;
  }, [row.score]);

  const sideRow = (name, side, ph) => {
    const won = winner === side;
    const scoreVal = scorePair
      ? scorePair[side === "A" ? 0 : 1]
      : null;
    return (
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 1,
          py: 0.6,
          borderRadius: 1.5,
          minWidth: 0,
          bgcolor: won ? alpha("#22c55e", 0.12) : "transparent",
          borderLeft: `3px solid ${won ? "#22c55e" : "transparent"}`,
        }}
      >
        <TeamAvatar name={name} muted={ph} />
        <Typography
          noWrap
          variant="body2"
          sx={{
            flex: 1,
            minWidth: 0,
            fontWeight: won ? 800 : row[side === "A" ? "isMineA" : "isMineB"] ? 700 : 500,
            fontStyle: ph ? "italic" : "normal",
            color: ph
              ? "text.disabled"
              : won
                ? isDark
                  ? "#86efac"
                  : "#15803d"
                : row[side === "A" ? "isMineA" : "isMineB"]
                  ? "primary.main"
                  : "text.primary",
          }}
        >
          {name}
        </Typography>
        {scoreVal != null && (
          <Box
            sx={{
              minWidth: 30,
              px: 0.75,
              py: 0.2,
              borderRadius: 1,
              textAlign: "center",
              fontWeight: 800,
              fontSize: 14,
              fontVariantNumeric: "tabular-nums",
              color: won || isLive ? "#fff" : "text.primary",
              bgcolor: won
                ? "#22c55e"
                : isLive
                  ? "#f59e0b"
                  : isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(15,23,42,0.06)",
            }}
          >
            {scoreVal}
          </Box>
        )}
      </Stack>
    );
  };

  return (
    <Paper
      elevation={0}
      onClick={() => clickable && onOpenMatch?.(m)}
      sx={{
        position: "relative",
        borderRadius: 2.5,
        border: "1px solid",
        borderColor: isLive
          ? alpha("#f59e0b", 0.7)
          : row.isMine
            ? alpha(accent, 0.65)
            : alpha(accent, isDark ? 0.35 : 0.22),
        borderTop: `3px solid ${isLive ? "#f59e0b" : accent}`,
        bgcolor: isDark ? "#16181c" : "#fff",
        cursor: clickable ? "pointer" : "default",
        overflow: "hidden",
        transition: "box-shadow .18s ease, transform .18s ease",
        boxShadow: isLive
          ? `0 4px 18px ${alpha("#f59e0b", 0.25)}`
          : row.isMine
            ? `0 0 0 1px ${alpha(accent, 0.2)}, 0 4px 14px ${alpha(accent, 0.18)}`
            : "0 1px 6px rgba(0,0,0,0.05)",
        "&:hover": clickable
          ? {
              boxShadow: `0 6px 22px ${alpha(accent, 0.28)}`,
              transform: "translateY(-1px)",
            }
          : {},
      }}
    >
      {/* header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.25,
          py: 0.6,
          gap: 1,
          background: `linear-gradient(135deg, ${alpha(accent, isDark ? 0.26 : 0.12)} 0%, ${alpha(
            accent,
            isDark ? 0.08 : 0.03,
          )} 100%)`,
          borderBottom: `1px dashed ${alpha(accent, 0.3)}`,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          {isLive && <LivePulse />}
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 0.4,
              color: isDark ? lighten(accent, 0.35) : darken(accent, 0.15),
            }}
          >
            {row.code}
          </Typography>
          <Box
            sx={{
              px: 0.6,
              py: 0.1,
              borderRadius: 1,
              bgcolor: meta.bg,
            }}
          >
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: meta.fg }}>
              {meta.label}
            </Typography>
          </Box>
          {row.video && (
            <VideoIcon sx={{ fontSize: 15, color: "error.main" }} />
          )}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          {!!row.time && (
            <Stack direction="row" alignItems="center" spacing={0.35}>
              <ClockIcon sx={{ fontSize: 12, color: "text.secondary" }} />
              <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
                {row.time}
              </Typography>
            </Stack>
          )}
          {!!row.court && (
            <Stack direction="row" alignItems="center" spacing={0.35}>
              <CourtIcon sx={{ fontSize: 12, color: "text.secondary" }} />
              <Typography sx={{ fontSize: 10.5, color: "text.secondary" }} noWrap>
                {row.court}
              </Typography>
            </Stack>
          )}
          {!scorePair && row.score && (
            <Typography sx={{ fontSize: 12, fontWeight: 800 }}>
              {row.score}
            </Typography>
          )}
        </Stack>
      </Box>

      {/* teams */}
      <Box sx={{ px: 0.75, py: 0.75 }}>
        {sideRow(row.aName, "A", phA)}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1.25, my: -0.1 }}>
          <Box sx={{ flex: 1, height: "1px", bgcolor: alpha(accent, 0.3) }} />
          <Typography
            sx={{
              fontSize: 9,
              fontWeight: 900,
              letterSpacing: 1.2,
              color: isDark ? lighten(accent, 0.4) : darken(accent, 0.1),
            }}
          >
            VS
          </Typography>
          <Box sx={{ flex: 1, height: "1px", bgcolor: alpha(accent, 0.3) }} />
        </Stack>
        {sideRow(row.bName, "B", phB)}
      </Box>
    </Paper>
  );
}

/* ================= Standings row ================= */
const MEDAL_GRADIENTS = [
  "linear-gradient(135deg, #fbbf24 0%, #d97706 100%)", // 1 — gold
  "linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)", // 2 — silver
  "linear-gradient(135deg, #d6a06b 0%, #92600d 100%)", // 3 — bronze
];

function ModernStandingRow({ row, accent, isDark, advancingColor }) {
  const rankIdx = (row.rank || 1) - 1;
  const medal = rankIdx >= 0 && rankIdx < 3 ? MEDAL_GRADIENTS[rankIdx] : null;
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      sx={{
        px: 1.25,
        py: 0.8,
        borderRadius: 2,
        minWidth: 0,
        bgcolor: row.isMine
          ? alpha("#3b82f6", isDark ? 0.14 : 0.07)
          : row.isAdvancing
            ? alpha(advancingColor, isDark ? 0.1 : 0.06)
            : "transparent",
        border: "1px solid",
        borderColor: row.isMine
          ? alpha("#3b82f6", 0.35)
          : row.isAdvancing
            ? alpha(advancingColor, 0.3)
            : "divider",
        borderLeftWidth: 4,
        borderLeftColor: row.isAdvancing
          ? advancingColor
          : row.isMine
            ? alpha("#3b82f6", 0.35)
            : "transparent",
      }}
    >
      <Box
        sx={{
          width: 26,
          height: 26,
          flex: "0 0 26px",
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: 12,
          color: medal ? "#fff" : "text.primary",
          background: medal || (isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)"),
          boxShadow: medal ? "0 2px 6px rgba(0,0,0,0.25)" : "none",
        }}
      >
        {row.rank}
      </Box>
      <TeamAvatar name={row.name} size={24} muted={isPlaceholderName(row.name)} />
      <Typography
        noWrap
        variant="body2"
        sx={{
          flex: 1,
          minWidth: 0,
          fontWeight: row.isMine ? 800 : 600,
          color: row.isMine ? "primary.main" : "text.primary",
        }}
      >
        {row.name}
      </Typography>
      {row.isAdvancing && (
        <Tooltip title="Vị trí đi tiếp vòng sau" arrow>
          <AdvanceIcon sx={{ fontSize: 17, color: advancingColor }} />
        </Tooltip>
      )}
      {row.played > 0 && (
        <Typography
          sx={{ fontSize: 11, color: "text.secondary", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
        >
          {row.win}T–{row.loss}B
        </Typography>
      )}
      <Box
        sx={{
          px: 0.8,
          py: 0.2,
          borderRadius: 1,
          fontWeight: 800,
          fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
          color: "#fff",
          background: `linear-gradient(135deg, ${accent} 0%, ${darken(accent, 0.25)} 100%)`,
          flexShrink: 0,
        }}
      >
        {row.pts}đ
      </Box>
      <Typography
        sx={{
          width: 40,
          textAlign: "right",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
          color:
            Number(row.diff) > 0
              ? isDark
                ? "#86efac"
                : "#15803d"
              : Number(row.diff) < 0
                ? isDark
                  ? "#fca5a5"
                  : "#b91c1c"
                : "text.secondary",
        }}
      >
        {Number(row.diff) > 0 ? `+${row.diff}` : row.diff}
      </Typography>
    </Stack>
  );
}

/* ================= Group card ================= */
function ModernGroupCard({ entry, index, isDark, onOpenMatch, advancingColor }) {
  const accent = accentForGroup(index);
  const done = entry.statusSummary?.done || 0;
  const live = entry.statusSummary?.live || 0;
  const total = entry.matchRows?.length || 0;
  const progress = total ? Math.round((done / total) * 100) : 0;

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3.5,
        overflow: "hidden",
        border: "1px solid",
        borderColor: entry.isMine
          ? alpha("#3b82f6", 0.5)
          : alpha(accent, isDark ? 0.4 : 0.25),
        bgcolor: isDark ? "#101216" : "#fbfcfe",
        boxShadow: entry.isMine
          ? `0 0 0 2px ${alpha("#3b82f6", 0.16)}, 0 8px 24px ${alpha("#3b82f6", 0.14)}`
          : `0 4px 18px ${alpha(accent, isDark ? 0.18 : 0.1)}`,
      }}
    >
      {/* ===== header gradient ===== */}
      <Box
        sx={{
          position: "relative",
          px: { xs: 1.75, md: 2.25 },
          py: 1.5,
          background: `linear-gradient(135deg, ${accent} 0%, ${darken(accent, 0.35)} 100%)`,
          overflow: "hidden",
        }}
      >
        {/* deco circles */}
        <Box
          sx={{
            position: "absolute",
            right: -28,
            top: -34,
            width: 120,
            height: 120,
            borderRadius: "50%",
            bgcolor: "rgba(255,255,255,0.08)",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            right: 42,
            bottom: -46,
            width: 90,
            height: 90,
            borderRadius: "50%",
            bgcolor: "rgba(255,255,255,0.06)",
          }}
        />
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ position: "relative" }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 20,
              color: accent,
              bgcolor: "#fff",
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              flexShrink: 0,
            }}
          >
            {entry.codeLabel
              ? String(entry.codeLabel).slice(0, 2).toUpperCase()
              : entry.labelNumeric}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                color: "#fff",
                fontWeight: 900,
                fontSize: { xs: 16, md: 18 },
                lineHeight: 1.2,
                textShadow: "0 1px 3px rgba(0,0,0,0.25)",
              }}
              noWrap
            >
              {entry.label}
              {entry.codeLabel ? ` · ${entry.codeLabel}` : ""}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.35 }} flexWrap="wrap" useFlexGap>
              <Stack direction="row" spacing={0.4} alignItems="center">
                <TeamsIcon sx={{ fontSize: 14, color: "rgba(255,255,255,0.85)" }} />
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
                  {entry.teamCount} đội
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
                {done}/{total} trận xong
              </Typography>
              {live > 0 && (
                <Stack direction="row" spacing={0.4} alignItems="center">
                  <LivePulse />
                  <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: "#fff" }}>
                    {live} đang đấu
                  </Typography>
                </Stack>
              )}
              {entry.isMine && (
                <Box
                  sx={{
                    px: 0.9,
                    py: 0.15,
                    borderRadius: 999,
                    bgcolor: "rgba(255,255,255,0.22)",
                    border: "1px solid rgba(255,255,255,0.45)",
                  }}
                >
                  <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: "#fff" }}>
                    ⭐ Bảng của tôi
                  </Typography>
                </Box>
              )}
            </Stack>
          </Box>
        </Stack>
        {/* progress */}
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            mt: 1.25,
            height: 5,
            borderRadius: 99,
            bgcolor: "rgba(255,255,255,0.22)",
            "& .MuiLinearProgress-bar": {
              borderRadius: 99,
              bgcolor: "#fff",
            },
          }}
        />
      </Box>

      {/* ===== body ===== */}
      <Box sx={{ p: { xs: 1.5, md: 2 } }}>
        {/* Matches */}
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: isDark ? lighten(accent, 0.35) : darken(accent, 0.12),
            mb: 1,
          }}
        >
          Trận trong bảng
        </Typography>
        {entry.matchRows?.length ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(auto-fill, minmax(290px, 1fr))",
              },
              gap: 1.25,
              mb: 2,
            }}
          >
            {entry.matchRows.map((r) => (
              <ModernGroupMatchCard
                key={r._id}
                row={r}
                accent={accent}
                isDark={isDark}
                onOpenMatch={onOpenMatch}
              />
            ))}
          </Box>
        ) : (
          <Paper
            variant="outlined"
            sx={{ p: 2, textAlign: "center", borderRadius: 2, mb: 2, borderStyle: "dashed" }}
          >
            <Typography variant="body2" color="text.secondary">
              Chưa có trận nào.
            </Typography>
          </Paper>
        )}

        {/* Standings */}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
          <TrophyIcon sx={{ fontSize: 16, color: "#f59e0b" }} />
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: isDark ? lighten(accent, 0.35) : darken(accent, 0.12),
            }}
          >
            Bảng xếp hạng
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip
            title={`Thắng +${entry.pointsCfg?.win ?? 3} · Thua +${entry.pointsCfg?.loss ?? 0} · Hiệu số = Điểm ghi − Điểm thua`}
            arrow
          >
            <Typography sx={{ fontSize: 11, color: "text.secondary", cursor: "help" }}>
              ⓘ Cách tính điểm
            </Typography>
          </Tooltip>
        </Stack>
        {entry.standingRows?.length ? (
          <Stack spacing={0.75}>
            {entry.standingRows.map((row) => (
              <ModernStandingRow
                key={row.id}
                row={row}
                accent={accent}
                isDark={isDark}
                advancingColor={advancingColor}
              />
            ))}
          </Stack>
        ) : (
          <Paper
            variant="outlined"
            sx={{ p: 2, textAlign: "center", borderRadius: 2, borderStyle: "dashed" }}
          >
            <Typography variant="body2" color="text.secondary">
              Chưa có dữ liệu BXH.
            </Typography>
          </Paper>
        )}
        {entry.standingRows?.some((r) => r.isAdvancing) && (
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1 }}>
            <AdvanceIcon sx={{ fontSize: 14, color: advancingColor }} />
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              Vị trí được đi tiếp vòng sau
            </Typography>
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

/* ================= main ================= */
export default function ModernGroupStage({
  groups = [],
  onOpenMatch,
  advancingColor = "#2e7d32",
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  if (!groups.length) {
    return (
      <Paper variant="outlined" sx={{ p: 2, textAlign: "center", borderRadius: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Không có bảng nào khớp bộ lọc.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          lg: groups.length > 1 ? "repeat(2, minmax(0, 1fr))" : "1fr",
        },
        gap: { xs: 2, md: 2.5 },
      }}
    >
      {groups.map((entry, i) => (
        <ModernGroupCard
          key={entry.key}
          entry={entry}
          index={entry.labelNumeric ? entry.labelNumeric - 1 : i}
          isDark={isDark}
          onOpenMatch={onOpenMatch}
          advancingColor={advancingColor}
        />
      ))}
    </Box>
  );
}

ModernGroupStage.propTypes = {
  groups: PropTypes.array,
  onOpenMatch: PropTypes.func,
  advancingColor: PropTypes.string,
};
