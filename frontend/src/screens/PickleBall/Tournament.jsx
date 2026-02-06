// src/pages/TournamentDashboard.jsx
import { useState, useEffect, useMemo } from "react";
import { useSearchParams, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Tabs,
  Tab,
  Button,
  Card,
  CardContent,
  Stack,
  useTheme,
  TextField,
  Skeleton,
  InputAdornment,
  IconButton,
  LinearProgress,
  Fade,
  styled,
  alpha,
  Grid, // MUI v7 Grid
  CardActions,
} from "@mui/material";

// Icons
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import PlaceIcon from "@mui/icons-material/Place";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import EventNoteIcon from "@mui/icons-material/EventNote";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import FilterListIcon from "@mui/icons-material/FilterList";

import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";
import { useSelector } from "react-redux";

// ====== Date pickers (PRO) ======
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { DateRangePicker } from "@mui/x-date-pickers-pro/DateRangePicker";

// ====== Zoom components ======
import { ZoomProvider, ZoomItem } from "../../components/Zoom";
import SponsorMarquee from "../../components/SponsorMarquee";

// --- STYLED COMPONENTS ---
const GlassCard = styled(Card)(({ theme }) => ({
  background:
    theme.palette.mode === "dark"
      ? alpha(theme.palette.background.default, 0.6)
      : "#ffffff",
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 16,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  height: "100%",
  transition: "all 0.3s ease",
  "&:hover": {
    transform: "translateY(-4px)",
    boxShadow: theme.shadows[8],
    borderColor: theme.palette.primary.main,
    "& .zoom-image": { transform: "scale(1.08)" },
  },
}));

const StatusBadge = styled(Box)(({ theme, status }) => {
  const colors = {
    upcoming: theme.palette.info.main,
    ongoing: theme.palette.success.main,
    finished: theme.palette.text.disabled,
  };
  const bgColors = {
    upcoming: alpha(theme.palette.info.main, 0.9),
    ongoing: alpha(theme.palette.success.main, 0.9),
    finished: alpha(theme.palette.grey[700], 0.9),
  };

  const bg = bgColors[status] || theme.palette.primary.main;

  return {
    padding: "4px 10px",
    borderRadius: 6,
    backgroundColor: bg,
    color: "#fff",
    fontWeight: 700,
    fontSize: "0.75rem",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
    "& .dot": {
      width: 6,
      height: 6,
      borderRadius: "50%",
      backgroundColor: "#fff", // Badge dot - intentionally white for visibility
      animation: status === "ongoing" ? "pulse 1.5s infinite" : "none",
    },
    "@keyframes pulse": {
      "0%": { opacity: 1, transform: "scale(1)" },
      "50%": { opacity: 0.5, transform: "scale(1.2)" },
      "100%": { opacity: 1, transform: "scale(1)" },
    },
  };
});

const StatBox = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderRadius: 16,
  minWidth: 140,
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  boxShadow: theme.shadows[1],
}));

const STATUS_META = {
  upcoming: { label: "Sắp diễn ra", id: "upcoming" },
  ongoing: { label: "Đang diễn ra", id: "ongoing" },
  finished: { label: "Đã kết thúc", id: "finished" },
};
const TABS = ["upcoming", "ongoing", "finished"];

