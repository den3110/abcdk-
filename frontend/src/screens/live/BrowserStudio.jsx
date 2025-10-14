// FacebookLiveStreamerFinal.jsx - ADAPTIVE QUALITY + ZERO FLICKER
// ✅ Auto quality, URL params, perfect audio, zero lag
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ✅ QUALITY PRESETS
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

export default function FacebookLiveStreamerFinal({
  matchId,
  wsUrl = "ws://localhost:5002/ws/rtmp",
  apiUrl = "http://localhost:5001/api/overlay/match",
}) {
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

  // ✅ Adaptive quality states
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

  // Refs
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

  const canSwitchCamera =
    videoDevices.length > 1 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ✅ Parse stream key from URL
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const keyParam = urlParams.get("key");
      if (keyParam) {
        setStreamKey(keyParam);
        setStatus(`✅ Stream key từ URL`);
        setStatusType("success");
      }
    } catch (err) {
      console.warn("Cannot parse URL params:", err);
    }
  }, []);

  // ✅ Network speed monitoring
  const measureNetworkSpeed = useCallback(async () => {
    if (networkTestRef.current) return;
    try {
      networkTestRef.current = true;
      const startTime = Date.now();
      const response = await fetch(`https://via.placeholder.com/500`, {
        cache: "no-store",
      });
      if (response.ok) {
        const blob = await response.blob();
        const duration = (Date.now() - startTime) / 1000;
        const speedMbps = ((blob.size * 8) / duration / 1000000).toFixed(2);
        setNetworkSpeed(parseFloat(speedMbps));

        let recommended = "low";
        if (speedMbps >= 10) recommended = "ultra";
        else if (speedMbps >= 5) recommended = "high";
        else if (speedMbps >= 2) recommended = "medium";

        setRecommendedQuality(recommended);
        if (autoQuality && !isStreaming) {
          setQualityMode(recommended);
        }
      }
    } catch (err) {
      console.warn("Network test failed:", err);
      setNetworkSpeed(0);
    } finally {
      networkTestRef.current = null;
    }
  }, [autoQuality, isStreaming]);

  useEffect(() => {
    measureNetworkSpeed();
    const interval = setInterval(measureNetworkSpeed, 30000);
    return () => clearInterval(interval);
  }, [measureNetworkSpeed]);

  useEffect(() => {
    const preset = QUALITY_PRESETS[qualityMode];
    if (preset && !isStreaming) {
      setVideoSize({ w: preset.width, h: preset.height });
    }
  }, [qualityMode, isStreaming]);

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

  const drawFrameRef = useRef(drawFrame);
  useEffect(() => {
    drawFrameRef.current = drawFrame;
  }, [drawFrame]);

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
    } else {
      setStatus("✅ WebCodecs ready - ADAPTIVE");
      setStatusType("success");
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
      const w = s.width || preset.width;
      const h = s.height || preset.height;
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
  }, [qualityMode]);

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
      drawFrameRef.current(ctx, video, canvas.width, canvas.height);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
    return () => {
      running = false;
    };
  }, [facingMode]);

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
      const preset = QUALITY_PRESETS[qualityMode];
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
      ws.send(
        JSON.stringify({
          type: "start",
          streamKey,
          width: preset.width,
          height: preset.height,
          fps: preset.fps,
          videoBitrate: preset.videoBitsPerSecond + "k",
          audioBitrate: "128k",
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
      const frameDurationMicros = 1000000 / preset.fps;
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
              frameCountRef.current % (preset.fps * 2) === 0;
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
      setStatus(`✅ LIVE - ${preset.label}`);
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
      setStreamHealth({ fps: 0, bitrate: 0, dropped: 0 });
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

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg,#667eea 0%,#764ba2 100%)",
        padding: "2rem",
      }}
    >
      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          background: "white",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1.5rem 2rem",
            borderBottom: "2px solid #e5e7eb",
            background: "linear-gradient(to right, #f8f9fa, #ffffff)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span style={{ fontSize: "2rem", color: "#ef4444" }}>🔴</span>
            <h1 style={{ margin: 0, fontSize: "1.875rem", fontWeight: "bold" }}>
              Facebook Live - Adaptive Quality
            </h1>
            {isStreaming && (
              <span
                style={{
                  padding: "0.25rem 0.75rem",
                  background: "#ef4444",
                  color: "white",
                  borderRadius: "9999px",
                  fontSize: "0.875rem",
                  fontWeight: "bold",
                }}
              >
                LIVE
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: "1.5rem",
            padding: "1.5rem",
          }}
        >
          <div>
            <div
              style={{
                background: "#f9fafb",
                padding: "1.5rem",
                borderRadius: "8px",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem",
                }}
              >
                <h2
                  style={{ margin: 0, fontSize: "1.25rem", fontWeight: "600" }}
                >
                  📹 Camera ({QUALITY_PRESETS[qualityMode].label})
                </h2>
                <button
                  onClick={toggleCamera}
                  disabled={!canSwitchCamera || isStreaming || loading}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    background: "white",
                    cursor:
                      canSwitchCamera && !isStreaming && !loading
                        ? "pointer"
                        : "not-allowed",
                    opacity:
                      canSwitchCamera && !isStreaming && !loading ? 1 : 0.5,
                  }}
                >
                  🔄 {facingMode === "environment" ? "Sau" : "Trước"}
                </button>
              </div>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  paddingBottom: ratioPadding,
                  background: "#000",
                  borderRadius: "8px",
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
                    transform: facingMode === "user" ? "scaleX(-1)" : "none",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                background: "#f9fafb",
                padding: "1.5rem",
                borderRadius: "8px",
              }}
            >
              <h2
                style={{
                  margin: "0 0 1rem 0",
                  fontSize: "1.25rem",
                  fontWeight: "600",
                }}
              >
                🎮 Stream Preview (Match: {matchId || "N/A"})
              </h2>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  paddingBottom: ratioPadding,
                  background: "#000",
                  borderRadius: "8px",
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
              </div>

              {isStreaming && (
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "1rem",
                    background: "#ecfdf5",
                    borderRadius: "6px",
                    border: "1px solid #10b981",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: "600",
                      marginBottom: "0.5rem",
                    }}
                  >
                    Stream Health:
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div
                      style={{
                        padding: "0.5rem",
                        background: "white",
                        borderRadius: "4px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        FPS
                      </div>
                      <div
                        style={{
                          fontSize: "1.25rem",
                          fontWeight: "bold",
                          color: "#10b981",
                        }}
                      >
                        {streamHealth.fps}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: "0.5rem",
                        background: "white",
                        borderRadius: "4px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        Bitrate
                      </div>
                      <div
                        style={{
                          fontSize: "1.25rem",
                          fontWeight: "bold",
                          color: "#3b82f6",
                        }}
                      >
                        {streamHealth.bitrate}k
                      </div>
                    </div>
                    <div
                      style={{
                        padding: "0.5rem",
                        background: "white",
                        borderRadius: "4px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        Dropped
                      </div>
                      <div
                        style={{
                          fontSize: "1.25rem",
                          fontWeight: "bold",
                          color:
                            streamHealth.dropped > 10 ? "#ef4444" : "#6b7280",
                        }}
                      >
                        {streamHealth.dropped}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div
              style={{
                background: "#f9fafb",
                padding: "1.5rem",
                borderRadius: "8px",
                marginBottom: "1.5rem",
              }}
            >
              <h2
                style={{
                  margin: "0 0 1rem 0",
                  fontSize: "1.25rem",
                  fontWeight: "600",
                }}
              >
                ⚙️ Quality
              </h2>

              <div
                style={{
                  marginBottom: "1rem",
                  padding: "1rem",
                  background: "white",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span>🌐 Network</span>
                    <button
                      onClick={measureNetworkSpeed}
                      disabled={loading}
                      style={{
                        padding: "0.25rem",
                        border: "none",
                        background: "transparent",
                        cursor: loading ? "not-allowed" : "pointer",
                      }}
                    >
                      🔄
                    </button>
                  </div>
                  <span
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      background:
                        networkSpeed >= 5
                          ? "#10b981"
                          : networkSpeed >= 2
                          ? "#f59e0b"
                          : "#ef4444",
                      color: "white",
                    }}
                  >
                    {networkSpeed > 0 ? `${networkSpeed} Mbps` : "Testing..."}
                  </span>
                </div>
                {networkSpeed > 0 && (
                  <div
                    style={{
                      width: "100%",
                      height: "8px",
                      background: "#e5e7eb",
                      borderRadius: "4px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min((networkSpeed / 10) * 100, 100)}%`,
                        height: "100%",
                        background:
                          "linear-gradient(to right, #10b981, #3b82f6)",
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                )}
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "1rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={autoQuality}
                  onChange={(e) => {
                    setAutoQuality(e.target.checked);
                    if (e.target.checked && recommendedQuality) {
                      setQualityMode(recommendedQuality);
                    }
                  }}
                  disabled={isStreaming}
                  style={{ width: "20px", height: "20px" }}
                />
                <span style={{ fontSize: "0.875rem", fontWeight: "500" }}>
                  🤖 Auto Quality
                </span>
              </label>

              <select
                value={qualityMode}
                onChange={(e) => setQualityMode(e.target.value)}
                disabled={isStreaming || autoQuality}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  background: "white",
                  cursor:
                    isStreaming || autoQuality ? "not-allowed" : "pointer",
                  opacity: isStreaming || autoQuality ? 0.6 : 1,
                  marginBottom: "1rem",
                }}
              >
                {Object.entries(QUALITY_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label} - {preset.description}
                  </option>
                ))}
              </select>

              {autoQuality && recommendedQuality && (
                <Alert>
                  <AlertDescription>
                    💡 Recommended:{" "}
                    <strong>{QUALITY_PRESETS[recommendedQuality].label}</strong>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div
              style={{
                background: "#f9fafb",
                padding: "1.5rem",
                borderRadius: "8px",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "1rem",
                }}
              >
                <h2
                  style={{ margin: 0, fontSize: "1.25rem", fontWeight: "600" }}
                >
                  🎨 Overlays
                </h2>
                <span
                  style={{
                    padding: "0.25rem 0.75rem",
                    background: "#10b981",
                    color: "white",
                    borderRadius: "9999px",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                  }}
                >
                  {activeOverlayCount}/{Object.keys(overlayConfig).length}
                </span>
              </div>
              <div
                style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}
              >
                <button
                  onClick={() => toggleAllOverlays(true)}
                  style={{
                    flex: 1,
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    background: "white",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Enable All
                </button>
                <button
                  onClick={() => toggleAllOverlays(false)}
                  style={{
                    flex: 1,
                    padding: "0.5rem",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    background: "white",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  Disable All
                </button>
              </div>

              <div
                style={{
                  maxHeight: "200px",
                  overflowY: "auto",
                  fontSize: "0.875rem",
                }}
              >
                {Object.entries(overlayConfig).map(([key, value]) => (
                  <label
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 0",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() => toggleOverlay(key)}
                      style={{ width: "16px", height: "16px" }}
                    />
                    <span style={{ textTransform: "capitalize" }}>
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div
              style={{
                background: "#f9fafb",
                padding: "1.5rem",
                borderRadius: "8px",
                marginBottom: "1.5rem",
              }}
            >
              <h2
                style={{
                  margin: "0 0 1rem 0",
                  fontSize: "1.25rem",
                  fontWeight: "600",
                }}
              >
                📡 Stream
              </h2>

              <input
                type="password"
                placeholder="Stream key (auto từ URL)"
                value={streamKey}
                onChange={(e) => setStreamKey(e.target.value)}
                disabled={isStreaming}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  marginBottom: "1rem",
                  opacity: isStreaming ? 0.6 : 1,
                }}
              />

              <button
                onClick={isStreaming ? stopStreamingPro : startStreamingPro}
                disabled={loading || (!isStreaming && !streamKey.trim())}
                style={{
                  width: "100%",
                  padding: "1rem",
                  borderRadius: "6px",
                  border: "none",
                  background: isStreaming ? "#6b7280" : "#ef4444",
                  color: "white",
                  fontSize: "1rem",
                  fontWeight: "bold",
                  cursor:
                    loading || (!isStreaming && !streamKey.trim())
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    loading || (!isStreaming && !streamKey.trim()) ? 0.6 : 1,
                  marginBottom: "1rem",
                }}
              >
                {loading
                  ? "⏳ Đang xử lý..."
                  : isStreaming
                  ? "⏹️ Dừng"
                  : `▶️ Start ${QUALITY_PRESETS[qualityMode].label}`}
              </button>

              <Alert
                className={`${
                  statusType === "error"
                    ? "bg-red-50"
                    : statusType === "warning"
                    ? "bg-yellow-50"
                    : statusType === "success"
                    ? "bg-green-50"
                    : "bg-blue-50"
                }`}
              >
                <AlertDescription>
                  <strong>{status}</strong>
                </AlertDescription>
              </Alert>
            </div>

            <Alert>
              <AlertDescription>
                <strong>🚀 Features:</strong>
                <ul
                  style={{
                    margin: "0.5rem 0 0 0",
                    paddingLeft: "1.25rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <li>✅ Auto quality từ network</li>
                  <li>✅ Stream key từ URL</li>
                  <li>✅ 4 quality presets</li>
                  <li>✅ Zero flicker rendering</li>
                  <li>✅ Perfect audio sync</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </div>
  );
}
