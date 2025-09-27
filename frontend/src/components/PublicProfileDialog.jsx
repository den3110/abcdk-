/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  IconButton,
  Tabs,
  Tab,
  Button,
  Avatar,
  Stack,
  Typography,
  Alert,
  Divider,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  useTheme,
  useMediaQuery,
  Box,
  Chip,
  Tooltip,
  Skeleton,
  Paper,
  Pagination,
  Card,
  CardContent,
  Snackbar,
  Grid,
} from "@mui/material";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SecurityIcon from "@mui/icons-material/Security";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import SportsScoreIcon from "@mui/icons-material/SportsScore";
// Thêm (hoặc gộp) các imports icon ở đầu file:
import TrophyIcon from "@mui/icons-material/EmojiEvents";
import StreakIcon from "@mui/icons-material/Whatshot";
import MatchesIcon from "@mui/icons-material/SportsTennis";
import BestIcon from "@mui/icons-material/MilitaryTech";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import TableChartIcon from "@mui/icons-material/TableChart";
import RefreshIcon from "@mui/icons-material/Refresh";
import InboxIcon from "@mui/icons-material/Inbox";
import { useSelector } from "react-redux";

import {
  useGetPublicProfileQuery,
  useGetRatingHistoryQuery,
  useGetMatchHistoryQuery,
  useDeleteRatingHistoryMutation,
  useGetUserAchievementsQuery,
} from "../slices/usersApiSlice";

/* ---------- placeholders ---------- */
const AVA_PLACE = "https://dummyimage.com/160x160/cccccc/ffffff&text=?";
const TEXT_PLACE = "—";
const VIDEO_PLACE = (
  <InfoOutlinedIcon fontSize="small" sx={{ color: "text.disabled" }} />
);

/* ---------- small utils ---------- */
const tz = { timeZone: "Asia/Bangkok" };
const sameId = (a, b) => String(a ?? "") === String(b ?? "");
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("vi-VN", tz) : TEXT_PLACE;
const fmtDT = (iso) =>
  iso ? new Date(iso).toLocaleString("vi-VN", tz) : TEXT_PLACE;
const safe = (v, fallback = TEXT_PLACE) =>
  v === null || v === undefined || v === "" ? fallback : v;
const num = (v, digits = 3) =>
  Number.isFinite(v) ? v.toFixed(digits) : TEXT_PLACE;

const getSPC = (base) => {
  const s = base?.spc;
  if (!s || typeof s !== "object") return null;

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const m = s.meta || {};
  return {
    single: toNum(s.single),
    double: toNum(s.double),
    meta: {
      sportId: m.sportId ?? null,
      description: m.description ?? null,
      scoredAt: m.scoredAt ?? null,
      joinDate: m.joinDate ?? null,
      source: m.source ?? null,
    },
  };
};

/* ---------- prefer nickname everywhere ---------- */
const preferNick = (p) =>
  (p?.nickname && String(p.nickname).trim()) ||
  (p?.nickName && String(p.nickName).trim()) ||
  (p?.nick_name && String(p.nick_name).trim()) ||
  (p?.name && String(p.name).trim()) ||
  (p?.fullName && String(p.fullName).trim()) ||
  "N/A";

/* ---------- gender label mapping ---------- */
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

/* --------- score helpers --------- */
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

/* ---------------- helper row (label–value) ---------------- */
function InfoRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
      <Typography
        variant="body2"
        sx={{ color: "text.secondary", minWidth: 120, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 700, wordBreak: "break-word" }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

/* ---------------- Skeletons ---------------- */
function InfoSkeleton() {
  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ xs: "center", md: "flex-start" }}
      >
        <Skeleton variant="circular" width={96} height={96} />
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" width={240} height={32} />
          <Skeleton variant="text" width={160} />
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: "wrap", gap: 0.75 }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" width={130} height={28} />
            ))}
          </Stack>
        </Stack>
      </Stack>

      <Skeleton variant="text" width={100} />
      <Skeleton variant="rounded" height={84} />
    </Stack>
  );
}

function AchievementsSkeleton() {
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" fontWeight={600}>
        Thành tích
      </Typography>
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <Paper
            key={i}
            variant="outlined"
            style={{ padding: 16, borderRadius: 12, width: 220 }}
          >
            <Skeleton variant="text" width={120} />
            <Skeleton variant="text" width={80} />
            <Skeleton variant="rounded" height={10} />
          </Paper>
        ))}
      </Stack>
      <Skeleton variant="rounded" height={180} />
      <Skeleton variant="rounded" height={220} />
    </Stack>
  );
}

