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
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useTheme,
  Card,
  CardContent,
  Skeleton,
  Avatar,
  Tabs,
  Tab,
  alpha,
  Container,
  Collapse,
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
  EmojiEvents as EmojiEventsIcon,
  History as HistoryIcon,
  Settings as SettingsIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
} from "@mui/icons-material";

import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
} from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";
import SEOHead from "../../components/SEOHead";

/* ===== HELPERS ===== */
const TYPE_LABEL = (t) => {
  const key = String(t || "").toLowerCase();
  if (key === "group") return "Vòng bảng";
  if (key === "po" || key === "playoff") return "Playoff";
  if (key === "knockout" || key === "ko") return "Knockout";
  if (key === "double_elim" || key === "doubleelim") return "Double Elim";
  return t || "Khác";
};
const playerName = (p) => p?.fullName || p?.name || p?.nickName || "—";
const pairLabel = (pair) => {
  if (!pair) return "TBD";
  if (pair.name) return pair.name;
  const ps = [pair.player1, pair.player2].filter(Boolean).map(playerName);
  return ps.join(" / ") || "TBD";
};
const matchCode = (m) =>
  m?.code || `R${m?.round ?? "?"}#${(m?.order ?? 0) + 1}`;
const statusChip = (st) => {
  const map = {
    scheduled: { label: "Chưa xếp", bg: "#f5f5f5", text: "#757575" },
    queued: { label: "Hàng chờ", bg: "#e3f2fd", text: "#0277bd" },
    assigned: { label: "Đã gán sân", bg: "#f3e5f5", text: "#7b1fa2" },
    live: { label: "Đang đấu", bg: "#fff3e0", text: "#ef6c00" },
    finished: { label: "Kết thúc", bg: "#e8f5e9", text: "#2e7d32" },
  };
  const v = map[st] || { label: st || "—", bg: "#eee", text: "#333" };
  return (
    <Chip
      size="small"
      label={v.label}
      sx={{
        bgcolor: v.bg,
        color: v.text,
        fontWeight: 700,
        border: "none",
        fontSize: "0.7rem",
        height: 24,
        minWidth: 80,
      }}
    />
  );
};
const safeDate = (d) => (d ? new Date(d) : null);
const formatTime = (d) =>
  d
    ? new Date(d).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    })
    : "—";
const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
    })
    : "";

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

/* ===== UI COMPONENTS ===== */

const ModernStatCard = ({
  icon,
  title,
  value,
  subtext,
  color = "primary",
  loading,
}) => {
  const theme = useTheme();
  const mainColor = theme.palette[color]?.main || theme.palette.primary.main;

  if (loading)
    return (
      <Skeleton
        variant="rounded"
        height={140}
        width="100%"
        sx={{ borderRadius: 4 }}
      />
    );

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        width: "100%",
        height: "100%",
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        transition: "all 0.2s",
        boxSizing: "border-box",
        "&:hover": {
          borderColor: mainColor,
          boxShadow: `0px 8px 24px ${alpha(mainColor, 0.1)}`,
        },
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={2}
        sx={{ width: "100%" }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight={700}
            sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
          >
            {title}
          </Typography>
          <Typography
            variant="h4"
            fontWeight={800}
            sx={{ mt: 1, color: "text.primary" }}
          >
            {value}
          </Typography>
        </Box>
        <Avatar
          sx={{
            bgcolor: alpha(mainColor, 0.1),
            color: mainColor,
            width: 48,
            height: 48,
            borderRadius: 3,
          }}
        >
          {icon}
        </Avatar>
      </Stack>
      {subtext && (
        <Box mt={2} sx={{ width: "100%" }}>
          {subtext}
        </Box>
      )}
    </Paper>
  );
};

