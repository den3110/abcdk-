// src/pages/MyTournamentsPage.jsx — items full width (normal MUI Container)
// Quy ước màu:
// - ongoing/live  → warning (cam)
// - upcoming/scheduled → primary (lam)
// - finished → success (lục)

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect, // ⬅️ NEW
  useRef, // ⬅️ NEW
} from "react";
import {
  Box,
  Stack,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Button,
  Skeleton,
  Container,
  useTheme,
  useMediaQuery,
  Collapse,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import LockIcon from "@mui/icons-material/Lock";
import LoginIcon from "@mui/icons-material/Login";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import EventIcon from "@mui/icons-material/Event";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PlaceIcon from "@mui/icons-material/Place";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useSelector } from "react-redux";
import { skipToken } from "@reduxjs/toolkit/query";
import { useNavigate } from "react-router-dom";
import { useListMyTournamentsQuery } from "../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./PickleBall/match/ResponsiveMatchViewer";
// ⬇️ NEW: điều chỉnh path theo dự án của bạn
import { useSocket } from "../context/SocketContext";

/* ================= Utils ================= */
const dateFmt = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};
const stripVN = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const nameWithNick = (p) => {
  if (!p) return "—";
  const nick = p.nickName || p.nickname || p.nick || p.alias;
  return nick?.trim() || p.fullName || p.name || "—";
};
const teamLabel = (team, eventType) => {
  if (!team) return "—";
  if (team.name) return team.name;
  const players =
    team.players ||
    team.members ||
    [team.player1, team.player2].filter(Boolean) ||
    [];
  if (!players.length) return "—";
  if (eventType === "single") return nameWithNick(players[0]);
  if (players.length === 1) return nameWithNick(players[0]);
  return `${nameWithNick(players[0])} & ${nameWithNick(players[1])}`;
};
function roundText(m) {
  if (m.roundName) return m.roundName;
  if (m.phase) return m.phase;
  if (Number.isFinite(m.rrRound)) return `Vòng bảng ${m.rrRound}`;
  if (Number.isFinite(m.swissRound)) return `Swiss ${m.swissRound}`;
  if (Number.isFinite(m.round)) return `Vòng ${m.round}`;
  return "—";
}

/* ========== Tone helpers (áp màu đồng bộ) ========== */
const toneToMuiColor = (tone) => {
  if (tone === "upcoming" || tone === "scheduled") return "primary"; // lam
  if (tone === "ongoing" || tone === "live") return "warning"; // cam
  if (tone === "finished") return "success"; // lục
  return "primary";
};

/* ================= Small UI bits ================= */
function ToggleChip({ active, label, onClick, tone }) {
  const color = toneToMuiColor(tone);
  return (
    <Chip
      label={label}
      onClick={onClick}
      variant={active ? "filled" : "outlined"}
      color={active ? color : "default"}
      size="small"
      sx={{ borderRadius: 999, fontWeight: 700 }}
    />
  );
}

function StatusChip({ status }) {
  // status của TRẬN
  const map = {
    live: { label: "Đang diễn ra", color: "warning" }, // cam
    finished: { label: "Đã kết thúc", color: "success" }, // lục
    scheduled: { label: "Sắp diễn ra", color: "primary" }, // lam
  };
  const conf = map[status] || map.scheduled;
  return (
    <Chip
      size="small"
      label={conf.label}
      color={conf.color}
      sx={{ fontWeight: 600 }}
    />
  );
}

function SmallMeta({ icon, text }) {
  const Icon = icon;
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      sx={{ minWidth: 0 }}
    >
      <Icon sx={{ fontSize: 16, color: "text.secondary" }} />
      <Typography variant="caption" color="text.secondary" noWrap>
        {text}
      </Typography>
    </Stack>
  );
}

