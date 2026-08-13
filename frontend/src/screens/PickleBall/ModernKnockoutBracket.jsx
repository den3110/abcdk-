/* eslint-disable react/prop-types */
// ModernKnockoutBracket.jsx
// Bản v4 — layer HIỂN THỊ mới cho sơ đồ knockout.
// KHÔNG đụng logic sinh label / resolveSideLabel (theo HANDOVER §10.12).
// Chỉ dịch nhãn tham chiếu "W-V1-T16" / "BYE" / "V3-B1-T2" sang human-readable
// và render card đẹp hơn với connector cong + accent màu theo vòng.

import { useMemo, useRef, useLayoutEffect, useState, useId } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Typography,
  Stack,
  Chip,
  Tooltip,
  alpha,
  darken,
  lighten,
  useTheme,
  Avatar,
} from "@mui/material";
import {
  EmojiEvents as TrophyIcon,
  AccessTime as ClockIcon,
  Stadium as CourtIcon,
  OndemandVideo as VideoIcon,
  HourglassEmpty as WaitingIcon,
  DoNotDisturbAlt as ByeIcon,
  FiberManualRecord as LiveDotIcon,
  MilitaryTech as MedalIcon,
} from "@mui/icons-material";

/* ---- inline scoreForSide (giữ đồng nhất với TournamentBracket.jsx) ---- */
function readScoreEntry(entry, key) {
  return Number(entry?.[key] ?? entry?.[key.toUpperCase()] ?? 0);
}
function gameScoresOf(match) {
  return (Array.isArray(match?.gameScores)
    ? match.gameScores
    : Array.isArray(match?.scores)
      ? match.scores
      : []
  ).map((item) => ({
    a: readScoreEntry(item, "a"),
    b: readScoreEntry(item, "b"),
  }));
}
function matchRules(match) {
  return {
    pointsToWin: Math.max(
      1,
      Number(match?.rules?.pointsToWin ?? match?.pointsToWin ?? 11) || 11,
    ),
    winByTwo: Boolean(match?.rules?.winByTwo ?? true),
  };
}
function isGameWin(a = 0, b = 0, pointsToWin = 11, winByTwo = true) {
  const max = Math.max(Number(a || 0), Number(b || 0));
  const min = Math.min(Number(a || 0), Number(b || 0));
  if (max < Number(pointsToWin || 11)) return false;
  return winByTwo ? max - min >= 2 : max - min >= 1;
}
function scoreForSide(m, side) {
  if (!m) return "";
  const games = gameScoresOf(m);
  const n = games.length;
  if (n >= 2) {
    const { pointsToWin, winByTwo } = matchRules(m);
    let wa = 0;
    let wb = 0;
    for (const g of games) {
      if (!isGameWin(g?.a, g?.b, pointsToWin, winByTwo)) continue;
      if ((g?.a ?? 0) > (g?.b ?? 0)) wa += 1;
      else if ((g?.b ?? 0) > (g?.a ?? 0)) wb += 1;
    }
    return side === "A" ? wa : wb;
  }
  if (n === 1) {
    const g = games[0];
    return side === "A" ? (g?.a ?? "") : (g?.b ?? "");
  }
  if (Number.isFinite(m.scoreA) && Number.isFinite(m.scoreB)) {
    return side === "A" ? m.scoreA : m.scoreB;
  }
  return "";
}

/* ================= constants ================= */
const CARD_W = 268;
const CARD_MIN_H = 128;
const COL_GAP = 72;
const ROW_BASE_GAP = 20;
const HEADER_H = 48;

/* ================= round accent palette =================
   Đếm NGƯỢC từ chung kết: CK vàng gold, BK hồng, TK tím, các vòng
   ngoài xanh dần — nhìn phát biết đang ở độ sâu nào của giải. */
const ACCENTS_FROM_FINAL = [
  "#f59e0b", // Chung kết — gold
  "#ec4899", // Bán kết — rose
  "#8b5cf6", // Tứ kết — violet
  "#3b82f6", // Vòng 16 — blue
  "#06b6d4", // Vòng 32 — cyan
  "#14b8a6", // Vòng 64 — teal
  "#64748b", // sâu hơn — slate
];

