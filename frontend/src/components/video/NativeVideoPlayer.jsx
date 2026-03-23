/* eslint-disable react/prop-types */
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Link as MuiLink,
  Paper,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import {
  Forward10 as Forward10Icon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  PauseCircle as PauseIcon,
  PlayCircle as PlayIcon,
  Replay10 as Replay10Icon,
  Speed as SpeedIcon,
  VolumeOff as VolumeOffIcon,
  VolumeUp as VolumeUpIcon,
} from "@mui/icons-material";
import { useCallback, useEffect, useRef, useState } from "react";
import AspectMediaFrame from "./AspectMediaFrame";
import loadHlsFromCDN from "./hlsLoader";

function formatMediaTime(value) {
  const total = Number(value);
  if (!Number.isFinite(total) || total < 0) return "0:00";

  const whole = Math.floor(total);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function NativeVideoPlayer({
  src,
  kind = "file",
  fallbackUrl = "",
  initialRatio = 16 / 9,
  title = "Video",
  subtitle = "",
  onEnded,
  autoplay = true,
}) {
  const frameRef = useRef(null);
  const videoRef = useRef(null);
  const hideChromeTimerRef = useRef(null);
  const isSeekingRef = useRef(false);
  const onEndedRef = useRef(onEnded);

  const [ratio, setRatio] = useState(initialRatio);
  const [hlsError, setHlsError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(Boolean(autoplay));
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const revealChrome = useCallback(() => {
    setShowChrome(true);
    if (hideChromeTimerRef.current) {
      clearTimeout(hideChromeTimerRef.current);
      hideChromeTimerRef.current = null;
    }
    if (isPlaying) {
      hideChromeTimerRef.current = window.setTimeout(() => {
        setShowChrome(false);
      }, 2200);
    }
  }, [isPlaying]);

  useEffect(() => {
    setRatio(initialRatio);
  }, [initialRatio, src]);

  useEffect(() => {
    isSeekingRef.current = isSeeking;
  }, [isSeeking]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    revealChrome();
    return () => {
      if (hideChromeTimerRef.current) {
        clearTimeout(hideChromeTimerRef.current);
        hideChromeTimerRef.current = null;
      }
    };
  }, [revealChrome]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const activeElement = document.fullscreenElement;
      setIsFullscreen(
        Boolean(activeElement && frameRef.current?.contains(activeElement))
      );
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let hls;
    let cancelled = false;

    setHlsError("");
    setIsReady(false);
    setCurrentTime(0);
    setDuration(0);
    setSeekValue(0);
    setIsPlaying(Boolean(autoplay));
    setShowChrome(true);

    const syncAspect = () => {
      if (video.videoWidth && video.videoHeight) {
        setRatio(video.videoWidth / video.videoHeight);
      }
    };
    const syncTime = () => {
      if (!isSeekingRef.current) {
        setCurrentTime(video.currentTime || 0);
      }
    };
    const syncDuration = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const syncVolume = () => {
      setVolume(video.volume ?? 1);
      setIsMuted(Boolean(video.muted || (video.volume ?? 1) === 0));
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onCanPlay = () => setIsReady(true);
    const onEndedInternal = () => onEndedRef.current?.();
    const onError = () => {
      if (kind === "hls") {
        setHlsError("Khong phat duoc luong HLS nay.");
      }
    };

    video.addEventListener("loadedmetadata", syncAspect);
    video.addEventListener("loadedmetadata", syncDuration);
    video.addEventListener("durationchange", syncDuration);
    video.addEventListener("timeupdate", syncTime);
    video.addEventListener("volumechange", syncVolume);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("ended", onEndedInternal);
    video.addEventListener("error", onError);

    const startPlayback = async () => {
      if (!autoplay) {
        if (!cancelled) {
          setIsPlaying(false);
        }
        return;
      }

      try {
        await video.play();
        if (!cancelled) {
          setIsPlaying(true);
        }
      } catch {
        if (!cancelled) {
          setIsPlaying(false);
          setShowChrome(true);
        }
      }
    };

    if (kind === "hls") {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        startPlayback();
      } else {
        (async () => {
          try {
            const HlsCtor = await loadHlsFromCDN();
            if (cancelled) return;
            if (!HlsCtor?.isSupported()) {
              setHlsError("Trinh duyet khong ho tro HLS.");
              return;
            }

            hls = new HlsCtor({ enableWorker: true });
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
              startPlayback();
            });
            hls.on(HlsCtor.Events.ERROR, (_event, data) => {
              if (data?.fatal) {
                setHlsError("Luong HLS dang loi hoac tam ngat.");
              }
            });
          } catch {
            if (!cancelled) {
              setHlsError("Khong tai duoc trinh phat HLS.");
            }
          }
        })();
      }
    } else {
      video.src = src;
      startPlayback();
    }

    syncVolume();

    return () => {
      cancelled = true;
      if (hideChromeTimerRef.current) {
        clearTimeout(hideChromeTimerRef.current);
        hideChromeTimerRef.current = null;
      }
      video.pause();
      video.removeEventListener("loadedmetadata", syncAspect);
      video.removeEventListener("loadedmetadata", syncDuration);
      video.removeEventListener("durationchange", syncDuration);
      video.removeEventListener("timeupdate", syncTime);
      video.removeEventListener("volumechange", syncVolume);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("ended", onEndedInternal);
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // noop
      }
      try {
        hls?.destroy();
      } catch {
        // noop
      }
    };
  }, [src, kind, autoplay]);

  const seekPercent =
    duration > 0
      ? isSeeking
        ? seekValue
        : (currentTime / duration) * 100
      : 0;

  const togglePlay = useCallback(
    async (event) => {
      event?.stopPropagation?.();
      const video = videoRef.current;
      if (!video) return;

      revealChrome();

      try {
        if (video.paused) {
          await video.play();
        } else {
          video.pause();
        }
      } catch {
        setShowChrome(true);
      }
    },
    [revealChrome]
  );

  const seekBy = useCallback(
    (delta) => {
      const video = videoRef.current;
      if (!video || !duration) return;
      revealChrome();
      video.currentTime = Math.min(
        duration,
        Math.max(0, (video.currentTime || 0) + delta)
      );
    },
    [duration, revealChrome]
  );

  const handleSeekChange = (_event, nextValue) => {
    setIsSeeking(true);
    setSeekValue(Array.isArray(nextValue) ? nextValue[0] : nextValue);
    revealChrome();
  };

  const handleSeekCommit = (_event, nextValue) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const percent = Array.isArray(nextValue) ? nextValue[0] : nextValue;
    const nextTime = (percent / 100) * duration;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    setSeekValue(percent);
    setIsSeeking(false);
    revealChrome();
  };

  const handleVolumeChange = (_event, nextValue) => {
    const video = videoRef.current;
    const nextVolume =
      (Array.isArray(nextValue) ? nextValue[0] : nextValue) / 100;
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
    if (video) {
      video.volume = nextVolume;
      video.muted = nextVolume === 0;
    }
    revealChrome();
  };

  const toggleMute = (event) => {
    event?.stopPropagation?.();
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    if (!nextMuted && video.volume === 0) {
      video.volume = 0.7;
    }
    setIsMuted(video.muted);
    setVolume(video.volume ?? 1);
    revealChrome();
  };

  const cyclePlaybackRate = (event) => {
    event?.stopPropagation?.();
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const currentIndex = rates.findIndex((item) => item === playbackRate);
    setPlaybackRate(rates[(currentIndex + 1) % rates.length]);
    revealChrome();
  };

  const toggleFullscreen = async (event) => {
    event?.stopPropagation?.();
    if (!frameRef.current) return;
    revealChrome();
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await frameRef.current.requestFullscreen();
      }
    } catch {
      // noop
    }
  };

  if (!src) {
    return null;
  }

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          overflow: "hidden",
          bgcolor: "#05070b",
          borderColor: "rgba(255,255,255,0.12)",
        }}
      >
        <AspectMediaFrame ratio={ratio}>
          <Box
            ref={frameRef}
            sx={{ position: "relative", width: "100%", height: "100%" }}
            onMouseMove={revealChrome}
            onMouseLeave={() => {
              if (isPlaying) setShowChrome(false);
            }}
            onClick={togglePlay}
          >
            <video
              ref={videoRef}
              playsInline
              preload="metadata"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                backgroundColor: "#000",
              }}
            />

            {!isReady && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "rgba(0,0,0,0.32)",
                }}
              >
                <CircularProgress size={34} />
              </Box>
            )}

            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                pointerEvents: "none",
                opacity: showChrome ? 1 : 0,
                transition: "opacity 160ms ease",
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.08) 28%, rgba(0,0,0,0.08) 72%, rgba(0,0,0,0.8) 100%)",
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ px: 1.25, pt: 1.25, alignItems: "center" }}
                onClick={(event) => event.stopPropagation()}
              >
                <Chip
                  size="small"
                  label={title}
                  sx={{
                    pointerEvents: "auto",
                    bgcolor: "rgba(15,23,42,0.76)",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                />
                {subtitle ? (
                  <Typography
                    variant="caption"
                    sx={{ color: "rgba(255,255,255,0.84)" }}
                  >
                    {subtitle}
                  </Typography>
                ) : null}
              </Stack>

              <Box
                sx={{ px: 1.25, pb: 1, pointerEvents: "auto" }}
                onClick={(event) => event.stopPropagation()}
              >
                <Slider
                  size="small"
                  min={0}
                  max={100}
                  value={seekPercent}
                  onChange={handleSeekChange}
                  onChangeCommitted={handleSeekCommit}
                  sx={{
                    color: "#3b82f6",
                    mb: 0.5,
                    "& .MuiSlider-rail": { opacity: 0.24, color: "#fff" },
                  }}
                />
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Stack direction="row" spacing={0.25} alignItems="center">
                    <IconButton sx={{ color: "#fff" }} onClick={togglePlay}>
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </IconButton>
                    <IconButton
                      sx={{ color: "#fff" }}
                      onClick={(event) => {
                        event.stopPropagation();
                        seekBy(-10);
                      }}
                    >
                      <Replay10Icon />
                    </IconButton>
                    <IconButton
                      sx={{ color: "#fff" }}
                      onClick={(event) => {
                        event.stopPropagation();
                        seekBy(10);
                      }}
                    >
                      <Forward10Icon />
                    </IconButton>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "rgba(255,255,255,0.88)",
                        minWidth: 88,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <IconButton sx={{ color: "#fff" }} onClick={toggleMute}>
                      {isMuted || volume === 0 ? <VolumeOffIcon /> : <VolumeUpIcon />}
                    </IconButton>
                    <Slider
                      size="small"
                      min={0}
                      max={100}
                      value={Math.round((isMuted ? 0 : volume) * 100)}
                      onChange={handleVolumeChange}
                      sx={{
                        width: 88,
                        color: "#fff",
                        "& .MuiSlider-rail": { opacity: 0.2 },
                      }}
                    />
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<SpeedIcon />}
                      onClick={cyclePlaybackRate}
                      sx={{
                        color: "#fff",
                        minWidth: 72,
                        textTransform: "none",
                      }}
                    >
                      {playbackRate}x
                    </Button>
                    <IconButton sx={{ color: "#fff" }} onClick={toggleFullscreen}>
                      {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                    </IconButton>
                  </Stack>
                </Stack>
              </Box>
            </Box>
          </Box>
        </AspectMediaFrame>
      </Paper>

      {hlsError && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {hlsError}{" "}
          {fallbackUrl ? (
            <>
              <MuiLink href={fallbackUrl} target="_blank" rel="noreferrer">
                Mo link truc tiep
              </MuiLink>
              .
            </>
          ) : null}
        </Alert>
      )}
    </>
  );
}
