// src/pages/TournamentSchedule.jsx
/* eslint-disable react/prop-types, no-unused-vars */
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
  Divider,
  Button,
  TextField,
  Tab,
  Tabs,
  Avatar,
  Paper,
  IconButton,
  Skeleton,
  useMediaQuery,
  useTheme,
} from "@mui/material"; // Đảm bảo đã import useMediaQuery, useTheme
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import ScheduleIcon from "@mui/icons-material/Schedule";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import SearchIcon from "@mui/icons-material/Search";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import {
  useGetTournamentQuery,
  useListPublicMatchesByTournamentQuery,
  useVerifyManagerQuery,
  useVerifyRefereeQuery,
} from "../../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";
import { useSocket } from "../../context/SocketContext";
import { useSocketRoomSet } from "../../hook/useSocketRoomSet";
import { useLanguage } from "../../context/LanguageContext";
import { useRegisterChatBotPageSnapshot } from "../../context/ChatBotPageContext.jsx";
import SEOHead from "../../components/SEOHead";
import { skipToken } from "@reduxjs/toolkit/query";
import { useSelector } from "react-redux";
import {
  getTournamentNameDisplayMode,
  getTournamentPairName,
} from "../../utils/tournamentName";

/* ---------- KEEPING HELPERS (LOGIC GIỮ NGUYÊN) ---------- */
const hasVal = (v) =>
  v === 0 ||
  typeof v === "number" ||
  (typeof v === "string" && v.trim() !== "");

function _isGroupMatch(m) {
  const t = String(m?.bracket?.type || m?.type || "")
    .toLowerCase()
    .trim();
  return (
    t.includes("group") ||
    t.includes("roundrobin") ||
    t.includes("round-robin") ||
    t === "rr"
  );
}
// ===== Group helpers =====
function _buildGroupIndex(bracket) {
  const byRegId = new Map();
  const order = new Map();
  (bracket?.groups || []).forEach((g, idx) => {
    const key = String(g.name || g.code || g._id || `${idx + 1}`);
    order.set(key, idx + 1);
    (g?.regIds || []).forEach((rid) => {
      if (rid) byRegId.set(String(rid), key);
    });
  });
  return { byRegId, order };
}

function _normGroup(m) {
  let g =
    m?.groupLabel ??
    m?.group?.label ??
    m?.poolLabel ??
    m?.pool?.label ??
    m?.group?.name ??
    m?.pool?.name ??
    m?.group ??
    m?.pool;
  if (!hasVal(g) && typeof m?.bracket?.name === "string") {
    const mm =
      m.bracket.name.match(/bảng\s*([A-Za-z0-9]+)/i) ||
      m.bracket.name.match(/group\s*([A-Za-z0-9]+)/i);
    if (mm?.[1]) g = mm[1];
  }
  if (!hasVal(g)) return "";
  const s = String(g).trim().toUpperCase();
  const digits = s.match(/\d+/)?.[0];
  if (digits) return String(Number(digits));
  if (/^[A-Z]$/.test(s)) return String(s.charCodeAt(0) - 64);
  const letter = s.match(/\b([A-Z])\b/);
  if (letter) return String(letter[1].charCodeAt(0) - 64);
  return s.replace(/\s+/g, "");
}
function normMatchNo(m) {
  const cand = m?.matchNo ?? m?.order ?? m?.seq;
  if (hasVal(cand)) {
    const n = Number(cand);
    if (Number.isFinite(n)) return String(n + 1);
    const d = String(cand).match(/\d+/)?.[0];
    if (d) return String(Number(d) + 1);
    return String(cand).trim();
  }
  const code = hasVal(m?.code) ? m.code : m?.globalCode;
  if (hasVal(code)) {
    const d = String(code).match(/\d+/)?.[0];
    if (d) return String(Number(d) + 1);
  }
  return "";
}

const isLive = (m) =>
  ["live", "ongoing", "playing", "inprogress"].includes(
    String(m?.status || "").toLowerCase(),
  );
const isFinished = (m) => String(m?.status || "").toLowerCase() === "finished";
const isScheduled = (m) =>
  [
    "scheduled",
    "upcoming",
    "pending",
    "queued",
    "assigning",
    "assigned",
  ].includes(String(m?.status || "").toLowerCase());