export function accentForRound(colIndex, totalCols) {
  const fromEnd = Math.max(0, totalCols - 1 - colIndex);
  return ACCENTS_FROM_FINAL[Math.min(fromEnd, ACCENTS_FROM_FINAL.length - 1)];
}

/* Palette xuôi cho các bracket không có "chung kết" (playoff/pre-qualifying) */
const ACCENTS_FORWARD = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#06b6d4",
  "#14b8a6",
];
export function accentForIndex(i) {
  return ACCENTS_FORWARD[Math.min(Math.max(0, i), ACCENTS_FORWARD.length - 1)];
}

/* Avatar màu ổn định theo tên đội */
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

/* ================= label translator ================= */
/**
 * Chuyển các nhãn tham chiếu dạng code (W-V1-T16, L-V2-T3, V1-B1-T2, BYE...)
 * sang human-readable Vietnamese. KHÔNG động vào code tạo nhãn — chỉ post-process.
 */
export function humanizeSeedRefLabel(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\s*BYE\s*$/i.test(s)) {
    return {
      text: "Miễn đấu",
      kind: "bye",
      tooltip: "Đội được vào thẳng vòng sau",
    };
  }

  // W-V{r}-T{t}  hoặc L-V{r}-T{t}
  let m = s.match(/^([WL])-V(\d+)-T(\d+)$/i);
  if (m) {
    const isW = m[1].toUpperCase() === "W";
    const v = m[2];
    const t = m[3];
    return {
      text: isW ? `Chờ thắng T${t}·V${v}` : `Chờ thua T${t}·V${v}`,
      kind: isW ? "winner-ref" : "loser-ref",
      tooltip: isW
        ? `Đội thắng Trận ${t} - Vòng ${v}`
        : `Đội thua Trận ${t} - Vòng ${v}`,
    };
  }

  // V{stage}-B{group}-T{rank}  — group standings
  m = s.match(/^V(\d+)-B([A-Za-z0-9]+)-T(\d+)$/i);
  if (m) {
    return {
      text: `Hạng ${m[3]} Bảng ${m[2]}`,
      kind: "group-rank",
      tooltip: `Đội đứng hạng ${m[3]} của bảng ${m[2]} (Giai đoạn ${m[1]})`,
    };
  }

  // V{stage}-T{rank} — stage rank (không có bảng)
  m = s.match(/^V(\d+)-T(\d+)$/i);
  if (m) {
    return {
      text: `Chờ T${m[2]}·V${m[1]}`,
      kind: "match-ref",
      tooltip: `Chờ kết quả Trận ${m[2]} - Vòng ${m[1]}`,
    };
  }

  // TBD / Registration
  if (/^(TBD|Registration|Chưa có đội)$/i.test(s)) {
    return { text: "Chưa có đội", kind: "pending", tooltip: "Chưa xác định" };
  }

  return null; // không match pattern → coi như tên đội thật, giữ nguyên
}

/* ================= small helpers ================= */
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

const isByeText = (s) => /^\s*BYE\s*$/i.test(String(s || ""));

