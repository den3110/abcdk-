// src/pages/LiveMatchesPage.jsx  (drop-in thay file cũ)

import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Box,
  Grid,
  Stack,
  Typography,
  Paper,
  Skeleton,
  OutlinedInput,
  InputAdornment,
  IconButton,
  Button,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  FormControlLabel,
  Switch,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import RefreshIcon from "@mui/icons-material/Refresh";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";

import LiveMatchCard from "./LiveMatchCard";
// NOTE: dùng đúng path slice của bạn
import { useGetLiveMatchesQuery } from "../../slices/liveApiSlice";

const LIMIT = 12;
const STATUS_OPTIONS = ["scheduled", "queued", "assigned", "live"];
const HOUR_PRESETS = [2, 4, 8, 24];

// ===== Utils =====
function useTickingAgo() {
  const [ts, setTs] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return ts;
}

function FiltersDialog({ open, onClose, initial, onApply }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  const [statuses, setStatuses] = useState(initial.statuses);
  const [excludeFinished, setExcludeFinished] = useState(
    initial.excludeFinished
  );
  const [windowHours, setWindowHours] = useState(initial.windowHours);
  const [autoRefresh, setAutoRefresh] = useState(initial.autoRefresh);
  const [refreshSec, setRefreshSec] = useState(initial.refreshSec);

  useEffect(() => {
    if (open) {
      setStatuses(initial.statuses);
      setExcludeFinished(initial.excludeFinished);
      setWindowHours(initial.windowHours);
      setAutoRefresh(initial.autoRefresh);
      setRefreshSec(initial.refreshSec);
    }
  }, [open, initial]);

  const allSelected = statuses.length === STATUS_OPTIONS.length;

  const handleStatusesChange = (e) => {
    const val = e.target.value;
    // Nếu người dùng chọn “(Tất cả)” hoặc bỏ trống → set all
    if (val.includes("__ALL__") || val.length === 0) {
      setStatuses([...STATUS_OPTIONS]);
    } else {
      setStatuses(val);
    }
  };

  const handleReset = () => {
    setStatuses([...STATUS_OPTIONS]);
    setExcludeFinished(true);
    setWindowHours(8);
    setAutoRefresh(true);
    setRefreshSec(15);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Bộ lọc</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {/* Trạng thái */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">Trạng thái</Typography>
            <Select
              multiple
              value={statuses}
              onChange={handleStatusesChange}
              renderValue={(selected) =>
                selected.length === STATUS_OPTIONS.length
                  ? "Tất cả"
                  : selected.join(", ")
              }
              size="small"
            >
              <MenuItem value="__ALL__">
                <Checkbox checked={allSelected} />
                <ListItemText primary="Tất cả" />
              </MenuItem>
              <Divider />
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>
                  <Checkbox checked={statuses.indexOf(s) > -1} />
                  <ListItemText primary={s} />
                </MenuItem>
              ))}
            </Select>
          </Stack>

          {/* Cửa sổ thời gian */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">Cửa sổ thời gian</Typography>
            <Select
              size="small"
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
            >
              {HOUR_PRESETS.map((h) => (
                <MenuItem key={h} value={h}>{`${h} giờ gần nhất`}</MenuItem>
              ))}
            </Select>
            <FormControlLabel
              control={
                <Switch
                  checked={!excludeFinished}
                  onChange={(e) => setExcludeFinished(!e.target.checked)}
                />
              }
              label={
                excludeFinished
                  ? "Đang loại các trận finished"
                  : "Đang gồm cả finished"
              }
            />
          </Stack>

          {/* Auto refresh */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">Tự làm mới</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <FormControlLabel
                control={
                  <Switch
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                }
                label="Bật"
              />
              <Select
                size="small"
                value={refreshSec}
                onChange={(e) => setRefreshSec(Number(e.target.value))}
                disabled={!autoRefresh}
              >
                <MenuItem value={10}>10 giây</MenuItem>
                <MenuItem value={15}>15 giây</MenuItem>
                <MenuItem value={30}>30 giây</MenuItem>
                <MenuItem value={60}>60 giây</MenuItem>
              </Select>
            </Stack>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2 }}>
        <Button startIcon={<RestartAltIcon />} onClick={handleReset}>
          Mặc định
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Hủy</Button>
        <Button
          variant="contained"
          onClick={() =>
            onApply({
              statuses,
              excludeFinished,
              windowHours,
              autoRefresh,
              refreshSec,
            })
          }
        >
          Áp dụng
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function LiveMatchesPage() {
  // ===== State chính =====
  const [keyword, setKeyword] = useState("");
  const [statuses, setStatuses] = useState([...STATUS_OPTIONS]);
  const [excludeFinished, setExcludeFinished] = useState(true);
  const [windowHours, setWindowHours] = useState(8);
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState(15);
  const [filterOpen, setFilterOpen] = useState(false);

  // ===== Query args (server) =====
  const qArgs = useMemo(
    () => ({
      keyword,
      page: page - 1,
      limit: LIMIT,
      statuses: statuses.join(","),
      excludeFinished,
      windowMs: windowHours * 3600 * 1000,
    }),
    [keyword, page, statuses, excludeFinished, windowHours]
  );

  const { data, isLoading, isFetching, refetch } = useGetLiveMatchesQuery(
    qArgs,
    {
      refetchOnFocus: true,
      refetchOnReconnect: true,
    }
  );

  // ===== Auto refresh =====
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      refetch();
    }, Math.max(5, refreshSec) * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshSec, refetch]);

  // ===== Summary & timing =====
  const pages = data?.pages || 1;
  const items = data?.items || [];
  const total = data?.rawCount ?? 0;

  const tick = useTickingAgo();
  const lastFetchRef = useRef(Date.now());
  useEffect(() => {
    if (!isFetching) lastFetchRef.current = Date.now();
  }, [isFetching]);
  const updatedAgoSec = Math.max(
    0,
    Math.floor((tick - lastFetchRef.current) / 1000)
  );

  // số filter đang bật (khác default)
  const activeFilters =
    (statuses.length !== STATUS_OPTIONS.length ? 1 : 0) +
    (excludeFinished ? 0 : 1) +
    (windowHours !== 8 ? 1 : 0) +
    (!autoRefresh || refreshSec !== 15 ? 1 : 0);

  // ===== Handlers =====
  const applyFilters = (payload) => {
    setStatuses(payload.statuses);
    setExcludeFinished(payload.excludeFinished);
    setWindowHours(payload.windowHours);
    setAutoRefresh(payload.autoRefresh);
    setRefreshSec(payload.refreshSec);
    setFilterOpen(false);
    setPage(1);
  };

  const clearChip = (type) => {
    switch (type) {
      case "statuses":
        setStatuses([...STATUS_OPTIONS]);
        break;
      case "window":
        setWindowHours(8);
        break;
      case "finished":
        setExcludeFinished(true);
        break;
      case "auto":
        setAutoRefresh(true);
        setRefreshSec(15);
        break;
      default:
        break;
    }
    setPage(1);
  };

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
      {/* TOOLBAR siêu gọn */}
      <Paper
        variant="outlined"
        sx={{
          p: 1,
          mb: 1.5,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <OutlinedInput
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã trận, sân, nền tảng…"
          size="small"
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          }
          sx={{ flex: 1, minWidth: 240 }}
        />

        <Tooltip title="Bộ lọc">
          <Button
            variant="outlined"
            startIcon={<TuneIcon />}
            onClick={() => setFilterOpen(true)}
            sx={{ textTransform: "none" }}
          >
            Bộ lọc {activeFilters > 0 ? `(${activeFilters})` : ""}
          </Button>
        </Tooltip>

        <Tooltip title="Làm mới">
          <span>
            <IconButton onClick={() => refetch()} disabled={isFetching}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Paper>

      {/* CHIPS TÓM TẮT FILTER (có thể xoá từng mục) */}
      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
        {statuses.length !== STATUS_OPTIONS.length && (
          <Chip
            label={`Trạng thái: ${statuses.join(", ")}`}
            onDelete={() => clearChip("statuses")}
            size="small"
            variant="outlined"
          />
        )}
        {windowHours !== 8 && (
          <Chip
            label={`Cửa sổ: ${windowHours}h`}
            onDelete={() => clearChip("window")}
            size="small"
            variant="outlined"
          />
        )}
        {!excludeFinished && (
          <Chip
            label="Gồm finished"
            onDelete={() => clearChip("finished")}
            size="small"
            variant="outlined"
          />
        )}
        {(!autoRefresh || refreshSec !== 15) && (
          <Chip
            label={`Auto: ${autoRefresh ? `${refreshSec}s` : "Tắt"}`}
            onDelete={() => clearChip("auto")}
            size="small"
            variant="outlined"
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">
          <PlayCircleOutlineIcon sx={{ mr: 0.5 }} fontSize="small" />
          {total} luồng trực tiếp • cập nhật {updatedAgoSec}s trước
        </Typography>
      </Stack>

      {/* GRID */}
      {isLoading ? (
        <Grid container spacing={2}>
          {Array.from({ length: LIMIT }).map((_, i) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={i}>
              <Skeleton variant="rounded" height={180} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <>
          <Grid container spacing={2}>
            {items.map((it) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={it.matchId}>
                <LiveMatchCard item={it} />
              </Grid>
            ))}
          </Grid>

          {/* Pagination đơn giản: chỉ hiện nếu >1 trang */}
          {data?.pages > 1 && (
            <Stack direction="row" justifyContent="center" sx={{ mt: 2 }}>
              <Paper
                variant="outlined"
                sx={{ px: 1.5, py: 0.5, borderRadius: 999 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Trước
                  </Button>
                  <Divider orientation="vertical" flexItem />
                  <Typography variant="body2" px={1.5}>
                    Trang {page}/{data?.pages}
                  </Typography>
                  <Divider orientation="vertical" flexItem />
                  <Button
                    size="small"
                    onClick={() =>
                      setPage((p) => Math.min(data?.pages || 1, p + 1))
                    }
                    disabled={page >= (data?.pages || 1)}
                  >
                    Sau
                  </Button>
                </Stack>
              </Paper>
            </Stack>
          )}

          {items.length === 0 && (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography variant="h6">Không có trận phù hợp bộ lọc</Typography>
              <Typography variant="body2" color="text.secondary">
                Thử “Bộ lọc” → chọn “LIVE” hoặc tăng cửa sổ thời gian.
              </Typography>
            </Box>
          )}
        </>
      )}

      {/* DIALOG FILTER */}
      <FiltersDialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        initial={{
          statuses,
          excludeFinished,
          windowHours,
          autoRefresh,
          refreshSec,
        }}
        onApply={applyFilters}
      />
    </Box>
  );
}