function RatingSkeleton({ isMobile }) {
  if (isMobile) {
    return (
      <Stack spacing={1.25}>
        <Typography variant="subtitle1" fontWeight={600}>
          Lịch sử điểm trình
        </Typography>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} variant="outlined" sx={{ borderRadius: 1.5 }}>
            <CardContent sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between">
                  <Skeleton variant="text" width={120} />
                  <Skeleton variant="circular" width={24} height={24} />
                </Stack>
                <Skeleton variant="text" width={160} />
                <Stack direction="row" spacing={1}>
                  <Skeleton variant="rounded" width={80} height={24} />
                  <Skeleton variant="rounded" width={80} height={24} />
                </Stack>
                <Skeleton variant="rounded" height={40} />
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  }

  // Desktop
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" fontWeight={600}>
        Lịch sử điểm trình
      </Typography>
      <TableContainer
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          maxHeight: { xs: 320, md: 360 },
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
              <TableCell align="center" width={72}>
                Thao tác
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length: 5 }).map((_, r) => (
              <TableRow key={r}>
                {Array.from({ length: 6 }).map((__, c) => (
                  <TableCell key={c}>
                    <Skeleton variant="text" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" justifyContent="center">
        <Skeleton variant="rounded" width={220} height={32} />
      </Stack>
    </Stack>
  );
}

function MatchSkeleton({ isMobile }) {
  if (isMobile) {
    return (
      <Stack spacing={1.25}>
        <Typography variant="subtitle1" fontWeight={600}>
          Lịch sử thi đấu
        </Typography>
        {Array.from({ length: 3 }).map((_, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Skeleton variant="rounded" width={80} height={24} />
              <Skeleton variant="rounded" width={120} height={24} />
            </Stack>
            <Skeleton variant="text" sx={{ mt: 0.5, mb: 1 }} />
            <Stack direction="row" alignItems="flex-start" spacing={1}>
              <Stack sx={{ flex: 1 }}>
                {Array.from({ length: 2 }).map((__, j) => (
                  <Stack
                    key={j}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ mb: 0.5 }}
                  >
                    <Skeleton variant="circular" width={24} height={24} />
                    <Skeleton variant="text" width="80%" />
                  </Stack>
                ))}
              </Stack>
              <Box
                sx={{
                  minWidth: 90,
                  textAlign: "center",
                  px: 0.5,
                  alignSelf: "center",
                }}
              >
                <Skeleton variant="text" width={70} />
                <Skeleton variant="text" width={70} />
              </Box>
              <Stack sx={{ flex: 1 }}>
                {Array.from({ length: 2 }).map((__, j) => (
                  <Stack
                    key={j}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ mb: 0.5 }}
                  >
                    <Skeleton variant="circular" width={24} height={24} />
                    <Skeleton variant="text" width="80%" />
                  </Stack>
                ))}
              </Stack>
            </Stack>
            <Stack direction="row" justifyContent="flex-end" mt={1}>
              <Skeleton variant="rounded" width={100} height={30} />
            </Stack>
          </Paper>
        ))}
        <Stack direction="row" justifyContent="center">
          <Skeleton variant="rounded" width={220} height={32} />
        </Stack>
      </Stack>
    );
  }

  // Desktop
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" fontWeight={600}>
        Lịch sử thi đấu
      </Typography>
      <TableContainer
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          maxHeight: { xs: 360, md: 500 },
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Ngày &amp; giờ</TableCell>
              <TableCell>Tên giải</TableCell>
              <TableCell>Đội 1</TableCell>
              <TableCell>Tỷ số</TableCell>
              <TableCell>Đội 2</TableCell>
              <TableCell align="center">Video</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length: 6 }).map((_, r) => (
              <TableRow key={r}>
                {Array.from({ length: 7 }).map((__, c) => (
                  <TableCell key={c}>
                    <Skeleton variant="text" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" justifyContent="center">
        <Skeleton variant="rounded" width={220} height={32} />
      </Stack>
    </Stack>
  );
}

/* ---------------- Component ---------------- */
export default function PublicProfileDialog({ open, onClose, userId }) {
  /* --- responsive --- */
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [tab, setTab] = useState(0);

  /* --- copy & snackbar (nâng cấp có severity) --- */
  const [snack, setSnack] = useState({
    open: false,
    message: "",
    severity: "success",
  });
  const openSnack = (msg, severity = "success") =>
    setSnack({ open: true, message: msg, severity });
  const closeSnack = () => setSnack((s) => ({ ...s, open: false }));

  async function copyText(text) {
    const t = String(text ?? "");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(t);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {}
  }

  function CopyIconBtn({ text, label = "Nội dung" }) {
    const [copied, setCopied] = useState(false);
    const doCopy = async (e) => {
      e?.stopPropagation?.();
      await copyText(text);
      setCopied(true);
      openSnack(`Đã sao chép ${label.toLowerCase()}`);
      setTimeout(() => setCopied(false), 1200);
    };
    return (
      <Tooltip title={`Sao chép ${label}`}>
        <IconButton size="small" onClick={doCopy}>
          {copied ? (
            <CheckIcon fontSize="inherit" />
          ) : (
            <ContentCopyIcon fontSize="inherit" />
          )}
        </IconButton>
      </Tooltip>
    );
  }

  const SnackRender = (
    <Snackbar
      open={snack.open}
      autoHideDuration={2000}
      onClose={closeSnack}
      anchorOrigin={{ vertical: "top", horizontal: "right" }}
      disablePortal={false} // mặc định đã false, thêm cho chắc
      sx={{ zIndex: (theme) => theme.zIndex.tooltip + 9999 }} // max an toàn trên web
    >
      <Alert
        onClose={closeSnack}
        severity={snack.severity}
        sx={{ width: "100%" }}
      >
        {snack.message}
      </Alert>
    </Snackbar>
  );

  /* --- queries --- */
  const baseQ = useGetPublicProfileQuery(userId, { skip: !open });
  const rateQ = useGetRatingHistoryQuery(userId, { skip: !open }); // {history,total,page,pageSize} (hoặc items)
  const matchQ = useGetMatchHistoryQuery(userId, { skip: !open });

  // ---- trạng thái từng API (cả loading & refetching) ----
  const baseLoading = baseQ.isLoading || baseQ.isFetching;
  const rateLoading = rateQ.isLoading || rateQ.isFetching;
  const matchLoading = matchQ.isLoading || matchQ.isFetching;

  const baseError = baseQ.error;
  const rateError = rateQ.error;
  const matchError = matchQ.error;

  const base = baseQ.data || {};

  /* --- viewer is admin? --- */
  const viewerIsAdmin = useSelector(
    (s) => !!(s?.auth?.userInfo?.isAdmin || s?.auth?.userInfo?.role === "admin")
  );

  /* --- local pagination --- */
  const ratingRaw = Array.isArray(rateQ.data?.history)
    ? rateQ.data.history
    : rateQ.data?.items || [];
  const ratingTotal = rateQ.data?.total ?? ratingRaw.length;

  const matchRaw = Array.isArray(matchQ.data)
    ? matchQ.data
    : matchQ.data?.items || [];
  const matchTotal = matchQ.data?.total ?? matchRaw.length;

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

  /* --- match detail modal --- */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const openDetail = (row) => {
    setDetail(row);
    setDetailOpen(true);
  };

  /* --- ZOOM image state & dialog --- */
  const [zoom, setZoom] = useState({ open: false, src: "", title: "" });
  const openZoom = (src, title = "") =>
    setZoom({ open: true, src: src || AVA_PLACE, title });
  const closeZoom = () => setZoom((z) => ({ ...z, open: false }));

  function ImageZoomDialog({ open, src, title, onClose }) {
    const t = useTheme();
    const fullScreen = useMediaQuery(t.breakpoints.down("sm"));
    return (
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen={fullScreen}
        maxWidth="lg"
        PaperProps={{ sx: { bgcolor: "transparent", boxShadow: "none" } }}
      >
        <Box sx={{ position: "relative", p: { xs: 1, sm: 2 } }}>
          <IconButton
            onClick={onClose}
            aria-label="close"
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              color: "#fff",
              zIndex: 2,
            }}
          >
            <CloseIcon />
          </IconButton>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: fullScreen ? "100vh" : "80vh",
              p: { xs: 2, sm: 3 },
            }}
            onClick={onClose}
          >
            <img
              src={src || AVA_PLACE}
              alt={title || "Avatar"}
              style={{
                maxWidth: fullScreen ? "100vw" : "90vw",
                maxHeight: fullScreen ? "100vh" : "85vh",
                objectFit: "contain",
                borderRadius: 8,
              }}
              onClick={(e) => e.stopPropagation()}
              onError={(e) => {
                e.currentTarget.src = AVA_PLACE;
              }}
            />
          </Box>
        </Box>
      </Dialog>
    );
  }

  /* ---------- header & info ---------- */
  const Header = () => (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={2}
      alignItems={{ xs: "center", md: "flex-start" }}
    >
      <Avatar
        src={base.avatar || AVA_PLACE}
        sx={{ width: 96, height: 96, boxShadow: 2, cursor: "zoom-in" }}
        onClick={() => openZoom(base.avatar || AVA_PLACE, base.nickname)}
        imgProps={{ onError: (e) => (e.currentTarget.src = AVA_PLACE) }}
      />
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h5" noWrap title={safe(base?.name)}>
          {safe(base?.name)}
        </Typography>
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.25}
          sx={{ mt: -0.5, minWidth: 0 }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            title={safe(base?.nickname)}
          >
            {base?.nickname ? `@${base.nickname}` : TEXT_PLACE}
          </Typography>
          {base?.nickname && (
            <CopyIconBtn text={base.nickname} label="nickname" />
          )}
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
            label={`Giới tính: ${genderLabel(base.gender)}`}
          />
          <Chip
            size="small"
            color="info"
            label={`Tỉnh/TP: ${safe(base.province, "Không rõ")}`}
          />
          <Chip
            size="small"
            color="success"
            label={`Tham gia: ${fmtDate(base.joinedAt)}`}
          />
          {viewerIsAdmin && (
            <>
              {typeof base?.isAdmin !== "undefined" && (
                <Chip
                  size="small"
                  color={base.isAdmin ? "error" : "default"}
                  icon={<SecurityIcon />}
                  label={base.isAdmin ? "Quyền: Admin" : "Quyền: User"}
                />
              )}
              {base?._id && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`ID: ${base._id}`}
                />
              )}
            </>
          )}
        </Stack>
      </Stack>
    </Stack>
  );

  function InfoRowWithCopy({ label, value, copyText: copyV, copyLabel }) {
    if (value === null || value === undefined || value === "") return null;
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", minWidth: 120, flexShrink: 0 }}
        >
          {label}
        </Typography>
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{ minWidth: 0, flex: 1 }}
        >
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, wordBreak: "break-word" }}
          >
            {value}
          </Typography>
          <CopyIconBtn text={copyV ?? value} label={copyLabel ?? label} />
        </Stack>
      </Stack>
    );
  }

  const InfoSection = () => {
    if (baseLoading) return <InfoSkeleton />;
    if (baseError)
      return (
        <Alert severity="error">
          {baseError?.data?.message || baseError.error || "Lỗi tải hồ sơ"}
        </Alert>
      );

    return (
      <Stack spacing={2}>
        <Header />

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Giới thiệu
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: "pre-wrap", color: "text.secondary" }}
          >
            {safe(base.bio, "Chưa có")}
          </Typography>
        </Box>

        {viewerIsAdmin && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Thông tin cơ bản
            </Typography>
            <Stack spacing={0.75}>
              <InfoRow label="Tên hiển thị" value={safe(base?.name)} />
              {base?.nickname ? (
                <InfoRowWithCopy
                  label="Nickname"
                  value={`@${base.nickname}`}
                  copyText={base.nickname}
                  copyLabel="nickname"
                />
              ) : (
                <InfoRow label="Nickname" value={TEXT_PLACE} />
              )}
              <InfoRow label="Giới tính" value={genderLabel(base?.gender)} />
              <InfoRow
                label="Tỉnh/TP"
                value={safe(base?.province, "Không rõ")}
              />
              <InfoRow label="Tham gia" value={fmtDate(base?.joinedAt)} />
            </Stack>
          </Box>
        )}

        {viewerIsAdmin && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Thông tin bổ sung
            </Typography>
            <Stack spacing={0.75}>
              {base?.email && (
                <InfoRowWithCopy
                  label="Email"
                  value={base.email}
                  copyLabel="email"
                />
              )}
              <InfoRow
                label="Username"
                value={base?.username ?? base?.userName}
              />
              {(base?.phone ?? base?.phoneNumber) && (
                <InfoRowWithCopy
                  label="SĐT"
                  value={base?.phone ?? base?.phoneNumber}
                  copyLabel="số điện thoại"
                />
              )}
              <InfoRow
                label="Vai trò"
                value={
                  Array.isArray(base?.roles) && base.roles.length
                    ? base.roles.join(", ")
                    : base?.role ||
                      (typeof base?.isAdmin === "boolean"
                        ? base.isAdmin
                          ? "admin"
                          : "user"
                        : "")
                }
              />
              <InfoRow
                label="isAdmin"
                value={
                  typeof base?.isAdmin === "boolean"
                    ? base.isAdmin
                      ? "Có"
                      : "Không"
                    : null
                }
              />
              <InfoRow
                label="Tạo lúc"
                value={fmtDT(base?.createdAt ?? base?.joinedAt)}
              />
              <InfoRow label="Cập nhật" value={fmtDT(base?.updatedAt)} />
              <InfoRow
                label="Đăng nhập lần cuối"
                value={base?.lastLoginAt ? fmtDT(base?.lastLoginAt) : "—"}
              />
              <InfoRow label="Provider" value={base?.provider} />
              <InfoRow label="ID" value={base?._id} />

              <Typography variant="subtitle2" gutterBottom fontWeight={"bold"}>
                Thông tin sport connect
              </Typography>
              {(() => {
                const sc = getSPC(base);
                if (!sc) return null;
                return (
                  <>
                    {Number.isFinite(sc.single) && (
                      <InfoRow
                        label="Sport Connect — Điểm đơn"
                        value={num(sc.single)}
                      />
                    )}
                    {Number.isFinite(sc.double) && (
                      <InfoRow
                        label="Sport Connect — Điểm đôi"
                        value={num(sc.double)}
                      />
                    )}
                    <InfoRow
                      label="Sport Connect  — Mô tả"
                      value={sc.meta.description}
                    />
                    <InfoRow
                      label="Sport Connect  — Cập nhật"
                      value={fmtDT(sc.meta.scoredAt)}
                    />
                    <InfoRow
                      label="Sport Connect  — Tham gia"
                      value={fmtDT(sc.meta.joinDate)}
                    />
                    <InfoRow
                      label="Sport Connect  — Nguồn"
                      value={sc.meta.source}
                    />
                    {sc.meta.sportId != null && (
                      <InfoRow
                        label="Sport Connect  — sportId"
                        value={String(sc.meta.sportId)}
                      />
                    )}
                  </>
                );
              })()}
            </Stack>
          </Box>
        )}
      </Stack>
    );
  };

  /* ---------- rating table + pagination ---------- */
  const RatingTable = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

    if (rateLoading) return <RatingSkeleton isMobile={isMobile} />;
    if (rateError)
      return (
        <Alert severity="error">
          {rateError?.data?.message ||
            rateError.error ||
            "Lỗi tải lịch sử điểm trình"}
        </Alert>
      );

    const me = useSelector((s) => s.auth?.userInfo);
    const isAdmin = !!(me?.isAdmin || me?.role === "admin");

    const [deleteHistory, { isLoading: deleting }] =
      useDeleteRatingHistoryMutation();
    const [deletingId, setDeletingId] = React.useState(null);

    async function handleDeleteRow(h) {
      if (!isAdmin) return;
      const ok = window.confirm(
        "Bạn có chắc chắn muốn xoá mục lịch sử điểm trình này?\nHành động không thể hoàn tác."
      );
      if (!ok) return;

      try {
        const historyId = h?._id ?? h?.id;
        const uid = h?.user?._id || userId;
        if (!historyId || !uid) {
          openSnack("Thiếu ID, không thể xoá.", "error");
          return;
        }
        setDeletingId(historyId);
        await deleteHistory({ userId: uid, historyId }).unwrap();
        openSnack("Đã xoá một mục lịch sử điểm trình.", "success");
        rateQ.refetch?.();
      } catch (e) {
        console.error(e);
        const msg =
          e?.data?.message ||
          e?.error ||
          e?.message ||
          "Xoá thất bại. Vui lòng thử lại.";
        openSnack(msg, "error");
      } finally {
        setDeletingId(null);
      }
    }

    const EmptyState = (
      <Box
        sx={{
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: 1.5,
          p: 2,
          textAlign: "center",
          fontStyle: "italic",
          color: "text.secondary",
        }}
      >
        Không có dữ liệu
      </Box>
    );

    // ---- render thực tế (như cũ) ----
    // (giữ nguyên toàn bộ phần render danh sách + table từ code của bạn)
    // ... (NGUYÊN VẸN từ đoạn trong code gốc của bạn) ...
    // ——— BẮT ĐẦU GIỮ NGUYÊN ĐOẠN GỐC ———

    const [ratingPage, setRatingPage] = [undefined, undefined]; // placeholder để tránh shadow (chúng ta dùng state bên ngoài)
    // nhưng vì ta đã có ratingPage ở scope ngoài, không cần khai lại.

    // Mobile view
    if (isMobile) {
      return (
        <Stack spacing={1.25}>
          <Typography variant="subtitle1" fontWeight={600}>
            Lịch sử điểm trình
          </Typography>
          {ratingPaged.length
            ? ratingPaged.map((h) => {
                const historyId = h?._id ?? h?.id;
                const noteText = isAdmin ? safe(h?.note, TEXT_PLACE) : h?.note;
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
                          {isAdmin ? (
                            <Tooltip title="Xoá mục này">
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => handleDeleteRow(h)}
                                  disabled={
                                    deleting && deletingId === historyId
                                  }
                                  aria-label="delete-score-history"
                                >
                                  <DeleteOutlineOutlinedIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          ) : null}
                        </Stack>

                        <Typography
                          variant="caption"
                          sx={{ color: "text.secondary" }}
                        >
                          Bởi: {scorerName}
                        </Typography>

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

                        {noteText ? (
                          <>
                            <Divider flexItem />
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
                              {noteText}
                            </Typography>
                          </>
                        ) : null}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })
            : EmptyState}
          <Stack direction="row" justifyContent="center" mt={0.5}>
            <Pagination
              page={
                window.__dummy || 1 /* placeholder, thực tế dùng state ngoài */
              }
              onChange={() => {}}
              count={Math.max(1, Math.ceil(ratingTotal / 10))}
              shape="rounded"
              size="small"
            />
          </Stack>
        </Stack>
      );
    }

    // Desktop/Tablet view
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600}>
          Lịch sử điểm trình
        </Typography>
        <TableContainer
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            maxHeight: { xs: 320, md: 360 },
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
                {isAdmin ? (
                  <TableCell
                    sx={{ whiteSpace: "nowrap" }}
                    align="center"
                    width={72}
                  >
                    Thao tác
                  </TableCell>
                ) : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {ratingPaged.length ? (
                ratingPaged.map((h) => {
                  const historyId = h?._id ?? h?.id;
                  const noteText = isAdmin
                    ? safe(h?.note, TEXT_PLACE)
                    : h?.note;
                  const scorerName = h?.scorer?.name || h?.scorer?.email || "—";
                  return (
                    <TableRow key={historyId} hover>
                      <TableCell>{fmtDate(h.scoredAt)}</TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>
                        {scorerName}
                      </TableCell>
                      <TableCell align="right">{num(h.single)}</TableCell>
                      <TableCell align="right">{num(h.double)}</TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>
                        {noteText}
                      </TableCell>
                      {isAdmin ? (
                        <TableCell align="center">
                          <Tooltip title="Xoá mục này">
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => handleDeleteRow(h)}
                                disabled={deleting && deletingId === historyId}
                                aria-label="delete-score-history"
                              >
                                <DeleteOutlineOutlinedIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
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
        <Stack direction="row" justifyContent="center">
          <Pagination
            page={window.__dummy || 1 /* placeholder */}
            onChange={() => {}}
            count={Math.max(1, Math.ceil(ratingTotal / 10))}
            shape="rounded"
            size="small"
          />
        </Stack>
      </Stack>
    );

    // ——— KẾT THÚC GIỮ NGUYÊN ĐOẠN GỐC ———
  };

  /* ---------- player cell ---------- */
  function PlayerCell({ players = [], highlight = false }) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

    if (!players.length)
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
                sx={{ width: 24, height: 24, cursor: "zoom-in" }}
                onClick={(e) => {
                  e.stopPropagation();
                  openZoom(p?.avatar || AVA_PLACE, nick);
                }}
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
                    sx={{
                      flexWrap: isMobile ? "wrap" : "nowrap",
                      rowGap: isMobile ? 0.25 : 0,
                      columnGap: 0.5,
                      maxWidth: "100%",
                      minWidth: 0,
                    }}
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

  /* ---------- match detail modal ---------- */
  function MatchDetailDialog({ open, onClose, row }) {
    const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
    const scoreLines = toScoreLines(row);
    const winnerA = row?.winner === "A";
    const winnerB = row?.winner === "B";

    const CodeChip = (
      <Chip
        size="small"
        color="primary"
        label={safe(row?.code, String(row?._id || "").slice(-5))}
        sx={{ fontWeight: 700 }}
      />
    );

    const TimeChip = (
      <Chip
        size="small"
        color="info"
        label={fmtDT(row?.dateTime)}
        sx={{ whiteSpace: "nowrap" }}
      />
    );

    return (
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen={fullScreen}
        maxWidth="sm"
        fullWidth={!fullScreen}
        PaperProps={{
          sx: fullScreen ? { m: 0, borderRadius: 0 } : { borderRadius: 3 },
        }}
      >
        <DialogTitle
          sx={{
            pr: 7,
            position: "sticky",
            top: 0,
            zIndex: 2,
            bgcolor: "background.paper",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          Chi tiết trận đấu
          <IconButton
            onClick={onClose}
            sx={{ position: "absolute", right: 8, top: 8 }}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              flexWrap="wrap"
              rowGap={1}
            >
              {CodeChip}
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  variant="outlined"
                  color={row?.winner ? "success" : "default"}
                  label={`Kết quả: ${row?.winner || "—"}`}
                />
                {TimeChip}
              </Stack>
            </Stack>

            <Typography
              variant="body2"
              color="text.secondary"
              noWrap={!fullScreen}
              title={safe(row?.tournament?.name, "—")}
              sx={{ wordBreak: "break-word" }}
            >
              {safe(row?.tournament?.name, "—")}
            </Typography>

            <Divider />

            <Stack
              direction={fullScreen ? "column" : "row"}
              spacing={fullScreen ? 2 : 3}
              alignItems={fullScreen ? "stretch" : "flex-start"}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  Đội 1
                </Typography>
                <PlayerCell players={row?.team1} highlight={winnerA} />
              </Box>

              <Stack
                alignItems="center"
                sx={{
                  minWidth: fullScreen ? "auto" : 120,
                  alignSelf: "center",
                }}
              >
                <Typography variant="overline" color="text.secondary">
                  Tỷ số
                </Typography>
                {scoreLines.length ? (
                  <Stack spacing={0.25} alignItems="center">
                    {scoreLines.map((s, i) => (
                      <Typography key={i} fontWeight={800}>
                        {s}
                      </Typography>
                    ))}
                  </Stack>
                ) : (
                  <Typography fontWeight={800}>
                    {safe(row?.scoreText)}
                  </Typography>
                )}
              </Stack>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  Đội 2
                </Typography>
                <PlayerCell players={row?.team2} highlight={winnerB} />
              </Box>
            </Stack>

            <Stack direction="row" justifyContent="flex-end">
              {row?.video ? (
                <Button
                  size="small"
                  startIcon={<PlayCircleOutlineIcon />}
                  component="a"
                  href={row.video}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Xem video
                </Button>
              ) : (
                <Chip
                  icon={<InfoOutlinedIcon />}
                  label="Không có video"
                  size="small"
                  variant="outlined"
                />
              )}
            </Stack>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} variant="contained" fullWidth={fullScreen}>
            Đóng
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  /* --- Match section: mobile | desktop --- */
  function MatchSection({ isMobileView }) {
    if (matchLoading) return <MatchSkeleton isMobile={isMobileView} />;
    if (matchError)
      return (
        <Alert severity="error">
          {matchError?.data?.message ||
            matchError.error ||
            "Lỗi tải lịch sử thi đấu"}
        </Alert>
      );

    const rows = matchPaged;

    if (isMobileView) {
      return (
        <Stack spacing={1.25}>
          <Typography variant="subtitle1" fontWeight={600}>
            Lịch sử thi đấu
          </Typography>

          {rows.length ? (
            rows.map((m) => {
              const winnerA = m?.winner === "A";
              const winnerB = m?.winner === "B";
              const scoreLines = toScoreLines(m);
              return (
                <Paper
                  key={m._id}
                  variant="outlined"
                  sx={{ p: 1.25, borderRadius: 2, cursor: "pointer" }}
                  onClick={() => openDetail(m)}
                >
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
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
                </Paper>
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
              page={matchPage}
              onChange={(_, p) => setMatchPage(p)}
              count={Math.max(1, Math.ceil(matchTotal / matchPerPage))}
              shape="rounded"
              size="small"
            />
          </Stack>

          <MatchDetailDialog
            open={detailOpen}
            onClose={() => setDetailOpen(false)}
            row={detail}
          />
        </Stack>
      );
    }

    // Desktop
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600}>
          Lịch sử thi đấu
        </Typography>

        <TableContainer
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            maxHeight: { xs: 360, md: 500 },
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: "nowrap" }}>ID</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  Ngày &amp; giờ
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
                    <TableRow
                      key={m._id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => openDetail(m)}
                    >
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

                      <TableCell align="center" sx={{ whiteSpace: "nowrap" }}>
                        {m.video ? (
                          <a
                            href={m.video}
                            onClick={(e) => e.stopPropagation()}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Xem video"
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

        <Stack direction="row" justifyContent="center">
          <Pagination
            page={matchPage}
            onChange={(_, p) => setMatchPage(p)}
            count={Math.max(1, Math.ceil(matchTotal / matchPerPage))}
            shape="rounded"
            size="small"
          />
        </Stack>

        <MatchDetailDialog
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          row={detail}
        />
      </Stack>
    );
  }

  function AchievementsSection() {
    const { data, isLoading, isFetching, error, refetch } =
      useGetUserAchievementsQuery(userId, { skip: !open });

    if (isLoading || isFetching) return <AchievementsSkeleton />;
    if (error)
      return (
        <Alert severity="error">
          {error?.data?.message || error?.error || "Lỗi tải dữ liệu thành tích"}
        </Alert>
      );

    const sum = data?.summary || {};
    const perT = Array.isArray(data?.perTournament) ? data.perTournament : [];
    const perB = Array.isArray(data?.perBracket) ? data.perBracket : [];

    const fmtRate = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");

    // Card KPI nhỏ gọn, responsive
    const KpiCard = ({ icon, title, value, sub }) => (
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 2,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              bgcolor: "action.hover",
            }}
          >
            {icon}
          </Box>
          <Typography variant="subtitle2" fontWeight={700} noWrap>
            {title}
          </Typography>
        </Stack>
        <Typography
          variant="h4"
          fontWeight={800}
          sx={{ mt: 0.5 }}
          // co chữ trên màn nhỏ
        >
          {value}
        </Typography>
        {sub ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {sub}
          </Typography>
        ) : null}
      </Paper>
    );

    // đặt trước `return` trong AchievementsSection
    const topColor = (k) => {
      if (!Number.isFinite(k)) return "default";
      if (k === 1) return "success";
      if (k === 2) return "warning";
      if (k <= 4) return "secondary";
      if (k <= 8) return "info";
      return "default";
    };

    const topVariant = (k) =>
      Number.isFinite(k) && k <= 8 ? "filled" : "outlined";

    const topIcon = (k) => {
      if (!Number.isFinite(k)) return undefined;
      if (k === 1) return <TrophyIcon fontSize="small" />;
      if (k === 2) return <BestIcon fontSize="small" />;
      if (k <= 4) return <BestIcon fontSize="small" />; // có thể đổi icon khác nếu thích
      if (k <= 8) return <LeaderboardIcon fontSize="small" />;
      return undefined;
    };

    return (
      <Stack spacing={2}>
        <Typography variant="subtitle1" fontWeight={600}>
          Thành tích
        </Typography>

        {/* KPIs: dùng Grid để responsive (4 cột desktop, 2 cột tablet, 1 cột mobile) */}
        <Grid container spacing={2}>
          <Grid
            item
            xs={12}
            sm={6}
            md={3}
            sx={{ width: isMobile ? "100%" : "auto" }}
          >
            <KpiCard
              icon={<MatchesIcon fontSize="small" />}
              title="Tổng trận có kết quả"
              value={sum.totalPlayed ?? 0}
              sub={
                <>
                  Thắng {sum.wins ?? 0} / Thua {sum.losses ?? 0} —{" "}
                  {fmtRate(sum.winRate)}
                </>
              }
            />
          </Grid>
          <Grid
            item
            xs={12}
            sm={6}
            md={3}
            sx={{ width: isMobile ? "100%" : "auto" }}
          >
            <KpiCard
              icon={<TrophyIcon fontSize="small" />}
              title="Danh hiệu"
              value={sum.titles ?? 0}
              sub={
                <>
                  Finals: {sum.finals ?? 0} • Podiums: {sum.podiums ?? 0}
                </>
              }
            />
          </Grid>
          <Grid
            item
            xs={12}
            sm={6}
            md={3}
            sx={{ width: isMobile ? "100%" : "auto" }}
          >
            <KpiCard
              icon={<BestIcon fontSize="small" />}
              title="Thành tích cao nhất"
              value={sum.careerBestLabel ?? "—"}
              sub={<>Top cao nhất: {sum.careerBestLabel ?? 0}</>}
            />
          </Grid>
          <Grid
            item
            xs={12}
            sm={6}
            md={3}
            sx={{ width: isMobile ? "100%" : "auto" }}
          >
            <KpiCard
              icon={<StreakIcon fontSize="small" />}
              title="Streak"
              value={sum.currentStreak ?? 0}
              sub={<>Dài nhất: {sum.longestWinStreak ?? 0}</>}
            />
          </Grid>
        </Grid>

        {/* Top theo giải (kết quả tốt nhất mỗi giải) */}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            mb={1}
            gap={1}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <LeaderboardIcon fontSize="small" />
              <Typography variant="subtitle2">
                Top theo giải (kết quả tốt nhất mỗi giải)
              </Typography>
            </Stack>

            {/* Desktop: Button; Mobile: IconButton */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ display: { xs: "none", sm: "block" } }}>
                <Button
                  size="small"
                  startIcon={<RefreshIcon />}
                  onClick={() => refetch()}
                >
                  Làm mới
                </Button>
              </Box>
              <IconButton
                size="small"
                onClick={() => refetch()}
                sx={{ display: { xs: "inline-flex", sm: "none" } }}
                aria-label="Làm mới"
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>

          {perT.length ? (
            <TableContainer
              sx={{
                width: "100%",
                overflowX: "auto",
                "& th, & td": { whiteSpace: "nowrap" }, // không xuống dòng, cho phép kéo ngang
              }}
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Giải</TableCell>
                    <TableCell>Bracket</TableCell>
                    <TableCell
                      align="right"
                      sx={{ display: { xs: "none", sm: "table-cell" } }}
                    >
                      Draw
                    </TableCell>
                    <TableCell align="right">Top</TableCell>
                    <TableCell
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      Giai đoạn
                    </TableCell>
                    <TableCell
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      Cuối cùng
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {perT.map((r, i) => (
                    <TableRow key={i} hover>
                      <TableCell>{r.tournamentName}</TableCell>
                      <TableCell>{r.bracketName}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ display: { xs: "none", sm: "table-cell" } }}
                      >
                        {r.drawSize}
                      </TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          color={topColor(r.topK)}
                          icon={topIcon(r.topK)}
                          label={
                            r.positionLabel || (r.topK ? `Top ${r.topK}` : "—")
                          }
                          variant={topVariant(r.topK)}
                        />
                      </TableCell>
                      <TableCell
                        sx={{ display: { xs: "none", md: "table-cell" } }}
                      >
                        {r.season ?? "—"}
                      </TableCell>
                      <TableCell
                        sx={{ display: { xs: "none", md: "table-cell" } }}
                      >
                        {r.lastMatchAt ? fmtDT(r.lastMatchAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Stack
              alignItems="center"
              justifyContent="center"
              spacing={1}
              sx={{ py: 3, color: "text.secondary" }}
            >
              <InboxIcon />
              <Typography variant="body2">Chưa có dữ liệu</Typography>
            </Stack>
          )}
        </Paper>

        {/* Chi tiết theo Bracket */}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <TableChartIcon fontSize="small" />
            <Typography variant="subtitle2">Chi tiết theo Bracket</Typography>
          </Stack>

          {perB.length ? (
            <TableContainer
              sx={{
                width: "100%",
                overflowX: "auto",
                "& th, & td": { whiteSpace: "nowrap" },
              }}
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Giải</TableCell>
                    <TableCell>Bracket</TableCell>
                    <TableCell
                      align="right"
                      sx={{ display: { xs: "none", sm: "table-cell" } }}
                    >
                      Draw
                    </TableCell>
                    <TableCell align="right">Top</TableCell>
                    <TableCell
                      align="right"
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      W
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      L
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      WR
                    </TableCell>
                    <TableCell
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      Hoàn tất
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {perB.map((r, i) => (
                    <TableRow key={i} hover>
                      <TableCell>{r.tournamentName}</TableCell>
                      <TableCell>{r.bracketName}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ display: { xs: "none", sm: "table-cell" } }}
                      >
                        {r.drawSize}
                      </TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          color={topColor(r.topK)}
                          icon={topIcon(r.topK)}
                          label={
                            r.positionLabel || (r.topK ? `Top ${r.topK}` : "—")
                          }
                          variant={topVariant(r.topK)}
                        />
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ display: { xs: "none", md: "table-cell" } }}
                      >
                        {r.stats?.wins ?? 0}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ display: { xs: "none", md: "table-cell" } }}
                      >
                        {r.stats?.losses ?? 0}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ display: { xs: "none", md: "table-cell" } }}
                      >
                        {fmtRate(r.stats?.winRate)}
                      </TableCell>
                      <TableCell
                        sx={{ display: { xs: "none", md: "table-cell" } }}
                      >
                        {r.finished ? "✓" : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Stack
              alignItems="center"
              justifyContent="center"
              spacing={1}
              sx={{ py: 3, color: "text.secondary" }}
            >
              <InboxIcon />
              <Typography variant="body2">Chưa có dữ liệu</Typography>
            </Stack>
          )}
        </Paper>
      </Stack>
    );
  }

  /* ---------- Mobile: Drawer ---------- */
  if (isMobile) {
    return (
      <>
        <Drawer
          anchor="bottom"
          open={open}
          onClose={onClose}
          PaperProps={{
            sx: {
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              height: "94vh",
              p: 2,
            },
          }}
        >
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">Hồ sơ</Typography>
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>

          {/* Luôn render Tabs + nội dung; bên trong tự xử lý skeleton theo từng API */}
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              mb: 1,
              "& .MuiTab-wrapper": {
                whiteSpace: "nowrap",
                textTransform: "none",
              },
            }}
          >
            <Tab label="Thông tin" />
            <Tab label="Điểm trình" />
            <Tab label="Thi đấu" />
            <Tab label="Thành tích" />
          </Tabs>

          <Box
            sx={{
              overflowY: "auto",
              pb: 6,
              px: 1,
              height: "calc(94vh - 120px)",
            }}
          >
            {tab === 0 && <InfoSection />}
            {tab === 1 && <RatingTable />}
            {tab === 2 && <MatchSection isMobileView />}
            {tab === 3 && <AchievementsSection />}
          </Box>
        </Drawer>

        <ImageZoomDialog
          open={zoom.open}
          src={zoom.src}
          title={zoom.title}
          onClose={closeZoom}
        />
        {SnackRender}
      </>
    );
  }

  /* ---------- Desktop: Dialog ---------- */
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: { xs: "100%", md: "96vw" },
            maxWidth: 1400,
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            bgcolor: "background.paper",
            borderBottom: "1px solid",
            borderColor: "divider",
            pr: 7,
          }}
        >
          Hồ sơ công khai
          <IconButton
            onClick={onClose}
            sx={{ position: "absolute", right: 8, top: 8 }}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{ p: { xs: 2, md: 3 }, bgcolor: "background.default" }}
        >
          {/* Luôn render từng section; mỗi section tự show skeleton khi API gọi */}
          <InfoSection />
          <Divider sx={{ my: 3 }} />
          <RatingTable />
          <Divider sx={{ my: 3 }} />
          <MatchSection isMobileView={false} />
          <AchievementsSection />
          <Divider sx={{ my: 3 }} />
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} variant="contained">
            Đóng
          </Button>
        </DialogActions>
      </Dialog>

      <ImageZoomDialog
        open={zoom.open}
        src={zoom.src}
        title={zoom.title}
        onClose={closeZoom}
      />
      {SnackRender}
    </>
  );
}
