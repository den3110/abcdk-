// src/pages/TournamentDashboard.jsx
import { useState, useEffect, useMemo, Fragment } from "react";
import { useSearchParams, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Tabs,
  Tab,
  Paper,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Avatar,
  Dialog,
  DialogContent,
  IconButton,
  Button,
  Alert,
  Chip,
  Card,
  CardContent,
  CardActions,
  Stack,
  useMediaQuery,
  useTheme,
  Divider,
  TextField,
  Skeleton,
  InputAdornment,
  Tooltip,
} from "@mui/material";
import PreviewIcon from "@mui/icons-material/Preview";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import EventNoteIcon from "@mui/icons-material/EventNote";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import PlaceIcon from "@mui/icons-material/Place";
import ScheduleIcon from "@mui/icons-material/Schedule";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import TodayIcon from "@mui/icons-material/Today";
import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";
import { useSelector } from "react-redux";

// ====== Date pickers (PRO) ======
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { DateRangePicker } from "@mui/x-date-pickers-pro/DateRangePicker";
// v6 (tuỳ dự án): có thể dùng SingleInputDateRangeField để gộp 1 input
// import { SingleInputDateRangeField } from "@mui/x-date-pickers-pro/SingleInputDateRangeField";

const THUMB_SIZE = 84;

const STATUS_META = {
  upcoming: {
    label: "Sắp diễn ra",
    color: "info",
    icon: <TodayIcon fontSize="small" />,
  },
  ongoing: {
    label: "Đang diễn ra",
    color: "success",
    icon: <ScheduleIcon fontSize="small" />,
  },
  finished: {
    label: "Đã diễn ra",
    color: "default",
    icon: <PreviewIcon fontSize="small" />,
  },
};
const TABS = ["upcoming", "ongoing", "finished"];

const columns = [
  { label: "Ảnh", minWidth: THUMB_SIZE },
  { label: "Tên giải" },
  { label: "Hạn đăng ký" },
  { label: "Đăng ký / Dự kiến", align: "center" },
  { label: "Thời gian" },
  { label: "Địa điểm" },
  { label: "Trạng thái", align: "center" },
  { label: "Hành động", align: "center" },
];

const MOBILE_SKELETON_CARDS = 6;
const DESKTOP_SKELETON_ROWS = 8;