/* ⬇️ NEW: scoreText ưu tiên, fallback gameScores/sets */
function formatScoreFromMatch(m) {
  if (typeof m?.scoreText === "string" && m.scoreText.trim()) {
    return m.scoreText.trim();
  }
  const arr =
    (Array.isArray(m?.gameScores) && m.gameScores.length && m.gameScores) ||
    (Array.isArray(m?.sets) && m.sets) ||
    [];
  if (!arr.length) return "—";
  return arr
    .map((s) => `${s.a ?? s.home ?? 0}-${s.b ?? s.away ?? 0}`)
    .join("  |  ");
}
function ScoreBadge({ m }) {
  const text = formatScoreFromMatch(m);
  return (
    <Box
      sx={{
        alignSelf: "flex-start",
        px: 1.25,
        py: 0.5,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: (t) =>
          t.palette.mode === "dark" ? "action.selected" : "grey.50",
      }}
    >
      <Typography fontWeight={600} variant="body2">
        {text}
      </Typography>
    </Box>
  );
}

/* ================= Rows / Cards ================= */
function MatchRow({ m, onOpen, eventType }) {
  const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
  const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
  const status = m.status || (m.winner ? "finished" : "scheduled");
  const court = m.courtName || m.court || "";
  const when = m.scheduledAt || m.startTime || m.time;

  const accent =
    status === "live"
      ? "warning.main" // cam
      : status === "finished"
      ? "success.main" // lục
      : "primary.main"; // lam

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      <CardActionArea onClick={() => onOpen?.(m)}>
        <Box sx={{ display: "flex", gap: 1.5, p: 1.5 }}>
          <Box sx={{ width: 4, borderRadius: 999, bgcolor: accent }} />
          <Stack sx={{ flex: 1, gap: 0.5, minWidth: 0 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ minWidth: 0 }}
            >
              <Typography noWrap fontWeight={600}>
                {teamLabel(a, eventType)}
              </Typography>
              <StatusChip status={status} />
            </Stack>
            <Typography noWrap fontWeight={600}>
              {teamLabel(b, eventType)}
            </Typography>
            {/* ⬇️ NEW: realtime score */}
            <ScoreBadge m={m} />
            <Stack
              direction="row"
              flexWrap="wrap"
              spacing={1.5}
              useFlexGap
              sx={{ mt: 0.5 }}
            >
              <SmallMeta icon={EventIcon} text={dateFmt(when)} />
              {!!court && (
                <SmallMeta icon={SportsTennisIcon} text={`Sân ${court}`} />
              )}
              <SmallMeta icon={ScheduleIcon} text={roundText(m)} />
            </Stack>
          </Stack>
          <Box sx={{ alignSelf: "center", pl: 0.5 }}>
            <ChevronRightIcon sx={{ color: "text.secondary" }} />
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  );
}

