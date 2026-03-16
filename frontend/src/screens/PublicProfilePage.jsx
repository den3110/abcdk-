/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
  Paper,
  useTheme,
  useMediaQuery,
  alpha,
} from "@mui/material";
import { useSelector } from "react-redux";

// Icons
import ShareIcon from "@mui/icons-material/Share";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import PlayCircleFilledWhiteIcon from "@mui/icons-material/PlayCircleFilledWhite";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import PlaceIcon from "@mui/icons-material/Place";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

import {
  useGetPublicProfileQuery,
  useGetRatingHistoryQuery,
  useGetMatchHistoryQuery,
} from "../slices/usersApiSlice";
import { ZoomableWrapper } from "../components/Zoom";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext";
import { formatDate, formatDateTime } from "../i18n/format";
import { getGenderLabel } from "../i18n/uiOptions";

/* ---------- CONSTANTS & UTILS ---------- */
const AVA_PLACE = "https://dummyimage.com/160x160/cccccc/ffffff&text=?";
// Keep decimals like the legacy screen (default 3 digits).
const num = (v, digits = 3) =>
  Number.isFinite(+v) ? Number(v).toFixed(digits) : "—";
const numFloat = (v, digits = 3) =>
  Number.isFinite(+v) ? Number(v).toFixed(digits) : "—";

const calcAge = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  if (age < 0 || age > 120) return "—";
  return age;
};

const getHandLabel = (h) => {
  if (!h) return null;
  const s = String(h).toLowerCase();
  if (["left", "trai", "l"].includes(s)) return "left";
  if (["right", "phai", "r"].includes(s)) return "right";
  if (["both", "ambi", "2", "hai tay"].includes(s)) return "both";
  return h;
};

// chỉ coi là có data khi: không null/undefined/empty/"—", số 0 vẫn là data
const hasData = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return true;
  const s = String(v).trim();
  if (!s) return false;
  if (s === "—") return false;
  return true;
};

/* ---------- SUB-COMPONENTS (STYLED) ---------- */

