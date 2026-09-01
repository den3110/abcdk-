// screens/EventLivePage.jsx — Xem live giải đấu (vd Heineken Pickleball World Cup 2026)
import React, { useState, useMemo, useEffect } from "react";
import {
  Box,
  Container,
  Typography,
  Tabs,
  Tab,
  Chip,
  Card,
  Stack,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Grid,
  Avatar,
} from "@mui/material";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import ReplayIcon from "@mui/icons-material/Replay";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import YouTubeIcon from "@mui/icons-material/YouTube";
import PictureInPictureAltIcon from "@mui/icons-material/PictureInPictureAlt";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import CloseIcon from "@mui/icons-material/Close";
import {
  useGetEventLiveQuery,
  useTrackEventLiveViewMutation,
} from "../slices/eventLiveApiSlice";
import { logCustomEvent } from "../utils/analytics";
import SEOHead from "../components/SEOHead";

const PULSE_CSS = `@keyframes elvPulse{0%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.35)}100%{opacity:1;transform:scale(1)}}`;

const angleColor = (angle) =>
  angle === "kitchen"
    ? "#22c55e"
    : angle === "overhead"
      ? "#a855f7"
      : angle === "baseline"
        ? "#f59e0b"
        : "#3b82f6";

function LiveDot() {
  return (
    <Box
      component="span"
      sx={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        bgcolor: "#ff2d2d",
        display: "inline-block",
        animation: "elvPulse 1.2s infinite",
        mr: 0.75,
        boxShadow: "0 0 8px #ff2d2d",
      }}
    />
  );
}

function Player({ active }) {
  // Mặc định phát tắt tiếng để autoplay không bị chặn (chặn -> hiện nút to
  // "Xem trên YouTube"). Người dùng bấm "Bật tiếng" để nghe.
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    setMuted(true);
  }, [active?.videoId]);

  if (!active?.videoId) {
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          borderRadius: 3,
          bgcolor: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
        }}
      >
        <Typography>Chọn một sân/góc cam để xem</Typography>
      </Box>
    );
  }

  // Kênh tắt nhúng (vd FPT Bóng Đá) -> iframe lỗi 150/152; mở thẳng YouTube.
  if (active.embeddable === false) {
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          borderRadius: 3,
          bgcolor: "#000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          textAlign: "center",
          px: 3,
        }}
      >
        <YouTubeIcon sx={{ color: "#ff2d2d", fontSize: 44 }} />
        <Typography sx={{ color: "#fff", fontWeight: 800 }}>
          Luồng này chỉ xem được trên YouTube
        </Typography>
        <Typography sx={{ color: "#94a3b8", fontSize: 13 }}>
          Kênh nguồn không cho phép nhúng video.
        </Typography>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          href={`https://www.youtube.com/watch?v=${active.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            bgcolor: "#fff",
            color: "#0a0e1a",
            fontWeight: 800,
            textTransform: "none",
            borderRadius: 2,
            "&:hover": { bgcolor: "#eaeaea" },
          }}
        >
          Mở trên YouTube
        </Button>
      </Box>
    );
  }

  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    iv_load_policy: "3", // ẩn chú thích/annotation
    fs: "1",
    color: "white",
    controls: "1",
    enablejsapi: "1",
    // origin thật giúp YouTube cho phép nhúng ổn định (tránh lỗi 150/152).
    origin:
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://pickletour.vn",
  });

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 3,
        overflow: "hidden",
        bgcolor: "#000",
        boxShadow: "0 10px 40px rgba(0,0,0,.5)",
      }}
    >
      <iframe
        key={`${active.videoId}-${muted ? "m" : "s"}`}
        title={active.title || "live"}
        src={`https://www.youtube-nocookie.com/embed/${active.videoId}?${params.toString()}`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
      {/* Overlay che thanh tiêu đề/kênh/nút chia sẻ (góc trên) — nơi lộ chữ + link YouTube.
          Chỉ che dải trên cùng, vùng giữa/điều khiển dưới vẫn bấm được. */}
      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: { xs: 44, sm: 64 },
          zIndex: 2,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.35), rgba(0,0,0,0))",
        }}
      />
      {muted && (
        <Button
          size="small"
          startIcon={<VolumeUpIcon />}
          onClick={() => setMuted(false)}
          sx={{
            position: "absolute",
            left: 12,
            bottom: { xs: 48, sm: 54 },
            zIndex: 3,
            bgcolor: "rgba(0,0,0,.7)",
            color: "#fff",
            textTransform: "none",
            fontWeight: 700,
            borderRadius: 2,
            px: 1.5,
            "&:hover": { bgcolor: "rgba(0,0,0,.85)" },
          }}
        >
          Bật tiếng
        </Button>
      )}
    </Box>
  );
}

