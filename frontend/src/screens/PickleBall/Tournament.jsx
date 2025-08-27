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
  CircularProgress,
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
} from "@mui/material";
import PreviewIcon from "@mui/icons-material/Preview";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CloseIcon from "@mui/icons-material/Close";
import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";

const THUMB_SIZE = 96; // desktop: ảnh to hơn một chút

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

export default function TournamentDashboard() {
  const [params, setParams] = useSearchParams();

  // Giữ nguyên param sportType & groupId từ URL
  const sportType = params.get("sportType") || 2;
  const groupId = params.get("groupId") || 0;

  // ===== URL <-> state: status (tab) =====
  const initialTab = TABS.includes(params.get("status"))
    ? params.get("status")
    : "upcoming";
  const [tab, setTab] = useState(initialTab);

  // Đồng bộ tab khi back/forward
  useEffect(() => {
    const urlTab = params.get("status");
    if (urlTab && TABS.includes(urlTab) && urlTab !== tab) {
      setTab(urlTab);
    }
  }, [params, tab]);

  // Đảm bảo luôn có status hợp lệ trên URL
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

  // ===== URL <-> state: q (keyword) =====
  const [keyword, setKeyword] = useState(params.get("q") || "");
  const [search, setSearch] = useState(params.get("q")?.toLowerCase() || "");

  // Debounce & push lên URL
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
    }, 300);
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

  // 1) Lọc theo tab trạng thái, 2) Lọc theo keyword
  const filtered = useMemo(() => {
    if (!tournaments) return [];
    return tournaments
      .filter((t) => t.status === tab)
      .filter((t) => (search ? t.name?.toLowerCase().includes(search) : true));
  }, [tournaments, tab, search]);

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Typography variant="h5" mb={3} fontWeight={600}>
        Dashboard Giải đấu
      </Typography>

      {isLoading && (
        <Box textAlign="center" my={5}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.data?.message || error.error}
        </Alert>
      )}

      {tournaments && (
        <Fragment>
          {/* Tabs trạng thái */}
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

          {/* Ô tìm kiếm */}
          <TextField
            label="Tìm kiếm tên giải"
            size="small"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            sx={{ mb: 3, width: 320, maxWidth: "100%" }}
          />

          {/* ===== LIST ===== */}
          {isMobile ? (
            /* ----- CARD (MOBILE) ----- */
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
                      alignItems="flex-start" // căn top để tên dài nhiều dòng
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
                        {/* FULL tên giải: không ellipsis */}
                        <Typography
                          fontWeight={600}
                          sx={{
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            overflow: "visible",
                            textOverflow: "clip",
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
            /* ----- TABLE (DESKTOP) ----- */
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
                                width: THUMB_SIZE, // 96
                                height: THUMB_SIZE, // 96
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
                            {formatDate(t.startDate)} – {formatDate(t.endDate)}
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
      )}

      {/* Dialog preview ảnh */}
      <Dialog
        open={Boolean(previewSrc)}
        onClose={() => setPreviewSrc(null)}
        maxWidth="md"
      >
        <IconButton
          aria-label="close"
          onClick={() => setPreviewSrc(null)}
          sx={{ position: "absolute", right: 8, top: 8 }}
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
