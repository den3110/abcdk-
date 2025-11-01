import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Box,
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
import { useGetLiveMatchesQuery } from "../../slices/liveApiSlice";

const LIMIT = 12;
// CARD_HEIGHT chỉ dùng cho skeleton lúc loading để UI đỡ nhảy
const SKELETON_HEIGHT = 232;
const STATUS_OPTIONS = ["scheduled", "queued", "assigned", "live", "finished"];
const HOUR_PRESETS = [2, 4, 8, 24];

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
    if (!open) return;
    setStatuses(initial.statuses);
    setExcludeFinished(initial.excludeFinished);
    setWindowHours(initial.windowHours);
    setAutoRefresh(initial.autoRefresh);
    setRefreshSec(initial.refreshSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allSelected = statuses.length === STATUS_OPTIONS.length;
  const handleStatusesChange = (e) => {
    const val = e.target.value;
    if (val.includes("__ALL__") || val.length === 0)
      setStatuses([...STATUS_OPTIONS]);
    else setStatuses(val);
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
      keepMounted
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Bộ lọc</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">Trạng thái</Typography>
            <Select
              multiple
              size="small"
              value={statuses}
              onChange={handleStatusesChange}
              renderValue={(s) =>
                s.length === STATUS_OPTIONS.length ? "Tất cả" : s.join(", ")
              }
              MenuProps={{
                disablePortal: true,
                PaperProps: { style: { maxHeight: 320 } },
              }}
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

          <Stack spacing={1}>
            <Typography variant="subtitle2">Cửa sổ thời gian</Typography>
            <Select
              size="small"
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
              MenuProps={{ disablePortal: true }}
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
                MenuProps={{ disablePortal: true }}
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
  const [keyword, setKeyword] = useState("");
  const [statuses, setStatuses] = useState([...STATUS_OPTIONS]);
  const [excludeFinished, setExcludeFinished] = useState(true);
  const [windowHours, setWindowHours] = useState(8);
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState(15);
  const [filterOpen, setFilterOpen] = useState(false);

  const qArgs = useMemo(() => {
    const filteredStatuses = excludeFinished
      ? statuses.filter((s) => s !== "finished")
      : statuses;
    const args = {
      keyword,
      page: page - 1,
      limit: LIMIT,
      statuses: filteredStatuses.join(","),
      windowMs: windowHours * 3600 * 1000,
    };
    if (!excludeFinished) args.excludeFinished = false;
    return args;
  }, [keyword, page, statuses, excludeFinished, windowHours]);

  const { data, isLoading, isFetching, refetch } = useGetLiveMatchesQuery(
    qArgs,
    {
      refetchOnFocus: true,
      refetchOnReconnect: true,
    }
  );

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => refetch(), Math.max(5, refreshSec) * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshSec, refetch, qArgs]);

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

  const activeFilters =
    (statuses.length !== STATUS_OPTIONS.length ? 1 : 0) +
    (excludeFinished ? 0 : 1) +
    (windowHours !== 8 ? 1 : 0) +
    (!autoRefresh || refreshSec !== 15 ? 1 : 0);

  const applyFilters = (p) => {
    setStatuses(p.statuses);
    setExcludeFinished(p.excludeFinished);
    setWindowHours(p.windowHours);
    setAutoRefresh(p.autoRefresh);
    setRefreshSec(p.refreshSec);
    setFilterOpen(false);
    setPage(1);
  };
  const clearChip = (t) => {
    if (t === "statuses") setStatuses([...STATUS_OPTIONS]);
    else if (t === "window") setWindowHours(8);
    else if (t === "finished") setExcludeFinished(true);
    else if (t === "auto") {
      setAutoRefresh(true);
      setRefreshSec(15);
    }
    setPage(1);
  };
  const initialFilters = useMemo(
    () => ({ statuses, excludeFinished, windowHours, autoRefresh, refreshSec }),
    [statuses, excludeFinished, windowHours, autoRefresh, refreshSec]
  );

  // CSS Grid: mỗi hàng tự cao theo item cao nhất; item bên trong phải stretch
  const gridSx = {
    display: "grid",
    gap: (theme) => theme.spacing(2),
    gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
    "@media (min-width:600px)": {
      gridTemplateColumns: "repeat(2, minmax(0,1fr))",
    },
    "@media (min-width:900px)": {
      gridTemplateColumns: "repeat(3, minmax(0,1fr))",
    },
    "@media (min-width:1200px)": {
      gridTemplateColumns: "repeat(4, minmax(0,1fr))",
    },
    alignItems: "stretch", // ✅ các grid item cao bằng nhau theo hàng
  };

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
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

      {isLoading ? (
        <Box sx={gridSx}>
          {Array.from({ length: LIMIT }).map((_, i) => (
            <Box
              key={i}
              sx={{
                // skeleton có chiều cao cố định để tránh layout shift lúc tải
                height: SKELETON_HEIGHT,
                display: "flex",
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <Skeleton variant="rounded" height="100%" sx={{ flex: 1 }} />
            </Box>
          ))}
        </Box>
      ) : (
        <>
          <Box sx={gridSx}>
            {items.map((it) => (
              <Box
                key={it._id}  
                sx={{
                  // ❗ Không đặt height cố định ở đây
                  display: "flex",
                  minWidth: 0,
                  alignItems: "stretch", // để con stretch full chiều cao grid item
                }}
              >
                <LiveMatchCard item={it} />
              </Box>
            ))}
          </Box>

          {pages > 1 && (
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
                    Trang {page}/{pages}
                  </Typography>
                  <Divider orientation="vertical" flexItem />
                  <Button
                    size="small"
                    onClick={() => setPage((p) => Math.min(pages || 1, p + 1))}
                    disabled={page >= (pages || 1)}
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
                Thử "Bộ lọc" → chọn "LIVE" hoặc tăng cửa sổ thời gian.
              </Typography>
            </Box>
          )}
        </>
      )}

      <FiltersDialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        initial={initialFilters}
        onApply={applyFilters}
      />
    </Box>
  );
}