function orderKey(m) {
  const bo = m?.bracket?.order ?? 9999;
  const r = m?.round ?? 9999;
  const o = m?.order ?? 9999;
  const codeNum =
    typeof m?.code === "string" ? Number(m.code.replace(/[^\d]/g, "")) : 9999;
  const ts = m?.createdAt ? new Date(m.createdAt).getTime() : 9e15;
  return [bo, r, o, codeNum, ts];
}
function pairToName(pair, eventType = "double", displayMode = "nickname") {
  if (!pair) return null;
  return (
    getTournamentPairName(pair, eventType, displayMode) || pair?.name || null
  );
}
function seedToName(seed) {
  return seed?.label || null;
}
function teamNameFrom(
  m,
  side,
  eventTypeOrFallback = "double",
  displayModeOrFallback = "nickname",
  fallback = "TBD",
) {
  if (!m) return fallback;
  const normalizedEventType = String(eventTypeOrFallback || "").toLowerCase();
  const eventType =
    normalizedEventType === "single" || normalizedEventType === "double"
      ? normalizedEventType
      : String(m?.tournament?.eventType || m?.eventType || "double")
            .toLowerCase()
            .includes("single")
        ? "single"
        : "double";
  const displayMode =
    displayModeOrFallback === "fullName" || displayModeOrFallback === "nickname"
      ? displayModeOrFallback
      : getTournamentNameDisplayMode(m?.tournament);
  const resolvedFallback =
    normalizedEventType === "single" || normalizedEventType === "double"
      ? fallback
      : eventTypeOrFallback;
  const pair = side === "A" ? m.pairA : m.pairB;
  const seed = side === "A" ? m.seedA : m.seedB;
  return (
    pairToName(pair, eventType, displayMode) ||
    seedToName(seed) ||
    resolvedFallback
  );
}
function scoreText(m) {
  if (typeof m?.scoreText === "string" && m.scoreText.trim())
    return m.scoreText;
  if (Array.isArray(m?.gameScores) && m.gameScores.length)
    return m.gameScores.map((s) => `${s?.a ?? 0}-${s?.b ?? 0}`).join(", ");
  return "";
}
function courtNameOf(m, fallback = "Chưa phân sân") {
  return (
    (m?.courtName && m.courtName.trim()) ||
    (m?.courtStationName && m.courtStationName.trim()) ||
    (m?.courtStationLabel && m.courtStationLabel.trim()) ||
    m?.court?.name ||
    m?.courtLabel ||
    fallback
  );
}

/* ======== Bracket helpers ======== */
const ceilPow2 = (n) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
const readBracketScale = (br) => {
  const teamsFromRoundKey = (k) => {
    if (!k) return 0;
    const up = String(k).toUpperCase();
    if (up === "F") return 2;
    if (up === "SF") return 4;
    if (up === "QF") return 8;
    if (/^R\d+$/i.test(up)) return parseInt(up.slice(1), 10);
    return 0;
  };
  const fromKey =
    teamsFromRoundKey(br?.ko?.startKey) ||
    teamsFromRoundKey(br?.prefill?.roundKey);
  const fromPrefillPairs = Array.isArray(br?.prefill?.pairs)
    ? br.prefill.pairs.length * 2
    : 0;
  const fromPrefillSeeds = Array.isArray(br?.prefill?.seeds)
    ? br.prefill.seeds.length * 2
    : 0;
  const cands = [
    br?.drawScale,
    br?.targetScale,
    br?.maxSlots,
    br?.capacity,
    br?.size,
    br?.scale,
    br?.meta?.drawSize,
    br?.meta?.scale,
    fromKey,
    fromPrefillPairs,
    fromPrefillSeeds,
  ]
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= 2);
  if (!cands.length) return 0;
  return ceilPow2(Math.max(...cands));
};

function roundsCountForBracket(bracket, matchesOfThis = []) {
  const type = String(bracket?.type || "").toLowerCase();
  if (type === "group") return 1;
  if (type === "roundElim") {
    let k =
      Number(bracket?.meta?.maxRounds) ||
      Number(bracket?.config?.roundElim?.maxRounds) ||
      0;
    if (!k) {
      const maxR =
        Math.max(
          0,
          ...(matchesOfThis || []).map((m) => Number(m.round || 1)),
        ) || 1;
      k = Math.max(1, maxR);
    }
    return k;
  }
  const roundsFromMatches = (() => {
    const rs = (matchesOfThis || []).map((m) => Number(m.round || 1));
    if (!rs.length) return 0;
    const rmin = Math.min(...rs);
    const rmax = Math.max(...rs);
    return Math.max(1, rmax - rmin + 1);
  })();
  if (roundsFromMatches) return roundsFromMatches;
  const firstPairs =
    (Array.isArray(bracket?.prefill?.seeds) && bracket.prefill.seeds.length) ||
    (Array.isArray(bracket?.prefill?.pairs) && bracket.prefill.pairs.length) ||
    0;
  if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));
  const scale = readBracketScale(bracket);
  if (scale) return Math.ceil(Math.log2(scale));
  return 1;
}

function _computeBaseRoundStart(brackets, byBracket, current) {
  let sum = 0;
  for (const b of brackets) {
    if (String(b._id) === String(current._id)) break;
    const ms = byBracket?.[b._id] || [];
    sum += roundsCountForBracket(b, ms);
  }
  return sum + 1;
}

/* ---------- UI COMPONENTS ---------- */

const TeamDisplay = ({ name, isWinner, align = "left" }) => (
  <Stack
    direction={align === "right" ? "row-reverse" : "row"}
    alignItems="center"
    gap={1}
    sx={{ opacity: isWinner === false ? 0.5 : 1, width: "100%" }}
  >
    <Typography
      variant="body1"
      fontWeight={isWinner ? 700 : 500}
      sx={{
        color: isWinner ? "success.main" : "text.primary",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textAlign: align,
        width: "100%",
      }}
    >
      {name}
    </Typography>
    {isWinner && (
      <EmojiEventsIcon
        color="success"
        fontSize="small"
        sx={{ flexShrink: 0, fontSize: 18 }}
      />
    )}
  </Stack>
);

