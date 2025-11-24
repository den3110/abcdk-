// LiveMatchCard.jsx
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useMediaQuery,
  useTheme,
  Snackbar,
  Alert,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FacebookIcon from "@mui/icons-material/Facebook";
import VideocamIcon from "@mui/icons-material/Videocam";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useSelector } from "react-redux";
import { useDeleteLiveVideoMutation } from "../../slices/liveApiSlice";

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
  if (key === "live") return "LIVE";
  return VI_STATUS_LABELS[key] || s;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const providerMeta = (p) =>
  p === "youtube"
    ? { label: "YouTube", icon: <FacebookIcon />, color: "error" }
    : p === "facebook"
    ? { label: "Facebook", icon: <FacebookIcon />, color: "primary" }
    : { label: p || "Stream", icon: <VideocamIcon />, color: "secondary" };

const byPriority = (a, b) =>
  (({ youtube: 1, facebook: 2 }[a.provider] || 99) -
    ({ youtube: 1, facebook: 2 }[b.provider] || 99));

export default function LiveMatchCard({ item }) {
  const theme = useTheme();
  const smDown = useMediaQuery(theme.breakpoints.down("sm"));

  const { userInfo } = useSelector((state) => state.auth || {});
  const isAdmin = Boolean(userInfo?.isAdmin || userInfo?.role === "admin");
  console.log(isAdmin)
  const [deleteLiveVideo, { isLoading: isDeleting }] =
    useDeleteLiveVideoMutation();

  const m = item || {};
  const fb = m.facebookLive || {};

  // build 1 session từ facebookLive
  const fbWatch =
    fb.video_permalink_url ||
    fb.permalink_url ||
    fb.watch_url ||
    (fb.videoId
      ? `https://www.facebook.com/watch/?v=${fb.videoId}`
      : fb.id
      ? `https://www.facebook.com/watch/?v=${fb.id}`
      : "");
  const sessions = fbWatch
    ? [
        {
          provider: "facebook",
          watchUrl: fbWatch,
          embedHtml: fb.embed_html || "",
          embedUrl: fb.embed_url || "",
          pageId: fb.pageId || "",
          liveId: fb.id || "",
          videoId: fb.videoId || "",
        },
      ]
    : [];
  const primary = sessions[0] || null;
  const hasEmbed = Boolean(primary?.embedHtml || primary?.embedUrl);

  const hasVideoInfo =
    Boolean(
      fb.id ||
        fb.videoId ||
        fb.permalink_url ||
        fb.video_permalink_url ||
        fb.watch_url ||
        fb.embed_url ||
        fb.embed_html
    ) || Boolean(primary);

  const isLive = String(m.status || "").toLowerCase() === "live";

  // snackbar ...
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
    if (!txt) return;
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

  const [infoAnchor, setInfoAnchor] = React.useState(null);
  const openInfo = (e) => setInfoAnchor(e.currentTarget);
  const closeInfo = () => setInfoAnchor(null);

  // mỗi lần embedTick đổi, khối embed được re-mount
  const [embedTick, setEmbedTick] = React.useState(0);

  // ✅ chỉ reload khi BE đổi embed html/url
  React.useEffect(() => {
    setEmbedTick((t) => t + 1);
  }, [fb.embed_html, fb.embed_url, fbWatch]);

  const bullet = (
    <Box component="span" sx={{ mx: 1, color: "text.disabled" }}>
      •
    </Box>
  );

  const handleDeleteVideo = async () => {
    if (!m?._id) return;
    const ok = window.confirm(
      "Bạn chắc chắn muốn xoá thông tin video khỏi trận này?\nTrận sẽ không bị xoá, chỉ xoá link video / embed."
    );
    if (!ok) return;

    try {
      await deleteLiveVideo(m._id).unwrap();
      setSnack({
        open: true,
        message: "Đã xoá video khỏi trận.",
        severity: "success",
      });
      // để RTK Query refetch list, card sẽ nhận item mới không còn video
    } catch (err) {
      console.error("deleteLiveVideo error:", err);
      setSnack({
        open: true,
        message: "Xoá video thất bại, thử lại sau.",
        severity: "error",
      });
    }
  };

  return (
    <>
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
            minWidth: 0,
            flex: 1,
            alignSelf: "stretch",
            "&:hover": { boxShadow: 3, borderColor: "divider" },
          }}
        >
          {/* ưu tiên hiển thị embed nếu có + nút reload tay */}
          {hasEmbed ? (
            <Box
              key={`embed-${m._id || "x"}-${embedTick}`}
              sx={{
                position: "relative",
                width: "100%",
                bgcolor: "action.hover",
                borderBottom: "1px solid",
                borderColor: "divider",
                "& iframe": {
                  width: "100%",
                  aspectRatio: "16 / 9",
                  height: "auto",
                  border: 0,
                },
              }}
            >
              {/* nút reload tay */}
              <Tooltip title="Tải lại embed">
                <IconButton
                  size="small"
                  onClick={() => setEmbedTick((t) => t + 1)}
                  sx={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    zIndex: 10,
                    bgcolor: "rgba(0,0,0,0.35)",
                    color: "#fff",
                    "&:hover": { bgcolor: "rgba(0,0,0,0.5)" },
                  }}
                >
                  <ReplayIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              {primary?.embedHtml ? (
                <Box
                  sx={{ width: "100%", aspectRatio: "16 / 9" }}
                  dangerouslySetInnerHTML={{ __html: primary.embedHtml }}
                />
              ) : (
                <iframe
                  src={primary.embedUrl}
                  title={m.code || "fb-live"}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  style={{ width: "100%", aspectRatio: "16/9", border: 0 }}
                />
              )}
            </Box>
          ) : null}

          {/* Header */}
          <Box sx={{ p: 1.5, pb: 1 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ minWidth: 0 }}
            >
              <Tooltip
                placement="top"
                title={m.code ? `Mã: ${m.code}` : "Mã trận"}
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
                    flex: 1,
                    lineHeight: 1.25,
                  }}
                >
                  {m.code || m.labelKey || "Match"}
                </Typography>
              </Tooltip>

              {isLive ? (
                <Chip
                  label="LIVE"
                  color="error"
                  size="small"
                  sx={{ fontWeight: 700, flexShrink: 0 }}
                />
              ) : (
                <Chip
                  label={viStatus(m.status)}
                  size="small"
                  variant="outlined"
                  sx={{ flexShrink: 0 }}
                />
              )}

              <Tooltip title="Xem chi tiết">
                <IconButton size="small" onClick={openInfo} sx={{ ml: 0.5 }}>
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {m.code && (
                <Tooltip title="Copy mã trận">
                  <IconButton
                    size="small"
                    onClick={() => copy(m.code, "Đã copy mã trận!")}
                    sx={{ ml: -0.5 }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>

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
            >
              {m.status ? `Trạng thái: ${viStatus(m.status)}` : "-"}
              {m.courtLabel && (
                <>
                  {bullet}Sân: {m.courtLabel}
                </>
              )}
              {typeof m.currentGame === "number" && m.currentGame > 0 && (
                <>
                  {bullet}Game: {m.currentGame}
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
              flexGrow: 1,
              minHeight: 0,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              {primary ? (
                <>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ minWidth: 0 }}
                  >
                    <Button
                      fullWidth
                      variant="contained"
                      color="primary"
                      startIcon={<FacebookIcon />}
                      endIcon={<OpenInNewIcon />}
                      href={primary.watchUrl}
                      target="_blank"
                      rel="noreferrer"
                      sx={{
                        textTransform: "none",
                        fontWeight: 700,
                        minWidth: 0,
                        maxWidth: "100%",
                      }}
                      title={`Xem trên Facebook${
                        primary.watchUrl
                          ? ` (${hostOf(primary.watchUrl)})`
                          : ""
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
                        Xem trên Facebook
                      </Box>
                    </Button>
                    {primary.watchUrl && (
                      <Tooltip title="Copy link">
                        <IconButton
                          color="default"
                          onClick={() => copy(primary.watchUrl)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {(primary.embedHtml || primary.embedUrl) && (
                      <Tooltip title="Copy embed">
                        <IconButton
                          color="default"
                          onClick={() =>
                            copy(
                              primary.embedHtml || primary.embedUrl,
                              "Đã copy embed!"
                            )
                          }
                        >
                          <VideocamIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>

                  {/* ✅ nút xoá video cho admin */}
                  {isAdmin && hasVideoInfo && (
                    <Box sx={{ mt: 1 }}>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<DeleteOutlineIcon />}
                        onClick={handleDeleteVideo}
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Đang xoá video..." : "Xoá video khỏi trận"}
                      </Button>
                    </Box>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Chưa có URL phát hợp lệ.
                </Typography>
              )}
            </Box>

            {(m.pairA || m.pairB) && (
              <Box sx={{ mt: 0.5 }}>
                {m.pairA && (
                  <Typography variant="body2">
                    A:{" "}
                    {(m.pairA.player1?.user?.name ||
                      m.pairA.player1?.name ||
                      "") +
                      (m.pairA.player2?.user?.name
                        ? ` / ${m.pairA.player2.user.name}`
                        : "")}
                  </Typography>
                )}
                {m.pairB && (
                  <Typography variant="body2">
                    B:{" "}
                    {(m.pairB.player1?.user?.name ||
                      m.pairB.player1?.name ||
                      "") +
                      (m.pairB.player2?.user?.name
                        ? ` / ${m.pairB.player2.user.name}`
                        : "")}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </Card>
      </Box>

      {/* Info dialog (mình giữ logic hiện tại) */}
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

            {/* thêm 2 dòng embed để bạn nhìn */}
            <Row label="FB embed url" value={fb.embed_url || "-"} />
            <Row
              label="FB embed html"
              value={fb.embed_html ? "<html...>" : "-"}
              onCopy={
                fb.embed_html
                  ? () => copy(fb.embed_html, "Đã copy embed html!")
                  : undefined
              }
            />

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
