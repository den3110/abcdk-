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
  CircularProgress,
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
import { useSelector } from "react-redux";

import {
  useGetPublicProfileQuery,
  useGetRatingHistoryQuery,
  useGetMatchHistoryQuery,
  useDeleteRatingHistoryMutation,
} from "../slices/usersApiSlice";

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
  Number.isFinite(v) ? v.toFixed(digits) : TEXT_PLACE;

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

/* --------- score helpers: chuyển "11-9, 8-11, 11-7" => mảng dòng --------- */
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
  );

  /* --- queries --- */
  const baseQ = useGetPublicProfileQuery(userId, { skip: !open });
  const rateQ = useGetRatingHistoryQuery(userId, { skip: !open }); // response: {history, total, page, pageSize}
  const matchQ = useGetMatchHistoryQuery(userId, { skip: !open });

  const loading = baseQ.isLoading || rateQ.isLoading || matchQ.isLoading;
  const error = baseQ.error || rateQ.error || matchQ.error;
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

  const InfoSection = () => (
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
            <InfoRow label="Tỉnh/TP" value={safe(base?.province, "Không rõ")} />
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
              value={base?.lastLogin ? fmtDT(base?.lastLogin) : "—"}
            />
            <InfoRow label="Provider" value={base?.provider} />
            <InfoRow label="ID" value={base?._id} />
          </Stack>
        </Box>
      )}
    </Stack>
  );

  /* ---------- rating table + pagination ---------- */
  const RatingTable = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

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
        const uid = h?.user?._id || userId; // ưu tiên id từ item, fallback prop
        if (!historyId || !uid) {
          openSnack("Thiếu ID, không thể xoá.", "error");
          return;
        }
        setDeletingId(historyId);

        // DELETE /api/users/:userId/rating-history/:historyId
        await deleteHistory({ userId: uid, historyId }).unwrap();

        openSnack("Đã xoá một mục lịch sử điểm trình.", "success");

        // Chủ động gọi lại list (ngoài invalidatesTags)
        rateQ.refetch?.();

        // Optional: nếu đang ở trang > 1 và trang hiện tại rỗng sau xoá, có thể lùi trang:
        // setRatingPage((prev) => Math.max(1, Math.min(prev, Math.ceil((ratingTotal-1)/ratingPerPage))));
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

    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600}>
          Lịch sử điểm trình
        </Typography>

        {/* Mobile: card list */}
        {isMobile ? (
          <Stack spacing={1.25}>
            {ratingPaged.length
              ? ratingPaged.map((h) => {
                  const historyId = h?._id ?? h?.id;
                  const noteText = isAdmin
                    ? safe(h?.note, TEXT_PLACE)
                    : "Mod PickleTour chấm trình";
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
          </Stack>
        ) : (
          // Desktop/Tablet: table
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
                      : "Mod PickleTour chấm trình";
                    const scorerName =
                      h?.scorer?.name || h?.scorer?.email || "—";
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
                                  disabled={
                                    deleting && deletingId === historyId
                                  }
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
                      colSpan={isAdmin ? 6 : 5}
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
        )}

        <Stack direction="row" justifyContent="center">
          <Pagination
            page={ratingPage}
            onChange={(_, p) => setRatingPage(p)}
            count={Math.max(1, Math.ceil(ratingTotal / ratingPerPage))}
            shape="rounded"
            size="small"
          />
        </Stack>
      </Stack>
    );
  };

  /* ---------- player cell: chỉ hiển thị NICKNAME ---------- */
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

          {loading ? (
            <Box mt={3} textAlign="center">
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error" sx={{ mt: 3 }}>
              {error?.data?.message || error.error || "Lỗi tải dữ liệu"}
            </Alert>
          ) : (
            <>
              <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                variant="fullWidth"
                sx={{ mb: 1 }}
              >
                <Tab label="Thông tin" />
                <Tab label="Điểm trình" />
                <Tab label="Thi đấu" />
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
              </Box>
            </>
          )}
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
          {loading ? (
            <Stack spacing={2}>
              <Skeleton variant="circular" width={96} height={96} />
              <Skeleton variant="rectangular" height={220} />
              <Skeleton variant="rectangular" height={320} />
            </Stack>
          ) : error ? (
            <Alert severity="error">
              {error?.data?.message || error.error || "Lỗi tải dữ liệu"}
            </Alert>
          ) : (
            <>
              <InfoSection />
              <Divider sx={{ my: 3 }} />
              <RatingTable />
              <Divider sx={{ my: 3 }} />
              <MatchSection isMobileView={false} />
            </>
          )}
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
