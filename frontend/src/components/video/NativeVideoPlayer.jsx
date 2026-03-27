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
  Pause as PauseIcon,
  PlayArrow as PlayIcon,
  Replay10 as Replay10Icon,
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
      seconds,
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
  previewOnlyUntilPlay = false,
  useNativeControls = false,
  liveMode = false,
  queueModeEnabled = false,
  holdLastFrameOnSourceChange = false,
  stagedNextSrc = "",
  stagedNextToken = "",
  onAdvanceToStagedSource = null,
  totalDuration: totalDurationProp,
  totalTimeOffset = 0,
  onSeekGlobal = null,
}) {
  const frameRef = useRef(null);
  const videoRef = useRef(null);
  const primaryVideoRef = useRef(null);
  const secondaryVideoRef = useRef(null);
  const hideChromeTimerRef = useRef(null);
  const isSeekingRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  const onAdvanceToStagedSourceRef = useRef(onAdvanceToStagedSource);
  const previousSrcRef = useRef("");
  const previousStagedNextSrcRef = useRef("");
  const stagedNextReadyRef = useRef(false);
  const activeSlotRef = useRef(0);
  const slotSrcRef = useRef({ 0: "", 1: "" });
  const switchingToStagedRef = useRef(false);

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
  const [activeSlot, setActiveSlot] = useState(0);
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(
    Boolean(previewOnlyUntilPlay && !autoplay),
  );
  const [frozenFrameUrl, setFrozenFrameUrl] = useState("");
  const [stagedNextReady, setStagedNextReady] = useState(false);
  const queueMode = Boolean(
    queueModeEnabled &&
      kind === "file" &&
      onAdvanceToStagedSource &&
      typeof onAdvanceToStagedSource === "function",
  );

  const getVideoElementForSlot = useCallback((slot) => {
    return slot === 0 ? primaryVideoRef.current : secondaryVideoRef.current;
  }, []);

  const getActiveVideoElement = useCallback(() => {
    return getVideoElementForSlot(activeSlotRef.current);
  }, [getVideoElementForSlot]);

  const getInactiveVideoElement = useCallback(() => {
    return getVideoElementForSlot(activeSlotRef.current === 0 ? 1 : 0);
  }, [getVideoElementForSlot]);

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

  const captureFrameSnapshot = useCallback(() => {
    if (!holdLastFrameOnSourceChange) return "";
    const video = videoRef.current;
    if (
      !video ||
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return "";
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return "";
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.86);
    } catch {
      return "";
    }
  }, [holdLastFrameOnSourceChange]);

  useEffect(() => {
    setRatio(initialRatio);
  }, [initialRatio, src]);

  useEffect(() => {
    setShowPreviewOverlay(Boolean(previewOnlyUntilPlay && !autoplay));
  }, [autoplay, previewOnlyUntilPlay, src]);

  useEffect(() => {
    isSeekingRef.current = isSeeking;
  }, [isSeeking]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    onAdvanceToStagedSourceRef.current = onAdvanceToStagedSource;
  }, [onAdvanceToStagedSource]);

  useEffect(() => {
    activeSlotRef.current = activeSlot;
    videoRef.current = getActiveVideoElement();
  }, [activeSlot, getActiveVideoElement]);

  useEffect(() => {
    videoRef.current = getActiveVideoElement();
  }, [getActiveVideoElement]);

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
        Boolean(activeElement && frameRef.current?.contains(activeElement)),
      );
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const activeVideo = getActiveVideoElement();
    const inactiveVideo = getInactiveVideoElement();
    if (activeVideo) {
      activeVideo.playbackRate = playbackRate;
    }
    if (inactiveVideo) {
      inactiveVideo.playbackRate = playbackRate;
    }
  }, [getActiveVideoElement, getInactiveVideoElement, playbackRate]);

  useEffect(() => {
    const activeVideo = getActiveVideoElement();
    const inactiveVideo = getInactiveVideoElement();
    if (activeVideo) {
      activeVideo.muted = isMuted;
      activeVideo.volume = volume;
    }
    if (inactiveVideo) {
      inactiveVideo.muted = isMuted;
      inactiveVideo.volume = volume;
    }
  }, [getActiveVideoElement, getInactiveVideoElement, isMuted, volume]);

  const advanceToStagedSource = useCallback(async () => {
    if (!queueMode || switchingToStagedRef.current || !stagedNextReadyRef.current) {
      return false;
    }

    const currentSlot = activeSlotRef.current;
    const nextSlot = currentSlot === 0 ? 1 : 0;
    const currentVideo = getVideoElementForSlot(currentSlot);
    const nextVideo = getVideoElementForSlot(nextSlot);
    const nextSrc = stagedNextSrc.trim();
    const nextToken = String(stagedNextToken || "").trim();

    if (!nextVideo || !nextSrc) {
      return false;
    }

    switchingToStagedRef.current = true;
    try {
      nextVideo.currentTime = 0;
      nextVideo.playbackRate = playbackRate;
      nextVideo.muted = currentVideo?.muted ?? isMuted;
      nextVideo.volume = currentVideo?.volume ?? volume;

      if (autoplay) {
        try {
          await nextVideo.play();
        } catch {
          // Let the normal ended flow handle fallback if autoplay is blocked.
        }
      }

      currentVideo?.pause();
      setFrozenFrameUrl("");
      setCurrentTime(0);
      setDuration(Number.isFinite(nextVideo.duration) ? nextVideo.duration : 0);
      setIsReady(nextVideo.readyState >= 2);
      setIsPlaying(Boolean(autoplay && !nextVideo.paused));
      stagedNextReadyRef.current = false;
      setStagedNextReady(false);
      previousStagedNextSrcRef.current = "";
      activeSlotRef.current = nextSlot;
      videoRef.current = nextVideo;
      setActiveSlot(nextSlot);
      onAdvanceToStagedSourceRef.current?.(nextToken);
      return true;
    } finally {
      switchingToStagedRef.current = false;
    }
  }, [
    autoplay,
    getVideoElementForSlot,
    isMuted,
    playbackRate,
    queueMode,
    stagedNextSrc,
    stagedNextToken,
    volume,
  ]);

  useEffect(() => {
    const video = queueMode
      ? getVideoElementForSlot(activeSlotRef.current)
      : videoRef.current;
    if (!video || !src) return;

    let hls;
    let cancelled = false;
    const currentSlot = activeSlotRef.current;
    const alreadyLoadedActiveSrc =
      queueMode && slotSrcRef.current[currentSlot] === src;
    const previousSrc =
      queueMode && alreadyLoadedActiveSrc ? src : previousSrcRef.current;

    if (
      holdLastFrameOnSourceChange &&
      previousSrc &&
      previousSrc !== src &&
      !showPreviewOverlay
    ) {
      const snapshot = captureFrameSnapshot();
      if (snapshot) {
        setFrozenFrameUrl(snapshot);
      }
    }
    previousSrcRef.current = src;

    setHlsError("");
    if (!alreadyLoadedActiveSrc) {
      setIsReady(false);
      setCurrentTime(0);
      setDuration(0);
      setSeekValue(0);
      setIsPlaying(Boolean(autoplay));
      setShowChrome(true);
    }

    const syncAspect = () => {
      if (video.videoWidth && video.videoHeight) {
        setRatio(video.videoWidth / video.videoHeight);
      }
    };
    const syncTime = () => {
      if (queueMode && stagedNextReadyRef.current && Number.isFinite(video.duration)) {
        const remaining = Math.max(0, (video.duration || 0) - (video.currentTime || 0));
        if (remaining <= 0.2) {
          void advanceToStagedSource();
          return;
        }
      }
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
    const onCanPlay = () => {
      setIsReady(true);
      setFrozenFrameUrl("");
    };
    const onEndedInternal = async () => {
      if (queueMode && (await advanceToStagedSource())) {
        return;
      }
      onEndedRef.current?.();
    };
    const onError = () => {
      if (kind === "hls") {
        setHlsError("Khong phat duoc luong HLS nay.");
      }
      setFrozenFrameUrl("");
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
        if (!alreadyLoadedActiveSrc) {
          video.src = src;
          slotSrcRef.current[currentSlot] = src;
        }
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
      if (!alreadyLoadedActiveSrc) {
        video.src = src;
        slotSrcRef.current[currentSlot] = src;
      }
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
      if (!queueMode) {
        video.removeAttribute("src");
        try {
          video.load();
        } catch {
          // noop
        }
      }
      try {
        hls?.destroy();
      } catch {
        // noop
      }
    };
  }, [
    autoplay,
    advanceToStagedSource,
    captureFrameSnapshot,
    getVideoElementForSlot,
    holdLastFrameOnSourceChange,
    kind,
    queueMode,
    showPreviewOverlay,
    src,
  ]);

  useEffect(() => {
    if (!queueMode) {
      stagedNextReadyRef.current = false;
      setStagedNextReady(false);
      previousStagedNextSrcRef.current = "";
      return;
    }

    const normalizedNextSrc = String(stagedNextSrc || "").trim();
    const inactiveSlot = activeSlotRef.current === 0 ? 1 : 0;
    const nextVideo = getVideoElementForSlot(inactiveSlot);
    if (!nextVideo || !normalizedNextSrc) {
      stagedNextReadyRef.current = false;
      setStagedNextReady(false);
      previousStagedNextSrcRef.current = "";
      return;
    }

    if (previousStagedNextSrcRef.current === normalizedNextSrc) {
      return;
    }

    let cancelled = false;
    previousStagedNextSrcRef.current = normalizedNextSrc;
    stagedNextReadyRef.current = false;
    setStagedNextReady(false);

    const handleCanPlay = () => {
      if (cancelled) return;
      stagedNextReadyRef.current = true;
      setStagedNextReady(true);
    };
    const handleLoadedMetadata = () => {
      if (cancelled) return;
      if (!isReady && nextVideo.videoWidth && nextVideo.videoHeight) {
        setRatio(nextVideo.videoWidth / nextVideo.videoHeight);
      }
    };
    const handleError = () => {
      if (cancelled) return;
      stagedNextReadyRef.current = false;
      setStagedNextReady(false);
    };

    nextVideo.addEventListener("canplay", handleCanPlay);
    nextVideo.addEventListener("loadedmetadata", handleLoadedMetadata);
    nextVideo.addEventListener("error", handleError);
    nextVideo.preload = "auto";
    nextVideo.playbackRate = playbackRate;
    nextVideo.muted = isMuted;
    nextVideo.volume = volume;

    if (slotSrcRef.current[inactiveSlot] !== normalizedNextSrc) {
      nextVideo.pause();
      nextVideo.src = normalizedNextSrc;
      slotSrcRef.current[inactiveSlot] = normalizedNextSrc;
      try {
        nextVideo.load();
      } catch {
        // noop
      }
    }

    return () => {
      cancelled = true;
      nextVideo.removeEventListener("canplay", handleCanPlay);
      nextVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
      nextVideo.removeEventListener("error", handleError);
    };
  }, [
    getVideoElementForSlot,
    isMuted,
    isReady,
    playbackRate,
    queueMode,
    stagedNextSrc,
    volume,
  ]);

  // Global duration/time for batch playback
  const displayDuration =
    Number.isFinite(totalDurationProp) && totalDurationProp > 0
      ? totalDurationProp
      : duration;
  const displayCurrentTime =
    Number.isFinite(totalDurationProp) && totalDurationProp > 0
      ? totalTimeOffset + currentTime
      : currentTime;
  const seekPercent =
    displayDuration > 0
      ? isSeeking
        ? seekValue
        : (displayCurrentTime / displayDuration) * 100
      : 0;

  const togglePlay = useCallback(
    async (event) => {
      event?.stopPropagation?.();
      const video = videoRef.current;
      if (!video) return;

      if (showPreviewOverlay) {
        setShowPreviewOverlay(false);
      }
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
    [revealChrome, showPreviewOverlay],
  );

  const seekBy = useCallback(
    (delta) => {
      const video = videoRef.current;
      if (!video) return;
      revealChrome();
      const useGlobal =
        Number.isFinite(totalDurationProp) && totalDurationProp > 0;
      if (useGlobal && onSeekGlobal) {
        const globalTarget = Math.min(
          totalDurationProp,
          Math.max(0, totalTimeOffset + (video.currentTime || 0) + delta),
        );
        // Check if target falls within current batch
        const batchEnd = totalTimeOffset + (duration || 0);
        if (globalTarget >= totalTimeOffset && globalTarget < batchEnd) {
          video.currentTime = globalTarget - totalTimeOffset;
        } else {
          const newOffset = onSeekGlobal(globalTarget);
          // After batch switch, the new component will mount at t=0
          // The seek within the new batch is approximate (can't seek within a blob)
        }
      } else {
        video.currentTime = Math.min(
          duration,
          Math.max(0, (video.currentTime || 0) + delta),
        );
      }
    },
    [duration, onSeekGlobal, revealChrome, totalDurationProp, totalTimeOffset],
  );

  const handleSeekChange = (_event, nextValue) => {
    setIsSeeking(true);
    setSeekValue(Array.isArray(nextValue) ? nextValue[0] : nextValue);
    revealChrome();
  };

  const handleSeekCommit = (_event, nextValue) => {
    const video = videoRef.current;
    if (!video) return;
    const percent = Array.isArray(nextValue) ? nextValue[0] : nextValue;
    const useGlobal =
      Number.isFinite(totalDurationProp) && totalDurationProp > 0;
    const targetGlobal = (percent / 100) * displayDuration;

    if (useGlobal && onSeekGlobal) {
      const batchEnd = totalTimeOffset + (duration || 0);
      if (targetGlobal >= totalTimeOffset && targetGlobal < batchEnd) {
        const localTime = targetGlobal - totalTimeOffset;
        video.currentTime = localTime;
        setCurrentTime(localTime);
      } else {
        onSeekGlobal(targetGlobal);
      }
    } else {
      const nextTime = (percent / 100) * duration;
      video.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
    setSeekValue(percent);
    setIsSeeking(false);
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
            onClick={showPreviewOverlay ? togglePlay : undefined}
          >
            <video
              ref={primaryVideoRef}
              playsInline
              preload={
                liveMode || holdLastFrameOnSourceChange || queueMode
                  ? "auto"
                  : "metadata"
              }
              crossOrigin={holdLastFrameOnSourceChange ? "anonymous" : undefined}
              controls={Boolean(
                useNativeControls && !showPreviewOverlay && (!queueMode || activeSlot === 0),
              )}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                backgroundColor: "#000",
                opacity: activeSlot === 0 ? 1 : 0,
                pointerEvents:
                  activeSlot === 0 ? "auto" : "none",
              }}
            />

            {queueMode ? (
              <video
                ref={secondaryVideoRef}
                playsInline
                preload="auto"
                crossOrigin={
                  holdLastFrameOnSourceChange ? "anonymous" : undefined
                }
                controls={false}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  backgroundColor: "#000",
                  opacity: activeSlot === 1 ? 1 : 0,
                  pointerEvents: activeSlot === 1 ? "auto" : "none",
                  visibility: activeSlot === 1 || stagedNextReady ? "visible" : "hidden",
                }}
              />
            ) : null}

            {frozenFrameUrl && !isReady && !showPreviewOverlay ? (
              <Box
                component="img"
                src={frozenFrameUrl}
                alt=""
                sx={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  backgroundColor: "#000",
                  zIndex: 0.5,
                  pointerEvents: "none",
                }}
              />
            ) : null}

            {!isReady && !frozenFrameUrl && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: showPreviewOverlay ? 0 : 1,
                  pointerEvents: "none",
                  transition: "opacity 160ms ease",
                  zIndex: 1,
                }}
              >
                <CircularProgress
                  size={72}
                  thickness={3}
                  sx={{ color: "rgba(255,255,255,0.9)" }}
                />
              </Box>
            )}

            {showPreviewOverlay ? (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  bgcolor: "rgba(0,0,0,0.18)",
                  backdropFilter: "blur(1px)",
                }}
                onClick={togglePlay}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    px: { xs: 1.5, sm: 2 },
                    pt: { xs: 1.5, sm: 2 },
                    alignItems: "center",
                  }}
                >
                  <Typography
                    variant="subtitle1"
                    sx={{
                      color: "#fff",
                      fontWeight: 600,
                      textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                      lineHeight: 1.2,
                    }}
                  >
                    {title}
                  </Typography>
                  {subtitle ? (
                    <Typography
                      variant="body2"
                      sx={{
                        color: "rgba(255,255,255,0.8)",
                        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                        lineHeight: 1.2,
                      }}
                    >
                      • {subtitle}
                    </Typography>
                  ) : null}
                </Stack>

                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <IconButton
                    aria-label="Phát video"
                    sx={{
                      width: { xs: 72, sm: 86 },
                      height: { xs: 72, sm: 86 },
                      color: "#fff",
                      bgcolor: "rgba(15,23,42,0.7)",
                      border: "1px solid rgba(255,255,255,0.16)",
                      boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                      pointerEvents: "auto",
                      "&:hover": {
                        bgcolor: "rgba(30,41,59,0.82)",
                      },
                    }}
                  >
                    <PlayIcon sx={{ fontSize: { xs: 42, sm: 50 } }} />
                  </IconButton>
                </Box>
              </Box>
            ) : null}

            {!useNativeControls ? (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  pointerEvents: "none",
                  opacity: showChrome && !showPreviewOverlay ? 1 : 0,
                  transition: "opacity 200ms ease",
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 20%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0.8) 100%)",
                }}
              >
                {/* ── TOP BAR (Title) ── */}
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    px: { xs: 1.5, sm: 2 },
                    pt: { xs: 1.5, sm: 2 },
                    alignItems: "center",
                    pointerEvents: "auto",
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Typography
                    variant="subtitle1"
                    sx={{
                      color: "#fff",
                      fontWeight: 600,
                      textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                      lineHeight: 1.2,
                    }}
                  >
                    {title}
                  </Typography>
                  {subtitle ? (
                    <Typography
                      variant="body2"
                      sx={{
                        color: "rgba(255,255,255,0.8)",
                        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                        lineHeight: 1.2,
                      }}
                    >
                      • {subtitle}
                    </Typography>
                  ) : null}
                </Stack>

                {/* ── CENTER ACTIONS ── */}
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="center"
                    spacing={liveMode ? { xs: 0, sm: 0 } : { xs: 4, sm: 8 }}
                    sx={{ pointerEvents: "auto" }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {!liveMode ? (
                      <IconButton
                        sx={{
                          color: "#fff",
                          bgcolor: "rgba(0,0,0,0.3)",
                          "&:hover": { bgcolor: "rgba(0,0,0,0.5)" },
                          width: { xs: 48, sm: 60 },
                          height: { xs: 48, sm: 60 },
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          seekBy(-10);
                        }}
                      >
                        <Replay10Icon sx={{ fontSize: { xs: 28, sm: 36 } }} />
                      </IconButton>
                    ) : null}

                    <IconButton
                      sx={{
                        color: "#fff",
                        bgcolor: "rgba(0,0,0,0.4)",
                        "&:hover": { bgcolor: "rgba(0,0,0,0.6)" },
                        width: { xs: 64, sm: 80 },
                        height: { xs: 64, sm: 80 },
                      }}
                      onClick={togglePlay}
                    >
                      {isPlaying ? (
                        <PauseIcon sx={{ fontSize: { xs: 42, sm: 54 } }} />
                        ) : (
                          <PlayIcon sx={{ fontSize: { xs: 42, sm: 54 } }} />
                        )}
                    </IconButton>

                    {!liveMode ? (
                      <IconButton
                        sx={{
                          color: "#fff",
                          bgcolor: "rgba(0,0,0,0.3)",
                          "&:hover": { bgcolor: "rgba(0,0,0,0.5)" },
                          width: { xs: 48, sm: 60 },
                          height: { xs: 48, sm: 60 },
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          seekBy(10);
                        }}
                      >
                        <Forward10Icon sx={{ fontSize: { xs: 28, sm: 36 } }} />
                      </IconButton>
                    ) : null}
                  </Stack>
                </Box>

                {/* ── BOTTOM BAR ── */}
                <Box
                  sx={{
                    px: { xs: 1.5, sm: 2 },
                    pb: { xs: 1, sm: 1.5 },
                    pointerEvents: "auto",
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ mb: 0.75 }}
                  >
                    {liveMode ? (
                      <Chip
                        size="small"
                        label="LIVE"
                        color="error"
                        sx={{
                          height: 22,
                          fontWeight: 700,
                          letterSpacing: 0.4,
                          "& .MuiChip-label": {
                            px: 1,
                          },
                        }}
                      />
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "#fff",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 500,
                          textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                          fontSize: { xs: "0.75rem", sm: "0.8rem" },
                        }}
                      >
                        {formatMediaTime(displayCurrentTime)}{" "}
                        <span style={{ opacity: 0.7 }}>
                          / {formatMediaTime(displayDuration)}
                        </span>
                      </Typography>
                    )}

                    <Box sx={{ flex: 1 }} />

                    <IconButton
                      sx={{ color: "#fff", p: 0.5 }}
                      onClick={toggleMute}
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeOffIcon fontSize="small" />
                      ) : (
                        <VolumeUpIcon fontSize="small" />
                      )}
                    </IconButton>
                    <Button
                      variant="text"
                      onClick={cyclePlaybackRate}
                      sx={{
                        color: "#fff",
                        minWidth: 0,
                        p: 0.5,
                        textTransform: "none",
                        fontWeight: 600,
                        fontSize: "0.85rem",
                      }}
                    >
                      {playbackRate}x
                    </Button>
                    <IconButton
                      sx={{ color: "#fff", p: 0.5 }}
                      onClick={toggleFullscreen}
                    >
                      {isFullscreen ? (
                        <FullscreenExitIcon fontSize="small" />
                      ) : (
                        <FullscreenIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Stack>

                  {!liveMode ? (
                    <Slider
                      size="small"
                      min={0}
                      max={100}
                      value={seekPercent}
                      onChange={handleSeekChange}
                      onChangeCommitted={handleSeekCommit}
                      sx={{
                        color: "#ff0000",
                        p: "0 !important",
                        height: 3,
                        "& .MuiSlider-thumb": {
                          width: 12,
                          height: 12,
                          transition: "0.2s",
                          "&:hover, &.Mui-focusVisible, &.Mui-active": {
                            boxShadow: "none",
                            width: 16,
                            height: 16,
                          },
                        },
                        "& .MuiSlider-rail": { opacity: 0.3, color: "#fff" },
                        "& .MuiSlider-track": { border: "none" },
                      }}
                    />
                  ) : null}
                </Box>
              </Box>
            ) : null}
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
