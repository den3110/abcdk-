/* eslint-disable react/prop-types */
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
import { UnifiedStreamPlayer } from "../../components/video";
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

function isFinishedLikeStatus(status) {
  return ["finished", "ended", "stopped"].includes(
    String(status || "")
      .trim()
      .toLowerCase(),
  );
}

const providerMeta = (p) =>
  p === "youtube"
    ? { label: "YouTube", icon: <FacebookIcon />, color: "error" }
    : p === "facebook"
      ? { label: "Facebook", icon: <FacebookIcon />, color: "primary" }
      : { label: p || "Stream", icon: <VideocamIcon />, color: "secondary" };

function buildCanonicalSessions(match = {}) {
  const defaultStreamKey =
    typeof match?.defaultStreamKey === "string" ? match.defaultStreamKey : "";
  const streams = Array.isArray(match?.streams) ? match.streams : [];

  return streams
    .filter(
      (stream) =>
        stream &&
        typeof stream === "object" &&
        (typeof stream?.playUrl === "string" ||
          typeof stream?.openUrl === "string"),
    )
    .sort((a, b) => Number(a?.priority || 99) - Number(b?.priority || 99))
    .map((stream) => {
      const playUrl =
        typeof stream?.playUrl === "string" ? stream.playUrl.trim() : "";
      const openUrl =
        typeof stream?.openUrl === "string" ? stream.openUrl.trim() : "";
      const embedHtml =
        typeof stream?.embedHtml === "string" ? stream.embedHtml.trim() : "";
      const explicitEmbedUrl =
        typeof stream?.embedUrl === "string" ? stream.embedUrl.trim() : "";
      const url = playUrl || openUrl;
      const kind = String(stream?.kind || "")
        .trim()
        .toLowerCase();
      const isPrimary =
        (defaultStreamKey && String(stream?.key || "") === defaultStreamKey) ||
        Boolean(stream?.primary);
      if (!url) return null;

      if (kind === "iframe_html" && embedHtml) {
        return {
          key: stream?.key || "server1",
          provider: "facebook",
          kind: "iframe_html",
          label: stream?.displayLabel || "Server 1",
          providerLabel: stream?.providerLabel || "Facebook",
          openUrl: openUrl || url,
          watchUrl: openUrl || url,
          embedHtml,
          canEmbedInline: true,
          primary: isPrimary,
          ready: stream?.ready !== false,
          delaySeconds: Number(stream?.delaySeconds || 0),
          aspect: stream?.aspect || "16:9",
        };
      }

      if (kind === "facebook") {
        return {
          key: stream?.key || "server1",
          provider: "facebook",
          kind: "iframe",
          label: stream?.displayLabel || "Server 1",
          providerLabel: stream?.providerLabel || "Facebook",
          openUrl: openUrl || url,
          watchUrl: openUrl || url,
          embedUrl:
            explicitEmbedUrl ||
            `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&width=1280`,
          allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
          canEmbedInline: true,
          primary: isPrimary,
          ready: stream?.ready !== false,
          delaySeconds: Number(stream?.delaySeconds || 0),
          aspect: stream?.aspect || "16:9",
        };
      }

      if (kind === "file" || kind === "hls") {
        return {
          key: stream?.key || "stream",
          provider: kind,
          kind,
          label: stream?.displayLabel || "Video",
          providerLabel: stream?.providerLabel || "PickleTour",
          openUrl: openUrl || url,
          watchUrl: openUrl || url,
          embedUrl: url,
          canEmbedInline: true,
          primary: isPrimary,
          ready: stream?.ready !== false,
          delaySeconds: Number(stream?.delaySeconds || 0),
          aspect: stream?.aspect || "16:9",
        };
      }

      if (kind === "delayed_manifest") {
        return {
          key: stream?.key || "server2",
          provider: "server2",
          kind: "delayed_manifest",
          label: stream?.displayLabel || "Server 2",
          providerLabel: stream?.providerLabel || "PickleTour CDN",
          openUrl: openUrl || "",
          watchUrl: openUrl || "",
          embedUrl: url,
          canEmbedInline: true,
          primary: isPrimary,
          ready: stream?.ready !== false,
          delaySeconds: Number(stream?.delaySeconds || 0),
          disabledReason:
            typeof stream?.disabledReason === "string"
              ? stream.disabledReason
              : "",
          meta: stream?.meta || {},
          aspect: stream?.aspect || "16:9",
        };
      }

      return {
        key: stream?.key || "stream",
        provider: kind || "stream",
        kind: "iframe",
        label: stream?.displayLabel || "Stream",
        providerLabel: stream?.providerLabel || "Stream",
        openUrl: openUrl || url,
        watchUrl: openUrl || url,
        embedUrl: url,
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        canEmbedInline: true,
        primary: isPrimary,
        ready: stream?.ready !== false,
        delaySeconds: Number(stream?.delaySeconds || 0),
        aspect: stream?.aspect || "16:9",
      };
    })
    .filter(Boolean);
}

