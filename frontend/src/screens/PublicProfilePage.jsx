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
  CardHeader,
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
} from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SecurityIcon from "@mui/icons-material/Security";
import { useTheme, useMediaQuery } from "@mui/material";

import {
  useGetPublicProfileQuery,
  useGetRatingHistoryQuery,
  useGetMatchHistoryQuery,
} from "../slices/usersApiSlice"; // adjust path if needed
import { ZoomableWrapper } from "../components/Zoom";

/* ---------- placeholders ---------- */
const AVA_PLACE = "https://dummyimage.com/160x160/cccccc/ffffff&text=?";
const TEXT_PLACE = "—";
const VIDEO_PLACE = (
  <InfoOutlinedIcon fontSize="small" sx={{ color: "text.disabled" }} />
);

/* ---------- small utils ---------- */
const tz = { timeZone: "Asia/Bangkok" };
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("vi-VN", tz) : TEXT_PLACE;
const fmtDT = (iso) =>
  iso ? new Date(iso).toLocaleString("vi-VN", tz) : TEXT_PLACE;
const safe = (v, fallback = TEXT_PLACE) =>
  v === null || v === undefined || v === "" ? fallback : v;
const num = (v, digits = 3) =>
  Number.isFinite(v) ? Number(v).toFixed(digits) : TEXT_PLACE;

const preferNick = (p) =>
  (p?.nickname && String(p.nickname).trim()) ||
  (p?.nickName && String(p.nickName).trim()) ||
  (p?.nick_name && String(p.nick_name).trim()) ||
  (p?.name && String(p.name).trim()) ||
  (p?.fullName && String(p.fullName).trim()) ||
  "N/A";

function genderLabel(g) {
  if (g === null || g === undefined || g === "") return "Không xác định";
  if (g === 0 || g === "0") return "Không xác định";
  if (g === 1 || g === "1") return "Nam";
  if (g === 2 || g === "2") return "Nữ";
  if (g === 3 || g === "3") return "Khác";
  const s = String(g).toLowerCase().trim();
  if (["unknown", "unspecified", "na", "none"].includes(s))
    return "Không xác định";
  if (["male", "m", "nam"].includes(s)) return "Nam";
  if (["female", "f", "nu", "nữ"].includes(s)) return "Nữ";
  if (["other", "khac", "khác", "nonbinary", "non-binary"].includes(s))
    return "Khác";
  return "Không xác định";
}

function toScoreLines(m) {
  if (Array.isArray(m?.gameScores) && m.gameScores.length) {
    return m.gameScores.map((g, i) => {
      const a = g?.a ?? g?.A ?? g?.left ?? g?.teamA ?? g?.scoreA ?? "–";
      const b = g?.b ?? g?.B ?? g?.right ?? g?.teamB ?? g?.scoreB ?? "–";
      return `G${i + 1}: ${a}–${b}`;
    });
  }
  const s = (m?.scoreText || "").trim();
  if (!s) return [];
  return s.split(",").map((x, i) => `G${i + 1}: ${x.trim()}`);
}

/* ---------- tabs a11y ---------- */
function a11yProps(index) {
  return {
    id: `profile-tab-${index}`,
    "aria-controls": `profile-tabpanel-${index}`,
  };
}

function TabPanel({ children, value, index }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`profile-tabpanel-${index}`}
      aria-labelledby={`profile-tab-${index}`}
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

/* ---------- copy helper ---------- */
async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText)
      await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    return true;
  } catch {
    return false;
  }
}

function CopyIconBtn({ value, title = "Nội dung", onDone }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    const ok = await copyToClipboard(String(value ?? ""));
    setCopied(true);
    onDone?.(ok);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <Tooltip title={`Sao chép ${title.toLowerCase()}`}>
      <IconButton size="small" onClick={handle} aria-label="copy">
        {copied ? (
          <CheckIcon fontSize="inherit" />
        ) : (
          <ContentCopyIcon fontSize="inherit" />
        )}
      </IconButton>
    </Tooltip>
  );
}

/* ---------- Sparkline (inline SVG, no deps) ---------- */
function Sparkline({ data = [], width = 160, height = 44, strokeWidth = 2 }) {
  const points = useMemo(() => {
    if (!Array.isArray(data) || !data.length) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = Math.max(1e-6, max - min);
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    return data
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / span) * height;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data, width, height]);

  if (!points)
    return (
      <Box
        sx={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography variant="caption" color="text.disabled">
          Không có dữ liệu
        </Typography>
      </Box>
    );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="rating trend"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        points={points}
      />
    </svg>
  );
}

