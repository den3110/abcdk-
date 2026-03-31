/* eslint-disable react/prop-types */
// src/pages/TournamentDashboard.jsx
import { useState, useEffect, useMemo, memo, useCallback, useRef } from "react";
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
import FilterListIcon from "@mui/icons-material/FilterList";

import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";
import { useSelector } from "react-redux";

// ====== Date pickers (PRO) ======
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { DateRangePicker } from "@mui/x-date-pickers-pro/DateRangePicker";

// ====== Zoom components ======
import { DEFAULT_FALLBACK } from "../../components/Zoom";
import SponsorMarquee from "../../components/SponsorMarquee";
import SEOHead from "../../components/SEOHead";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";
import { formatDate as formatLocaleDate } from "../../i18n/format.js";
import LottieEmptyState from "../../components/LottieEmptyState";

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
  boxShadow: theme.shadows[1],
  transition: "border-color 0.16s ease, box-shadow 0.16s ease",
}));

const HoverCardFrame = styled(Box)(({ theme }) => ({
  height: "100%",
  width: "100%",
  display: "flex",
  "@media (hover: hover) and (pointer: fine)": {
    "&:hover .tournament-card": {
      borderColor: theme.palette.primary.main,
      boxShadow: theme.shadows[2],
    },
  },
}));