// Cửa sổ PiP nhỏ (góc trên player chính) — luôn tắt tiếng, xem sân thứ 2.
function MiniPlayer({ feed, onSwap, onClose }) {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://pickletour.vn";
  const src = `https://www.youtube.com/embed/${feed.videoId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&controls=1&enablejsapi=1&origin=${encodeURIComponent(
    origin,
  )}`;
  return (
    <Box
      sx={{
        position: "absolute",
        top: 10,
        right: 10,
        width: { xs: "44%", sm: "34%", md: "30%" },
        maxWidth: 340,
        zIndex: 5,
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "#000",
        border: "1px solid rgba(255,255,255,.25)",
        boxShadow: "0 8px 28px rgba(0,0,0,.6)",
      }}
    >
      <Box sx={{ position: "relative", width: "100%", aspectRatio: "16/9" }}>
        {feed.embeddable === false ? (
          <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", p: 1, textAlign: "center" }}>
            <Typography variant="caption" sx={{ color: "#cbd5e1" }}>
              Luồng này chỉ xem trên YouTube
            </Typography>
          </Box>
        ) : (
          <iframe
            key={feed.videoId}
            title={feed.title || "pip"}
            src={src}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            allow="autoplay; encrypted-media; picture-in-picture"
          />
        )}
        {/* dải điều khiển PiP */}
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            px: 0.5,
            py: 0.25,
            background: "linear-gradient(to bottom, rgba(0,0,0,.6), rgba(0,0,0,0))",
          }}
        >
          <Typography variant="caption" sx={{ color: "#fff", fontWeight: 700, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} noWrap>
            {feed.courtLabel}
          </Typography>
          <Tooltip title="Đổi với màn chính">
            <IconButton size="small" onClick={onSwap} sx={{ color: "#fff", p: 0.25 }}>
              <SwapHorizIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Đóng">
            <IconButton size="small" onClick={onClose} sx={{ color: "#fff", p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
    </Box>
  );
}

export default function EventLivePage() {
  const { data, isLoading, isError } = useGetEventLiveQuery(undefined, {
    pollingInterval: 60000,
    refetchOnMountOrArgChange: true,
  });
  const [tab, setTab] = useState(0);
  const [active, setActive] = useState(null);
  const [pip, setPip] = useState(null); // cửa sổ PiP (sân thứ 2)
  const [trackView] = useTrackEventLiveViewMutation();

  // Ghi nhận lượt dùng (1 lần khi mở trang) — cho thống kê web/app.
  useEffect(() => {
    let did = "";
    try {
      did = localStorage.getItem("elv_did") || "";
      if (!did) {
        did = `w_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        localStorage.setItem("elv_did", did);
      }
    } catch {
      /* ignore */
    }
    trackView({ deviceId: did }).catch(() => {});
    try {
      logCustomEvent("event_live_open", { platform: "web" });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eventName = data?.eventName || "Xem trực tiếp giải đấu";
  const live = useMemo(() => data?.live || [], [data]);
  const replays = useMemo(() => data?.replays || [], [data]);
  const totalLive = live.reduce((n, c) => n + (c.angles?.length || 0), 0);
  const courtCount = new Set(
    [...live, ...replays].map((c) => c.courtKey ?? c.courtLabel),
  ).size;

  useEffect(() => {
    if (active) return;
    // Ưu tiên chọn luồng NHÚNG được (bỏ qua kênh tắt nhúng như FPT).
    let picked = null;
    for (const c of live) {
      for (const a of c.angles || []) {
        if (a.embeddable !== false) {
          picked = { ...a, courtLabel: c.courtLabel };
          break;
        }
      }
      if (picked) break;
    }
    if (!picked && live[0]?.angles?.length) {
      picked = { ...live[0].angles[0], courtLabel: live[0].courtLabel };
    }
    if (picked) setActive(picked);
  }, [live, active]);

  const pick = (v, courtLabel) => setActive({ ...v, courtLabel });
  const isActive = (v) => active?.videoId === v.videoId;
  const openPip = (v, courtLabel) => {
    if (active?.videoId === v.videoId) return; // đang là màn chính -> bỏ qua
    setPip({ ...v, courtLabel });
  };
  const swapPip = () => {
    if (!pip) return;
    setActive(pip);
    setPip(active);
  };

  return (
    <Box
      sx={{
        bgcolor: "#0a0e1a",
        minHeight: { xs: "100vh", md: "auto" },
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SEOHead title={`${eventName} — Trực tiếp`} />
      <style>{PULSE_CSS}</style>

      {/* HERO (gọn) */}
      <Box
        sx={{
          background:
            "linear-gradient(135deg,#111827 0%,#1e293b 40%,#7f1d1d 120%)",
          color: "#fff",
          py: 1.25,
          borderBottom: "1px solid rgba(255,255,255,.08)",
          flexShrink: 0,
        }}
      >
        <Container maxWidth={false} sx={{ px: { xs: 2, md: 3 } }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            {data?.eventLogoUrl ? (
              <Avatar
                src={data.eventLogoUrl}
                variant="rounded"
                sx={{ width: 42, height: 42, bgcolor: "transparent" }}
              />
            ) : (
              <Avatar sx={{ width: 42, height: 42, bgcolor: "#dc2626" }}>
                <LiveTvIcon fontSize="small" />
              </Avatar>
            )}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                fontWeight={900}
                sx={{ fontSize: { xs: 15, md: 18 }, lineHeight: 1.2 }}
                noWrap
              >
                {eventName}
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
                {totalLive > 0 ? (
                  <Chip
                    size="small"
                    label={
                      <span>
                        <LiveDot />
                        {totalLive} cam trực tiếp
                      </span>
                    }
                    sx={{ bgcolor: "rgba(255,45,45,.15)", color: "#ff6b6b", fontWeight: 800, height: 22 }}
                  />
                ) : (
                  <Chip
                    size="small"
                    label="Chưa có luồng trực tiếp"
                    sx={{ bgcolor: "rgba(255,255,255,.1)", color: "#cbd5e1", height: 22 }}
                  />
                )}
                <Chip
                  size="small"
                  icon={<SportsTennisIcon sx={{ color: "#fbbf24 !important" }} />}
                  label={`${courtCount} sân`}
                  sx={{ bgcolor: "rgba(251,191,36,.12)", color: "#fbbf24", fontWeight: 700, height: 22 }}
                />
              </Stack>
            </Box>
          </Stack>
        </Container>
      </Box>

      {/* MAIN: 2 cột — player trái + danh sách sân cuộn phải */}
      <Box sx={{ flex: 1, minHeight: 0, px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 } }}>
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              gap: 2,
              height: { md: "calc(100vh - 178px)" },
              minHeight: { md: 360 },
            }}
          >
            {/* LEFT: player */}
            <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              <Box
                sx={{
                  position: "relative",
                  flex: { md: 1 },
                  minHeight: 0,
                  width: "100%",
                  aspectRatio: { xs: "16/9", md: "auto" },
                }}
              >
                <Player active={active} />
                {pip && (
                  <MiniPlayer
                    feed={pip}
                    onSwap={swapPip}
                    onClose={() => setPip(null)}
                  />
                )}
              </Box>
              {active && (
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ color: "#e5e7eb", flexWrap: "wrap", flexShrink: 0 }}
                >
                  <Chip
                    size="small"
                    label={active.courtLabel}
                    sx={{ bgcolor: "#1f2937", color: "#fff", fontWeight: 800 }}
                  />
                  <Chip
                    size="small"
                    label={active.angleLabelDisplay || active.angleLabel}
                    sx={{
                      bgcolor: angleColor(active.angle) + "22",
                      color: angleColor(active.angle),
                      fontWeight: 700,
                    }}
                  />
                  <Typography variant="body2" sx={{ color: "#94a3b8", ml: 0.5, minWidth: 0 }} noWrap>
                    {active.title}
                  </Typography>
                </Stack>
              )}
            </Box>

            {/* RIGHT: sidebar cuộn nội bộ */}
            <Box
              sx={{
                width: { xs: "100%", md: 400 },
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                bgcolor: "#0d1424",
                border: "1px solid rgba(255,255,255,.06)",
                borderRadius: 2,
                overflow: "hidden",
                maxHeight: { xs: "72vh", md: "none" },
              }}
            >
              <Tabs
                value={tab}
                onChange={(e, v) => setTab(v)}
                variant="fullWidth"
                sx={{
                  flexShrink: 0,
                  minHeight: 44,
                  borderBottom: "1px solid rgba(255,255,255,.06)",
                  "& .MuiTab-root": { color: "#94a3b8", fontWeight: 800, minHeight: 44, fontSize: 13 },
                  "& .Mui-selected": { color: "#fff !important" },
                }}
                TabIndicatorProps={{ sx: { bgcolor: "#dc2626", height: 3 } }}
              >
                <Tab
                  icon={<LiveTvIcon fontSize="small" />}
                  iconPosition="start"
                  label={`Trực tiếp${totalLive ? ` (${totalLive})` : ""}`}
                />
                <Tab icon={<ReplayIcon fontSize="small" />} iconPosition="start" label="Xem lại" />
              </Tabs>

              <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, p: 1 }}>

                {/* LIVE */}
                {tab === 0 &&
                  (live.length === 0 ? (
                    <Typography sx={{ color: "#94a3b8", py: 4, textAlign: "center" }}>
                      Hiện chưa có sân nào trực tiếp.
                    </Typography>
                  ) : (
                    <Stack spacing={1}>
                      {live.map((court) => (
                        <Card
                          key={court.courtKey || court.courtLabel}
                          sx={{ bgcolor: "#111827", border: "1px solid rgba(255,255,255,.08)", borderRadius: 2, p: 1.25 }}
                        >
                          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
                            <SportsTennisIcon sx={{ color: "#fbbf24" }} fontSize="small" />
                            <Typography fontWeight={800} sx={{ color: "#fff", fontSize: 14 }} noWrap>
                              {court.courtLabel}
                            </Typography>
                            <Chip
                              size="small"
                              label={<span><LiveDot />LIVE</span>}
                              sx={{ ml: "auto", bgcolor: "rgba(255,45,45,.15)", color: "#ff6b6b", fontWeight: 800, height: 20 }}
                            />
                            {(() => {
                              const firstEmbed = (court.angles || []).find(
                                (a) => a.embeddable !== false,
                              );
                              if (!firstEmbed) return null;
                              return (
                                <Tooltip title="Xem ở cửa sổ nhỏ (PiP)">
                                  <IconButton
                                    size="small"
                                    onClick={() => openPip(firstEmbed, court.courtLabel)}
                                    sx={{ color: "#38bdf8", p: 0.25 }}
                                  >
                                    <PictureInPictureAltIcon sx={{ fontSize: 18 }} />
                                  </IconButton>
                                </Tooltip>
                              );
                            })()}
                          </Stack>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            {(court.angles || []).map((a) => (
                              <Button
                                key={a.videoId}
                                size="small"
                                variant={isActive(a) ? "contained" : "outlined"}
                                startIcon={a.embeddable === false ? <YouTubeIcon /> : <PlayArrowIcon />}
                                onClick={() => pick(a, court.courtLabel)}
                                sx={{
                                  textTransform: "none",
                                  fontWeight: 700,
                                  borderRadius: 2,
                                  py: 0.25,
                                  color: isActive(a) ? "#fff" : angleColor(a.angle),
                                  borderColor: angleColor(a.angle),
                                  bgcolor: isActive(a) ? angleColor(a.angle) : "transparent",
                                  "&:hover": {
                                    bgcolor: isActive(a) ? angleColor(a.angle) : angleColor(a.angle) + "22",
                                    borderColor: angleColor(a.angle),
                                  },
                                }}
                              >
                                {a.angleLabelDisplay || a.angleLabel}
                              </Button>
                            ))}
                          </Stack>
                        </Card>
                      ))}
                    </Stack>
                  ))}

                {/* REPLAY */}
                {tab === 1 &&
                  (replays.length === 0 ? (
                    <Typography sx={{ color: "#94a3b8", py: 4, textAlign: "center" }}>
                      Chưa có video xem lại.
                    </Typography>
                  ) : (
                    <Stack spacing={1.5}>
                      {replays.map((court) => (
                        <Box key={court.courtKey || court.courtLabel}>
                          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
                            <SportsTennisIcon sx={{ color: "#fbbf24" }} fontSize="small" />
                            <Typography fontWeight={800} sx={{ color: "#fff", fontSize: 13.5 }} noWrap>
                              {court.courtLabel}
                            </Typography>
                            <Chip
                              size="small"
                              label={`${court.videos?.length || 0}`}
                              sx={{ ml: "auto", bgcolor: "#1f2937", color: "#cbd5e1", height: 20 }}
                            />
                          </Stack>
                          <Stack spacing={0.75}>
                            {(court.videos || []).map((v) => (
                              <Stack
                                key={v.videoId}
                                direction="row"
                                spacing={1}
                                onClick={() => pick(v, court.courtLabel)}
                                sx={{
                                  cursor: "pointer",
                                  alignItems: "center",
                                  p: 0.5,
                                  borderRadius: 1.5,
                                  border: isActive(v) ? "1px solid #dc2626" : "1px solid transparent",
                                  "&:hover": { bgcolor: "rgba(255,255,255,.04)" },
                                }}
                              >
                                <Box sx={{ position: "relative", width: 104, flexShrink: 0, aspectRatio: "16/9", bgcolor: "#000", borderRadius: 1, overflow: "hidden" }}>
                                  {v.thumbnail && (
                                    <img
                                      src={v.thumbnail}
                                      alt={v.title}
                                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                      loading="lazy"
                                    />
                                  )}
                                </Box>
                                <Box sx={{ minWidth: 0 }}>
                                  <Chip
                                    size="small"
                                    label={v.angleLabelDisplay || v.angleLabel}
                                    sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: angleColor(v.angle), color: "#fff", mb: 0.25 }}
                                  />
                                  <Typography
                                    variant="caption"
                                    sx={{ display: "block", color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                  >
                                    {v.title}
                                  </Typography>
                                </Box>
                              </Stack>
                            ))}
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  ))}
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
