// FacebookLiveStreamerMUI.jsx
// AUTO-LIVE by Court: auto start when court's match becomes LIVE, stop when finished.

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
  Paper,
  Typography,
  TextField,
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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  LinearProgress,
  Tooltip,
  IconButton,
  Checkbox,
  Stack,
  Collapse,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  RadioButtonChecked,
  PlayArrow,
  Stop,
  Videocam,
  Info,
  SportsScore,
  FlipCameraAndroid,
  Layers,
  CheckCircle,
  Speed,
  SettingsInputHdmi,
  AutoMode,
  Refresh,
  YouTube,
  LiveTv,
  Facebook,
  ExpandMore,
  ExpandLess,
} from "@mui/icons-material";

/* --------------------- Helpers --------------------- */
const safeAtobUtf8 = (b64) => {
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch (e) {
    try {
      return atob(b64);
    } catch { }
  }
  return "";
};
const splitRtmpUrl = (url) => {
  if (!url || !/^rtmps?:\/\//i.test(url))
    return { server_url: "", stream_key: "" };
  const trimmed = url.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= "rtmp://".length) return { server_url: trimmed, stream_key: "" };
  return {
    server_url: trimmed.slice(0, idx),
    stream_key: trimmed.slice(idx + 1),
  };
};
const normalizeDest = (d) => {
  const platform = (d?.platform || "").toLowerCase();
  let server_url = d?.server_url || "";
  let stream_key = d?.stream_key || "";
  const secure = d?.secure_stream_url || "";
  if ((!server_url || !stream_key) && secure) {
    const s = splitRtmpUrl(secure);
    server_url = server_url || s.server_url;
    stream_key = stream_key || s.stream_key;
  }
  return { platform, server_url, stream_key, secure_stream_url: secure };
};

const QUALITY_PRESETS = {
  low: {
    label: "Low (360p)",
    width: 640,
    height: 360,
    fps: 24,
    videoBitsPerSecond: 800,
    description: "Tiết kiệm data, mạng chậm",
  },
  medium: {
    label: "Medium (480p)",
    width: 854,
    height: 480,
    fps: 30,
    videoBitsPerSecond: 1500,
    description: "Cân bằng chất lượng/data",
  },
  high: {
    label: "High (720p)",
    width: 1280,
    height: 720,
    fps: 30,
    videoBitsPerSecond: 2500,
    description: "HD, mạng tốt",
  },
  ultra: {
    label: "Ultra (1080p)",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitsPerSecond: 4000,
    description: "Full HD, mạng rất tốt",
  },
};

