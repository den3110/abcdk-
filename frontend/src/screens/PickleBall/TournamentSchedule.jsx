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
  Grid,
  Card,
  CardHeader,
  CardContent,
  Chip,
  Stack,
  Typography,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  Alert,
  Skeleton,
  Button,
  TextField,
  MenuItem,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ScheduleIcon from "@mui/icons-material/Schedule";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import StadiumIcon from "@mui/icons-material/Stadium";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

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

/* ---------- helpers ---------- */
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

// ===== Group helpers (ổn định B) =====
function buildGroupIndex(bracket) {
  const byRegId = new Map();
  const order = new Map();
  (bracket?.groups || []).forEach((g, idx) => {
    const key = String(g.name || g.code || g._id || `${idx + 1}`);
    order.set(key, idx + 1); // Bảng 1,2,3...
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
  const name = [p1, p2].filter(Boolean).join(" / ");
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
  if (Array.isArray(m?.gameScores) && m.gameScores.length) {
    return m.gameScores.map((s) => `${s?.a ?? 0}-${s?.b ?? 0}`).join(", ");
  }
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

/* ---------- Chip row ---------- */
function ChipRow({ children, sx }) {
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        columnGap: 0.75,
        rowGap: 0.75,
        px: 0.5,
        py: 0.25,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
function StatusChip({ m }) {
  if (isLive(m))
    return <Chip size="small" color="warning" label="Đang diễn ra" />;
  if (isFinished(m))
    return <Chip size="small" color="success" label="Đã diễn ra" />;
  return <Chip size="small" color="info" label="Sắp diễn ra" />;
}
function ScoreChip({ text }) {
  if (!text) return null;
  return <Chip size="small" variant="outlined" label={text} />;
}
function WinnerChip({ m }) {
  const side = m?.winner === "A" ? "A" : m?.winner === "B" ? "B" : null;
  if (!side) return null;
  return (
    <Chip
      size="small"
      color="success"
      icon={<EmojiEventsIcon />}
      label={`Winner: ${teamNameFrom(m, side)}`}
    />
  );
}

/* ---------- Small components ---------- */
function SectionTitle({ children, right }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "flex-start", sm: "center" }}
      justifyContent="space-between"
      gap={1}
      mb={2}
    >
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {children}
      </Typography>
      {right}
    </Stack>
  );
}

/* ======== Bracket helpers để tính V tổng hợp ======== */
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
  return sum + 1; // V bắt đầu của bracket hiện tại
}