// 1. Modern Copy Button
const CopyBtn = ({ value, label }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(value ?? ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <Tooltip
      title={
        copied
          ? t("publicProfile.copy.success")
          : t("publicProfile.copy.action", { label: label || "" })
      }
    >
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
const MatchResultBadge = ({ isWinner }) => {
  const { t } = useLanguage();

  return (
    <Chip
      label={
        isWinner
          ? t("publicProfile.matchResult.win")
          : t("publicProfile.matchResult.lose")
      }
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
};

// 4. Player Mini Cell – giữ thập phân & căn giữa
const PlayerRow = ({ p, highlight }) => {
  const up = (p?.delta ?? 0) > 0;
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
      sx={{ py: 0.5, justifyContent: "center" }}
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
        {p?.postScore !== undefined && p?.postScore !== null && (
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

// 5. Info item cho tab Hồ sơ chi tiết
const InfoItem = ({ label, value, copyable }) => {
  const display =
    value === null || value === undefined || value === "" ? "—" : value;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ mt: 0.25, minWidth: 0 }}
      >
        <Typography variant="body2" fontWeight={500} noWrap>
          {display}
        </Typography>
        {copyable && display !== "—" && (
          <CopyBtn value={display} label={label} />
        )}
      </Stack>
    </Box>
  );
};

/* ---------- MAIN COMPONENT ---------- */
export default function PublicProfilePage() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { locale, t } = useLanguage();
  const [tab, setTab] = useState(0);
  const fmtDate = (iso) =>
    iso
      ? formatDate(iso, locale, { timeZone: "Asia/Bangkok" })
      : t("common.unavailable");
  const fmtDT = (iso) =>
    iso
      ? formatDateTime(iso, locale, {
          timeZone: "Asia/Bangkok",
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "2-digit",
        })
      : t("common.unavailable");
  const genderInfo = (gender) => {
    const label = getGenderLabel(t, gender);
    if (label === t("profile.genderOptions.male")) return { label, color: "info" };
    if (label === t("profile.genderOptions.female")) return { label, color: "error" };
    return { label, color: "default" };
  };
  const handLabelValue = (value) => {
    const hand = getHandLabel(value);
    if (hand === "left") return t("publicProfile.values.handLeft");
    if (hand === "right") return t("publicProfile.values.handRight");
    if (hand === "both") return t("publicProfile.values.handBoth");
    return hand || t("common.unavailable");
  };

  // Queries
  const baseQ = useGetPublicProfileQuery(id);
  const rateQ = useGetRatingHistoryQuery(id);
  const matchQ = useGetMatchHistoryQuery(id);

  const base = useMemo(() => baseQ.data || {}, [baseQ.data]);
  const ratingRaw = useMemo(
    () =>
      Array.isArray(rateQ.data?.history)
        ? rateQ.data.history
        : rateQ.data?.items || [],
    [rateQ.data]
  );
  const matchRaw = useMemo(
    () => (Array.isArray(matchQ.data) ? matchQ.data : matchQ.data?.items || []),
    [matchQ.data]
  );

  // Auth viewer (để biết có phải admin / chính chủ không)
  const { userInfo } = useSelector((state) => state.auth || {});
  const baseId = base?._id || "";
  const viewerId = userInfo?._id || userInfo?.id;
  const isSelf = viewerId && baseId && String(viewerId) === String(baseId);
  const isAdminViewer =
    userInfo?.isAdmin ||
    userInfo?.role === "admin" ||
    (Array.isArray(userInfo?.roles) && userInfo.roles.includes("admin"));
  const canSeeSensitive = isSelf || isAdminViewer;
  const profileCode = baseId ? String(baseId).slice(-6).toUpperCase() : t("common.unavailable");

  // ✅ latestSingle / latestDouble giống bản cũ (ưu tiên history, fallback levelPoint)
  const latestSingle = useMemo(() => {
    if (ratingRaw.length) {
      const v = Number(ratingRaw[0]?.single);
      if (Number.isFinite(v)) return v;
    }
    const fallback =
      base?.levelPoint?.single ?? base?.levelPoint?.score ?? undefined;
    const v2 = Number(fallback);
    return Number.isFinite(v2) ? v2 : NaN;
  }, [ratingRaw, base]);

  const latestDouble = useMemo(() => {
    if (ratingRaw.length) {
      const v = Number(ratingRaw[0]?.double);
      if (Number.isFinite(v)) return v;
    }
    const fallback = base?.levelPoint?.double ?? undefined;
    const v2 = Number(fallback);
    return Number.isFinite(v2) ? v2 : NaN;
  }, [ratingRaw, base]);

  // Derived stats
  const uid = base?._id || id;
  const { totalMatches, wins, winRate } = useMemo(() => {
    let total = 0;
    let w = 0;
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

  // Share
  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: base?.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        alert(t("publicProfile.copy.shareSuccess"));
      }
    } catch {
      // user cancel
    }
  };

  /* ---------- SECTIONS ---------- */

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
            bgcolor: "rgba(255,255,255,0.8)",
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
            bgcolor: "rgba(255,255,255,0.8)",
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
              <Tooltip title={t("publicProfile.adminTooltip")}>
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
              {base?.name || base?.fullName || t("publicProfile.defaultName")}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              justifyContent={{ xs: "center", sm: "flex-start" }}
              alignItems="center"
              sx={{ mb: 2, color: "text.secondary" }}
            >
              <Typography variant="body1" fontWeight={500}>
                @{base?.nickname || t("publicProfile.nicknameFallback")}
              </Typography>
              {hasData(base?.nickname) && (
                <CopyBtn value={base?.nickname || ""} label={t("publicProfile.labels.nickname")} />
              )}
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              justifyContent={{ xs: "center", sm: "flex-start" }}
              gap={1}
            >
              {hasData(base?.province) && (
                <Chip
                  icon={<PlaceIcon fontSize="small" />}
                  label={base.province}
                  size="small"
                  variant="outlined"
                />
              )}
              <Chip
                icon={<CalendarMonthIcon fontSize="small" />}
                label={t("publicProfile.joinedAt", { date: fmtDate(base.joinedAt || base.createdAt) })}
                size="small"
                variant="outlined"
              />
              <Chip
                label={genderInfo(base?.gender).label}
                color={genderInfo(base?.gender).color}
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
              {t("publicProfile.share")}
            </Button>
          </Box>
        </Paper>
      </Container>
    </Box>
  );

  // ✅ Grid dùng size (MUI v7) + dùng latestSingle/latestDouble
  const StatsSection = (
    <Grid container spacing={2} sx={{ mb: 4, mt: { xs: 6, md: 0 } }}>
      <Grid size={{ xs: 12, sm: 4 }}>
        <StatBox
          icon={<SportsTennisIcon />}
          label={t("publicProfile.stats.totalMatches")}
          value={totalMatches}
          subValue={t("publicProfile.stats.totalMatchesHint")}
          color="primary"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <StatBox
          icon={<EmojiEventsIcon />}
          label={t("publicProfile.stats.wins")}
          value={wins}
          subValue={t("publicProfile.stats.winRate", { rate: winRate })}
          color="warning"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <StatBox
          icon={<TrendingUpIcon />}
          label={t("publicProfile.stats.rating")}
          value={`${num(latestSingle)} / ${num(latestDouble)}`}
          subValue={t("publicProfile.stats.ratingHint")}
          color="success"
        />
      </Grid>
    </Grid>
  );

  const MatchHistoryTab = (
    <Stack spacing={2}>
      {matchPaged.length === 0 ? (
        <Alert severity="info" sx={{ borderRadius: 3 }}>
          {t("publicProfile.values.noMatches")}
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
                    label={m.tournament?.name || t("publicProfile.values.friendlyMatch")}
                    size="small"
                    variant="outlined"
                    sx={{ maxWidth: 200 }}
                  />
                </Stack>

                {/* Teams & Score – căn giữa nội dung trong item */}
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

                  {/* Score */}
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
                      {t("common.actions.view")}
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
              <TableCell>{t("publicProfile.labels.time")}</TableCell>
              <TableCell>{t("publicProfile.labels.scorer")}</TableCell>
              <TableCell align="center">{t("publicProfile.labels.singlePoint")}</TableCell>
              <TableCell align="center">{t("publicProfile.labels.doublePoint")}</TableCell>
              {!isMobile && <TableCell>{t("publicProfile.labels.note")}</TableCell>}
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
                      {row.scorer?.name || t("publicProfile.values.system")}
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
                  {t("publicProfile.values.noRatingHistory")}
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
          {t("publicProfile.values.notFound")}
        </Alert>
      </Container>
    );

  // Một số label từ dữ liệu mở rộng
  const handLabel =
    handLabelValue(
      base?.playHand || base?.hand || base?.handedness || base?.dominantHand
    ) || t("common.unavailable");
  const dob = base?.dob || base?.birthday || base?.dateOfBirth;
  const clubName =
    base?.clubName ||
    base?.mainClub?.name ||
    base?.primaryClub?.name ||
    base?.club?.name;

  const rolesLabel = Array.isArray(base?.roles)
    ? base.roles.join(", ")
    : base?.role || (base?.isAdmin ? "admin" : "user");

  const accountStatus = (() => {
    if (base?.isDeleted) return t("publicProfile.values.deleted");
    if (base?.isBanned) return t("publicProfile.values.banned");
    if (base?.isSuspended) return t("publicProfile.values.suspended");
    return t("publicProfile.values.active");
  })();

  // booleans để ẩn cả block nếu không có field nào có data
  const hasContactBlock =
    hasData(base?.phone) ||
    hasData(base?.email) ||
    hasData(base?.address || base?.street);

  const hasSystemBlock =
    hasData(baseId) ||
    hasData(base.joinedAt || base.createdAt) ||
    hasData(base.lastLoginAt || base.lastActiveAt) ||
    hasData(rolesLabel) ||
    hasData(accountStatus) ||
    hasData(base?.kycStatus) ||
    hasData(base?.kycNote);

  return (
    <Box
      sx={{
        pb: 8,
        minHeight: "100vh",
        bgcolor:
          theme.palette.mode === "light" ? "#f8f9fa" : "background.default",
      }}
    >
      <SEOHead
        title={base?.name || t("publicProfile.seoTitle")}
        description={
          base?.bio ||
          (base?.name
            ? t("publicProfile.seoDescription", { name: base.name })
            : t("publicProfile.seoDescriptionFallback"))
        }
        ogImage={base?.avatar}
        path={`/u/${profileCode}`}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: base?.name || t("publicProfile.defaultPlayer"),
          image: base?.avatar || "https://pickletour.vn/icon.png",
          description:
            base?.bio ||
            t("publicProfile.seoStructuredDescription", {
              name: base?.name || t("publicProfile.defaultPlayer"),
            }),
          url: `https://pickletour.vn/u/${profileCode}`,
          mainEntityOfPage: {
            "@type": "ProfilePage",
            "@id": `https://pickletour.vn/u/${profileCode}`,
          },
        }}
      />
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
              <Tab label={t("publicProfile.tabs.profile")} iconPosition="start" />
              <Tab label={t("publicProfile.tabs.matches")} iconPosition="start" />
              <Tab label={t("publicProfile.tabs.ratings")} iconPosition="start" />
            </Tabs>
          </Stack>

          <Box sx={{ minHeight: 400 }}>
            {tab === 0 && (
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent sx={{ p: 3 }}>
                  {/* Giới thiệu */}
                  <Typography variant="h6" gutterBottom fontWeight={700}>
                    {t("publicProfile.sections.intro")}
                  </Typography>
                  <Typography
                    paragraph
                    color="text.secondary"
                    sx={{ whiteSpace: "pre-wrap" }}
                  >
                    {base?.bio || t("publicProfile.values.noBio")}
                  </Typography>

                  <Divider sx={{ my: 2 }} />

                  {/* Thông tin cơ bản (public) */}
                  <Typography variant="h6" gutterBottom fontWeight={700}>
                    {t("publicProfile.sections.basic")}
                  </Typography>
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    {hasData(base?.name || base?.fullName) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem
                          label={t("publicProfile.labels.fullName")}
                          value={base?.name || base?.fullName}
                        />
                      </Grid>
                    )}
                    {hasData(base?.nickname) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem
                          label={t("publicProfile.labels.nickname")}
                          value={base?.nickname}
                          copyable
                        />
                      </Grid>
                    )}
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <InfoItem
                        label={t("publicProfile.labels.gender")}
                        value={genderInfo(base?.gender).label}
                      />
                    </Grid>
                    {hasData(base?.province) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem label={t("publicProfile.labels.province")} value={base?.province} />
                      </Grid>
                    )}
                    {hasData(dob) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem label={t("publicProfile.labels.dob")} value={fmtDate(dob)} />
                      </Grid>
                    )}
                    {hasData(calcAge(dob)) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem label={t("publicProfile.labels.age")} value={calcAge(dob)} />
                      </Grid>
                    )}
                    {hasData(handLabel) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem label={t("publicProfile.labels.dominantHand")} value={handLabel} />
                      </Grid>
                    )}
                    {hasData(profileCode) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem label={t("publicProfile.labels.profileCode")} value={profileCode} />
                      </Grid>
                    )}
                  </Grid>

                  {/* Thông tin thi đấu (public) */}
                  <Typography variant="h6" gutterBottom fontWeight={700}>
                    {t("publicProfile.sections.competition")}
                  </Typography>
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    {hasData(clubName) && (
                      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <InfoItem label={t("publicProfile.labels.mainClub")} value={clubName} />
                      </Grid>
                    )}
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <InfoItem
                        label={t("publicProfile.labels.singleRating")}
                        value={num(latestSingle)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <InfoItem
                        label={t("publicProfile.labels.doubleRating")}
                        value={num(latestDouble)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <InfoItem
                        label={t("publicProfile.labels.record")}
                        value={`${totalMatches || 0} / ${wins || 0}`}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <InfoItem
                        label={t("publicProfile.stats.wins")}
                        value={`${winRate || 0}%`}
                      />
                    </Grid>
                  </Grid>

                  {/* Thông tin liên hệ + hệ thống: chỉ admin / chính chủ thấy và chỉ khi có data */}
                  {canSeeSensitive && hasContactBlock && (
                    <>
                      <Divider sx={{ my: 2 }} />

                      <Typography variant="h6" gutterBottom fontWeight={700}>
                        {t("publicProfile.sections.contact")}
                      </Typography>
                      <Grid container spacing={2} sx={{ mb: 2 }}>
                        {hasData(base?.phone) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label={t("publicProfile.labels.phone")}
                              value={base?.phone}
                              copyable
                            />
                          </Grid>
                        )}
                        {hasData(base?.email) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label="Email"
                              value={base?.email}
                              copyable
                            />
                          </Grid>
                        )}
                        {hasData(base?.address || base?.street) && (
                          <Grid size={{ xs: 12, sm: 6, md: 6 }}>
                            <InfoItem
                              label={t("common.labels.address")}
                              value={base?.address || base?.street}
                            />
                          </Grid>
                        )}
                      </Grid>
                    </>
                  )}

                  {canSeeSensitive && hasSystemBlock && (
                    <>
                      <Typography variant="h6" gutterBottom fontWeight={700}>
                        {t("publicProfile.sections.system")}
                      </Typography>
                      <Grid container spacing={2}>
                        {hasData(baseId) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label={t("publicProfile.labels.userId")}
                              value={baseId}
                              copyable
                            />
                          </Grid>
                        )}
                        {hasData(base.joinedAt || base.createdAt) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label={t("publicProfile.labels.memberSince")}
                              value={fmtDT(base.joinedAt || base.createdAt)}
                            />
                          </Grid>
                        )}
                        {hasData(base.lastLoginAt || base.lastActiveAt) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label={t("publicProfile.labels.lastLogin")}
                              value={fmtDT(
                                base.lastLoginAt || base.lastActiveAt
                              )}
                            />
                          </Grid>
                        )}
                        {hasData(rolesLabel) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem label={t("publicProfile.labels.role")} value={rolesLabel} />
                          </Grid>
                        )}
                        {hasData(accountStatus) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label={t("publicProfile.labels.accountStatus")}
                              value={accountStatus}
                            />
                          </Grid>
                        )}
                        {hasData(base?.kycStatus) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label={t("publicProfile.labels.kycStatus")}
                              value={base?.kycStatus}
                            />
                          </Grid>
                        )}
                        {hasData(base?.kycNote) && (
                          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <InfoItem
                              label={t("publicProfile.labels.kycNote")}
                              value={base?.kycNote}
                            />
                          </Grid>
                        )}
                      </Grid>
                    </>
                  )}
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
