/* eslint-disable react/prop-types */
import React, { useMemo, useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  Card,
  CardActionArea,
  CardContent,
  Skeleton,
} from "@mui/material";
import {
  Groups as GroupsIcon,
  MonetizationOn as MonetizationOnIcon,
  CheckCircle as CheckCircleIcon,
  Movie as MovieIcon,
  SportsScore as SportsScoreIcon,
  Schedule as ScheduleIcon,
  PlayCircle as PlayCircleIcon,
  DoneAll as DoneAllIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";

import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
} from "../../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";
import { useSocket } from "../../context/SocketContext";

/* ===== helpers ===== */
const TYPE_LABEL = (t) => {
  const key = String(t || "").toLowerCase();
  if (key === "group") return "Vòng bảng";
  if (key === "po" || key === "playoff") return "Playoff";
  if (key === "knockout" || key === "ko") return "Knockout";
  if (key === "double_elim" || key === "doubleelim") return "Double Elim";
  if (key === "swiss") return "Swiss";
  if (key === "gsl") return "GSL";
  return t || "Khác";
};
const playerName = (p) =>
  p?.fullName || p?.name || p?.nickName || p?.nickname || "—";
const pairLabel = (pair) => {
  if (!pair) return "—";
  if (pair.name) return pair.name;
  const ps = [pair.player1, pair.player2].filter(Boolean).map(playerName);
  return ps.join(" / ") || "—";
};
const matchCode = (m) =>
  m?.code || `R${m?.round ?? "?"}#${(m?.order ?? 0) + 1}`;
const statusChip = (st) => {
  const map = {
    scheduled: { color: "default", label: "Chưa xếp" },
    queued: { color: "info", label: "Trong hàng chờ" },
    assigned: { color: "secondary", label: "Đã gán sân" },
    live: { color: "warning", label: "Đang thi đấu" },
    finished: { color: "success", label: "Đã kết thúc" },
  };
  const v = map[st] || { color: "default", label: st || "—" };
  return <Chip size="small" color={v.color} label={v.label} />;
};
const safeDate = (d) => (d ? new Date(d) : null);

// Ưu tiên trận có sân mà chưa đánh (assigned)
const hasCourt = (m) =>
  !!(m?.court?._id || m?.court || m?.courtId || m?.courtName);
const priorityRank = (m) => {
  const s = String(m?.status || "").toLowerCase();
  if (s === "assigned") return 0;
  if (hasCourt(m) && (s === "queued" || s === "scheduled")) return 1;
  if (s === "queued") return 2;
  if (s === "scheduled") return 3;
  return 4;
};

/* ===== Skeleton helpers ===== */
function StatCardSkeleton() {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Skeleton variant="circular" width={40} height={40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" width={80} />
          <Skeleton variant="text" width={60} />
        </Box>
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Skeleton variant="rounded" width={100} height={26} />
        <Skeleton variant="rounded" width={100} height={26} />
      </Stack>
    </Paper>
  );
}

function BracketCardSkeleton() {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: "100%" }}>
      <Skeleton variant="text" width="60%" />
      <Stack direction="row" spacing={1} sx={{ my: 0.5 }}>
        <Skeleton variant="rounded" width={70} height={22} />
        <Skeleton variant="rounded" width={60} height={22} />
      </Stack>
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="rounded" height={8} />
    </Paper>
  );
}

function TableSkeletonRows({ rows = 6, cols = 5 }) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <TableCell key={c}>
              <Skeleton variant="text" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

