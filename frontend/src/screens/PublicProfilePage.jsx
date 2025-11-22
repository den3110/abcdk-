import React, { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Box,
  Stack,
  Container,
  Grid,
  Avatar,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Tabs,
  Tab,
  Card,
  CardContent,
  Divider,
  Skeleton,
  Alert,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Pagination,
  Snackbar,
  Paper,
  useTheme,
  useMediaQuery,
  alpha,
  LinearProgress,
} from "@mui/material";

// Icons
import ShareIcon from "@mui/icons-material/Share";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import PlayCircleFilledWhiteIcon from "@mui/icons-material/PlayCircleFilledWhite";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import PlaceIcon from "@mui/icons-material/Place";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";

import {
  useGetPublicProfileQuery,
  useGetRatingHistoryQuery,
  useGetMatchHistoryQuery,
} from "../slices/usersApiSlice";
import { ZoomableWrapper } from "../components/Zoom";

/* ---------- CONSTANTS & UTILS ---------- */
const AVA_PLACE = "https://dummyimage.com/160x160/cccccc/ffffff&text=?";
const tz = { timeZone: "Asia/Bangkok" };

// Formatters
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("vi-VN", tz) : "—";
const fmtDT = (iso) =>
  iso
    ? new Date(iso).toLocaleString("vi-VN", {
        ...tz,
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })
    : "—";

// ✅ Giữ lại phần thập phân như bản cũ (mặc định 3 số sau dấu phẩy)
const num = (v, digits = 3) =>
  Number.isFinite(+v) ? Number(v).toFixed(digits) : "—";
const numFloat = (v, digits = 3) =>
  Number.isFinite(+v) ? Number(v).toFixed(digits) : "—";

const getGenderInfo = (g) => {
  const s = String(g).toLowerCase().trim();
  if (["1", "male", "m", "nam"].includes(s))
    return { label: "Nam", color: "info" };
  if (["2", "female", "f", "nu", "nữ"].includes(s))
    return { label: "Nữ", color: "error" };
  return { label: "Khác", color: "default" };
};

/* ---------- SUB-COMPONENTS (STYLED) ---------- */

// 1. Modern Copy Button
const CopyBtn = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <Tooltip title={copied ? "Đã sao chép!" : `Sao chép ${label || ""}`}>
      <IconButton
        size="small"
        onClick={handleCopy}
        sx={{ color: copied ? "success.main" : "text.secondary", p: 0.5 }}
      >
        {copied ? (
          <CheckIcon fontSize="inherit" />
        ) : (
          <ContentCopyIcon fontSize="inherit" />
        )}
      </IconButton>
    </Tooltip>
  );
};