/* ---------- Court card ---------- */
function CourtCard({ court, onOpenMatch }) {
  const hasLive = court.live.length > 0;
  const hasQueue = court.queue.length > 0;

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 1.25,
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        mb={1}
        gap={1}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {court.name}
        </Typography>
        <ChipRow sx={{ px: 0 }}>
          {hasLive && (
            <Chip size="small" color="success" label="ĐANG DIỄN RA" />
          )}
          {hasQueue && (
            <Chip
              size="small"
              color="warning"
              icon={<ScheduleIcon fontSize="small" />}
              label={`${court.queue.length} trận tiếp theo`}
            />
          )}
        </ChipRow>
      </Stack>

      {/* LIVE */}
      {court.live.map((m) => (
        <Box
          key={m._id}
          onClick={() => onOpenMatch?.(m._id)}
          role="button"
          tabIndex={0}
          sx={{
            borderLeft: "4px solid",
            borderColor: "success.main",
            p: 1,
            borderRadius: 1,
            mb: 1,
            bgcolor: (t) =>
              t.palette.mode === "light" ? "success.50" : "success.900",
            cursor: "pointer",
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            gap={1}
            flexWrap="wrap"
          >
            <Stack direction="row" alignItems="center" gap={0.75}>
              <PlayArrowIcon fontSize="small" />
              <Typography fontWeight={700} sx={{ transition: "none" }}>
                {m.__displayCode}
              </Typography>
            </Stack>

            <Typography sx={{ opacity: 0.9 }}>
              {teamNameFrom(m, "A")} vs {teamNameFrom(m, "B")}
            </Typography>

            <Box sx={{ flex: 1 }} />

            <ChipRow sx={{ ml: { sm: 0.5 } }}>
              <ScoreChip text={scoreText(m)} />
              <StatusChip m={m} />
            </ChipRow>
          </Stack>
        </Box>
      ))}

      {/* QUEUE (KHÔNG hiển thị finished) */}
      {court.queue.length > 0 && (
        <List dense disablePadding>
          {court.queue.map((m) => (
            <ListItem key={m._id} disableGutters>
              <ListItemButton
                onClick={() => onOpenMatch?.(m._id)}
                sx={{ px: 0, py: 0.5, borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <ScheduleIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      alignItems={{ xs: "flex-start", sm: "center" }}
                      gap={1}
                      flexWrap="wrap"
                    >
                      <Typography fontWeight={700} sx={{ transition: "none" }}>
                        {m.__displayCode}
                      </Typography>
                      <Typography sx={{ opacity: 0.9 }}>
                        {teamNameFrom(m, "A")} vs {teamNameFrom(m, "B")}
                      </Typography>
                    </Stack>
                  }
                  secondary={
                    <ChipRow>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={m.bracket?.name || m.phase || "—"}
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={courtNameOf(m)}
                      />
                    </ChipRow>
                  }
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}

function MatchRow({ m, onOpenMatch }) {
  return (
    <ListItem
      disableGutters
      sx={{
        my: 0.75,
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: isLive(m)
          ? "success.light"
          : isFinished(m)
          ? "divider"
          : "info.light",
        bgcolor: isLive(m)
          ? (t) => (t.palette.mode === "light" ? "success.50" : "success.900")
          : "transparent",
      }}
    >
      <ListItemButton
        onClick={() => onOpenMatch?.(m._id)}
        sx={{
          py: { xs: 1, sm: 1.25 },
          px: 1,
          borderRadius: 1.5,
          alignItems: "flex-start",
        }}
      >
        <ListItemIcon sx={{ minWidth: 28, mt: 0.25 }}>
          {isLive(m) ? (
            <PlayArrowIcon fontSize="small" />
          ) : isFinished(m) ? (
            <EmojiEventsIcon fontSize="small" />
          ) : (
            <ScheduleIcon fontSize="small" />
          )}
        </ListItemIcon>

        <ListItemText
          primary={
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "flex-start", sm: "center" }}
              gap={1}
              flexWrap="wrap"
            >
              <Typography fontWeight={700} sx={{ transition: "none" }}>
                {m.__displayCode}
              </Typography>
              <Typography sx={{ opacity: 0.9 }}>
                {teamNameFrom(m, "A")} vs {teamNameFrom(m, "B")}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <ChipRow sx={{ mr: 0.5 }}>
                <ScoreChip text={scoreText(m)} />
                <StatusChip m={m} />
              </ChipRow>
            </Stack>
          }
          secondary={
            <ChipRow>
              <Chip
                size="small"
                variant="outlined"
                label={m.bracket?.name || m.phase || "—"}
              />
              <Chip size="small" variant="outlined" label={courtNameOf(m)} />
              {isFinished(m) && <WinnerChip m={m} />}
            </ChipRow>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

/* ---------- Page ---------- */
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
  const { data: verifyRes, isFetching: verifyingMgr } = useVerifyManagerQuery(
    id ? id : skipToken
  );
  const isManager = !!verifyRes?.isManager;
  const canEdit = isAdmin || isManager;
  const theme = useTheme();
  const upSm = useMediaQuery(theme.breakpoints.up("sm"));
  const upMd = useMediaQuery(theme.breakpoints.up("md"));

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all"); // all | live | upcoming | finished
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

  const {
    data: tournament,
    isLoading: tLoading,
    error: tError,
  } = useGetTournamentQuery(id);

  const {
    data: matchesResp,
    isLoading: mLoading,
    error: mError,
    refetch: refetchMatches,
  } = useListPublicMatchesByTournamentQuery({
    tid: id,
    params: { limit: 1000 },
  });

  const { data: brackets = [], refetch: refetchBrackets } =
    useListTournamentBracketsQuery(id, {
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    });

  const loading = tLoading || mLoading;
  const errorMsg =
    (tError && (tError.data?.message || tError.error)) ||
    (mError && (mError.data?.message || mError.error));

  /* ===== Realtime layer (fixed) ===== */
  const socket = useSocket();
  const liveMapRef = useRef(new Map()); // id → match
  const [liveBump, setLiveBump] = useState(0);
  const pendingRef = useRef(new Map());
  const rafRef = useRef(null);

  // NEW: nhớ state subscribe/join giữa các render
  const subscribedBracketsRef = useRef(new Set()); // Set<bracketId>
  const joinedMatchesRef = useRef(new Set()); // Set<matchId>

  // NEW: khóa ổn định; effect chỉ rerun khi danh sách id THỰC SỰ đổi
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
        if (typeof v === "object") {
          return {
            _id: v._id ?? (typeof v.id === "string" ? v.id : undefined),
            name:
              (typeof v.name === "string" && v.name) ||
              (typeof v.label === "string" && v.label) ||
              (typeof v.title === "string" && v.title) ||
              "",
          };
        }
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

  // 1) Đồng bộ state ban đầu từ API vào liveMap
  useEffect(() => {
    const mp = new Map();
    const list = matchesResp?.list || [];
    for (const m of list) if (m?._id) mp.set(String(m._id), m);
    liveMapRef.current = mp;
    setLiveBump((x) => x + 1);
  }, [matchesResp]);

  // Helper diff 2 tập id
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

  // 2) Đăng ký listeners CHỈ 1 lần cho mỗi mount của effect
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
      // Re-join những thứ đã nhớ (không nhân bản)
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

    // KHÔNG gọi onConnected() thủ công ở đây

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
    // chỉ phụ thuộc thứ cần thiết
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, queueUpsert, refetchMatches, refetchBrackets]);

  // 3) Đồng bộ SUBSCRIBE BRACKETS theo diff (không spam)
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
      // Khi unmount page: rời tất cả bracket rooms hiện có
      nextSet.forEach((bid) =>
        socket.emit("draw:unsubscribe", { bracketId: bid })
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, bracketsKey]);

  // 4) Đồng bộ JOIN/LEAVE MATCHES theo diff (không spam)
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

    // Nếu server có hỗ trợ match:leave
    removed.forEach((mid) => socket.emit("match:leave", { matchId: mid }));

    joinedMatchesRef.current = nextSet;

    return () => {
      // Khi unmount page: rời tất cả match rooms hiện có
      nextSet.forEach((mid) => socket.emit("match:leave", { matchId: mid }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, matchesKey]);

  /* ===== Dữ liệu đã merge realtime ===== */
  const matches = useMemo(
    () =>
      Array.from(liveMapRef.current.values()).filter(
        (m) => String(m?.tournament?._id || m?.tournament) === String(id)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, liveBump]
  );

  // Gom theo bracket để tính offset V
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

  // sau khi đã có `brackets`
  const groupMaps = useMemo(() => {
    const mp = new Map();
    (brackets || []).forEach((b) => mp.set(String(b._id), buildGroupIndex(b)));
    return mp;
  }, [brackets]);

  // helper: suy ra số B (1,2,3,...) từ match (ưu tiên map nhóm)
  const groupNumberFromMatch = useCallback(
    (m) => {
      const bid = String(m?.bracket?._id || m?.bracket || "");
      const maps = groupMaps.get(bid);
      if (!maps) return null;
      const aId = m?.pairA?._id && String(m.pairA._id);
      const bId = m?.pairB?._id && String(m.pairB._id);
      const ga = aId && maps.byRegId.get(aId);
      const gb = bId && maps.byRegId.get(bId);
      if (ga && gb && ga === gb) {
        return maps.order.get(ga) ?? null; // trả về số 1..N
      }
      return null;
    },
    [groupMaps]
  );
  const codeStickyRef = useRef(new Map());

  // Tính & gán __displayCode cho từng match (tránh lặp lại logic)
  const matchesWithCode = useMemo(() => {
    return (matches || []).map((m) => {
      const T = normMatchNo(m);
      let label = "Trận";

      if (isGroupMatch(m)) {
        const stageNo = Number(m?.bracket?.stage ?? m?.stage ?? 1) || 1;

        // Ưu tiên suy ra số B ổn định từ bracket; fallback normGroup
        const bFromMap = groupNumberFromMatch(m);
        const B = (bFromMap != null ? String(bFromMap) : normGroup(m)) || "";

        const parts = [];
        if (stageNo) parts.push(`V${stageNo}`);
        if (B) parts.push(`B${B}`);
        if (T) parts.push(`T${T}`);
        const candidate = parts.length ? parts.join("-") : "Trận";

        // Không downgrade: nếu trước đó có B mà lần này mất B → giữ mã cũ
        const prev = codeStickyRef.current.get(m._id);
        const candHasB = candidate.includes("-B");
        const prevHasB = typeof prev === "string" && prev.includes("-B");
        label = !candHasB && prevHasB ? prev : candidate;

        if (!prev || candHasB) codeStickyRef.current.set(m._id, label);
      } else {
        // KO/PO: dùng baseRoundStart để ra V đúng
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

  // thay các danh sách sử dụng nguồn matchesWithCode
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
    return entries;
  }, [allSorted]);

  const queueLimit = upMd ? 6 : upSm ? 4 : 3;

  return (
    <Container
      maxWidth="lg"
      disableGutters
      sx={{ px: { sm: 2 }, py: { xs: 2, sm: 3 } }}
    >
      {/* header */}
      <SectionTitle
        right={
          <Box sx={{ display: "flex", gap: 2 }}>
            {canEdit && (
              <Button
                component={RouterLink}
                to={`/tournament/${id}/manage`}
                variant="outlined"
                size="small"
              >
                Quản lý giải
              </Button>
            )}
            <Button
              component={RouterLink}
              to={`/tournament/${id}/bracket`}
              variant="outlined"
              size="small"
              startIcon={<ArrowBackIcon />}
            >
              Về sơ đồ
            </Button>
          </Box>
        }
      >
        Lịch thi đấu {tournament?.name ? `– ${tournament.name}` : ""}
      </SectionTitle>

      {/* filters */}
      <Box
        sx={{
          position: { xs: "sticky", md: "static" },
          top: { xs: 8, sm: 12 },
          zIndex: 2,
          bgcolor: "background.paper",
          border: { xs: "1px solid", md: "none" },
          borderColor: { xs: "divider", md: "transparent" },
          p: { xs: 1, sm: 0 },
          mb: 2,
          borderRadius: { xs: 0, md: 2 },
          boxShadow: { xs: 1, md: 0 },
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <TextField
            size="small"
            placeholder="Tìm mã trận, người chơi, sân, bracket..."
            fullWidth
            value={q}
            onChange={(e) => setQ(e.target.value)}
            inputProps={{ "aria-label": "Tìm kiếm trận đấu" }}
          />
          <TextField
            select
            size="small"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ width: { xs: "100%", sm: 220 } }}
          >
            <MenuItem value="all">Tất cả</MenuItem>
            <MenuItem value="live">Đang diễn ra</MenuItem>
            <MenuItem value="upcoming">Sắp diễn ra</MenuItem>
            <MenuItem value="finished">Đã diễn ra</MenuItem>
          </TextField>
        </Stack>
      </Box>

      {/* loading / error */}
      {(tLoading || mLoading) && (
        <Box my={3}>
          <Grid container spacing={{ xs: 0, md: 2 }}>
            <Grid item xs={12} md={5}>
              <Card
                sx={{
                  width: 1,
                  borderRadius: { xs: 0, md: 3 },
                  overflow: "hidden",
                }}
              >
                <CardHeader
                  avatar={<StadiumIcon color="primary" />}
                  title={<Skeleton width={160} />}
                  subheader={<Skeleton width={220} />}
                />
                <Divider />
                <CardContent>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} height={72} sx={{ mb: 1 }} />
                  ))}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={7}>
              <Card
                sx={{
                  width: 1,
                  borderRadius: { xs: 0, md: 3 },
                  overflow: "hidden",
                }}
              >
                <CardHeader
                  title={<Skeleton width={220} />}
                  subheader={<Skeleton width={160} />}
                />
                <Divider />
                <CardContent>
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} height={64} sx={{ mb: 1 }} />
                  ))}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
      )}

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMsg}
        </Alert>
      )}

      {!loading && !errorMsg && (
        <Grid container spacing={{ xs: 0, md: 2 }}>
          {/* LEFT: on-court */}
          <Grid
            item
            xs={12}
            md={5}
            sx={{
              "@media (max-width:625px)": { width: "100%", marginBottom: 4 },
            }}
          >
            <Card
              sx={{
                width: 1,
                borderRadius: { xs: 0, md: 3 },
                overflow: "hidden",
              }}
            >
              <CardHeader
                avatar={<StadiumIcon color="primary" />}
                title="Các trận đấu trên sân"
                subheader="Đang diễn ra & hàng chờ (không hiển thị đã diễn ra)"
                sx={{
                  "& .MuiCardHeader-avatar": { mr: 1 },
                  "& .MuiCardHeader-title": { fontWeight: 700 },
                }}
              />
              <Divider />
              <CardContent sx={{ pt: 2 }}>
                {courts.length === 0 && (
                  <Alert severity="info">
                    Chưa có trận nào đang diễn ra hoặc trong hàng chờ.
                  </Alert>
                )}
                <Stack spacing={2}>
                  {courts.map((c) => (
                    <CourtCard
                      key={c.name}
                      court={c}
                      onOpenMatch={openViewer}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* RIGHT: all matches */}
          <Grid
            item
            xs={12}
            md={7}
            sx={{
              "@media (max-width:625px)": { width: "100%", marginBottom: 4 },
            }}
          >
            <Card
              sx={{
                width: 1,
                borderRadius: { xs: 0, md: 3 },
                overflow: "hidden",
              }}
            >
              <CardHeader
                title="Danh sách tất cả các trận"
                subheader={`Sắp xếp theo thứ tự trận • ${filteredAll.length} trận`}
                sx={{ "& .MuiCardHeader-title": { fontWeight: 700 } }}
              />
              <Divider />
              <CardContent sx={{ pt: 1 }}>
                {filteredAll.length === 0 ? (
                  <Alert severity="info">Không có trận phù hợp bộ lọc.</Alert>
                ) : (
                  <List disablePadding>
                    {filteredAll.map((m) => (
                      <MatchRow key={m._id} m={m} onOpenMatch={openViewer} />
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <ResponsiveMatchViewer
        open={viewerOpen}
        matchId={selectedMatchId}
        onClose={closeViewer}
      />
    </Container>
  );
}
