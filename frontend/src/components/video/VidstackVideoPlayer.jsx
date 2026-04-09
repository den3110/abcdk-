/* eslint-disable react/prop-types */
import { Alert, Box } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { MediaCommunitySkin, MediaOutlet, MediaPlayer } from "@vidstack/react";
import "vidstack/styles/base.css";
import "vidstack/styles/community-skin/video.css";
import "vidstack/styles/ui/buffering.css";
import "vidstack/styles/ui/buttons.css";
import "vidstack/styles/ui/captions.css";
import "vidstack/styles/ui/live.css";
import "vidstack/styles/ui/menus.css";
import "vidstack/styles/ui/sliders.css";
import "vidstack/styles/ui/tooltips.css";

function asTrimmed(value) {
  return String(value || "").trim();
}

function guessMediaType(source, url) {
  const kind = asTrimmed(source?.kind).toLowerCase();
  const normalizedUrl = asTrimmed(url).toLowerCase();

  if (kind === "hls" || normalizedUrl.includes(".m3u8")) {
    return "application/x-mpegurl";
  }
  if (normalizedUrl.includes(".webm")) {
    return "video/webm";
  }
  if (normalizedUrl.includes(".ogg") || normalizedUrl.includes(".ogv")) {
    return "video/ogg";
  }
  return "video/mp4";
}

function buildVidstackSource(source) {
  const url = asTrimmed(source?.embedUrl || source?.playUrl || source?.url);
  if (!url) return null;
  return {
    src: url,
    type: guessMediaType(source, url),
  };
}

function buildErrorMessage(detail) {
  const message = asTrimmed(detail?.message);
  if (message) return message;

  switch (Number(detail?.code)) {
    case 2:
      return "Không tải được dữ liệu video từ máy chủ.";
    case 3:
      return "Trình duyệt không giải mã được video này.";
    case 4:
      return "Nguồn video không hợp lệ hoặc không còn khả dụng.";
    default:
      return "Vidstack không phát được video này.";
  }
}

export function supportsVidstackSource(source) {
  const kind = asTrimmed(source?.kind).toLowerCase();
  return kind === "file" || kind === "hls";
}

const VIDSTACK_TRANSLATIONS = {
  Play: "Phát",
  Pause: "Tạm dừng",
  Mute: "Tắt tiếng",
  Unmute: "Bật tiếng",
  "Closed-Captions On": "Bật phụ đề",
  "Closed-Captions Off": "Tắt phụ đề",
  "Enter PiP": "Bật cửa sổ nổi",
  "Exit PiP": "Tắt cửa sổ nổi",
  "Enter Fullscreen": "Toàn màn hình",
  "Exit Fullscreen": "Thoát toàn màn hình",
  "Seek Forward": "Tua tới",
  "Seek Backward": "Tua lùi",
  Chapters: "Chương",
  Settings: "Cài đặt",
  Audio: "Âm thanh",
  Default: "Mặc định",
  Speed: "Tốc độ",
  Normal: "Bình thường",
  Quality: "Chất lượng",
  Auto: "Tự động",
  Captions: "Phụ đề",
  Off: "Tắt",
};

export default function VidstackVideoPlayer({
  source,
  title = "",
  status = "",
  poster = "",
  autoplay = true,
  muted = true,
  onMutedChange,
  objectFit = "contain",
}) {
  const playerRef = useRef(null);
  const [playerError, setPlayerError] = useState("");
  const playerSource = useMemo(() => buildVidstackSource(source), [source]);
  const playerKey = asTrimmed(source?.key || playerSource?.src || source?.url);
  const streamType =
    asTrimmed(status).toLowerCase() === "live" ? "live" : "on-demand";

  useEffect(() => {
    const player = playerRef.current;
    if (!player || typeof muted !== "boolean") return;
    player.muted = muted;
  }, [muted, playerKey]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;

    const handleVolumeChange = () => {
      onMutedChange?.(Boolean(player.muted || player.volume === 0));
    };
    const handleCanPlay = () => {
      setPlayerError("");
    };
    const handleError = (event) => {
      setPlayerError(buildErrorMessage(event?.detail));
    };

    player.addEventListener("volume-change", handleVolumeChange);
    player.addEventListener("can-play", handleCanPlay);
    player.addEventListener("error", handleError);

    return () => {
      player.removeEventListener("volume-change", handleVolumeChange);
      player.removeEventListener("can-play", handleCanPlay);
      player.removeEventListener("error", handleError);
    };
  }, [onMutedChange, playerKey]);

  if (!playerSource) {
    return null;
  }

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        "& media-player": {
          display: "block",
          width: "100%",
          height: "100%",
          backgroundColor: "#000",
          "--video-bg": "transparent",
          "--video-border": "0 solid transparent",
          "--video-border-radius": "0px",
          "--video-brand": "#25f4ee",
          "--video-controls-color": "#f8fafc",
          "--video-title-color": "#f8fafc",
          "--video-font-family":
            '"Montserrat Variable", "Google Sans Code Variable", sans-serif',
          "--video-focus-ring": "0 0 0 3px rgba(37,244,238,0.4)",
        },
        "& media-player media-outlet, & media-player video, & media-player media-poster":
          {
            width: "100%",
            height: "100%",
          },
        "& media-player video": {
          objectFit,
        },
        '& media-player media-community-skin[data-video] [part="main-title"]': {
          display: "none",
        },
      }}
    >
      <MediaPlayer
        key={playerKey}
        ref={playerRef}
        title={title || "PickleTour"}
        src={playerSource}
        poster={poster || undefined}
        viewType="video"
        streamType={streamType}
        load="eager"
        autoplay={autoplay}
        playsinline
        muted={Boolean(muted)}
        controls={false}
        preload="auto"
        preferNativeHLS={false}
        logLevel="warn"
        style={{ width: "100%", height: "100%" }}
      >
        <MediaOutlet />
        <MediaCommunitySkin translations={VIDSTACK_TRANSLATIONS} />
      </MediaPlayer>

      {playerError ? (
        <Alert
          severity="warning"
          sx={{
            position: "absolute",
            left: { xs: 14, sm: 18 },
            right: { xs: 14, sm: 18 },
            bottom: { xs: 108, sm: 120 },
            zIndex: 4,
            bgcolor: "rgba(17,24,39,0.88)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.14)",
            backdropFilter: "blur(12px)",
            "& .MuiAlert-icon": {
              color: "#f6d365",
            },
          }}
        >
          {playerError}
        </Alert>
      ) : null}
    </Box>
  );
}