function Banner({ t, collapsed, onToggle }) {
  // status của GIẢI
  const statusText =
    t.status === "ongoing"
      ? "Đang diễn ra"
      : t.status === "finished"
      ? "Đã kết thúc"
      : "Sắp diễn ra";
  const statusColor =
    t.status === "ongoing"
      ? "warning"
      : t.status === "finished"
      ? "success"
      : "primary";
  const uri = t.image || t.cover || t.bannerUrl || null;

  return (
    <Box sx={{ width: "100%" }}>
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: { xs: 140, md: 180 },
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          overflow: "hidden",
          bgcolor: "#11161c",
        }}
      >
        {uri && (
          <Box
            component="img"
            src={uri}
            alt={t.name || "Giải đấu"}
            loading="lazy"
            style={{ objectFit: "cover" }}
            sx={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          />
        )}
        {/* overlay tối nhẹ */}
        <Box
          sx={{ position: "absolute", inset: 0, bgcolor: "rgba(0,0,0,0.22)" }}
        />
        {/* gradient đáy */}
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)",
          }}
        />
        <Stack
          direction="row"
          alignItems="flex-end"
          spacing={1.25}
          sx={{ position: "absolute", inset: 0, p: 1.75 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} color="#fff" noWrap>
              {t.name || "Giải đấu"}
            </Typography>
            {!!t.location && (
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                sx={{ mt: 0.5, opacity: 0.9, maxWidth: "100%" }}
              >
                <PlaceIcon sx={{ fontSize: 16, color: "#fff" }} />
                <Typography color="#fff" noWrap>
                  {t.location}
                </Typography>
              </Stack>
            )}
          </Box>

          {/* status tag theo quy ước màu + toggle collapse */}
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Chip
              label={statusText}
              color={statusColor}
              sx={{ fontWeight: 600, color: "#fff" }}
            />
            <IconButton
              size="small"
              onClick={onToggle}
              sx={{
                color: "#fff",
                bgcolor: "rgba(255,255,255,0.12)",
                "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
              }}
              title={collapsed ? "Mở chi tiết" : "Thu gọn"}
            >
              {collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </IconButton>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}

function TournamentCard({ t, onOpenMatch }) {
  // Card-level collapse: mặc định finished → collapse, còn lại mở
  const [collapsed, setCollapsed] = useState(t.status === "finished");

  const [expanded, setExpanded] = useState(false); // chỉ điều khiển "xem thêm" list trận
  const [matchQuery, setMatchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(
    new Set(["scheduled", "live", "finished"])
  );

  const matches = Array.isArray(t.matches) ? t.matches : [];

  const filteredMatches = useMemo(() => {
    const q = stripVN(matchQuery);
    return matches.filter((m) => {
      const status = m.status || (m.winner ? "finished" : "scheduled");
      if (!statusFilter.has(status)) return false;
      if (!q) return true;
      const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
      const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
      const hay = [
        teamLabel(a, t.eventType),
        teamLabel(b, t.eventType),
        roundText(m),
        m.courtName || m.court || "",
      ]
        .map(stripVN)
        .join(" | ");
      return hay.includes(q);
    });
  }, [matches, matchQuery, statusFilter, t.eventType]);

  const shown = expanded ? filteredMatches : filteredMatches.slice(0, 5);
  const hasMore = filteredMatches.length > shown.length;

  const toggleStatus = (key) =>
    setStatusFilter((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      if (n.size === 0) n.add(key);
      return n;
    });

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      <Banner
        t={t}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
      />

      {/* Phần nội dung có thể collapse toàn bộ */}
      <Collapse in={!collapsed} timeout="auto" unmountOnExit>
        <CardContent sx={{ p: { xs: 1.5, md: 2 }, pt: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <CalendarMonthIcon sx={{ fontSize: 18, color: "text.secondary" }} />
            <Typography variant="body2" color="text.secondary">
              {(t.startDate || t.startAt) && (t.endDate || t.endAt)
                ? `${dateFmt(t.startDate || t.startAt)}  →  ${dateFmt(
                    t.endDate || t.endAt
                  )}`
                : "—"}
            </Typography>
          </Stack>

          {/* SEARCH + FILTER TRẬN (chip có màu theo tone) */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "center" }}
          >
            <TextField
              value={matchQuery}
              onChange={(e) => setMatchQuery(e.target.value)}
              size="small"
              placeholder="Tìm trận (VĐV, vòng, sân...)"
              fullWidth
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: "text.secondary" }} />
                  </InputAdornment>
                ),
                endAdornment: matchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setMatchQuery("")}>
                      <CloseIcon />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <ToggleChip
                label="Sắp diễn ra"
                active={statusFilter.has("scheduled")}
                onClick={() => toggleStatus("scheduled")}
                tone="scheduled"
              />
              <ToggleChip
                label="Đang diễn ra"
                active={statusFilter.has("live")}
                onClick={() => toggleStatus("live")}
                tone="live"
              />
              <ToggleChip
                label="Đã kết thúc"
                active={statusFilter.has("finished")}
                onClick={() => toggleStatus("finished")}
                tone="finished"
              />
              {(!!matchQuery || statusFilter.size !== 3) && (
                <Button
                  onClick={() => {
                    setMatchQuery("");
                    setStatusFilter(new Set(["scheduled", "live", "finished"]));
                  }}
                  size="small"
                  variant="text"
                >
                  Reset
                </Button>
              )}
            </Stack>
          </Stack>

          {/* LIST MATCHES */}
          {filteredMatches.length === 0 ? (
            <Box
              sx={{
                border: "1px dashed",
                borderColor: "divider",
                borderRadius: 1,
                p: 2,
                textAlign: "center",
                mt: 1.25,
              }}
            >
              <Typography fontSize={28} mb={0.5}>
                🎾
              </Typography>
              <Typography color="text.secondary">
                Không có trận phù hợp bộ lọc.
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1.25} sx={{ mt: 1.25 }}>
              {shown.map((m) => (
                <MatchRow
                  key={m._id}
                  m={m}
                  onOpen={onOpenMatch}
                  eventType={t.eventType}
                />
              ))}
              {hasMore && (
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <Button
                    onClick={() => setExpanded((v) => !v)}
                    variant="outlined"
                    size="small"
                  >
                    {expanded
                      ? "Thu gọn"
                      : `Xem tất cả ${filteredMatches.length} trận`}
                  </Button>
                </Box>
              )}
            </Stack>
          )}
        </CardContent>
      </Collapse>
    </Card>
  );
}