const LiveMatchCard = ({
  m,
  onOpen,
  eventType = "double",
  displayMode = "nickname",
}) => {
  const { t } = useLanguage();
  const teamFallback = t("tournaments.schedule.match.pendingTeam");

  return (
    <Paper
      elevation={0}
      onClick={() => onOpen(m._id)}
      sx={{
        p: 1.5,
        bgcolor: "warning.50",
        border: "1px solid",
        borderColor: "warning.200",
        borderRadius: 2,
        cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": { boxShadow: 2, borderColor: "warning.main" },
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mb={1}
      >
        <Chip
          label={t("tournaments.schedule.liveChip")}
          size="small"
          icon={<PlayCircleOutlineIcon />}
          sx={{ 
            bgcolor: "#f57c00", 
            color: "#fff", 
            fontWeight: 700, 
            height: 20, 
            fontSize: "0.7rem", 
            px: 0.5,
            "& .MuiChip-icon": { color: "#fff" }
          }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          fontWeight={600}
          noWrap
        >
          {m.__displayCode}
        </Typography>
      </Stack>
      <Stack spacing={1}>
        <Box>
          <TeamDisplay
            name={teamNameFrom(m, "A", eventType, displayMode, teamFallback)}
          />
          <TeamDisplay
            name={teamNameFrom(m, "B", eventType, displayMode, teamFallback)}
          />
        </Box>
        <Divider sx={{ borderStyle: "dashed", borderColor: "warning.300" }} />
        <Typography
          variant="h6"
          align="center"
          color="warning.800"
          fontWeight={800}
        >
          {scoreText(m) || t("tournaments.schedule.match.scoreFallback")}
        </Typography>
      </Stack>
    </Paper>
  );
};

const QueueMatchItem = ({
  m,
  onOpen,
  eventType = "double",
  displayMode = "nickname",
}) => {
  const { t } = useLanguage();
  const teamFallback = t("tournaments.schedule.match.pendingTeam");

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      onClick={() => onOpen(m._id)}
      sx={{
        p: 1,
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box
        sx={{
          minWidth: 24,
          height: 24,
          borderRadius: "50%",
          bgcolor: "action.selected",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.7rem",
          fontWeight: 700,
          color: "text.secondary",
        }}
      >
        {normMatchNo(m)}
      </Box>
      <Box sx={{ flex: 1, overflow: "hidden" }}>
        <Typography variant="caption" display="block" noWrap fontWeight={500}>
          {teamNameFrom(m, "A", eventType, displayMode, teamFallback)}
        </Typography>
        <Typography variant="caption" display="block" noWrap fontWeight={500}>
          {t("tournaments.schedule.match.versus")}{" "}
          {teamNameFrom(m, "B", eventType, displayMode, teamFallback)}
        </Typography>
      </Box>
      <Chip
        label={m.bracket?.name?.substring(0, 6) || "—"}
        size="small"
        sx={{ height: 20, fontSize: "0.65rem" }}
      />
    </Stack>
  );
};

function CourtPanel({
  court,
  onOpenMatch,
  eventType = "double",
  displayMode = "nickname",
}) {
  const { t } = useLanguage();
  const hasLive = court.live.length > 0;
  return (
    <Card
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 3,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        minWidth: { xs: 280, md: "auto" },
        maxWidth: { xs: 320, md: "100%" },
      }}
    >
      <Box
        sx={{
          p: 1.5,
          bgcolor: "action.hover",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            sx={{ overflow: "hidden" }}
          >
            <Avatar
              sx={{
                width: 24,
                height: 24,
                bgcolor: "primary.main",
                fontSize: "0.8rem",
              }}
            >
              <SportsTennisIcon sx={{ fontSize: 14 }} />
            </Avatar>
            <Typography variant="subtitle2" fontWeight={700} noWrap>
              {court.name}
            </Typography>
          </Stack>
          {court.queue.length > 0 && (
            <Chip
              size="small"
              label={t("tournaments.schedule.court.queue", {
                count: court.queue.length,
              })}
              sx={{ height: 20, fontSize: "0.7rem", flexShrink: 0 }}
            />
          )}
        </Stack>
      </Box>
      <CardContent
        sx={{
          p: 1.5,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
        }}
      >
        {hasLive ? (
          court.live.map((m) => (
            <LiveMatchCard
              key={m._id}
              m={m}
              onOpen={onOpenMatch}
              eventType={eventType}
              displayMode={displayMode}
            />
          ))
        ) : (
          <Box
            sx={{
              py: 2,
              textAlign: "center",
              bgcolor: "action.hover",
              borderRadius: 2,
              border: "1px dashed",
              borderColor: "divider",
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t("tournaments.schedule.court.empty")}
            </Typography>
          </Box>
        )}
        {court.queue.length > 0 && (
          <Box>
            <Typography
              variant="caption"
              fontWeight={700}
              color="text.secondary"
              sx={{ mb: 0.5, display: "block", textTransform: "uppercase" }}
            >
              {t("tournaments.schedule.court.next")}
            </Typography>
            {court.queue.slice(0, 3).map((m) => (
              <QueueMatchItem
                key={m._id}
                m={m}
                onOpen={onOpenMatch}
                eventType={eventType}
                displayMode={displayMode}
              />
            ))}
            {court.queue.length > 3 && (
              <Typography
                variant="caption"
                align="center"
                display="block"
                sx={{ mt: 0.5, color: "text.secondary" }}
              >
                {t("tournaments.schedule.court.moreMatches", {
                  count: court.queue.length - 3,
                })}
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function CourtCarousel({
  courts,
  onOpenMatch,
  eventType = "double",
  displayMode = "nickname",
}) {
  const scrollRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeft(scrollLeft > 0);
    setShowRight(scrollLeft < scrollWidth - clientWidth - 2);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.addEventListener("scroll", checkScroll);
      checkScroll();
      window.addEventListener("resize", checkScroll);
    }
    return () => {
      if (el) el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [courts]);

  const scroll = (direction) => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const scrollAmount = 320;
    const target =
      direction === "left"
        ? container.scrollLeft - scrollAmount
        : container.scrollLeft + scrollAmount;
    container.scrollTo({ left: target, behavior: "smooth" });
  };

  return (
    <Box sx={{ position: "relative", mx: -2, px: 2 }}>
      {showLeft && (
        <IconButton
          onClick={() => scroll("left")}
          sx={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2,
            bgcolor: "background.paper",
            boxShadow: 3,
            border: "1px solid",
            borderColor: "divider",
            "&:hover": { bgcolor: "action.hover" },
            display: { xs: "none", md: "flex" },
          }}
        >
          <ChevronLeftIcon />
        </IconButton>
      )}
      <Box
        ref={scrollRef}
        sx={{
          display: "flex",
          gap: 2,
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          pb: 2,
          px: { xs: 2, md: 6 },
          "&::-webkit-scrollbar": { display: "none" },
          scrollbarWidth: "none",
        }}
      >
        {courts.map((court) => (
          <Box
            key={court.name}
            sx={{
              minWidth: { xs: 280, md: 300 },
              maxWidth: { xs: 320, md: 320 },
              flexShrink: 0,
              scrollSnapAlign: "start",
            }}
          >
            <CourtPanel
              court={court}
              onOpenMatch={onOpenMatch}
              eventType={eventType}
              displayMode={displayMode}
            />
          </Box>
        ))}
      </Box>
      {showRight && (
        <IconButton
          onClick={() => scroll("right")}
          sx={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2,
            bgcolor: "background.paper",
            boxShadow: 3,
            border: "1px solid",
            borderColor: "divider",
            "&:hover": { bgcolor: "action.hover" },
            display: { xs: "none", md: "flex" },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      )}
    </Box>
  );
}

function MatchListItem({
  m,
  onOpenMatch,
  eventType = "double",
  displayMode = "nickname",
}) {
  const { t } = useLanguage();
  const theme = useTheme();
  
  const finished = isFinished(m);
  const live = isLive(m);
  const assigned = String(m?.status || "").toLowerCase() === "assigned";
  
  const teamFallback = t("tournaments.schedule.match.pendingTeam");
  
  // Custom precise color logic fulfilling "live=orange, finish=green, assigned=yellow, pending=grey"
  const isDark = theme.palette.mode === "dark";
  const borderColor = live ? "#f57c00" : finished ? "success.main" : assigned ? "#fbc02d" : "divider";
  
  const bgColor = live
    ? isDark ? "rgba(245, 124, 0, 0.1)" : "#fff3e0"
    : assigned
      ? isDark ? "rgba(251, 192, 45, 0.1)" : "#fffde7"
      : finished
        ? isDark ? "rgba(76, 175, 80, 0.05)" : "#f1f8e9"
      : "background.paper";

  const headColor = live
    ? isDark ? "rgba(245, 124, 0, 0.2)" : "#ffe0b2"
    : assigned
      ? isDark ? "rgba(251, 192, 45, 0.15)" : "#fff9c4"
      : finished
        ? isDark ? "rgba(76, 175, 80, 0.15)" : "#dcedc8"
      : "action.hover";

  const headBorderColor = live ? "warning.200" : finished ? "success.200" : assigned ? "#ffeb3b" : "divider";
  const highlightTextColor = live ? "#f57c00" : finished ? "success.main" : assigned ? "#fbc02d" : "text.secondary";

  return (
    <Paper
      elevation={0}
      onClick={() => onOpenMatch?.(m._id)}
      sx={{
        mb: 1.5,
        borderRadius: 3,
        border: "1px solid",
        borderColor: borderColor,
        bgcolor: bgColor,
        cursor: "pointer",
        transition: "all 0.2s ease-in-out",
        overflow: "hidden",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          borderColor: live ? "#e65100" : finished ? "success.dark" : assigned ? "#f9a825" : "primary.main",
        },
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 0.75,
          bgcolor: headColor,
          borderBottom: "1px solid",
          borderColor: headBorderColor,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            label={m.__displayCode}
            size="small"
            sx={{
              height: 20,
              fontSize: "0.65rem",
              fontWeight: 700,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
            }}
          />
          <Typography variant="caption" color="text.secondary" fontWeight={500}>
            {m.bracket?.name}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.5}>
          <Typography
            variant="caption"
            fontWeight={600}
            sx={{ color: live ? "#f57c00" : finished ? "success.700" : assigned ? "#f57f17" : "text.secondary" }}
          >
            {courtNameOf(m, t("tournaments.schedule.court.unassigned"))}
          </Typography>
        </Stack>
      </Box>
      <Box sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems="center"
          justifyContent="center"
          spacing={{ xs: 1.5, sm: 3 }}
        >
          <Box
            sx={{
              flex: 1,
              width: "100%",
              display: "flex",
              justifyContent: { xs: "center", sm: "flex-end" },
            }}
          >
            <TeamDisplay
              name={teamNameFrom(m, "A", eventType, displayMode, teamFallback)}
              isWinner={m.winner === "A"}
              align={window.innerWidth < 600 ? "center" : "right"}
            />
          </Box>
          <Box
            sx={{
              minWidth: 80,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {live || finished ? (
              <Chip
                label={
                  scoreText(m) || t("tournaments.schedule.match.scoreFallback")
                }
                variant={live ? "filled" : "outlined"}
                sx={{
                  bgcolor: live ? "#f57c00" : undefined,
                  color: live ? "#fff" : finished ? "success.main" : "text.disabled",
                  borderColor: finished ? "success.main" : "divider",
                  fontWeight: 800,
                  fontSize: "1rem",
                  height: 32,
                  px: 1,
                }}
              />
            ) : (
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  bgcolor: "action.hover",
                  color: "text.secondary",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  border: "1px dashed",
                  borderColor: "divider",
                }}
              >
                {t("tournaments.schedule.match.versus")}
              </Box>
            )}
            <Typography
              variant="caption"
              sx={{
                mt: 0.5,
                color: highlightTextColor,
                fontWeight: 600,
                fontSize: "0.65rem",
                textTransform: "uppercase",
              }}
            >
              {live
                ? t("tournaments.schedule.match.status.live", { defaultValue: "Đang diễn ra" })
                : finished
                  ? t("tournaments.schedule.match.status.finished", { defaultValue: "Đã diễn ra" })
                  : assigned
                    ? t("tournaments.schedule.match.status.assigned", { defaultValue: "Đã gán sân" })
                    : t("tournaments.schedule.match.status.pending", { defaultValue: "Chưa diễn ra" })}
            </Typography>
          </Box>
          <Box
            sx={{
              flex: 1,
              width: "100%",
              display: "flex",
              justifyContent: { xs: "center", sm: "flex-start" },
            }}
          >
            <TeamDisplay
              name={teamNameFrom(m, "B", eventType, displayMode, teamFallback)}
              isWinner={m.winner === "B"}
              align={window.innerWidth < 600 ? "center" : "left"}
            />
          </Box>
        </Stack>
      </Box>
    </Paper>
  );
}

/* ---------- MAIN PAGE ---------- */
export default function TournamentSchedule() {
  const { t } = useLanguage();
  const { userInfo } = useSelector((s) => s.auth || {});
  const roleStr = String(userInfo?.role || "").toLowerCase();
  const roles = new Set(
    [...(userInfo?.roles || []), ...(userInfo?.permissions || [])]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase()),
  );
  const isAdmin = !!(
    userInfo?.isAdmin ||
    roleStr === "admin" ||
    roles.has("admin") ||
    roles.has("superadmin")
  );
  const { id } = useParams();
  const { data: verifyRes } = useVerifyManagerQuery(
    userInfo?.token && id ? id : skipToken,
  );
  const { data: verifyRefereeRes } = useVerifyRefereeQuery(
    userInfo?._id && id ? id : skipToken,
  );
  const isManager = !!verifyRes?.isManager;
  const canReferee = !!verifyRefereeRes?.isReferee;
  const canOpenRefereeCenter = isAdmin || canReferee;
  const canEdit = isAdmin || isManager;
  const theme = useTheme();
  // Detect mobile để render skeleton
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState(null);

  const openViewer = (mid) => {
    setSelectedMatchId(mid);
    setViewerOpen(true);
  };
  const closeViewer = () => {
    setViewerOpen(false);
    setSelectedMatchId(null);
  };

  // API
  const {
    data: tournament,
    isLoading: tLoading,
    refetch: refetchTournament,
  } = useGetTournamentQuery(id);
  const eventType = useMemo(
    () =>
      String(tournament?.eventType || "double")
        .toLowerCase()
        .includes("single")
        ? "single"
        : "double",
    [tournament?.eventType],
  );
  const displayMode = getTournamentNameDisplayMode(tournament);
  const { data: matchesResp, isLoading: mLoading, refetch: refetchMatches } =
    useListPublicMatchesByTournamentQuery({
      tid: id,
    });
  const isLoading = tLoading || mLoading;

  // Realtime Logic
  const socket = useSocket();
  const liveMapRef = useRef(new Map());
  const [liveBump, setLiveBump] = useState(0);
  const pendingRef = useRef(new Map());
  const rafRef = useRef(null);
  const flushPending = useCallback(() => {
    if (!pendingRef.current.size) return;
    const mp = liveMapRef.current;
    for (const [mid, inc] of pendingRef.current) {
      const cur = mp.get(mid);
      const vNew = Number(inc?.liveVersion ?? inc?.version ?? 0);
      const vOld = Number(cur?.liveVersion ?? cur?.version ?? 0);
      const merged = !cur || vNew >= vOld ? { ...(cur || {}), ...inc } : cur;
      mp.set(mid, merged);
    }
    pendingRef.current.clear();
    setLiveBump((x) => x + 1);
  }, []);

  const queueUpsert = useCallback(
    (incRaw) => {
      const inc = incRaw?.data ?? incRaw?.match ?? incRaw;
      if (!inc?._id) return;
      const normalizeEntity = (v) => {
        if (v == null) return v;
        if (typeof v === "string" || typeof v === "number") return v;
        if (typeof v === "object")
          return {
            _id: v._id ?? (typeof v.id === "string" ? v.id : undefined),
            name:
              (typeof v.name === "string" && v.name) ||
              (typeof v.label === "string" && v.label) ||
              (typeof v.title === "string" && v.title) ||
              "",
          };
        return v;
      };
      if (inc.court) inc.court = normalizeEntity(inc.court);
      if (inc.venue) inc.venue = normalizeEntity(inc.venue);
      if (inc.location) inc.location = normalizeEntity(inc.location);
      pendingRef.current.set(String(inc._id), inc);
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flushPending();
      });
    },
    [flushPending],
  );

  useEffect(() => {
    const mp = new Map();
    const list = matchesResp?.list || [];
    for (const m of list) if (m?._id) mp.set(String(m._id), m);
    liveMapRef.current = mp;
    setLiveBump((x) => x + 1);
  }, [matchesResp]);

  const _diffSet = (currentSet, nextArr) => {
    const nextSet = new Set(nextArr);
    const added = [];
    const removed = [];
    nextSet.forEach((id) => {
      if (!currentSet.has(id)) added.push(id);
    });
    currentSet.forEach((id) => {
      if (!nextSet.has(id)) removed.push(id);
    });
    return { added, removed, nextSet };
  };

  const tournamentRoomIds = useMemo(() => (id ? [String(id)] : []), [id]);

  useSocketRoomSet(socket, tournamentRoomIds, {
    subscribeEvent: "tournament:subscribe",
    unsubscribeEvent: "tournament:unsubscribe",
    payloadKey: "tournamentId",
  });

  useEffect(() => {
    if (!socket) return;
    const onUpsert = (payload) => queueUpsert(payload);
    const onInvalidate = (payload) => {
      const tournamentId = String(payload?.tournamentId || "").trim();
      if (tournamentId && tournamentId !== String(id || "").trim()) return;
      refetchTournament?.();
      refetchMatches?.();
    };
    const onRemove = (payload) => {
      const id = String(payload?.id ?? payload?._id ?? "");
      if (!id) return;
      if (liveMapRef.current.has(id)) {
        liveMapRef.current.delete(id);
        setLiveBump((x) => x + 1);
      }
    };
    socket.on("tournament:match:update", onUpsert);
    socket.on("tournament:invalidate", onInvalidate);
    socket.on("match:deleted", onRemove);
    return () => {
      socket.off("tournament:match:update", onUpsert);
      socket.off("tournament:invalidate", onInvalidate);
      socket.off("match:deleted", onRemove);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [socket, queueUpsert, id, refetchMatches, refetchTournament]);

  // Aggregation
  const matches = useMemo(
    () =>
      Array.from(liveMapRef.current.values()).filter(
        (m) => String(m?.tournament?._id || m?.tournament) === String(id),
      ),
    [id, liveBump],
  );
  const unassignedCourtLabel = t("tournaments.schedule.court.unassigned");
  const pendingTeamLabel = t("tournaments.schedule.match.pendingTeam");
  const matchesWithCode = useMemo(() => {
    return (matches || []).map((m) => {
      const label =
        (typeof m?.code === "string" && m.code.trim()) ||
        (typeof m?.globalCode === "string" && m.globalCode.trim()) ||
        t("tournaments.schedule.fallbackMatchCode");
      const matchEventType = String(
        m?.tournament?.eventType || eventType || "double",
      )
        .toLowerCase()
        .includes("single")
        ? "single"
        : "double";
      const matchDisplayMode = m?.tournament
        ? getTournamentNameDisplayMode(m.tournament)
        : displayMode;
      return {
        ...m,
        tournament: {
          ...(m?.tournament || {}),
          eventType: matchEventType,
          nameDisplayMode: matchDisplayMode,
          displayNameMode: matchDisplayMode,
        },
        __displayCode: label,
      };
    });
  }, [matches, eventType, t, displayMode]);
  const allSorted = useMemo(() => {
    return [...matchesWithCode].sort((a, b) => {
      const ak = orderKey(a);
      const bk = orderKey(b);
      for (let i = 0; i < ak.length; i++)
        if (ak[i] !== bk[i]) return ak[i] - bk[i];
      return 0;
    });
  }, [matchesWithCode]);
  const filteredAll = useMemo(() => {
    const qnorm = q.trim().toLowerCase();
    return allSorted.filter((m) => {
      if (status === "live" && !isLive(m)) return false;
      if (
        status === "upcoming" &&
        !(isScheduled(m) && !isLive(m) && !isFinished(m))
      )
        return false;
      if (status === "finished" && !isFinished(m)) return false;
      if (!qnorm) return true;
      const hay = [
        m.__displayCode,
        teamNameFrom(m, "A", eventType, displayMode, pendingTeamLabel),
        teamNameFrom(m, "B", eventType, displayMode, pendingTeamLabel),
        m.bracket?.name,
        courtNameOf(m, unassignedCourtLabel),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(qnorm);
    });
  }, [
    allSorted,
    displayMode,
    eventType,
    pendingTeamLabel,
    q,
    status,
    unassignedCourtLabel,
  ]);

  const courts = useMemo(() => {
    const map = new Map();
    allSorted.forEach((m) => {
      const name = courtNameOf(m, unassignedCourtLabel);
      if (!map.has(name)) map.set(name, { live: [], queue: [] });
      if (isLive(m)) map.get(name).live.push(m);
      else if (!isFinished(m)) map.get(name).queue.push(m);
    });
    const byKey = (a, b) => {
      const ak = orderKey(a);
      const bk = orderKey(b);
      for (let i = 0; i < ak.length; i++)
        if (ak[i] !== bk[i]) return ak[i] - bk[i];
      return 0;
    };
    map.forEach((v) => {
      v.live.sort(byKey);
      v.queue.sort(byKey);
    });
    const entries = Array.from(map.entries()).map(([name, data]) => ({
      name,
      ...data,
    }));
    const isUnassigned = (n) =>
      String(n).toLowerCase() === unassignedCourtLabel.toLowerCase();
    const natNum = (s) => {
      const d = String(s).match(/\d+/)?.[0];
      return d ? Number(d) : Number.POSITIVE_INFINITY;
    };
    entries.sort((a, b) => {
      const au = isUnassigned(a.name);
      const bu = isUnassigned(b.name);
      if (au !== bu) return au ? 1 : -1;
      const an = natNum(a.name);
      const bn = natNum(b.name);
      if (an !== bn) return an - bn;
      return a.name.localeCompare(b.name);
    });
    return entries.filter((e) => !isUnassigned(e.name));
  }, [allSorted, unassignedCourtLabel]);
  const scheduleSectionLabel =
    status === "live"
      ? "Đang diễn ra"
      : status === "upcoming"
        ? "Sắp diễn ra"
        : status === "finished"
          ? "Đã kết thúc"
          : "Tất cả trận";
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "tournament_schedule",
      entityTitle:
        tournament?.name || t("tournaments.schedule.seoFallbackName"),
      sectionTitle: scheduleSectionLabel,
      pageSummary:
        "Trang lịch thi đấu của giải hiện tại với bộ lọc trạng thái, tìm kiếm và danh sách sân đang hoạt động.",
      activeLabels: [
        scheduleSectionLabel,
        q ? `Tìm: ${q}` : "",
        canEdit ? "Có quyền quản lý" : "Chế độ công khai",
      ],
      visibleActions: ["Tìm trận đấu", "Xem lịch sân", "Mở trận đấu"],
      highlights: courts
        .slice(0, 4)
        .map(
          (court) =>
            `${court.name}: ${court.live.length} live / ${court.queue.length} chờ`,
        ),
      metrics: [
        `Tổng trận: ${allSorted.length}`,
        `Đang hiển thị: ${filteredAll.length}`,
        `Sân hoạt động: ${courts.length}`,
        `Trận live: ${allSorted.filter((match) => isLive(match)).length}`,
      ],
    }),
    [
      tournament?.name,
      t,
      scheduleSectionLabel,
      q,
      canEdit,
      courts,
      allSorted,
      filteredAll,
    ],
  );

  useRegisterChatBotPageSnapshot(chatBotSnapshot);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", pb: 4 }}>
      <SEOHead
        title={t("tournaments.schedule.seoTitle", {
          name: tournament?.name || t("tournaments.schedule.seoFallbackName"),
        })}
        description={t("tournaments.schedule.seoDescription", {
          name: tournament?.name || t("tournaments.schedule.seoFallbackName"),
        })}
        path={`/tournament/${id}/schedule`}
      />
      <Paper
        square
        elevation={1}
        sx={{ bgcolor: "background.paper", pt: 2, pb: 2 }}
      >
        <Container maxWidth="xl">
          <Stack
            direction={{ xs: "column", md: "row" }}
            alignItems="center"
            justifyContent="space-between"
            gap={2}
          >
            <Box>
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography variant="h5" fontWeight={800} color="text.primary">
                  {t("tournaments.schedule.title")}
                </Typography>
                {tournament?.name && (
                  <Typography
                    variant="h5"
                    fontWeight={400}
                    color="text.secondary"
                    sx={{ display: { xs: "none", sm: "block" } }}
                  >
                    | {tournament.name}
                  </Typography>
                )}
              </Stack>
            </Box>
            <Box sx={{ display: "flex", gap: 1.5 }}>
              {canEdit && (
                <Button
                  component={RouterLink}
                  to={`/tournament/${id}/manage`}
                  variant="outlined"
                  color="inherit"
                  size="small"
                >
                  {t("tournaments.schedule.manageTournament")}
                </Button>
              )}
              {canOpenRefereeCenter && (
                <Button
                  component={RouterLink}
                  to={`/tournament/${id}/referee`}
                  variant="outlined"
                  color="warning"
                  size="small"
                  startIcon={<SportsTennisIcon />}
                >
                  Trọng tài
                </Button>
              )}
              <Button
                component={RouterLink}
                to={`/tournament/${id}/bracket`}
                variant="contained"
                disableElevation
                size="small"
                startIcon={<EmojiEventsIcon />}
              >
                {t("tournaments.schedule.viewBracket")}
              </Button>
            </Box>
          </Stack>
        </Container>
      </Paper>

      <Container maxWidth="xl" sx={{ mt: 3 }}>
        {/* SECTION 1: COURTS + SKELETON FIX */}
        <Box sx={{ mb: 4 }}>
          <Typography
            variant="h6"
            fontWeight={700}
            gutterBottom
            sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
          >
            <ScheduleIcon color="primary" />{" "}
            {t("tournaments.schedule.courtsTitle")}
          </Typography>

          {isLoading ? (
            // --- SKELETON RESPONSIVE FIX ---
            <Box
              sx={{
                display: "flex",
                gap: 2,
                overflow: "hidden", // Giấu phần thừa để tạo cảm giác hàng ngang
                mx: { xs: -2, md: 0 }, // Full width mobile
                px: { xs: 2, md: 0 },
              }}
            >
              {/* Mobile: Show 2, Desktop: Show 4 */}
              {[...Array(isMobile ? 2 : 4)].map((_, i) => (
                <Skeleton
                  key={i}
                  variant="rectangular"
                  sx={{
                    borderRadius: 3,
                    // Quan trọng: Set minWidth giống Card thật
                    minWidth: { xs: 280, md: 300 },
                    height: 250,
                    flexShrink: 0,
                  }}
                />
              ))}
            </Box>
          ) : courts.length > 0 ? (
            <CourtCarousel
              courts={courts}
              onOpenMatch={openViewer}
              eventType={eventType}
              displayMode={displayMode}
            />
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              fontStyle="italic"
            >
              {t("tournaments.schedule.courtsEmpty")}
            </Typography>
          )}
        </Box>

        {/* SECTION 2: MATCHES + SKELETON */}
        <Box>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
            gap={2}
            mb={2}
          >
            <Tabs
              value={status}
              onChange={(e, v) => setStatus(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 40,
                "& .MuiTab-root": {
                  fontWeight: 600,
                  minHeight: 40,
                  textTransform: "none",
                },
              }}
            >
              <Tab label={t("tournaments.schedule.tabs.all")} value="all" />
              <Tab
                label={t("tournaments.schedule.tabs.live")}
                value="live"
                iconPosition="start"
                icon={<PlayCircleOutlineIcon sx={{ fontSize: 18 }} />}
              />
              <Tab
                label={t("tournaments.schedule.tabs.upcoming")}
                value="upcoming"
              />
              <Tab
                label={t("tournaments.schedule.tabs.finished")}
                value="finished"
              />
            </Tabs>
            <TextField
              size="small"
              placeholder={t("tournaments.schedule.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              InputProps={{
                startAdornment: (
                  <SearchIcon
                    fontSize="small"
                    sx={{ mr: 1, color: "text.secondary" }}
                  />
                ),
              }}
              sx={{
                width: { xs: "100%", sm: 300 },
                bgcolor: "background.paper",
              }}
            />
          </Stack>

          <Box>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <Skeleton
                  key={i}
                  variant="rectangular"
                  height={80}
                  sx={{ mb: 1.5, borderRadius: 3 }}
                />
              ))
            ) : filteredAll.length > 0 ? (
              filteredAll.map((m) => (
                <MatchListItem
                  key={m._id}
                  m={m}
                  onOpenMatch={openViewer}
                  eventType={eventType}
                  displayMode={displayMode}
                />
              ))
            ) : (
              <Box sx={{ py: 8, textAlign: "center", opacity: 0.6 }}>
                <SportsTennisIcon
                  sx={{ fontSize: 60, color: "grey.300", mb: 2 }}
                />
                <Typography>{t("tournaments.schedule.noMatches")}</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Container>

      <ResponsiveMatchViewer
        open={viewerOpen}
        onClose={closeViewer}
        matchId={selectedMatchId}
      />
    </Box>
  );
}
