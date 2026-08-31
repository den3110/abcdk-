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
  CircularProgress,
  Grid,
  Avatar,
} from "@mui/material";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import ReplayIcon from "@mui/icons-material/Replay";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useGetEventLiveQuery } from "../slices/eventLiveApiSlice";
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
  if (!active?.videoId) {
    return (
      <Box
        sx={{
          aspectRatio: "16/9",
          width: "100%",
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
  return (
    <Box
      sx={{
        position: "relative",
        aspectRatio: "16/9",
        width: "100%",
        borderRadius: 3,
        overflow: "hidden",
        bgcolor: "#000",
        boxShadow: "0 10px 40px rgba(0,0,0,.5)",
      }}
    >
      <iframe
        key={active.videoId}
        title={active.title || "live"}
        src={`https://www.youtube.com/embed/${active.videoId}?autoplay=1&rel=0&modestbranding=1`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
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

  const eventName = data?.eventName || "Xem trực tiếp giải đấu";
  const live = useMemo(() => data?.live || [], [data]);
  const replays = useMemo(() => data?.replays || [], [data]);
  const totalLive = live.reduce((n, c) => n + (c.angles?.length || 0), 0);
  const courtCount = new Set(
    [...live, ...replays].map((c) => c.courtKey ?? c.courtLabel),
  ).size;

  useEffect(() => {
    if (!active && live.length && live[0].angles?.length) {
      const a = live[0].angles[0];
      setActive({ ...a, courtLabel: live[0].courtLabel });
    }
  }, [live, active]);

  const pick = (v, courtLabel) => setActive({ ...v, courtLabel });
  const isActive = (v) => active?.videoId === v.videoId;

  return (
    <Box sx={{ bgcolor: "#0a0e1a", minHeight: "100vh", pb: 6 }}>
      <SEOHead title={`${eventName} — Trực tiếp`} />
      <style>{PULSE_CSS}</style>

      {/* HERO */}
      <Box
        sx={{
          background:
            "linear-gradient(135deg,#111827 0%,#1e293b 40%,#7f1d1d 120%)",
          color: "#fff",
          py: { xs: 3, md: 4 },
          borderBottom: "1px solid rgba(255,255,255,.08)",
        }}
      >
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" spacing={2}>
            {data?.eventLogoUrl ? (
              <Avatar
                src={data.eventLogoUrl}
                variant="rounded"
                sx={{ width: 56, height: 56, bgcolor: "transparent" }}
              />
            ) : (
              <Avatar sx={{ width: 56, height: 56, bgcolor: "#dc2626" }}>
                <LiveTvIcon />
              </Avatar>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="h5"
                fontWeight={900}
                sx={{ lineHeight: 1.15, textShadow: "0 2px 12px rgba(0,0,0,.5)" }}
              >
                {eventName}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                {totalLive > 0 ? (
                  <Chip
                    size="small"
                    label={
                      <span>
                        <LiveDot />
                        {totalLive} cam đang trực tiếp
                      </span>
                    }
                    sx={{ bgcolor: "rgba(255,45,45,.15)", color: "#ff6b6b", fontWeight: 800 }}
                  />
                ) : (
                  <Chip
                    size="small"
                    label="Chưa có luồng trực tiếp"
                    sx={{ bgcolor: "rgba(255,255,255,.1)", color: "#cbd5e1" }}
                  />
                )}
                <Chip
                  size="small"
                  icon={<SportsTennisIcon sx={{ color: "#fbbf24 !important" }} />}
                  label={`${courtCount} sân`}
                  sx={{ bgcolor: "rgba(251,191,36,.12)", color: "#fbbf24", fontWeight: 700 }}
                />
              </Stack>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ pt: 2.5 }}>
        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* PLAYER */}
            <Box sx={{ maxWidth: 960, mx: "auto" }}>
              <Player active={active} />
              {active && (
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mt: 1.25, color: "#e5e7eb", flexWrap: "wrap" }}
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
                  <Typography variant="body2" sx={{ color: "#94a3b8", ml: 0.5 }} noWrap>
                    {active.title}
                  </Typography>
                </Stack>
              )}
            </Box>

            {/* TABS */}
            <Tabs
              value={tab}
              onChange={(e, v) => setTab(v)}
              sx={{
                mt: 3,
                "& .MuiTab-root": { color: "#94a3b8", fontWeight: 800 },
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

            {/* LIVE TAB */}
            {tab === 0 && (
              <Box sx={{ mt: 2 }}>
                {live.length === 0 ? (
                  <Typography sx={{ color: "#94a3b8", py: 4, textAlign: "center" }}>
                    Hiện chưa có sân nào trực tiếp. Kéo xuống tab “Xem lại”.
                  </Typography>
                ) : (
                  <Grid container spacing={1.5}>
                    {live.map((court) => (
                      <Grid size={{ xs: 12, sm: 6, md: 4 }} key={court.courtKey || court.courtLabel}>
                        <Card
                          sx={{
                            bgcolor: "#111827",
                            border: "1px solid rgba(255,255,255,.08)",
                            borderRadius: 3,
                            p: 1.5,
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                            <SportsTennisIcon sx={{ color: "#fbbf24" }} fontSize="small" />
                            <Typography fontWeight={900} sx={{ color: "#fff" }}>
                              {court.courtLabel}
                            </Typography>
                            <Chip
                              size="small"
                              label={<span><LiveDot />LIVE</span>}
                              sx={{ ml: "auto", bgcolor: "rgba(255,45,45,.15)", color: "#ff6b6b", fontWeight: 800, height: 22 }}
                            />
                          </Stack>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            {(court.angles || []).map((a) => (
                              <Button
                                key={a.videoId}
                                size="small"
                                variant={isActive(a) ? "contained" : "outlined"}
                                startIcon={<PlayArrowIcon />}
                                onClick={() => pick(a, court.courtLabel)}
                                sx={{
                                  textTransform: "none",
                                  fontWeight: 700,
                                  borderRadius: 2,
                                  color: isActive(a) ? "#fff" : angleColor(a.angle),
                                  borderColor: angleColor(a.angle),
                                  bgcolor: isActive(a) ? angleColor(a.angle) : "transparent",
                                  "&:hover": {
                                    bgcolor: isActive(a)
                                      ? angleColor(a.angle)
                                      : angleColor(a.angle) + "22",
                                    borderColor: angleColor(a.angle),
                                  },
                                }}
                              >
                                {a.angleLabelDisplay || a.angleLabel}
                              </Button>
                            ))}
                          </Stack>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </Box>
            )}

            {/* REPLAY TAB */}
            {tab === 1 && (
              <Box sx={{ mt: 2 }}>
                {replays.length === 0 ? (
                  <Typography sx={{ color: "#94a3b8", py: 4, textAlign: "center" }}>
                    Chưa có video xem lại.
                  </Typography>
                ) : (
                  replays.map((court) => (
                    <Box key={court.courtKey || court.courtLabel} sx={{ mb: 3 }}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                        <SportsTennisIcon sx={{ color: "#fbbf24" }} fontSize="small" />
                        <Typography fontWeight={900} sx={{ color: "#fff" }}>
                          {court.courtLabel}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${court.videos?.length || 0} video`}
                          sx={{ bgcolor: "#1f2937", color: "#cbd5e1", height: 22 }}
                        />
                      </Stack>
                      <Grid container spacing={1.25}>
                        {(court.videos || []).map((v) => (
                          <Grid size={{ xs: 6, sm: 4, md: 3 }} key={v.videoId}>
                            <Card
                              onClick={() => pick(v, court.courtLabel)}
                              sx={{
                                cursor: "pointer",
                                bgcolor: "#111827",
                                border: isActive(v)
                                  ? "2px solid #dc2626"
                                  : "1px solid rgba(255,255,255,.08)",
                                borderRadius: 2,
                                overflow: "hidden",
                              }}
                            >
                              <Box sx={{ position: "relative", aspectRatio: "16/9", bgcolor: "#000" }}>
                                {v.thumbnail && (
                                  <img
                                    src={v.thumbnail}
                                    alt={v.title}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    loading="lazy"
                                  />
                                )}
                                <Chip
                                  size="small"
                                  label={v.angleLabelDisplay || v.angleLabel}
                                  sx={{
                                    position: "absolute",
                                    left: 6,
                                    bottom: 6,
                                    height: 20,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    bgcolor: angleColor(v.angle),
                                    color: "#fff",
                                  }}
                                />
                              </Box>
                              <Typography
                                variant="caption"
                                sx={{
                                  display: "block",
                                  color: "#cbd5e1",
                                  px: 0.75,
                                  py: 0.5,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {v.title}
                              </Typography>
                            </Card>
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  ))
                )}
              </Box>
            )}
          </>
        )}
      </Container>
    </Box>
  );
}