/* ======= Login Prompt ======= */
function LoginPrompt() {
  const navigate = useNavigate();
  return (
    <Box
      sx={{ display: "grid", placeItems: "center", minHeight: "60vh", p: 3 }}
    >
      <Card
        variant="outlined"
        sx={{ maxWidth: 520, width: "100%", p: 2.5, borderRadius: 2 }}
      >
        <Stack spacing={1.25} alignItems="center" textAlign="center">
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.light",
            }}
          >
            <LockIcon sx={{ color: "primary.contrastText" }} />
          </Box>
          <Typography variant="h6" fontWeight={600}>
            Hãy đăng nhập để xem{" "}
            <Typography component="span" fontWeight={600}>
              Giải của tôi
            </Typography>
          </Typography>
          <Typography color="text.secondary">
            Sau khi đăng nhập, bạn sẽ thấy danh sách các giải mình đã tham gia,
            lịch thi đấu và kết quả cá nhân.
          </Typography>
          <Button
            onClick={() => navigate("/login")}
            variant="contained"
            startIcon={<LoginIcon />}
            size="medium"
          >
            Đăng nhập
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}

/* ================= Page ================= */
export default function MyTournamentsPage() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));
  const [viewerOpen, setViewerOpen] = useState(false);
  const [matchId, setMatchId] = useState(null);

  const { userInfo } = useSelector((s) => s?.auth || {});
  const isAuthed = !!(userInfo?.token || userInfo?._id || userInfo?.email);

  const queryArg = isAuthed
    ? { withMatches: 1, matchLimit: 200, page: 1, limit: 50 }
    : skipToken;
  const { data, isLoading, isError, refetch, isFetching } =
    useListMyTournamentsQuery(queryArg);

  // Chuẩn hóa danh sách tournaments từ API
  const tournamentsRaw = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }, [data]);

  /* ================= Realtime layer ================= */
  const socket = useSocket();

  // Map matchId -> match (đã merge realtime)
  const liveMapRef = useRef(new Map());
  const [liveBump, setLiveBump] = useState(0);
  const pendingRef = useRef(new Map());
  const rafRef = useRef(null);

  // Nhớ state đã join/subscribe để không spam
  const joinedMatchesRef = useRef(new Set()); // Set<matchId>
  const subscribedBracketsRef = useRef(new Set()); // Set<bracketId>

  // Danh sách match & bracket hiện có (dựa trên dữ liệu đang hiển thị)
  const allMatchesInitial = useMemo(() => {
    const arr = [];
    for (const t of tournamentsRaw) {
      if (Array.isArray(t.matches)) arr.push(...t.matches);
    }
    return arr;
  }, [tournamentsRaw]);

  const allMatchIdsKey = useMemo(
    () =>
      allMatchesInitial
        .map((m) => String(m?._id))
        .filter(Boolean)
        .sort()
        .join(","),
    [allMatchesInitial]
  );

  const allBracketIdsKey = useMemo(() => {
    const ids = [];
    for (const m of allMatchesInitial) {
      const bid =
        (m?.bracket && (m.bracket._id || m.bracket)) ||
        (m?.group && (m.group._id || m.group?.bracketId));
      if (bid) ids.push(String(bid));
    }
    return Array.from(new Set(ids)).sort().join(",");
  }, [allMatchesInitial]);

  const flushPending = useCallback(() => {
    if (!pendingRef.current.size) return;
    const mp = liveMapRef.current;
    for (const [mid, inc] of pendingRef.current) {
      const cur = mp.get(mid);
      // Không khóa version để tránh chặn các gói không có version
      mp.set(mid, { ...(cur || {}), ...inc });
    }
    pendingRef.current.clear();
    setLiveBump((x) => x + 1);
  }, []);

  const queueUpsert = useCallback(
    (incRaw) => {
      const inc = incRaw?.data ?? incRaw?.match ?? incRaw;
      if (!inc?._id) return;

      // Chuẩn hóa nhẹ vài entity để tránh phình object
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

  // 1) Seed map từ API (khi danh sách thay đổi)
  useEffect(() => {
    const mp = new Map();
    for (const m of allMatchesInitial) {
      if (m?._id) mp.set(String(m._id), m);
    }
    liveMapRef.current = mp;
    setLiveBump((x) => x + 1);
  }, [allMatchesInitial]);

  // Helper diff
  const diffSet = (curSet, nextArr) => {
    const nextSet = new Set(nextArr);
    const added = [];
    const removed = [];
    nextSet.forEach((id) => {
      if (!curSet.has(id)) added.push(id);
    });
    curSet.forEach((id) => {
      if (!nextSet.has(id)) removed.push(id);
    });
    return { added, removed, nextSet };
  };

  // 2) Đăng ký socket listeners 1 lần
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
      // Sơ đồ refill → gọi lại API
      refetch();
    };
    const onConnected = () => {
      // Re-join/subscribe lại theo các set đã nhớ
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
    socket.on("match:patched", onUpsert); // alias phổ biến
    socket.on("score:updated", onUpsert);
    socket.on("score:update", onUpsert); // alias phổ biến
    socket.on("match:deleted", onRemove);
    socket.on("draw:refilled", onRefilled);
    socket.on("bracket:updated", onRefilled);

    return () => {
      socket.off("connect", onConnected);
      socket.off("match:update", onUpsert);
      socket.off("match:snapshot", onUpsert);
      socket.off("match:patched", onUpsert);
      socket.off("score:updated", onUpsert);
      socket.off("score:update", onUpsert);
      socket.off("match:deleted", onRemove);
      socket.off("draw:refilled", onRefilled);
      socket.off("bracket:updated", onRefilled);

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, queueUpsert, refetch]);

  // 3) Subscribe/unsubscribe BRACKETS theo diff
  useEffect(() => {
    if (!socket) return;
    const nextIds = allBracketIdsKey ? allBracketIdsKey.split(",") : [];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, allBracketIdsKey]);

  // 4) Join/leave MATCH rooms theo diff
  useEffect(() => {
    if (!socket) return;
    const nextIds = allMatchIdsKey ? allMatchIdsKey.split(",") : [];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, allMatchIdsKey]);

  /* ======= Merge live vào tournaments ======= */
  const tournamentsLive = useMemo(() => {
    const getLive = (m) => liveMapRef.current.get(String(m?._id)) || m;
    return tournamentsRaw.map((t) => {
      const base = { ...t };
      base.matches = Array.isArray(t.matches) ? t.matches.map(getLive) : [];
      return base;
    });
  }, [tournamentsRaw, liveBump]);

  /* ======= Tìm kiếm & sort giải ======= */
  const [tourQuery, setTourQuery] = useState("");
  const [tourStatus, setTourStatus] = useState(
    new Set(["upcoming", "ongoing", "finished"])
  );

  // Sort: ongoing → upcoming → finished; trong nhóm: theo start tăng dần
  const tournaments = useMemo(() => {
    const q = stripVN(tourQuery);
    const filtered = tournamentsLive.filter((t) => {
      if (!tourStatus.has(t.status)) return false;
      if (!q) return true;
      const hay = [t.name, t.location].map(stripVN).join(" | ");
      return hay.includes(q);
    });

    const rank = { ongoing: 0, upcoming: 1, finished: 2 };
    const getStart = (t) =>
      new Date(t.startDate || t.startAt || 0).getTime() || 0;

    return filtered.slice().sort((a, b) => {
      const ra = rank[a.status] ?? 99;
      const rb = rank[b.status] ?? 99;
      if (ra !== rb) return ra - rb;
      return getStart(a) - getStart(b);
    });
  }, [tournamentsLive, tourQuery, tourStatus]);

  const handleOpenMatch = useCallback((m) => {
    setMatchId(m?._id);
    setViewerOpen(true);
  }, []);

  if (!isAuthed) return <LoginPrompt />;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      {/* Sticky header trong Container */}
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: (t) => t.zIndex.appBar,
          backdropFilter: "saturate(180%) blur(6px)",
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? "rgba(10,10,10,0.8)"
              : "rgba(255,255,255,0.8)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Stack spacing={1}>
            <Typography variant={"h5"} fontWeight={600}>
              Giải của tôi
            </Typography>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
              useFlexGap
            >
              <TextField
                value={tourQuery}
                onChange={(e) => setTourQuery(e.target.value)}
                size="small"
                placeholder="Tìm giải (tên, địa điểm)"
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ color: "text.secondary" }} />
                    </InputAdornment>
                  ),
                  endAdornment: tourQuery ? (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setTourQuery("")}>
                        <CloseIcon />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />

              {!!tournaments?.length && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ ml: { sm: "auto" } }}
                >
                  {tournaments.length} giải phù hợp
                </Typography>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* MAIN */}
      <Container maxWidth="xl" sx={{ pt: 2, pb: 4 }}>
        {isLoading ? (
          <Stack spacing={2}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={220} />
            ))}
          </Stack>
        ) : isError ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography color="error">
              Có lỗi khi tải dữ liệu. Vui lòng thử lại.
            </Typography>
            <Button onClick={refetch} sx={{ mt: 1 }} variant="outlined">
              Thử lại
            </Button>
          </Box>
        ) : tournaments.length === 0 ? (
          <Box
            sx={{
              py: 8,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
            }}
          >
            <Typography fontSize={42} mb={0.5}>
              🏆
            </Typography>
            <Typography fontWeight={600} variant="h6">
              Chưa có giải nào
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Tham gia giải để theo dõi lịch đấu và kết quả của bạn tại đây.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            {tournaments.map((t) => (
              <TournamentCard key={t._id} t={t} onOpenMatch={handleOpenMatch} />
            ))}
          </Stack>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Button
            onClick={refetch}
            disabled={isFetching}
            variant="outlined"
            size="small"
          >
            {isFetching ? "Đang làm mới..." : "Làm mới"}
          </Button>
        </Box>
      </Container>

      <ResponsiveMatchViewer
        open={viewerOpen}
        matchId={matchId}
        onClose={() => setViewerOpen(false)}
      />
    </Box>
  );
}
