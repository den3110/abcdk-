import { useCallback, useEffect, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import { toast } from "react-toastify";
import { useSocket } from "../context/SocketContext";
import { useSocketRoomSet } from "../hook/useSocketRoomSet";
import { useGetTournamentCourtLiveMonitorQuery } from "../slices/courtClustersAdminApiSlice";

const REFRESH_DEBOUNCE_MS = 250;
const POLLING_INTERVAL_MS = 10_000;

const sid = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const text = (value, fallback = "") => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};

const formatDateTime = (value) => {
  if (!value) return "Chưa có";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Chưa có";
  return parsed.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
};

const formatDuration = (ms) => {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric < 0) return "";
  if (numeric < 60_000) return `${Math.round(numeric / 1000)} giây`;
  if (numeric < 3_600_000) return `${Math.round(numeric / 60_000)} phút`;
  return `${Math.round(numeric / 3_600_000)} giờ`;
};

const matchCode = (match) =>
  text(match?.displayCode) ||
  text(match?.code) ||
  text(match?.globalCode) ||
  text(match?.labelKey) ||
  "Chưa có trận";

const teamLine = (match) => {
  const teamA = text(match?.teamAName || match?.pairA?.name, "Đội A");
  const teamB = text(match?.teamBName || match?.pairB?.name, "Đội B");
  return match ? `${teamA} vs ${teamB}` : "Chưa gắn trận live";
};

const chipColor = (severity) => {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  if (severity === "info") return "info";
  return "default";
};

const monitorLabel = (state) => {
  if (state === "lost_signal") return "Mất tín hiệu";
  if (state === "live_ok") return "Live ổn";
  if (state === "standby_online") return "Máy online";
  return "Chờ live";
};

function SummaryBox({ label, value, color = "text.primary", icon = null }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, height: "100%" }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {icon ? <Box sx={{ display: "flex", color }}>{icon}</Box> : null}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h6" fontWeight={800} sx={{ color, lineHeight: 1.15 }}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

SummaryBox.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  color: PropTypes.string,
  icon: PropTypes.node,
};

function StationMonitorCard({ station, tournamentId }) {
  const monitor = station?.monitor || {};
  const presence = station?.presence || {};
  const match = station?.currentMatch || null;
  const bracketId = sid(match?.bracket?._id || match?.bracket);
  const stationId = sid(station?._id);
  const liveUrl =
    tournamentId && bracketId
      ? `/live/${tournamentId}/brackets/${bracketId}/live-studio/${stationId}`
      : `/streaming/${stationId}`;
  const offlineText = formatDuration(presence?.offlineForMs);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 2,
        borderColor: monitor?.lostSignal ? "error.main" : "divider",
        bgcolor: monitor?.lostSignal ? "rgba(211, 47, 47, 0.06)" : "background.paper",
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "flex-start" }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle1" fontWeight={800} sx={{ wordBreak: "break-word" }}>
                {text(station?.name, "Sân live")}
              </Typography>
              {station?.code ? <Chip size="small" label={station.code} /> : null}
              <Chip
                size="small"
                color={chipColor(monitor?.severity)}
                icon={monitor?.lostSignal ? <WifiOffIcon /> : undefined}
                label={monitorLabel(monitor?.state)}
                sx={{ fontWeight: 700 }}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
              {text(station?.clusterName || station?.cluster?.name, "Cụm sân")} · {text(station?.status, "idle")}
            </Typography>
          </Box>
          <Button
            component={RouterLink}
            to={liveUrl}
            target="_blank"
            rel="noreferrer"
            size="small"
            variant={monitor?.lostSignal ? "contained" : "outlined"}
            startIcon={<OpenInNewIcon />}
            sx={{ alignSelf: { xs: "flex-start", md: "center" } }}
          >
            Mở live
          </Button>
        </Stack>

        {monitor?.lostSignal ? (
          <Alert severity="error" icon={<WarningAmberIcon fontSize="inherit" />} sx={{ py: 0.75 }}>
            {monitor.message}
          </Alert>
        ) : null}

        <Grid container spacing={1.25}>
          <Grid item xs={12} md={5}>
            <Typography variant="caption" color="text.secondary">
              Trận hiện tại
            </Typography>
            <Typography variant="body2" fontWeight={800}>
              {matchCode(match)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
              {teamLine(match)}
            </Typography>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="caption" color="text.secondary">
              Heartbeat server chính
            </Typography>
            <Typography variant="body2" fontWeight={700} sx={{ wordBreak: "break-word" }}>
              {presence?.isOnline
                ? "Server chính đang nhận tín hiệu"
                : "Server chính chưa nhận tín hiệu"}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <Chip
                size="small"
                color={presence?.isOnline ? "success" : "default"}
                label={presence?.isOnline ? "Online" : "Offline"}
              />
              {presence?.screenState ? <Chip size="small" label={presence.screenState} /> : null}
            </Stack>
          </Grid>
          <Grid item xs={12} md={3}>
            <Typography variant="caption" color="text.secondary">
              Cập nhật cuối
            </Typography>
            <Typography variant="body2" fontWeight={700}>
              {formatDateTime(presence?.lastHeartbeatAt)}
            </Typography>
            {offlineText ? (
              <Typography variant="caption" color={monitor?.lostSignal ? "error.main" : "text.secondary"}>
                Mất tín hiệu khoảng {offlineText}
              </Typography>
            ) : null}
          </Grid>
        </Grid>
      </Stack>
    </Paper>
  );
}

