// src/pages/TournamentDashboard.jsx – thêm tìm kiếm + giữ responsive
import { useState, useEffect, Fragment } from "react";
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
  TextField, // ⬅️ NEW
} from "@mui/material";
import PreviewIcon from "@mui/icons-material/Preview";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CloseIcon from "@mui/icons-material/Close";
import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";

const THUMB_SIZE = 78;
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
const columns = [
  { label: "Ảnh", minWidth: THUMB_SIZE },
  { label: "Tên giải" },
  { label: "Hạn đăng ký" },
  { label: "Đăng ký / Dự kiến", align: "center" },
  { label: "Số trận", align: "center" },
  { label: "Thời gian" },
  { label: "Địa điểm" },
  { label: "Trạng thái", align: "center" },
  { label: "Hành động", align: "center" },
];

export default function TournamentDashboard() {
  const [params] = useSearchParams();
  const sportType = params.get("sportType") || 2;
  const groupId = params.get("groupId") || 0;

  const [tab, setTab] = useState("upcoming");
  const [previewSrc, setPreviewSrc] = useState(null);

  /* 🔍 state tìm kiếm */
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState(""); // keyword sau debounce

  /* debounce 300 ms */
  useEffect(() => {
    const t = setTimeout(() => setSearch(keyword.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const {
    data: tournaments,
    isLoading,
    error,
  } = useGetTournamentsQuery({ sportType, groupId });

  const handleChangeTab = (_, v) => setTab(v);

  const formatDate = (d) =>
    new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  /* 1️⃣ lọc theo trạng thái, 2️⃣ lọc theo keyword */
  const filtered =
    tournaments
      ?.filter((t) => t.status === tab)
      .filter((t) => t.name.toLowerCase().includes(search)) || [];

  return (
    <Container sx={{ py: 4 }}>
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
            onChange={(_, v) => setTab(v)}
            sx={{ mb: 2 }}
            variant="scrollable"
          >
            {["upcoming", "ongoing", "finished"].map((v) => (
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
            sx={{ mb: 3, width: 320 }}
          />
          {/* ===== LIST ===== */}
          {isMobile ? (
            /* ----- CARD (MOBILE) ----- */
            <Stack spacing={2}>
              {filtered.map((t) => (
                <Card key={t._id} variant="outlined">
                  <CardContent>
                    <Stack
                      direction="row"
                      spacing={2}
                      alignItems="center"
                      mb={2}
                    >
                      <Avatar
                        src={t.image}
                        alt={t.name}
                        variant="rounded"
                        sx={{ width: 72, height: 72, cursor: "zoom-in" }}
                        onClick={() => setPreviewSrc(t.image)}
                      />
                      <Box>
                        <Typography fontWeight={600}>{t.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Đăng ký đến {formatDate(t.registrationDeadline)}
                        </Typography>
                      </Box>
                      <Chip
                        label={STATUS_LABEL[t.status]}
                        color={STATUS_COLOR[t.status]}
                        size="small"
                      />
                    </Stack>

                    <Divider sx={{ mb: 1 }} />
                    <Typography variant="body2" mb={0.5}>
                      Thời gian: {formatDate(t.startDate)} –{" "}
                      {formatDate(t.endDate)}
                    </Typography>
                    <Typography variant="body2" mb={0.5}>
                      Địa điểm: {t.location}
                    </Typography>
                    <Typography variant="body2" mb={0.5}>
                      Đăng ký: {t.registered}/{t.expected} – Trận:{" "}
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
                    {filtered.map((t) => (
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
                              "&:hover": { transform: "scale(1.1)" },
                            }}
                            onClick={() => setPreviewSrc(t.image)}
                          />
                        </TableCell>
                        <TableCell>{t.name}</TableCell>
                        <TableCell>
                          {formatDate(t.registrationDeadline)}
                        </TableCell>
                        <TableCell align="center">
                          {t.registered}/{t.expected}
                        </TableCell>
                        <TableCell align="center">{t.matchesCount}</TableCell>
                        <TableCell>
                          {formatDate(t.startDate)} – {formatDate(t.endDate)}
                        </TableCell>
                        <TableCell>{t.location}</TableCell>
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
                    ))}
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
            src={previewSrc}
            alt="Preview"
            sx={{ width: "100%", height: "auto" }}
          />
        </DialogContent>
      </Dialog>
    </Container>
  );
}