function timeShort(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function courtNameLocal(m) {
  const c = m?.court;
  if (!c) return "";
  if (typeof c === "string") return c;
  return c?.name || c?.title || c?.label || "";
}

function hasVideoLocal(m) {
  return !!(
    m?.video ||
    m?.streamUrl ||
    m?.videoUrl ||
    m?.stream?.url ||
    m?.overlay?.live ||
    m?.overlay?.roomId ||
    m?.broadcast?.url
  );
}

function matchStatusMeta(m, theme) {
  const st = String(m?.status || "").toLowerCase();
  if (st === "finished") {
    return {
      key: "finished",
      label: "Đã đấu",
      bg: alpha(theme.palette.success.main, 0.14),
      fg: theme.palette.success.main,
      border: alpha(theme.palette.success.main, 0.35),
    };
  }
  if (st === "live") {
    return {
      key: "live",
      label: "Đang đấu",
      bg: alpha(theme.palette.warning.main, 0.16),
      fg: theme.palette.warning.dark,
      border: alpha(theme.palette.warning.main, 0.55),
    };
  }
  if (st === "assigned" || st === "queued") {
    return {
      key: "ready",
      label: "Sẵn sàng",
      bg: alpha(theme.palette.info.main, 0.12),
      fg: theme.palette.info.main,
      border: alpha(theme.palette.info.main, 0.3),
    };
  }
  return {
    key: "planned",
    label: "Chưa diễn ra",
    bg: alpha(theme.palette.text.primary, 0.05),
    fg: theme.palette.text.secondary,
    border: alpha(theme.palette.divider, 1),
  };
}

function matchCodeLabel(m, baseRoundStart) {
  if (!m) return "";
  const r = Number(m?.round ?? 1);
  const disp = Number.isFinite(r) ? baseRoundStart + (r - 1) : r;
  const t = Number.isFinite(Number(m?.order)) ? Number(m.order) + 1 : "?";
  return `V${disp}-T${t}`;
}

/* ================= Seed row (team line) ================= */
function TeamRow({
  label,
  score,
  isWinner,
  isLive,
  isFinished,
  onHoverEnter,
  onHoverLeave,
  isHovered,
  humanized,
  showAvatar = true,
}) {
  const theme = useTheme();
  const isPending = humanized && humanized.kind !== "team";
  const isBye = humanized?.kind === "bye";

  const displayLabel = humanized ? humanized.text : label;
  const tooltip = humanized?.tooltip || label;
  const teamColor = colorForName(displayLabel);

  const rowBg = isHovered
    ? alpha(theme.palette.primary.main, 0.14)
    : isWinner && isFinished
      ? `linear-gradient(90deg, ${alpha(theme.palette.success.main, 0.2)}, ${alpha(theme.palette.success.main, 0.04)})`
      : "transparent";

  const borderLeft = isWinner && isFinished
    ? `3px solid ${theme.palette.success.main}`
    : isHovered
      ? `3px solid ${theme.palette.primary.main}`
      : `3px solid transparent`;

  return (
    <Tooltip
      title={humanized ? tooltip : ""}
      arrow
      placement="top"
      enterDelay={400}
      disableHoverListener={!humanized}
    >
      <Box
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.75,
          borderRadius: 1.25,
          borderLeft,
          background: rowBg,
          transition: "background .15s ease",
          minHeight: 36,
        }}
      >
        {showAvatar && (
          <Avatar
            sx={{
              width: 28,
              height: 28,
              fontSize: 11,
              fontWeight: 800,
              bgcolor: isBye
                ? alpha(theme.palette.text.disabled, 0.15)
                : isPending
                  ? alpha(theme.palette.primary.main, 0.12)
                  : teamColor,
              color: isBye
                ? theme.palette.text.disabled
                : isPending
                  ? theme.palette.primary.main
                  : "#fff",
              boxShadow: isWinner && isFinished
                ? `0 0 0 2px ${theme.palette.success.main}`
                : isBye || isPending
                  ? "none"
                  : `0 0 0 2px ${alpha(teamColor, 0.25)}`,
              transition: "box-shadow .15s ease",
            }}
          >
            {isBye ? (
              <ByeIcon sx={{ fontSize: 14 }} />
            ) : isPending ? (
              <WaitingIcon sx={{ fontSize: 14 }} />
            ) : (
              initialsOf(displayLabel)
            )}
          </Avatar>
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            component="div"
            sx={{
              fontSize: 13,
              lineHeight: 1.25,
              fontWeight: isWinner && isFinished ? 800 : 500,
              color: isBye || isPending
                ? "text.secondary"
                : isWinner && isFinished
                  ? "success.dark"
                  : "text.primary",
              fontStyle: isBye || isPending ? "italic" : "normal",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayLabel}
          </Typography>
        </Box>
        <Box
          sx={{
            minWidth: 32,
            height: 28,
            px: 0.85,
            borderRadius: 1.25,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 800,
            fontSize: 14,
            color: isWinner && isFinished
              ? "#fff"
              : isLive
                ? "#fff"
                : "text.primary",
            background: isWinner && isFinished
              ? "linear-gradient(135deg, #22c55e, #15803d)"
              : isLive
                ? "linear-gradient(135deg, #f59e0b, #d97706)"
                : alpha(theme.palette.text.primary, 0.06),
            boxShadow: isWinner && isFinished
              ? `0 2px 8px ${alpha("#22c55e", 0.4)}`
              : isLive
                ? `0 2px 8px ${alpha("#f59e0b", 0.4)}`
                : "none",
          }}
        >
          {score !== "" && score != null ? score : "–"}
        </Box>
      </Box>
    </Tooltip>
  );
}

TeamRow.propTypes = {
  label: PropTypes.string,
  score: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  isWinner: PropTypes.bool,
  isLive: PropTypes.bool,
  isFinished: PropTypes.bool,
  onHoverEnter: PropTypes.func,
  onHoverLeave: PropTypes.func,
  isHovered: PropTypes.bool,
  humanized: PropTypes.object,
  showAvatar: PropTypes.bool,
};

/* ================= VS divider ================= */
function VsDivider({ accent }) {
  const theme = useTheme();
  return (
    <Box
      aria-hidden
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.25,
        my: -0.25,
      }}
    >
      <Box
        sx={{
          flex: 1,
          height: "1px",
          background: `linear-gradient(90deg, transparent, ${alpha(accent, 0.35)})`,
        }}
      />
      <Typography
        component="span"
        sx={{
          fontSize: 8.5,
          fontWeight: 900,
          letterSpacing: 1.2,
          color: alpha(accent, theme.palette.mode === "dark" ? 0.9 : 0.75),
          lineHeight: 1,
        }}
      >
        VS
      </Typography>
      <Box
        sx={{
          flex: 1,
          height: "1px",
          background: `linear-gradient(90deg, ${alpha(accent, 0.35)}, transparent)`,
        }}
      />
    </Box>
  );
}

