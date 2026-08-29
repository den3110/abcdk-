// components/BracketCourtStatusPanel.jsx
// Panel tình trạng sân (chỉ xem) cho admin/quản lý trên trang Sơ đồ giải:
// biết sân nào trống / đang dùng. Hỗ trợ cả CỤM SÂN (court-live-monitor) lẫn sân phẳng cũ.
import React, { useMemo, useState } from "react";
import {
  Box,
  Paper,
  Chip,
  Typography,
  Stack,
  Collapse,
  IconButton,
  Tooltip,
} from "@mui/material";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useAdminListCourtsQuery } from "../slices/adminCourtApiSlice";
import { useGetTournamentCourtLiveMonitorQuery } from "../slices/courtClustersAdminApiSlice";

const matchLabel = (cm) =>
  cm?.code ||
  cm?.matchCode ||
  cm?.labelKey ||
  cm?.roundLabel ||
  cm?.roundName ||
  "Đang thi đấu";

const OCCUPIED_STATUSES = new Set(["assigned", "live", "playing", "busy"]);

export default function BracketCourtStatusPanel({ tournamentId, enabled = true }) {
  const [open, setOpen] = useState(true);

  // 1) Cụm sân (court stations) — dùng cho giải cấu hình cụm sân
  const {
    data: monitor,
    isFetching: fetchingMonitor,
    refetch: refetchMonitor,
  } = useGetTournamentCourtLiveMonitorQuery(
    { tournamentId },
    {
      skip: !enabled || !tournamentId,
      pollingInterval: 20000,
      refetchOnMountOrArgChange: true,
    },
  );
  const stations = useMemo(
    () => (Array.isArray(monitor?.stations) ? monitor.stations : []),
    [monitor],
  );

  // 2) Fallback: sân phẳng cũ (chỉ query khi không có cụm sân)
  const {
    data: legacyCourts,
    isFetching: fetchingLegacy,
    refetch: refetchLegacy,
  } = useAdminListCourtsQuery(
    { tid: tournamentId, limit: 200 },
    {
      skip: !enabled || !tournamentId || stations.length > 0,
      refetchOnMountOrArgChange: true,
      pollingInterval: 20000,
    },
  );

  const list = useMemo(() => {
    if (stations.length) {
      return stations.map((s) => ({
        _id: s?._id || s?.id,
        name: s?.name || s?.clusterName || s?.cluster?.name || "Sân",
        occupied: Boolean(s?.currentMatch) || OCCUPIED_STATUSES.has(s?.status),
        detail: s?.currentMatch
          ? matchLabel(s.currentMatch)
          : s?.status === "maintenance"
            ? "Bảo trì"
            : "Trống",
      }));
    }
    const legacy = Array.isArray(legacyCourts)
      ? legacyCourts
      : legacyCourts?.items || legacyCourts?.courts || legacyCourts?.data || [];
    return (legacy || []).map((c) => ({
      _id: c?._id || c?.id,
      name: c?.name || c?.label || "Sân",
      occupied: Boolean(c?.currentMatch),
      detail: c?.currentMatch ? matchLabel(c.currentMatch) : "Trống",
    }));
  }, [stations, legacyCourts]);

  const { idle, busy } = useMemo(() => {
    const i = [];
    const b = [];
    list.forEach((c) => (c.occupied ? b : i).push(c));
    return { idle: i, busy: b };
  }, [list]);

  if (!enabled || !tournamentId) return null;
  if (!list.length) return null;

  const isFetching = fetchingMonitor || fetchingLegacy;
  const refetch = () => {
    if (stations.length) refetchMonitor();
    else refetchLegacy();
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.25, mb: 1.5, borderRadius: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ flexWrap: "wrap", rowGap: 0.5 }}
      >
        <SportsTennisIcon fontSize="small" color="primary" />
        <Typography
          variant="subtitle2"
          fontWeight={800}
          sx={{ cursor: "pointer" }}
          onClick={() => setOpen((o) => !o)}
        >
          Tình trạng sân
        </Typography>
        <Chip
          size="small"
          color="success"
          variant="outlined"
          label={`${idle.length} trống`}
        />
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={`${busy.length} đang dùng`}
        />
        <Box flex={1} />
        <Tooltip title="Làm mới">
          <span>
            <IconButton
              size="small"
              onClick={refetch}
              disabled={isFetching}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size="small" onClick={() => setOpen((o) => !o)}>
          {open ? (
            <ExpandLessIcon fontSize="small" />
          ) : (
            <ExpandMoreIcon fontSize="small" />
          )}
        </IconButton>
      </Stack>

      <Collapse in={open}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
          {[...idle, ...busy].map((c, i) => (
            <Chip
              key={c._id || `${c.name}-${i}`}
              size="small"
              color={c.occupied ? "warning" : "success"}
              variant={c.occupied ? "filled" : "outlined"}
              label={`${c.name} · ${c.detail}`}
              sx={{ maxWidth: 300 }}
            />
          ))}
        </Box>
      </Collapse>
    </Paper>
  );
}
