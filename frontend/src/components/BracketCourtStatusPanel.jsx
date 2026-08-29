// components/BracketCourtStatusPanel.jsx
// Panel tình trạng sân (chỉ xem) cho admin/quản lý trên trang Sơ đồ giải:
// biết sân nào trống / đang dùng. Dữ liệu từ adminListCourts (court.currentMatch = đang dùng).
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

const courtName = (c) => c?.name || c?.label || "Sân";
const matchLabel = (cm) =>
  cm?.code ||
  cm?.labelKey ||
  cm?.roundLabel ||
  cm?.matchCode ||
  "Đang thi đấu";

export default function BracketCourtStatusPanel({ tournamentId, enabled = true }) {
  const [open, setOpen] = useState(true);
  const {
    data: courts,
    isFetching,
    refetch,
  } = useAdminListCourtsQuery(
    { tid: tournamentId, limit: 200 },
    {
      skip: !enabled || !tournamentId,
      refetchOnMountOrArgChange: true,
      pollingInterval: 20000,
    },
  );

  const list = useMemo(() => {
    if (Array.isArray(courts)) return courts;
    return courts?.items || courts?.courts || courts?.data || [];
  }, [courts]);

  const { idle, busy } = useMemo(() => {
    const i = [];
    const b = [];
    (list || []).forEach((c) => (c?.currentMatch ? b : i).push(c));
    return { idle: i, busy: b };
  }, [list]);

  if (!enabled || !tournamentId) return null;
  if (!list.length) return null;

  return (
    <Paper variant="outlined" sx={{ p: 1.25, mb: 1.5, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
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
            <IconButton size="small" onClick={() => refetch()} disabled={isFetching}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size="small" onClick={() => setOpen((o) => !o)}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Stack>

      <Collapse in={open}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
          {[...idle, ...busy].map((c) => {
            const isBusy = !!c?.currentMatch;
            return (
              <Chip
                key={c?._id || c?.id || courtName(c)}
                size="small"
                color={isBusy ? "warning" : "success"}
                variant={isBusy ? "filled" : "outlined"}
                label={
                  isBusy
                    ? `${courtName(c)} · ${matchLabel(c.currentMatch)}`
                    : `${courtName(c)} · Trống`
                }
                sx={{ maxWidth: 280 }}
              />
            );
          })}
        </Box>
      </Collapse>
    </Paper>
  );
}