const StatusBadge = styled(Box)(({ theme, status }) => {
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

const TABS = ["upcoming", "ongoing", "finished"];

export default function TournamentDashboard() {
  const theme = useTheme();
  const { t: translate, locale } = useLanguage();
  const me = useSelector((s) => s.auth?.userInfo || null);
  const statusMeta = useMemo(
    () => ({
      upcoming: {
        label: translate("tournaments.statuses.upcoming"),
        id: "upcoming",
      },
      ongoing: {
        label: translate("tournaments.statuses.ongoing"),
        id: "ongoing",
      },
      finished: {
        label: translate("tournaments.statuses.finished"),
        id: "finished",
      },
    }),
    [translate],
  );

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
    params.get("q")?.toLowerCase() || "",
  );

  const [dateRange, setDateRange] = useState([
    params.get("from") ? dayjs(params.get("from")) : null,
    params.get("to") ? dayjs(params.get("to")) : null,
  ]);

  // --- Sync URL → tab (one-way, only on external URL changes) ---
  // Using a ref to skip our own setParams calls
  const skipNextParamsSync = useRef(false);

  useEffect(() => {
    if (skipNextParamsSync.current) {
      skipNextParamsSync.current = false;
      return;
    }
    const urlTab = params.get("status");
    if (urlTab && TABS.includes(urlTab) && urlTab !== tab) setTab(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Debounce search -> update URL
  useEffect(() => {
    const handle = setTimeout(() => {
      const val = keyword.trim().toLowerCase();
      setDebouncedKeyword(val);

      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          const curQ = p.get("q") || "";
          // Only mutate if different
          if (val === curQ) return prev;
          if (val) p.set("q", val);
          else p.delete("q");
          skipNextParamsSync.current = true;
          return p;
        },
        { replace: true },
      );
    }, 400);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  // Sync dateRange -> URL (only when values actually change)
  useEffect(() => {
    const [start, end] = dateRange;
    const nextFrom = start?.isValid() ? start.format("YYYY-MM-DD") : "";
    const nextTo = end?.isValid() ? end.format("YYYY-MM-DD") : "";

    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const curFrom = p.get("from") || "";
        const curTo = p.get("to") || "";
        // Only mutate if different
        if (nextFrom === curFrom && nextTo === curTo) return prev;
        nextFrom ? p.set("from", nextFrom) : p.delete("from");
        nextTo ? p.set("to", nextTo) : p.delete("to");
        skipNextParamsSync.current = true;
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  const {
    data: tournaments,
    isLoading,
    isFetching,
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
          : true,
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

  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "tournament_list",
      entityTitle: translate("tournaments.dashboard.title"),
      sectionTitle: statusMeta[tab]?.label || "",
      pageSummary: translate("tournaments.dashboard.subtitle"),
      activeLabels: [
        statusMeta[tab]?.label || "",
        debouncedKeyword ? `Tìm: ${debouncedKeyword}` : "",
        dateRange[0]?.isValid()
          ? `Từ: ${dateRange[0].format("DD/MM/YYYY")}`
          : "",
        dateRange[1]?.isValid()
          ? `Đến: ${dateRange[1].format("DD/MM/YYYY")}`
          : "",
      ],
      visibleActions: [
        translate("tournaments.dashboard.searchPlaceholder"),
        translate("tournaments.actions.schedule"),
        translate("tournaments.actions.bracket"),
      ],
      highlights: filtered.slice(0, 4).map((tournament) => tournament?.name || ""),
      metrics: [
        `Đang hiển thị: ${filtered.length}`,
        `Tổng giải: ${counts.total}`,
        `Sắp diễn ra: ${counts.upcoming}`,
        `Đang diễn ra: ${counts.ongoing}`,
        `Đã kết thúc: ${counts.finished}`,
      ],
      stats: {
        total: counts.total,
        upcoming: counts.upcoming,
        ongoing: counts.ongoing,
        finished: counts.finished,
        visible: filtered.length,
        currentTab: tab,
        keyword: debouncedKeyword,
      },
      visibleTournaments: filtered.slice(0, 4).map((tournament) => ({
        id: tournament?._id || "",
        name: tournament?.name || "",
        status: tournament?.status || "",
        location: tournament?.location || "",
        startDate: tournament?.startDate || "",
        endDate: tournament?.endDate || "",
      })),
    }),
    [counts, dateRange, debouncedKeyword, filtered, statusMeta, tab, translate],
  );

  const chatBotActionHandlers = useMemo(
    () => ({
      tab: (nextValue) => {
        const nextTab = TABS.includes(String(nextValue || ""))
          ? String(nextValue)
          : "upcoming";
        setTab(nextTab);
        setParams(
          (prev) => {
            const nextParams = new URLSearchParams(prev);
            nextParams.set("status", nextTab);
            return nextParams;
          },
          { replace: true },
        );
      },
      search: (nextValue) => {
        setKeyword(String(nextValue || ""));
      },
    }),
    [setParams],
  );

  const chatBotCapabilityKeys = useMemo(
    () => [
      "set_page_state",
      "prefill_text",
      "focus_element",
      "copy_link",
      "open_new_tab",
      "navigate",
    ],
    [],
  );

  useRegisterChatBotPageContext({
    snapshot: chatBotSnapshot,
    capabilityKeys: chatBotCapabilityKeys,
    actionHandlers: chatBotActionHandlers,
  });

  const handleChangeTab = (_, v) => {
    setTab(v);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("status", v);
        return p;
      },
      { replace: true },
    );
  };

  const formatDate = (d) =>
    d
      ? formatLocaleDate(d, locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : "--";

  const emptyStateDescription = useMemo(() => {
    const statusLabel = String(statusMeta[tab]?.label || "").toLowerCase();
    const hasDateFilter = Boolean(dateRange[0] || dateRange[1]);

    if (debouncedKeyword) {
      return translate("tournaments.dashboard.emptySearchDescription", {
        status: statusLabel,
      });
    }

    if (hasDateFilter) {
      return translate("tournaments.dashboard.emptyDateDescription", {
        status: statusLabel,
      });
    }

    return translate("tournaments.dashboard.emptyDefaultDescription", {
      status: statusLabel,
    });
  }, [dateRange, debouncedKeyword, tab, statusMeta, translate]);

  // --- COMPONENT: Action Buttons ---
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
              {translate("tournaments.actions.register")}
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
              {translate("tournaments.actions.schedule")}
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
              {translate("tournaments.actions.bracket")}
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
              {translate("tournaments.actions.register")}
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
              {translate("tournaments.actions.bracket")}
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
              {translate("tournaments.actions.schedule")}
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
              {translate("tournaments.actions.bracket")}
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
        {translate("tournaments.actions.viewResults")}
      </Button>
    );
  };

  // --- COMPONENT: Tournament Card ---
  const TournamentCard = ({ t }) => {
    const percent = Math.min(
      100,
      Math.round((t.registered / t.maxPairs) * 100),
    );

    return (
      <HoverCardFrame>
        <GlassCard className="tournament-card">
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
                <div className="dot" /> {statusMeta[t.status].label}
              </StatusBadge>
            </Box>

            <Box sx={{ width: "100%", height: "100%" }}>
              <img
                src={t.image || DEFAULT_FALLBACK}
                alt={t.name}
                loading="lazy"
                decoding="async"
                className="zoom-image"
                onError={(e) => {
                  if (e.currentTarget.dataset.fallbackApplied === "1") return;
                  e.currentTarget.dataset.fallbackApplied = "1";
                  e.currentTarget.src = DEFAULT_FALLBACK;
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </Box>
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
                  {t.location ||
                    translate("tournaments.dashboard.locationFallback")}
                </Typography>
              </Stack>

              <Box>
                <Stack direction="row" justifyContent="space-between" mb={0.5}>
                  <Typography
                    variant="caption"
                    fontWeight={600}
                    color="text.secondary"
                  >
                    {translate("tournaments.dashboard.registeredTeams")}
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
                    borderRadius: 3,
                    height: 6,
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
      </HoverCardFrame>
    );
  };

  return (
    <>
      <SEOHead
        title={translate("tournaments.dashboard.seoTitle")}
        description={translate("tournaments.dashboard.seoDescription")}
        keywords={translate("tournaments.dashboard.seoKeywords")}
        path="/tournaments"
      />
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
              {translate("tournaments.dashboard.title")}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {translate("tournaments.dashboard.subtitle")}
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
                {translate("tournaments.dashboard.totalCount")}
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
                {translate("tournaments.dashboard.ongoingCount")}
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
                {translate("tournaments.dashboard.upcomingCount")}
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
                "&.Mui-selected": {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                },
              },
              "& .MuiTabs-indicator": { display: "none" },
            }}
          >
            {TABS.map((v) => (
              <Tab key={v} value={v} label={statusMeta[v].label} />
            ))}
          </Tabs>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              placeholder={translate("tournaments.dashboard.searchPlaceholder")}
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
                    placeholder: translate(
                      "tournaments.dashboard.datePlaceholder",
                    ),
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
        <Box sx={{ minHeight: 400, position: "relative" }}>
          {/* Subtle refetch indicator – keeps existing content visible */}
          {isFetching && !isLoading && (
            <LinearProgress
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 5,
                borderRadius: 2,
                height: 3,
              }}
            />
          )}

          {error && (
            <Box p={3} color="error.dark" borderRadius={3} textAlign="center">
              {translate("tournaments.dashboard.loadError", {
                message: error?.data?.message || error?.error || "",
              })}
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
            filtered.length === 0 ? (
              <LottieEmptyState
                title={translate("tournaments.dashboard.empty")}
                description={emptyStateDescription}
                minHeight={360}
              />
            ) : (
              <Grid container spacing={3}>
                {filtered.map((t) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={t._id}>
                    <TournamentCard t={t} />
                  </Grid>
                ))}
              </Grid>
            )
          )}
        </Box>
      </Container>
    </>
  );
}