const MatchListItem = ({ m, onOpen }) => {
  return (
    <Card
      elevation={0}
      onClick={() => onOpen?.(m?._id)}
      sx={{
        mb: 1.5,
        width: "100%",
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": {
          borderColor: "primary.main",
          transform: "translateY(-2px)",
          boxShadow: 2,
        },
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Grid
          container
          alignItems="center"
          spacing={2}
          sx={{ width: "100%", m: 0 }}
        >
          {/* Cột 1: Mã & Giờ (xs: 12, sm: 2) */}
          <Grid item size={{ xs: 12, sm: 2 }} sx={{ pl: "0 !important" }}>
            <Stack
              direction={{ xs: "row", sm: "column" }}
              alignItems={{ xs: "center", sm: "flex-start" }}
              spacing={1}
            >
              <Chip
                label={matchCode(m)}
                size="small"
                sx={{
                  borderRadius: 1,
                  fontWeight: 700,
                  fontSize: "0.65rem",
                  height: 20,
                  bgcolor: "action.selected",
                }}
              />
              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ lineHeight: 1.2 }}
                >
                  {formatDate(m?.scheduledAt)}
                </Typography>
                <Typography variant="body2" fontWeight={700}>
                  {formatTime(m?.scheduledAt)}
                </Typography>
              </Box>
            </Stack>
          </Grid>

          {/* Cột 2: Tên Cặp đấu (xs: 12, sm: 7) */}
          <Grid
            item
            size={{ xs: 12, sm: 7 }}
            sx={{ pl: { xs: "0 !important", sm: "16px !important" } }}
          >
            <Stack spacing={1} sx={{ width: "100%" }}>
              <Typography
                variant="body2"
                fontWeight={600}
                noWrap
                title={pairLabel(m?.pairA)}
              >
                {pairLabel(m?.pairA)}
              </Typography>

              <Divider sx={{ borderStyle: "dashed", my: 0.5 }} />

              <Typography
                variant="body2"
                fontWeight={600}
                noWrap
                title={pairLabel(m?.pairB)}
              >
                {pairLabel(m?.pairB)}
              </Typography>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5, display: "block" }}
            >
              {m?.bracket?.name || "—"}
            </Typography>
          </Grid>

          {/* Cột 3: Trạng thái (xs: 12, sm: 3) */}
          <Grid
            item
            size={{ xs: 12, sm: 3 }}
            sx={{
              pl: { xs: "0 !important", sm: "16px !important" },
              display: "flex",
              justifyContent: { xs: "space-between", sm: "flex-end" },
              alignItems: "center",
            }}
          >
            <Box sx={{ display: { xs: "block", sm: "none" } }}>
              {/* Placeholder mobile space if needed */}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              {m?.video && (
                <Tooltip title="Có Video">
                  <PlayCircleIcon color="error" fontSize="small" />
                </Tooltip>
              )}
              {statusChip(m?.status)}
            </Stack>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