export default function TournamentDashboard() {
  const FIELD_HEIGHT = 40;
  const me = useSelector((s) => s.auth?.userInfo || null);
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const isManagerOf = (t) => {
    if (!me?._id) return false;
    if (String(t?.createdBy) === String(me._id)) return true;
    if (Array.isArray(t?.managers)) {
      return t.managers.some((m) => String(m?.user ?? m) === String(me._id));
    }
    if (typeof t?.isManager !== "undefined") return !!t.isManager;
    return false;
  };
  const canManage = (t) => isAdmin || isManagerOf(t);

  const [params, setParams] = useSearchParams();
  const sportType = params.get("sportType") || 2;
  const groupId = params.get("groupId") || 0;

  const initialTab = TABS.includes(params.get("status"))
    ? params.get("status")
    : "upcoming";
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    const urlTab = params.get("status");
    if (urlTab && TABS.includes(urlTab) && urlTab !== tab) setTab(urlTab);
  }, [params, tab]);

  useEffect(() => {
    const urlTab = params.get("status");
    if (!urlTab || !TABS.includes(urlTab)) {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("status", initialTab);
          return p;
        },
        { replace: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [keyword, setKeyword] = useState(params.get("q") || "");
  const [search, setSearch] = useState(params.get("q")?.toLowerCase() || "");

  // ====== Date range state (from/to in URL) ======
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const [dateRange, setDateRange] = useState([
    fromParam ? dayjs(fromParam) : null,
    toParam ? dayjs(toParam) : null,
  ]);

  // gentle debounce for search
  useEffect(() => {
    const handle = setTimeout(() => {
      const val = keyword.trim().toLowerCase();
      setSearch(val);
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (val) p.set("q", val);
          else p.delete("q");
          return p;
        },
        { replace: true }
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [keyword, setParams]);

  // sync dateRange -> URL
  useEffect(() => {
    const [start, end] = dateRange;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (start?.isValid()) p.set("from", start.format("YYYY-MM-DD"));
        else p.delete("from");
        if (end?.isValid()) p.set("to", end.format("YYYY-MM-DD"));
        else p.delete("to");
        return p;
      },
      { replace: true }
    );
  }, [dateRange, setParams]);

  const clearRange = () => setDateRange([null, null]);

  const [previewSrc, setPreviewSrc] = useState(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const {
    data: tournaments,
    isLoading,
    error,
  } = useGetTournamentsQuery({ sportType, groupId });

  const counts = useMemo(() => {
    const c = { upcoming: 0, ongoing: 0, finished: 0 };
    (tournaments || []).forEach((t) => {
      if (c[t.status] !== undefined) c[t.status] += 1;
    });
    return c;
  }, [tournaments]);

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

  const formatDate = (d) =>
    d
      ? new Date(d).toLocaleDateString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
      : "-";

  // Overlap: tournament [startDate, endDate] intersects [from, to]
  const filtered = useMemo(() => {
    if (!tournaments) return [];
    const [from, to] = dateRange;
    return tournaments
      .filter((t) => t.status === tab)
      .filter((t) => (search ? t.name?.toLowerCase().includes(search) : true))
      .filter((t) => {
        if (!from && !to) return true;
        const tStart = dayjs(t.startDate);
        const tEnd = dayjs(t.endDate || t.startDate);
        if (from && tEnd.isBefore(from, "day")) return false;
        if (to && tStart.isAfter(to, "day")) return false;
        return true;
      });
  }, [tournaments, tab, search, dateRange]);

  // ========== Skeletons ==========
  const MobileSkeletonList = () => (
    <Stack spacing={2}>
      {Array.from({ length: MOBILE_SKELETON_CARDS }).map((_, i) => (
        <Card key={i} variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="flex-start" mb={2}>
              <Skeleton variant="rounded" width={72} height={72} />
              <Box flex={1} minWidth={0}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
              </Box>
              <Skeleton variant="rounded" width={100} height={24} />
            </Stack>
            <Divider sx={{ mb: 1 }} />
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width="50%" />
            <Skeleton variant="text" width="60%" />
          </CardContent>
          <CardActions
            sx={{
              p: 2,
              pt: 0,
              justifyContent: "center",
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            <Skeleton variant="rounded" width={96} height={32} />
            <Skeleton variant="rounded" width={96} height={32} />
            <Skeleton variant="rounded" width={96} height={32} />
            <Skeleton variant="rounded" width={96} height={32} />
          </CardActions>
        </Card>
      ))}
    </Stack>
  );

  const DesktopSkeletonTable = () => (
    <Paper elevation={2}>
      <TableContainer sx={{ maxHeight: 640 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.label}
                  align={col.align || "left"}
                  sx={{ minWidth: col.minWidth, fontWeight: 600 }}
                >
                  {col.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length: DESKTOP_SKELETON_ROWS }).map((_, i) => (
              <TableRow key={i}>
                <TableCell sx={{ py: 1.5 }}>
                  <Skeleton
                    variant="rounded"
                    width={THUMB_SIZE}
                    height={THUMB_SIZE}
                  />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width={220} />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width={120} />
                </TableCell>
                <TableCell align="center">
                  <Skeleton variant="text" width={80} sx={{ mx: "auto" }} />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width={180} />
                </TableCell>
                <TableCell>
                  <Skeleton variant="text" width={160} />
                </TableCell>
                <TableCell align="center">
                  <Skeleton
                    variant="rounded"
                    width={100}
                    height={24}
                    sx={{ mx: "auto" }}
                  />
                </TableCell>
                <TableCell align="center">
                  <Stack direction="row" spacing={1} justifyContent="center">
                    <Skeleton variant="rounded" width={92} height={30} />
                    <Skeleton variant="rounded" width={92} height={30} />
                    <Skeleton variant="rounded" width={92} height={30} />
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );

  // ========== Action Buttons Helper ==========
  const Actions = ({ t, dense = false }) => {
    const size = dense ? "small" : "medium";
    const gap = 1.2;

    if (t.status === "upcoming") {
      return (
        <Box display="flex" flexWrap="wrap" justifyContent="center" gap={gap}>
          <Button
            component={RouterLink}
            to={`/tournament/${t._id}/register`}
            size="small"
            variant="contained"
            color="primary"
            startIcon={<HowToRegIcon />}
          >
            Đăng ký
          </Button>
          <Button
            component={RouterLink}
            to={`/tournament/${t._id}/bracket`}
            size="small"
            variant="outlined"
            color="info"
            startIcon={<AccountTreeIcon />}
          >
            Sơ đồ
          </Button>
        </Box>
      );
    }

    if (t.status === "ongoing") {
      return (
        <Box display="flex" flexWrap="wrap" justifyContent="center" gap={gap}>
          <Button
            component={RouterLink}
            to={`/tournament/${t._id}/schedule`}
            size={size}
            variant="contained"
            color="primary"
            startIcon={<EventNoteIcon />}
          >
            Lịch đấu
          </Button>
          {canManage(t) && (
            <Tooltip title="Chỉ quản lý có thể thêm đăng ký trong lúc giải đang diễn ra">
              <span>
                <Button
                  component={RouterLink}
                  to={`/tournament/${t._id}/register`}
                  size={size}
                  variant="contained"
                  color="primary"
                  startIcon={<HowToRegIcon />}
                >
                  Đăng ký
                </Button>
              </span>
            </Tooltip>
          )}
          <Button
            component={RouterLink}
            to={`/tournament/${t._id}/checkin`}
            size={size}
            variant="contained"
            color="success"
            startIcon={<CheckCircleIcon />}
          >
            Check-in
          </Button>
          <Button
            component={RouterLink}
            to={`/tournament/${t._id}/bracket`}
            size={size}
            variant="outlined"
            color="info"
            startIcon={<AccountTreeIcon />}
          >
            Sơ đồ
          </Button>
        </Box>
      );
    }

    return (
      <Box display="flex" flexWrap="wrap" justifyContent="center" gap={gap}>
        <Button
          component={RouterLink}
          to={`/tournament/${t._id}/bracket`}
          size={size}
          variant="outlined"
          color="info"
          startIcon={<AccountTreeIcon />}
        >
          Sơ đồ
        </Button>
      </Box>
    );
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Header / Hero */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 2.5,
          borderRadius: 3,
          bgcolor: (th) =>
            th.palette.mode === "light" ? "#f8fafc" : "#0b1220",
          backgroundImage: (th) =>
            th.palette.mode === "light"
              ? "radial-gradient(circle at 20% 20%, rgba(2,132,199,0.06), transparent 40%), radial-gradient(circle at 80% 0%, rgba(34,197,94,0.06), transparent 40%)"
              : "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.09), transparent 40%), radial-gradient(circle at 80% 0%, rgba(34,197,94,0.07), transparent 40%)",
          border: (th) => `1px solid ${th.palette.divider}`,
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              Giải đấu
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {tournaments
                ? `${tournaments.length} giải • ${STATUS_META[tab].label}`
                : ""}
            </Typography>
          </Box>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems={{ xs: "stretch", sm: "center" }}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            <TextField
              placeholder="Tìm kiếm tên giải..."
              size="small"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              sx={{ width: { xs: "100%", sm: 280 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: keyword ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setKeyword("")}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />

            {/* Date range (PRO) */}
            <Box sx={{ minWidth: { xs: "100%", sm: 320 }, flexShrink: 0 }}>
              <DateRangePicker
                calendars={2}
                value={dateRange}
                onChange={(newValue) => setDateRange(newValue)}
                slotProps={{
                  textField: {
                    size: "small",
                    sx: {
                        width: "100%",
                      "& .MuiOutlinedInput-root": { height: FIELD_HEIGHT },
                      "& .MuiOutlinedInput-input": {
                        py: 0,
                        my: 0,
                        lineHeight: "40px",
                      },
                    },
                  },
                }}
                renderInput={(startProps, endProps) => (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ width: { xs: "100%", sm: 320 } }}
                  >
                    <TextField
                      {...startProps}
                      size="small"
                      fullWidth
                      placeholder="Từ ngày"
                      sx={{
                        "& .MuiOutlinedInput-root": { height: FIELD_HEIGHT },
                        // optional: tinh chỉnh chữ nằm giữa tuyệt đối
                        "& .MuiOutlinedInput-input": {
                          py: 0,
                          my: 0,
                          lineHeight: "40px",
                        },
                      }}
                    />
                    <Box sx={{ color: "text.secondary", px: 0.5 }}>—</Box>
                    <TextField
                      {...endProps}
                      size="small"
                      fullWidth
                      placeholder="Đến ngày"
                      sx={{
                        "& .MuiOutlinedInput-root": { height: FIELD_HEIGHT },
                        "& .MuiOutlinedInput-input": {
                          py: 0,
                          my: 0,
                          lineHeight: "40px",
                        },
                      }}
                    />
                  </Stack>
                )}
              />
              {/* v6 (tuỳ dự án): gộp 1 input, dùng slots */}
              {/*
                <DateRangePicker
                  value={dateRange}
                  onChange={(v) => setDateRange(v)}
                  calendars={2}
                  slots={{ field: SingleInputDateRangeField }}
                  slotProps={{ field: { size: "small", fullWidth: true, placeholder: "Khoảng ngày (Từ — Đến)" } }}
                />
                */}
            </Box>

            {(dateRange?.[0] || dateRange?.[1]) && (
              <Button
                onClick={clearRange}
                size="small"
                variant="text"
                startIcon={<ClearIcon />}
                sx={{ fontWeight: 600, textTransform: "none" }}
              >
                Xoá lọc
              </Button>
            )}
          </Stack>
        </Stack>

        {/* Tabs with counts */}
        <Tabs
          value={tab}
          onChange={handleChangeTab}
          sx={{ mt: 1 }}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {TABS.map((v) => (
            <Tab
              key={v}
              value={v}
              icon={STATUS_META[v].icon}
              iconPosition="start"
              label={
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{STATUS_META[v].label}</span>
                  <Chip
                    size="small"
                    label={counts[v] || 0}
                    color={STATUS_META[v].color}
                    variant="outlined"
                  />
                </Stack>
              }
              sx={{
                textTransform: "none",
                fontWeight: 600,
                "& .MuiTab-iconWrapper": { mr: 1 },
              }}
            />
          ))}
        </Tabs>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.data?.message || error?.error}
        </Alert>
      )}

      {isLoading ? (
        isMobile ? (
          <MobileSkeletonList />
        ) : (
          <DesktopSkeletonTable />
        )
      ) : (
        tournaments && (
          <Fragment>
            {isMobile ? (
              <Stack spacing={2}>
                {filtered.length === 0 && (
                  <Alert severity="info">Không có giải nào phù hợp.</Alert>
                )}

                {filtered.map((t) => (
                  <Card
                    key={t._id}
                    variant="outlined"
                    sx={{ overflow: "hidden" }}
                  >
                    <CardContent>
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="flex-start"
                        mb={1.5}
                      >
                        <Avatar
                          src={t.image}
                          alt={t.name}
                          variant="rounded"
                          sx={{
                            width: 72,
                            height: 72,
                            cursor: "zoom-in",
                            flexShrink: 0,
                          }}
                          onClick={() => setPreviewSrc(t.image)}
                        />
                        <Box flex={1} minWidth={0}>
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={1}
                            justifyContent="space-between"
                          >
                            <Typography
                              fontWeight={700}
                              sx={{
                                wordBreak: "break-word",
                                lineHeight: 1.25,
                              }}
                            >
                              {t.name}
                            </Typography>
                            <Chip
                              label={STATUS_META[t.status].label}
                              color={STATUS_META[t.status].color}
                              size="small"
                            />
                          </Stack>
                          <Stack
                            direction="row"
                            spacing={1.5}
                            mt={1}
                            flexWrap="wrap"
                          >
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              display="flex"
                              alignItems="center"
                              gap={0.5}
                            >
                              <TodayIcon fontSize="inherit" />{" "}
                              {formatDate(t.registrationDeadline)}
                            </Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              display="flex"
                              alignItems="center"
                              gap={0.5}
                            >
                              <ScheduleIcon fontSize="inherit" />{" "}
                              {formatDate(t.startDate)} –{" "}
                              {formatDate(t.endDate)}
                            </Typography>
                          </Stack>
                        </Box>
                      </Stack>

                      <Stack
                        direction="row"
                        spacing={2}
                        flexWrap="wrap"
                        color="text.secondary"
                        sx={{ "& svg": { opacity: 0.9 } }}
                      >
                        <Typography
                          variant="body2"
                          display="flex"
                          alignItems="center"
                          gap={0.75}
                        >
                          <PeopleOutlineIcon fontSize="small" /> {t.registered}/
                          {t.maxPairs}
                        </Typography>
                        <Typography
                          variant="body2"
                          display="flex"
                          alignItems="center"
                          gap={0.75}
                        >
                          <PlaceIcon fontSize="small" /> {t.location || "-"}
                        </Typography>
                      </Stack>
                    </CardContent>

                    <CardActions
                      sx={{
                        p: 2,
                        pt: 0,
                        justifyContent: "center",
                        flexWrap: "wrap",
                        gap: 1,
                      }}
                    >
                      <Actions t={t} dense />
                    </CardActions>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Paper elevation={2}>
                <TableContainer sx={{ maxHeight: 640 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        {columns.map((col) => (
                          <TableCell
                            key={col.label}
                            align={col.align || "left"}
                            sx={{
                              minWidth: col.minWidth,
                              fontWeight: 700,
                              backgroundColor: "background.default",
                            }}
                          >
                            {col.label}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={columns.length}>
                            <Alert severity="info" sx={{ my: 2 }}>
                              Không có giải nào phù hợp.
                            </Alert>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((t) => (
                          <TableRow hover key={t._id}>
                            <TableCell sx={{ py: 1.2 }}>
                              <Box
                                component="img"
                                src={t.image}
                                alt={t.name}
                                sx={{
                                  width: THUMB_SIZE,
                                  height: THUMB_SIZE,
                                  objectFit: "cover",
                                  borderRadius: 1,
                                  cursor: "zoom-in",
                                  transition: "transform 0.2s",
                                  "&:hover": { transform: "scale(1.06)" },
                                }}
                                onClick={() => setPreviewSrc(t.image)}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography fontWeight={600}>{t.name}</Typography>
                            </TableCell>
                            <TableCell>
                              {formatDate(t.registrationDeadline)}
                            </TableCell>
                            <TableCell align="center">
                              {t.registered}/{t.maxPairs}
                            </TableCell>
                            <TableCell>
                              {formatDate(t.startDate)} –{" "}
                              {formatDate(t.endDate)}
                            </TableCell>
                            <TableCell>{t.location || "-"}</TableCell>
                            <TableCell align="center">
                              <Chip
                                label={STATUS_META[t.status].label}
                                color={STATUS_META[t.status].color}
                                size="small"
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Actions t={t} />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
          </Fragment>
        )
      )}

      <Dialog
        open={Boolean(previewSrc)}
        onClose={() => setPreviewSrc(null)}
        maxWidth="md"
        fullWidth
      >
        <IconButton
          aria-label="close"
          onClick={() => setPreviewSrc(null)}
          sx={{
            position: "absolute",
            right: 8,
            top: 8,
            bgcolor: "rgba(0,0,0,0.65)",
            color: "#fff",
            boxShadow: 3,
            "&:hover": { bgcolor: "rgba(0,0,0,0.8)" },
          }}
        >
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ p: 0 }}>
          <Box
            component="img"
            src={previewSrc || ""}
            alt="Preview"
            sx={{ width: "100%", height: "auto" }}
          />
        </DialogContent>
      </Dialog>
    </Container>
  );
}