StationMonitorCard.propTypes = {
  station: PropTypes.object.isRequired,
  tournamentId: PropTypes.string.isRequired,
};

export default function TournamentCourtLiveMonitorDialog({
  open,
  onClose,
  tournamentId,
}) {
  const socket = useSocket();
  const toastStateRef = useRef(new Map());
  const refreshTimerRef = useRef(null);

  const {
    data,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useGetTournamentCourtLiveMonitorQuery(
    { tournamentId },
    {
      skip: !open || !tournamentId,
      pollingInterval: open ? POLLING_INTERVAL_MS : 0,
      refetchOnReconnect: true,
    },
  );

  const stations = useMemo(
    () => (Array.isArray(data?.stations) ? data.stations : []),
    [data?.stations],
  );
  const counts = data?.counts || {};
  const stationIds = useMemo(
    () => stations.map((station) => sid(station?._id)).filter(Boolean),
    [stations],
  );
  const stationIdSet = useMemo(() => new Set(stationIds), [stationIds]);
  const clusterIdSet = useMemo(
    () =>
      new Set(
        stations
          .map((station) => sid(station?.clusterId || station?.cluster?._id))
          .filter(Boolean),
      ),
    [stations],
  );

  const requestMonitorRefresh = useCallback(() => {
    if (!open || typeof refetch !== "function") return;
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      refetch();
    }, REFRESH_DEBOUNCE_MS);
  }, [open, refetch]);

  useSocketRoomSet(socket, open ? stationIds : [], {
    subscribeEvent: "court-station:watch",
    unsubscribeEvent: "court-station:unwatch",
    payloadKey: "stationId",
    onResync: requestMonitorRefresh,
  });

  useEffect(() => {
    if (!socket || !open) return undefined;

    const handleStationUpdate = (payload) => {
      const payloadStationId = sid(
        payload?._id || payload?.station?._id || payload?.courtStationId,
      );
      if (!payloadStationId || stationIdSet.has(payloadStationId)) {
        requestMonitorRefresh();
      }
    };

    const handleClusterUpdate = (payload) => {
      const payloadClusterId = sid(payload?.cluster?._id || payload?.clusterId);
      if (!payloadClusterId || clusterIdSet.has(payloadClusterId)) {
        requestMonitorRefresh();
      }
    };

    socket.on("court-station:update", handleStationUpdate);
    socket.on("court-cluster:update", handleClusterUpdate);
    return () => {
      socket.off("court-station:update", handleStationUpdate);
      socket.off("court-cluster:update", handleClusterUpdate);
    };
  }, [clusterIdSet, open, requestMonitorRefresh, socket, stationIdSet]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      toastStateRef.current = new Map();
      return;
    }

    const nextState = new Map();
    stations.forEach((station) => {
      const stationId = sid(station?._id);
      if (!stationId) return;
      const lostSignal = Boolean(station?.monitor?.lostSignal);
      nextState.set(stationId, lostSignal);
      if (lostSignal && toastStateRef.current.get(stationId) !== true) {
        toast.error(
          station?.monitor?.message ||
            "Máy live mất tín hiệu, có dấu hiệu crash. Hãy kiểm tra thiết bị và mở lại live.",
          { toastId: `court-live-lost-${stationId}` },
        );
      }
    });
    toastStateRef.current = nextState;
  }, [open, stations]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" keepMounted>
      <DialogTitle sx={{ pr: 7 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <LiveTvIcon color="primary" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" fontWeight={800}>
              Quản lý live sân
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Chỉ hiển thị các sân đang gắn với giải này, nguồn trạng thái là heartbeat về server chính.
            </Typography>
          </Box>
        </Stack>
        <IconButton
          aria-label="Đóng"
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      {isFetching && data ? <LinearProgress /> : null}
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error">
              {error?.data?.message || "Không thể tải quản lý live sân."}
            </Alert>
          ) : null}

          {Number(counts.lostSignal || 0) > 0 ? (
            <Alert severity="error" icon={<WifiOffIcon fontSize="inherit" />}>
              Có {counts.lostSignal} máy live mất tín hiệu trên server chính, có dấu hiệu crash hoặc bị đóng app. Hãy kiểm tra thiết bị và mở lại live.
            </Alert>
          ) : null}

          <Grid container spacing={1.25}>
            <Grid item xs={6} md={3}>
              <SummaryBox label="Tổng sân" value={counts.total || 0} icon={<LiveTvIcon />} />
            </Grid>
            <Grid item xs={6} md={3}>
              <SummaryBox label="Đang live" value={counts.live || 0} color="warning.main" icon={<LiveTvIcon />} />
            </Grid>
            <Grid item xs={6} md={3}>
              <SummaryBox label="Online" value={counts.online || 0} color="success.main" icon={<CheckCircleIcon />} />
            </Grid>
            <Grid item xs={6} md={3}>
              <SummaryBox label="Mất tín hiệu" value={counts.lostSignal || 0} color={counts.lostSignal ? "error.main" : "text.primary"} icon={<WifiOffIcon />} />
            </Grid>
          </Grid>

          {isLoading && !data ? (
            <Stack py={5} spacing={1.25} alignItems="center">
              <CircularProgress />
              <Typography variant="body2" color="text.secondary">
                Đang tải trạng thái live sân...
              </Typography>
            </Stack>
          ) : stations.length ? (
            <Stack spacing={1.25}>
              {stations.map((station) => (
                <StationMonitorCard
                  key={sid(station?._id)}
                  station={station}
                  tournamentId={tournamentId}
                />
              ))}
            </Stack>
          ) : (
            <Alert severity="info">
              Giải này chưa gắn cụm sân nào hoặc chưa có sân hoạt động trong các cụm đã gắn.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ mr: "auto", pl: 1 }}>
          Cập nhật cuối: {formatDateTime(data?.updatedAt)}
        </Typography>
        <Tooltip title="Làm mới trạng thái live sân">
          <span>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => refetch?.()}
              disabled={!open || isFetching}
            >
              Làm mới
            </Button>
          </span>
        </Tooltip>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}

TournamentCourtLiveMonitorDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tournamentId: PropTypes.string.isRequired,
};