/* ===== MAIN PAGE ===== */
export default function TournamentOverviewPage() {
  const { id } = useParams();
  const me = useSelector((s) => s.auth?.userInfo || null);
  const theme = useTheme();

  const [tabValue, setTabValue] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false); // State điều khiển "Xem tất cả"

  // Data Fetching
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
  } = useGetTournamentQuery(id);
  const {
    data: regs = [],
    isLoading: regsLoading,
    error: regsErr,
  } = useGetRegistrationsQuery(id);
  const {
    data: brackets = [],
    isLoading: brLoading,
    error: brErr,
    refetch: refetchBrackets,
  } = useAdminGetBracketsQuery(id);
  const {
    data: matchPage,
    isLoading: mLoading,
    error: mErr,
    refetch: refetchMatches,
  } = useAdminListMatchesByTournamentQuery({
    tid: id,
    page: 1,
    pageSize: 2000,
  });

  const loadingTour = tourLoading;
  const loadingRegs = regsLoading;
  const loadingBr = brLoading;
  const loadingMatches = mLoading;
  const allMatches = matchPage?.list || [];

  // Permissions
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const isManager = useMemo(() => {
    if (!me?._id || !tour) return false;
    if (String(tour.createdBy) === String(me._id)) return true;
    if (Array.isArray(tour.managers))
      return tour.managers.some((m) => String(m?.user ?? m) === String(me._id));
    return !!tour?.isManager;
  }, [tour, me]);
  const canManage = isAdmin || isManager;

  // KPIs
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

  // Bracket Progress
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
    return Array.from(byId.values()).sort(
      (a, b) => (a.stage ?? 0) - (b.stage ?? 0)
    );
  }, [brackets, allMatches]);

  // Filter Matches
  const now = Date.now();
  const upcoming = useMemo(
    () =>
      allMatches
        .filter((m) => {
          const s = String(m?.status || "").toLowerCase();
          return (
            s === "scheduled" ||
            s === "queued" ||
            s === "assigned" ||
            (s !== "finished" &&
              (safeDate(m?.scheduledAt)?.getTime() ?? 0) >= now)
          );
        })
        .sort(
          (a, b) =>
            priorityRank(a) - priorityRank(b) ||
            (safeDate(a?.scheduledAt)?.getTime() ?? 9e15) -
            (safeDate(b?.scheduledAt)?.getTime() ?? 9e15)
        ),
    [allMatches, now]
  );

  const recent = useMemo(
    () =>
      allMatches
        .filter((m) => m?.status === "finished")
        .sort(
          (a, b) =>
            (safeDate(b?.finishedAt)?.getTime() ?? 0) -
            (safeDate(a?.finishedAt)?.getTime() ?? 0)
        ),
    [allMatches]
  );

  // Socket (Giữ nguyên logic Socket, đảm bảo cập nhật realtime)
  const socket = useSocket();
  const joinedRef = useRef(new Set());
  const refetchTimerRef = useRef(null);
  useEffect(() => {
    if (!socket) return;
    const scheduleRefetch = () => {
      if (!refetchTimerRef.current)
        refetchTimerRef.current = setTimeout(() => {
          refetchTimerRef.current = null;
          refetchMatches?.();
        }, 500);
    };
    const onConn = () => {
      (brackets || []).forEach((b) =>
        socket.emit("draw:subscribe", { bracketId: b._id })
      );
      (allMatches || []).forEach((m) => {
        if (!joinedRef.current.has(m._id)) {
          socket.emit("match:join", { matchId: m._id });
          joinedRef.current.add(m._id);
        }
      });
    };
    const onUpd = () => scheduleRefetch();
    const onRefill = () => {
      refetchBrackets?.();
      scheduleRefetch();
    };
    socket.on("connect", onConn);
    socket.on("match:update", onUpd);
    socket.on("score:updated", onUpd);
    socket.on("match:deleted", onUpd);
    socket.on("draw:refilled", onRefill);
    socket.on("bracket:updated", onRefill);
    onConn();
    return () => {
      socket.off("connect", onConn);
      socket.off("match:update", onUpd);
      socket.off("score:updated", onUpd);
      socket.off("match:deleted", onUpd);
      socket.off("draw:refilled", onRefill);
      socket.off("bracket:updated", onRefill);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, [socket, brackets, allMatches, refetchMatches, refetchBrackets]);

  const [viewer, setViewer] = useState({ open: false, matchId: null });
  const openMatch = (mid) => setViewer({ open: true, matchId: mid });

  const anyError =
    tourErr?.data?.message ||
    regsErr?.data?.message ||
    brErr?.data?.message ||
    mErr?.data?.message;
  const readyForPermission =
    !loadingTour && !loadingRegs && !loadingBr && !loadingMatches;
  if (readyForPermission && !canManage)
    return (
      <Box p={3} display="flex" justifyContent="center">
        <Alert severity="warning">Bạn không có quyền truy cập.</Alert>
      </Box>
    );

  // Logic hiển thị list
  const displayList = tabValue === 0 ? upcoming : recent;
  const visibleList = isExpanded ? displayList : displayList.slice(0, 10); // Mặc định hiện 10

  return (
    <Box sx={{ bgcolor: "background.default", minHeight: "100vh", pb: 4 }}>
      <SEOHead
        title={`Tổng quan: ${tour?.name || "Giải đấu"}`}
        description={`Xem tổng quan, thống kê và danh sách trận đấu của giải ${tour?.name} trên Pickletour.vn`}
        path={`/tournament/${id}/overview`}
      />
      {/* Header: Full Width Hero */}
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          bgcolor: "background.paper",
          borderBottom: "1px solid",
          borderColor: "divider",
          mb: 3,
          pt: 3,
          pb: 3,
        }}
      >
        <Container maxWidth="xl">
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
            spacing={2}
          >
            <Box>
              <Stack direction="row" alignItems="center" gap={1} mb={0.5}>
                <EmojiEventsIcon color="primary" fontSize="small" />
                <Typography
                  variant="overline"
                  color="primary"
                  fontWeight={700}
                  letterSpacing={1}
                >
                  Tổng quan giải đấu
                </Typography>
              </Stack>
              {loadingTour ? (
                <Skeleton width={300} height={40} />
              ) : (
                <Typography
                  variant="h4"
                  fontWeight={800}
                  color="text.primary"
                  sx={{ fontSize: { xs: "1.5rem", md: "2.125rem" } }}
                >
                  {tour?.name}
                </Typography>
              )}
            </Box>

            <Stack
              direction="row"
              spacing={1.5}
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: { xs: 2, md: 0 }, width: { xs: "100%", md: "auto" } }}
            >
              {/* <Button
                component={Link}
                to={`/tournament/${id}`}
                variant="outlined"
                color="inherit"
                startIcon={<OpenInNewIcon />}
                sx={{ flex: { xs: 1, md: "none" } }}
              >
                Public View
              </Button> */}
              <Button
                component={Link}
                to={`/tournament/${id}/manage`}
                variant="outlined"
                color="primary"
                startIcon={<SettingsIcon />}
                sx={{ flex: { xs: 1, md: "none" } }}
              >
                Cài đặt
              </Button>
              <Button
                component={Link}
                to={`/tournament/${id}/draw`}
                variant="contained"
                disableElevation
                startIcon={<GroupsIcon />}
                sx={{ flex: { xs: 1, md: "none" }, minWidth: 120 }}
              >
                Bốc thăm
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Paper>

      {/* Main Content */}
      <Container maxWidth="xl">
        {anyError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {anyError}
          </Alert>
        )}

        {/* 1. KPI Grid (4 Cards) - Dùng size prop */}
        <Grid container spacing={3} mb={4}>
          {[
            {
              title: "Vận động viên",
              value: regTotal,
              icon: <GroupsIcon />,
              color: "primary",
              subtext: (
                <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                  <Chip
                    size="small"
                    icon={<MonetizationOnIcon />}
                    label={`${regPaid} Paid`}
                    color="success"
                    variant="outlined"
                    sx={{
                      border: "none",
                      bgcolor: alpha(theme.palette.success.main, 0.1),
                    }}
                  />
                  <Chip
                    size="small"
                    icon={<CheckCircleIcon />}
                    label={`${regCheckin} Check-in`}
                    color="info"
                    variant="outlined"
                    sx={{
                      border: "none",
                      bgcolor: alpha(theme.palette.info.main, 0.1),
                    }}
                  />
                </Stack>
              ),
            },
            {
              title: "Tổng số trận",
              value: allMatches.length,
              icon: <SportsScoreIcon />,
              color: "warning",
              subtext: (
                <Box sx={{ width: "100%" }}>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    mb={0.5}
                  >
                    <Typography variant="caption" fontWeight={600}>
                      Hoàn thành
                    </Typography>
                    <Typography variant="caption">
                      {Math.round(
                        (matchStatusCount.finished / (allMatches.length || 1)) *
                        100
                      )}
                      %
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={
                      allMatches.length
                        ? (matchStatusCount.finished / allMatches.length) * 100
                        : 0
                    }
                    sx={{
                      height: 6,
                      borderRadius: 2,
                      bgcolor: alpha(theme.palette.warning.main, 0.2),
                      "& .MuiLinearProgress-bar": { bgcolor: "warning.main" },
                    }}
                  />
                </Box>
              ),
            },
            {
              title: "Đang thi đấu",
              value: matchStatusCount.live,
              icon: <PlayCircleIcon />,
              color: "error",
              subtext: (
                <Typography variant="caption" color="text.secondary">
                  Trận đấu đang diễn ra realtime.
                </Typography>
              ),
            },
            {
              title: "Media / Video",
              value: videoCount,
              icon: <MovieIcon />,
              color: "secondary",
              subtext: (
                <Typography variant="caption" color="text.secondary">
                  Trận có link video/livestream.
                </Typography>
              ),
            },
          ].map((item, i) => (
            <Grid
              item
              // ✨ Cập nhật KPI Grid dùng size prop
              size={{ xs: 12, sm: 6, md: 3 }}
              key={i}
              sx={{ display: "flex" }}
            >
              <ModernStatCard
                {...item}
                loading={loadingRegs || loadingMatches}
              />
            </Grid>
          ))}
        </Grid>

        {/* 2. Main Content Grid (Match List & Bracket Progress) */}
        <Grid container spacing={3}>
          {/* Left: Match List - Size: md=8 */}
          <Grid item size={{ xs: 12, md: 8 }} sx={{ display: "flex" }}>
            <Paper
              elevation={0}
              sx={{
                borderRadius: 4,
                border: "1px solid",
                borderColor: "divider",
                overflow: "hidden",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                width: "100%",
              }}
            >
              <Box
                sx={{ borderBottom: 1, borderColor: "divider", px: 2, pt: 1 }}
              >
                <Tabs
                  value={tabValue}
                  onChange={(e, v) => {
                    setTabValue(v);
                    setIsExpanded(false);
                  }}
                  variant="scrollable"
                  scrollButtons="auto"
                  allowScrollButtonsMobile
                  sx={{
                    "& .MuiTab-root": {
                      textTransform: "none",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      minHeight: 56,
                    },
                  }}
                >
                  <Tab
                    icon={<ScheduleIcon sx={{ fontSize: 18, mb: 0 }} />}
                    iconPosition="start"
                    label={`Sắp tới (${upcoming.length})`}
                  />
                  <Tab
                    icon={<HistoryIcon sx={{ fontSize: 18, mb: 0 }} />}
                    iconPosition="start"
                    label={`Vừa kết thúc (${recent.length})`}
                  />
                </Tabs>
              </Box>

              <Box sx={{ p: { xs: 1.5, md: 2 }, bgcolor: "background.default", flex: 1 }}>
                {loadingMatches ? (
                  [1, 2, 3].map((i) => (
                    <Skeleton
                      key={i}
                      variant="rounded"
                      height={80}
                      sx={{ mb: 1.5, borderRadius: 3, width: "100%" }}
                    />
                  ))
                ) : (
                  <>
                    {displayList.length === 0 ? (
                      <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
                        Không có trận đấu nào.
                      </Alert>
                    ) : (
                      // Sử dụng Collapse để bọc list, tạo hiệu ứng mượt mà khi expand/collapse
                      <Collapse in={true} timeout={300}>
                        {visibleList.map((m) => (
                          <MatchListItem key={m._id} m={m} onOpen={openMatch} />
                        ))}
                      </Collapse>
                    )}

                    {/* Nút Xem tất cả / Thu gọn */}
                    {displayList.length > 10 && (
                      <Button
                        fullWidth
                        sx={{
                          mt: 1,
                          py: 1.5,
                          bgcolor: "background.paper",
                          border: "1px dashed",
                          borderColor: "divider",
                        }}
                        onClick={() => setIsExpanded(!isExpanded)}
                        endIcon={
                          isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />
                        }
                      >
                        {isExpanded
                          ? "Thu gọn"
                          : `Xem tất cả (${displayList.length - 10} trận nữa)`}
                      </Button>
                    )}
                  </>
                )}
              </Box>
            </Paper>
          </Grid>

          {/* Right: Bracket Progress - Size: md=4 */}
          <Grid item size={{ xs: 12, md: 4 }} sx={{ display: "flex" }}>
            <Paper
              elevation={0}
              sx={{
                borderRadius: 4,
                border: "1px solid",
                borderColor: "divider",
                p: 3,
                height: "100%",
                width: "100%",
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1} mb={3}>
                <DoneAllIcon color="primary" />
                <Typography variant="h6" fontWeight={700}>
                  Tiến độ Bảng đấu
                </Typography>
              </Stack>
              {loadingBr ? (
                <Stack spacing={2}>
                  <Skeleton variant="rounded" height={60} width="100%" />
                  <Skeleton variant="rounded" height={60} width="100%" />
                </Stack>
              ) : bracketProgress.length === 0 ? (
                <Alert severity="warning">Chưa tạo bảng đấu nào</Alert>
              ) : (
                <Stack spacing={2}>
                  {bracketProgress.map((b) => {
                    const pct = Math.round(
                      ((b.finished || 0) * 100) / (b.total || 1)
                    );
                    return (
                      <Box
                        key={b._id}
                        sx={{
                          p: 2,
                          borderRadius: 3,
                          bgcolor: "background.default",
                          border: "1px solid",
                          borderColor: "divider",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          mb={1}
                        >
                          <Box sx={{ maxWidth: "70%" }}>
                            <Typography
                              variant="subtitle2"
                              fontWeight={700}
                              noWrap
                              title={b.name}
                            >
                              {b.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {TYPE_LABEL(b.type)}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            label={`${pct}%`}
                            color={pct === 100 ? "success" : "default"}
                          />
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          sx={{
                            height: 6,
                            borderRadius: 1,
                            bgcolor: "action.selected",
                            "& .MuiLinearProgress-bar": { borderRadius: 1 },
                          }}
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mt: 1, display: "block", textAlign: "right" }}
                        >
                          {b.finished}/{b.total} trận
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