VsDivider.propTypes = { accent: PropTypes.string };

/* ================= Seed card (exported for reuse) ================= */
export const MODERN_CARD_W = CARD_W;
export const MODERN_CARD_MIN_H = CARD_MIN_H;
export function ModernSeedCard({
  seed,
  onOpen,
  championMatchId,
  resolveSideLabel,
  resolveSideHighlightId,
  baseRoundStart = 1,
  hovered,
  setHovered,
  nodeKey,
  accent = "#3b82f6",
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const m = seed.__match || null;

  const rawA = resolveSideLabel?.(m, "A") ?? (m ? "—" : "Chưa có đội");
  const rawB = resolveSideLabel?.(m, "B") ?? (m ? "—" : "Chưa có đội");

  const humA = humanizeSeedRefLabel(rawA);
  const humB = humanizeSeedRefLabel(rawB);

  const isByeA = humA?.kind === "bye" || isByeText(rawA);
  const isByeB = humB?.kind === "bye" || isByeText(rawB);
  const isByeMatch = isByeA || isByeB;

  const status = String(m?.status || "").toLowerCase();
  const isFinished = status === "finished";
  const isLive = status === "live";
  const winA = !isByeMatch && isFinished && m?.winner === "A";
  const winB = !isByeMatch && isFinished && m?.winner === "B";

  const sA = m ? scoreForSide(m, "A") : "";
  const sB = m ? scoreForSide(m, "B") : "";

  const idA = m?.pairA
    ? String(m.pairA?._id || m.pairA?.id || "")
    : resolveSideHighlightId?.(m, "A") || "";
  const idB = m?.pairB
    ? String(m.pairB?._id || m.pairB?.id || "")
    : resolveSideHighlightId?.(m, "B") || "";
  const isHoverA = !!(hovered && idA && hovered === idA);
  const isHoverB = !!(hovered && idB && hovered === idB);
  const isCardHovered = isHoverA || isHoverB;

  const isChampion =
    !!m &&
    !!championMatchId &&
    String(m._id) === String(championMatchId) &&
    (winA || winB);

  const statusMeta = matchStatusMeta(m, theme);
  const code = matchCodeLabel(m, baseRoundStart);
  const timeStr = timeShort(m?.scheduledAt || m?.startedAt || m?.assignedAt);
  const courtStr = courtNameLocal(m);
  const hasVid = hasVideoLocal(m);

  const clickable = !!m && !m.__syntheticByeAdvance;

  const gold = "#f59e0b";
  const cardBorderColor = isChampion
    ? alpha(gold, 0.85)
    : isCardHovered
      ? theme.palette.primary.main
      : isLive
        ? alpha(theme.palette.warning.main, 0.7)
        : alpha(accent, isDark ? 0.45 : 0.32);

  const cardShadow = isChampion
    ? `0 0 0 2px ${alpha(gold, 0.5)}, 0 10px 30px ${alpha(gold, 0.35)}`
    : isCardHovered
      ? `0 10px 28px ${alpha(theme.palette.primary.main, 0.3)}`
      : isLive
        ? undefined // dùng animation glow
        : `0 2px 10px ${alpha(accent, isDark ? 0.25 : 0.14)}`;

  return (
    <Box
      data-mkb-card={nodeKey || undefined}
      onClick={() => clickable && onOpen?.(m)}
      sx={{
        position: "relative",
        width: CARD_W,
        cursor: clickable ? "pointer" : "default",
        borderRadius: 2.5,
        overflow: "visible",
        background: isDark
          ? alpha(theme.palette.background.paper, 0.92)
          : "#ffffff",
        backgroundImage: `linear-gradient(180deg, ${alpha(accent, isDark ? 0.12 : 0.06)}, transparent 42%)`,
        border: `1px solid ${cardBorderColor}`,
        borderTop: `3px solid ${isChampion ? gold : accent}`,
        boxShadow: cardShadow,
        animation: isLive
          ? "mkb-live-glow 1.6s ease-in-out infinite"
          : undefined,
        transition:
          "box-shadow .18s ease, border-color .18s ease, transform .12s ease",
        "&:hover": clickable
          ? {
              transform: "translateY(-2px)",
            }
          : undefined,
      }}
    >
      {isChampion && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: -16,
            right: -12,
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #fbbf24, #d97706)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 4px 14px ${alpha(gold, 0.6)}`,
            zIndex: 3,
            animation: "mkb-float 2.4s ease-in-out infinite",
          }}
        >
          <TrophyIcon sx={{ fontSize: 20, color: "#fff" }} />
        </Box>
      )}

      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderTopLeftRadius: "inherit",
          borderTopRightRadius: "inherit",
          background: `linear-gradient(135deg, ${alpha(accent, isDark ? 0.28 : 0.14)}, ${alpha(accent, isDark ? 0.1 : 0.04)})`,
          borderBottom: `1px dashed ${alpha(accent, 0.3)}`,
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
          {isLive && (
            <LiveDotIcon
              sx={{
                fontSize: 10,
                color: "warning.main",
                animation: "mkb-pulse 1.2s ease-in-out infinite",
              }}
            />
          )}
          <Typography
            component="span"
            sx={{
              fontSize: 11,
              fontWeight: 900,
              color: isDark ? lighten(accent, 0.35) : darken(accent, 0.12),
              letterSpacing: 0.4,
            }}
          >
            {code}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: 10.5,
              fontWeight: 700,
              px: 0.6,
              py: 0.15,
              borderRadius: 0.8,
              background: statusMeta.bg,
              color: statusMeta.fg,
              lineHeight: 1.2,
              ml: 0.5,
            }}
          >
            {statusMeta.label}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.75} alignItems="center">
          {timeStr && (
            <Tooltip title={`Giờ đấu: ${timeStr}`} arrow>
              <Stack direction="row" spacing={0.25} alignItems="center">
                <ClockIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
                  {timeStr}
                </Typography>
              </Stack>
            </Tooltip>
          )}
          {courtStr && (
            <Tooltip title={`Sân: ${courtStr}`} arrow>
              <Stack direction="row" spacing={0.25} alignItems="center">
                <CourtIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                <Typography
                  sx={{
                    fontSize: 10.5,
                    color: "text.secondary",
                    maxWidth: 60,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {courtStr}
                </Typography>
              </Stack>
            </Tooltip>
          )}
          {hasVid && (
            <Tooltip title="Có video / livestream" arrow>
              <VideoIcon sx={{ fontSize: 13, color: "primary.main" }} />
            </Tooltip>
          )}
        </Stack>
      </Box>

      {/* Team rows */}
      <Box sx={{ p: 0.75, display: "flex", flexDirection: "column", gap: 0.25 }}>
        <TeamRow
          label={rawA}
          score={sA}
          isWinner={winA}
          isLive={isLive}
          isFinished={isFinished}
          onHoverEnter={() => idA && setHovered?.(idA)}
          onHoverLeave={() => setHovered?.(null)}
          isHovered={isHoverA}
          humanized={humA}
        />
        <VsDivider accent={accent} />
        <TeamRow
          label={rawB}
          score={sB}
          isWinner={winB}
          isLive={isLive}
          isFinished={isFinished}
          onHoverEnter={() => idB && setHovered?.(idB)}
          onHoverLeave={() => setHovered?.(null)}
          isHovered={isHoverB}
          humanized={humB}
        />
      </Box>
    </Box>
  );
}

