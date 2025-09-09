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
} from "@mui/material";
import PreviewIcon from "@mui/icons-material/Preview";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import EventNoteIcon from "@mui/icons-material/EventNote";
import CloseIcon from "@mui/icons-material/Close";
import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";
import { useSelector } from "react-redux";

const THUMB_SIZE = 96;

const STATUS_LABEL = {
  upcoming: "Sắp diễn ra",
  ongoing: "Đang diễn ra",
  finished: "Đã diễn ra",
};
const STATUS_COLOR = {
  upcoming: "info",
  ongoing: "success",
  finished: "default",
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

  useEffect(() => {
    const t = setTimeout(() => {
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
    }, 0);
    return () => clearTimeout(t);
  }, [keyword, setParams]);

  const [previewSrc, setPreviewSrc] = useState(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const {
    data: tournaments,
    isLoading,
    error,
  } = useGetTournamentsQuery({ sportType, groupId });

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

  const filtered = useMemo(() => {
    if (!tournaments) return [];
    return tournaments
      .filter((t) => t.status === tab)
      .filter((t) => (search ? t.name?.toLowerCase().includes(search) : true));
  }, [tournaments, tab, search]);

  // ========== Skeleton Renderers ==========
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

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Typography variant="h5" mb={3} fontWeight={600}>
        Dashboard Giải đấu
      </Typography>

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
            <Tabs
              value={tab}
              onChange={handleChangeTab}
              sx={{ mb: 2 }}
              variant="scrollable"
            >
              {TABS.map((v) => (
                <Tab
                  key={v}
                  value={v}
                  label={STATUS_LABEL[v]}
                  icon={<PreviewIcon fontSize="small" sx={{ ml: -0.5 }} />}
                  iconPosition="start"
                />
              ))}
            </Tabs>

            <TextField
              label="Tìm kiếm tên giải"
              size="small"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              sx={{ mb: 3, width: 320, maxWidth: "100%" }}
            />

            {isMobile ? (
              <Stack spacing={2}>
                {filtered.length === 0 && (
                  <Alert severity="info">Không có giải nào phù hợp.</Alert>
                )}

                {filtered.map((t) => (
                  <Card key={t._id} variant="outlined">
                    <CardContent>
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="flex-start"
                        mb={2}
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
                          <Typography
                            fontWeight={600}
                            sx={{
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                              lineHeight: 1.25,
                              mb: 0.5,
                            }}
                          >
                            {t.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Đăng ký đến {formatDate(t.registrationDeadline)}
                          </Typography>
                        </Box>
                        <Chip
                          label={STATUS_LABEL[t.status]}
                          color={STATUS_COLOR[t.status]}
                          size="small"
                          sx={{ mt: 0.5 }}
                        />
                      </Stack>

                      <Divider sx={{ mb: 1 }} />
                      <Typography variant="body2" mb={0.5}>
                        Thời gian: {formatDate(t.startDate)} –{" "}
                        {formatDate(t.endDate)}
                      </Typography>
                      <Typography variant="body2" mb={0.5}>
                        Địa điểm: {t.location || "-"}
                      </Typography>
                      <Typography variant="body2" mb={0.5}>
                        Đăng ký: {t.registered}/{t.maxPairs} – Trận:{" "}
                        {t.matchesCount}
                      </Typography>
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
                      {t.status === "ongoing" ? (
                        <Button
                          component={RouterLink}
                          to={`/tournament/${t._id}/schedule`}
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<EventNoteIcon />}
                        >
                          Lịch đấu
                        </Button>
                      ) : (
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
                      )}
                      {t.status === "ongoing" && canManage(t) && (
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
                      )}
                      <Button
                        component={RouterLink}
                        to={`/tournament/${t._id}/checkin`}
                        size="small"
                        variant="contained"
                        color="success"
                        startIcon={<CheckCircleIcon />}
                      >
                        Check-in
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
                              fontWeight: 600,
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
                            <TableCell sx={{ py: 1.5 }}>
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
                            <TableCell>{t.name}</TableCell>
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
                                label={STATUS_LABEL[t.status]}
                                color={STATUS_COLOR[t.status]}
                                size="small"
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Box
                                display="flex"
                                flexWrap="wrap"
                                justifyContent="center"
                                gap={1.5}
                              >
                                {t.status === "ongoing" ? (
                                  <Button
                                    component={RouterLink}
                                    to={`/tournament/${t._id}/schedule`}
                                    size="small"
                                    variant="contained"
                                    color="primary"
                                    startIcon={<EventNoteIcon />}
                                  >
                                    Lịch đấu
                                  </Button>
                                ) : (
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
                                )}
                                {t.status === "ongoing" && canManage(t) && (
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
                                )}

                                <Button
                                  component={RouterLink}
                                  to={`/tournament/${t._id}/checkin`}
                                  size="small"
                                  variant="contained"
                                  color="success"
                                  startIcon={<CheckCircleIcon />}
                                >
                                  Check-in
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