function MatchCardSkeleton() {
  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardContent sx={{ p: 1.5 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Skeleton variant="rounded" width={60} height={24} />
          <Skeleton variant="rounded" width={80} height={24} />
        </Stack>
        <Box mt={1}>
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="text" width="70%" />
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" mt={1}>
          <Skeleton variant="rounded" width={140} height={24} />
          <Skeleton variant="circular" width={24} height={24} />
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ===== small-screen match cards ===== */
function MatchCard({ m, onOpen, rightSlot }) {
  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardActionArea onClick={() => onOpen?.(m?._id)}>
        <CardContent sx={{ p: 1.5 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ minWidth: 0 }}
            >
              <Chip size="small" label={matchCode(m)} sx={{ flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary" noWrap>
                {m?.bracket?.name || m?.bracketName || ""}
              </Typography>
            </Stack>
            {rightSlot ?? statusChip(m?.status)}
          </Stack>

          <Box mt={1}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {pairLabel(m?.pairA)}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {pairLabel(m?.pairB)}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} alignItems="center" mt={1}>
            <Chip
              size="small"
              variant="outlined"
              label={
                safeDate(m?.scheduledAt)?.toLocaleString?.() ||
                safeDate(m?.finishedAt)?.toLocaleString?.() ||
                "—"
              }
            />
            {m?.video ? (
              <Tooltip title={m.video} arrow>
                <IconButton
                  size="small"
                  component="a"
                  href={m.video}
                  target="_blank"
                  rel="noopener"
                  onClick={(e) => e.stopPropagation()}
                >
                  <OpenInNewIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function TournamentOverviewPage() {
  const { id } = useParams();
  const me = useSelector((s) => s.auth?.userInfo || null);
  const theme = useTheme();
  const mdUp = useMediaQuery(theme.breakpoints.up("md"));
  const isMobile = useMediaQuery(theme?.breakpoints?.down("sm"));

  // 1) Data
  const {
    data: tour,
    isLoading: tourLoading,
    isFetching: tourFetching,
    error: tourErr,
  } = useGetTournamentQuery(id);
  const {
    data: regs = [],
    isLoading: regsLoading,
    isFetching: regsFetching,
    error: regsErr,
  } = useGetRegistrationsQuery(id);
  const {
    data: brackets = [],
    isLoading: brLoading,
    isFetching: brFetching,
    error: brErr,
    refetch: refetchBrackets,
  } = useAdminGetBracketsQuery(id);
  const {
    data: matchPage,
    isLoading: mLoading,
    isFetching: mFetching,
    error: mErr,
    refetch: refetchMatches,
  } = useAdminListMatchesByTournamentQuery({
    tid: id,
    page: 1,
    pageSize: 2000,
  });

  const loadingTour = tourLoading || tourFetching;
  const loadingRegs = regsLoading || regsFetching;
  const loadingBr = brLoading || brFetching;
  const loadingMatches = mLoading || mFetching;

  const allMatches = matchPage?.list || [];

  // 2) Permissions
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const isManager = useMemo(() => {
    if (!me?._id || !tour) return false;
    if (String(tour.createdBy) === String(me._id)) return true;
    if (Array.isArray(tour.managers)) {
      return tour.managers.some((m) => String(m?.user ?? m) === String(me._id));
    }
    return !!tour?.isManager;
  }, [tour, me]);
  const canManage = isAdmin || isManager;

  // 3) KPIs
  const regTotal = regs.length;
  const regPaid = useMemo(
    () => regs.filter((r) => r?.payment?.status === "Paid").length,
    [regs]
  );
  const regCheckin = useMemo(
    () => regs.filter((r) => !!r?.checkinAt).length,
    [regs]
  );
  const videoCount = useMemo(
    () => allMatches.filter((m) => !!m?.video).length,
    [allMatches]
  );

  const matchStatusCount = useMemo(() => {
    const init = {
      scheduled: 0,
      queued: 0,
      assigned: 0,
      live: 0,
      finished: 0,
      other: 0,
    };
    for (const m of allMatches) {
      const s = String(m?.status || "").toLowerCase();
      if (s in init) init[s] += 1;
      else init.other += 1;
    }
    return init;
  }, [allMatches]);

  // 4) Bracket progress
  const bracketProgress = useMemo(() => {
    const byId = new Map();
    (brackets || []).forEach((b) =>
      byId.set(String(b._id), {
        _id: String(b._id),
        name: b?.name || "Bracket",
        type: b?.type || "",
        stage: b?.stage,
        total: 0,
        finished: 0,
      })
    );
    for (const m of allMatches) {
      const bid = String(m?.bracket?._id || m?.bracket || "");
      if (!byId.has(bid)) continue;
      const rec = byId.get(bid);
      rec.total += 1;
      if (m?.status === "finished") rec.finished += 1;
    }
    return Array.from(byId.values()).sort((a, b) => {
      if ((a.stage ?? 0) !== (b.stage ?? 0))
        return (a.stage ?? 0) - (b.stage ?? 0);
      return (TYPE_LABEL(a.type) || "").localeCompare(TYPE_LABEL(b.type) || "");
    });
  }, [brackets, allMatches]);

  // 5) Upcoming / Recent matches
  const now = Date.now();
  const upcoming = useMemo(() => {
    const arr = allMatches
      .filter((m) => {
        const s = String(m?.status || "").toLowerCase();
        const future = (safeDate(m?.scheduledAt)?.getTime() ?? 0) >= now;
        return (
          s === "scheduled" || s === "queued" || s === "assigned" || future
        );
      })
      .sort((a, b) => {
        const pa = priorityRank(a);
        const pb = priorityRank(b);
        if (pa !== pb) return pa - pb;
        const ta =
          safeDate(a?.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const tb =
          safeDate(b?.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (ta !== tb) return ta - tb;
        return (a?.code || "").localeCompare(b?.code || "");
      });
    return arr;
  }, [allMatches, now]);

  const recent = useMemo(() => {
    const arr = allMatches
      .filter((m) => m?.status === "finished")
      .sort(
        (a, b) =>
          (safeDate(b?.finishedAt)?.getTime() ?? 0) -
          (safeDate(a?.finishedAt)?.getTime() ?? 0)
      );
    return arr;
  }, [allMatches]);

  // 6) Socket realtime (đã tránh refetch kép)
  const socket = useSocket();
  const joinedRef = useRef(new Set());
  const refetchTimerRef = useRef(null);
  const scheduleRefetchMatches = () => {
    if (refetchTimerRef.current) return;
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      refetchMatches?.();
    }, 300); // debounce 300ms
  };

  useEffect(() => {
    if (!socket) return;

    const bracketIds = (brackets || [])
      .map((b) => String(b._id))
      .filter(Boolean);
    const matchIds = (allMatches || [])
      .map((m) => String(m._id))
      .filter(Boolean);

    const subscribeRooms = () => {
      try {
        // theo dõi thay đổi draw/bracket
        bracketIds.forEach((bid) =>
          socket.emit("draw:subscribe", { bracketId: bid })
        );
        // join từng trận (không yêu cầu snapshot để tránh refetch kép)
        matchIds.forEach((mid) => {
          if (!joinedRef.current.has(mid)) {
            socket.emit("match:join", { matchId: mid });
            // ❌ KHÔNG gửi "match:snapshot:request" ở overview
            joinedRef.current.add(mid);
          }
        });
      } catch {}
    };

    const onConnected = () => subscribeRooms();
    const onMatchTouched = () => {
      // gom sự kiện rồi refetch
      scheduleRefetchMatches();
    };
    const onRefilled = () => {
      refetchBrackets?.();
      scheduleRefetchMatches();
    };

    socket.on("connect", onConnected);
    socket.on("match:update", onMatchTouched);
    // ❌ Bỏ handler snapshot để tránh refetch ngay sau mount
    // socket.on("match:snapshot", onMatchTouched);
    socket.on("score:updated", onMatchTouched);
    socket.on("match:deleted", onMatchTouched);
    socket.on("draw:refilled", onRefilled);
    socket.on("bracket:updated", onRefilled);

    subscribeRooms();

    return () => {
      socket.off("connect", onConnected);
      socket.off("match:update", onMatchTouched);
      socket.off("score:updated", onMatchTouched);
      socket.off("match:deleted", onMatchTouched);
      socket.off("draw:refilled", onRefilled);
      socket.off("bracket:updated", onRefilled);
      try {
        bracketIds.forEach((bid) =>
          socket.emit("draw:unsubscribe", { bracketId: bid })
        );
      } catch {}
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [socket, id, brackets, allMatches, refetchMatches, refetchBrackets]);

  // 7) Viewer popup
  const [viewer, setViewer] = useState({ open: false, matchId: null });
  const openMatch = (mid) => setViewer({ open: true, matchId: mid });
  const closeMatch = () => setViewer({ open: false, matchId: null });

  // Lỗi (inline)
  const anyError =
    tourErr?.data?.message ||
    regsErr?.data?.message ||
    brErr?.data?.message ||
    mErr?.data?.message;

  // Quyền
  const readyForPermission =
    !loadingTour && !loadingRegs && !loadingBr && !loadingMatches;
  if (readyForPermission && !canManage) {
    return (
      <Box p={3}>
        <Alert severity="warning">Bạn không có quyền truy cập trang này.</Alert>
        <Button component={Link} to={`/tournament/${id}`} sx={{ mt: 2 }}>
          Quay lại trang giải
        </Button>
      </Box>
    );
  }

  /* ===== UI ===== */
  return (
    <Box p={{ xs: 2, md: 3 }}>
      {anyError ? (
        <Box mb={2}>
          <Alert severity="error">{anyError || "Lỗi tải dữ liệu"}</Alert>
        </Box>
      ) : null}

      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1}
        mb={2}
      >
        {loadingTour ? (
          <Skeleton variant="text" width={260} height={36} />
        ) : (
          <Typography variant="h5" noWrap sx={{ maxWidth: "100%" }}>
            Tổng quan: {tour?.name}
          </Typography>
        )}
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button
            component={Link}
            to={`/tournament/${id}`}
            variant="outlined"
            size="small"
          >
            Tổng quan
          </Button>
          <Button
            component={Link}
            to={`/tournament/${id}/manage`}
            variant="outlined"
            size="small"
          >
            Quản lý giải
          </Button>
          <Button
            component={Link}
            to={`/tournament/${id}/draw`}
            variant="contained"
            size="small"
          >
            Bốc thăm
          </Button>
        </Stack>
      </Stack>

      {/* KPI cards */}
      <Grid container spacing={1.5}>
        {/* Tổng đăng ký / Paid / Check-in */}
        <Grid
          item
          xs={12}
          sm={6}
          md={3}
          sx={{ width: isMobile ? "100%" : "auto" }}
        >
          {loadingRegs ? (
            <StatCardSkeleton />
          ) : (
            <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    bgcolor: "action.hover",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <GroupsIcon />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Tổng đăng ký
                  </Typography>
                  <Typography variant="h6" noWrap>
                    {regTotal}
                  </Typography>
                </Box>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
              >
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<MonetizationOnIcon fontSize="small" />}
                  label={`Đã nộp: ${regPaid}`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<CheckCircleIcon fontSize="small" />}
                  label={`Check-in: ${regCheckin}`}
                />
              </Stack>
            </Paper>
          )}
        </Grid>

        {/* Trạng thái trận */}
        <Grid item xs={12} sm={6} md={3}>
          <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  bgcolor: "action.hover",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <SportsScoreIcon />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  Trận theo trạng thái
                </Typography>
                {loadingMatches ? (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ mt: 0.5 }}
                    flexWrap="wrap"
                  >
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton
                        key={i}
                        variant="rounded"
                        width={70}
                        height={24}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {Object.entries(matchStatusCount).map(([k, v]) =>
                      k === "other" || v === 0 ? null : (
                        <Chip
                          key={k}
                          size="small"
                          sx={{ mr: 0.5, mb: 0.5 }}
                          label={`${k}:${v}`}
                        />
                      )
                    )}
                  </Typography>
                )}
              </Box>
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.75}>
              {["scheduled", "queued", "assigned", "live", "finished"].map(
                (k) => {
                  if (loadingMatches) {
                    return (
                      <Box key={k}>
                        <Skeleton variant="text" width={120} />
                        <Skeleton variant="rounded" height={6} />
                      </Box>
                    );
                  }
                  const total = allMatches.length || 1;
                  const val = matchStatusCount[k] || 0;
                  const pct = Math.round((val * 100) / total);
                  return (
                    <Box key={k}>
                      <Typography variant="caption" color="text.secondary">
                        {k} • {val}/{allMatches.length}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{ height: 6, borderRadius: 1 }}
                      />
                    </Box>
                  );
                }
              )}
            </Stack>
          </Paper>
        </Grid>

        {/* Video count */}
        <Grid item xs={12} sm={6} md={3}>
          {loadingMatches ? (
            <StatCardSkeleton />
          ) : (
            <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    bgcolor: "action.hover",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <MovieIcon />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Video gắn với trận
                  </Typography>
                  <Typography variant="h6">{videoCount}</Typography>
                </Box>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary">
                Số trận đã gán URL video (live/VOD).
              </Typography>
            </Paper>
          )}
        </Grid>

        {/* Tiến độ tổng */}
        <Grid item xs={12} sm={6} md={3}>
          {loadingMatches ? (
            <StatCardSkeleton />
          ) : (
            <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    bgcolor: "action.hover",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <DoneAllIcon />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Tiến độ tổng
                  </Typography>
                  <Typography variant="h6">
                    {matchStatusCount.finished}/{allMatches.length}
                  </Typography>
                </Box>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              <LinearProgress
                variant="determinate"
                value={Math.round(
                  ((matchStatusCount.finished || 0) * 100) /
                    (allMatches.length || 1)
                )}
                sx={{ height: 8, borderRadius: 1 }}
              />
            </Paper>
          )}
        </Grid>
      </Grid>

      {/* Bracket progress */}
      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
          mb={1}
          spacing={1}
        >
          <Typography variant="h6">Tiến độ các bracket</Typography>
          {loadingBr ? (
            <Skeleton variant="rounded" width={110} height={24} />
          ) : (
            <Chip
              size="small"
              label={`${brackets.length} bracket`}
              variant="outlined"
            />
          )}
        </Stack>

        {loadingBr ? (
          <Grid container spacing={1.5}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Grid key={i} item xs={12} md={6} lg={4}>
                <BracketCardSkeleton />
              </Grid>
            ))}
          </Grid>
        ) : bracketProgress.length === 0 ? (
          <Alert severity="info">Chưa có bracket nào.</Alert>
        ) : (
          <Grid container spacing={1.5}>
            {bracketProgress.map((b) => {
              const pct = Math.round(
                ((b.finished || 0) * 100) / (b.total || 1)
              );
              return (
                <Grid
                  key={b._id}
                  item
                  xs={12}
                  md={6}
                  lg={4}
                  sx={{ width: isMobile ? "100%" : "auto" }}
                >
                  <Paper variant="outlined" sx={{ p: 1.5, height: "100%" }}>
                    <Stack spacing={0.5}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        flexWrap="wrap"
                      >
                        <Typography
                          variant="subtitle2"
                          noWrap
                          title={b.name}
                          sx={{ maxWidth: "100%" }}
                        >
                          {b.name}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={TYPE_LABEL(b.type)}
                        />
                        {typeof b.stage === "number" && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Stage ${b.stage}`}
                          />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {b.finished}/{b.total} trận đã xong
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{ height: 8, borderRadius: 1 }}
                      />
                    </Stack>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Paper>

      {/* Two sections: Upcoming & Recent */}
      <Grid container spacing={2} sx={{ mt: 1 }}>
        {/* Upcoming */}
        <Grid item xs={12} md={6} sx={{ width: isMobile ? "100%" : "auto" }}>
          <Paper variant="outlined">
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              p={2}
              pb={1}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <ScheduleIcon fontSize="small" />
                <Typography variant="h6">Trận sắp diễn ra</Typography>
              </Stack>
              {loadingMatches ? (
                <Skeleton variant="rounded" width={46} height={24} />
              ) : (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${upcoming.length}`}
                />
              )}
            </Stack>

            {mdUp ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Mã</TableCell>
                      <TableCell>Cặp A</TableCell>
                      <TableCell>Cặp B</TableCell>
                      <TableCell>Giờ</TableCell>
                      <TableCell align="right">Trạng thái</TableCell>
                    </TableRow>
                  </TableHead>
                  {loadingMatches ? (
                    <TableSkeletonRows rows={8} cols={5} />
                  ) : (
                    <TableBody>
                      {upcoming.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} align="center">
                            <Typography color="text.secondary">
                              Không có trận sắp diễn ra.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        upcoming.map((m) => (
                          <TableRow
                            key={m._id}
                            hover
                            onClick={() => openMatch(m._id)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell>{matchCode(m)}</TableCell>
                            <TableCell
                              sx={{
                                maxWidth: 260,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {pairLabel(m?.pairA)}
                            </TableCell>
                            <TableCell
                              sx={{
                                maxWidth: 260,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {pairLabel(m?.pairB)}
                            </TableCell>
                            <TableCell>
                              {safeDate(m?.scheduledAt)?.toLocaleString?.() ||
                                "—"}
                            </TableCell>
                            <TableCell align="right">
                              {statusChip(m?.status)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  )}
                </Table>
              </TableContainer>
            ) : (
              <Box px={1.5} pb={1.5}>
                {loadingMatches ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <MatchCardSkeleton key={i} />
                  ))
                ) : upcoming.length === 0 ? (
                  <Typography
                    color="text.secondary"
                    align="center"
                    sx={{ py: 2 }}
                  >
                    Không có trận sắp diễn ra.
                  </Typography>
                ) : (
                  upcoming.map((m) => (
                    <MatchCard
                      key={m._id}
                      m={m}
                      onOpen={openMatch}
                      rightSlot={statusChip(m?.status)}
                    />
                  ))
                )}
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Recent finished */}
        <Grid item xs={12} md={6} sx={{ width: isMobile ? "100%" : "auto" }}>
          <Paper variant="outlined">
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              p={2}
              pb={1}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <PlayCircleIcon fontSize="small" />
                <Typography variant="h6">Kết quả mới xong</Typography>
              </Stack>
              {loadingMatches ? (
                <Skeleton variant="rounded" width={46} height={24} />
              ) : (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${recent.length}`}
                />
              )}
            </Stack>

            {mdUp ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Mã</TableCell>
                      <TableCell>Cặp A</TableCell>
                      <TableCell>Cặp B</TableCell>
                      <TableCell>Kết thúc</TableCell>
                      <TableCell align="right">Video</TableCell>
                    </TableRow>
                  </TableHead>
                  {loadingMatches ? (
                    <TableSkeletonRows rows={8} cols={5} />
                  ) : (
                    <TableBody>
                      {recent.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} align="center">
                            <Typography color="text.secondary">
                              Chưa có trận nào kết thúc.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        recent.map((m) => (
                          <TableRow
                            key={m._id}
                            hover
                            onClick={() => openMatch(m._id)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell>{matchCode(m)}</TableCell>
                            <TableCell
                              sx={{
                                maxWidth: 260,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {pairLabel(m?.pairA)}
                            </TableCell>
                            <TableCell
                              sx={{
                                maxWidth: 260,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {pairLabel(m?.pairB)}
                            </TableCell>
                            <TableCell>
                              {safeDate(m?.finishedAt)?.toLocaleString?.() ||
                                "—"}
                            </TableCell>
                            <TableCell
                              align="right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {m?.video ? (
                                <Tooltip title={m.video} arrow>
                                  <IconButton
                                    size="small"
                                    component="a"
                                    href={m.video}
                                    target="_blank"
                                    rel="noopener"
                                  >
                                    <OpenInNewIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label="—"
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  )}
                </Table>
              </TableContainer>
            ) : (
              <Box px={1.5} pb={1.5}>
                {loadingMatches ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <MatchCardSkeleton key={i} />
                  ))
                ) : recent.length === 0 ? (
                  <Typography
                    color="text.secondary"
                    align="center"
                    sx={{ py: 2 }}
                  >
                    Chưa có trận nào kết thúc.
                  </Typography>
                ) : (
                  recent.map((m) => (
                    <MatchCard
                      key={m._id}
                      m={m}
                      onOpen={openMatch}
                      rightSlot={
                        m?.video ? (
                          <Tooltip title={m.video} arrow>
                            <IconButton
                              size="small"
                              component="a"
                              href={m.video}
                              target="_blank"
                              rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <OpenInNewIcon fontSize="inherit" />
                            </IconButton>
                          </Tooltip>
                        ) : null
                      }
                    />
                  ))
                )}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Viewer popup */}
      <ResponsiveMatchViewer
        open={viewer.open}
        matchId={viewer.matchId}
        onClose={closeMatch}
      />
    </Box>
  );
}