ModernSeedCard.propTypes = {
  seed: PropTypes.object.isRequired,
  onOpen: PropTypes.func,
  championMatchId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  resolveSideLabel: PropTypes.func,
  resolveSideHighlightId: PropTypes.func,
  baseRoundStart: PropTypes.number,
  hovered: PropTypes.string,
  setHovered: PropTypes.func,
  nodeKey: PropTypes.string,
  accent: PropTypes.string,
};

/* ================= Round header chip (exported for reuse) ================= */
export function ModernRoundChip({ title, count, accent, isFinal }) {
  return (
    <Chip
      size="small"
      icon={
        isFinal ? (
          <TrophyIcon sx={{ fontSize: 15, color: "#fff !important" }} />
        ) : (
          <MedalIcon sx={{ fontSize: 15, color: "#fff !important" }} />
        )
      }
      label={
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography
            component="span"
            sx={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.6,
              color: "#fff",
            }}
          >
            {title}
          </Typography>
          {count > 0 && (
            <Typography
              component="span"
              sx={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "rgba(255,255,255,0.85)",
                ml: 0.25,
              }}
            >
              · {count} trận
            </Typography>
          )}
        </Stack>
      }
      sx={{
        background: `linear-gradient(135deg, ${accent}, ${darken(accent, 0.25)})`,
        border: "none",
        fontWeight: 700,
        px: 1,
        boxShadow: `0 3px 10px ${alpha(accent, 0.4)}`,
        "& .MuiChip-icon": { ml: 0.5 },
      }}
    />
  );
}

