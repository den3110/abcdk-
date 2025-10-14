// FacebookLiveStreamerAdaptive.jsx - AUTO QUALITY + AUTO STREAM KEY
import React, { useEffect, useRef, useState, useCallback } from "react";
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
  SignalCellularAlt,
  Warning,
} from "@mui/icons-material";

// 🎯 QUALITY PRESETS
const QUALITY_PRESETS = {
  low: {
    label: "Low (360p)",
    width: 640,
    height: 360,
    fps: 24,
    videoBitrate: 800,
    audioBitrate: 64,
  },
  medium: {
    label: "Medium (480p)",
    width: 854,
    height: 480,
    fps: 25,
    videoBitrate: 1200,
    audioBitrate: 96,
  },
  high: {
    label: "High (720p)",
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 2500,
    audioBitrate: 128,
  },
  ultra: {
    label: "Ultra (1080p)",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 4500,
    audioBitrate: 192,
  },
};

export default function FacebookLiveStreamerAdaptive() {
  // Parse URL params on mount
  const [matchId, setMatchId] = useState("");
  const [streamServer, setStreamServer] = useState("");
  const [streamKey, setStreamKey] = useState("");

  // Network & Quality
  const [networkSpeed, setNetworkSpeed] = useState(0); // Mbps
  const [qualityMode, setQualityMode] = useState("auto"); // auto, low, medium, high, ultra
  const [currentQuality, setCurrentQuality] = useState(QUALITY_PRESETS.high);
  const [isAdaptiveMode, setIsAdaptiveMode] = useState(true);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Đang khởi tạo...");
  const [statusType, setStatusType] = useState("info");
  const [overlayData, setOverlayData] = useState(null);
  const [facingMode, setFacingMode] = useState("user");
  const [videoDevices, setVideoDevices] = useState([]);
  const [supportsWebCodecs, setSupportsWebCodecs] = useState(false);
  const [videoSize, setVideoSize] = useState({ w: 1280, h: 720 });

  // Performance metrics
  const [performanceMetrics, setPerformanceMetrics] = useState({
    fps: 0,
    droppedFrames: 0,
    encoderQueue: 0,
    networkLatency: 0,
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

  const overlayDataRef = useRef(null);
  const overlayConfigRef = useRef(overlayConfig);
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
  const qualityAdjustmentRef = useRef(null);

  // 🌐 Parse URL parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const matchIdParam = params.get("matchId");
    const serverParam = params.get("server");
    const keyParam = params.get("key");

    if (matchIdParam) {
      setMatchId(matchIdParam);
      console.log("📍 Match ID from URL:", matchIdParam);
    }

    if (serverParam) {
      const decodedServer = decodeURIComponent(serverParam);
      setStreamServer(decodedServer);
      console.log("🌐 Stream Server from URL:", decodedServer);
    }

    if (keyParam) {
      const decodedKey = decodeURIComponent(keyParam);
      setStreamKey(decodedKey);
      console.log(
        "🔑 Stream Key from URL:",
        decodedKey.substring(0, 20) + "..."
      );
      setStatus("✅ Stream key tự động từ URL");
      setStatusType("success");
    } else {
      setStatus("⚠️ Chưa có stream key trong URL");
      setStatusType("warning");
    }
  }, []);

  // 📊 Network speed detection
  useEffect(() => {
    const detectNetworkSpeed = async () => {
      try {
        // Method 1: Navigator Connection API
        const connection =
          navigator.connection ||
          navigator.mozConnection ||
          navigator.webkitConnection;

        if (connection && connection.downlink) {
          const speedMbps = connection.downlink;
          setNetworkSpeed(speedMbps);
          console.log(
            `📡 Network speed: ${speedMbps} Mbps (${connection.effectiveType})`
          );

          // Auto-adjust quality based on speed
          if (isAdaptiveMode) {
            adjustQualityBasedOnSpeed(speedMbps);
          }
        } else {
          // Method 2: Manual speed test
          await performSpeedTest();
        }
      } catch (err) {
        console.warn("Network detection failed:", err);
        setNetworkSpeed(5); // Default to medium speed
        if (isAdaptiveMode) {
          setCurrentQuality(QUALITY_PRESETS.medium);
        }
      }
    };

    detectNetworkSpeed();

    // Re-check every 30 seconds
    const interval = setInterval(detectNetworkSpeed, 30000);

    return () => clearInterval(interval);
  }, [isAdaptiveMode]);

  // 🔍 Manual speed test
  const performSpeedTest = async () => {
    try {
      setStatus("📊 Đang kiểm tra tốc độ mạng...");

      const testUrl =
        "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png";
      const startTime = performance.now();

      const response = await fetch(testUrl + "?t=" + Date.now(), {
        cache: "no-store",
        mode: "no-cors",
      });

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000; // seconds
      const fileSize = 13504; // bytes (approximate)
      const speedBps = fileSize / duration;
      const speedMbps = (speedBps * 8) / (1024 * 1024);

      setNetworkSpeed(speedMbps);
      console.log(`🧪 Speed test: ${speedMbps.toFixed(2)} Mbps`);

      if (isAdaptiveMode) {
        adjustQualityBasedOnSpeed(speedMbps);
      }
    } catch (err) {
      console.warn("Speed test failed:", err);
      setNetworkSpeed(3); // Conservative default
      if (isAdaptiveMode) {
        setCurrentQuality(QUALITY_PRESETS.medium);
      }
    }
  };

  // 🎯 Adjust quality based on network speed
  const adjustQualityBasedOnSpeed = useCallback((speedMbps) => {
    let selectedQuality;

    if (speedMbps >= 10) {
      selectedQuality = QUALITY_PRESETS.ultra;
    } else if (speedMbps >= 5) {
      selectedQuality = QUALITY_PRESETS.high;
    } else if (speedMbps >= 2.5) {
      selectedQuality = QUALITY_PRESETS.medium;
    } else {
      selectedQuality = QUALITY_PRESETS.low;
    }

    setCurrentQuality(selectedQuality);
    console.log(
      `🎯 Auto quality: ${selectedQuality.label} (${speedMbps.toFixed(1)} Mbps)`
    );
    setStatus(`🎯 Chất lượng tự động: ${selectedQuality.label}`);
  }, []);

  // Manual quality selection
  const handleQualityChange = (e) => {
    const mode = e.target.value;
    setQualityMode(mode);

    if (mode === "auto") {
      setIsAdaptiveMode(true);
      adjustQualityBasedOnSpeed(networkSpeed);
    } else {
      setIsAdaptiveMode(false);
      setCurrentQuality(QUALITY_PRESETS[mode]);
      console.log(`🎬 Manual quality: ${QUALITY_PRESETS[mode].label}`);
    }
  };

  // Monitor performance and adjust quality dynamically
  useEffect(() => {
    if (!isStreaming || !isAdaptiveMode) return;

    const monitorPerformance = setInterval(() => {
      const encoder = videoEncoderRef.current;
      if (!encoder) return;

      const queueSize = encoder.encodeQueueSize || 0;
      const droppedFrames = statsRef.current.dropped;

      setPerformanceMetrics((prev) => ({
        fps: parseFloat(statsRef.current.avgFps) || 0,
        droppedFrames: droppedFrames,
        encoderQueue: queueSize,
        networkLatency: 0,
      }));

      // Auto-downgrade if performance issues
      if (queueSize > 15 || droppedFrames > 50) {
        console.warn(
          `⚠️ Performance issues detected! Queue: ${queueSize}, Dropped: ${droppedFrames}`
        );

        // Downgrade quality
        if (currentQuality.label === QUALITY_PRESETS.ultra.label) {
          setCurrentQuality(QUALITY_PRESETS.high);
          setStatus("⬇️ Giảm xuống High do hiệu suất");
          setStatusType("warning");
        } else if (currentQuality.label === QUALITY_PRESETS.high.label) {
          setCurrentQuality(QUALITY_PRESETS.medium);
          setStatus("⬇️ Giảm xuống Medium do hiệu suất");
          setStatusType("warning");
        }

        // Reset stats
        statsRef.current.dropped = 0;
      }
    }, 5000);

    return () => clearInterval(monitorPerformance);
  }, [isStreaming, isAdaptiveMode, currentQuality]);

  useEffect(() => {
    overlayDataRef.current = overlayData;
  }, [overlayData]);

  useEffect(() => {
    overlayConfigRef.current = overlayConfig;
  }, [overlayConfig]);

  const canSwitchCamera =
    videoDevices.length > 1 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const toggleOverlay = useCallback((key) => {
    setOverlayConfig((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleAllOverlays = useCallback((enabled) => {
    setOverlayConfig((prev) =>
      Object.keys(prev).reduce((acc, key) => {
        acc[key] = enabled;
        return acc;
      }, {})
    );
  }, []);

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
      const x = 20,
        y = 20,
        width = 320,
        height = 120;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.9)";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 15;
      roundRect(ctx, x, y, width, height, 12);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#9AA4AF";
      ctx.font = "500 11px Arial";
      ctx.textAlign = "left";
      ctx.fillText(data?.tournament?.name || "Tournament", x + 14, y + 22);
      const teamA = data?.teams?.A?.name || "Team A";
      const scoreA = data?.gameScores?.[data?.currentGame || 0]?.a || 0;
      ctx.fillStyle = "#25C2A0";
      ctx.beginPath();
      ctx.arc(x + 18, y + 45, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#E6EDF3";
      ctx.font = "600 16px Arial";
      ctx.fillText(teamA, x + 32, y + 50);
      ctx.font = "800 24px Arial";
      ctx.textAlign = "right";
      ctx.fillText(String(scoreA), x + width - 14, y + 50);
      const teamB = data?.teams?.B?.name || "Team B";
      const scoreB = data?.gameScores?.[data?.currentGame || 0]?.b || 0;
      ctx.fillStyle = "#4F46E5";
      ctx.beginPath();
      ctx.arc(x + 18, y + 85, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#E6EDF3";
      ctx.font = "600 16px Arial";
      ctx.textAlign = "left";
      ctx.fillText(teamB, x + 32, y + 90);
      ctx.font = "800 24px Arial";
      ctx.textAlign = "right";
      ctx.fillText(String(scoreB), x + width - 14, y + 90);
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
      const x = w / 2 - 80,
        y = 20;
      ctx.save();
      ctx.fillStyle = "rgba(239,68,68,0.95)";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 15;
      roundRect(ctx, x, y, 160, 50, 25);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "white";
      ctx.font = "bold 28px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${minutes}:${seconds}`, w / 2, y + 35);
      ctx.restore();
    },
    [roundRect]
  );

  const drawTournamentName = useCallback(
    (ctx, w, h, data) => {
      if (!data) return;
      const text = data?.tournament?.name || "Tournament 2025";
      const x = w - 320,
        y = 20;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.85)";
      roundRect(ctx, x, y, 300, 50, 10);
      ctx.fill();
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 18px Arial";
      ctx.textAlign = "center";
      ctx.fillText(text, x + 150, y + 32);
      ctx.restore();
    },
    [roundRect]
  );

  const drawLogo = useCallback(
    (ctx, w, h) => {
      const x = w - 170,
        y = 90,
        size = 150;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 10;
      roundRect(ctx, x, y, size, 60, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#667eea";
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.fillText("YOUR LOGO", x + size / 2, y + 38);
      ctx.restore();
    },
    [roundRect]
  );

  const drawSponsors = useCallback(
    (ctx, w, h) => {
      const sponsors = ["SPONSOR 1", "SPONSOR 2", "SPONSOR 3"];
      const x = w - 250,
        y = h - 120;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      roundRect(ctx, x, y, 230, 100, 8);
      ctx.fill();
      ctx.fillStyle = "#333";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      sponsors.forEach((sponsor, i) => {
        ctx.fillText(sponsor, x + 115, y + 25 + i * 25);
      });
      ctx.restore();
    },
    [roundRect]
  );

  const drawLowerThird = useCallback(
    (ctx, w, h) => {
      const x = 40,
        y = h - 100,
        width = 500;
      ctx.save();
      const gradient = ctx.createLinearGradient(x, y, x + width, y);
      gradient.addColorStop(0, "rgba(239,68,68,0.95)");
      gradient.addColorStop(1, "rgba(220,38,38,0.95)");
      ctx.fillStyle = gradient;
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 15;
      roundRect(ctx, x, y, width, 70, 35);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.fillRect(x, y, 4, 70);
      ctx.shadowBlur = 0;
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "left";
      ctx.fillText("Player Name", x + 20, y + 30);
      ctx.font = "16px Arial";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText("Champion • Team A", x + 20, y + 55);
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
      const x = 20,
        y = h - 150;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.85)";
      roundRect(ctx, x, y, 280, 130, 10);
      ctx.fill();
      socials.forEach((social, i) => {
        ctx.fillStyle = "white";
        ctx.font = "20px Arial";
        ctx.textAlign = "left";
        ctx.fillText(social.icon, x + 15, y + 35 + i * 40);
        ctx.font = "14px Arial";
        ctx.fillText(social.text, x + 50, y + 35 + i * 40);
      });
      ctx.restore();
    },
    [roundRect]
  );

  const drawQRCode = useCallback(
    (ctx, w, h) => {
      const x = w - 130,
        y = h - 130,
        size = 110;
      ctx.save();
      ctx.fillStyle = "white";
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 10;
      roundRect(ctx, x, y, size, size, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#000";
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          if ((i + j) % 2 === 0) {
            ctx.fillRect(x + 10 + i * 11, y + 10 + j * 11, 10, 10);
          }
        }
      }
      ctx.restore();
    },
    [roundRect]
  );

  const drawFrameDecoration = useCallback((ctx, w, h) => {
    ctx.save();
    const gradient1 = ctx.createLinearGradient(0, 0, w, 0);
    gradient1.addColorStop(0, "rgba(102,126,234,0.8)");
    gradient1.addColorStop(1, "rgba(118,75,162,0.8)");
    ctx.fillStyle = gradient1;
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h - 3, w, 3);
    const gradient2 = ctx.createLinearGradient(0, 0, 0, h);
    gradient2.addColorStop(0, "rgba(102,126,234,0.8)");
    gradient2.addColorStop(1, "rgba(118,75,162,0.8)");
    ctx.fillStyle = gradient2;
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
      const x = w - 150,
        y = 20;
      ctx.save();
      ctx.fillStyle = "rgba(239,68,68,0.95)";
      ctx.shadowColor = "rgba(239,68,68,0.5)";
      ctx.shadowBlur = 15;
      roundRect(ctx, x, y, 130, 45, 22);
      ctx.fill();
      const pulseSize = 8 + Math.sin(Date.now() / 300) * 2;
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(x + 25, y + 22, pulseSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "white";
      ctx.font = "bold 20px Arial";
      ctx.textAlign = "left";
      ctx.fillText("LIVE", x + 50, y + 30);
      ctx.restore();
    },
    [roundRect]
  );

  const drawViewerCount = useCallback(
    (ctx, w, h) => {
      const viewers = Math.floor(Math.random() * 1000 + 500);
      const x = w - 150,
        y = 75;
      ctx.save();
      ctx.fillStyle = "rgba(11,15,20,0.85)";
      roundRect(ctx, x, y, 130, 40, 20);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "18px Arial";
      ctx.textAlign = "left";
      ctx.fillText("👥", x + 15, y + 27);
      ctx.font = "bold 16px Arial";
      ctx.fillText(`${viewers.toLocaleString()}`, x + 45, y + 27);
      ctx.restore();
    },
    [roundRect]
  );

  const drawFrame = useCallback(
    (ctx, video, w, h) => {
      if (video.readyState >= 2 && video.videoWidth) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.max(w / vw, h / vh);
        const sw = w / scale;
        const sh = h / scale;
        const sx = (vw - sw) / 2;
        const sy = (vh - sh) / 2;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      }

      const config = overlayConfigRef.current;
      const data = overlayDataRef.current;

      if (config.scoreBoard && data) drawScoreBoard(ctx, w, h, data);
      if (config.timer) drawTimer(ctx, w, h);
      if (config.tournamentName && data) drawTournamentName(ctx, w, h, data);
      if (config.logo) drawLogo(ctx, w, h);
      if (config.sponsors) drawSponsors(ctx, w, h);
      if (config.lowerThird) drawLowerThird(ctx, w, h);
      if (config.socialMedia) drawSocialMedia(ctx, w, h);
      if (config.qrCode) drawQRCode(ctx, w, h);
      if (config.frameDecor) drawFrameDecoration(ctx, w, h);
      if (config.liveBadge) drawLiveBadge(ctx, w, h);
      if (config.viewerCount) drawViewerCount(ctx, w, h);
    },
    [
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

  useEffect(() => {
    const supported = typeof window.VideoEncoder !== "undefined";
    setSupportsWebCodecs(supported);
    if (!supported) {
      setStatus("⚠️ WebCodecs không hỗ trợ. Cần Chrome/Edge 94+");
      setStatusType("warning");
    }
  }, []);

  const enumerateVideoDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
    } catch {}
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
    } catch {}
  };

  const initCamera = async (preferFacing = "user") => {
    try {
      stopCurrentStream();
      const common = {
        width: { ideal: currentQuality.width },
        height: { ideal: currentQuality.height },
        frameRate: { ideal: currentQuality.fps },
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
      const w = s.width || currentQuality.width;
      const h = s.height || currentQuality.height;

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
      setStatus(`Camera sẵn sàng ${currentQuality.label}`);
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
      try {
        if (
          audioRecorderRef.current &&
          audioRecorderRef.current.state !== "inactive"
        ) {
          audioRecorderRef.current.stop();
        }
        audioRecorderRef.current = null;
      } catch {}
      try {
        if (
          videoEncoderRef.current &&
          videoEncoderRef.current.state !== "closed"
        ) {
          videoEncoderRef.current.close();
        }
      } catch {}
      try {
        wsRef.current?.close();
      } catch {}
    };
  }, [currentQuality.fps, currentQuality.height, currentQuality.width]);

  useEffect(() => {
    if (!matchId) return;
    let timer;
    const tick = async () => {
      if (overlayFetchingRef.current) return;
      overlayFetchingRef.current = true;
      try {
        const res = await fetch(
          `http://localhost:5001/api/overlay/match/${matchId}`,
          { cache: "no-store" }
        );
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
  }, [matchId]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
    });

    let running = true;
    const render = () => {
      if (!running) return;
      drawFrame(ctx, video, canvas.width, canvas.height);
      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
    return () => {
      running = false;
    };
  }, [drawFrame, facingMode]);

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

      const numPPS = description[offset++];
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
      } else {
        break;
      }
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

  const startStreamingPro = async () => {
    if (!streamKey.trim()) {
      setStatus("Vui lòng nhập Stream Key hoặc sử dụng URL có key");
      setStatusType("warning");
      return;
    }

    if (!supportsWebCodecs) {
      setStatus("❌ WebCodecs không hỗ trợ. Cần Chrome/Edge 94+");
      setStatusType("error");
      return;
    }

    setLoading(true);

    try {
      setStatus("Đang kết nối WebSocket...");
      const ws = await new Promise((resolve, reject) => {
        const socket = new WebSocket("ws://localhost:5002/ws/rtmp");
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

      setStatus(`Đang khởi tạo H264 encoder (${currentQuality.label})...`);

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
              console.log(
                `📊 FPS: ${fpsNow}, Sent: ${statsRef.current.sent}, Dropped: ${statsRef.current.dropped}, Queue: ${encoder.encodeQueueSize}`
              );
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
        width: currentQuality.width,
        height: currentQuality.height,
        bitrate: currentQuality.videoBitrate * 1000,
        framerate: currentQuality.fps,
        hardwareAcceleration: "prefer-hardware",
        latencyMode: "realtime",
        bitrateMode: "constant",
        avc: { format: "annexb" },
      });

      videoEncoderRef.current = encoder;
      isEncodingRef.current = true;

      ws.send(
        JSON.stringify({
          type: "start",
          streamKey,
          width: currentQuality.width,
          height: currentQuality.height,
          fps: currentQuality.fps,
          videoBitrate: currentQuality.videoBitrate + "k",
          audioBitrate: currentQuality.audioBitrate + "k",
        })
      );

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
                    audioBitsPerSecond: currentQuality.audioBitrate * 1000,
                  });
                  mr.ondataavailable = async (e) => {
                    try {
                      if (!e.data || e.data.size === 0) return;
                      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
                      const buf = await e.data.arrayBuffer();
                      const u8 = new Uint8Array(buf);
                      const out = new Uint8Array(u8.length + 1);
                      out[0] = 0x01;
                      out.set(u8, 1);
                      wsRef.current.send(out.buffer);
                    } catch {}
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
          } catch {}
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

      const frameDurationMicros = 1000000 / currentQuality.fps;
      frameIntervalRef.current = frameDurationMicros;
      let nextFrameTimeMicros = performance.now() * 1000;
      lastFrameTimestampRef.current = nextFrameTimeMicros;

      const encodeLoop = (nowMillis) => {
        if (!encodingLoopRef.current || !isEncodingRef.current) return;

        const nowMicros = nowMillis * 1000;

        if (encoder.encodeQueueSize > 8) {
          console.warn(
            `⚠️ Encoder overload (queue=${encoder.encodeQueueSize}), skipping frame`
          );
          statsRef.current.dropped++;
          nextFrameTimeMicros += frameDurationMicros;
          encodingLoopRef.current = requestAnimationFrame(encodeLoop);
          return;
        }

        if (nowMicros >= nextFrameTimeMicros) {
          try {
            if (!encoder || encoder.state === "closed") {
              encodingLoopRef.current = null;
              return;
            }

            drawFrame(ctx, video, canvas.width, canvas.height);

            const frame = new VideoFrame(canvas, {
              timestamp: nextFrameTimeMicros,
              alpha: "discard",
            });

            const forceKeyframe =
              frameCountRef.current % (currentQuality.fps * 2) === 0;
            encoder.encode(frame, { keyFrame: forceKeyframe });
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
      setStatus(
        `✅ LIVE - ${currentQuality.label} @ ${networkSpeed.toFixed(1)} Mbps`
      );
      setStatusType("success");
    } catch (err) {
      setStatus("❌ Lỗi: " + err.message);
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
      } catch {}

      try {
        wsRef.current?.close();
      } catch {}
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
    } catch (err) {
      setStatus("Lỗi khi dừng: " + err.message);
      setStatusType("error");
    } finally {
      setLoading(false);
    }
  };

  const ratioPadding =
    videoSize && videoSize.w > 0
      ? `${(videoSize.h / videoSize.w) * 100}%`
      : "56.25%";
  const activeOverlayCount =
    Object.values(overlayConfig).filter(Boolean).length;

  const OverlayControlsCard = React.memo(() => (
    <Card elevation={2} sx={{ mb: 3 }}>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Layers color="primary" />
            <Typography variant="h6" fontWeight={600}>
              Overlay Controls
            </Typography>
          </Box>
          <Chip
            label={`${activeOverlayCount}/${Object.keys(overlayConfig).length}`}
            color="success"
            size="small"
          />
        </Box>
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
        <Box sx={{ pl: 2, mb: 2 }}>
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
        <Box sx={{ pl: 2, mb: 2 }}>
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
        <Box sx={{ pl: 2, mb: 2 }}>
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
        <Box sx={{ pl: 2 }}>
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
      </CardContent>
    </Card>
  ));

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "linear-gradient(135deg,#667eea 0%,#764ba2 100%)",
        py: 4,
      }}
    >
      <Container maxWidth="xl">
        <Paper elevation={6} sx={{ borderRadius: 3, overflow: "hidden" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 3,
              borderBottom: "2px solid",
              borderColor: "divider",
              background: "linear-gradient(to right, #f8f9fa, #ffffff)",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <RadioButtonChecked sx={{ fontSize: 40, color: "error.main" }} />
              <Typography variant="h4" fontWeight="bold" color="text.primary">
                Facebook Live Adaptive
              </Typography>
              <Chip
                label={currentQuality.label}
                color="primary"
                size="small"
                sx={{ fontWeight: "bold" }}
              />
              {networkSpeed > 0 && (
                <Chip
                  icon={<Speed />}
                  label={`${networkSpeed.toFixed(1)} Mbps`}
                  color="success"
                  size="small"
                />
              )}
            </Box>
            {isStreaming && (
              <Chip
                icon={<RadioButtonChecked />}
                label="LIVE"
                color="error"
                sx={{
                  fontWeight: "bold",
                  fontSize: "1rem",
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

          <Box sx={{ p: 3 }}>
            <Grid container spacing={3}>
              <Grid item xs={12} lg={8}>
                <Card elevation={2} sx={{ mb: 3 }}>
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 2,
                      }}
                    >
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Videocam color="primary" />
                        <Typography variant="h6" fontWeight={600}>
                          Camera Input
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
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 2,
                      }}
                    >
                      <SportsScore color="primary" />
                      <Typography variant="h6" fontWeight={600}>
                        Stream Preview (Match: {matchId || "N/A"})
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
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="body2" gutterBottom>
                          Performance Metrics:
                        </Typography>
                        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                          <Chip
                            icon={<Speed />}
                            label={`${performanceMetrics.fps} FPS`}
                            size="small"
                            color={
                              performanceMetrics.fps >= 25
                                ? "success"
                                : "warning"
                            }
                          />
                          <Chip
                            label={`Dropped: ${performanceMetrics.droppedFrames}`}
                            size="small"
                            color={
                              performanceMetrics.droppedFrames < 10
                                ? "success"
                                : "error"
                            }
                          />
                          <Chip
                            label={`Queue: ${performanceMetrics.encoderQueue}`}
                            size="small"
                            color={
                              performanceMetrics.encoderQueue < 5
                                ? "success"
                                : "warning"
                            }
                          />
                        </Box>
                        {performanceMetrics.encoderQueue > 10 && (
                          <Alert
                            severity="warning"
                            sx={{ mt: 1 }}
                            icon={<Warning />}
                          >
                            <Typography variant="caption">
                              Encoder overload detected. Quality may
                              auto-adjust.
                            </Typography>
                          </Alert>
                        )}
                      </Box>
                    )}

                    <Alert severity="success" sx={{ mt: 2 }}>
                      <Typography variant="body2">
                        ⚡ <strong>Adaptive Quality</strong>: Tự động điều chỉnh
                        dựa trên mạng & hiệu suất!
                      </Typography>
                    </Alert>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} lg={4}>
                <Card elevation={2} sx={{ mb: 3 }}>
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 2,
                      }}
                    >
                      <SignalCellularAlt color="primary" />
                      <Typography variant="h6" fontWeight={600}>
                        Quality Settings
                      </Typography>
                    </Box>

                    <FormControl fullWidth sx={{ mb: 2 }}>
                      <InputLabel>Quality Mode</InputLabel>
                      <Select
                        value={qualityMode}
                        onChange={handleQualityChange}
                        disabled={isStreaming}
                        label="Quality Mode"
                      >
                        <MenuItem value="auto">🔄 Auto (Adaptive)</MenuItem>
                        <MenuItem value="low">📱 Low (360p - 800kbps)</MenuItem>
                        <MenuItem value="medium">
                          💻 Medium (480p - 1.2Mbps)
                        </MenuItem>
                        <MenuItem value="high">
                          🖥️ High (720p - 2.5Mbps)
                        </MenuItem>
                        <MenuItem value="ultra">
                          🎬 Ultra (1080p - 4.5Mbps)
                        </MenuItem>
                      </Select>
                    </FormControl>

                    <Box sx={{ mb: 2 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        gutterBottom
                      >
                        Network Speed
                      </Typography>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <LinearProgress
                          variant="determinate"
                          value={Math.min((networkSpeed / 10) * 100, 100)}
                          sx={{ flex: 1, height: 8, borderRadius: 4 }}
                          color={
                            networkSpeed >= 5
                              ? "success"
                              : networkSpeed >= 2.5
                              ? "warning"
                              : "error"
                          }
                        />
                        <Typography variant="body2" fontWeight={600}>
                          {networkSpeed.toFixed(1)} Mbps
                        </Typography>
                      </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box
                      sx={{ display: "flex", flexDirection: "column", gap: 1 }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          Resolution:
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {currentQuality.width}x{currentQuality.height}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          FPS:
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {currentQuality.fps}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          Video Bitrate:
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {currentQuality.videoBitrate}kbps
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          Audio Bitrate:
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {currentQuality.audioBitrate}kbps
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>

                <OverlayControlsCard />

                <Card elevation={2} sx={{ mb: 3 }}>
                  <CardContent>
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
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2.5,
                      }}
                    >
                      <TextField
                        label="Match ID"
                        value={matchId}
                        onChange={(e) => setMatchId(e.target.value)}
                        disabled={isStreaming}
                        fullWidth
                        size="small"
                      />
                      <TextField
                        type="password"
                        label="Facebook Stream Key"
                        placeholder="Tự động từ URL hoặc nhập thủ công"
                        value={streamKey}
                        onChange={(e) => setStreamKey(e.target.value)}
                        disabled={isStreaming}
                        fullWidth
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
                        disabled={
                          loading || (!isStreaming && !streamKey.trim())
                        }
                        sx={{ py: 1.5, fontWeight: "bold", fontSize: "1rem" }}
                      >
                        {loading
                          ? "Đang xử lý..."
                          : isStreaming
                          ? "Dừng Stream"
                          : `Bắt đầu Stream (${currentQuality.label})`}
                      </Button>
                      <Alert
                        severity={statusType}
                        icon={<RadioButtonChecked />}
                        sx={{ alignItems: "center" }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          {status}
                        </Typography>
                      </Alert>
                    </Box>
                  </CardContent>
                </Card>

                <Card elevation={2}>
                  <CardContent>
                    <Alert severity="info" variant="outlined">
                      <Typography
                        variant="body2"
                        component="div"
                        sx={{ lineHeight: 1.6 }}
                      >
                        <strong>🎯 Features:</strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          <li>✅ Auto stream key từ URL</li>
                          <li>✅ Adaptive quality theo mạng</li>
                          <li>✅ Performance monitoring</li>
                          <li>✅ Auto quality downgrade</li>
                          <li>✅ Network speed detection</li>
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
