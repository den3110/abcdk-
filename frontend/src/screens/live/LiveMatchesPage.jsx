import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
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
import SEOHead from "../../components/SEOHead";

const LIMIT = 12;
// CARD_HEIGHT chỉ dùng cho skeleton lúc loading để UI đỡ nhảy
const SKELETON_HEIGHT = 232;
const STATUS_OPTIONS = ["scheduled", "queued", "assigned", "live", "finished"];
const HOUR_PRESETS = [2, 4, 8, 24, 48, 72];

const DEFAULT_WINDOW_HOURS = 72; // ✅ mặc định 72h
const DEFAULT_EXCLUDE_FINISHED = false; // ✅ mặc định gồm luôn finished
const DEFAULT_AUTO_REFRESH = true;
const DEFAULT_REFRESH_SEC = 15;
const FILTER_STORAGE_KEY = "liveMatchesFilters:v1";

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

  // ⚙️ format label cho option thời gian
  const formatWindowOptionLabel = (h) => {
    if (h < 24) return `${h} giờ gần nhất`;
    const days = h / 24;
    return `${days} ngày gần nhất`;
  };

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
    // ✅ reset về mặc định mới
    setStatuses([...STATUS_OPTIONS]);
    setExcludeFinished(DEFAULT_EXCLUDE_FINISHED);
    setWindowHours(DEFAULT_WINDOW_HOURS);
    setAutoRefresh(DEFAULT_AUTO_REFRESH);
    setRefreshSec(DEFAULT_REFRESH_SEC);
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
                <MenuItem key={h} value={h}>
                  {formatWindowOptionLabel(h)}
                </MenuItem>
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
  const [excludeFinished, setExcludeFinished] = useState(
    DEFAULT_EXCLUDE_FINISHED
  );
  const [windowHours, setWindowHours] = useState(DEFAULT_WINDOW_HOURS);
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(DEFAULT_AUTO_REFRESH);
  const [refreshSec, setRefreshSec] = useState(DEFAULT_REFRESH_SEC);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filtersReady, setFiltersReady] = useState(false); // ✅ để tránh save đè lên data cũ khi chưa load xong

  // ✅ NEW: list id match đã xoá video (ẩn card trên FE)
  const [removedIds, setRemovedIds] = useState([]);

  // ✅ load filters từ localStorage lần đầu
  useEffect(() => {
    if (typeof window === "undefined") {
      setFiltersReady(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.statuses) && saved.statuses.length) {
          const validStatuses = saved.statuses.filter((s) =>
            STATUS_OPTIONS.includes(s)
          );
          if (validStatuses.length) setStatuses(validStatuses);
        }
        if (typeof saved.excludeFinished === "boolean") {
          setExcludeFinished(saved.excludeFinished);
        }
        if (typeof saved.windowHours === "number" && saved.windowHours > 0) {
          setWindowHours(saved.windowHours);
        }
        if (typeof saved.autoRefresh === "boolean") {
          setAutoRefresh(saved.autoRefresh);
        }
        if (typeof saved.refreshSec === "number" && saved.refreshSec > 0) {
          setRefreshSec(saved.refreshSec);
        }
      }
    } catch (e) {
      console.error("Failed to load live matches filters from storage", e);
    } finally {
      setFiltersReady(true);
    }
  }, []);

  // ✅ mỗi khi filter đổi thì lưu xuống localStorage
  useEffect(() => {
    if (!filtersReady) return;
    if (typeof window === "undefined") return;
    try {
      const payload = {
        statuses,
        excludeFinished,
        windowHours,
        autoRefresh,
        refreshSec,
      };
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error("Failed to save live matches filters to storage", e);
    }
  }, [
    filtersReady,
    statuses,
    excludeFinished,
    windowHours,
    autoRefresh,
    refreshSec,
  ]);

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

  // ✅ label khoảng thời gian tương đương windowMs (now - windowMs → now)
  const windowRangeLabel = useMemo(() => {
    if (!windowHours || windowHours <= 0) return "";
    const now = new Date(tick);
    const from = new Date(now.getTime() - windowHours * 3600 * 1000);

    const fmtTime = (d) =>
      d.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    const fmtDate = (d) =>
      d.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
      });

    const sameDay = from.toDateString() === now.toDateString();

    if (sameDay) {
      // Ví dụ: 13:00–21:00 hôm nay (24/11)
      return `${fmtTime(from)}–${fmtTime(now)} hôm nay (${fmtDate(now)})`;
    }

    // Ví dụ: 22:00 23/11 – 06:00 24/11
    return `${fmtTime(from)} ${fmtDate(from)} – ${fmtTime(now)} ${fmtDate(
      now
    )}`;
  }, [tick, windowHours]);

  const activeFilters =
    (statuses.length !== STATUS_OPTIONS.length ? 1 : 0) +
    (excludeFinished ? 1 : 0) + // ✅ bật loại finished thì mới tính là filter
    (windowHours !== DEFAULT_WINDOW_HOURS ? 1 : 0) +
    (!autoRefresh || refreshSec !== DEFAULT_REFRESH_SEC ? 1 : 0);

  const applyFilters = (p) => {
    setStatuses(p.statuses);
    setExcludeFinished(p.excludeFinished);
    setWindowHours(p.windowHours);
    setAutoRefresh(p.autoRefresh);
    setRefreshSec(p.refreshSec);
    setFilterOpen(false);
    setPage(1);
    // đổi filter thì clear list match đã xoá, cho sync lại với server
    setRemovedIds([]);
  };

  const clearChip = (t) => {
    if (t === "statuses") setStatuses([...STATUS_OPTIONS]);
    else if (t === "window") setWindowHours(DEFAULT_WINDOW_HOURS);
    else if (t === "finished") setExcludeFinished(DEFAULT_EXCLUDE_FINISHED);
    else if (t === "auto") {
      setAutoRefresh(DEFAULT_AUTO_REFRESH);
      setRefreshSec(DEFAULT_REFRESH_SEC);
    }
    setPage(1);
    setRemovedIds([]);
  };

  const initialFilters = useMemo(
    () => ({ statuses, excludeFinished, windowHours, autoRefresh, refreshSec }),
    [statuses, excludeFinished, windowHours, autoRefresh, refreshSec]
  );

  // ✅ handler khi 1 card báo "đã xoá video"
  const handleCardDeleted = useCallback((matchId) => {
    if (!matchId) return;
    const idStr = String(matchId);
    setRemovedIds((prev) => (prev.includes(idStr) ? prev : [...prev, idStr]));
  }, []);

  // ✅ items hiển thị thực tế = items từ API trừ đi những cái đã xoá video
  const visibleItems = useMemo(() => {
    if (!removedIds.length) return items;
    return items.filter((it) => !removedIds.includes(String(it._id)));
  }, [items, removedIds]);

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
      <SEOHead
        title="Trực tiếp"
        description="Xem trực tiếp tỉ số, video và diễn biến các trận đấu Pickleball đang diễn ra tại Việt Nam."
        path="/live"
      />
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

      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
        {statuses.length !== STATUS_OPTIONS.length && (
          <Chip
            label={`Trạng thái: ${statuses.join(", ")}`}
            onDelete={() => clearChip("statuses")}
            size="small"
            variant="outlined"
          />
        )}
        {windowHours !== DEFAULT_WINDOW_HOURS && (
          <Chip
            label={`Cửa sổ: ${windowHours}h`}
            onDelete={() => clearChip("window")}
            size="small"
            variant="outlined"
          />
        )}
        {excludeFinished && (
          <Chip
            label="Đang loại finished"
            onDelete={() => clearChip("finished")}
            size="small"
            variant="outlined"
          />
        )}
        {(!autoRefresh || refreshSec !== DEFAULT_REFRESH_SEC) && (
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

      {/* ✅ dòng mô tả khoảng thời gian tương đương windowMs */}
      {windowRangeLabel && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mb: 2, width: "100%", textAlign: "right" }}
        >
          Khoảng thời gian: {windowRangeLabel}
        </Typography>
      )}

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
            {visibleItems.map((it) => (
              <Box
                key={it._id}
                sx={{
                  // ❗ Không đặt height cố định ở đây
                  display: "flex",
                  minWidth: 0,
                  alignItems: "stretch", // để con stretch full chiều cao grid item
                }}
              >
                <LiveMatchCard item={it} onDeleted={handleCardDeleted} />
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

          {visibleItems.length === 0 && (
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
