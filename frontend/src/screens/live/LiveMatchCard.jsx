// LiveMatchCard.jsx — Card auto-stretches to tallest item in row (MUI Grid alignItems="stretch")
// Lưu ý: Ở parent Grid hãy dùng: <Grid container spacing={2} alignItems="stretch">
// và mỗi Grid item dùng sx={{ display: 'flex' }} để Card (flex:1) cao bằng item dài nhất.

import React from "react";
import {
  Card,
  Box,
  Stack,
  Typography,
  Chip,
  Button,
  IconButton,
  Tooltip,
  Divider,
  Popover,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import YouTubeIcon from "@mui/icons-material/YouTube";
import FacebookIcon from "@mui/icons-material/Facebook";
import VideocamIcon from "@mui/icons-material/Videocam";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";

/* ───────────────────── Hook: fallback ảnh ───────────────────── */
function useImageFallback(candidates = []) {
  const list = React.useMemo(
    () => (Array.isArray(candidates) ? candidates.filter(Boolean) : []),
    [candidates]
  );
  const [idx, setIdx] = React.useState(0);
  const src = list[idx] || null;
  const onError = () => setIdx((i) => i + 1);
  return { src, onError, hasMore: idx < list.length - 1 };
}

/* ───────────────────── Helpers ───────────────────── */
function timeAgo(date) {
  if (!date) return "";
  const d = new Date(date);
  const diff = Math.max(0, Date.now() - d.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h trước`;
  const day = Math.floor(hr / 24);
  return `${day}d trước`;
}

const providerMeta = (p) =>
  p === "youtube"
    ? { label: "YouTube", icon: <YouTubeIcon />, color: "error" }
    : p === "facebook"
    ? { label: "Facebook", icon: <FacebookIcon />, color: "primary" }
    : { label: p || "Stream", icon: <VideocamIcon />, color: "secondary" };

const byPriority = (a, b) =>
  (({ youtube: 1, facebook: 2 }[a.provider] || 99) -
  ({ youtube: 1, facebook: 2 }[b.provider] || 99));

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Parse VT/VBT: "V{v}-T{t}" hoặc "V{v}-B{b}-T{t}"
function parseVT(code) {
  if (!code) return { v: null, b: null, t: null };
  const m1 = String(code).match(/^V(\d+)-T(\d+)$/i);
  if (m1) return { v: Number(m1[1]), b: null, t: Number(m1[2]) };
  const m2 = String(code).match(/^V(\d+)-B(\d+)-T(\d+)$/i);
  if (m2) return { v: Number(m2[1]), b: Number(m2[2]), t: Number(m2[3]) };
  return { v: null, b: null, t: null };
}

/* Việt hoá trạng thái (GIỮ nguyên "LIVE") */
const VI_STATUS_LABELS = {
  scheduled: "Đã lên lịch",
  queued: "Chờ thi đấu",
  assigned: "Đã gán sân",
  finished: "Đã kết thúc",
  ended: "Đã kết thúc",
  paused: "Tạm dừng",
  canceled: "Đã hủy",
};
function viStatus(s) {
  if (!s) return "-";
  const key = String(s).toLowerCase();
  if (key === "live") return "LIVE"; // giữ nguyên LIVE (global)
  return VI_STATUS_LABELS[key] || s;
}

/* YouTube utils cho FE fallback khi chưa có thumbnails từ server */
function parseYouTubeId(url = "") {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.split("/").filter(Boolean)[0] || null;
    }
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    // /embed/<id> hoặc /shorts/<id>
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "embed" && parts[1]) return parts[1];
    if (parts[0] === "shorts" && parts[1]) return parts[1];
    return null;
  } catch {
    return null;
  }
}
function ytThumbCandidates(videoId) {
  if (!videoId) return [];
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault_live.jpg`,
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];
}

/* ───────────────────── Component ───────────────────── */
export default function LiveMatchCard({ item }) {
  const theme = useTheme();
  const smDown = useMediaQuery(theme.breakpoints.down("sm"));

  const m = item?.match || {};
  const sessionsAll = Array.isArray(item?.sessions) ? item.sessions : [];
  const sessions = sessionsAll
    .filter((s) => s.platformVerified && s.watchUrl)
    .sort(byPriority);

  const primary = sessions[0] || null;
  const secondary = sessions.slice(1);
  const secVisible = secondary.slice(0, 2);
  const secMore = secondary.length - secVisible.length;

  const isLive =
    String(m?.status || "").toLowerCase() === "live" || sessions.length > 0;
  const hasAny = sessionsAll.length > 0;

  // Snackbar
  const [snack, setSnack] = React.useState({
    open: false,
    message: "",
    severity: "success",
  });
  const closeSnack = (_e, reason) => {
    if (reason === "clickaway") return;
    setSnack((s) => ({ ...s, open: false }));
  };
  const copy = async (txt, msg = "Đã copy vào clipboard!") => {
    try {
      await navigator.clipboard.writeText(txt);
      setSnack({ open: true, message: msg, severity: "success" });
    } catch {
      setSnack({
        open: true,
        message: "Copy không thành công!",
        severity: "error",
      });
    }
  };

  const vt = parseVT(m.code);
  const primaryHost = primary?.watchUrl ? hostOf(primary.watchUrl) : "";

  // Info Popover/Dialog
  const [infoAnchor, setInfoAnchor] = React.useState(null);
  const openInfo = (e) => setInfoAnchor(e.currentTarget);
  const closeInfo = () => setInfoAnchor(null);

  // Secondary list popover
  const [moreAnchor, setMoreAnchor] = React.useState(null);
  const openMore = (e) => setMoreAnchor(e.currentTarget);
  const closeMore = () => setMoreAnchor(null);

  const bullet = (
    <Box component="span" sx={{ mx: 1, color: "text.disabled" }}>
      •
    </Box>
  );

  /* ─────────── Ảnh: lấy từ session.thumbnails hoặc YouTube fallback ─────────── */
  const providedThumbs = Array.isArray(primary?.thumbnails)
    ? primary.thumbnails
    : [];
  let autoThumbs = [];
  if (primary?.provider === "youtube") {
    const yid =
      primary.platformLiveId || parseYouTubeId(primary.watchUrl || "");
    if (yid) autoThumbs = ytThumbCandidates(yid);
  }
  const heroCandidates = [...providedThumbs, ...autoThumbs];
  const { src: heroSrc, onError: heroErr } = useImageFallback(heroCandidates);

  return (
    <>
      {/* Root box cho phép Card kéo full chiều cao khi parent Grid item là display:flex */}
      <Box
        sx={{
          display: "flex",
          alignItems: "stretch",
          minWidth: 0,
          width: "100%",
        }}
      >
        <Card
          variant="outlined"
          sx={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            borderRadius: 2,
            // KHÔNG đặt overflow hidden ở Card để tránh cắt nội dung
            minWidth: 0,
            flex: 1, // ✅ để Card fill chiều cao Grid item
            alignSelf: "stretch", // ✅ kéo full chiều cao hàng
            "&:hover": { boxShadow: 3, borderColor: "divider" },
          }}
        >
          {/* Thumbnail (nếu có) */}
          {heroSrc && (
            <Box
              sx={{
                position: "relative",
                aspectRatio: "16 / 9",
                bgcolor: "action.hover",
                borderBottom: "1px solid",
                borderColor: "divider",
                overflow: "hidden", // chỉ bo/cắt ảnh
                borderTopLeftRadius: "inherit",
                borderTopRightRadius: "inherit",
                "& img": {
                  display: "block",
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                },
              }}
            >
              <img src={heroSrc} alt="thumbnail" onError={heroErr} />
              {/* Gắn nhãn góc phải cho provider */}
              {primary?.provider && (
                <Chip
                  size="small"
                  label={providerMeta(primary.provider).label}
                  icon={providerMeta(primary.provider).icon}
                  color="default"
                  sx={{
                    position: "absolute",
                    right: 8,
                    bottom: 8,
                    bgcolor: "rgba(0,0,0,0.5)",
                    color: "#fff",
                    "& .MuiChip-icon": { color: "#fff" },
                  }}
                />
              )}
            </Box>
          )}

          {/* Header */}
          <Box sx={{ p: 1.5, pb: 1 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ minWidth: 0 }}
            >
              {/* Mã trận VT/VBT - clamp 2 dòng */}
              <Tooltip
                placement="top"
                title={
                  m.code
                    ? `Mã: ${m.code} — V=Vòng, B=Bảng, T=Trận`
                    : "V=Vòng, B=Bảng, T=Trận"
                }
              >
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{
                    minWidth: 0,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    letterSpacing: 0.2,
                    flex: 1,
                    lineHeight: 1.25,
                    // KHÔNG giới hạn maxHeight bằng px cứng ngoại trừ clamp
                  }}
                >
                  {m.code || "Match"}
                </Typography>
              </Tooltip>

              {/* Chips V/B/T */}
              <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                {Number.isInteger(vt.v) && (
                  <Chip size="small" label={`V${vt.v}`} variant="outlined" />
                )}
                {Number.isInteger(vt.b) && (
                  <Chip size="small" label={`B${vt.b}`} variant="outlined" />
                )}
                {Number.isInteger(vt.t) && (
                  <Chip size="small" label={`T${vt.t}`} variant="outlined" />
                )}
              </Stack>

              {/* STATUS */}
              {isLive ? (
                <Chip
                  label="LIVE"
                  color="error"
                  size="small"
                  sx={{ fontWeight: 700, flexShrink: 0 }}
                />
              ) : hasAny ? (
                <Chip
                  label="Chuẩn bị"
                  color="warning"
                  size="small"
                  sx={{ flexShrink: 0 }}
                />
              ) : (
                <Chip
                  label={viStatus(m.status)}
                  size="small"
                  variant="outlined"
                  sx={{ flexShrink: 0 }}
                />
              )}

              {/* Info + Copy */}
              <Tooltip title="Xem chi tiết">
                <IconButton size="small" onClick={openInfo} sx={{ ml: 0.5 }}>
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {m.code && (
                <Tooltip title="Copy mã trận">
                  <IconButton
                    size="small"
                    onClick={() => copy(m.code)}
                    sx={{ ml: -0.5 }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>

            {/* Meta row */}
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={[
                m.status ? `Trạng thái: ${viStatus(m.status)}` : null,
                m.courtLabel ? `Sân: ${m.courtLabel}` : null,
                m.updatedAt ? `Cập nhật ${timeAgo(m.updatedAt)}` : null,
              ]
                .filter(Boolean)
                .join(" • ")}
            >
              {m.status ? `Trạng thái: ${viStatus(m.status)}` : "-"}
              {m.courtLabel && (
                <>
                  {bullet}Sân: {m.courtLabel}
                </>
              )}
              {m.updatedAt && (
                <>
                  {bullet}Cập nhật {timeAgo(m.updatedAt)}
                </>
              )}
            </Typography>
          </Box>

          <Divider />

          {/* Body */}
          <Box
            sx={{
              p: 1.5,
              pt: 1.25,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              flexGrow: 1, // ✅ đẩy footer xuống, thân card tự nở
              // KHÔNG đặt overflow hidden ở body để tránh cắt
              minHeight: 0,
            }}
          >
            {/* Primary action */}
            <Box sx={{ minWidth: 0 }}>
              {primary ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ minWidth: 0 }}
                >
                  <Button
                    fullWidth
                    variant="contained"
                    color={providerMeta(primary.provider).color}
                    startIcon={providerMeta(primary.provider).icon}
                    endIcon={<OpenInNewIcon />}
                    href={primary.watchUrl}
                    target="_blank"
                    rel="noreferrer"
                    sx={{
                      textTransform: "none",
                      fontWeight: 700,
                      minWidth: 0,
                      "& .MuiButton-startIcon": { mr: 1 },
                      "& .MuiButton-endIcon": { ml: 1 },
                      maxWidth: "100%",
                    }}
                    title={`Xem trên ${providerMeta(primary.provider).label}${
                      primaryHost ? ` (${primaryHost})` : ""
                    }`}
                  >
                    <Box
                      sx={{
                        display: "inline-block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "100%",
                      }}
                    >
                      Xem trên {providerMeta(primary.provider).label}
                      {primaryHost ? ` · ${primaryHost}` : ""}
                    </Box>
                  </Button>
                  <Tooltip title="Copy link">
                    <IconButton
                      color="default"
                      onClick={() => copy(primary.watchUrl)}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Chưa có phiên live đã xác minh.
                </Typography>
              )}
            </Box>

            {/* Secondary platforms */}
            <Box sx={{ minWidth: 0, mt: 0.25 }}>
              {(secondary.length > 0 || secMore > 0) && (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  flexWrap="wrap"
                  alignItems="center"
                >
                  {secVisible.map((s, i) => {
                    const meta = providerMeta(s.provider);
                    return (
                      <Button
                        key={i}
                        variant="outlined"
                        color={meta.color}
                        startIcon={meta.icon}
                        href={s.watchUrl}
                        target="_blank"
                        rel="noreferrer"
                        size="small"
                        sx={{
                          textTransform: "none",
                          minWidth: 0,
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={`${meta.label}${
                          s.watchUrl ? ` (${hostOf(s.watchUrl)})` : ""
                        }`}
                      >
                        {meta.label}
                      </Button>
                    );
                  })}
                  {secMore > 0 && (
                    <>
                      <Chip
                        size="small"
                        icon={<MoreHorizIcon />}
                        label={`+${secMore}`}
                        variant="outlined"
                        onClick={openMore}
                        sx={{ cursor: "pointer" }}
                      />
                      <Popover
                        open={Boolean(moreAnchor)}
                        anchorEl={moreAnchor}
                        onClose={closeMore}
                        anchorOrigin={{
                          vertical: "bottom",
                          horizontal: "left",
                        }}
                        transformOrigin={{
                          vertical: "top",
                          horizontal: "left",
                        }}
                        disableRestoreFocus
                      >
                        <Box sx={{ p: 1, minWidth: 240 }}>
                          <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Nền tảng khác
                          </Typography>
                          <Stack spacing={0.75}>
                            {secondary.slice(2).map((s, i) => {
                              const meta = providerMeta(s.provider);
                              return (
                                <Button
                                  key={i}
                                  size="small"
                                  variant="text"
                                  startIcon={meta.icon}
                                  href={s.watchUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  sx={{
                                    justifyContent: "flex-start",
                                    textTransform: "none",
                                  }}
                                >
                                  {meta.label} · {hostOf(s.watchUrl)}
                                </Button>
                              );
                            })}
                          </Stack>
                        </Box>
                      </Popover>
                    </>
                  )}
                </Stack>
              )}
            </Box>
          </Box>
        </Card>
      </Box>

      {/* Info: Popover/Dialog */}
      {smDown ? (
        <Dialog
          open={Boolean(infoAnchor)}
          onClose={closeInfo}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Thông tin trận</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1}>
              <Row
                label="Mã VT/VBT"
                value={m.code || "-"}
                onCopy={() => copy(m.code || "", "Đã copy mã trận!")}
              />
              {m.labelKey && <Row label="labelKey" value={m.labelKey} />}
              <Row label="Trạng thái" value={viStatus(m.status)} />
              <Row label="Sân" value={m.courtLabel || "-"} />
              {m.startedAt && (
                <Row
                  label="Bắt đầu"
                  value={new Date(m.startedAt).toLocaleString()}
                />
              )}
              {m.scheduledAt && (
                <Row
                  label="Lịch"
                  value={new Date(m.scheduledAt).toLocaleString()}
                />
              )}
              {m.updatedAt && (
                <Row label="Cập nhật" value={timeAgo(m.updatedAt)} />
              )}
              <Typography variant="subtitle2" sx={{ mt: 1 }}>
                Nền tảng
              </Typography>
              <Stack spacing={0.5}>
                {sessions.map((s, i) => {
                  const meta = providerMeta(s.provider);
                  return (
                    <Stack
                      key={i}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        {meta.icon}
                        <Typography variant="body2">{meta.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {hostOf(s.watchUrl)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5}>
                        <Button
                          size="small"
                          variant="outlined"
                          href={s.watchUrl}
                          target="_blank"
                          rel="noreferrer"
                          startIcon={<OpenInNewIcon />}
                        >
                          Mở
                        </Button>
                        <IconButton
                          size="small"
                          onClick={() => copy(s.watchUrl)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  );
                })}
                {sessions.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Không có URL phát hợp lệ.
                  </Typography>
                )}
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeInfo}>Đóng</Button>
          </DialogActions>
        </Dialog>
      ) : (
        <Popover
          open={Boolean(infoAnchor)}
          anchorEl={infoAnchor}
          onClose={closeInfo}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { width: 420, maxWidth: "90vw" } } }}
          disableRestoreFocus
        >
          <Box sx={{ p: 1.25 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Thông tin trận
            </Typography>
            <Stack spacing={1}>
              <Row
                label="Mã VT/VBT"
                value={m.code || "-"}
                onCopy={() => copy(m.code || "", "Đã copy mã trận!")}
              />
              {m.labelKey && <Row label="labelKey" value={m.labelKey} />}
              <Row label="Trạng thái" value={viStatus(m.status)} />
              <Row label="Sân" value={m.courtLabel || "-"} />
              {m.startedAt && (
                <Row
                  label="Bắt đầu"
                  value={new Date(m.startedAt).toLocaleString()}
                />
              )}
              {m.scheduledAt && (
                <Row
                  label="Lịch"
                  value={new Date(m.scheduledAt).toLocaleString()}
                />
              )}
              {m.updatedAt && (
                <Row label="Cập nhật" value={timeAgo(m.updatedAt)} />
              )}
              <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
                Nền tảng
              </Typography>
              <Stack spacing={0.5}>
                {sessions.map((s, i) => {
                  const meta = providerMeta(s.provider);
                  return (
                    <Stack
                      key={i}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ minWidth: 0 }}
                      >
                        {meta.icon}
                        <Typography variant="body2" noWrap title={meta.label}>
                          {meta.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          title={s.watchUrl}
                        >
                          {hostOf(s.watchUrl)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5}>
                        <Button
                          size="small"
                          variant="outlined"
                          href={s.watchUrl}
                          target="_blank"
                          rel="noreferrer"
                          startIcon={<OpenInNewIcon />}
                        >
                          Mở
                        </Button>
                        <IconButton
                          size="small"
                          onClick={() => copy(s.watchUrl)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  );
                })}
                {sessions.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Không có URL phát hợp lệ.
                  </Typography>
                )}
              </Stack>
            </Stack>
          </Box>
        </Popover>
      )}

      {/* Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={2200}
        onClose={closeSnack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={closeSnack}
          severity={snack.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </>
  );
}

/* ──────────────────────────── Small helper row ──────────────────────────── */
function Row({ label, value, onCopy }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
      <Typography
        variant="body2"
        sx={{ width: 112, flexShrink: 0 }}
        color="text.secondary"
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
        title={String(value || "")}
      >
        {String(value || "")}
      </Typography>
      {onCopy && value && (
        <Tooltip title="Copy">
          <IconButton size="small" onClick={onCopy}>
            <ContentCopyIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
