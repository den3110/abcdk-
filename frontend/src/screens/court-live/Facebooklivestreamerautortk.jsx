// FacebookLiveStreamerAutoRTK.jsx — AUTO + BINARY PIPELINE (refactor + serve indicator + camera switch)
// - WebCodecs H.264 Annex-B (binary) + Audio (MediaRecorder, prefix 0x01)
// - Auto Mode (RTK Query): phát khi có trận, tạo live, tự đếm 3-2-1
// - Rút outputs trực tiếp từ payload (tránh race), fallback từ state
// - Overlay + Preview mượt, health stats
// - ✅ Score Board luôn bật (không tắt được), có placeholder khi chưa có data
// - ✅ Serve indicator lấy từ data (serve.team / serve.number), có fallback các key phổ biến
// - ✅ Nút Đổi camera (xoay giữa các camera / trước-sau), đổi nóng khi đang LIVE
// - 🔧 FIX: startPreviewLoop hoist (function declaration) + remove khỏi deps của switchCamera để tránh TDZ

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  Box,
  Container,
  Typography,
  Button,
  Alert,
  Chip,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  FormControlLabel,
  Switch,
  Divider,
  Checkbox,
  Stack,
  Collapse,
  IconButton,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  PlayArrow,
  Stop,
  Videocam,
  Layers,
  AutoMode,
  Refresh,
  YouTube,
  LiveTv,
  Facebook,
  ExpandMore,
  ExpandLess,
  Stadium,
  OpenInNew,
  VideoLibrary,
  CheckCircle,
  Lock,
  Cameraswitch,
} from "@mui/icons-material";

// RTK Query hooks
import {
  useGetCurrentMatchByCourtQuery,
  useCreateLiveSessionMutation,
  useNotifyStreamStartedMutation,
  useNotifyStreamEndedMutation,
} from "../../slices/liveStreamingApiSlice";

// --------------------- Helpers ---------------------
const QUALITY_PRESETS = {
  low: {
    label: "Low (360p)",
    width: 640,
    height: 360,
    fps: 24,
    videoBitsPerSecond: 800,
  },
  medium: {
    label: "Medium (480p)",
    width: 854,
    height: 480,
    fps: 30,
    videoBitsPerSecond: 1500,
  },
  high: {
    label: "High (720p)",
    width: 1280,
    height: 720,
    fps: 30,
    videoBitsPerSecond: 2500,
  },
  ultra: {
    label: "Ultra (1080p)",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitsPerSecond: 4000,
  },
};

const mask = (s, head = 6, tail = 4) =>
  typeof s === "string" && s.length > head + tail
    ? `${s.slice(0, head)}…${s.slice(-tail)}`
    : s || "***";

const copyToClipboard = (text) => {
  navigator.clipboard.writeText(text).catch(() => { });
};

const joinRtmp = (server, key) => {
  if (!server || !key) return "";
  const base = server.endsWith("/") ? server.slice(0, -1) : server;
  return `${base}/${key}`;
};

// Convert ISO-BMFF -> AnnexB
const convertToAnnexB = (data, description, isKeyframe) => {
  const startCode = new Uint8Array([0, 0, 0, 1]);
  const result = [];
  if (isKeyframe && description) {
    let offset = 5;
    const numSPS = description[offset++] & 0x1f;
    for (let i = 0; i < numSPS; i++) {
      const spsLength = (description[offset] << 8) | description[offset + 1];
      offset += 2;
      result.push(startCode);
      result.push(description.slice(offset, offset + spsLength));
      offset += spsLength;
    }
    const numPPS = offset < description.length ? description[offset++] : 0;
    for (let i = 0; i < numPPS; i++) {
      const ppsLength = (description[offset] << 8) | description[offset + 1];
      offset += 2;
      result.push(startCode);
      result.push(description.slice(offset, offset + ppsLength));
      offset += ppsLength;
    }
  }
  let offset = 0;
  while (offset < data.length) {
    const nalLength =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    offset += 4;
    if (nalLength > 0 && offset + nalLength <= data.length) {
      result.push(startCode);
      result.push(data.slice(offset, offset + nalLength));
      offset += nalLength;
    } else break;
  }
  const totalLength = result.reduce((sum, arr) => sum + arr.length, 0);
  const output = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const arr of result) {
    output.set(arr, writeOffset);
    writeOffset += arr.length;
  }
  return output;
};

// Trích outputs trực tiếp từ payload create live
const outputsFromLiveData = (liveData) => {
  const outs = [];
  try {
    const p = liveData?.platforms || {};
    // Facebook
    const fbServer =
      p?.facebook?.live?.server_url ||
      (liveData?.primary?.platform === "facebook" &&
        liveData?.primary?.server_url);
    const fbKey =
      p?.facebook?.live?.stream_key ||
      (liveData?.primary?.platform === "facebook" &&
        liveData?.primary?.stream_key);
    if (fbServer && fbKey) outs.push(joinRtmp(fbServer, fbKey));

    // YouTube
    const ytServer =
      p?.youtube?.live?.server_url ||
      (liveData?.primary?.platform === "youtube" &&
        liveData?.primary?.server_url);
    const ytKey =
      p?.youtube?.live?.stream_key ||
      (liveData?.primary?.platform === "youtube" &&
        liveData?.primary?.stream_key);
    if (ytServer && ytKey) outs.push(joinRtmp(ytServer, ytKey));

    // TikTok
    const ttServer = p?.tiktok?.live?.server_url;
    const ttKey = p?.tiktok?.live?.stream_key;
    if (ttServer && ttKey) outs.push(joinRtmp(ttServer, ttKey));

    // Destinations[] fallback
    if (Array.isArray(liveData?.destinations)) {
      for (const d of liveData.destinations) {
        if (d?.server_url && d?.stream_key)
          outs.push(joinRtmp(d.server_url, d.stream_key));
      }
    }
  } catch (e) {
    console.warn("outputsFromLiveData error", e);
  }
  return Array.from(new Set(outs.filter(Boolean)));
};