ModernRoundChip.propTypes = {
  title: PropTypes.string,
  count: PropTypes.number,
  accent: PropTypes.string,
  isFinal: PropTypes.bool,
};

/* ================= Column (round) ================= */
function RoundColumn({
  round,
  colIndex,
  totalCols,
  totalPairs,
  onOpen,
  championMatchId,
  resolveSideLabel,
  resolveSideHighlightId,
  baseRoundStart,
  hovered,
  setHovered,
}) {
  const columnHeight = totalPairs * (CARD_MIN_H + ROW_BASE_GAP);
  const seeds = round?.seeds || [];
  const accent = accentForRound(colIndex, totalCols);
  const isFinal = colIndex === totalCols - 1;

  return (
    <Box
      sx={{
        position: "relative",
        width: CARD_W,
        flex: `0 0 ${CARD_W}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
      }}
    >
      {/* Round header */}
      <Box
        sx={{
          height: HEADER_H,
          mb: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ModernRoundChip
          title={round?.title || `Vòng ${colIndex + 1}`}
          count={seeds.length}
          accent={accent}
          isFinal={isFinal}
        />
      </Box>

      {/* Seeds container — dùng justify-content: space-around để tự chia đều */}
      <Box
        sx={{
          height: columnHeight,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
          alignItems: "stretch",
          gap: 0,
        }}
      >
        {seeds.map((seed, idx) => {
          const nodeKey = `mkb-${colIndex}-${idx}`;
          if (seed.__symmetricSpacer) {
            return (
              <Box
                key={String(seed?.id || nodeKey)}
                aria-hidden
                sx={{ minHeight: CARD_MIN_H, visibility: "hidden" }}
              />
            );
          }
          return (
            <Box
              key={String(seed?.id || nodeKey)}
              sx={{
                display: "flex",
                justifyContent: "center",
                minHeight: CARD_MIN_H,
              }}
            >
              <ModernSeedCard
                seed={seed}
                onOpen={onOpen}
                championMatchId={championMatchId}
                resolveSideLabel={resolveSideLabel}
                resolveSideHighlightId={resolveSideHighlightId}
                baseRoundStart={baseRoundStart}
                hovered={hovered}
                setHovered={setHovered}
                nodeKey={nodeKey}
                accent={accent}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

RoundColumn.propTypes = {
  round: PropTypes.object,
  colIndex: PropTypes.number.isRequired,
  totalCols: PropTypes.number.isRequired,
  totalPairs: PropTypes.number.isRequired,
  onOpen: PropTypes.func,
  championMatchId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  resolveSideLabel: PropTypes.func,
  resolveSideHighlightId: PropTypes.func,
  baseRoundStart: PropTypes.number,
  hovered: PropTypes.string,
  setHovered: PropTypes.func,
};

/* ================= shared keyframes (exported string) ================= */
export const MODERN_BRACKET_KEYFRAMES = `
  @keyframes mkb-pulse {
    0% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
    100% { opacity: 0.4; transform: scale(0.8); }
  }
  @keyframes mkb-live-glow {
    0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.45), 0 4px 16px rgba(245, 158, 11, 0.25); }
    50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0), 0 4px 20px rgba(245, 158, 11, 0.4); }
    100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0), 0 4px 16px rgba(245, 158, 11, 0.25); }
  }
  @keyframes mkb-float {
    0% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
    100% { transform: translateY(0); }
  }