// 2. Stat Box (Overview)
const StatBox = ({ icon, value, label, subValue, color = "primary" }) => {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        p: 2.5,
        mt: 8,
        height: "100%",
        borderRadius: 4,
        bgcolor: alpha(theme.palette[color].main, 0.04),
        borderColor: alpha(theme.palette[color].main, 0.1),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: -10,
          right: -10,
          opacity: 0.1,
          color: theme.palette[color].main,
        }}
      >
        {React.cloneElement(icon, { sx: { fontSize: 80 } })}
      </Box>
      <Stack spacing={0.5}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            color: theme.palette[color].main,
          }}
        >
          {React.cloneElement(icon, { fontSize: "small" })}
          <Typography
            variant="subtitle2"
            fontWeight={600}
            textTransform="uppercase"
          >
            {label}
          </Typography>
        </Box>
        <Typography variant="h3" fontWeight={800} color="text.primary">
          {value}
        </Typography>
        {subValue && (
          <Typography variant="body2" color="text.secondary" fontWeight={500}>
            {subValue}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
};

// 3. Match Result Badge
const MatchResultBadge = ({ isWinner }) => (
  <Chip
    label={isWinner ? "THẮNG" : "THUA"}
    size="small"
    color={isWinner ? "success" : "default"}
    sx={{
      fontWeight: 800,
      borderRadius: 1,
      height: 24,
      minWidth: 60,
      bgcolor: isWinner ? "success.main" : "action.hover",
      color: isWinner ? "#fff" : "text.secondary",
    }}
  />
);

// 4. Player Mini Cell (Clean) – ✅ trả lại số thập phân 3 chữ số
const PlayerRow = ({ p, highlight }) => {
  const up = (p?.delta ?? 0) > 0;
  const down = (p?.delta ?? 0) < 0;
  const name =
    p?.user?.nickname ||
    p?.user?.fullName ||
    p?.nickname ||
    p?.fullName ||
    "N/A";

  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ py: 0.5, justifyContent: "center" }} // căn giữa nội dung trong item
    >
      <Avatar src={p?.avatar || AVA_PLACE} sx={{ width: 28, height: 28 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          fontWeight={highlight ? 700 : 400}
          noWrap
          textAlign="center"
        >
          {name}
        </Typography>
        {p?.postScore !== undefined && (
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            justifyContent="center"
          >
            <Typography variant="caption" color="text.secondary">
              {num(p.preScore)} ➜ <b>{num(p.postScore)}</b>
            </Typography>
            {Number.isFinite(+p.delta) && p.delta !== 0 && (
              <Typography
                variant="caption"
                color={up ? "success.main" : "error.main"}
                fontWeight="bold"
              >
                {up ? "+" : ""}
                {numFloat(p.delta)}
              </Typography>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};

/* ---------- MAIN COMPONENT ---------- */
export default function PublicProfilePage() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [tab, setTab] = useState(0);

  // Logic queries
  const baseQ = useGetPublicProfileQuery(id);
  const rateQ = useGetRatingHistoryQuery(id);
  const matchQ = useGetMatchHistoryQuery(id);

  const base = baseQ.data || {};
  const ratingRaw = Array.isArray(rateQ.data?.history)
    ? rateQ.data.history
    : rateQ.data?.items || [];
  const matchRaw = Array.isArray(matchQ.data)
    ? matchQ.data
    : matchQ.data?.items || [];

  // Derived stats
  const uid = base?._id || id;
  const { totalMatches, wins, winRate } = useMemo(() => {
    let total = 0,
      w = 0;
    for (const m of matchRaw) {
      const inA = (m?.team1 || []).some((p) => (p?._id || p?.id) === uid);
      const inB = (m?.team2 || []).some((p) => (p?._id || p?.id) === uid);
      if (!inA && !inB) continue;
      total++;
      if ((inA && m?.winner === "A") || (inB && m?.winner === "B")) w++;
    }
    const rate = total ? Math.round((w / total) * 100) : 0;
    return { totalMatches: total, wins: w, winRate: rate };
  }, [matchRaw, uid]);

  // Pagination state
  const [pageMatch, setPageMatch] = useState(1);
  const matchPerPage = 8;
  const matchPaged = matchRaw.slice(
    (pageMatch - 1) * matchPerPage,
    pageMatch * matchPerPage
  );

  const [pageRate, setPageRate] = useState(1);
  const ratePerPage = 10;
  const ratePaged = ratingRaw.slice(
    (pageRate - 1) * ratePerPage,
    pageRate * ratePerPage
  );

  // Handle Share
  const handleShare = async () => {
    try {
      await navigator.share({ title: base?.name, url: window.location.href });
    } catch {
      navigator.clipboard.writeText(window.location.href);
      alert("Đã sao chép liên kết!");
    }
  };

  // --- SECTIONS ---

  const HeaderSection = (
    <Box sx={{ position: "relative", mb: { xs: 12, md: 8 } }}>
      {/* Banner Background */}
      <Box
        sx={{
          height: { xs: 180, md: 280 },
          borderRadius: { xs: 0, md: 4 },
          background: `linear-gradient(120deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
          position: "relative",
          overflow: "hidden",
          boxShadow: theme.shadows[4],
        }}
      >
        {/* Decorative circles */}
        <Box
          sx={{
            position: "absolute",
            top: -50,
            right: -50,
            width: 200,
            height: 200,
            borderRadius: "50%",
            bgcolor: "white",
            opacity: 0.05,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            bottom: -20,
            left: 100,
            width: 100,
            height: 100,
            borderRadius: "50%",
            bgcolor: "white",
            opacity: 0.05,
          }}
        />
      </Box>

      {/* Profile Card (Floating) */}
      <Container
        maxWidth="lg"
        sx={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translate(-50%, 50%)",
          width: "100%",
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: { xs: 2, md: 3 },
            borderRadius: 4,
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: "center",
            gap: 3,
            backdropFilter: "blur(20px)",
            bgcolor: alpha(theme.palette.background.paper, 0.9),
          }}
        >
          {/* Avatar with ring */}
          <Box sx={{ position: "relative", mt: { xs: -6, sm: 0 } }}>
            <ZoomableWrapper src={base?.avatar || AVA_PLACE}>
              <Avatar
                src={base?.avatar || AVA_PLACE}
                sx={{
                  width: { xs: 100, sm: 140 },
                  height: { xs: 100, sm: 140 },
                  border: `4px solid ${theme.palette.background.paper}`,
                  boxShadow: theme.shadows[3],
                }}
              />
            </ZoomableWrapper>
            {base?.isAdmin && (
              <Tooltip title="Quản trị viên">
                <VerifiedUserIcon
                  color="primary"
                  sx={{
                    position: "absolute",
                    bottom: 5,
                    right: 5,
                    bgcolor: "background.paper",
                    borderRadius: "50%",
                  }}
                />
              </Tooltip>
            )}
          </Box>

          {/* User Info */}
          <Box
            sx={{
              flex: 1,
              textAlign: { xs: "center", sm: "left" },
              minWidth: 0,
            }}
          >
            <Typography variant="h4" fontWeight={800} sx={{ mb: 0.5 }}>
              {base?.name || "Người dùng"}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              justifyContent={{ xs: "center", sm: "flex-start" }}
              alignItems="center"
              sx={{ mb: 2, color: "text.secondary" }}
            >
              <Typography variant="body1" fontWeight={500}>
                @{base?.nickname || "no_nick"}
              </Typography>
              <CopyBtn value={base?.nickname} label="Nickname" />
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              justifyContent={{ xs: "center", sm: "flex-start" }}
              gap={1}
            >
              {base?.province && (
                <Chip
                  icon={<PlaceIcon fontSize="small" />}
                  label={base.province}
                  size="small"
                  variant="outlined"
                />
              )}
              <Chip
                icon={<CalendarMonthIcon fontSize="small" />}
                label={`Gia nhập: ${fmtDate(base.joinedAt)}`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={getGenderInfo(base?.gender).label}
                color={getGenderInfo(base?.gender).color}
                size="small"
                variant="soft"
              />
            </Stack>
          </Box>

          {/* Action Button */}
          <Box>
            <Button
              variant="contained"
              startIcon={<ShareIcon />}
              onClick={handleShare}
              sx={{ borderRadius: 20, px: 3, textTransform: "none" }}
            >
              Chia sẻ
            </Button>
          </Box>
        </Paper>
      </Container>
    </Box>
  );

  // ✅ Grid dùng size (v7)
  const StatsSection = (
    <Grid container spacing={2} sx={{ mb: 4, mt: { xs: 6, md: 0 } }}>
      <Grid size={{ xs: 12, sm: 4 }}>
        <StatBox
          icon={<SportsTennisIcon />}
          label="Tổng trận đấu"
          value={totalMatches}
          subValue="Trận đã tham gia"
          color="primary"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <StatBox
          icon={<EmojiEventsIcon />}
          label="Chiến thắng"
          value={wins}
          subValue={`${winRate}% Tỷ lệ thắng`}
          color="warning"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <StatBox
          icon={<TrendingUpIcon />}
          label="Điểm trình (Đơn/Đôi)"
          value={`${num(base?.levelPoint?.single || 0)} / ${num(
            base?.levelPoint?.double || 0
          )}`}
          subValue="Điểm hiện tại"
          color="success"
        />
      </Grid>
    </Grid>
  );

  const MatchHistoryTab = (
    <Stack spacing={2}>
      {matchPaged.length === 0 ? (
        <Alert severity="info" sx={{ borderRadius: 3 }}>
          Chưa có dữ liệu trận đấu nào.
        </Alert>
      ) : (
        matchPaged.map((m) => {
          const winnerA = m.winner === "A";
          const winnerB = m.winner === "B";
          const myInA = m.team1?.some((p) => (p._id || p.id) === uid);
          const myInB = m.team2?.some((p) => (p._id || p.id) === uid);
          const isMyWin = (myInA && winnerA) || (myInB && winnerB);

          return (
            <Card
              key={m._id}
              variant="outlined"
              sx={{
                borderRadius: 3,
                overflow: "visible",
                transition: "transform 0.2s",
                "&:hover": { borderColor: "primary.main" },
              }}
            >
              <CardContent sx={{ p: 2 }}>
                {/* Header: Time & Tournament */}
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  mb={2}
                >
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <MatchResultBadge isWinner={isMyWin} />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: { xs: "none", sm: "block" } }}
                    >
                      • {fmtDT(m.dateTime)}
                    </Typography>
                  </Stack>
                  <Chip
                    label={m.tournament?.name || "Giao hữu"}
                    size="small"
                    variant="outlined"
                    sx={{ maxWidth: 200 }}
                  />
                </Stack>

                {/* Teams & Score – ✅ căn giữa nội dung trong item */}
                <Grid
                  container
                  alignItems="center"
                  justifyContent="center"
                  spacing={2}
                >
                  {/* Team 1 */}
                  <Grid
                    size={{ xs: 12, sm: 4, md: 4 }}
                    sx={{ display: "flex", justifyContent: "center" }}
                  >
                    <Box sx={{ width: "100%" }}>
                      {m.team1?.map((p, i) => (
                        <PlayerRow key={i} p={p} highlight={winnerA} />
                      ))}
                    </Box>
                  </Grid>

                  {/* Score Center */}
                  <Grid
                    size={{ xs: 12, sm: 4, md: 4 }}
                    sx={{
                      textAlign: "center",
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
                    <Typography
                      variant="h5"
                      fontWeight={900}
                      sx={{ letterSpacing: 2 }}
                    >
                      {m.scoreText || "VS"}
                    </Typography>
                  </Grid>

                  {/* Team 2 */}
                  <Grid
                    size={{ xs: 12, sm: 4, md: 4 }}
                    sx={{ display: "flex", justifyContent: "center" }}
                  >
                    <Box sx={{ width: "100%" }}>
                      {m.team2?.map((p, i) => (
                        <PlayerRow key={i} p={p} highlight={winnerB} />
                      ))}
                    </Box>
                  </Grid>
                </Grid>

                {/* Footer: Video */}
                {m.video && (
                  <Box
                    sx={{
                      mt: 2,
                      pt: 2,
                      borderTop: "1px dashed #eee",
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <Button
                      size="small"
                      startIcon={<PlayCircleFilledWhiteIcon />}
                      href={m.video}
                      target="_blank"
                      color="error"
                      sx={{ borderRadius: 10 }}
                    >
                      Xem Video Replay
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      {matchRaw.length > matchPerPage && (
        <Stack alignItems="center">
          <Pagination
            count={Math.ceil(matchRaw.length / matchPerPage)}
            page={pageMatch}
            onChange={(_, p) => setPageMatch(p)}
            color="primary"
            shape="rounded"
          />
        </Stack>
      )}
    </Stack>
  );

  const RatingHistoryTab = (
    <Stack spacing={2}>
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ borderRadius: 3, overflow: "hidden" }}
      >
        <Table size={isMobile ? "small" : "medium"}>
          <TableHead sx={{ bgcolor: "action.hover" }}>
            <TableRow>
              <TableCell>Thời gian</TableCell>
              <TableCell>Người chấm</TableCell>
              <TableCell align="center">Điểm Đơn</TableCell>
              <TableCell align="center">Điểm Đôi</TableCell>
              {!isMobile && <TableCell>Ghi chú</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {ratePaged.length > 0 ? (
              ratePaged.map((row) => (
                <TableRow key={row._id || row.id} hover>
                  <TableCell sx={{ fontWeight: 500 }}>
                    {fmtDate(row.scoredAt)}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {row.scorer?.name || "Hệ thống"}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={num(row.single)}
                      size="small"
                      variant="outlined"
                      color="primary"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={num(row.double)}
                      size="small"
                      variant="outlined"
                      color="secondary"
                    />
                  </TableCell>
                  {!isMobile && (
                    <TableCell
                      sx={{ color: "text.secondary", maxWidth: 200 }}
                      noWrap
                      title={row.note}
                    >
                      {row.note || "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  Không có lịch sử
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {ratingRaw.length > ratePerPage && (
        <Stack alignItems="center">
          <Pagination
            count={Math.ceil(ratingRaw.length / ratePerPage)}
            page={pageRate}
            onChange={(_, p) => setPageRate(p)}
            color="primary"
            shape="rounded"
          />
        </Stack>
      )}
    </Stack>
  );

  if (baseQ.isLoading)
    return (
      <Container sx={{ pt: 4 }}>
        <Skeleton
          variant="rectangular"
          height={200}
          sx={{ borderRadius: 4, mb: 2 }}
        />
        <Stack direction="row" spacing={2}>
          <Skeleton width="30%" height={100} />
          <Skeleton width="30%" height={100} />
          <Skeleton width="30%" height={100} />
        </Stack>
      </Container>
    );

  if (baseQ.error)
    return (
      <Container sx={{ pt: 10 }}>
        <Alert severity="error">
          Không tìm thấy người dùng hoặc có lỗi xảy ra.
        </Alert>
      </Container>
    );

  return (
    <Box
      sx={{
        pb: 8,
        minHeight: "100vh",
        bgcolor:
          theme.palette.mode === "light" ? "#f8f9fa" : "background.default",
      }}
    >
      {/* 1. Header Section */}
      {HeaderSection}

      <Container maxWidth="lg">
        {/* 2. Statistics Grid */}
        {StatsSection}

        {/* 3. Content Tabs */}
        <Box sx={{ mt: 10 }}>
          <Stack direction="row" justifyContent="center" mb={3}>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                bgcolor: "background.paper",
                borderRadius: 4,
                p: 0.5,
                boxShadow: theme.shadows[1],
                "& .MuiTab-root": {
                  borderRadius: 3,
                  textTransform: "none",
                  minHeight: 44,
                  fontWeight: 600,
                  px: 3,
                },
                "& .Mui-selected": {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: "primary.main",
                },
                "& .MuiTabs-indicator": { display: "none" },
              }}
            >
              <Tab label="Hồ sơ chi tiết" iconPosition="start" />
              <Tab label="Lịch sử thi đấu" iconPosition="start" />
              <Tab label="Lịch sử điểm trình" iconPosition="start" />
            </Tabs>
          </Stack>

          <Box sx={{ minHeight: 400 }}>
            {tab === 0 && (
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom fontWeight={700}>
                    Giới thiệu
                  </Typography>
                  <Typography
                    paragraph
                    color="text.secondary"
                    sx={{ whiteSpace: "pre-wrap" }}
                  >
                    {base?.bio || "Chưa có."}
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="h6" gutterBottom fontWeight={700}>
                    Thông tin thêm
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <Typography variant="caption" color="text.secondary">
                        Tỉnh thành
                      </Typography>
                      <Typography fontWeight={500}>
                        {base?.province || "—"}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <Typography variant="caption" color="text.secondary">
                        ID người dùng
                      </Typography>
                      <Typography fontWeight={500}>
                        {String(base?._id).slice(-6).toUpperCase()}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            )}
            {tab === 1 && MatchHistoryTab}
            {tab === 2 && RatingHistoryTab}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