// --------------------- Component ---------------------
export default function FacebookLiveStreamerAutoRTK({
  courtId = null,
  wsUrl = "wss://pickletour.vn/ws/rtmp",
  apiUrl = "http://localhost:5001/api/overlay/match",
  enableAutoMode = true,
  pollInterval = 5000,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // ==================== RTK QUERY ====================
  const {
    data: courtData,
    error: courtError,
    isLoading: loadingCourt,
    refetch: refetchCourt,
  } = useGetCurrentMatchByCourtQuery(courtId, {
    skip: !courtId,
    pollingInterval: pollInterval,
  });

  const [createLiveSession, { isLoading: creatingLive }] =
    useCreateLiveSessionMutation();
  const [notifyStreamStarted] = useNotifyStreamStartedMutation();
  const [notifyStreamEnded] = useNotifyStreamEndedMutation();

  // ==================== LOCAL STATE ====================
  const [autoMode, setAutoMode] = useState(enableAutoMode);
  const [autoStatus, setAutoStatus] = useState("⏳ Chờ trận đấu...");

  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Chưa kết nối");
  const [statusType, setStatusType] = useState("info");

  // Stream keys / platforms
  const [streamKey, setStreamKey] = useState(""); // Facebook key
  const [ytServer, setYtServer] = useState("rtmp://a.rtmp.youtube.com/live2");
  const [ytKey, setYtKey] = useState("");
  const [ttServer, setTtServer] = useState("");
  const [ttKey, setTtKey] = useState("");

  const [targetFacebook, setTargetFacebook] = useState(true);
  const [targetYoutube, setTargetYoutube] = useState(true);
  const [targetTiktok, setTargetTiktok] = useState(false);

  // URLs
  const [overlayUrl, setOverlayUrl] = useState("");
  const [studioUrl, setStudioUrl] = useState("");
  const [facebookPermalinkUrl, setFacebookPermalinkUrl] = useState("");
  const [youtubeWatchUrl, setYoutubeWatchUrl] = useState("");
  const [tiktokRoomUrl, setTiktokRoomUrl] = useState("");

  // Video settings
  const [qualityMode] = useState("high");
  // ✅ ưu tiên camera sau theo query (?cam/front/back)
  const [preferBackCamera, setPreferBackCamera] = useState(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const cam = (sp.get("cam") || sp.get("camera") || "back").toLowerCase();
      return cam !== "front";
    } catch {
      return true;
    }
  });

  // ✅ danh sách thiết bị video & thiết bị đang dùng
  const [videoDevices, setVideoDevices] = useState([]);
  const [activeVideoDeviceId, setActiveVideoDeviceId] = useState(null);

  // Overlay
  const [overlayData, setOverlayData] = useState(null);
  const lastOverlayRef = useRef(null); // giữ last non-null để tránh chớp

  const [overlayConfig, setOverlayConfig] = useState({
    scoreBoard: true, // ✅ luôn bật
    timer: true,
    tournamentName: true,
    logo: true,
    sponsors: false,
    lowerThird: false,
    socialMedia: false,
    qrCode: false,
    frameDecor: false,
    liveBadge: true,
    viewerCount: false,
  });
  const [overlayExpanded, setOverlayExpanded] = useState(!isMobile);

  // Match data
  const [currentMatch, setCurrentMatch] = useState(null);
  const [liveSession, setLiveSession] = useState(null);
  const [matchHistory, setMatchHistory] = useState([]);

  // Stream health
  const [streamHealth, setStreamHealth] = useState({
    fps: 0,
    bitrate: 0,
    dropped: 0,
  });

  const [videoSize] = useState(() => ({
    w: QUALITY_PRESETS.high.width,
    h: QUALITY_PRESETS.high.height,
  }));

  // Auto-start countdown
  const [autoStartCountdown, setAutoStartCountdown] = useState(null); // 3..2..1..null
  const autoStartTimerRef = useRef(null);
  const armedOutputsRef = useRef(null); // outputs từ payload

  // ==================== REFS ====================
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const camStreamRef = useRef(null);
  const wsRef = useRef(null);
  const encodingLoopRef = useRef(null);
  const previewLoopRef = useRef(null);
  const currentMatchIdRef = useRef(null);
  const overlayFetchingRef = useRef(false);
  const streamTimeRef = useRef(0);
  const startingRef = useRef(false); // lock tránh start trùng

  // Binary pipeline refs
  const videoEncoderRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const isEncodingRef = useRef(false);
  const frameCountRef = useRef(0);

  // ✅ đảm bảo scoreBoard luôn true (kể cả hot reload)
  useEffect(() => {
    setOverlayConfig((prev) =>
      prev?.scoreBoard ? prev : { ...prev, scoreBoard: true }
    );
  }, []);

  // ==================== CAMERA DEVICES ====================
  const refreshVideoDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const vids = devices.filter((d) => d.kind === "videoinput");
      setVideoDevices(vids);
      if (!activeVideoDeviceId && vids[0]) {
        setActiveVideoDeviceId(vids[0].deviceId);
      }
    } catch { }
  }, [activeVideoDeviceId]);

  useEffect(() => {
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      refreshVideoDevices
    );
    return () =>
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        refreshVideoDevices
      );
  }, [refreshVideoDevices]);

  // Gọi enumerateDevices sớm sau khi có quyền
  useEffect(() => {
    refreshVideoDevices();
  }, [refreshVideoDevices]);

  // ==================== OVERLAY RENDERING HELPERS ====================
  const roundRect = useCallback((ctx, x, y, width, height, radius) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }, []);

  // --- Serve helpers ---
  const getServingInfo = useCallback((data) => {
    if (!data) return { team: null, number: null };

    let team =
      data?.serve?.team ??
      data?.servingTeam ??
      data?.serveTeam ??
      data?.serverTeam ??
      data?.server ??
      data?.status?.servingTeam ??
      data?.service?.team ??
      null;

    let number =
      data?.serve?.number ??
      data?.serve?.serverNumber ??
      data?.serverNumber ??
      data?.service?.serverNumber ??
      data?.service?.number ??
      data?.service?.index ??
      null;

    if (typeof team === "string") {
      const up = team.trim().toUpperCase();
      const m = up.match(/^([AB])\s*([12])?$/);
      if (m) {
        team = m[1];
        if (m[2] && !number) number = parseInt(m[2], 10);
      }
    }

    if (!team) {
      if (data?.teams?.A?.serving) team = "A";
      else if (data?.teams?.B?.serving) team = "B";
    }

    number = Number.isFinite(number) ? Number(number) : null;

    return { team, number };
  }, []);

  const drawServeIndicator = useCallback((ctx, cx, cy, scale, serverNumber) => {
    ctx.save();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = "rgba(255,215,0,0.95)";
    ctx.shadowColor = "rgba(255,215,0,0.8)";
    ctx.shadowBlur = 8 * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, 10 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (serverNumber) {
      ctx.fillStyle = "#FFD700";
      ctx.font = `bold ${10 * scale}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(serverNumber), cx, cy);
    }
    ctx.restore();
  }, []);

  // ✅ LUÔN VẼ SCORE BOARD (placeholder khi chưa có overlayData)
  const drawScoreBoard = useCallback(
    (ctx, w, h, dataIn) => {
      const data = dataIn || lastOverlayRef.current || null;

      const scale = Math.min(w / 1280, 1);
      const x = 20 * scale;
      const y = 20 * scale;
      const width = 320 * scale;

      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.9)";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 15 * scale;
      roundRect(ctx, x, y, width, 120 * scale, 12 * scale);
      ctx.fill();
      ctx.shadowBlur = 0;

      // tiêu đề
      ctx.fillStyle = "#9AA4AF";
      ctx.font = `500 ${11 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(
        data?.tournament?.name || "Tournament",
        x + 14 * scale,
        y + 22 * scale
      );

      // Team A
      const teamA = data?.teams?.A?.name || "Team A";
      const scoreA =
        data?.gameScores?.[data?.currentGame || 0]?.a ?? data?.score?.a ?? 0;

      const dotAx = x + 18 * scale;
      const dotAy = y + 45 * scale;
      ctx.fillStyle = "#25C2A0";
      ctx.beginPath();
      ctx.arc(dotAx, dotAy, 5 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#E6EDF3";
      ctx.font = `600 ${16 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(teamA, x + 32 * scale, y + 50 * scale);
      ctx.font = `800 ${24 * scale}px Arial`;
      ctx.textAlign = "right";
      ctx.fillText(String(scoreA), x + width - 14 * scale, y + 50 * scale);

      // Team B
      const teamB = data?.teams?.B?.name || "Team B";
      const scoreB =
        data?.gameScores?.[data?.currentGame || 0]?.b ?? data?.score?.b ?? 0;

      const dotBx = x + 18 * scale;
      const dotBy = y + 85 * scale;
      ctx.fillStyle = "#4F46E5";
      ctx.beginPath();
      ctx.arc(dotBx, dotBy, 5 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#E6EDF3";
      ctx.font = `600 ${16 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(teamB, x + 32 * scale, y + 90 * scale);
      ctx.font = `800 ${24 * scale}px Arial`;
      ctx.textAlign = "right";
      ctx.fillText(String(scoreB), x + width - 14 * scale, y + 90 * scale);

      // 👉 Serve indicator (đọc trực tiếp từ data)
      const { team: servingTeam, number: serverNumber } = getServingInfo(data);
      if (servingTeam === "A") {
        drawServeIndicator(ctx, dotAx, dotAy, scale, serverNumber);
      } else if (servingTeam === "B") {
        drawServeIndicator(ctx, dotBx, dotBy, scale, serverNumber);
      }

      ctx.restore();
    },
    [roundRect, getServingInfo, drawServeIndicator]
  );

  const drawTimer = useCallback(
    (ctx, w) => {
      const time = streamTimeRef.current;
      const m = String(Math.floor(time / 60)).padStart(2, "0");
      const s = String(time % 60).padStart(2, "0");
      const scale = Math.min(w / 1280, 1);
      const x = w / 2 - 80 * scale;
      const y = 20 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(239,68,68,0.95)";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 15 * scale;
      roundRect(ctx, x, y, 160 * scale, 50 * scale, 25 * scale);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "white";
      ctx.font = `bold ${28 * scale}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`${m}:${s}`, w / 2, y + 35 * scale);
      ctx.restore();
    },
    [roundRect]
  );

  const drawTournamentName = useCallback(
    (ctx, w, h, data) => {
      if (!data) return;
      const text = data?.tournament?.name || "Tournament";
      const scale = Math.min(w / 1280, 1);
      const x = w - 320 * scale;
      const y = 20 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.85)";
      roundRect(ctx, x, y, 300 * scale, 50 * scale, 10 * scale);
      ctx.fill();
      ctx.fillStyle = "#FFD700";
      ctx.font = `bold ${18 * scale}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(text, x + 150 * scale, y + 32 * scale);
      ctx.restore();
    },
    [roundRect]
  );

  const drawLogo = useCallback(
    (ctx, w) => {
      const scale = Math.min(w / 1280, 1);
      const x = w - 170 * scale;
      const y = 90 * scale;
      const size = 150 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 10 * scale;
      roundRect(ctx, x, y, size, 60 * scale, 8 * scale);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#667eea";
      ctx.font = `bold ${24 * scale}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("YOUR LOGO", x + size / 2, y + 38 * scale);
      ctx.restore();
    },
    [roundRect]
  );

  const drawSponsors = useCallback(
    (ctx, w, h) => {
      const sponsors = ["SPONSOR 1", "SPONSOR 2", "SPONSOR 3"];
      const scale = Math.min(w / 1280, 1);
      const x = w - 250 * scale;
      const y = h - 120 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      roundRect(ctx, x, y, 230 * scale, 100 * scale, 8 * scale);
      ctx.fill();
      ctx.fillStyle = "#333";
      ctx.font = `bold ${12 * scale}px Arial`;
      ctx.textAlign = "center";
      sponsors.forEach((s, i) =>
        ctx.fillText(s, x + 115 * scale, y + (25 + i * 25) * scale)
      );
      ctx.restore();
    },
    [roundRect]
  );

  const drawLowerThird = useCallback(
    (ctx, w, h) => {
      const scale = Math.min(w / 1280, 1);
      const x = 40 * scale;
      const y = h - 100 * scale;
      const width = 500 * scale;
      ctx.save();
      const gradient = ctx.createLinearGradient(x, y, x + width, y);
      gradient.addColorStop(0, "rgba(239,68,68,0.95)");
      gradient.addColorStop(1, "rgba(220,38,38,0.95)");
      ctx.fillStyle = gradient;
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 15 * scale;
      roundRect(ctx, x, y, width, 70 * scale, 35 * scale);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.fillRect(x, y, 4 * scale, 70 * scale);
      ctx.shadowBlur = 0;
      ctx.font = `bold ${24 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText("Player Name", x + 20 * scale, y + 30 * scale);
      ctx.font = `${16 * scale}px Arial`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText("Champion • Team A", x + 20 * scale, y + 55 * scale);
      ctx.restore();
    },
    [roundRect]
  );

  const drawSocialMedia = useCallback(
    (ctx, w, h) => {
      const socials = [
        { icon: "📱", text: "@YourChannel" },
        { icon: "🐦", text: "@YourTwitter" },
        { icon: "📺", text: "YourStream" },
      ];
      const scale = Math.min(w / 1280, 1);
      const x = 20 * scale;
      const y = h - 150 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.85)";
      roundRect(ctx, x, y, 280 * scale, 130 * scale, 10 * scale);
      ctx.fill();
      socials.forEach((social, i) => {
        ctx.fillStyle = "white";
        ctx.font = `${20 * scale}px Arial`;
        ctx.textAlign = "left";
        ctx.fillText(social.icon, x + 15 * scale, y + (35 + i * 40) * scale);
        ctx.font = `${14 * scale}px Arial`;
        ctx.fillText(social.text, x + 50 * scale, y + (35 + i * 40) * scale);
      });
      ctx.restore();
    },
    [roundRect]
  );

  const drawQRCode = useCallback(
    (ctx, w, h) => {
      const scale = Math.min(w / 1280, 1);
      const x = w - 130 * scale;
      const y = h - 130 * scale;
      const size = 110 * scale;
      ctx.save();
      ctx.fillStyle = "white";
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 10 * scale;
      roundRect(ctx, x, y, size, size, 8 * scale);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#000";
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++) {
          if ((i + j) % 2 === 0)
            ctx.fillRect(
              x + (10 + i * 11) * scale,
              y + (10 + j * 11) * scale,
              10 * scale,
              10 * scale
            );
        }
      ctx.restore();
    },
    [roundRect]
  );

  const drawFrameDecoration = useCallback((ctx, w, h) => {
    ctx.save();
    const g1 = ctx.createLinearGradient(0, 0, w, 0);
    g1.addColorStop(0, "rgba(102,126,234,0.8)");
    g1.addColorStop(1, "rgba(118,75,162,0.8)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h - 3, w, 3);
    const g2 = ctx.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, "rgba(102,126,234,0.8)");
    g2.addColorStop(1, "rgba(118,75,162,0.8)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w - 3, 0, 3, h);
    ctx.fillStyle = "rgba(255,215,0,0.9)";
    [
      [10, 10],
      [w - 20, 10],
      [10, h - 20],
      [w - 20, h - 20],
    ].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }, []);

  const drawLiveBadge = useCallback(
    (ctx, w) => {
      const scale = Math.min(w / 1280, 1);
      const x = w - 150 * scale;
      const y = 20 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(239,68,68,0.95)";
      ctx.shadowColor = "rgba(239,68,68,0.5)";
      ctx.shadowBlur = 15 * scale;
      roundRect(ctx, x, y, 130 * scale, 45 * scale, 22 * scale);
      ctx.fill();
      const pulseSize = (8 + Math.sin(Date.now() / 300) * 2) * scale;
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(x + 25 * scale, y + 22 * scale, pulseSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "white";
      ctx.font = `bold ${20 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText("LIVE", x + 50 * scale, y + 30 * scale);
      ctx.restore();
    },
    [roundRect]
  );

  const drawViewerCount = useCallback(
    (ctx, w) => {
      const viewers = Math.floor(Math.random() * 1000 + 500);
      const scale = Math.min(w / 1280, 1);
      const x = w - 150 * scale;
      const y = 75 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.85)";
      roundRect(ctx, x, y, 130 * scale, 40 * scale, 20 * scale);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = `${18 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText("👥", x + 15 * scale, y + 27 * scale);
      ctx.font = `bold ${16 * scale}px Arial`;
      ctx.fillText(
        `${viewers.toLocaleString()}`,
        x + 45 * scale,
        y + 27 * scale
      );
      ctx.restore();
    },
    [roundRect]
  );
  // ==================== COMPOSE OVERLAY (LUÔN GỌI SCOREBOARD) ====================
  const drawOverlay = useCallback(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);

      // Luôn vẽ scoreboard, dùng overlayData hiện tại (hoặc lastOverlayRef để tránh chớp)
      drawScoreBoard(ctx, w, h, overlayData);

      // Các lớp khác theo toggle
      if (overlayConfig.timer) drawTimer(ctx, w);
      if (
        overlayConfig.tournamentName &&
        (overlayData || lastOverlayRef.current)
      ) {
        drawTournamentName(ctx, w, h, overlayData || lastOverlayRef.current);
      }
      if (overlayConfig.logo) drawLogo(ctx, w);
      if (overlayConfig.sponsors) drawSponsors(ctx, w, h);
      if (overlayConfig.lowerThird) drawLowerThird(ctx, w, h);
      if (overlayConfig.socialMedia) drawSocialMedia(ctx, w, h);
      if (overlayConfig.qrCode) drawQRCode(ctx, w, h);
      if (overlayConfig.frameDecor) drawFrameDecoration(ctx, w, h);
      if (overlayConfig.liveBadge) drawLiveBadge(ctx, w);
      if (overlayConfig.viewerCount) drawViewerCount(ctx, w);
    },
    [
      overlayConfig,
      overlayData,
      drawScoreBoard,
      drawTimer,
      drawTournamentName,
      drawLogo,
      drawSponsors,
      drawLowerThird,
      drawSocialMedia,
      drawQRCode,
      drawFrameDecoration,
      drawLiveBadge,
      drawViewerCount,
    ]
  );

  // ==================== PREVIEW LOOP (hoisted function) ====================
  function startPreviewLoop() {
    const video = videoRef.current;
    const previewCanvas = previewCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!video || !previewCanvas) return;

    const previewCtx = previewCanvas.getContext("2d");
    const overlayCtx = overlayCanvas?.getContext("2d");

    let lastTime = 0;
    const targetFPS = 30;
    const frameTime = 1000 / targetFPS;

    const renderFrame = (ts) => {
      if (!video.videoWidth) {
        previewLoopRef.current = requestAnimationFrame(renderFrame);
        return;
      }
      const dt = ts - lastTime;
      if (dt >= frameTime) {
        previewCtx.drawImage(
          video,
          0,
          0,
          previewCanvas.width,
          previewCanvas.height
        );
        if (overlayCtx && overlayCanvas) {
          drawOverlay(overlayCtx, overlayCanvas.width, overlayCanvas.height);
          previewCtx.drawImage(
            overlayCanvas,
            0,
            0,
            previewCanvas.width,
            previewCanvas.height
          );
        }
        lastTime = ts - (dt % frameTime);
      }
      previewLoopRef.current = requestAnimationFrame(renderFrame);
    };

    previewLoopRef.current = requestAnimationFrame(renderFrame);
  }

  // ==================== CAMERA SWITCH ====================
  const switchCamera = useCallback(async () => {
    try {
      const preset = QUALITY_PRESETS.high;

      // Quyết định ràng buộc video mới
      let constraint = {};
      if (videoDevices.length > 1 && activeVideoDeviceId) {
        const idx = videoDevices.findIndex(
          (d) => d.deviceId === activeVideoDeviceId
        );
        const next = videoDevices[(idx + 1) % videoDevices.length];
        setActiveVideoDeviceId(next.deviceId);
        constraint = { deviceId: { exact: next.deviceId } };
      } else {
        const nextPrefer = !preferBackCamera;
        setPreferBackCamera(nextPrefer);
        constraint = { facingMode: nextPrefer ? "environment" : "user" };
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...constraint,
          width: { ideal: videoSize.w },
          height: { ideal: videoSize.h },
          frameRate: { ideal: preset.fps },
        },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldAudioTrack = camStreamRef.current?.getAudioTracks?.()[0] || null;

      // Dừng video cũ, giữ audio
      camStreamRef.current?.getVideoTracks?.().forEach((t) => t.stop());

      // Gộp stream mới (video) với audio cũ (nếu có)
      const combined = new MediaStream();
      combined.addTrack(newVideoTrack);
      if (oldAudioTrack) combined.addTrack(oldAudioTrack);

      camStreamRef.current = combined;
      if (videoRef.current) {
        videoRef.current.srcObject = combined;
        await videoRef.current.play().catch(() => { });
      }

      // Nếu chưa có preview loop thì bật
      if (!previewLoopRef.current) startPreviewLoop();

      setStatus("✅ Đã đổi camera");
      setStatusType("success");
    } catch (e) {
      setStatus("⚠️ Không thể đổi camera: " + (e?.message || e));
      setStatusType("warning");
    }
  }, [
    videoDevices,
    activeVideoDeviceId,
    preferBackCamera,
    videoSize.w,
    videoSize.h,
    // ⚠️ KHÔNG đưa startPreviewLoop vào deps để tránh TDZ
  ]);

  // ==================== FETCH OVERLAY DATA ====================
  const fetchOverlayData = useCallback(async () => {
    if (!currentMatch?._id || overlayFetchingRef.current) return;
    try {
      overlayFetchingRef.current = true;
      const url = `${apiUrl}/${currentMatch._id}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Overlay fetch failed");
      const data = await response.json();
      setOverlayData(data || null);
      if (data) lastOverlayRef.current = data;
    } catch (error) {
      console.error("❌ Error fetching overlay:", error);
    } finally {
      overlayFetchingRef.current = false;
    }
  }, [currentMatch, apiUrl]);

  useEffect(() => {
    if (!currentMatch?._id) return;
    fetchOverlayData(); // fetch ngay
    const id = setInterval(fetchOverlayData, 1000); // 1s
    return () => clearInterval(id);
  }, [currentMatch?._id, fetchOverlayData]);

  // ==================== APPLY STREAM KEYS & ARM AUTO ====================
  const applyStreamKeys = useCallback((liveData) => {
    if (!liveData) return;

    if (liveData.overlay_url) setOverlayUrl(liveData.overlay_url);
    if (liveData.studio_url) setStudioUrl(liveData.studio_url);
    if (liveData.facebook_permalink_url)
      setFacebookPermalinkUrl(liveData.facebook_permalink_url);
    if (liveData.youtube_watch_url)
      setYoutubeWatchUrl(liveData.youtube_watch_url);
    if (liveData.tiktok_room_url) setTiktokRoomUrl(liveData.tiktok_room_url);

    const { platforms, primary, platformsEnabled } = liveData;

    // Facebook
    if (platforms?.facebook?.live?.stream_key) {
      setStreamKey(platforms.facebook.live.stream_key);
      setTargetFacebook(platformsEnabled?.facebook !== false);
    } else if (primary?.platform === "facebook" && primary?.stream_key) {
      setStreamKey(primary.stream_key);
      setTargetFacebook(platformsEnabled?.facebook !== false);
    }

    // YouTube
    if (platforms?.youtube?.live) {
      setYtServer(
        platforms.youtube.live.server_url || "rtmps://a.rtmps.youtube.com/live2"
      );
      if (platforms.youtube.live.stream_key) {
        setYtKey(platforms.youtube.live.stream_key);
        setTargetYoutube(platformsEnabled?.youtube !== false);
      }
    } else if (primary?.platform === "youtube" && primary?.stream_key) {
      setYtServer(primary.server_url || "rtmps://a.rtmps.youtube.com/live2");
      setYtKey(primary.stream_key);
      setTargetYoutube(platformsEnabled?.youtube !== false);
    }

    // TikTok
    if (platforms?.tiktok?.live) {
      setTtServer(platforms.tiktok.live.server_url || "");
      if (platforms.tiktok.live.stream_key) {
        setTtKey(platforms.tiktok.live.stream_key);
        setTargetTiktok(platformsEnabled?.tiktok !== false);
      }
    }
  }, []);

  const cleanup = useCallback(async () => {
    try {
      camStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch { }
    camStreamRef.current = null;

    try {
      audioRecorderRef.current?.stop?.();
    } catch { }
    audioRecorderRef.current = null;

    try {
      if (
        videoEncoderRef.current &&
        videoEncoderRef.current.state !== "closed"
      ) {
        await videoEncoderRef.current.flush();
        videoEncoderRef.current.close();
      }
    } catch { }
    videoEncoderRef.current = null;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch { }
      wsRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopStreamingPro = useCallback(async () => {
    setStatus("⏹️ Đang dừng stream...");
    setStatusType("info");

    if (autoStartTimerRef.current) {
      clearInterval(autoStartTimerRef.current);
      autoStartTimerRef.current = null;
    }
    setAutoStartCountdown(null);

    if (previewLoopRef.current) {
      cancelAnimationFrame(previewLoopRef.current);
      previewLoopRef.current = null;
    }
    if (encodingLoopRef.current) {
      cancelAnimationFrame(encodingLoopRef.current);
      encodingLoopRef.current = null;
    }

    isEncodingRef.current = false;
    try {
      audioRecorderRef.current?.stop?.();
    } catch { }
    audioRecorderRef.current = null;
    try {
      if (
        videoEncoderRef.current &&
        videoEncoderRef.current.state !== "closed"
      ) {
        await videoEncoderRef.current.flush();
        videoEncoderRef.current.close();
      }
    } catch { }
    videoEncoderRef.current = null;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      } catch { }
      try {
        wsRef.current.close();
      } catch { }
    }

    if (currentMatch) {
      try {
        await notifyStreamEnded({ matchId: currentMatch._id, platform: "all" });
      } catch { }
    }

    await cleanup();

    setIsStreaming(false);
    setIsConnected(false);
    setStatus("⏹️ Đã dừng stream");
    setStatusType("info");
  }, [currentMatch, notifyStreamEnded, cleanup]);

  // ============ NEW: Arm auto start ngay khi có outputs hợp lệ ============
  const armAutoStart = useCallback(() => {
    if (autoStartTimerRef.current || isStreaming || loading) return;
    setAutoStatus("🚦 Có stream key — sẽ tự động phát sau 3s...");
    setAutoStartCountdown(3);
    autoStartTimerRef.current = setInterval(() => {
      setAutoStartCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (autoStartTimerRef.current) {
            clearInterval(autoStartTimerRef.current);
            autoStartTimerRef.current = null;
          }
          setTimeout(() => {
            startStreamingPro();
          }, 0);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [isStreaming, loading]);

  // ==================== HANDLE NEW MATCH ====================
  const handleNewMatch = useCallback(
    async (match) => {
      setCurrentMatch(match);
      const matchLabel = match.labelKey || `Match ${match.code || match._id}`;
      setAutoStatus(`🎾 Trận mới: ${matchLabel}`);

      if (isStreaming) {
        setAutoStatus("⏸️ Dừng live trận cũ...");
        await stopStreamingPro();
      }

      try {
        setAutoStatus("🔄 Đang tạo live session...");
        const result = await createLiveSession({ matchId: match._id }).unwrap();
        if (!result?.ok) throw new Error("Live session creation failed");

        setLiveSession(result);
        applyStreamKeys(result);

        const outs = outputsFromLiveData(result);
        armedOutputsRef.current = outs.length ? outs : null;
        if (outs.length > 0) armAutoStart();
        else setAutoStatus("⚠️ Chưa có output hợp lệ từ payload");

        // History
        setMatchHistory((prev) => [
          ...prev,
          {
            matchId: match._id,
            matchLabel,
            startTime: new Date(),
            liveUrls: {
              facebook: result.facebook_permalink_url || null,
              youtube: result.youtube_watch_url || null,
              tiktok: result.tiktok_room_url || null,
            },
          },
        ]);
      } catch (error) {
        console.error("❌ Error creating live:", error);
        setAutoStatus(`❌ Lỗi tạo live: ${error.message}`);
      }
    },
    [
      isStreaming,
      createLiveSession,
      applyStreamKeys,
      stopStreamingPro,
      armAutoStart,
    ]
  );

  // ==================== WATCH COURT DATA ====================
  useEffect(() => {
    if (!autoMode || !courtData) return;

    const court = courtData.court;
    const match = courtData.match;

    if (!match) {
      if (isStreaming) {
        setAutoStatus("⏹️ Trận đã kết thúc, dừng stream...");
        stopStreamingPro();
      }
      setCurrentMatch(null);
      armedOutputsRef.current = null;
      setAutoStatus(`⏳ Chờ trận đấu tiếp theo tại ${court?.name || ""}...`);
      return;
    }

    if (currentMatchIdRef.current !== String(match._id)) {
      currentMatchIdRef.current = String(match._id);
      handleNewMatch(match);
    } else if (match.status === "finished" && isStreaming) {
      setAutoStatus("✅ Trận đã kết thúc, dừng stream...");
      stopStreamingPro();
    }
  }, [courtData, autoMode, isStreaming, handleNewMatch, stopStreamingPro]);

  // ==================== BUILD OUTPUTS TỪ STATE (fallback) ====================
  const buildOutputs = useCallback(() => {
    const outs = [];
    const fbKey = (streamKey || "").trim();
    if (targetFacebook && fbKey)
      outs.push(joinRtmp("rtmps://live-api-s.facebook.com:443/rtmp/", fbKey));
    if (targetYoutube && ytServer.trim() && ytKey.trim())
      outs.push(joinRtmp(ytServer.trim(), ytKey.trim()));
    if (targetTiktok && ttServer.trim() && ttKey.trim())
      outs.push(joinRtmp(ttServer.trim(), ttKey.trim()));
    return outs;
  }, [
    targetFacebook,
    targetYoutube,
    targetTiktok,
    streamKey,
    ytServer,
    ytKey,
    ttServer,
    ttKey,
  ]);

  const canStartNow = useCallback(() => {
    const armed = armedOutputsRef.current?.length || 0;
    const derived = buildOutputs().length;
    return armed > 0 || derived > 0;
  }, [buildOutputs]);

  // ==================== START STREAM (Binary pipeline) ====================
  const startStreamingPro = useCallback(async () => {
    if (startingRef.current || isStreaming) return;
    startingRef.current = true;

    const outs =
      armedOutputsRef.current && armedOutputsRef.current.length > 0
        ? armedOutputsRef.current
        : buildOutputs();

    if (!outs || outs.length === 0) {
      setStatus("⚠️ Thiếu stream key hoặc chưa chọn platform nào");
      setStatusType("warning");
      startingRef.current = false;
      return;
    }

    if (typeof window.VideoEncoder === "undefined") {
      setStatus("❌ WebCodecs không hỗ trợ. Cần Chrome/Edge 94+");
      setStatusType("error");
      startingRef.current = false;
      return;
    }

    try {
      setLoading(true);
      setStatus("🔄 Đang khởi tạo camera và kết nối...");
      setStatusType("info");

      // Camera
      const preset = QUALITY_PRESETS.high;
      const chosenConstraint = activeVideoDeviceId
        ? { deviceId: { exact: activeVideoDeviceId } }
        : { facingMode: preferBackCamera ? "environment" : "user" };

      const constraints = {
        video: {
          width: { ideal: videoSize.w },
          height: { ideal: videoSize.h },
          frameRate: { ideal: preset.fps },
          ...chosenConstraint,
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      camStreamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await new Promise((resolve) => {
          if (video.readyState >= 1) return resolve();
          const onLoaded = () => {
            video.removeEventListener("loadedmetadata", onLoaded);
            resolve();
          };
          video.addEventListener("loadedmetadata", onLoaded);
        });
        try {
          await video.play();
        } catch {
          await new Promise((r) => setTimeout(r, 80));
          try {
            await video.play();
          } catch { }
        }
        startPreviewLoop();
        // cập nhật danh sách device sau khi có quyền
        refreshVideoDevices();
      }

      // WebSocket binary
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      // Configure encoder
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
            return;
          if (!isEncodingRef.current) return;
          try {
            const raw = new Uint8Array(chunk.byteLength);
            chunk.copyTo(raw);
            const isAnnexB =
              (raw[0] === 0 && raw[1] === 0 && raw[2] === 0 && raw[3] === 1) ||
              (raw[0] === 0 && raw[1] === 0 && raw[2] === 1);
            let payload;
            if (isAnnexB) {
              payload = raw;
            } else {
              if (
                chunk.type === "key" &&
                metadata?.decoderConfig?.description
              ) {
                const desc = new Uint8Array(metadata.decoderConfig.description);
                payload = convertToAnnexB(raw, desc, true);
              } else {
                payload = convertToAnnexB(raw, null, false);
              }
            }
            wsRef.current.send(payload.buffer);
          } catch { }
        },
        error: (e) => {
          console.error("Encoder error:", e);
          setStatus("❌ Encoder error: " + e.message);
          setStatusType("error");
          isEncodingRef.current = false;
          if (encodingLoopRef.current)
            cancelAnimationFrame(encodingLoopRef.current);
        },
      });

      const encW = videoSize.w;
      const encH = videoSize.h;

      encoder.configure({
        codec: "avc1.42001f", // baseline
        width: encW,
        height: encH,
        bitrate: QUALITY_PRESETS.high.videoBitsPerSecond * 1000,
        framerate: QUALITY_PRESETS.high.fps,
        hardwareAcceleration: "prefer-hardware",
        latencyMode: "realtime",
        bitrateMode: "constant",
        avc: { format: "annexb" },
      });
      videoEncoderRef.current = encoder;

      // Handshake
      await new Promise((resolve, reject) => {
        ws.onopen = () => {
          setIsConnected(true);
          const startPayload = {
            type: "start",
            outputs: outs,
            width: encW,
            height: encH,
            fps: QUALITY_PRESETS.high.fps,
            videoBitrate: `${QUALITY_PRESETS.high.videoBitsPerSecond}k`,
            audioBitrate: "128k",
          };
          ws.send(JSON.stringify(startPayload));
        };
        ws.onerror = (e) => reject(e);
        ws.onclose = () => setIsConnected(false);
        ws.onmessage = (event) => {
          try {
            if (typeof event.data !== "string") return;
            const data = JSON.parse(event.data);
            if (data.type === "started") {
              setStatus("✅ Encoder/Relay started");
              setStatusType("success");

              // Audio (MediaRecorder) — prefix 0x01
              try {
                const aTrack = camStreamRef.current?.getAudioTracks?.()[0];
                if (aTrack) {
                  const aStream = new MediaStream([aTrack]);
                  const mime = MediaRecorder.isTypeSupported(
                    "audio/webm;codecs=opus"
                  )
                    ? "audio/webm;codecs=opus"
                    : MediaRecorder.isTypeSupported("audio/webm")
                      ? "audio/webm"
                      : "";
                  const mr = new MediaRecorder(aStream, {
                    mimeType: mime || undefined,
                    audioBitsPerSecond: 128000,
                  });
                  mr.ondataavailable = async (e) => {
                    try {
                      if (!e.data || e.data.size === 0) return;
                      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
                      const buf = await e.data.arrayBuffer();
                      const u8 = new Uint8Array(buf);
                      const out = new Uint8Array(u8.length + 1);
                      out[0] = 0x01; // audio packet marker
                      out.set(u8, 1);
                      wsRef.current.send(out.buffer);
                    } catch { }
                  };
                  mr.start(100);
                  audioRecorderRef.current = mr;
                }
              } catch (e) {
                console.warn("Audio init failed:", e?.message || e);
              }

              resolve();
            } else if (data.type === "stats") {
              setStreamHealth({
                fps: data.fps || 0,
                bitrate: data.bitrate || 0,
                dropped: data.dropped || 0,
              });
            } else if (data.type === "error") {
              reject(new Error(data.message || "server error"));
            }
          } catch { }
        };
      });

      // Encode loop — vẽ video + overlay
      const canvas = canvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (canvas && overlayCanvas) {
        canvas.width = encW;
        canvas.height = encH;
        overlayCanvas.width = encW;
        overlayCanvas.height = encH;
      }
      const ctx = canvasRef.current.getContext("2d", { alpha: false });
      const overlayCtx = overlayCanvasRef.current.getContext("2d");

      const frameDurationUs = Math.floor(1_000_000 / QUALITY_PRESETS.high.fps);
      let nextTsUs = performance.now() * 1000;
      frameCountRef.current = 0;
      isEncodingRef.current = true;

      const encodeLoop = () => {
        if (!isEncodingRef.current || !videoEncoderRef.current) return;

        try {
          ctx.drawImage(video, 0, 0, encW, encH);
          drawOverlay(overlayCtx, encW, encH);
          ctx.drawImage(overlayCanvas, 0, 0, encW, encH);
        } catch { }

        const vf = new VideoFrame(canvas, {
          timestamp: nextTsUs,
          alpha: "discard",
        });
        const forceKey =
          frameCountRef.current % (QUALITY_PRESETS.high.fps * 2) === 0;
        try {
          videoEncoderRef.current.encode(vf, { keyFrame: forceKey });
        } catch { }
        vf.close();

        frameCountRef.current += 1;
        nextTsUs += frameDurationUs;
        encodingLoopRef.current = requestAnimationFrame(encodeLoop);
      };
      encodingLoopRef.current = requestAnimationFrame(encodeLoop);

      setIsStreaming(true);
      setStatus("🔴 Đang phát trực tiếp");
      setStatusType("success");

      if (currentMatch) {
        try {
          await notifyStreamStarted({
            matchId: currentMatch._id,
            platform: "all",
          });
        } catch { }
      }
    } catch (error) {
      console.error("❌ Start streaming error:", error);
      const msg = error?.message?.includes("Only secure origins")
        ? "❌ Trình duyệt chặn camera (cần HTTPS hoặc localhost)."
        : `❌ Lỗi: ${error.message || String(error)}`;
      setStatus(msg);
      setStatusType("error");
      isEncodingRef.current = false;
      try {
        if (
          videoEncoderRef.current &&
          videoEncoderRef.current.state !== "closed"
        ) {
          await videoEncoderRef.current.flush();
          videoEncoderRef.current.close();
        }
      } catch { }
      try {
        audioRecorderRef.current?.stop?.();
      } catch { }
      await cleanup();
    } finally {
      setLoading(false);
      startingRef.current = false;
    }
  }, [
    videoSize,
    wsUrl,
    currentMatch,
    notifyStreamStarted,
    // startPreviewLoop không cần có trong deps (hoisted & stable)
    buildOutputs,
    drawOverlay,
    cleanup,
    isStreaming,
    activeVideoDeviceId,
    preferBackCamera,
    refreshVideoDevices,
  ]);

  // Đồng hồ cho timer overlay
  useEffect(() => {
    let timerId = null;
    if (isStreaming) {
      streamTimeRef.current = 0;
      timerId = setInterval(() => (streamTimeRef.current += 1), 1000);
    }
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [isStreaming]);

  // Backup auto-arm khi keys lên state muộn
  useEffect(() => {
    const eligible =
      canStartNow() &&
      !isStreaming &&
      !loading &&
      !startingRef.current &&
      (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN);
    if (eligible && autoStartCountdown === null && !autoStartTimerRef.current) {
      armAutoStart();
    }
  }, [canStartNow, isStreaming, loading, autoStartCountdown, armAutoStart]);

  // ==================== UI HELPERS ====================
  const toggleOverlay = useCallback((key) => {
    if (key === "scoreBoard") return; // ✅ luôn bật: bỏ qua toggle
    setOverlayConfig((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleAllOverlays = useCallback((enabled) => {
    setOverlayConfig((prev) => {
      const next = Object.keys(prev).reduce((acc, key) => {
        acc[key] = enabled;
        return acc;
      }, {});
      next.scoreBoard = true; // ✅ giữ luôn bật dù bấm Disable All
      return next;
    });
  }, []);

  const activeOverlayCount = useMemo(
    () => Object.values(overlayConfig).filter(Boolean).length,
    [overlayConfig]
  );

  // ==================== UI ====================
  return (
    <Container maxWidth="xl" sx={{ py: isMobile ? 2 : 3 }}>
      {loadingCourt && !courtData && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {courtError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Không thể tải thông tin sân: {courtError.message}
        </Alert>
      )}

      {courtData && (
        <>
          <Card
            elevation={3}
            sx={{ mb: 3, bgcolor: autoMode ? "primary.light" : "action.hover" }}
          >
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item size={{ xs: 12, md: 8 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <AutoMode
                      fontSize="large"
                      color={autoMode ? "primary" : "disabled"}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" fontWeight="bold">
                        Auto Mode: {autoMode ? "BẬT" : "TẮT"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {autoStatus}
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item size={{ xs: 12, md: 4 }} sx={{ textAlign: { md: "right" } }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoMode}
                        onChange={(e) => setAutoMode(e.target.checked)}
                        color="primary"
                      />
                    }
                    label="Auto Mode"
                  />
                  <IconButton onClick={refetchCourt} size="small">
                    <Refresh />
                  </IconButton>
                </Grid>
              </Grid>

              {currentMatch && (
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    bgcolor: "background.paper",
                    borderRadius: 1,
                  }}
                >
                  <Typography variant="subtitle2" gutterBottom>
                    <Stadium
                      fontSize="small"
                      sx={{ verticalAlign: "middle", mr: 1 }}
                    />
                    Trận đang diễn ra:
                  </Typography>
                  <Chip
                    label={currentMatch.labelKey || currentMatch.code}
                    color="success"
                    sx={{ fontWeight: "bold" }}
                  />
                  <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    Status: {currentMatch.status} | Court:{" "}
                    {courtData.court.name}
                  </Typography>

                  {(facebookPermalinkUrl ||
                    youtubeWatchUrl ||
                    tiktokRoomUrl) && (
                      <Box sx={{ mt: 2 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          gutterBottom
                        >
                          Live URLs:
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={1}
                          flexWrap="wrap"
                          sx={{ mt: 1 }}
                        >
                          {facebookPermalinkUrl && (
                            <Chip
                              icon={<Facebook fontSize="small" />}
                              label="Facebook Live"
                              size="small"
                              color="primary"
                              onClick={() =>
                                window.open(facebookPermalinkUrl, "_blank")
                              }
                              onDelete={() =>
                                window.open(facebookPermalinkUrl, "_blank")
                              }
                              deleteIcon={<OpenInNew fontSize="small" />}
                            />
                          )}
                          {youtubeWatchUrl && (
                            <Chip
                              icon={<YouTube fontSize="small" />}
                              label="YouTube Live"
                              size="small"
                              color="error"
                              onClick={() =>
                                window.open(youtubeWatchUrl, "_blank")
                              }
                              onDelete={() =>
                                window.open(youtubeWatchUrl, "_blank")
                              }
                              deleteIcon={<OpenInNew fontSize="small" />}
                            />
                          )}
                          {tiktokRoomUrl && (
                            <Chip
                              icon={<LiveTv fontSize="small" />}
                              label="TikTok Live"
                              size="small"
                              onClick={() => window.open(tiktokRoomUrl, "_blank")}
                              onDelete={() =>
                                window.open(tiktokRoomUrl, "_blank")
                              }
                              deleteIcon={<OpenInNew fontSize="small" />}
                            />
                          )}
                        </Stack>
                      </Box>
                    )}

                  {(overlayUrl || studioUrl) && (
                    <Box sx={{ mt: 2 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        gutterBottom
                      >
                        Tools:
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        flexWrap="wrap"
                        sx={{ mt: 1 }}
                      >
                        {overlayUrl && (
                          <Tooltip title="Click to copy URL">
                            <Chip
                              icon={<Layers fontSize="small" />}
                              label="Overlay URL"
                              size="small"
                              color="secondary"
                              onClick={() => copyToClipboard(overlayUrl)}
                              onDelete={() => window.open(overlayUrl, "_blank")}
                              deleteIcon={<OpenInNew fontSize="small" />}
                            />
                          </Tooltip>
                        )}
                        {studioUrl && (
                          <Tooltip title="Click to copy URL">
                            <Chip
                              icon={<VideoLibrary fontSize="small" />}
                              label="Studio URL"
                              size="small"
                              color="secondary"
                              onClick={() => copyToClipboard(studioUrl)}
                              onDelete={() => window.open(studioUrl, "_blank")}
                              deleteIcon={<OpenInNew fontSize="small" />}
                            />
                          </Tooltip>
                        )}
                      </Stack>
                    </Box>
                  )}
                </Box>
              )}

              {matchHistory.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                  >
                    Lịch sử stream ({matchHistory.length} trận):
                  </Typography>
                  <Box sx={{ maxHeight: 150, overflow: "auto" }}>
                    {matchHistory.map((item, idx) => (
                      <Chip
                        key={idx}
                        label={item.matchLabel}
                        size="small"
                        sx={{ mr: 1, mb: 1 }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>

          <Grid container spacing={3}>
            <Grid item size={{ xs: 12, md: 8 }}>
              <Card elevation={2}>
                <CardContent sx={{ position: "relative", p: 0 }}>
                  <Box
                    sx={{
                      position: "relative",
                      width: "100%",
                      paddingTop: "56.25%",
                      bgcolor: "black",
                    }}
                  >
                    {/* Camera switch button */}
                    <Box
                      sx={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}
                    >
                      <Tooltip title="Đổi camera">
                        <span>
                          <IconButton
                            size="small"
                            onClick={switchCamera}
                            disabled={loading}
                            sx={{
                              bgcolor: "rgba(0,0,0,0.4)",
                              color: "#fff",
                              "&:hover": { bgcolor: "rgba(0,0,0,0.6)" },
                            }}
                          >
                            <Cameraswitch />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>

                    <canvas
                      ref={previewCanvasRef}
                      width={videoSize.w}
                      height={videoSize.h}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                    <video
                      ref={videoRef}
                      style={{ display: "none" }}
                      playsInline
                      muted
                      autoPlay
                    />
                    <canvas ref={canvasRef} style={{ display: "none" }} />
                    <canvas
                      ref={overlayCanvasRef}
                      style={{ display: "none" }}
                    />

                    {!isStreaming && (
                      <Box
                        sx={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          textAlign: "center",
                        }}
                      >
                        <Videocam
                          sx={{ fontSize: 60, color: "grey.500", mb: 2 }}
                        />
                        <Typography variant="h6" color="grey.300">
                          Camera Preview
                        </Typography>
                        <Typography variant="body2" color="grey.500">
                          {canStartNow()
                            ? "Chuẩn bị bắt đầu..."
                            : "Đang chờ stream keys..."}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  {isStreaming && (
                    <Box sx={{ p: 2, bgcolor: "action.hover" }}>
                      <Grid container spacing={2}>
                        <Grid item size={{ xs: 4 }}>
                          <Typography variant="caption" color="text.secondary">
                            FPS
                          </Typography>
                          <Typography variant="h6" fontWeight="bold">
                            {Number(streamHealth.fps || 0).toFixed(1)}
                          </Typography>
                        </Grid>
                        <Grid item size={{ xs: 4 }}>
                          <Typography variant="caption" color="text.secondary">
                            Bitrate
                          </Typography>
                          <Typography variant="h6" fontWeight="bold">
                            {((streamHealth.bitrate || 0) / 1000).toFixed(1)}K
                          </Typography>
                        </Grid>
                        <Grid item size={{ xs: 4 }}>
                          <Typography variant="caption" color="text.secondary">
                            Dropped
                          </Typography>
                          <Typography variant="h6" fontWeight="bold">
                            {streamHealth.dropped || 0}
                          </Typography>
                        </Grid>
                      </Grid>
                    </Box>
                  )}
                </CardContent>
              </Card>

              {/* Overlay Controls */}
              <Card elevation={2} sx={{ mt: 2 }}>
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                    }}
                    onClick={() => setOverlayExpanded(!overlayExpanded)}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Layers color="primary" />
                      <Typography variant="subtitle1" fontWeight="bold">
                        Overlay Controls
                      </Typography>
                      <Chip
                        label={`${activeOverlayCount}/${Object.keys(overlayConfig).length
                          }`}
                        color="success"
                        size="small"
                        sx={{ ml: 1 }}
                      />
                    </Box>
                    <IconButton size="small">
                      {overlayExpanded ? <ExpandLess /> : <ExpandMore />}
                    </IconButton>
                  </Box>

                  <Collapse in={overlayExpanded}>
                    <Divider sx={{ my: 2 }} />
                    <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => toggleAllOverlays(true)}
                        fullWidth
                      >
                        Enable All
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => toggleAllOverlays(false)}
                        fullWidth
                      >
                        Disable All
                      </Button>
                    </Box>
                    <Divider sx={{ mb: 2 }} />

                    <Typography
                      variant="subtitle2"
                      fontWeight={600}
                      sx={{ mb: 1, color: "primary.main" }}
                    >
                      📊 Match Info
                    </Typography>
                    <Box sx={{ pl: { xs: 0, md: 2 }, mb: 2 }}>
                      {/* ✅ Score Board luôn bật & khoá UI */}
                      <FormControlLabel
                        control={<Switch checked size="small" disabled />}
                        label={
                          <Typography variant="body2">
                            <Lock
                              fontSize="small"
                              sx={{ mr: 0.5, verticalAlign: "middle" }}
                            />
                            Score Board (luôn bật)
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.timer}
                            onChange={() => toggleOverlay("timer")}
                            size="small"
                          />
                        }
                        label={<Typography variant="body2">Timer</Typography>}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.tournamentName}
                            onChange={() => toggleOverlay("tournamentName")}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">
                            Tournament Name
                          </Typography>
                        }
                      />
                    </Box>

                    <Typography
                      variant="subtitle2"
                      fontWeight={600}
                      sx={{ mb: 1, color: "primary.main" }}
                    >
                      🎨 Branding
                    </Typography>
                    <Box sx={{ pl: { xs: 0, md: 2 }, mb: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.logo}
                            onChange={() => toggleOverlay("logo")}
                            size="small"
                          />
                        }
                        label={<Typography variant="body2">Logo</Typography>}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.sponsors}
                            onChange={() => toggleOverlay("sponsors")}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">Sponsors</Typography>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.lowerThird}
                            onChange={() => toggleOverlay("lowerThird")}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">Lower Third</Typography>
                        }
                      />
                    </Box>

                    <Typography
                      variant="subtitle2"
                      fontWeight={600}
                      sx={{ mb: 1, color: "primary.main" }}
                    >
                      🌐 Interactive
                    </Typography>
                    <Box sx={{ pl: { xs: 0, md: 2 }, mb: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.socialMedia}
                            onChange={() => toggleOverlay("socialMedia")}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">Social Media</Typography>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.qrCode}
                            onChange={() => toggleOverlay("qrCode")}
                            size="small"
                          />
                        }
                        label={<Typography variant="body2">QR Code</Typography>}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.frameDecor}
                            onChange={() => toggleOverlay("frameDecor")}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">
                            Frame Decoration
                          </Typography>
                        }
                      />
                    </Box>

                    <Typography
                      variant="subtitle2"
                      fontWeight={600}
                      sx={{ mb: 1, color: "primary.main" }}
                    >
                      📡 Status
                    </Typography>
                    <Box sx={{ pl: { xs: 0, md: 2 } }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.liveBadge}
                            onChange={() => toggleOverlay("liveBadge")}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">Live Badge</Typography>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={overlayConfig.viewerCount}
                            onChange={() => toggleOverlay("viewerCount")}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">Viewer Count</Typography>
                        }
                      />
                    </Box>

                    <Alert
                      severity="success"
                      sx={{ mt: 2 }}
                      icon={<CheckCircle />}
                    >
                      <Typography variant="caption">
                        ✅ Score Board luôn bật • ✅ Tay phát bóng hiển thị từ
                        data
                      </Typography>
                    </Alert>
                  </Collapse>
                </CardContent>
              </Card>
            </Grid>

            {/* Controls */}
            <Grid item size={{ xs: 12, md: 4 }}>
              <Card elevation={2}>
                <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                  <Typography
                    variant="subtitle1"
                    fontWeight="bold"
                    gutterBottom
                    sx={{ mb: 2 }}
                  >
                    Stream Keys
                  </Typography>

                  <Box sx={{ mb: 2 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      gutterBottom
                    >
                      Destinations
                    </Typography>
                    <Stack direction="column" spacing={1}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={targetFacebook}
                            onChange={(e) =>
                              setTargetFacebook(e.target.checked)
                            }
                          />
                        }
                        label={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <Facebook fontSize="small" color="primary" />{" "}
                            Facebook
                          </Box>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={targetYoutube}
                            onChange={(e) => setTargetYoutube(e.target.checked)}
                          />
                        }
                        label={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <YouTube fontSize="small" color="error" /> YouTube
                          </Box>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={targetTiktok}
                            onChange={(e) => setTargetTiktok(e.target.checked)}
                          />
                        }
                        label={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <LiveTv fontSize="small" /> TikTok
                          </Box>
                        }
                      />
                    </Stack>
                  </Box>

                  <Stack spacing={1} sx={{ mb: 2 }}>
                    {streamKey && (
                      <Chip
                        icon={<Facebook fontSize="small" />}
                        label={`FB: ${mask(streamKey)}`}
                        color="primary"
                        size="small"
                      />
                    )}
                    {ytKey && (
                      <Chip
                        icon={<YouTube fontSize="small" />}
                        label={`YT: ${mask(ytKey)}`}
                        color="error"
                        size="small"
                      />
                    )}
                    {ttKey && (
                      <Chip
                        icon={<LiveTv fontSize="small" />}
                        label={`TT: ${mask(ttKey)}`}
                        size="small"
                      />
                    )}
                    {!streamKey && !ytKey && !ttKey && (
                      <Typography variant="caption" color="text.secondary">
                        Chờ tạo live session để nhận stream keys...
                      </Typography>
                    )}
                  </Stack>

                  <Divider sx={{ my: 2 }} />

                  <Stack spacing={2}>
                    {!isStreaming ? (
                      <Button
                        variant="contained"
                        color="error"
                        fullWidth
                        startIcon={<PlayArrow />}
                        onClick={startStreamingPro}
                        disabled={
                          loading ||
                          creatingLive ||
                          !canStartNow() ||
                          autoStartCountdown !== null
                        }
                        size="large"
                      >
                        {loading
                          ? "Đang kết nối..."
                          : autoStartCountdown !== null
                            ? `🔴 Bắt đầu phát trực tiếp sau ${autoStartCountdown}s`
                            : "🔴 Start Stream"}
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        color="inherit"
                        fullWidth
                        startIcon={<Stop />}
                        onClick={stopStreamingPro}
                        disabled={loading}
                        size="large"
                      >
                        ⏹️ Stop Stream
                      </Button>
                    )}

                    {status && (
                      <Alert
                        severity={statusType}
                        sx={{ fontSize: "0.875rem" }}
                      >
                        {status}
                      </Alert>
                    )}

                    <Box sx={{ textAlign: "center" }}>
                      <Typography variant="caption" color="text.secondary">
                        Status:
                      </Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {isStreaming
                          ? "🔴 LIVE - Đang phát"
                          : isConnected
                            ? "🟢 Kết nối WebSocket"
                            : "⚪ Không hoạt động"}
                      </Typography>
                    </Box>

                    {process.env.NODE_ENV !== "production" && (
                      <Alert severity={canStartNow() ? "success" : "warning"}>
                        <Typography variant="caption">
                          ArmedOutputs:{" "}
                          {JSON.stringify(armedOutputsRef.current || [])}
                        </Typography>
                      </Alert>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Container>
  );
}
