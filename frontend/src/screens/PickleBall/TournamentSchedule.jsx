// src/pages/TournamentSchedule.jsx
/* eslint-disable react/prop-types */
import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
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
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import {
  useGetTournamentQuery,
  useListPublicMatchesByTournamentQuery,
  useListTournamentBracketsQuery,
  useVerifyManagerQuery,
} from "../../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";
import { useSocket } from "../../context/SocketContext";
import { skipToken } from "@reduxjs/toolkit/query";
import { useSelector } from "react-redux";

/* ---------- KEEPING HELPERS (LOGIC GIỮ NGUYÊN) ---------- */
const hasVal = (v) =>
  v === 0 ||
  typeof v === "number" ||
  (typeof v === "string" && v.trim() !== "");

function isGroupMatch(m) {
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
function normRound(m) {
  const r = m?.round ?? m?.stageRound ?? m?.r;
  if (!hasVal(r)) return "";
  const n = Number(r);
  return Number.isFinite(n) ? String(n) : String(r).trim();
}

// ===== Group helpers =====
function buildGroupIndex(bracket) {
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

function normGroup(m) {
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
    String(m?.status || "").toLowerCase()
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
function pairToName(pair) {
  if (!pair) return null;
  const p1 = pair.player1?.nickName || pair.player1?.fullName;
  const p2 = pair.player2?.nickName || pair.player2?.fullName;
  const name = [p1, p2].filter(Boolean).join(" & ");
  return name || null;
}
function seedToName(seed) {
  return seed?.label || null;
}
function teamNameFrom(m, side) {
  if (!m) return "TBD";
  const pair = side === "A" ? m.pairA : m.pairB;
  const seed = side === "A" ? m.seedA : m.seedB;
  return pairToName(pair) || seedToName(seed) || "TBD";
}
function scoreText(m) {
  if (typeof m?.scoreText === "string" && m.scoreText.trim())
    return m.scoreText;
  if (Array.isArray(m?.gameScores) && m.gameScores.length)
    return m.gameScores.map((s) => `${s?.a ?? 0}-${s?.b ?? 0}`).join(", ");
  return "";
}
function courtNameOf(m) {
  return (
    (m?.courtName && m.courtName.trim()) ||
    m?.court?.name ||
    m?.courtLabel ||
    "Chưa phân sân"
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
          ...(matchesOfThis || []).map((m) => Number(m.round || 1))
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

function computeBaseRoundStart(brackets, byBracket, current) {
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

const LiveMatchCard = ({ m, onOpen }) => (
  <Paper
    elevation={0}
    onClick={() => onOpen(m._id)}
    sx={{
      p: 1.5,
      bgcolor: "success.50",
      border: "1px solid",
      borderColor: "success.200",
      borderRadius: 2,
      cursor: "pointer",
      transition: "all 0.2s",
      "&:hover": { boxShadow: 2, borderColor: "success.main" },
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
        label="LIVE"
        color="success"
        size="small"
        icon={<PlayCircleOutlineIcon />}
        sx={{ fontWeight: 700, height: 20, fontSize: "0.7rem", px: 0.5 }}
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
        <TeamDisplay name={teamNameFrom(m, "A")} />
        <TeamDisplay name={teamNameFrom(m, "B")} />
      </Box>
      <Divider sx={{ borderStyle: "dashed", borderColor: "success.300" }} />
      <Typography
        variant="h6"
        align="center"
        color="success.800"
        fontWeight={800}
      >
        {scoreText(m) || "0 - 0"}
      </Typography>
    </Stack>
  </Paper>
);

const QueueMatchItem = ({ m, onOpen }) => (
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
        bgcolor: "grey.200",
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
        {teamNameFrom(m, "A")}
      </Typography>
      <Typography variant="caption" display="block" noWrap fontWeight={500}>
        vs {teamNameFrom(m, "B")}
      </Typography>
    </Box>
    <Chip
      label={m.bracket?.name?.substring(0, 6) || "—"}
      size="small"
      sx={{ height: 20, fontSize: "0.65rem" }}
    />
  </Stack>
);

function CourtPanel({ court, onOpenMatch }) {
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
          bgcolor: "grey.50",
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
              label={`${court.queue.length} chờ`}
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
            <LiveMatchCard key={m._id} m={m} onOpen={onOpenMatch} />
          ))
        ) : (
          <Box
            sx={{
              py: 2,
              textAlign: "center",
              bgcolor: "grey.50",
              borderRadius: 2,
              border: "1px dashed",
              borderColor: "divider",
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Sân trống
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
              Tiếp theo
            </Typography>
            {court.queue.slice(0, 3).map((m) => (
              <QueueMatchItem key={m._id} m={m} onOpen={onOpenMatch} />
            ))}
            {court.queue.length > 3 && (
              <Typography
                variant="caption"
                align="center"
                display="block"
                sx={{ mt: 0.5, color: "text.secondary" }}
              >
                +{court.queue.length - 3} trận khác...
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function CourtCarousel({ courts, onOpenMatch }) {
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
            "&:hover": { bgcolor: "grey.100" },
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
            <CourtPanel court={court} onOpenMatch={onOpenMatch} />
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
            "&:hover": { bgcolor: "grey.100" },
            display: { xs: "none", md: "flex" },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      )}
    </Box>
  );
}

function MatchListItem({ m, onOpenMatch }) {
  const finished = isFinished(m);
  const live = isLive(m);
  const scheduled = isScheduled(m);
  const borderColor = live ? "success.main" : "divider";
  const bgColor = live ? "#f0fdf4" : "background.paper";

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
          borderColor: live ? "success.main" : "primary.main",
        },
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 0.75,
          bgcolor: live ? "success.100" : "grey.100",
          borderBottom: "1px solid",
          borderColor: live ? "success.200" : "grey.200",
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
              bgcolor: "white",
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
            sx={{ color: live ? "success.700" : "text.secondary" }}
          >
            {courtNameOf(m)}
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
              name={teamNameFrom(m, "A")}
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
                label={scoreText(m) || "0 - 0"}
                color={live ? "success" : "default"}
                variant={live ? "filled" : "outlined"}
                sx={{
                  fontWeight: 800,
                  fontSize: "1rem",
                  height: 32,
                  px: 1,
                  borderColor: finished ? "text.disabled" : undefined,
                  color: finished ? "text.primary" : undefined,
                }}
              />
            ) : (
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  bgcolor: "grey.100",
                  color: "text.secondary",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  border: "1px dashed",
                  borderColor: "grey.400",
                }}
              >
                VS
              </Box>
            )}
            <Typography
              variant="caption"
              sx={{
                mt: 0.5,
                color: live ? "success.main" : "text.disabled",
                fontWeight: 600,
                fontSize: "0.65rem",
                textTransform: "uppercase",
              }}
            >
              {live ? "Đang đấu" : finished ? "Kết thúc" : "Chưa đấu"}
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
              name={teamNameFrom(m, "B")}
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
  const { userInfo } = useSelector((s) => s.auth || {});
  const roleStr = String(userInfo?.role || "").toLowerCase();
  const roles = new Set(
    [...(userInfo?.roles || []), ...(userInfo?.permissions || [])]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase())
  );
  const isAdmin = !!(
    userInfo?.isAdmin ||
    roleStr === "admin" ||
    roles.has("admin") ||
    roles.has("superadmin")
  );
  const { id } = useParams();
  const { data: verifyRes } = useVerifyManagerQuery(id ? id : skipToken);
  const isManager = !!verifyRes?.isManager;
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
  const { data: tournament, isLoading: tLoading } = useGetTournamentQuery(id);
  const {
    data: matchesResp,
    isLoading: mLoading,
    refetch: refetchMatches,
  } = useListPublicMatchesByTournamentQuery({
    tid: id,
    params: { limit: 1000 },
  });
  const {
    data: brackets = [],
    isLoading: bLoading,
    refetch: refetchBrackets,
  } = useListTournamentBracketsQuery(id, {
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const isLoading = tLoading || mLoading || bLoading;

  // Realtime Logic
  const socket = useSocket();
  const liveMapRef = useRef(new Map());
  const [liveBump, setLiveBump] = useState(0);
  const pendingRef = useRef(new Map());
  const rafRef = useRef(null);
  const subscribedBracketsRef = useRef(new Set());
  const joinedMatchesRef = useRef(new Set());
  const bracketsKey = useMemo(
    () =>
      (brackets || [])
        .map((b) => String(b._id))
        .filter(Boolean)
        .sort()
        .join(","),
    [brackets]
  );
  const matchesKey = useMemo(
    () =>
      ((matchesResp?.list || []).map((m) => String(m._id)) || [])
        .filter(Boolean)
        .sort()
        .join(","),
    [matchesResp]
  );

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
    [flushPending]
  );

  useEffect(() => {
    const mp = new Map();
    const list = matchesResp?.list || [];
    for (const m of list) if (m?._id) mp.set(String(m._id), m);
    liveMapRef.current = mp;
    setLiveBump((x) => x + 1);
  }, [matchesResp]);

  const diffSet = (currentSet, nextArr) => {
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

  useEffect(() => {
    if (!socket) return;
    const onUpsert = (payload) => queueUpsert(payload);
    const onRemove = (payload) => {
      const id = String(payload?.id ?? payload?._id ?? "");
      if (!id) return;
      if (liveMapRef.current.has(id)) {
        liveMapRef.current.delete(id);
        setLiveBump((x) => x + 1);
      }
    };
    const onRefilled = () => {
      refetchMatches();
      refetchBrackets();
    };
    const onConnected = () => {
      subscribedBracketsRef.current.forEach((bid) =>
        socket.emit("draw:subscribe", { bracketId: bid })
      );
      joinedMatchesRef.current.forEach((mid) => {
        socket.emit("match:join", { matchId: mid });
        socket.emit("match:snapshot:request", { matchId: mid });
      });
    };
    socket.on("connect", onConnected);
    socket.on("match:update", onUpsert);
    socket.on("match:snapshot", onUpsert);
    socket.on("score:updated", onUpsert);
    socket.on("match:deleted", onRemove);
    socket.on("draw:refilled", onRefilled);
    socket.on("bracket:updated", onRefilled);
    return () => {
      socket.off("connect", onConnected);
      socket.off("match:update", onUpsert);
      socket.off("match:snapshot", onUpsert);
      socket.off("score:updated", onUpsert);
      socket.off("match:deleted", onRemove);
      socket.off("draw:refilled", onRefilled);
      socket.off("bracket:updated", onRefilled);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [socket, queueUpsert, refetchMatches, refetchBrackets]);

  useEffect(() => {
    if (!socket) return;
    const nextIds =
      (brackets || []).map((b) => String(b._id)).filter(Boolean) ?? [];
    const { added, removed, nextSet } = diffSet(
      subscribedBracketsRef.current,
      nextIds
    );
    added.forEach((bid) => socket.emit("draw:subscribe", { bracketId: bid }));
    removed.forEach((bid) =>
      socket.emit("draw:unsubscribe", { bracketId: bid })
    );
    subscribedBracketsRef.current = nextSet;
    return () => {
      nextSet.forEach((bid) =>
        socket.emit("draw:unsubscribe", { bracketId: bid })
      );
    };
  }, [socket, bracketsKey]);

  useEffect(() => {
    if (!socket) return;
    const nextIds =
      (matchesResp?.list || []).map((m) => String(m._id)).filter(Boolean) ?? [];
    const { added, removed, nextSet } = diffSet(
      joinedMatchesRef.current,
      nextIds
    );
    added.forEach((mid) => {
      socket.emit("match:join", { matchId: mid });
      socket.emit("match:snapshot:request", { matchId: mid });
    });
    removed.forEach((mid) => socket.emit("match:leave", { matchId: mid }));
    joinedMatchesRef.current = nextSet;
    return () => {
      nextSet.forEach((mid) => socket.emit("match:leave", { matchId: mid }));
    };
  }, [socket, matchesKey]);

  // Aggregation
  const matches = useMemo(
    () =>
      Array.from(liveMapRef.current.values()).filter(
        (m) => String(m?.tournament?._id || m?.tournament) === String(id)
      ),
    [id, liveBump]
  );
  const byBracket = useMemo(() => {
    const m = {};
    (brackets || []).forEach((b) => (m[b._id] = []));
    (matches || []).forEach((mt) => {
      const bid = mt?.bracket?._id || mt?.bracket;
      if (!bid) return;
      if (!m[bid]) m[bid] = [];
      m[bid].push(mt);
    });
    return m;
  }, [brackets, matches]);
  const baseRoundStartMap = useMemo(() => {
    const mp = new Map();
    (brackets || []).forEach((b) => {
      mp.set(
        String(b._id),
        computeBaseRoundStart(brackets || [], byBracket, b)
      );
    });
    return mp;
  }, [brackets, byBracket]);
  const groupMaps = useMemo(() => {
    const mp = new Map();
    (brackets || []).forEach((b) => mp.set(String(b._id), buildGroupIndex(b)));
    return mp;
  }, [brackets]);
  const groupNumberFromMatch = useCallback(
    (m) => {
      const bid = String(m?.bracket?._id || m?.bracket || "");
      const maps = groupMaps.get(bid);
      if (!maps) return null;
      const aId = m?.pairA?._id && String(m.pairA._id);
      const bId = m?.pairB?._id && String(m.pairB._id);
      const ga = aId && maps.byRegId.get(aId);
      const gb = bId && maps.byRegId.get(bId);
      if (ga && gb && ga === gb) return maps.order.get(ga) ?? null;
      return null;
    },
    [groupMaps]
  );
  const codeStickyRef = useRef(new Map());
  const matchesWithCode = useMemo(() => {
    return (matches || []).map((m) => {
      const T = normMatchNo(m);
      let label = "Trận";
      if (isGroupMatch(m)) {
        const stageNo = Number(m?.bracket?.stage ?? m?.stage ?? 1) || 1;
        const bFromMap = groupNumberFromMatch(m);
        const B = (bFromMap != null ? String(bFromMap) : normGroup(m)) || "";
        const parts = [];
        if (stageNo) parts.push(`V${stageNo}`);
        if (B) parts.push(`B${B}`);
        if (T) parts.push(`T${T}`);
        const candidate = parts.length ? parts.join("-") : "Trận";
        const prev = codeStickyRef.current.get(m._id);
        const candHasB = candidate.includes("-B");
        const prevHasB = typeof prev === "string" && prev.includes("-B");
        label = !candHasB && prevHasB ? prev : candidate;
        if (!prev || candHasB) codeStickyRef.current.set(m._id, label);
      } else {
        const bid = String(m?.bracket?._id || m?.bracket || "");
        const base = baseRoundStartMap.get(bid) || 1;
        const rNum = Number(m?.round ?? 1);
        const Vdisp = Number.isFinite(rNum) ? base + (rNum - 1) : rNum || 1;
        const parts = [];
        if (Vdisp) parts.push(`V${Vdisp}`);
        if (T) parts.push(`T${T}`);
        label = parts.length ? parts.join("-") : "Trận";
      }
      return { ...m, __displayCode: label };
    });
  }, [matches, baseRoundStartMap, groupNumberFromMatch]);
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
        teamNameFrom(m, "A"),
        teamNameFrom(m, "B"),
        m.bracket?.name,
        courtNameOf(m),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(qnorm);
    });
  }, [allSorted, q, status]);

  const courts = useMemo(() => {
    const map = new Map();
    allSorted.forEach((m) => {
      const name = courtNameOf(m);
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
      String(n).toLowerCase().includes("chưa phân sân");
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
      return a.name.localeCompare(b.name, "vi");
    });
    return entries.filter((e) => !isUnassigned(e.name));
  }, [allSorted]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f8fafc", pb: 4 }}>
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
                  Lịch thi đấu
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
                  Quản lý giải
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
                Xem sơ đồ
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
            <ScheduleIcon color="primary" /> Tình trạng sân đấu
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
            <CourtCarousel courts={courts} onOpenMatch={openViewer} />
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              fontStyle="italic"
            >
              Chưa có thông tin sân đấu.
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
              <Tab label="Tất cả" value="all" />
              <Tab
                label="Đang diễn ra"
                value="live"
                iconPosition="start"
                icon={<PlayCircleOutlineIcon sx={{ fontSize: 18 }} />}
              />
              <Tab label="Sắp tới" value="upcoming" />
              <Tab label="Đã kết thúc" value="finished" />
            </Tabs>
            <TextField
              size="small"
              placeholder="Tìm mã trận, tên đội..."
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
                <MatchListItem key={m._id} m={m} onOpenMatch={openViewer} />
              ))
            ) : (
              <Box sx={{ py: 8, textAlign: "center", opacity: 0.6 }}>
                <SportsTennisIcon
                  sx={{ fontSize: 60, color: "grey.300", mb: 2 }}
                />
                <Typography>Không tìm thấy trận đấu nào</Typography>
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