export default function TournamentDashboard() {
  const theme = useTheme();
  const me = useSelector((s) => s.auth?.userInfo || null);

  // --- Auth Logic ---
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const isManagerOf = (t) => {
    if (!me?._id) return false;
    if (String(t?.createdBy) === String(me._id)) return true;
    if (Array.isArray(t?.managers))
      return t.managers.some((m) => String(m?.user ?? m) === String(me._id));
    return !!t.isManager;
  };
  const canManage = (t) => isAdmin || isManagerOf(t);

  // --- State ---
  const [params, setParams] = useSearchParams();
  const sportType = params.get("sportType") || 2;
  const groupId = params.get("groupId") || 0;
  const initialTab = TABS.includes(params.get("status"))
    ? params.get("status")
    : "upcoming";

  const [tab, setTab] = useState(initialTab);
  const [keyword, setKeyword] = useState(params.get("q") || "");
  const [debouncedKeyword, setDebouncedKeyword] = useState(
    params.get("q")?.toLowerCase() || ""
  );

  const [dateRange, setDateRange] = useState([
    params.get("from") ? dayjs(params.get("from")) : null,
    params.get("to") ? dayjs(params.get("to")) : null,
  ]);

  // --- Sync Logic ---
  useEffect(() => {
    const urlTab = params.get("status");
    if (urlTab && TABS.includes(urlTab) && urlTab !== tab) setTab(urlTab);
  }, [params, tab]);

  // Debounce search -> update URL
  useEffect(() => {
    const handle = setTimeout(() => {
      const val = keyword.trim().toLowerCase();
      setDebouncedKeyword(val);

      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (val) p.set("q", val);
          else p.delete("q");
          return p;
        },
        { replace: true }
      );
    }, 400);

    return () => clearTimeout(handle);
  }, [keyword, setParams]);

  // Sync dateRange -> URL
  useEffect(() => {
    const [start, end] = dateRange;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        start?.isValid()
          ? p.set("from", start.format("YYYY-MM-DD"))
          : p.delete("from");
        end?.isValid() ? p.set("to", end.format("YYYY-MM-DD")) : p.delete("to");
        return p;
      },
      { replace: true }
    );
  }, [dateRange, setParams]);

  const {
    data: tournaments,
    isLoading,
    error,
  } = useGetTournamentsQuery({
    sportType,
    groupId,
  });

  // --- Counts ---
  const counts = useMemo(() => {
    const c = { upcoming: 0, ongoing: 0, finished: 0, total: 0 };
    (tournaments || []).forEach((t) => {
      if (c[t.status] !== undefined) c[t.status] += 1;
      c.total += 1;
    });
    return c;
  }, [tournaments]);

  // --- Filtering ---
  const filtered = useMemo(() => {
    if (!tournaments) return [];
    const [from, to] = dateRange;

    return tournaments
      .filter((t) => t.status === tab)
      .filter((t) =>
        debouncedKeyword
          ? t.name?.toLowerCase().includes(debouncedKeyword)
          : true
      )
      .filter((t) => {
        if (!from && !to) return true;
        const tStart = dayjs(t.startDate);
        const tEnd = dayjs(t.endDate || t.startDate);
        if (from && tEnd.isBefore(from, "day")) return false;
        if (to && tStart.isAfter(to, "day")) return false;
        return true;
      });
  }, [tournaments, tab, debouncedKeyword, dateRange]);

  const handleChangeTab = (_, v) => {
    setTab(v);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("status", v);
        return p;
      },
      { replace: true }
    );
  };

  const formatDate = (d) => (d ? dayjs(d).format("DD/MM/YYYY") : "--");

  // --- COMPONENT: Action Buttons (Đăng ký TO NHẤT + bỏ Check-in) ---
  const Actions = ({ t }) => {
    const btnSx = {
      borderRadius: 2,
      textTransform: "none",
      fontWeight: 600,
      fontSize: "0.8125rem",
      py: 1,
      minHeight: 40,
    };

    const registerBigSx = {
      ...btnSx,
      py: 1.25,
      minHeight: 46,
      fontWeight: 800,
      fontSize: "0.9rem",
    };

    const adminOrMgr = canManage(t);

    // Case 1: Admin/Manager
    if (adminOrMgr) {
      return (
        <Grid container spacing={1}>
          <Grid size={{ xs: 12 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/register`}
              fullWidth
              variant="contained"
              color="primary"
              startIcon={<HowToRegIcon />}
              sx={registerBigSx}
            >
              Đăng ký
            </Button>
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/schedule`}
              fullWidth
              variant="outlined"
              color="primary"
              startIcon={<EventNoteIcon />}
              sx={btnSx}
            >
              Lịch đấu
            </Button>
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/bracket`}
              fullWidth
              variant="outlined"
              color="info"
              startIcon={<AccountTreeIcon />}
              sx={btnSx}
            >
              Sơ đồ
            </Button>
          </Grid>
        </Grid>
      );
    }

    // Case 2: User - Upcoming
    if (t.status === "upcoming") {
      return (
        <Grid container spacing={1}>
          <Grid size={{ xs: 12 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/register`}
              fullWidth
              variant="contained"
              color="primary"
              startIcon={<HowToRegIcon />}
              sx={registerBigSx}
            >
              Đăng ký
            </Button>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/bracket`}
              fullWidth
              variant="outlined"
              color="info"
              startIcon={<AccountTreeIcon />}
              sx={btnSx}
            >
              Sơ đồ
            </Button>
          </Grid>
        </Grid>
      );
    }

    // Case 3: User - Ongoing (Schedule + Bracket)
    if (t.status === "ongoing") {
      return (
        <Grid container spacing={1}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/schedule`}
              fullWidth
              variant="contained"
              color="primary"
              startIcon={<EventNoteIcon />}
              sx={btnSx}
            >
              Lịch đấu
            </Button>
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/bracket`}
              fullWidth
              variant="outlined"
              color="info"
              startIcon={<AccountTreeIcon />}
              sx={btnSx}
            >
              Sơ đồ
            </Button>
          </Grid>
        </Grid>
      );
    }

    // Case 4: User - Finished
    return (
      <Button
        component={RouterLink}
        to={`/tournament/${t._id}/bracket`}
        fullWidth
        variant="outlined"
        color="info"
        startIcon={<AccountTreeIcon />}
        sx={btnSx}
      >
        Xem sơ đồ kết quả
      </Button>
    );
  };

  // --- COMPONENT: Tournament Card ---
  const TournamentCard = ({ t }) => {
    const percent = Math.min(
      100,
      Math.round((t.registered / t.maxPairs) * 100)
    );

    return (
      <GlassCard>
        {/* Image Area */}
        <Box
          sx={{
            position: "relative",
            height: 180,
            overflow: "hidden",
            bgcolor: "action.hover",
          }}
        >
          <Box sx={{ position: "absolute", top: 12, right: 12, zIndex: 2 }}>
            <StatusBadge status={t.status}>
              <div className="dot" /> {STATUS_META[t.status].label}
            </StatusBadge>
          </Box>

          <ZoomItem src={t.image}>
            <Box sx={{ width: "100%", height: "100%", cursor: "zoom-in" }}>
              <img
                src={
                  t.image || "https://via.placeholder.com/400x200?text=No+Image"
                }
                alt={t.name}
                className="zoom-image"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transition: "transform 0.5s ease",
                }}
              />
            </Box>
          </ZoomItem>
        </Box>

        <CardContent sx={{ flexGrow: 1, p: 2, pb: 1 }}>
          <Typography
            variant="subtitle1"
            fontWeight={800}
            sx={{
              minHeight: "3rem",
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              mb: 1,
            }}
          >
            {t.name}
          </Typography>

          <Stack spacing={1.5}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              color="text.secondary"
            >
              <CalendarMonthIcon fontSize="small" color="action" />
              <Typography variant="body2" fontWeight={500}>
                {formatDate(t.startDate)} - {formatDate(t.endDate)}
              </Typography>
            </Stack>

            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              color="text.secondary"
            >
              <PlaceIcon fontSize="small" color="action" />
              <Typography variant="body2" noWrap sx={{ maxWidth: "100%" }}>
                {t.location || "Chưa cập nhật"}
              </Typography>
            </Stack>

            <Box>
              <Stack direction="row" justifyContent="space-between" mb={0.5}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="text.secondary"
                >
                  Số đội đăng ký
                </Typography>
                <Typography
                  variant="caption"
                  fontWeight={700}
                  color={percent >= 100 ? "error.main" : "primary.main"}
                >
                  {t.registered} / {t.maxPairs}
                </Typography>
              </Stack>

              <LinearProgress
                variant="determinate"
                value={percent}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  bgcolor: alpha(theme.palette.grey[500], 0.1),
                  "& .MuiLinearProgress-bar": {
                    borderRadius: 3,
                    background:
                      percent >= 100
                        ? theme.palette.error.main
                        : theme.palette.primary.main,
                  },
                }}
              />
            </Box>
          </Stack>
        </CardContent>

        <CardActions sx={{ p: 2, pt: 0, mt: "auto" }}>
          <Box width="100%">
            <Actions t={t} />
          </Box>
        </CardActions>
      </GlassCard>
    );
  };

  return (
    <>
      <SponsorMarquee variant="glass" height={80} gap={24} />
      <Container maxWidth="xl" sx={{ py: 2, minHeight: "100vh" }}>
        {/* HEADER STATS */}
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={4}
          alignItems="center"
          sx={{ mb: 5 }}
        >
          <Box flex={1}>
            <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>
              Giải Đấu
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Quản lý và tham gia các giải đấu thể thao chuyên nghiệp.
            </Typography>
          </Box>

          <Stack
            direction="row"
            spacing={2}
            sx={{ 
              width: { xs: "100%", md: "auto" }, 
              overflowX: "auto", 
              pb: 1,
              // Hide scrollbar
              "&::-webkit-scrollbar": { display: "none" },
              scrollbarWidth: "none", // Firefox
              msOverflowStyle: "none", // IE/Edge
            }}
          >
            <StatBox>
              <Typography
                variant="caption"
                fontWeight={700}
                color="text.secondary"
              >
                TỔNG GIẢI
              </Typography>
              <Typography variant="h4" fontWeight={800}>
                {counts.total}
              </Typography>
            </StatBox>

            <StatBox
              sx={{
                borderColor: "success.main",
                bgcolor: alpha(theme.palette.success.main, 0.05),
              }}
            >
              <Typography
                variant="caption"
                fontWeight={700}
                color="success.main"
              >
                ĐANG DIỄN RA
              </Typography>
              <Typography variant="h4" fontWeight={800} color="success.main">
                {counts.ongoing}
              </Typography>
            </StatBox>

            <StatBox
              sx={{
                borderColor: "info.main",
                bgcolor: alpha(theme.palette.info.main, 0.05),
              }}
            >
              <Typography variant="caption" fontWeight={700} color="info.main">
                SẮP TỚI
              </Typography>
              <Typography variant="h4" fontWeight={800} color="info.main">
                {counts.upcoming}
              </Typography>
            </StatBox>
          </Stack>
        </Stack>

        {/* CONTROLS */}
        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={2}
          alignItems={{ xs: "stretch", lg: "center" }}
          justifyContent="space-between"
          sx={{ mb: 4 }}
        >
          <Tabs
            value={tab}
            onChange={handleChangeTab}
            variant="scrollable"
            sx={{
              minHeight: 48,
              "& .MuiTab-root": {
                borderRadius: 3,
                mr: 1,
                px: 3,
                fontWeight: 700,
                textTransform: "none",
                minHeight: 44,
                transition: "all 0.2s",
                "&.Mui-selected": { bgcolor: "primary.main", color: "primary.contrastText" },
              },
              "& .MuiTabs-indicator": { display: "none" },
            }}
          >
            {TABS.map((v) => (
              <Tab key={v} value={v} label={STATUS_META[v].label} />
            ))}
          </Tabs>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              placeholder="Tìm tên giải đấu..."
              size="small"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              sx={{
                width: { xs: "100%", sm: 240 },
                "& .MuiOutlinedInput-root": {
                  borderRadius: 3,
                  bgcolor: "background.paper",
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: keyword && (
                  <IconButton size="small" onClick={() => setKeyword("")}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                ),
              }}
            />

            <Box sx={{ width: { xs: "100%", sm: 300 } }}>
              <DateRangePicker
                calendars={2}
                value={dateRange}
                onChange={(v) => setDateRange(v)}
                slotProps={{
                  textField: {
                    size: "small",
                    fullWidth: true,
                    placeholder: "Lọc theo ngày",
                    InputProps: {
                      sx: { borderRadius: 3, bgcolor: "background.paper" },
                    },
                  },
                }}
              />
            </Box>

            {(dateRange[0] || dateRange[1]) && (
              <Button
                color="error"
                variant="outlined"
                sx={{ borderRadius: 3, minWidth: 40 }}
                onClick={() => setDateRange([null, null])}
              >
                <FilterListIcon />
              </Button>
            )}
          </Stack>
        </Stack>

        {/* LIST CONTENT */}
        <Box sx={{ minHeight: 400 }}>
          {error && (
            <Box p={3} color="error.dark" borderRadius={3} textAlign="center">
              Lỗi tải dữ liệu: {error?.data?.message}
            </Box>
          )}

          {isLoading ? (
            <Grid container spacing={3}>
              {[...Array(8)].map((_, i) => (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={i}>
                  <Skeleton
                    variant="rounded"
                    height={400}
                    sx={{ borderRadius: 4 }}
                  />
                </Grid>
              ))}
            </Grid>
          ) : (
            <ZoomProvider maskOpacity={0.8}>
              {filtered.length === 0 ? (
                <Stack
                  alignItems="center"
                  justifyContent="center"
                  spacing={2}
                  sx={{ py: 10, opacity: 0.6 }}
                >
                  <EmojiEventsIcon
                    sx={{ fontSize: 80, color: "text.disabled" }}
                  />
                  <Typography variant="h6" color="text.disabled">
                    Không tìm thấy giải đấu nào phù hợp.
                  </Typography>
                </Stack>
              ) : (
                <Grid container spacing={3}>
                  {filtered.map((t) => (
                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={t._id}>
                      <Fade in timeout={500}>
                        <Box height="100%">
                          <TournamentCard t={t} />
                        </Box>
                      </Fade>
                    </Grid>
                  ))}
                </Grid>
              )}
            </ZoomProvider>
          )}
        </Box>
      </Container>
    </>
  );
}