export default function LiveStudioCourts({
  /* ===== Inputs như cũ ===== */
  matchId, // optional: sẽ bị override khi sân có match LIVE
  wsUrl = "wss://pickletour.vn/ws/rtmp",
  apiUrl = "http://localhost:5001/api/overlay/match",
  /* ===== 🔔 AUTO-LIVE props mới ===== */
  courtId, // REQUIRED để nghe tín hiệu sân hiện tại
  autoOnLive = true, // tự start khi sân có trận LIVE
  autoCreateIfMissing = false, // nếu resolve ko có outputs thì tự tạo live
  pollIntervalMs = 1500, // chu kỳ kiểm tra sân
  courtApiBase = "http://localhost:5001/api", // GET /courts/{courtId}
  liveApiBase = "http://localhost:5001/api", // GET /live/resolve?matchId=... ; POST /live/auto-create
  /* Có thể override bằng hàm nếu backend khác shape/path: */
  fetchCourtState, // async (courtId) => { currentMatch: { _id, status } | null }
  resolveTargets, // async (matchId) => [{platform, server_url, stream_key, secure_stream_url}]
  createLive, // async (matchId) => same array
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  /* ====== State gốc ====== */
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamKey, setStreamKey] = useState("");
  const [status, setStatus] = useState("Chưa kết nối");
  const [statusType, setStatusType] = useState("info");
  const [overlayData, setOverlayData] = useState(null);
  const [facingMode, setFacingMode] = useState("user");
  const [videoDevices, setVideoDevices] = useState([]);
  const [supportsWebCodecs, setSupportsWebCodecs] = useState(false);

  const [overlayExpanded, setOverlayExpanded] = useState(!isMobile);
  const [settingsExpanded, setSettingsExpanded] = useState(true);

  const [targetFacebook, setTargetFacebook] = useState(true);
  const [targetYoutube, setTargetYoutube] = useState(false);
  const [ytServer, setYtServer] = useState("rtmp://a.rtmp.youtube.com/live2");
  const [ytKey, setYtKey] = useState("");
  const [targetTiktok, setTargetTiktok] = useState(false);
  const [ttServer, setTtServer] = useState("");
  const [ttKey, setTtKey] = useState("");

  const [autoFillFlags, setAutoFillFlags] = useState({
    fb: false,
    yt: false,
    tt: false,
  });

  const [qualityMode, setQualityMode] = useState("high");
  const [autoQuality, setAutoQuality] = useState(true);
  const [networkSpeed, setNetworkSpeed] = useState(0);
  const [recommendedQuality, setRecommendedQuality] = useState("high");
  const [streamHealth, setStreamHealth] = useState({
    fps: 0,
    bitrate: 0,
    dropped: 0,
  });

  const [videoSize, setVideoSize] = useState(() => {
    const preset = QUALITY_PRESETS.high;
    return { w: preset.width, h: preset.height };
  });

  const [overlayConfig, setOverlayConfig] = useState({
    scoreBoard: true,
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

  /* ====== 🔔 AUTO-LIVE state ====== */
  const [watchedMatchId, setWatchedMatchId] = useState(matchId || null); // match dùng cho overlay + auto
  const [courtLiveState, setCourtLiveState] = useState({
    matchId: null,
    status: null,
  });
  const lastAutoStartedForRef = useRef(null); // tránh start lặp lại cho cùng match
  const lastSeenLiveMatchRef = useRef(null); // dùng debounce nhẹ

  /* ====== Refs ====== */
  const streamTimeRef = useRef(0);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const camStreamRef = useRef(null);
  const wsRef = useRef(null);
  const videoEncoderRef = useRef(null);
  const encodingLoopRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const overlayFetchingRef = useRef(false);
  const frameCountRef = useRef(0);
  const statsRef = useRef({
    sent: 0,
    dropped: 0,
    lastLog: Date.now(),
    avgFps: 0,
  });
  const isEncodingRef = useRef(false);
  const lastFrameTimestampRef = useRef(0);
  const frameIntervalRef = useRef(0);
  const networkTestRef = useRef(null);
  const previewLoopRef = useRef(null);

  const canSwitchCamera =
    videoDevices.length > 1 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  /* ====== Speed test ====== */
  const SPEED_TEST_URLS = useMemo(() => {
    const list = [];
    // try {
    //   const pageOrigin =
    //     typeof window !== "undefined" ? window.location.origin : "";
    //   if (pageOrigin)
    //     list.push(`${pageOrigin}/speed-5mb.bin`, `${pageOrigin}/speed-1mb.bin`);
    //   try {
    //     const wsHttp = wsUrl
    //       .replace(/^wss:/, "https:")
    //       .replace(/^ws:/, "http:");
    //     const u = new URL(wsHttp);
    //     list.push(`${u.origin}/speed-5mb.bin`);
    //   } catch {}
    // } catch {}
    list.push(
      "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg",
      "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg"
    );
    return list;
  }, [wsUrl]);

  const canStartNow = () => {
    const fbOK = targetFacebook && !!streamKey.trim();
    const ytOK = targetYoutube && !!ytServer.trim() && !!ytKey.trim();
    const ttOK = targetTiktok && !!ttServer.trim() && !!ttKey.trim();
    return fbOK || ytOK || ttOK;
  };

  /* ====== Parse URL params & d64 ====== */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const d64 = params.get("d64");
      if (d64) {
        try {
          const decoded = safeAtobUtf8(d64);
          const arr = JSON.parse(decoded);
          if (Array.isArray(arr) && arr.length) {
            const dests = arr.map(normalizeDest);
            const fb = dests.find((d) => d.platform === "facebook");
            const yt = dests.find((d) => d.platform === "youtube");
            const tt = dests.find((d) => d.platform === "tiktok");
            if (fb) {
              setTargetFacebook(true);
              if (fb.stream_key) setStreamKey(fb.stream_key);
              setAutoFillFlags((f) => ({ ...f, fb: true }));
            }
            if (yt) {
              setTargetYoutube(true);
              if (yt.server_url) setYtServer(yt.server_url);
              if (yt.stream_key) setYtKey(yt.stream_key);
              setAutoFillFlags((f) => ({ ...f, yt: true }));
            }
            if (tt) {
              setTargetTiktok(true);
              if (tt.server_url) setTtServer(tt.server_url);
              if (tt.stream_key) setTtKey(tt.stream_key);
              setAutoFillFlags((f) => ({ ...f, tt: true }));
            }
          }
        } catch { }
      }
      const fbKey = params.get("key");
      if (fbKey) {
        setStreamKey(fbKey);
        setTargetFacebook(true);
        setAutoFillFlags((f) => ({ ...f, fb: true }));
      }
      const ys = params.get("yt_server");
      const yk = params.get("yt");
      if (ys || yk) {
        if (ys) setYtServer(ys);
        if (yk) setYtKey(yk);
        setTargetYoutube(true);
        setAutoFillFlags((f) => ({ ...f, yt: true }));
      }
      const ts = params.get("tt_server");
      const tk = params.get("tt");
      if (ts || tk) {
        if (ts) setTtServer(ts);
        if (tk) setTtKey(tk);
        setTargetTiktok(true);
        setAutoFillFlags((f) => ({ ...f, tt: true }));
      }
      if (d64 || fbKey || ys || yk || ts || tk) {
        setStatus("✅ Auto-fill destinations từ URL");
        setStatusType("success");
      }
    } catch (err) {
      console.warn("Cannot parse URL params:", err);
    }
  }, []);

  /* ====== Feature detect WebCodecs ====== */
  useEffect(() => {
    const supported = typeof window.VideoEncoder !== "undefined";
    setSupportsWebCodecs(supported);
    if (!supported) {
      setStatus("⚠️ WebCodecs không hỗ trợ. Cần Chrome/Edge 94+");
      setStatusType("warning");
    } else {
      setStatus((s) =>
        s.startsWith("✅ Auto-fill") ? s : "✅ WebCodecs ready - ADAPTIVE"
      );
      setStatusType("success");
    }
  }, []);

  /* ====== Network speed & quality ====== */
  const measureNetworkSpeed = useCallback(async () => {
    // ✅ SKIP network test khi đang streaming để tránh chiếm bandwidth
    if (isStreaming) {
      console.log("⏸️ Skipping network test while streaming");
      return;
    }

    if (networkTestRef.current) return;
    networkTestRef.current = true;
    const finish = (mbps) => {
      const speed = Number.isFinite(mbps) ? parseFloat(mbps.toFixed(2)) : 0;
      setNetworkSpeed(speed);
      let recommended = "low";
      if (speed >= 10) recommended = "ultra";
      else if (speed >= 5) recommended = "high";
      else if (speed >= 2) recommended = "medium";
      setRecommendedQuality(recommended);
      if (autoQuality && !isStreaming) setQualityMode(recommended);
    };
    try {
      for (const url of SPEED_TEST_URLS) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const start = performance.now();
        let loaded = 0;
        try {
          const res = await fetch(url, {
            cache: "no-store",
            credentials: "omit",
            mode: "cors",
            signal: controller.signal,
          });
          if (!res.ok || (!res.body && !res.headers)) {
            clearTimeout(timeoutId);
            continue;
          }
          if (res.body) {
            const reader = res.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              loaded += value?.length || 0;
            }
          } else {
            const blob = await res.blob();
            loaded = blob.size || 0;
          }
          clearTimeout(timeoutId);
          const secs = (performance.now() - start) / 1000;
          if (secs <= 0 || loaded <= 0) continue;
          const mbps = (loaded * 8) / secs / 1e6;
          finish(mbps);
          return;
        } catch {
          clearTimeout(timeoutId);
        }
      }
      const down = navigator.connection?.downlink;
      if (down) finish(down);
      else finish(0);
    } finally {
      networkTestRef.current = null;
    }
  }, [SPEED_TEST_URLS, autoQuality, isStreaming]);
  useEffect(() => {
    // ✅ Run immediately only if NOT streaming
    if (!isStreaming) {
      measureNetworkSpeed();
    }

    // ✅ Interval sẽ skip nếu đang streaming (logic trong hàm)
    const interval = setInterval(measureNetworkSpeed, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ✅ Setup 1 lần, skip logic inside measureNetworkSpeed
  useEffect(() => {
    const preset = QUALITY_PRESETS[qualityMode];
    if (preset && !isStreaming)
      setVideoSize({ w: preset.width, h: preset.height });
  }, [qualityMode, isStreaming]);

  /* ====== Overlay toggles ====== */
  const toggleOverlay = useCallback(
    (key) => setOverlayConfig((prev) => ({ ...prev, [key]: !prev[key] })),
    []
  );
  const toggleAllOverlays = useCallback((enabled) => {
    setOverlayConfig((prev) =>
      Object.keys(prev).reduce((acc, key) => {
        acc[key] = enabled;
        return acc;
      }, {})
    );
  }, []);

  /* ====== Overlay drawing funcs (giữ nguyên) ====== */
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

  const drawScoreBoard = useCallback(
    (ctx, w, h, data) => {
      if (!data) return;
      const scale = Math.min(w / 1280, 1);
      const x = 20 * scale,
        y = 20 * scale,
        width = 320 * scale,
        height = 120 * scale;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.9)";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 15 * scale;
      roundRect(ctx, x, y, width, height, 12 * scale);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#9AA4AF";
      ctx.font = `500 ${11 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(
        data?.tournament?.name || "Tournament",
        x + 14 * scale,
        y + 22 * scale
      );
      const teamA = data?.teams?.A?.name || "Team A";
      const scoreA = data?.gameScores?.[data?.currentGame || 0]?.a || 0;
      ctx.fillStyle = "#25C2A0";
      ctx.beginPath();
      ctx.arc(x + 18 * scale, y + 45 * scale, 5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#E6EDF3";
      ctx.font = `600 ${16 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(teamA, x + 32 * scale, y + 50 * scale);
      ctx.font = `800 ${24 * scale}px Arial`;
      ctx.textAlign = "right";
      ctx.fillText(String(scoreA), x + width - 14 * scale, y + 50 * scale);
      const teamB = data?.teams?.B?.name || "Team B";
      const scoreB = data?.gameScores?.[data?.currentGame || 0]?.b || 0;
      ctx.fillStyle = "#4F46E5";
      ctx.beginPath();
      ctx.arc(x + 18 * scale, y + 85 * scale, 5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#E6EDF3";
      ctx.font = `600 ${16 * scale}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(teamB, x + 32 * scale, y + 90 * scale);
      ctx.font = `800 ${24 * scale}px Arial`;
      ctx.textAlign = "right";
      ctx.fillText(String(scoreB), x + width - 14 * scale, y + 90 * scale);
      ctx.restore();
    },
    [roundRect]
  );
  const drawTimer = useCallback(
    (ctx, w, h) => {
      const time = streamTimeRef.current;
      const minutes = Math.floor(time / 60)
        .toString()
        .padStart(2, "0");
      const seconds = (time % 60).toString().padStart(2, "0");
      const scale = Math.min(w / 1280, 1);
      const x = w / 2 - 80 * scale,
        y = 20 * scale;
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
      ctx.fillText(`${minutes}:${seconds}`, w / 2, y + 35 * scale);
      ctx.restore();
    },
    [roundRect]
  );
  const drawTournamentName = useCallback(
    (ctx, w, h, data) => {
      if (!data) return;
      const text = data?.tournament?.name || "Tournament 2025";
      const scale = Math.min(w / 1280, 1);
      const x = w - 320 * scale,
        y = 20 * scale;
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
    (ctx, w, h) => {
      const scale = Math.min(w / 1280, 1);
      const x = w - 170 * scale,
        y = 90 * scale,
        size = 150 * scale;
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
      const x = w - 250 * scale,
        y = h - 120 * scale;
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
      const x = 40 * scale,
        y = h - 100 * scale,
        width = 500 * scale;
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
      const x = 20 * scale,
        y = h - 150 * scale;
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
      const x = w - 130 * scale,
        y = h - 130 * scale,
        size = 110 * scale;
      ctx.save();
      ctx.fillStyle = "white";
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 10 * scale;
      roundRect(ctx, x, y, size, size, 8 * scale);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#000";
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++)
          if ((i + j) % 2 === 0)
            ctx.fillRect(
              x + (10 + i * 11) * scale,
              y + (10 + j * 11) * scale,
              10 * scale,
              10 * scale
            );
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
    (ctx, w, h) => {
      const scale = Math.min(w / 1280, 1);
      const x = w - 150 * scale,
        y = 20 * scale;
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
    (ctx, w, h) => {
      const viewers = Math.floor(Math.random() * 1000 + 500);
      const scale = Math.min(w / 1280, 1);
      const x = w - 150 * scale,
        y = 75 * scale;
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

  const drawFrame = useMemo(() => {
    return (ctx, video, w, h) => {
      if (video.readyState >= 2 && video.videoWidth) {
        const vw = video.videoWidth,
          vh = video.videoHeight;
        const scale = Math.max(w / vw, h / vh);
        const sw = w / scale,
          sh = h / scale,
          sx = (vw - sw) / 2,
          sy = (vh - sh) / 2;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      }
      if (overlayConfig.scoreBoard && overlayData)
        drawScoreBoard(ctx, w, h, overlayData);
      if (overlayConfig.timer) drawTimer(ctx, w, h);
      if (overlayConfig.tournamentName && overlayData)
        drawTournamentName(ctx, w, h, overlayData);
      if (overlayConfig.logo) drawLogo(ctx, w, h);
      if (overlayConfig.sponsors) drawSponsors(ctx, w, h);
      if (overlayConfig.lowerThird) drawLowerThird(ctx, w, h);
      if (overlayConfig.socialMedia) drawSocialMedia(ctx, w, h);
      if (overlayConfig.qrCode) drawQRCode(ctx, w, h);
      if (overlayConfig.frameDecor) drawFrameDecoration(ctx, w, h);
      if (overlayConfig.liveBadge) drawLiveBadge(ctx, w, h);
      if (overlayConfig.viewerCount) drawViewerCount(ctx, w, h);
    };
  }, [
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
  ]);

  /* ====== Timer ====== */
  useEffect(() => {
    let interval = null;
    if (isStreaming) {
      streamTimeRef.current = 0;
      interval = setInterval(() => {
        streamTimeRef.current++;
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStreaming]);

  /* ====== Camera init ====== */
  const enumerateVideoDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
    } catch { }
  };
  const findDeviceIdForFacing = (want = "user") => {
    const isBack = want === "environment";
    const backKeys = ["back", "rear", "environment"];
    const frontKeys = ["front", "user"];
    for (const d of videoDevices) {
      const label = (d.label || "").toLowerCase();
      if (isBack && backKeys.some((k) => label.includes(k))) return d.deviceId;
      if (!isBack && frontKeys.some((k) => label.includes(k)))
        return d.deviceId;
    }
    if (isBack && videoDevices.length > 1) return videoDevices.at(-1)?.deviceId;
    return videoDevices[0]?.deviceId;
  };
  const stopCurrentStream = () => {
    try {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch { }
  };
  const initCamera = async (preferFacing = "user") => {
    try {
      stopCurrentStream();
      const preset = QUALITY_PRESETS[qualityMode];
      const common = {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.fps },
      };
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...common, facingMode: { exact: preferFacing } },
          audio: audioConstraints,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { ...common, facingMode: preferFacing },
            audio: audioConstraints,
          });
        } catch {
          await enumerateVideoDevices();
          const deviceId = findDeviceIdForFacing(preferFacing);
          stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId
              ? { ...common, deviceId: { exact: deviceId } }
              : common,
            audio: audioConstraints,
          });
        }
      }
      camStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const vTrack = stream.getVideoTracks()[0];
      const s = vTrack?.getSettings?.() || {};
      const w = s.width || preset.width,
        h = s.height || preset.height;
      if (canvasRef.current) {
        canvasRef.current.width = w;
        canvasRef.current.height = h;
      }
      if (previewCanvasRef.current) {
        previewCanvasRef.current.width = w;
        previewCanvasRef.current.height = h;
      }
      setVideoSize({ w, h });
      setFacingMode(preferFacing);
      setStatus(`Camera sẵn sàng - ${QUALITY_PRESETS[qualityMode].label}`);
      setStatusType("success");
      await enumerateVideoDevices();
      return true;
    } catch (err) {
      setStatus("Lỗi: Không thể truy cập camera - " + err.message);
      setStatusType("error");
      return false;
    }
  };
  const toggleCamera = async () => {
    const next = facingMode === "user" ? "environment" : "user";
    setLoading(true);
    const ok = await initCamera(next);
    if (!ok) {
      setStatus("Thiết bị không hỗ trợ đổi camera");
      setStatusType("warning");
    }
    setLoading(false);
  };
  useEffect(() => {
    (async () => {
      await initCamera("user");
    })();
    return () => {
      stopCurrentStream();
      isEncodingRef.current = false;
      if (encodingLoopRef.current) {
        cancelAnimationFrame(encodingLoopRef.current);
        encodingLoopRef.current = null;
      }
      if (previewLoopRef.current) {
        cancelAnimationFrame(previewLoopRef.current);
        previewLoopRef.current = null;
      }
      try {
        if (
          audioRecorderRef.current &&
          audioRecorderRef.current.state !== "inactive"
        )
          audioRecorderRef.current.stop();
        audioRecorderRef.current = null;
      } catch { }
      try {
        if (
          videoEncoderRef.current &&
          videoEncoderRef.current.state !== "closed"
        )
          videoEncoderRef.current.close();
      } catch { }
      try {
        wsRef.current?.close();
      } catch { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ✅ Chỉ init camera 1 lần, không restart khi quality change

  /* ====== Fetch overlay theo watchedMatchId ====== */
  useEffect(() => {
    if (!watchedMatchId) return;
    let timer;
    const tick = async () => {
      if (overlayFetchingRef.current) return;
      overlayFetchingRef.current = true;
      try {
        const res = await fetch(`${apiUrl}/${watchedMatchId}`, {
          cache: "no-store",
        });
        const data = await res.json();
        setOverlayData(data);
      } catch (e) {
        console.error("Fetch overlay error:", e);
      } finally {
        overlayFetchingRef.current = false;
      }
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [watchedMatchId, apiUrl]);

  /* ====== Preview loop ====== */
  useEffect(() => {
    // ✅ Chỉ chạy preview loop khi KHÔNG streaming
    if (isStreaming) return;

    const canvas = previewCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
    });
    let running = true,
      lastTime = 0;
    const targetFPS = 30,
      frameTime = 1000 / targetFPS;
    const render = (currentTime) => {
      if (!running) return;
      const deltaTime = currentTime - lastTime;
      if (deltaTime >= frameTime) {
        drawFrame(ctx, video, canvas.width, canvas.height);
        lastTime = currentTime - (deltaTime % frameTime);
      }
      previewLoopRef.current = requestAnimationFrame(render);
    };
    previewLoopRef.current = requestAnimationFrame(render);
    return () => {
      running = false;
      if (previewLoopRef.current) {
        cancelAnimationFrame(previewLoopRef.current);
        previewLoopRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]); // ✅ Chỉ restart khi isStreaming thay đổi

  /* ====== H264 & Streaming (giữ logic cũ) ====== */
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

  /* ========= 🔔 AUTO-LIVE: helpers ========= */
  const defaultFetchCourtState = useCallback(
    async (cid) => {
      // Expect: { currentMatch: { _id, status } | null }
      const res = await fetch(`${courtApiBase}/courts/${cid}`, {
        cache: "no-store",
      });
      const j = await res.json();
      const cm = j?.currentMatch || null;
      if (!cm) return { currentMatch: null };
      return {
        currentMatch: {
          _id: String(cm._id || cm.id || cm),
          status: cm.status || j?.status || null,
        },
      };
    },
    [courtApiBase]
  );

  const defaultResolveTargets = useCallback(
    async (mid) => {
      const res = await fetch(
        `${liveApiBase}/live/resolve?matchId=${encodeURIComponent(mid)}`,
        { cache: "no-store" }
      );
      const arr = await res.json();
      return Array.isArray(arr) ? arr.map(normalizeDest) : [];
    },
    [liveApiBase]
  );

  const defaultCreateLive = useCallback(
    async (mid) => {
      const res = await fetch(`${liveApiBase}/live/auto-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: mid }),
      });
      const arr = await res.json();
      return Array.isArray(arr) ? arr.map(normalizeDest) : [];
    },
    [liveApiBase]
  );

  const applyDestinationsToUI = useCallback((dests) => {
    const fb = dests.find((d) => d.platform === "facebook");
    const yt = dests.find((d) => d.platform === "youtube");
    const tt = dests.find((d) => d.platform === "tiktok");

    if (fb) {
      setTargetFacebook(true);
      if (fb.stream_key) setStreamKey(fb.stream_key);
      setAutoFillFlags((f) => ({ ...f, fb: true }));
    }
    if (yt) {
      setTargetYoutube(true);
      if (yt.server_url) setYtServer(yt.server_url);
      if (yt.stream_key) setYtKey(yt.stream_key);
      setAutoFillFlags((f) => ({ ...f, yt: true }));
    }
    if (tt) {
      setTargetTiktok(true);
      if (tt.server_url) setTtServer(tt.server_url);
      if (tt.stream_key) setTtKey(tt.stream_key);
      setAutoFillFlags((f) => ({ ...f, tt: true }));
    }
    return { hasAny: !!(fb || yt || tt) };
  }, []);

  const ensureOutputsForMatch = useCallback(
    async (mid) => {
      const resolveFn = resolveTargets || defaultResolveTargets;
      const createFn = createLive || defaultCreateLive;

      // 1) Thử resolve
      let dests = [];
      try {
        dests = await resolveFn(mid);
      } catch (e) {
        console.warn("resolveTargets error:", e);
      }
      if (!Array.isArray(dests)) dests = [];
      if (dests.length) {
        applyDestinationsToUI(dests);
        return true;
      }

      // 2) Nếu không có & được phép auto create
      if (autoCreateIfMissing) {
        try {
          const created = await createFn(mid);
          if (Array.isArray(created) && created.length) {
            applyDestinationsToUI(created);
            return true;
          }
        } catch (e) {
          console.warn("createLive error:", e);
        }
      }

      return false;
    },
    [
      resolveTargets,
      defaultResolveTargets,
      createLive,
      defaultCreateLive,
      applyDestinationsToUI,
      autoCreateIfMissing,
    ]
  );

  /* ========= 🔔 AUTO-LIVE: polling court ========= */
  useEffect(() => {
    if (!courtId) return;
    let timer;
    const fetchFn = fetchCourtState || defaultFetchCourtState;

    const tick = async () => {
      try {
        const data = await fetchFn(courtId);
        const cm = data?.currentMatch || null;
        const next = { matchId: cm?._id || null, status: cm?.status || null };
        setCourtLiveState(next);

        // Cập nhật overlay matchId (ưu tiên match của court)
        if (next.matchId && next.matchId !== watchedMatchId) {
          setWatchedMatchId(next.matchId);
        }

        // AUTO START khi court chuyển sang LIVE
        if (
          autoOnLive &&
          next.matchId &&
          String(next.status).toLowerCase() === "live"
        ) {
          // Debounce đơn giản để tránh giật trạng thái
          if (lastSeenLiveMatchRef.current !== next.matchId) {
            lastSeenLiveMatchRef.current = next.matchId;

            // nếu chưa từng auto-start cho match này thì chuẩn bị outputs + start
            if (
              lastAutoStartedForRef.current !== next.matchId &&
              !isStreaming
            ) {
              setStatus(
                "🔔 Phát hiện trận LIVE trên sân — chuẩn bị outputs..."
              );
              setStatusType("info");
              const ok = await ensureOutputsForMatch(next.matchId);
              if (!ok && !canStartNow()) {
                setStatus(
                  "⚠️ Không có outputs. Điền key hoặc bật Auto-create."
                );
                setStatusType("warning");
                return;
              }
              await startStreamingPro();
              lastAutoStartedForRef.current = next.matchId;
            }
          }
        }

        // AUTO STOP khi không còn live/finished
        if (isStreaming) {
          const isLive = String(next.status || "").toLowerCase() === "live";
          if (!next.matchId || !isLive) {
            setStatus(
              "🔔 Trận đã kết thúc hoặc sân không còn LIVE — dừng stream..."
            );
            setStatusType("info");
            await stopStreamingPro();
          }
        }
      } catch (e) {
        console.warn("poll court error:", e);
      }
    };

    tick();
    timer = setInterval(tick, Math.max(800, pollIntervalMs));
    return () => clearInterval(timer);
  }, [
    courtId,
    autoOnLive,
    pollIntervalMs,
    fetchCourtState,
    defaultFetchCourtState,
    ensureOutputsForMatch,
    isStreaming,
    watchedMatchId,
    canStartNow,
  ]);

  /* ====== START / STOP STREAM (giữ nguyên, có sửa nhỏ chỗ preset scope) ====== */
  const startStreamingPro = async () => {
    if (!supportsWebCodecs) {
      setStatus("❌ WebCodecs không hỗ trợ. Cần Chrome/Edge 94+");
      setStatusType("error");
      return;
    }
    if (!canStartNow()) {
      setStatus(
        "❌ Vui lòng nhập ít nhất một đích phát (Facebook/YouTube/TikTok)"
      );
      setStatusType("error");
      return;
    }
    setLoading(true);
    try {
      setStatus("Đang kết nối WebSocket...");
      const ws = await new Promise((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        socket.binaryType = "arraybuffer";
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error("WebSocket timeout"));
        }, 5000);
        socket.onopen = () => {
          clearTimeout(timeout);
          resolve(socket);
        };
        socket.onerror = (e) => {
          clearTimeout(timeout);
          reject(e);
        };
      });
      wsRef.current = ws;
      setIsConnected(true);

      const preset = QUALITY_PRESETS[qualityMode];
      setStatus("Đang khởi tạo H264 encoder...");
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (!isEncodingRef.current) return;
          try {
            const chunkData = new Uint8Array(chunk.byteLength);
            chunk.copyTo(chunkData);
            const isAnnexB =
              (chunkData[0] === 0 &&
                chunkData[1] === 0 &&
                chunkData[2] === 0 &&
                chunkData[3] === 1) ||
              (chunkData[0] === 0 && chunkData[1] === 0 && chunkData[2] === 1);
            let dataToSend;
            if (isAnnexB) {
              dataToSend = chunkData;
            } else {
              if (
                chunk.type === "key" &&
                metadata?.decoderConfig?.description
              ) {
                const description = new Uint8Array(
                  metadata.decoderConfig.description
                );
                dataToSend = convertToAnnexB(chunkData, description, true);
              } else {
                dataToSend = convertToAnnexB(chunkData, null, false);
              }
            }
            ws.send(dataToSend.buffer);
            statsRef.current.sent++;
            const now = Date.now();
            if (now - statsRef.current.lastLog > 3000) {
              const elapsed = (now - statsRef.current.lastLog) / 1000;
              const fpsNow = (statsRef.current.sent / elapsed).toFixed(1);
              statsRef.current.avgFps = fpsNow;
              setStreamHealth({
                fps: parseFloat(fpsNow),
                bitrate: preset.videoBitsPerSecond,
                dropped: statsRef.current.dropped,
              });
              statsRef.current.lastLog = now;
              statsRef.current.sent = 0;
              statsRef.current.dropped = 0;
            }
          } catch (err) {
            console.error("Send error:", err);
            statsRef.current.dropped++;
          }
        },
        error: (e) => {
          console.error("Encoder error:", e);
          isEncodingRef.current = false;
          if (encodingLoopRef.current) {
            cancelAnimationFrame(encodingLoopRef.current);
            encodingLoopRef.current = null;
          }
          setStatus("❌ Encoder error: " + e.message);
          setStatusType("error");
          setIsStreaming(false);
        },
      });

      encoder.configure({
        codec: "avc1.42001f",
        width: preset.width,
        height: preset.height,
        bitrate: preset.videoBitsPerSecond * 1000,
        framerate: preset.fps,
        hardwareAcceleration: "prefer-hardware",
        latencyMode: "realtime",
        bitrateMode: "constant",
        avc: { format: "annexb" },
      });
      videoEncoderRef.current = encoder;
      isEncodingRef.current = true;

      const outs = [];
      const finalFbKey = streamKey.trim();
      if (targetFacebook && finalFbKey)
        outs.push(`rtmps://live-api-s.facebook.com:443/rtmp/${finalFbKey}`);
      if (targetYoutube && ytServer.trim() && ytKey.trim()) {
        const base = ytServer.endsWith("/") ? ytServer.slice(0, -1) : ytServer;
        outs.push(`${base}/${ytKey.trim()}`);
      }
      if (targetTiktok && ttServer.trim() && ttKey.trim()) {
        const base = ttServer.endsWith("/") ? ttServer.slice(0, -1) : ttServer;
        outs.push(`${base}/${ttKey.trim()}`);
      }

      const startPayload = {
        type: "start",
        outputs: outs,
        streamKey: outs.length === 0 ? finalFbKey : undefined,
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
        videoBitrate: preset.videoBitsPerSecond + "k",
        audioBitrate: "128k",
      };
      ws.send(JSON.stringify(startPayload));

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Start timeout")),
          10000
        );
        const handler = (evt) => {
          if (typeof evt.data !== "string") return;
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "started") {
              clearTimeout(timeout);
              ws.removeEventListener("message", handler);
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
                      out[0] = 0x01; // audio packet
                      out.set(u8, 1);
                      wsRef.current.send(out.buffer);
                    } catch { }
                  };
                  mr.start(100);
                  audioRecorderRef.current = mr;
                }
              } catch (e) {
                console.warn("Không thể khởi tạo mic:", e?.message || e);
              }
              resolve();
            }
            if (msg.type === "error") {
              clearTimeout(timeout);
              ws.removeEventListener("message", handler);
              reject(new Error(msg.message));
            }
          } catch { }
        };
        ws.addEventListener("message", handler);
      });

      statsRef.current = {
        sent: 0,
        dropped: 0,
        lastLog: Date.now(),
        avgFps: 0,
      };
      frameCountRef.current = 0;

      const canvas = canvasRef.current;
      const video = videoRef.current;
      const ctx = canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
        willReadFrequently: false,
      });
      const frameDurationMicros = 1000000 / QUALITY_PRESETS[qualityMode].fps;
      frameIntervalRef.current = frameDurationMicros;
      let nextFrameTimeMicros = performance.now() * 1000;
      lastFrameTimestampRef.current = nextFrameTimeMicros;

      const encodeLoop = (nowMillis) => {
        if (!encodingLoopRef.current || !isEncodingRef.current) return;
        const nowMicros = nowMillis * 1000;
        if (videoEncoderRef.current.encodeQueueSize > 8) {
          console.warn(
            `⚠️ Encoder overload (queue=${videoEncoderRef.current.encodeQueueSize}), skipping frame`
          );
          statsRef.current.dropped++;
          nextFrameTimeMicros += frameDurationMicros;
          encodingLoopRef.current = requestAnimationFrame(encodeLoop);
          return;
        }
        if (nowMicros >= nextFrameTimeMicros) {
          try {
            if (
              !videoEncoderRef.current ||
              videoEncoderRef.current.state === "closed"
            ) {
              encodingLoopRef.current = null;
              return;
            }
            drawFrame(ctx, video, canvas.width, canvas.height);
            const frame = new VideoFrame(canvas, {
              timestamp: nextFrameTimeMicros,
              alpha: "discard",
            });
            const presetNow = QUALITY_PRESETS[qualityMode];
            const forceKeyframe =
              frameCountRef.current % (presetNow.fps * 2) === 0;
            videoEncoderRef.current.encode(frame, { keyFrame: forceKeyframe });
            frame.close();
            frameCountRef.current++;
            nextFrameTimeMicros += frameDurationMicros;
            lastFrameTimestampRef.current = nextFrameTimeMicros;
          } catch (err) {
            console.error("Frame capture error:", err);
            encodingLoopRef.current = null;
            isEncodingRef.current = false;
            return;
          }
        }
        encodingLoopRef.current = requestAnimationFrame(encodeLoop);
      };
      encodingLoopRef.current = requestAnimationFrame(encodeLoop);

      setIsStreaming(true);
      setStatus(`✅ LIVE - ${preset.label}`);
      setStatusType("success");
    } catch (err) {
      setStatus("❌ Lỗi: " + (err?.message || String(err)));
      setStatusType("error");
      setIsStreaming(false);
      setIsConnected(false);
      isEncodingRef.current = false;
      if (encodingLoopRef.current) {
        cancelAnimationFrame(encodingLoopRef.current);
        encodingLoopRef.current = null;
      }
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
        wsRef.current?.close();
      } catch { }
    } finally {
      setLoading(false);
    }
  };

  const stopStreamingPro = async () => {
    setLoading(true);
    try {
      isEncodingRef.current = false;
      if (encodingLoopRef.current) {
        cancelAnimationFrame(encodingLoopRef.current);
        encodingLoopRef.current = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (
        videoEncoderRef.current &&
        videoEncoderRef.current.state !== "closed"
      ) {
        try {
          await videoEncoderRef.current.flush();
          videoEncoderRef.current.close();
        } catch (err) {
          console.warn("Encoder close error:", err);
        }
        videoEncoderRef.current = null;
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsStreaming(false);
      setIsConnected(false);
      setStatus("Đã dừng streaming");
      setStatusType("info");
      setStreamHealth({ fps: 0, bitrate: 0, dropped: 0 });
    } catch (err) {
      setStatus("Lỗi khi dừng: " + err.message);
      setStatusType("error");
    } finally {
      setLoading(false);
    }
  };

  /* ====== UI & layout (giữ như cũ, thêm 2 switch auto) ====== */

  const ratioPadding =
    videoSize && videoSize.w > 0
      ? `${(videoSize.h / videoSize.w) * 100}%`
      : "56.25%";
  const activeOverlayCount =
    Object.values(overlayConfig).filter(Boolean).length;

  const OverlayControlsCard = React.memo(() => (
    <Card elevation={2} sx={{ mb: { xs: 2, md: 3 } }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
            cursor: isMobile ? "pointer" : "default",
          }}
          onClick={
            isMobile ? () => setOverlayExpanded(!overlayExpanded) : undefined
          }
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Layers color="primary" />
            <Typography variant="h6" fontWeight={600}>
              Overlay Controls
            </Typography>
            <Chip
              label={`${activeOverlayCount}/${Object.keys(overlayConfig).length
                }`}
              color="success"
              size="small"
            />
          </Box>
          {isMobile && (overlayExpanded ? <ExpandLess /> : <ExpandMore />)}
        </Box>
        <Collapse in={!isMobile || overlayExpanded}>
          <Divider sx={{ mb: 2 }} />
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
            <FormControlLabel
              control={
                <Switch
                  checked={overlayConfig.scoreBoard}
                  onChange={() => toggleOverlay("scoreBoard")}
                  size="small"
                />
              }
              label={<Typography variant="body2">Score Board</Typography>}
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
              label={<Typography variant="body2">Tournament Name</Typography>}
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
              label={<Typography variant="body2">Sponsors</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={overlayConfig.lowerThird}
                  onChange={() => toggleOverlay("lowerThird")}
                  size="small"
                />
              }
              label={<Typography variant="body2">Lower Third</Typography>}
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
              label={<Typography variant="body2">Social Media</Typography>}
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
              label={<Typography variant="body2">Frame Decoration</Typography>}
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
              label={<Typography variant="body2">Live Badge</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={overlayConfig.viewerCount}
                  onChange={() => toggleOverlay("viewerCount")}
                  size="small"
                />
              }
              label={<Typography variant="body2">Viewer Count</Typography>}
            />
          </Box>
          <Alert severity="success" sx={{ mt: 2 }} icon={<CheckCircle />}>
            <Typography variant="caption">
              ✅ Adaptive Quality + Zero Flicker
            </Typography>
          </Alert>
        </Collapse>
      </CardContent>
    </Card>
  ));

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "linear-gradient(135deg,#667eea 0%,#764ba2 100%)",
        py: { xs: 2, md: 4 },
      }}
    >
      <Container maxWidth="xl">
        <Paper
          elevation={6}
          sx={{ borderRadius: { xs: 2, md: 3 }, overflow: "hidden" }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              alignItems: { xs: "flex-start", sm: "center" },
              justifyContent: "space-between",
              gap: 2,
              p: { xs: 2, md: 3 },
              borderBottom: "2px solid",
              borderColor: "divider",
              background: "linear-gradient(to right, #f8f9fa, #ffffff)",
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: { xs: 1, md: 2 },
                flexWrap: "wrap",
              }}
            >
              <RadioButtonChecked
                sx={{ fontSize: { xs: 32, md: 40 }, color: "error.main" }}
              />
              <Typography
                variant={isMobile ? "h5" : "h4"}
                fontWeight="bold"
                color="text.primary"
              >
                Facebook Live - Adaptive Quality
              </Typography>
              <Chip
                label="Auto Quality"
                color="success"
                size="small"
                sx={{ fontWeight: "bold" }}
              />
            </Box>
            {isStreaming && (
              <Chip
                icon={<RadioButtonChecked />}
                label="LIVE"
                color="error"
                sx={{
                  fontWeight: "bold",
                  fontSize: { xs: "0.875rem", md: "1rem" },
                  px: 2,
                  animation: "pulse 2s infinite",
                  "@keyframes pulse": {
                    "0%,100%": { opacity: 1 },
                    "50%": { opacity: 0.7 },
                  },
                }}
              />
            )}
          </Box>

          <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Grid container spacing={{ xs: 2, md: 3 }}>
              <Grid item size={{ xs: 12, lg: 8 }}>
                <Card elevation={2} sx={{ mb: { xs: 2, md: 3 } }}>
                  <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 2,
                        flexWrap: "wrap",
                        gap: 1,
                      }}
                    >
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Videocam color="primary" />
                        <Typography
                          variant={isMobile ? "subtitle1" : "h6"}
                          fontWeight={600}
                        >
                          Camera ({QUALITY_PRESETS[qualityMode].label})
                        </Typography>
                      </Box>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<FlipCameraAndroid />}
                        onClick={toggleCamera}
                        disabled={!canSwitchCamera || isStreaming || loading}
                      >
                        {facingMode === "environment" ? "Sau" : "Trước"}
                      </Button>
                    </Box>
                    <Box
                      sx={{
                        position: "relative",
                        width: "100%",
                        paddingBottom: ratioPadding,
                        background: "#000",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          transform:
                            facingMode === "user" ? "scaleX(-1)" : "none",
                          transformOrigin: "center",
                        }}
                      />
                    </Box>
                  </CardContent>
                </Card>

                <Card elevation={2}>
                  <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 2,
                      }}
                    >
                      <SportsScore color="primary" />
                      <Typography
                        variant={isMobile ? "subtitle1" : "h6"}
                        fontWeight={600}
                      >
                        Stream Preview (Match: {watchedMatchId || "N/A"}
                        {courtId ? ` • Court: ${courtId}` : ""})
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        position: "relative",
                        width: "100%",
                        paddingBottom: ratioPadding,
                        background: "#000",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <canvas
                        ref={previewCanvasRef}
                        width={videoSize.w}
                        height={videoSize.h}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          display: isStreaming ? "none" : "block",
                        }}
                      />
                      <canvas
                        ref={canvasRef}
                        width={videoSize.w}
                        height={videoSize.h}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          display: isStreaming ? "block" : "none",
                        }}
                      />
                    </Box>
                    {isStreaming && (
                      <Box
                        sx={{
                          mt: 2,
                          p: 2,
                          bgcolor: "success.light",
                          borderRadius: 2,
                        }}
                      >
                        <Typography
                          variant="subtitle2"
                          fontWeight={600}
                          gutterBottom
                        >
                          Stream Health
                        </Typography>
                        <Grid container spacing={1}>
                          <Grid item size={{ xs: 4 }}>
                            <Chip
                              label={`${streamHealth.fps} FPS`}
                              color="success"
                              size="small"
                              sx={{ width: "100%" }}
                            />
                          </Grid>
                          <Grid item size={{ xs: 4 }}>
                            <Chip
                              label={`${streamHealth.bitrate}k`}
                              color="info"
                              size="small"
                              sx={{ width: "100%" }}
                            />
                          </Grid>
                          <Grid item size={{ xs: 4 }}>
                            <Chip
                              label={`Drop: ${streamHealth.dropped}`}
                              color={
                                streamHealth.dropped > 10 ? "error" : "default"
                              }
                              size="small"
                              sx={{ width: "100%" }}
                            />
                          </Grid>
                        </Grid>
                      </Box>
                    )}
                    <Alert severity="success" sx={{ mt: 2 }}>
                      <Typography variant="body2">
                        ⚡ Adaptive Quality: Tự động điều chỉnh theo mạng!
                      </Typography>
                    </Alert>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item size={{ xs: 12, lg: 4 }}>
                <Card elevation={2} sx={{ mb: { xs: 2, md: 3 } }}>
                  <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 2,
                        cursor: isMobile ? "pointer" : "default",
                      }}
                      onClick={
                        isMobile
                          ? () => setSettingsExpanded(!settingsExpanded)
                          : undefined
                      }
                    >
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <SettingsInputHdmi color="primary" />
                        <Typography variant="h6" fontWeight={600}>
                          Quality Settings
                        </Typography>
                      </Box>
                      {isMobile &&
                        (settingsExpanded ? <ExpandLess /> : <ExpandMore />)}
                    </Box>

                    <Collapse in={!isMobile || settingsExpanded}>
                      <Box sx={{ mb: 2 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            mb: 1,
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <Speed fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">
                              Network Speed
                            </Typography>
                            <Tooltip title="Test lại tốc độ mạng">
                              <IconButton
                                size="small"
                                onClick={measureNetworkSpeed}
                                disabled={loading}
                              >
                                <Refresh fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                          <Chip
                            label={
                              networkSpeed > 0
                                ? `${networkSpeed} Mbps`
                                : "Testing..."
                            }
                            size="small"
                            color={
                              networkSpeed >= 5
                                ? "success"
                                : networkSpeed >= 2
                                  ? "warning"
                                  : "error"
                            }
                          />
                        </Box>
                        {networkSpeed > 0 && (
                          <LinearProgress
                            variant="determinate"
                            value={Math.min((networkSpeed / 10) * 100, 100)}
                            sx={{ height: 8, borderRadius: 1 }}
                          />
                        )}
                      </Box>

                      <Divider sx={{ my: 2 }} />

                      <FormControlLabel
                        control={
                          <Switch
                            checked={autoQuality}
                            onChange={(e) => {
                              setAutoQuality(e.target.checked);
                              if (e.target.checked && recommendedQuality)
                                setQualityMode(recommendedQuality);
                            }}
                            disabled={isStreaming}
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
                            <AutoMode fontSize="small" />
                            <Typography variant="body2">
                              Auto Quality
                            </Typography>
                          </Box>
                        }
                      />

                      <FormControl
                        fullWidth
                        sx={{ mt: 2 }}
                        disabled={isStreaming || autoQuality}
                      >
                        <InputLabel>Quality Preset</InputLabel>
                        <Select
                          value={qualityMode}
                          label="Quality Preset"
                          onChange={(e) => setQualityMode(e.target.value)}
                        >
                          {Object.entries(QUALITY_PRESETS).map(
                            ([key, preset]) => (
                              <MenuItem key={key} value={key}>
                                <Box>
                                  <Typography variant="body2" fontWeight={600}>
                                    {preset.label}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {preset.description}
                                  </Typography>
                                </Box>
                              </MenuItem>
                            )
                          )}
                        </Select>
                      </FormControl>

                      {autoQuality && recommendedQuality && (
                        <Alert
                          severity="info"
                          icon={<AutoMode />}
                          sx={{ mt: 2 }}
                        >
                          <Typography variant="caption">
                            Recommended:{" "}
                            <strong>
                              {QUALITY_PRESETS[recommendedQuality].label}
                            </strong>
                          </Typography>
                        </Alert>
                      )}

                      <Box
                        sx={{
                          mt: 2,
                          p: 2,
                          bgcolor: "action.hover",
                          borderRadius: 1,
                        }}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          gutterBottom
                        >
                          Current Settings:
                        </Typography>
                        <Grid container spacing={1}>
                          <Grid item size={{ xs: 6 }}>
                            <Typography variant="caption">
                              <strong>Resolution:</strong>{" "}
                              {QUALITY_PRESETS[qualityMode].width}x
                              {QUALITY_PRESETS[qualityMode].height}
                            </Typography>
                          </Grid>
                          <Grid item size={{ xs: 6 }}>
                            <Typography variant="caption">
                              <strong>FPS:</strong>{" "}
                              {QUALITY_PRESETS[qualityMode].fps}
                            </Typography>
                          </Grid>
                          <Grid item size={{ xs: 12 }}>
                            <Typography variant="caption">
                              <strong>Bitrate:</strong>{" "}
                              {QUALITY_PRESETS[qualityMode].videoBitsPerSecond}
                              kbps
                            </Typography>
                          </Grid>
                        </Grid>
                      </Box>
                    </Collapse>
                  </CardContent>
                </Card>

                <OverlayControlsCard />

                <Card elevation={2} sx={{ mb: { xs: 2, md: 3 } }}>
                  <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 3,
                      }}
                    >
                      <Info color="primary" />
                      <Typography variant="h6" fontWeight={600}>
                        Stream Settings
                      </Typography>
                    </Box>

                    {/* 🔔 AUTO-LIVE switches */}
                    <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={autoOnLive}
                            onChange={() => {
                              /* controlled outside? could be prop, keep read-only in demo */
                            }}
                          />
                        }
                        label={
                          <Typography variant="body2">
                            Auto start when court goes LIVE
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={autoCreateIfMissing}
                            onChange={() => {
                              /* prop-driven; keep read-only in demo */
                            }}
                          />
                        }
                        label={
                          <Typography variant="body2">
                            Auto-create live if missing
                          </Typography>
                        }
                      />
                    </Stack>
                    {courtId && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        Court: <b>{courtId}</b> — Match:{" "}
                        <b>{courtLiveState.matchId || "—"}</b> — Status:{" "}
                        <b>{courtLiveState.status || "—"}</b>
                      </Alert>
                    )}

                    <Typography
                      variant="subtitle2"
                      color="text.secondary"
                      sx={{ mb: 1 }}
                    >
                      Destinations
                    </Typography>
                    <Stack direction="column" spacing={1} sx={{ mb: 2 }}>
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

                    <TextField
                      type="password"
                      label="Facebook Stream Key"
                      placeholder="Auto từ URL/resolve hoặc nhập thủ công"
                      value={streamKey}
                      onChange={(e) => setStreamKey(e.target.value)}
                      disabled={isStreaming || !targetFacebook}
                      fullWidth
                      size={isMobile ? "small" : "medium"}
                      helperText={
                        targetFacebook
                          ? streamKey
                            ? autoFillFlags.fb
                              ? "✓ Đã điền từ URL/resolve"
                              : "✓ Đã có key"
                            : "Sẽ tự điền nếu backend trả về"
                          : "Facebook đang tắt — không cần nhập key"
                      }
                      sx={{ mb: 2 }}
                    />

                    <TextField
                      label="YouTube Server"
                      placeholder="rtmp://a.rtmp.youtube.com/live2"
                      value={ytServer}
                      onChange={(e) => setYtServer(e.target.value)}
                      disabled={isStreaming || !targetYoutube}
                      fullWidth
                      size={isMobile ? "small" : "medium"}
                      helperText={
                        targetYoutube && autoFillFlags.yt ? "✓ Tự điền" : ""
                      }
                      sx={{ mb: 1 }}
                    />
                    <TextField
                      label="YouTube Stream Key"
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      value={ytKey}
                      onChange={(e) => setYtKey(e.target.value)}
                      disabled={isStreaming || !targetYoutube}
                      fullWidth
                      size={isMobile ? "small" : "medium"}
                      helperText={
                        targetYoutube && autoFillFlags.yt && ytKey
                          ? "✓ Key từ resolve"
                          : ""
                      }
                      sx={{ mb: 2 }}
                    />

                    <TextField
                      label="TikTok Server"
                      placeholder="rtmp://..."
                      value={ttServer}
                      onChange={(e) => setTtServer(e.target.value)}
                      disabled={isStreaming || !targetTiktok}
                      fullWidth
                      size={isMobile ? "small" : "medium"}
                      helperText={
                        targetTiktok && autoFillFlags.tt ? "✓ Tự điền" : ""
                      }
                      sx={{ mb: 1 }}
                    />
                    <TextField
                      label="TikTok Stream Key"
                      placeholder="xxxxxxxx"
                      value={ttKey}
                      onChange={(e) => setTtKey(e.target.value)}
                      disabled={isStreaming || !targetTiktok}
                      fullWidth
                      size={isMobile ? "small" : "medium"}
                      helperText={
                        targetTiktok && autoFillFlags.tt && ttKey
                          ? "✓ Key từ resolve"
                          : ""
                      }
                      sx={{ mb: 3 }}
                    />

                    <Button
                      fullWidth
                      size="large"
                      variant="contained"
                      color={isStreaming ? "inherit" : "error"}
                      startIcon={
                        loading ? (
                          <CircularProgress size={20} color="inherit" />
                        ) : isStreaming ? (
                          <Stop />
                        ) : (
                          <PlayArrow />
                        )
                      }
                      onClick={
                        isStreaming ? stopStreamingPro : startStreamingPro
                      }
                      disabled={loading || (!isStreaming && !canStartNow())}
                      sx={{ py: 1.5, fontWeight: "bold", fontSize: "1rem" }}
                    >
                      {loading
                        ? "Đang xử lý..."
                        : isStreaming
                          ? "Dừng Stream"
                          : "Start Streaming"}
                    </Button>

                    <Alert
                      severity={statusType}
                      icon={<RadioButtonChecked />}
                      sx={{ alignItems: "center", mt: 2 }}
                    >
                      <Typography variant="body2" fontWeight={600}>
                        {status}
                      </Typography>
                    </Alert>
                  </CardContent>
                </Card>

                <Card elevation={2}>
                  <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                    <Alert severity="info" variant="outlined">
                      <Typography
                        variant="body2"
                        component="div"
                        sx={{ lineHeight: 1.6 }}
                      >
                        <strong>🚀 Features (auto-court):</strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          <li>
                            ✅ Nghe tín hiệu <b>trận LIVE của sân</b>, tự
                            start/stop
                          </li>
                          <li>
                            ✅ Resolve đa nền tảng (FB/YT/TT) & auto-fill
                            server/key
                          </li>
                          <li>
                            ✅ Optional: <b>Auto-create live</b> nếu chưa có
                            outputs
                          </li>
                          <li>
                            ✅ Overlay tỉ số bám <b>trận hiện tại</b> của sân
                          </li>
                          <li>✅ Adaptive Quality + Real-time health</li>
                        </ul>
                      </Typography>
                    </Alert>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
