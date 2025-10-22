// components/admin/matches/MatchRowActions.jsx
// REWRITTEN: build Studio URL with d64 (base64 JSON destinations) + convenience params
// - Prefill popup from match.facebookLive / match.youtubeLive when no API call
// - "Open Studio" works even when backend doesn't return studio_url (fallback /live/studio)

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

// --- Utils -----------------------------------------------------------------
const encodeB64Json = (obj) => {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  } catch {
    return "";
  }
};

const splitRtmpUrl = (url) => {
  if (!url || !/^rtmps?:\/\//i.test(url))
    return { server_url: "", stream_key: "" };
  try {
    const idx = url.lastIndexOf("/");
    if (idx === -1) return { server_url: url, stream_key: "" };
    return { server_url: url.slice(0, idx), stream_key: url.slice(idx + 1) };
  } catch {
    return { server_url: "", stream_key: "" };
  }
};

// Normalize an item into { platform, server_url, stream_key, secure_stream_url, permalink_url, watch_url, id }
const normDest = (platform, raw = {}) => {
  const p = (platform || raw.platform || "").toLowerCase();
  let server_url = raw.server_url || "";
  let stream_key = raw.stream_key || "";
  const secure_stream_url = raw.secure_stream_url || "";

  if ((!server_url || !stream_key) && secure_stream_url) {
    const s = splitRtmpUrl(secure_stream_url);
    server_url = server_url || s.server_url;
    stream_key = stream_key || s.stream_key;
  }

  return {
    platform: p,
    id: raw.id,
    server_url,
    stream_key,
    secure_stream_url,
    permalink_url: raw.permalink_url,
    watch_url: raw.watch_url,
    room_url: raw.room_url,
    extras: raw.extras,
  };
};

// Pull destinations from API data first; fallback to match.* if needed
const extractDestinations = (data, match) => {
  const out = [];

  // 1) API destinations
  if (Array.isArray(data?.destinations) && data.destinations.length) {
    data.destinations.forEach((d) => out.push(normDest(d.platform, d)));
  }

  // 2) Root-level primary (some backends return primary at root)
  if (
    (data?.server_url || data?.secure_stream_url || data?.stream_key) &&
    !out.length
  ) {
    out.push(normDest("facebook", data));
  }

  // 3) Fallback from match snapshot (when just opening popup)
  const fb = match?.facebookLive || {};
  const yt = match?.youtubeLive || {};
  const tt = match?.tiktokLive || {};
  const hasAnyFb =
    fb.server_url || fb.stream_key || fb.secure_stream_url || fb.permalink_url;
  const hasAnyYt = yt.server_url || yt.stream_key || yt.watch_url;
  const hasAnyTt =
    tt.server_url || tt.stream_key || tt.room_url || tt.secure_stream_url;

  if (!out.length && (hasAnyFb || hasAnyYt || hasAnyTt)) {
    if (hasAnyFb) out.push(normDest("facebook", fb));
    if (hasAnyYt) out.push(normDest("youtube", yt));
    if (hasAnyTt) out.push(normDest("tiktok", tt));
  }

  // Ensure unique by platform+id+server_url+stream_key to avoid duplicates
  const seen = new Set();
  return out.filter((d) => {
    const k = [d.platform, d.id, d.server_url, d.stream_key].join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// Build Studio URL with d64 + convenience params for quick prefill in Studio
// Helper: detect local/dev hostnames
const isLocalHost = (host) => {
  if (!host) return false;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /\.local$/.test(host)
  );
};

const buildStudioUrl = (baseUrl, data, match) => {
  // nếu đang chạy local thì origin = http://localhost:3000
  const wantsLocal =
    typeof window !== "undefined" && isLocalHost(window.location.hostname);
  const origin =
    wantsLocal && typeof window !== "undefined"
      ? "http://localhost:3000"
      : (typeof window !== "undefined" && window.location.origin) ||
        "http://localhost:3000";

  // base mặc định là route nội bộ
  let base = baseUrl || "/live/studio";

  // Nếu baseUrl là absolute và đang local → giữ lại path/search, thay origin = localhost:3000
  if (typeof base === "string" && /^https?:\/\//i.test(base) && wantsLocal) {
    try {
      const parsed = new URL(base);
      base = parsed.pathname + (parsed.search || "");
    } catch {}
  }

  const u = new URL(base, origin);

  if (match?._id) u.searchParams.set("matchId", match._id);

  const dests = extractDestinations(data, match);
  if (dests.length) {
    // chỉ giữ các khóa cần thiết để prefill
    const minimal = dests.map((d) => ({
      platform: d.platform,
      server_url: d.server_url || d.secure_stream_url || "",
      stream_key: d.stream_key || "",
      secure_stream_url: d.secure_stream_url || "",
    }));

    const d64 = encodeB64Json(minimal);
    if (d64) u.searchParams.set("d64", d64);

    // Thêm các tiện-param trực tiếp
    const fb = dests.find((d) => d.platform === "facebook");
    if (fb) {
      let fbKey = fb.stream_key;
      if (!fbKey && fb.secure_stream_url)
        fbKey = splitRtmpUrl(fb.secure_stream_url).stream_key;
      if (fbKey) u.searchParams.set("key", fbKey);
    }

    const yt = dests.find((d) => d.platform === "youtube");
    if (yt && (yt.server_url || yt.stream_key || yt.secure_stream_url)) {
      const y =
        yt.server_url && yt.stream_key
          ? yt
          : splitRtmpUrl(yt.secure_stream_url);
      const ysrv = yt.server_url || y.server_url;
      const ykey = yt.stream_key || y.stream_key;
      if (ysrv) u.searchParams.set("yt_server", ysrv);
      if (ykey) u.searchParams.set("yt", ykey);
    }

    const tt = dests.find((d) => d.platform === "tiktok");
    if (tt && (tt.server_url || tt.stream_key || tt.secure_stream_url)) {
      const t =
        tt.server_url && tt.stream_key
          ? tt
          : splitRtmpUrl(tt.secure_stream_url);
      const tsrv = tt.server_url || t.server_url;
      const tkey = tt.stream_key || t.stream_key;
      if (tsrv) u.searchParams.set("tt_server", tsrv);
      if (tkey) u.searchParams.set("tt", tkey);
    }
  }

  return u.toString();
};

export default function MatchRowActions({ match }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);

  const [createLive, { isLoading }] = useCreateFacebookLiveForMatchMutation();

  const copy = (v) => navigator.clipboard.writeText(v || "");

  // Prefill khi chỉ mở popup mà chưa gọi API
  const prefillFromMatch = () => {
    const fb = match?.facebookLive || {};
    const yt = match?.youtubeLive || {};
    const tt = match?.tiktokLive || {};

    const hasAnyFb =
      fb.server_url ||
      fb.stream_key ||
      fb.permalink_url ||
      fb.secure_stream_url;
    const hasAnyYt = yt.server_url || yt.stream_key || yt.watch_url;
    const hasAnyTt =
      tt.server_url || tt.stream_key || tt.room_url || tt.secure_stream_url;

    if (hasAnyFb || hasAnyYt || hasAnyTt) {
      const destinations = [];
      if (hasAnyFb) {
        destinations.push({
          platform: "facebook",
          id: fb.id,
          server_url: fb.server_url,
          stream_key: fb.stream_key,
          secure_stream_url: fb.secure_stream_url,
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
          secure_stream_url: yt.secure_stream_url,
        });
      }
      if (hasAnyTt) {
        destinations.push({
          platform: "tiktok",
          id: tt.id,
          server_url: tt.server_url,
          stream_key: tt.stream_key,
          room_url: tt.room_url,
          secure_stream_url: tt.secure_stream_url,
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

  // Studio URL (works with or without backend studio_url)
  const studioHref = useMemo(() => {
    return buildStudioUrl(data?.studio_url, data, match);
  }, [data, match]);

  // Also allow Studio from match snapshot when no data yet
  const studioHrefFromMatch = useMemo(() => {
    if (data) return null;
    return buildStudioUrl(null, null, match);
  }, [data, match]);

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

        {/* Quick open Studio directly (optional) */}
        {studioHrefFromMatch && (
          <Button
            size="small"
            startIcon={<OpenInNewIcon />}
            href={studioHrefFromMatch}
            target="_blank"
            variant="text"
            title="Open Studio với dữ liệu hiện có"
          >
            Open Studio
          </Button>
        )}
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
                  <Button
                    startIcon={<OpenInNewIcon />}
                    href={studioHref}
                    target="_blank"
                  >
                    Open Studio
                  </Button>
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