/* ---------- Player & Match cells ---------- */
function PlayerCell({ players = [], highlight = false }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  if (!players?.length)
    return <Typography color="text.secondary">—</Typography>;
  return (
    <Stack spacing={0.75}>
      {players.map((p, idx) => {
        const up = (p?.delta ?? 0) > 0;
        const down = (p?.delta ?? 0) < 0;
        const hasScore =
          Number.isFinite(p?.preScore) || Number.isFinite(p?.postScore);
        const nick = preferNick(p);
        return (
          <Stack
            key={`${p?._id || nick || idx}`}
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              p: 0.25,
              borderRadius: 1,
              ...(highlight && {
                bgcolor: "success.light",
                pr: 1,
                opacity: 0.95,
              }),
            }}
          >
            <Avatar
              src={p?.avatar || AVA_PLACE}
              sx={{ width: 24, height: 24 }}
              imgProps={{ onError: (e) => (e.currentTarget.src = AVA_PLACE) }}
            />
            <Stack sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap title={nick}>
                {nick}
              </Typography>
              {hasScore ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  sx={{ flexWrap: isMobile ? "wrap" : "nowrap" }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ lineHeight: 1.2 }}
                  >
                    {num(p?.preScore)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: up
                        ? "success.main"
                        : down
                        ? "error.main"
                        : "text.primary",
                      lineHeight: 1.2,
                    }}
                  >
                    {num(p?.postScore)}
                  </Typography>
                  {Number.isFinite(p?.delta) && p?.delta !== 0 && (
                    <Box
                      component="span"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        lineHeight: 1,
                      }}
                    >
                      {p.delta > 0 ? (
                        <ArrowDropUpIcon
                          fontSize="small"
                          sx={{ color: "success.main", ml: -0.25 }}
                        />
                      ) : (
                        <ArrowDropDownIcon
                          fontSize="small"
                          sx={{ color: "error.main", ml: -0.25 }}
                        />
                      )}
                      <Typography
                        variant="caption"
                        sx={{
                          color: p.delta > 0 ? "success.main" : "error.main",
                        }}
                      >
                        {Math.abs(p.delta).toFixed(3)}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              ) : (
                <Typography variant="caption" color="text.disabled">
                  Chưa có điểm
                </Typography>
              )}
            </Stack>
          </Stack>
        );
      })}
    </Stack>
  );
}

