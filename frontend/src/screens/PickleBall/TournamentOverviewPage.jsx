// src/pages/admin/TournamentOverviewPage.jsx
/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import { toast } from "react-toastify";

import {
  useGetTournamentQuery,
  useGetRegistrationsQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
} from "../../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";

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

export default function TournamentOverviewPage() {
  const { id } = useParams();
  const me = useSelector((s) => s.auth?.userInfo || null);

  // 1) Data
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
  } = useAdminGetBracketsQuery(id);
  const {
    data: matchPage,
    isLoading: mLoading,
    error: mErr,
  } = useAdminListMatchesByTournamentQuery({
    tid: id,
    page: 1,
    pageSize: 2000,
  });

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
    // [{_id, name, type, stage, total, finished}]
    const byId = new Map();
    brackets.forEach((b) =>
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
        const s = String(m?.status || "");
        return (
          s === "scheduled" ||
          s === "queued" ||
          s === "assigned" ||
          (safeDate(m?.scheduledAt)?.getTime() ?? 0) >= now
        );
      })
      .sort((a, b) => {
        const ta =
          safeDate(a?.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const tb =
          safeDate(b?.scheduledAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return ta - tb;
      })
      .slice(0, 10);
    return arr;
  }, [allMatches, now]);

  const recent = useMemo(() => {
    const arr = allMatches
      .filter((m) => m?.status === "finished")
      .sort((a, b) => {
        const ta = safeDate(a?.finishedAt)?.getTime() ?? 0;
        const tb = safeDate(b?.finishedAt)?.getTime() ?? 0;
        return tb - ta;
      })
      .slice(0, 10);
    return arr;
  }, [allMatches]);

  // 6) Viewer popup
  const [viewer, setViewer] = useState({ open: false, matchId: null });
  const openMatch = (mid) => setViewer({ open: true, matchId: mid });
  const closeMatch = () => setViewer({ open: false, matchId: null });

  /* ===== guards ===== */
  if (tourLoading || regsLoading || brLoading || mLoading) {
    return (
      <Box p={3} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (tourErr || regsErr || brErr || mErr) {
    return (
      <Box p={3}>
        <Alert severity="error">
          {tourErr?.data?.message ||
            regsErr?.data?.message ||
            brErr?.data?.message ||
            mErr?.data?.message ||
            "Lỗi tải dữ liệu"}
        </Alert>
      </Box>
    );
  }
  if (!canManage) {
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
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        mb={2}
      >
        <Typography variant="h5" noWrap>
          Tổng quan: {tour?.name}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            component={Link}
            to={`/tournament/${id}`}
            variant="outlined"
            size="small"
          >
            Trang giải
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
        </Grid>

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
              </Box>
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.75}>
              {["scheduled", "queued", "assigned", "live", "finished"].map(
                (k) => {
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
        </Grid>

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
        </Grid>
      </Grid>

      {/* Bracket progress */}
      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          mb={1}
        >
          <Typography variant="h6">Tiến độ các bracket</Typography>
          <Chip
            size="small"
            label={`${brackets.length} bracket`}
            variant="outlined"
          />
        </Stack>
        {bracketProgress.length === 0 ? (
          <Alert severity="info">Chưa có bracket nào.</Alert>
        ) : (
          <Grid container spacing={1.5}>
            {bracketProgress.map((b) => {
              const pct = Math.round(
                ((b.finished || 0) * 100) / (b.total || 1)
              );
              return (
                <Grid key={b._id} item xs={12} md={6} lg={4}>
                  <Paper variant="outlined" sx={{ p: 1.5, height: "100%" }}>
                    <Stack spacing={0.5}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        flexWrap="wrap"
                      >
                        <Typography variant="subtitle2" noWrap title={b.name}>
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

      {/* Two columns: Upcoming & Recent */}
      <Grid container spacing={2} sx={{ mt: 1 }}>
        {/* Upcoming */}
        <Grid item xs={12} md={6}>
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
              <Chip
                size="small"
                variant="outlined"
                label={`${upcoming.length}`}
              />
            </Stack>
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
                        <TableCell>{pairLabel(m?.pairA)}</TableCell>
                        <TableCell>{pairLabel(m?.pairB)}</TableCell>
                        <TableCell>
                          {safeDate(m?.scheduledAt)?.toLocaleString?.() || "—"}
                        </TableCell>
                        <TableCell align="right">
                          {statusChip(m?.status)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        {/* Recent finished */}
        <Grid item xs={12} md={6}>
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
              <Chip
                size="small"
                variant="outlined"
                label={`${recent.length}`}
              />
            </Stack>
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
                        <TableCell>{pairLabel(m?.pairA)}</TableCell>
                        <TableCell>{pairLabel(m?.pairB)}</TableCell>
                        <TableCell>
                          {safeDate(m?.finishedAt)?.toLocaleString?.() || "—"}
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
                            <Chip size="small" variant="outlined" label="—" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
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