export default function LiveMatchCard({ item, onDeleted }) {
  const { userInfo } = useSelector((state) => state.auth || {});
  const isAdmin = Boolean(userInfo?.isAdmin || userInfo?.role === "admin");

  const [deleteLiveVideo, { isLoading: isDeleting }] =
    useDeleteLiveVideoMutation();
  const [activeSessionKey, setActiveSessionKey] = React.useState("");

  const m = React.useMemo(() => item || {}, [item]);
  const fb = React.useMemo(() => m.facebookLive || {}, [m]);

  // build 1 session từ facebookLive
  const canonicalSessions = React.useMemo(() => buildCanonicalSessions(m), [m]);
  const fbWatch = React.useMemo(
    () =>
      fb.video_permalink_url ||
      fb.permalink_url ||
      fb.watch_url ||
      (fb.videoId
        ? `https://www.facebook.com/watch/?v=${fb.videoId}`
        : fb.id
          ? `https://www.facebook.com/watch/?v=${fb.id}`
          : ""),
    [fb.id, fb.permalink_url, fb.videoId, fb.video_permalink_url, fb.watch_url],
  );
  const sessions = React.useMemo(
    () =>
      canonicalSessions.length > 0
        ? canonicalSessions
        : fbWatch
          ? [
              {
                key: "server1",
                provider: "facebook",
                kind: fb.embed_html ? "iframe_html" : "iframe",
                label: "Server 1",
                providerLabel: "Facebook",
                openUrl: fbWatch,
                watchUrl: fbWatch,
                embedHtml: fb.embed_html || "",
                embedUrl:
                  fb.embed_url ||
                  `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(fbWatch)}&show_text=false&width=1280`,
                allow:
                  "autoplay; encrypted-media; picture-in-picture; fullscreen",
                pageId: fb.pageId || "",
                liveId: fb.id || "",
                videoId: fb.videoId || "",
                canEmbedInline: true,
                primary: true,
                ready: true,
                delaySeconds: 0,
                aspect: "16:9",
              },
            ]
          : [],
    [
      canonicalSessions,
      fb.embed_html,
      fb.embed_url,
      fb.id,
      fb.pageId,
      fb.videoId,
      fbWatch,
    ],
  );
  const finishedLike =
    isFinishedLikeStatus(m.status) || isFinishedLikeStatus(fb.status);
  const readyServer2 =
    sessions.find((session) => session.key === "server2" && session.ready) ||
    null;
  const preferredSession =
    (finishedLike && readyServer2) ||
    sessions.find((session) => session.primary && session.ready !== false) ||
    sessions.find((session) => session.ready !== false) ||
    sessions[0] ||
    null;
  React.useEffect(() => {
    if (!sessions.length) {
      if (activeSessionKey) {
        setActiveSessionKey("");
      }
      return;
    }

    const currentSession = sessions.find(
      (session) => activeSessionKey && session.key === activeSessionKey,
    );

    if (!activeSessionKey) {
      if (preferredSession?.key) {
        setActiveSessionKey(preferredSession.key);
      }
      return;
    }

    if (!currentSession) {
      setActiveSessionKey(preferredSession?.key || "");
      return;
    }

    if (
      currentSession.ready === false &&
      readyServer2 &&
      currentSession.key !== readyServer2.key
    ) {
      setActiveSessionKey(readyServer2.key);
    }
  }, [activeSessionKey, preferredSession, readyServer2, sessions]);
  const primary = preferredSession;
  const activeSession =
    sessions.find(
      (session) => activeSessionKey && session.key === activeSessionKey,
    ) ||
    primary ||
    null;
  const hasEmbed = Boolean(
    activeSession?.canEmbedInline &&
    (activeSession?.embedHtml || activeSession?.embedUrl),
  );

  const hasVideoInfo =
    Boolean(
      fb.id ||
      fb.videoId ||
      fb.permalink_url ||
      fb.video_permalink_url ||
      fb.watch_url ||
      fb.embed_url ||
      fb.embed_html,
    ) || sessions.length > 0;

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

  // chỉ reload khi BE đổi embed html/url
  React.useEffect(() => {
    setEmbedTick((t) => t + 1);
  }, [fb.embed_html, fb.embed_url, fbWatch]);

  const primaryOpenLabel =
    activeSession?.provider === "facebook"
      ? "Xem trên Facebook"
      : activeSession?.label || activeSession?.providerLabel || "Mở video";
  const primaryOpenIcon =
    activeSession?.provider === "facebook" ? (
      <FacebookIcon />
    ) : (
      <VideocamIcon />
    );

  const bullet = (
    <Box component="span" sx={{ mx: 1, color: "text.disabled" }}>
      •
    </Box>
  );

  const handleDeleteVideo = async () => {
    if (!m?._id) return;
    const ok = window.confirm(
      "Bạn chắc chắn muốn xoá thông tin video khỏi trận này?\nTrận sẽ không bị xoá, chỉ xoá link video / embed.",
    );
    if (!ok) return;

    try {
      await deleteLiveVideo(m._id).unwrap();
      setSnack({
        open: true,
        message: "Đã xoá video khỏi trận.",
        severity: "success",
      });

      // ✅ báo cho parent để xoá card khỏi list
      if (typeof onDeleted === "function") {
        onDeleted(m._id);
      }
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

              <UnifiedStreamPlayer
                source={activeSession}
                autoplay={isLive}
                remountKey={`embed-${m._id || "x"}-${embedTick}`}
                previewOnlyUntilPlay={!isLive}
                useNativeControls={!isLive}
              />
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

            {sessions.length > 0 && (
              <Stack
                direction="row"
                spacing={0.75}
                sx={{ mt: 1 }}
                flexWrap="wrap"
              >
                {sessions.map((session) => (
                  <Chip
                    key={session.key || session.watchUrl || session.embedUrl}
                    size="small"
                    variant={
                      session.key &&
                      activeSession?.key &&
                      session.key === activeSession.key
                        ? "filled"
                        : "outlined"
                    }
                    color={
                      session.key &&
                      activeSession?.key &&
                      session.key === activeSession.key
                        ? "primary"
                        : "default"
                    }
                    onClick={() => setActiveSessionKey(session.key || "")}
                    label={session.label || session.providerLabel || "Server"}
                  />
                ))}
              </Stack>
            )}

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
              {activeSession ? (
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
                      disabled={!activeSession.watchUrl}
                      startIcon={primaryOpenIcon}
                      endIcon={<OpenInNewIcon />}
                      href={activeSession.watchUrl}
                      target="_blank"
                      rel="noreferrer"
                      sx={{
                        textTransform: "none",
                        fontWeight: 700,
                        minWidth: 0,
                        maxWidth: "100%",
                      }}
                      title={`${primaryOpenLabel}${
                        activeSession.watchUrl
                          ? ` (${hostOf(activeSession.watchUrl)})`
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
                        {primaryOpenLabel}
                      </Box>
                    </Button>
                    {activeSession.watchUrl && (
                      <Tooltip title="Copy link">
                        <IconButton
                          color="default"
                          onClick={() => copy(activeSession.watchUrl)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {(activeSession.embedHtml || activeSession.embedUrl) && (
                      <Tooltip title="Copy embed">
                        <IconButton
                          color="default"
                          onClick={() =>
                            copy(
                              activeSession.embedHtml || activeSession.embedUrl,
                              "Đã copy embed!",
                            )
                          }
                        >
                          <VideocamIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>

                  {/* nút xoá video cho admin */}
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
                        {isDeleting
                          ? "Đang xoá video..."
                          : "Xoá video khỏi trận"}
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

      {/* Info dialog */}
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

            {/* embed info */}
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
                      <IconButton size="small" onClick={() => copy(s.watchUrl)}>
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
