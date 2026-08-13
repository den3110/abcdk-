/* eslint-disable react/prop-types */
// ModernKnockoutBracket.jsx
// Bản v4 — layer HIỂN THỊ mới cho sơ đồ knockout.
// KHÔNG đụng logic sinh label / resolveSideLabel (theo HANDOVER §10.12).
// Chỉ dịch nhãn tham chiếu "W-V1-T16" / "BYE" / "V3-B1-T2" sang human-readable
// và render card đẹp hơn với connector cong.

import { useMemo, useRef, useLayoutEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Box,
  Typography,
  Stack,
  Chip,
  Tooltip,
  alpha,
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
const CARD_MIN_H = 116;
const COL_GAP = 68;
const ROW_BASE_GAP = 18;
const HEADER_H = 46;

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

  const rowBg = isHovered
    ? alpha(theme.palette.primary.main, 0.12)
    : isWinner && isFinished
      ? alpha(theme.palette.success.main, 0.12)
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
          minHeight: 34,
        }}
      >
        {showAvatar && (
          <Avatar
            sx={{
              width: 26,
              height: 26,
              fontSize: 11,
              fontWeight: 700,
              bgcolor: isBye
                ? alpha(theme.palette.text.disabled, 0.15)
                : isPending
                  ? alpha(theme.palette.primary.main, 0.12)
                  : isWinner && isFinished
                    ? theme.palette.success.main
                    : alpha(theme.palette.primary.main, 0.85),
              color: isBye
                ? theme.palette.text.disabled
                : isPending
                  ? theme.palette.primary.main
                  : "#fff",
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
              fontWeight: isWinner && isFinished ? 700 : 500,
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
            minWidth: 30,
            height: 26,
            px: 0.75,
            borderRadius: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
            fontSize: 14,
            color: isWinner && isFinished
              ? "success.dark"
              : isLive
                ? "warning.dark"
                : "text.primary",
            background: isWinner && isFinished
              ? alpha(theme.palette.success.main, 0.18)
              : isLive
                ? alpha(theme.palette.warning.main, 0.16)
                : alpha(theme.palette.text.primary, 0.05),
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
}) {
  const theme = useTheme();
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
        background: theme.palette.mode === "dark"
          ? alpha(theme.palette.background.paper, 0.9)
          : "#ffffff",
        border: `1px solid ${
          isCardHovered
            ? theme.palette.primary.main
            : statusMeta.border
        }`,
        boxShadow: isCardHovered
          ? `0 8px 24px ${alpha(theme.palette.primary.main, 0.28)}`
          : isLive
            ? `0 4px 16px ${alpha(theme.palette.warning.main, 0.28)}`
            : `0 1px 3px ${alpha(theme.palette.text.primary, 0.08)}`,
        transition: "box-shadow .18s ease, border-color .18s ease, transform .12s ease",
        "&:hover": clickable
          ? {
              transform: "translateY(-1px)",
            }
          : undefined,
      }}
    >
      {isChampion && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: -14,
            right: -10,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${theme.palette.warning.light}, ${theme.palette.warning.dark})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 4px 12px ${alpha(theme.palette.warning.main, 0.55)}`,
            zIndex: 3,
          }}
        >
          <TrophyIcon sx={{ fontSize: 18, color: "#fff" }} />
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
          background: alpha(statusMeta.fg, theme.palette.mode === "dark" ? 0.16 : 0.08),
          borderBottom: `1px dashed ${alpha(theme.palette.divider, 1)}`,
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
              fontWeight: 800,
              color: statusMeta.fg,
              letterSpacing: 0.4,
            }}
          >
            {code}
          </Typography>
          <Typography
            component="span"
            sx={{
              fontSize: 10.5,
              fontWeight: 600,
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
      <Box sx={{ p: 0.75, display: "flex", flexDirection: "column", gap: 0.5 }}>
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
};

/* ================= Column (round) ================= */
function RoundColumn({
  round,
  colIndex,
  totalPairs,
  onOpen,
  championMatchId,
  resolveSideLabel,
  resolveSideHighlightId,
  baseRoundStart,
  hovered,
  setHovered,
}) {
  const theme = useTheme();
  const columnHeight = totalPairs * (CARD_MIN_H + ROW_BASE_GAP);
  const seeds = round?.seeds || [];

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
        <Chip
          size="small"
          label={
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography
                component="span"
                sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}
              >
                {round?.title || `Vòng ${colIndex + 1}`}
              </Typography>
              <Typography
                component="span"
                sx={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "text.secondary",
                  ml: 0.25,
                }}
              >
                · {seeds.length} trận
              </Typography>
            </Stack>
          }
          sx={{
            background: alpha(theme.palette.primary.main, 0.08),
            color: theme.palette.primary.main,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
            fontWeight: 700,
            px: 1,
          }}
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
  totalPairs: PropTypes.number.isRequired,
  onOpen: PropTypes.func,
  championMatchId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  resolveSideLabel: PropTypes.func,
  resolveSideHighlightId: PropTypes.func,
  baseRoundStart: PropTypes.number,
  hovered: PropTypes.string,
  setHovered: PropTypes.func,
};

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
            highlight: false,
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
      }}
    >
      <style>{`
        @keyframes mkb-pulse {
          0% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
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
            {connectors.map((c) => (
              <path
                key={c.key}
                d={c.d}
                fill="none"
                stroke={alpha(theme.palette.primary.main, 0.45)}
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ))}
          </svg>

          {rounds.map((round, ci) => (
            <Box key={`col-${ci}`} sx={{ position: "relative", zIndex: 1 }}>
              <RoundColumn
                round={round}
                colIndex={ci}
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