`;

/* ================= background pattern (exported sx builder) ================= */
export function modernBracketBackdropSx(theme) {
  const dot = alpha(
    theme.palette.primary.main,
    theme.palette.mode === "dark" ? 0.14 : 0.1,
  );
  const glow = alpha(
    theme.palette.primary.main,
    theme.palette.mode === "dark" ? 0.08 : 0.05,
  );
  return {
    backgroundImage: `radial-gradient(circle at 50% 0%, ${glow}, transparent 65%), radial-gradient(${dot} 1px, transparent 1px)`,
    backgroundSize: `100% 100%, 22px 22px`,
    borderRadius: 2,
  };
}

/* ================= Main component ================= */
export default function ModernKnockoutBracket({
  rounds,
  roundsKey,
  onOpen,
  championMatchId,
  resolveSideLabel,
  resolveSideHighlightId,
  baseRoundStart = 1,
  zoom = 1,
}) {
  const theme = useTheme();
  const gradPrefix = useId().replace(/[^a-zA-Z0-9]/g, "");
  const rootRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });

  const totalPairs = useMemo(() => {
    if (!rounds?.length) return 1;
    return Math.max(1, ...rounds.map((r) => r?.seeds?.length || 0));
  }, [rounds]);

  const safeZoom =
    Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;

  useLayoutEffect(() => {
    if (!rootRef.current || !rounds?.length) {
      setConnectors([]);
      return undefined;
    }
    const root = rootRef.current;
    let raf = 0;
    const totalCols = rounds.length;

    const nodeMetrics = (key) => {
      const node = root.querySelector(`[data-mkb-card="${key}"]`);
      if (!node) return null;
      let left = 0;
      let top = 0;
      let cur = node;
      while (cur && cur !== root) {
        left += cur.offsetLeft || 0;
        top += cur.offsetTop || 0;
        cur = cur.offsetParent;
      }
      const w = node.offsetWidth || 0;
      const h = node.offsetHeight || 0;
      return {
        left,
        right: left + w,
        top,
        bottom: top + h,
        centerY: top + h / 2,
      };
    };

    const build = () => {
      const contentWidth =
        root.scrollWidth || root.offsetWidth || 0;
      const contentHeight =
        root.scrollHeight || root.offsetHeight || 0;

      setSvgSize((prev) =>
        Math.abs(prev.width - contentWidth) < 0.5 &&
        Math.abs(prev.height - contentHeight) < 0.5
          ? prev
          : { width: contentWidth, height: contentHeight },
      );

      const next = [];
      for (let ci = 0; ci < rounds.length - 1; ci++) {
        const seedsCur = rounds[ci]?.seeds || [];
        const seedsNext = rounds[ci + 1]?.seeds || [];
        for (let si = 0; si < seedsCur.length; si++) {
          if (seedsCur[si]?.__symmetricSpacer) continue;
          const targetIndex = Math.floor(si / 2);
          const targetSeed = seedsNext[targetIndex];
          if (!targetSeed || targetSeed.__symmetricSpacer) continue;

          const from = nodeMetrics(`mkb-${ci}-${si}`);
          const to = nodeMetrics(`mkb-${ci + 1}-${targetIndex}`);
          if (!from || !to) continue;

          const x1 = from.right;
          const y1 = from.centerY;
          const x2 = to.left;
          const y2 = to.centerY;
          const midX = (x1 + x2) / 2;
          const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
          next.push({
            key: `c-${ci}-${si}`,
            d,
            x1,
            y1,
            x2,
            y2,
            fromColor: accentForRound(ci, totalCols),
            toColor: accentForRound(ci + 1, totalCols),
          });
        }
      }
      setConnectors((prev) => {
        if (
          prev.length === next.length &&
          prev.every((c, i) => c.key === next[i]?.key && c.d === next[i]?.d)
        ) {
          return prev;
        }
        return next;
      });
    };

    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(build);
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    root.querySelectorAll("[data-mkb-card]").forEach((n) => ro.observe(n));
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [rounds, roundsKey]);

  if (!rounds?.length) return null;

  const columnHeight = totalPairs * (CARD_MIN_H + ROW_BASE_GAP);
  const rootWidth =
    rounds.length * CARD_W + Math.max(0, rounds.length - 1) * COL_GAP + 16;

  return (
    <Box
      sx={{
        width: "100%",
        overflowX: "auto",
        overflowY: "visible",
        ...modernBracketBackdropSx(theme),
      }}
    >
      <style>{MODERN_BRACKET_KEYFRAMES}</style>
      <Box
        sx={{
          position: "relative",
          width: rootWidth * safeZoom,
          minHeight: (columnHeight + HEADER_H + 24) * safeZoom,
          mx: "auto",
        }}
      >
        <Box
          ref={rootRef}
          sx={{
            position: "relative",
            width: "max-content",
            display: "flex",
            alignItems: "flex-start",
            gap: `${COL_GAP}px`,
            px: 1,
            pt: 0.5,
            pb: 2,
            transform: `scale(${safeZoom})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            width={svgSize.width}
            height={svgSize.height}
            viewBox={`0 0 ${svgSize.width || 0} ${svgSize.height || 0}`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: svgSize.width,
              height: svgSize.height,
              overflow: "visible",
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <defs>
              {connectors.map((c) => (
                <linearGradient
                  key={`g-${c.key}`}
                  id={`${gradPrefix}-${c.key}`}
                  gradientUnits="userSpaceOnUse"
                  x1={c.x1}
                  y1={c.y1}
                  x2={c.x2}
                  y2={c.y2}
                >
                  <stop offset="0%" stopColor={alpha(c.fromColor, 0.55)} />
                  <stop offset="100%" stopColor={alpha(c.toColor, 0.85)} />
                </linearGradient>
              ))}
            </defs>
            {connectors.map((c) => (
              <path
                key={c.key}
                d={c.d}
                fill="none"
                stroke={`url(#${gradPrefix}-${c.key})`}
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            ))}
          </svg>

          {rounds.map((round, ci) => (
            <Box key={`col-${ci}`} sx={{ position: "relative", zIndex: 1 }}>
              <RoundColumn
                round={round}
                colIndex={ci}
                totalCols={rounds.length}
                totalPairs={totalPairs}
                onOpen={onOpen}
                championMatchId={championMatchId}
                resolveSideLabel={resolveSideLabel}
                resolveSideHighlightId={resolveSideHighlightId}
                baseRoundStart={baseRoundStart}
                hovered={hovered}
                setHovered={setHovered}
              />
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

ModernKnockoutBracket.propTypes = {
  rounds: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string,
      seeds: PropTypes.array,
    }),
  ).isRequired,
  roundsKey: PropTypes.string,
  onOpen: PropTypes.func,
  championMatchId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  resolveSideLabel: PropTypes.func,
  resolveSideHighlightId: PropTypes.func,
  baseRoundStart: PropTypes.number,
  zoom: PropTypes.number,
};
