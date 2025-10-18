// components/admin/matches/MatchRowActions.jsx
import { useState, useMemo } from "react";
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  Stack,
  IconButton,
  Divider,
  Typography,
  Tooltip,
  Box,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import FacebookIcon from "@mui/icons-material/Facebook";
import YouTubeIcon from "@mui/icons-material/YouTube";
import AudiotrackIcon from "@mui/icons-material/Audiotrack"; // tạm cho TikTok

import { useCreateFacebookLiveForMatchMutation } from "../slices/adminMatchLiveApiSlice.js";

function PlatformIcon({ platform }) {
  if (platform === "facebook") return <FacebookIcon color="primary" />;
  if (platform === "youtube") return <YouTubeIcon color="error" />;
  if (platform === "tiktok") return <AudiotrackIcon />;
  return <LiveTvIcon />;
}

function LineCopy({ label, value, hidden = false, onCopy }) {
  if (!value) return null;
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <TextField
        fullWidth
        label={label}
        value={value}
        type={hidden ? "password" : "text"}
        InputProps={{ readOnly: true }}
      />
      <Tooltip title="Copy">
        <IconButton onClick={() => onCopy(value)}>
          <ContentCopyIcon />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

export default function MatchRowActions({ match }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);

  const [createLive, { isLoading }] = useCreateFacebookLiveForMatchMutation();

  const copy = (v) => navigator.clipboard.writeText(v || "");

  // Prefill khi chỉ mở popup mà chưa gọi API
  const prefillFromMatch = () => {
    const fb = match?.facebookLive || {};
    const yt = match?.youtubeLive || {};
    const hasAnyFb =
      fb.server_url ||
      fb.stream_key ||
      fb.permalink_url ||
      fb.secure_stream_url;
    const hasAnyYt = yt.server_url || yt.stream_key || yt.watch_url;

    if (hasAnyFb || hasAnyYt) {
      const destinations = [];
      if (hasAnyFb) {
        destinations.push({
          platform: "facebook",
          id: fb.id,
          server_url: fb.server_url,
          stream_key: fb.stream_key,
          permalink_url: fb.permalink_url,
          extras: { pageId: fb.pageId },
        });
      }
      if (hasAnyYt) {
        destinations.push({
          platform: "youtube",
          id: yt.id,
          server_url: yt.server_url,
          stream_key: yt.stream_key,
          watch_url: yt.watch_url,
        });
      }

      setData((prev) => ({
        ...(prev || {}),
        server_url:
          (hasAnyFb && fb.server_url) ||
          (hasAnyYt && yt.server_url) ||
          (prev && prev.server_url) ||
          "",
        stream_key:
          (hasAnyFb && fb.stream_key) ||
          (hasAnyYt && yt.stream_key) ||
          (prev && prev.stream_key) ||
          "",
        secure_stream_url:
          (hasAnyFb && fb.secure_stream_url) ||
          (prev && prev.secure_stream_url) ||
          "",
        permalink_url:
          (hasAnyFb && fb.permalink_url) || (prev && prev.permalink_url) || "",
        overlay_url: (prev && prev.overlay_url) || "",
        studio_url: (prev && prev.studio_url) || "",
        destinations: destinations.length
          ? destinations
          : prev?.destinations || [],
        // ❌ KHÔNG lưu/hiện errors nữa
        note: prev?.note || "",
      }));
    }
  };

  const handleLive = async () => {
    try {
      const res = await createLive(match._id).unwrap();
      // Bỏ hẳn trường errors nếu có
      const { errors, ...clean } = res || {};
      setData(clean);
      setOpen(true);
    } catch (err) {
      console.error(err);
      // Không hiện lỗi nền tảng theo yêu cầu
    }
  };

  const handleOpenPopupOnly = () => {
    if (!data) prefillFromMatch();
    setOpen(true);
  };

  const primaryLink = useMemo(() => {
    return data?.permalink_url || data?.watch_url || null;
  }, [data]);

  const hasAnyDestination = (data?.destinations || []).length > 0;

  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          startIcon={<LiveTvIcon />}
          disabled={isLoading}
          onClick={handleLive}
          variant="outlined"
        >
          {isLoading ? "Đang tạo…" : "LIVE"}
        </Button>

        <Button
          size="small"
          startIcon={<InfoOutlinedIcon />}
          onClick={handleOpenPopupOnly}
          variant="text"
          title="Mở popup LIVE (không tạo mới)"
        >
          Mở popup LIVE
        </Button>
      </Stack>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          LIVE Outputs (Match #{match?.code || match?._id?.slice(-5)})
        </DialogTitle>

        <DialogContent>
          {data ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {/* Primary encoder (OBS) */}
              <Typography variant="h6">Primary encoder (OBS)</Typography>
              <Stack spacing={1.2}>
                {/* Nếu chỉ có secure_stream_url (chuỗi gộp), hiển thị riêng */}
                {data.secure_stream_url &&
                  !(data.server_url || data.stream_key) && (
                    <LineCopy
                      label="Secure Stream URL (RTMPS)"
                      value={data.secure_stream_url}
                      onCopy={copy}
                    />
                  )}

                {data.server_url && (
                  <LineCopy
                    label="Server URL (RTMPS)"
                    value={data.server_url}
                    onCopy={copy}
                  />
                )}

                {data.stream_key && (
                  <LineCopy
                    label="Stream Key"
                    value={data.stream_key}
                    hidden
                    onCopy={copy}
                  />
                )}
              </Stack>

              {/* Overlay + Studio */}
              <Divider sx={{ my: 1 }} />

              <Typography variant="h6">Overlay & Studio</Typography>
              <Stack spacing={1.2}>
                <LineCopy
                  label="Overlay URL (Browser Source)"
                  value={data.overlay_url || ""}
                  onCopy={copy}
                />

                <Stack direction="row" spacing={1}>
                  {data.studio_url && (
                    <Button
                      startIcon={<OpenInNewIcon />}
                      href={data.studio_url}
                      target="_blank"
                    >
                      Open Studio
                    </Button>
                  )}
                  {primaryLink && (
                    <Button
                      startIcon={<OpenInNewIcon />}
                      href={primaryLink}
                      target="_blank"
                    >
                      Open Live
                    </Button>
                  )}
                </Stack>
              </Stack>

              {/* Destinations (chỉ render các nền tảng thành công) */}
              {hasAnyDestination && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="h6">Destinations</Typography>
                  <Stack spacing={1.5}>
                    {data.destinations.map((d, i) => {
                      const openUrl =
                        d.permalink_url || d.watch_url || d.room_url || null;
                      return (
                        <Box
                          key={`${d.platform}-${d.id || i}`}
                          sx={{
                            p: 1.5,
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: 1,
                          }}
                        >
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={1.2}
                            sx={{ mb: 1 }}
                          >
                            <PlatformIcon platform={d.platform} />
                            <Typography sx={{ fontWeight: 600 }}>
                              {String(d.platform).toUpperCase()}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {d.id ? `#${d.id}` : ""}
                            </Typography>
                            <Box sx={{ flex: 1 }} />
                            {openUrl && (
                              <Button
                                size="small"
                                startIcon={<OpenInNewIcon />}
                                href={openUrl}
                                target="_blank"
                              >
                                Open
                              </Button>
                            )}
                          </Stack>

                          <Stack spacing={1.2}>
                            {d.server_url && (
                              <LineCopy
                                label="Server URL"
                                value={d.server_url}
                                onCopy={copy}
                              />
                            )}
                            {d.stream_key && (
                              <LineCopy
                                label="Stream Key"
                                value={d.stream_key}
                                hidden
                                onCopy={copy}
                              />
                            )}
                            {d.platform === "facebook" && d.extras?.pageId && (
                              <TextField
                                fullWidth
                                label="Facebook Page ID"
                                value={d.extras.pageId}
                                InputProps={{ readOnly: true }}
                              />
                            )}
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                </>
              )}
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Chưa có dữ liệu. Bấm “LIVE” để tạo, hoặc “Mở popup LIVE” để xem
              thông tin đã lưu.
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