function MatchCardMobile({ m, onClick }) {
  const winnerA = m?.winner === "A";
  const winnerB = m?.winner === "B";
  const scoreLines = toScoreLines(m);
  return (
    <Card
      variant="outlined"
      sx={{ borderRadius: 2, cursor: onClick ? "pointer" : "default" }}
      onClick={() => onClick?.(m)}
    >
      <CardContent sx={{ p: 1.25 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Chip
            size="small"
            color="primary"
            label={safe(m.code, String(m._id).slice(-5))}
          />
          <Chip size="small" color="info" label={fmtDT(m.dateTime)} />
        </Stack>
        <Typography
          variant="body2"
          sx={{ mt: 0.5, mb: 1, color: "text.secondary" }}
          noWrap
          title={safe(m?.tournament?.name)}
        >
          {safe(m?.tournament?.name)}
        </Typography>
        <Stack direction="row" alignItems="flex-start" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <PlayerCell players={m.team1} highlight={winnerA} />
          </Box>
          <Box
            sx={{
              minWidth: 90,
              textAlign: "center",
              px: 0.5,
              alignSelf: "center",
            }}
          >
            {scoreLines.length ? (
              <Stack spacing={0.25}>
                {scoreLines.map((s, i) => (
                  <Typography key={i} fontWeight={800}>
                    {s}
                  </Typography>
                ))}
              </Stack>
            ) : (
              <Typography variant="h6" fontWeight={800}>
                {safe(m.scoreText)}
              </Typography>
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <PlayerCell players={m.team2} highlight={winnerB} />
          </Box>
        </Stack>
        <Stack direction="row" justifyContent="flex-end" mt={1}>
          {m.video ? (
            <Button
              size="small"
              startIcon={<PlayCircleOutlineIcon />}
              component="a"
              href={m.video}
              onClick={(e) => e.stopPropagation()}
              target="_blank"
              rel="noopener noreferrer"
            >
              Xem video
            </Button>
          ) : (
            <Chip
              size="small"
              variant="outlined"
              icon={<InfoOutlinedIcon />}
              label="Không có video"
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ---------- Main Page ---------- */
export default function PublicProfilePage() {
  const { id } = useParams(); // route: /u/:id
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  // Tabs state sync with query param (read-once)
  const defaultTab = useQueryTab();
  const [tab, setTab] = useState(defaultTab);
  const [snack, setSnack] = useState({
    open: false,
    message: "",
    severity: "success",
  });
  const openSnack = (message, severity = "success") =>
    setSnack({ open: true, message, severity });
  const closeSnack = () => setSnack((s) => ({ ...s, open: false }));

  // Queries
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

  const me = useSelector((s) => s.auth?.userInfo);
  const viewerIsAdmin = !!(me?.isAdmin || me?.role === "admin");

  // Derived: rating series & latest
  const singleSeries = useMemo(
    () => ratingRaw.map((h) => Number(h.single)).filter(Number.isFinite),
    [ratingRaw]
  );
  const doubleSeries = useMemo(
    () => ratingRaw.map((h) => Number(h.double)).filter(Number.isFinite),
    [ratingRaw]
  );
  const latestSingle = useMemo(
    () =>
      ratingRaw.length
        ? ratingRaw[0].single ?? base?.levelPoint?.single
        : base?.levelPoint?.single ?? base?.levelPoint?.score,
    [ratingRaw, base]
  );
  const latestDouble = useMemo(
    () =>
      ratingRaw.length
        ? ratingRaw[0].double ?? base?.levelPoint?.double
        : base?.levelPoint?.double,
    [ratingRaw, base]
  );

  // Derived: matches & win rate
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

  useEffect(() => {
    document.title = base?.nickname
      ? `@${base.nickname} • PickleTour`
      : `Hồ sơ • PickleTour`;
  }, [base?.nickname]);

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: base?.name || base?.nickname,
          text: `Hồ sơ của ${base?.name || base?.nickname}`,
          url,
        });
      } else {
        const ok = await copyToClipboard(url);
        openSnack(
          ok ? "Đã sao chép liên kết hồ sơ" : "Không sao chép được",
          ok ? "success" : "error"
        );
      }
    } catch (e) {
      // user cancelled or error
    }
  };

  // Pagination local
  const [ratingPage, setRatingPage] = useState(1);
  const [ratingPerPage] = useState(10);
  const [matchPage, setMatchPage] = useState(1);
  const [matchPerPage] = useState(10);

  const ratingPaged = useMemo(() => {
    const start = (ratingPage - 1) * ratingPerPage;
    return ratingRaw.slice(start, start + ratingPerPage);
  }, [ratingRaw, ratingPage, ratingPerPage]);

  const matchPaged = useMemo(() => {
    const start = (matchPage - 1) * matchPerPage;
    return matchRaw.slice(start, start + matchPerPage);
  }, [matchRaw, matchPage, matchPerPage]);

  /* ================= Layout blocks ================= */
  const Hero = (
    <Paper
      elevation={1}
      sx={{
        position: "relative",
        borderRadius: { xs: 0, md: 3 },
        overflow: "hidden",
        mb: 3,
      }}
    >
      <Box
        sx={{
          height: { xs: 140, sm: 180, md: 220 },
          background: `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.secondary.light})`,
          opacity: theme.palette.mode === "dark" ? 0.9 : 1,
        }}
      />
      <Box
        sx={{ px: { xs: 2, sm: 3 }, pb: 2, mt: { xs: -8, sm: -10, md: -8 } }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ xs: "center", sm: "flex-end" }}
        >
          <ZoomableWrapper src={base?.avatar || AVA_PLACE}>
            <Avatar
              src={base?.avatar || AVA_PLACE}
              sx={{
                width: { xs: 96, sm: 120 },
                height: { xs: 96, sm: 120 },
                border: "3px solid",
                borderColor: "background.paper",
                boxShadow: 3,
              }}
              imgProps={{ onError: (e) => (e.currentTarget.src = AVA_PLACE) }}
            />
          </ZoomableWrapper>
          <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
            <Typography variant="h5" noWrap title={safe(base?.name)}>
              {safe(base?.name)}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
                title={safe(base?.nickname)}
              >
                {base?.nickname ? `@${base.nickname}` : TEXT_PLACE}
              </Typography>
              {base?.nickname ? (
                <CopyIconBtn
                  value={base.nickname}
                  title="nickname"
                  onDone={() => openSnack("Đã sao chép nickname")}
                />
              ) : null}
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              flexWrap="wrap"
              sx={{ gap: 0.75 }}
            >
              <Chip
                size="small"
                color="secondary"
                label={`Giới tính: ${genderLabel(base?.gender)}`}
              />
              <Chip
                size="small"
                color="info"
                label={`Tỉnh/TP: ${safe(base?.province, "Không rõ")}`}
              />
              <Chip
                size="small"
                color="success"
                label={`Tham gia: ${fmtDate(base?.joinedAt)}`}
              />
              {viewerIsAdmin && typeof base?.isAdmin === "boolean" && (
                <Chip
                  size="small"
                  color={base.isAdmin ? "error" : "default"}
                  icon={<SecurityIcon />}
                  label={base.isAdmin ? "Quyền: Admin" : "Quyền: User"}
                />
              )}
            </Stack>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignSelf: { xs: "center", sm: "flex-end" }, pb: 1 }}
          >
            <Button
              variant="outlined"
              startIcon={<ShareIcon />}
              onClick={handleShare}
            >
              Chia sẻ
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Paper>
  );

  const QuickStats = (
    <Grid container spacing={{ xs: 1.5, md: 2 }}>
      <Grid item xs={12} md={4} sx={{ width: isMobile ? "100%" : "auto" }}>
        <Card variant="outlined" sx={{ height: "100%", width: "100%" }}>
          <CardHeader title="Tổng quan" sx={{ pb: 0.5 }} />
          <CardContent>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              divider={<Divider orientation="vertical" flexItem />}
            >
              <Stack>
                <Typography variant="h4" fontWeight={800}>
                  {totalMatches}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Trận đã chơi
                </Typography>
              </Stack>
              <Stack>
                <Typography variant="h4" fontWeight={800}>
                  {wins}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Trận thắng
                </Typography>
              </Stack>
              <Stack>
                <Typography variant="h4" fontWeight={800}>
                  {winRate}%
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Tỷ lệ thắng
                </Typography>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={4} sx={{ width: isMobile ? "100%" : "auto" }}>
        <Card variant="outlined" sx={{ height: "100%" }}>
          <CardHeader title="Điểm đơn" sx={{ pb: 0.5 }} />
          <CardContent>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography variant="h4" fontWeight={800}>
                {num(latestSingle)}
              </Typography>
              <Sparkline
                data={singleSeries.slice().reverse()}
                width={160}
                height={44}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Xu hướng gần đây
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={4} sx={{ width: isMobile ? "100%" : "auto" }}>
        <Card variant="outlined" sx={{ height: "100%" }}>
          <CardHeader title="Điểm đôi" sx={{ pb: 0.5 }} />
          <CardContent>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography variant="h4" fontWeight={800}>
                {num(latestDouble)}
              </Typography>
              <Sparkline
                data={doubleSeries.slice().reverse()}
                width={160}
                height={44}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Xu hướng gần đây
            </Typography>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );

  const InfoSection = (
    <Card variant="outlined">
      <CardHeader title="Giới thiệu" />
      <CardContent>
        <Typography
          variant="body2"
          sx={{ whiteSpace: "pre-wrap", color: "text.secondary" }}
        >
          {safe(base?.bio, "Chưa có")}
        </Typography>
        {viewerIsAdmin && (
          <>
            <Divider sx={{ my: 2 }} />
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Tên hiển thị
                  </Typography>
                  <Typography fontWeight={700}>{safe(base?.name)}</Typography>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Nickname
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography fontWeight={700}>
                      {base?.nickname ? `@${base.nickname}` : TEXT_PLACE}
                    </Typography>
                    {base?.nickname && (
                      <CopyIconBtn
                        value={base.nickname}
                        title="nickname"
                        onDone={() => openSnack("Đã sao chép nickname")}
                      />
                    )}
                  </Stack>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Giới tính
                  </Typography>
                  <Typography fontWeight={700}>
                    {genderLabel(base?.gender)}
                  </Typography>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Tỉnh/TP
                  </Typography>
                  <Typography fontWeight={700}>
                    {safe(base?.province, "Không rõ")}
                  </Typography>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    Tham gia
                  </Typography>
                  <Typography fontWeight={700}>
                    {fmtDate(base?.joinedAt)}
                  </Typography>
                </Stack>
              </Grid>
              {typeof base?.isAdmin === "boolean" && (
                <Grid item xs={12} md={6}>
                  <Stack spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">
                      Quyền
                    </Typography>
                    <Typography fontWeight={700}>
                      {base.isAdmin ? "Admin" : "User"}
                    </Typography>
                  </Stack>
                </Grid>
              )}
              {base?._id && (
                <Grid item xs={12}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      ID:
                    </Typography>
                    <Typography>{String(base._id)}</Typography>
                    <CopyIconBtn
                      value={String(base._id)}
                      title="ID"
                      onDone={() => openSnack("Đã sao chép ID")}
                    />
                  </Stack>
                </Grid>
              )}
            </Grid>
          </>
        )}
      </CardContent>
    </Card>
  );

  const RatingSection = (
    <Card variant="outlined">
      <CardHeader title="Lịch sử điểm trình" />
      <CardContent>
        {isMobile ? (
          <Stack spacing={1.25}>
            {ratingPaged.length ? (
              ratingPaged.map((h) => {
                const historyId = h?._id ?? h?.id;
                const scorerName = h?.scorer?.name || h?.scorer?.email || "—";
                return (
                  <Card
                    key={historyId}
                    variant="outlined"
                    sx={{ borderRadius: 1.5 }}
                  >
                    <CardContent sx={{ p: 1.5 }}>
                      <Stack spacing={1}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                        >
                          <Typography variant="body2" fontWeight={600}>
                            {fmtDate(h.scoredAt)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Bởi: {scorerName}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1}>
                          <Chip
                            size="small"
                            label={`Đơn: ${num(h.single)}`}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={`Đôi: ${num(h.double)}`}
                            variant="outlined"
                          />
                        </Stack>
                        {h?.note ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {h.note}
                          </Typography>
                        ) : null}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <Typography
                align="center"
                sx={{ fontStyle: "italic", color: "text.secondary" }}
              >
                Không có dữ liệu
              </Typography>
            )}
            <Stack direction="row" justifyContent="center" mt={0.5}>
              <Pagination
                page={ratingPage}
                onChange={(_, p) => setRatingPage(p)}
                count={Math.max(1, Math.ceil(ratingRaw.length / ratingPerPage))}
                shape="rounded"
                size="small"
              />
            </Stack>
          </Stack>
        ) : (
          <>
            <TableContainer
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
                maxHeight: { xs: 360, md: "56vh" },
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Ngày</TableCell>
                    <TableCell>Người chấm</TableCell>
                    <TableCell align="right">Điểm đơn</TableCell>
                    <TableCell align="right">Điểm đôi</TableCell>
                    <TableCell>Ghi chú</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ratingPaged.length ? (
                    ratingPaged.map((h) => (
                      <TableRow key={h?._id ?? h?.id} hover>
                        <TableCell>{fmtDate(h.scoredAt)}</TableCell>
                        <TableCell sx={{ color: "text.secondary" }}>
                          {h?.scorer?.name || h?.scorer?.email || "—"}
                        </TableCell>
                        <TableCell align="right">{num(h.single)}</TableCell>
                        <TableCell align="right">{num(h.double)}</TableCell>
                        <TableCell sx={{ color: "text.secondary" }}>
                          {h?.note || TEXT_PLACE}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        align="center"
                        sx={{ fontStyle: "italic" }}
                      >
                        Không có dữ liệu
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" justifyContent="center" mt={1}>
              <Pagination
                page={ratingPage}
                onChange={(_, p) => setRatingPage(p)}
                count={Math.max(1, Math.ceil(ratingRaw.length / ratingPerPage))}
                shape="rounded"
                size="small"
              />
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );

  const MatchesSection = (
    <Card variant="outlined">
      <CardHeader title="Lịch sử thi đấu" />
      <CardContent>
        {isMobile ? (
          <Stack spacing={1.25}>
            {matchPaged.length ? (
              matchPaged.map((m) => <MatchCardMobile key={m._id} m={m} />)
            ) : (
              <Typography
                align="center"
                sx={{ fontStyle: "italic", color: "text.secondary" }}
              >
                Không có dữ liệu
              </Typography>
            )}
            <Stack direction="row" justifyContent="center" mt={0.5}>
              <Pagination
                page={matchPage}
                onChange={(_, p) => setMatchPage(p)}
                count={Math.max(1, Math.ceil(matchRaw.length / matchPerPage))}
                shape="rounded"
                size="small"
              />
            </Stack>
          </Stack>
        ) : (
          <>
            <TableContainer
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
                maxHeight: { xs: 360, md: "62vh" },
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>ID</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      Ngày & giờ
                    </TableCell>
                    <TableCell>Tên giải</TableCell>
                    <TableCell>Đội 1</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>Tỷ số</TableCell>
                    <TableCell>Đội 2</TableCell>
                    <TableCell align="center" sx={{ whiteSpace: "nowrap" }}>
                      Video
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {matchPaged.length ? (
                    matchPaged.map((m) => {
                      const winnerA = m?.winner === "A";
                      const winnerB = m?.winner === "B";
                      const scoreLines = toScoreLines(m);
                      return (
                        <TableRow key={m._id} hover>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {safe(m.code, String(m._id).slice(-5))}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {fmtDT(m.dateTime)}
                          </TableCell>
                          <TableCell sx={{ minWidth: 220 }}>
                            <Tooltip title={safe(m?.tournament?.name)}>
                              <Typography noWrap>
                                {safe(m?.tournament?.name)}
                              </Typography>
                            </Tooltip>
                          </TableCell>
                          <TableCell sx={{ minWidth: 240 }}>
                            <PlayerCell players={m.team1} highlight={winnerA} />
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {scoreLines.length ? (
                              <Stack spacing={0} alignItems="flex-start">
                                {scoreLines.map((s, i) => (
                                  <Typography key={i} fontWeight={700}>
                                    {s}
                                  </Typography>
                                ))}
                              </Stack>
                            ) : (
                              <Typography fontWeight={700}>
                                {safe(m.scoreText)}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ minWidth: 240 }}>
                            <PlayerCell players={m.team2} highlight={winnerB} />
                          </TableCell>
                          <TableCell
                            align="center"
                            sx={{ whiteSpace: "nowrap" }}
                          >
                            {m.video ? (
                              <a
                                href={m.video}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Xem video"
                                style={{ display: "inline-flex" }}
                              >
                                <PlayCircleOutlineIcon fontSize="small" />
                              </a>
                            ) : (
                              VIDEO_PLACE
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        align="center"
                        sx={{ fontStyle: "italic" }}
                      >
                        Không có dữ liệu
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" justifyContent="center" mt={1}>
              <Pagination
                page={matchPage}
                onChange={(_, p) => setMatchPage(p)}
                count={Math.max(1, Math.ceil(matchRaw.length / matchPerPage))}
                shape="rounded"
                size="small"
              />
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );

  const LoadingState = (
    <Stack spacing={2}>
      <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
      <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 2 }} />
      <Skeleton variant="rectangular" height={420} sx={{ borderRadius: 2 }} />
    </Stack>
  );

  const ErrorState = (
    <Alert severity="error">
      {baseQ.error?.data?.message || baseQ.error?.error || "Lỗi tải dữ liệu"}
    </Alert>
  );

  return (
    <Box sx={{ pb: 6 }}>
      <Container maxWidth="lg" sx={{ pt: { xs: 1.5, sm: 2 } }}>
        {baseQ.isLoading ? (
          LoadingState
        ) : baseQ.error ? (
          ErrorState
        ) : (
          <>
            {Hero}

            {QuickStats}

            {/* Sticky tabs */}
            <Paper
              elevation={0}
              sx={{
                position: "sticky",
                top: 0,
                zIndex: (t) => t.zIndex.appBar - 1,
                bgcolor: "background.default",
                mt: 2,
              }}
            >
              <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                variant="scrollable"
                scrollButtons
                allowScrollButtonsMobile
                aria-label="tabs"
              >
                <Tab label="Thông tin" {...a11yProps(0)} />
                <Tab label="Điểm trình" {...a11yProps(1)} />
                <Tab label="Thi đấu" {...a11yProps(2)} />
              </Tabs>
              <Divider />
            </Paper>

            <TabPanel value={tab} index={0}>
              {InfoSection}
            </TabPanel>
            <TabPanel value={tab} index={1}>
              {RatingSection}
            </TabPanel>
            <TabPanel value={tab} index={2}>
              {MatchesSection}
            </TabPanel>
          </>
        )}
      </Container>

      {/* snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={2000}
        onClose={closeSnack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={closeSnack}
          severity={snack.severity}
          sx={{ width: "100%" }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

/* ---------- tiny helpers ---------- */
function useQueryTab() {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const t = params.get("tab");
  const map = { info: 0, rating: 1, matches: 2 };
  return map[t] ?? 0;
}
