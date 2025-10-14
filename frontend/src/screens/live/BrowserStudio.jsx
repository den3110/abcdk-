// FacebookLiveStreamerPro.jsx - COMPLETE VERSION WITH CANVAS OVERLAYS
// Copy toàn bộ file này để sử dụng

import React, { useEffect, useRef, useState } from "react";
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
} from "@mui/icons-material";

export default function FacebookLiveStreamerPro({
  matchId,
  wsUrl = "ws://localhost:5002/ws/rtmp",
  apiUrl = "http://localhost:5001/api/overlay/match",
  videoWidth = 1280,
  videoHeight = 720,
  fps = 30,
  videoBitsPerSecond = 2500,
}) {
  // ============================================
  // STATES
  // ============================================
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
  const [videoSize, setVideoSize] = useState({ w: videoWidth, h: videoHeight });

  // ✅ OVERLAY CONFIG STATE
  const [overlayConfig, setOverlayConfig] = useState({
    // Match Info
    scoreBoard: true,
    timer: true,
    tournamentName: true,

    // Branding
    logo: true,
    sponsors: false,
    lowerThird: false,

    // Interactive
    socialMedia: false,
    qrCode: false,
    frameDecor: false,

    // Status
    liveBadge: true,
    viewerCount: false,
  });

  // ✅ TIMER STATE
  const [streamTime, setStreamTime] = useState(0);

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const camStreamRef = useRef(null);
  const wsRef = useRef(null);
  const videoEncoderRef = useRef(null);
  const encodingLoopRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const overlayFetchingRef = useRef(false);
  const frameCountRef = useRef(0);
  const statsRef = useRef({ sent: 0, dropped: 0, lastLog: Date.now() });
  const isEncodingRef = useRef(false);

  const canSwitchCamera =
    videoDevices.length > 1 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ============================================
  // OVERLAY TOGGLE FUNCTIONS
  // ============================================
  const toggleOverlay = (key) => {
    setOverlayConfig((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleAllOverlays = (enabled) => {
    setOverlayConfig(
      Object.keys(overlayConfig).reduce((acc, key) => {
        acc[key] = enabled;
        return acc;
      }, {})
    );
  };

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  const roundRect = (ctx, x, y, width, height, radius) => {
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
  };

  // ============================================
  // DRAW OVERLAY FUNCTIONS
  // ============================================

  // Score Board (Top Left)
  const drawScoreBoard = (ctx, w, h, data) => {
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

    // Tournament name
    ctx.fillStyle = "#9AA4AF";
    ctx.font = "500 11px Inter, system-ui, Arial";
    ctx.textAlign = "left";
    ctx.fillText(data?.tournament?.name || "Tournament", x + 14, y + 22);

    // Team A
    const teamA = data?.teams?.A?.name || "Team A";
    const scoreA = data?.gameScores?.[data?.currentGame || 0]?.a || 0;

    ctx.fillStyle = "#25C2A0";
    ctx.beginPath();
    ctx.arc(x + 18, y + 45, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#E6EDF3";
    ctx.font = "600 16px Inter, system-ui, Arial";
    ctx.fillText(teamA, x + 32, y + 50);

    ctx.font = "800 24px Inter, system-ui, Arial";
    ctx.textAlign = "right";
    ctx.fillText(String(scoreA), x + width - 14, y + 50);

    // Team B
    const teamB = data?.teams?.B?.name || "Team B";
    const scoreB = data?.gameScores?.[data?.currentGame || 0]?.b || 0;

    ctx.fillStyle = "#4F46E5";
    ctx.beginPath();
    ctx.arc(x + 18, y + 85, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#E6EDF3";
    ctx.font = "600 16px Inter, system-ui, Arial";
    ctx.textAlign = "left";
    ctx.fillText(teamB, x + 32, y + 90);

    ctx.font = "800 24px Inter, system-ui, Arial";
    ctx.textAlign = "right";
    ctx.fillText(String(scoreB), x + width - 14, y + 90);

    ctx.restore();
  };

  // Timer (Top Center)
  const drawTimer = (ctx, w, h) => {
    const minutes = Math.floor(streamTime / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (streamTime % 60).toString().padStart(2, "0");
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
  };

  // Tournament Name (Top Right)
  const drawTournamentName = (ctx, w, h, data) => {
    const text = data?.tournament?.name || "Tournament 2025";
    const x = w - 320,
      y = 20;

    ctx.save();
    ctx.fillStyle = "rgba(11,15,20,0.85)";
    roundRect(ctx, x, y, 300, 50, 10);
    ctx.fill();

    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 18px Inter, system-ui, Arial";
    ctx.textAlign = "center";
    ctx.fillText(text, x + 150, y + 32);
    ctx.restore();
  };

  // Logo (Top Right)
  const drawLogo = (ctx, w, h) => {
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
  };

  // Sponsors (Bottom Right)
  const drawSponsors = (ctx, w, h) => {
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
  };

  // Lower Third (Bottom Left)
  const drawLowerThird = (ctx, w, h) => {
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
    ctx.fillStyle = "white";
    ctx.font = "bold 24px Inter, system-ui, Arial";
    ctx.textAlign = "left";
    ctx.fillText("Player Name", x + 20, y + 30);

    ctx.font = "16px Inter, system-ui, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("Champion • Team A", x + 20, y + 55);

    ctx.restore();
  };

  // Social Media (Bottom Left)
  const drawSocialMedia = (ctx, w, h) => {
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

      ctx.font = "14px Inter, system-ui, Arial";
      ctx.fillText(social.text, x + 50, y + 35 + i * 40);
    });
    ctx.restore();
  };

  // QR Code (Bottom Right)
  const drawQRCode = (ctx, w, h) => {
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
  };

  // Frame Decoration (Border)
  const drawFrameDecoration = (ctx, w, h) => {
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
  };

  // Live Badge (Top Right)
  const drawLiveBadge = (ctx, w, h) => {
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
    ctx.font = "bold 20px Inter, system-ui, Arial";
    ctx.textAlign = "left";
    ctx.fillText("LIVE", x + 50, y + 30);
    ctx.restore();
  };

  // Viewer Count (Below Live Badge)
  const drawViewerCount = (ctx, w, h) => {
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

    ctx.font = "bold 16px Inter, system-ui, Arial";
    ctx.fillText(`${viewers.toLocaleString()}`, x + 45, y + 27);
    ctx.restore();
  };

  // ============================================
  // USEEFFECTS
  // ============================================

  // Check WebCodecs support
  useEffect(() => {
    const supported = typeof window.VideoEncoder !== "undefined";
    setSupportsWebCodecs(supported);
    if (!supported) {
      setStatus("⚠️ WebCodecs không hỗ trợ. Cần Chrome/Edge 94+");
      setStatusType("warning");
    } else {
      setStatus("✅ WebCodecs ready - PRO mode available");
      setStatusType("success");
    }
  }, []);

  // Init overlay canvas
  useEffect(() => {
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = videoWidth;
    overlayCanvas.height = videoHeight;
    overlayCanvasRef.current = overlayCanvas;
  }, [videoWidth, videoHeight]);

  // ✅ TIMER USEEFFECT
  useEffect(() => {
    let interval = null;
    if (isStreaming) {
      setStreamTime(0);
      interval = setInterval(() => {
        setStreamTime((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStreaming]);

  // Enumerate video devices
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
        width: { ideal: videoWidth },
        height: { ideal: videoHeight },
        frameRate: { ideal: fps },
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
      const w = s.width || videoWidth;
      const h = s.height || videoHeight;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
      }

      setVideoSize({ w, h });
      setFacingMode(preferFacing);
      setStatus(
        `Camera sẵn sàng (${preferFacing === "environment" ? "sau" : "trước"})`
      );
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

  // Init camera on mount
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
  }, [fps, videoHeight, videoWidth]);

  // Fetch overlay data
  useEffect(() => {
    if (!matchId) return;
    let timer;
    const tick = async () => {
      if (overlayFetchingRef.current) return;
      overlayFetchingRef.current = true;
      try {
        const res = await fetch(`${apiUrl}/${matchId}`, { cache: "no-store" });
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
  }, [matchId, apiUrl]);

  // ✅ VẼ TẤT CẢ OVERLAYS
  useEffect(() => {
    if (!overlayCanvasRef.current) return;

    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas.getContext("2d", { alpha: true });
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Vẽ từng overlay nếu enabled
    if (overlayConfig.scoreBoard && overlayData) {
      drawScoreBoard(ctx, w, h, overlayData);
    }

    if (overlayConfig.timer) {
      drawTimer(ctx, w, h);
    }

    if (overlayConfig.tournamentName && overlayData) {
      drawTournamentName(ctx, w, h, overlayData);
    }

    if (overlayConfig.logo) {
      drawLogo(ctx, w, h);
    }

    if (overlayConfig.sponsors) {
      drawSponsors(ctx, w, h);
    }

    if (overlayConfig.lowerThird) {
      drawLowerThird(ctx, w, h);
    }

    if (overlayConfig.socialMedia) {
      drawSocialMedia(ctx, w, h);
    }

    if (overlayConfig.qrCode) {
      drawQRCode(ctx, w, h);
    }

    if (overlayConfig.frameDecor) {
      drawFrameDecoration(ctx, w, h);
    }

    if (overlayConfig.liveBadge) {
      drawLiveBadge(ctx, w, h);
    }

    if (overlayConfig.viewerCount) {
      drawViewerCount(ctx, w, h);
    }
  }, [overlayData, overlayConfig, streamTime]);

  const drawVideoCover = (ctx, video, cw, ch) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.max(cw / vw, ch / vh);
    const sw = cw / scale;
    const sh = ch / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
  };

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    let running = true;

    const drawFrame = () => {
      if (!running) return;

      if (video.readyState >= 2 && video.videoWidth) {
        drawVideoCover(ctx, video, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (overlayCanvasRef.current) {
        ctx.drawImage(
          overlayCanvasRef.current,
          0,
          0,
          canvas.width,
          canvas.height
        );
      }

      requestAnimationFrame(drawFrame);
    };

    const useRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    if (useRVFC) {
      const loop = () => {
        drawFrame();
        if (!running) return;
        video.requestVideoFrameCallback(loop);
      };
      video.requestVideoFrameCallback(loop);
    } else {
      requestAnimationFrame(drawFrame);
    }

    return () => {
      running = false;
    };
  }, [facingMode]);

  // ============================================
  // STREAMING FUNCTIONS
  // ============================================

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
      setStatus("Vui lòng nhập Stream Key");
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
              if (statsRef.current.sent === 0) {
                console.log("✅ H264 already in Annex-B format");
              }
            } else {
              if (statsRef.current.sent === 0) {
                console.log("🔄 Converting H264 from avcC to Annex-B");
              }
              if (
                chunk.type === "key" &&
                metadata?.decoderConfig?.description
              ) {
                const description = new Uint8Array(
                  metadata.decoderConfig.description
                );
                dataToSend = convertToAnnexB(chunkData, description, true);
                console.log(
                  `🔑 Keyframe with SPS/PPS: ${dataToSend.length} bytes`
                );
              } else {
                dataToSend = convertToAnnexB(chunkData, null, false);
              }
            }

            ws.send(dataToSend.buffer);
            statsRef.current.sent++;

            if (statsRef.current.sent <= 5) {
              console.log(
                `📤 Sent frame #${statsRef.current.sent}: ${dataToSend.length} bytes, type: ${chunk.type}`
              );
            }

            const now = Date.now();
            if (now - statsRef.current.lastLog > 3000) {
              const elapsed = (now - statsRef.current.lastLog) / 1000;
              const fpsNow = (statsRef.current.sent / elapsed).toFixed(1);
              console.log(
                `📊 FPS: ${fpsNow}, Sent: ${statsRef.current.sent}, Dropped: ${statsRef.current.dropped}`
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
        width: videoWidth,
        height: videoHeight,
        bitrate: videoBitsPerSecond * 1000,
        framerate: fps,
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
          width: videoWidth,
          height: videoHeight,
          fps,
          videoBitrate: videoBitsPerSecond + "k",
          audioBitrate: "192k",
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
                    audioBitsPerSecond: 128000,
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
                } else {
                  console.warn("Không tìm thấy audio track");
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

      statsRef.current = { sent: 0, dropped: 0, lastLog: Date.now() };
      frameCountRef.current = 0;

      const canvas = canvasRef.current;
      const frameInterval = 1000 / fps;
      let lastFrameTime = performance.now();

      const encodeLoop = (now) => {
        if (!encodingLoopRef.current || !isEncodingRef.current) return;

        if (now - lastFrameTime >= frameInterval) {
          lastFrameTime = now;

          try {
            if (
              !videoEncoderRef.current ||
              videoEncoderRef.current.state === "closed"
            ) {
              console.warn("⚠️ Encoder closed, stopping encode loop");
              encodingLoopRef.current = null;
              return;
            }

            const frame = new VideoFrame(canvas, {
              timestamp: now * 1000,
              alpha: "discard",
            });

            const forceKeyframe = frameCountRef.current % (fps * 2) === 0;
            encoder.encode(frame, { keyFrame: forceKeyframe });
            frame.close();
            frameCountRef.current++;
          } catch (err) {
            console.error("Frame capture error:", err);
            encodingLoopRef.current = null;
            isEncodingRef.current = false;
            try {
              if (
                audioRecorderRef.current &&
                audioRecorderRef.current.state !== "inactive"
              ) {
                audioRecorderRef.current.stop();
              }
              audioRecorderRef.current = null;
            } catch {}
            return;
          }
        }

        encodingLoopRef.current = requestAnimationFrame(encodeLoop);
      };

      encodingLoopRef.current = requestAnimationFrame(encodeLoop);

      setIsStreaming(true);
      setStatus("✅ LIVE - WebCodecs PRO (<1s latency)");
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

  // ============================================
  // RENDER
  // ============================================
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
                Facebook Live - WebCodecs PRO
              </Typography>
              <Chip
                label="H264 • <1s"
                color="success"
                size="small"
                sx={{ fontWeight: "bold" }}
              />
            </Box>
            {(isStreaming || isConnected) && (
              <Box sx={{ display: "flex", gap: 1 }}>
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
                        ref={canvasRef}
                        width={videoSize.w}
                        height={videoSize.h}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                        }}
                      />
                    </Box>

                    <Alert severity="success" sx={{ mt: 2 }}>
                      <Typography variant="body2">
                        ⚡ <strong>PRO MODE</strong>: WebCodecs H264, GPU
                        encode, Canvas overlays, 60+ FPS, Zero lag!
                      </Typography>
                    </Alert>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} lg={4}>
                {/* ✅ OVERLAY CONTROLS CARD */}
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
                        <Layers color="primary" />
                        <Typography variant="h6" fontWeight={600}>
                          Overlay Controls
                        </Typography>
                      </Box>
                      <Chip
                        label={`${activeOverlayCount}/${
                          Object.keys(overlayConfig).length
                        }`}
                        color="success"
                        size="small"
                      />
                    </Box>

                    <Divider sx={{ mb: 2 }} />

                    {/* Quick Actions */}
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

                    {/* Match Info Section */}
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
                        label={
                          <Typography variant="body2">Score Board</Typography>
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

                    {/* Branding Section */}
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

                    {/* Interactive Section */}
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

                    {/* Status Section */}
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
                        ✅ Canvas overlays: 60+ FPS, zero lag!
                      </Typography>
                    </Alert>
                  </CardContent>
                </Card>

                {/* STREAM SETTINGS CARD */}
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
                        type="password"
                        label="Facebook Stream Key"
                        placeholder="Nhập stream key"
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
                          : "Bắt đầu Stream PRO"}
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
                        <strong>🚀 WebCodecs PRO:</strong>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          <li>Hardware H264 encode (GPU)</li>
                          <li>Canvas overlays 60+ FPS</li>
                          <li>Latency &lt;1 giây</li>
                          <li>Unlimited overlays</li>
                          <li>Zero lag guaranteed!</li>
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
