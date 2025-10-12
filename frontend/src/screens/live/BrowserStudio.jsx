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
} from "@mui/material";
import {
  RadioButtonChecked,
  PlayArrow,
  Stop,
  Videocam,
  Info,
  SportsScore,
  FlipCameraAndroid,
} from "@mui/icons-material";

/**
 * WebRTC → WebSocket → FFmpeg → Facebook RTMP
 * Với ScoreOverlay FULL được composite vào stream (y hệt ScoreOverlay component)
 */

export default function FacebookLiveStreamer({
  matchId,
  wsUrl = "ws://localhost:5002/ws/rtmp",
  apiUrl = "http://localhost:5001/api/overlay/match",
  videoWidth = 1280,
  videoHeight = 720,
  fps = 30,
  videoBitsPerSecond = 2_500_000,
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamKey, setStreamKey] = useState("");
  const [status, setStatus] = useState("Chưa kết nối");
  const [statusType, setStatusType] = useState("info");
  const [overlayData, setOverlayData] = useState(null);

  // === NEW: camera switching state ===
  const [facingMode, setFacingMode] = useState("user"); // 'user' | 'environment'
  const [videoDevices, setVideoDevices] = useState([]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayContainerRef = useRef(null);
  const camStreamRef = useRef(null);
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const drawReqRef = useRef(0);
  const overlayImageRef = useRef(null);

  const canSwitchCamera =
    videoDevices.length > 1 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ====== helpers for camera ======
  const enumerateVideoDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
    } catch (_) {}
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
    // fallback guess
    if (isBack && videoDevices.length > 1)
      return videoDevices[videoDevices.length - 1].deviceId;
    return videoDevices[0]?.deviceId;
  };

  const stopCurrentStream = () => {
    try {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch (_) {}
  };

  const initCamera = async (preferFacing = "user") => {
    try {
      stopCurrentStream();
      const common = {
        width: { ideal: videoWidth },
        height: { ideal: videoHeight },
        frameRate: { ideal: fps },
      };

      let stream;
      // 1) try facingMode exact
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...common, facingMode: { exact: preferFacing } },
          audio: true,
        });
      } catch (_) {
        // 2) try facingMode ideal
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { ...common, facingMode: preferFacing },
            audio: true,
          });
        } catch (_) {
          // 3) fallback by deviceId
          await enumerateVideoDevices();
          const deviceId = findDeviceIdForFacing(preferFacing);
          stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId
              ? { ...common, deviceId: { exact: deviceId } }
              : common,
            audio: true,
          });
        }
      }

      camStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      setFacingMode(preferFacing);
      setStatus(
        `Camera đã sẵn sàng (${
          preferFacing === "environment" ? "sau" : "trước"
        })`
      );
      setStatusType("success");

      await enumerateVideoDevices(); // labels đầy đủ sau khi cấp quyền
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
      setStatus("Thiết bị không hỗ trợ đổi camera hoặc bị chặn quyền.");
      setStatusType("warning");
    }
    setLoading(false);
  };

  // ====== CAMERA (init) ======
  useEffect(() => {
    (async () => {
      await initCamera("user");
    })();
    return () => {
      stopCurrentStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fps, videoHeight, videoWidth]);

  // ====== FETCH OVERLAY DATA ======
  useEffect(() => {
    if (!matchId) return;

    const fetchOverlay = async () => {
      try {
        const res = await fetch(`${apiUrl}/${matchId}`);
        const data = await res.json();
        setOverlayData(data);
      } catch (err) {
        console.error("Fetch overlay error:", err);
      }
    };

    fetchOverlay();
    const interval = setInterval(fetchOverlay, 1000);
    return () => clearInterval(interval);
  }, [matchId, apiUrl]);

  // ====== DRAW CANVAS WITH OVERLAY ======
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      // 1. Draw camera feed
      if (video.readyState >= 2 && video.videoWidth) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // 2. Draw FULL overlay
      if (overlayData) {
        drawFullScoreOverlay(ctx, canvas.width, canvas.height, overlayData);
      }

      drawReqRef.current = requestAnimationFrame(render);
    };

    if (video.readyState >= 2) {
      render();
    } else {
      const onLoaded = () => render();
      video.addEventListener("loadeddata", onLoaded);
      return () => video.removeEventListener("loadeddata", onLoaded);
    }

    return () => {
      isRunning = false;
      if (drawReqRef.current) cancelAnimationFrame(drawReqRef.current);
    };
  }, [overlayData]);

  // ====== DRAW FULL SCORE OVERLAY (Y hệt ScoreOverlay component) ======
  const drawFullScoreOverlay = (ctx, w, h, data) => {
    const drawRoundedRect = (x, y, w, h, r) => {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    };

    const gameWon = (a, b, pts, byTwo) =>
      a >= pts && (byTwo ? a - b >= 2 : a - b >= 1);

    const phaseLabelFromData = (data) => {
      const bt = (data?.bracketType || "").toLowerCase();
      if (bt === "group") return "Vòng bảng";
      const rc = String(data?.roundCode || "").toUpperCase();
      if (rc === "F" || rc === "GF") return "Chung kết";
      if (rc === "SF") return "Bán kết";
      if (rc === "QF") return "Tứ kết";
      if (bt === "knockout" || bt === "ko") return "Vòng loại trực tiếp";
      return "";
    };

    const teamA =
      data?.teams?.A?.name || data?.pairA?.player1?.nickname || "Team A";
    const teamB =
      data?.teams?.B?.name || data?.pairB?.player1?.nickname || "Team B";
    const currentGame = data?.currentGame || 0;
    const gameScores = data?.gameScores || [{ a: 0, b: 0 }];
    const currentScore = gameScores[currentGame] || { a: 0, b: 0 };
    const scoreA = currentScore.a || 0;
    const scoreB = currentScore.b || 0;
    const rules = data?.rules || { bestOf: 3, pointsToWin: 11, winByTwo: true };
    const maxSets = Math.max(1, Number(rules.bestOf) || 3);
    const serveSide = (data?.serve?.side || "A").toUpperCase();
    const serveCount = Math.max(
      1,
      Math.min(2, Number(data?.serve?.server ?? 1) || 1)
    );
    const tourName = data?.tournament?.name || "";
    const phaseText = phaseLabelFromData(data);

    const theme = "dark";
    const size = "md";
    const accentA = "#25C2A0";
    const accentB = "#4F46E5";
    const bg =
      theme === "light" ? "rgba(255,255,255,0.8)" : "rgba(11,15,20,0.8)";
    const fg = theme === "light" ? "#0b0f14" : "#E6EDF3";
    const muted = theme === "light" ? "#5c6773" : "#9AA4AF";

    const rounded = 18;
    const pad = size === "lg" ? 16 : size === "sm" ? 10 : 14;
    const minW = size === "lg" ? 380 : size === "sm" ? 260 : 320;
    const nameSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;
    const scoreSize = size === "lg" ? 28 : size === "sm" ? 20 : 24;
    const metaSize = size === "lg" ? 12 : size === "sm" ? 10 : 11;
    const badgeSize = size === "lg" ? 10 : size === "sm" ? 9 : 10;
    const tableSize = size === "lg" ? 12 : size === "sm" ? 10 : 11;

    const overlayX = 16;
    const overlayY = 16;
    const overlayW = Math.max(minW, 320);

    const metaH = 20;
    const rowH = 32;
    const showSets = data?.overlay?.showSets !== false;
    const tableH = showSets ? 80 : 0;
    const overlayH = pad * 2 + metaH + rowH * 2 + tableH + 12;

    ctx.fillStyle = bg;
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    drawRoundedRect(overlayX, overlayY, overlayW, overlayH, rounded);
    ctx.fill();
    ctx.shadowBlur = 0;

    const metaY = overlayY + pad + 8;

    ctx.fillStyle = muted;
    ctx.font = `500 ${metaSize}px Inter, system-ui, Arial`;
    ctx.textAlign = "left";
    ctx.fillText(tourName || "—", overlayX + pad, metaY);

    if (phaseText) {
      const badgeText = phaseText;
      ctx.font = `700 ${badgeSize}px Inter, system-ui, Arial`;
      const badgeW = ctx.measureText(badgeText).width + 12;
      const badgeH = 18;
      const badgeX = overlayX + overlayW - pad - badgeW;
      const badgeY = metaY - 14;

      ctx.fillStyle = "#334155";
      drawRoundedRect(badgeX, badgeY, badgeW, badgeH, 999);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 13);
    }

    const rowAY = metaY + 24;

    ctx.fillStyle = accentA;
    ctx.beginPath();
    ctx.arc(overlayX + pad + 5, rowAY + 10, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.font = `600 ${nameSize}px Inter, system-ui, Arial`;
    ctx.textAlign = "left";
    ctx.fillText(teamA, overlayX + pad + 20, rowAY + 14);

    if (serveSide === "A") {
      const serveX = overlayX + pad + 20 + ctx.measureText(teamA).width + 8;
      const serveY = rowAY + 10;

      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      drawRoundedRect(
        serveX - 4,
        serveY - 8,
        serveCount * 8 + (serveCount - 1) * 4 + 8,
        16,
        6
      );
      ctx.stroke();

      ctx.fillStyle = muted;
      for (let i = 0; i < serveCount; i++) {
        ctx.beginPath();
        ctx.arc(serveX + i * 12, serveY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = fg;
    ctx.font = `800 ${scoreSize}px Inter, system-ui, Arial`;
    ctx.textAlign = "right";
    ctx.fillText(String(scoreA), overlayX + overlayW - pad, rowAY + 18);

    const rowBY = rowAY + 36;

    ctx.fillStyle = accentB;
    ctx.beginPath();
    ctx.arc(overlayX + pad + 5, rowBY + 10, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.font = `600 ${nameSize}px Inter, system-ui, Arial`;
    ctx.textAlign = "left";
    ctx.fillText(teamB, overlayX + pad + 20, rowBY + 14);

    if (serveSide === "B") {
      const serveX = overlayX + pad + 20 + ctx.measureText(teamB).width + 8;
      const serveY = rowBY + 10;

      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      drawRoundedRect(
        serveX - 4,
        serveY - 8,
        serveCount * 8 + (serveCount - 1) * 4 + 8,
        16,
        6
      );
      ctx.stroke();

      ctx.fillStyle = muted;
      for (let i = 0; i < serveCount; i++) {
        ctx.beginPath();
        ctx.arc(serveX + i * 12, serveY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = fg;
    ctx.font = `800 ${scoreSize}px Inter, system-ui, Arial`;
    ctx.textAlign = "right";
    ctx.fillText(String(scoreB), overlayX + overlayW - pad, rowBY + 18);

    if (showSets && tableH > 0) {
      const tableY = rowBY + 44;
      const cellW = 26;
      const cellH = 22;
      const cellGap = 4;

      ctx.font = `600 ${tableSize}px Inter, system-ui, Arial`;
      ctx.textAlign = "center";

      for (let i = 0; i < maxSets; i++) {
        const cellX = overlayX + pad + 30 + i * (cellW + cellGap);
        const isCurrent = i === currentGame;

        ctx.strokeStyle = isCurrent ? "#94a3b8" : "#cbd5e1";
        ctx.lineWidth = 1;
        drawRoundedRect(cellX, tableY, cellW, cellH, 6);
        ctx.stroke();

        if (isCurrent) {
          ctx.fillStyle = "rgba(14,165,233,0.2)";
          drawRoundedRect(cellX, tableY, cellW, cellH, 6);
          ctx.fill();
        }

        ctx.fillStyle = muted;
        ctx.fillText(`S${i + 1}`, cellX + cellW / 2, tableY + 15);
      }

      const rowATableY = tableY + cellH + cellGap;

      ctx.fillStyle = muted;
      ctx.font = `600 ${tableSize}px Inter, system-ui, Arial`;
      ctx.textAlign = "center";
      ctx.fillText("A", overlayX + pad + 15, rowATableY + 15);

      for (let i = 0; i < maxSets; i++) {
        const g = gameScores[i];
        const cellX = overlayX + pad + 30 + i * (cellW + cellGap);
        const isCurrent = i === currentGame;
        const isWon = g && gameWon(g.a, g.b, rules.pointsToWin, rules.winByTwo);

        if (isWon) {
          ctx.fillStyle = accentA;
          drawRoundedRect(cellX, rowATableY, cellW, cellH, 6);
          ctx.fill();
          ctx.fillStyle = "#fff";
        } else {
          ctx.strokeStyle = isCurrent ? "#94a3b8" : "#cbd5e1";
          ctx.lineWidth = 1;
          drawRoundedRect(cellX, rowATableY, cellW, cellH, 6);
          ctx.stroke();

          if (isCurrent) {
            ctx.fillStyle = "rgba(100,116,139,0.13)";
            drawRoundedRect(cellX, rowATableY, cellW, cellH, 6);
            ctx.fill();
          }

          ctx.fillStyle = fg;
        }

        const score = g && Number.isFinite(g.a) ? String(g.a) : "–";
        ctx.fillText(score, cellX + cellW / 2, rowATableY + 15);
      }

      const rowBTableY = rowATableY + cellH + cellGap;

      ctx.fillStyle = muted;
      ctx.font = `600 ${tableSize}px Inter, system-ui, Arial`;
      ctx.textAlign = "center";
      ctx.fillText("B", overlayX + pad + 15, rowBTableY + 15);

      for (let i = 0; i < maxSets; i++) {
        const g = gameScores[i];
        const cellX = overlayX + pad + 30 + i * (cellW + cellGap);
        const isCurrent = i === currentGame;
        const isWon = g && gameWon(g.b, g.a, rules.pointsToWin, rules.winByTwo);

        if (isWon) {
          ctx.fillStyle = accentB;
          drawRoundedRect(cellX, rowBTableY, cellW, cellH, 6);
          ctx.fill();
          ctx.fillStyle = "#fff";
        } else {
          ctx.strokeStyle = isCurrent ? "#94a3b8" : "#cbd5e1";
          ctx.lineWidth = 1;
          drawRoundedRect(cellX, rowBTableY, cellW, cellH, 6);
          ctx.stroke();

          if (isCurrent) {
            ctx.fillStyle = "rgba(100,116,139,0.13)";
            drawRoundedRect(cellX, rowBTableY, cellW, cellH, 6);
            ctx.fill();
          }

          ctx.fillStyle = fg;
        }

        const score = g && Number.isFinite(g.b) ? String(g.b) : "–";
        ctx.fillText(score, cellX + cellW / 2, rowBTableY + 15);
      }
    }
  };

  // ====== WEBSOCKET ======
  const connectWebSocket = () =>
    new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          wsRef.current = ws;
          setIsConnected(true);
          setStatus("Đã kết nối WebSocket");
          setStatusType("success");
          resolve(ws);
        };

        ws.onerror = (e) => {
          setIsConnected(false);
          setStatus("Lỗi WebSocket");
          setStatusType("error");
          reject(e);
        };

        ws.onclose = () => {
          setIsConnected(false);
          setIsStreaming(false);
          setStatus("WebSocket đã ngắt");
          setStatusType("warning");
        };

        ws.onmessage = (evt) => {
          let data = null;
          try {
            data = JSON.parse(evt.data);
          } catch {
            return;
          }
          if (!data) return;

          if (data.type === "started") {
            setStatus("✅ Đang streaming lên Facebook Live…");
            setStatusType("success");
          } else if (data.type === "stopped") {
            setStatus("Stream đã dừng");
            setStatusType("info");
            setIsStreaming(false);
          } else if (data.type === "error") {
            setStatus("Lỗi: " + (data.message || "Không rõ"));
            setStatusType("error");
            setIsStreaming(false);
          }
        };
      } catch (e) {
        reject(e);
      }
    });

  // ====== START STREAM ======
  const startStreaming = async () => {
    if (!streamKey.trim()) {
      setStatus("Vui lòng nhập Stream Key từ Facebook");
      setStatusType("warning");
      return;
    }

    setLoading(true);
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setStatus("Đang kết nối WebSocket…");
        setStatusType("info");
        try {
          await connectWebSocket();
        } catch (err) {
          throw new Error(
            `Không thể kết nối WebSocket tới ${wsUrl}. Vui lòng kiểm tra:\n` +
              `1. Backend server đã chạy chưa?\n` +
              `2. URL WebSocket đúng chưa?\n` +
              `Error: ${err.message}`
          );
        }
      }

      const canvas = canvasRef.current;
      const canvasStream = canvas.captureStream(fps);

      if (camStreamRef.current) {
        camStreamRef.current
          .getAudioTracks()
          .forEach((t) => canvasStream.addTrack(t));
      }

      const waitStarted = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              "❌ Timeout: FFmpeg không khởi động sau 15s.\n" +
                "Vui lòng kiểm tra:\n" +
                "1. Backend server đang chạy?\n" +
                "2. FFmpeg đã cài đặt trên server?\n" +
                "3. Stream Key đúng chưa?\n" +
                "4. Check logs server để biết chi tiết."
            )
          );
        }, 15_000);

        const handler = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg?.type === "started") {
              clearTimeout(timeout);
              wsRef.current?.removeEventListener("message", handler);
              resolve();
            } else if (msg?.type === "error") {
              clearTimeout(timeout);
              wsRef.current?.removeEventListener("message", handler);
              reject(
                new Error(
                  `❌ FFmpeg Error: ${msg.message || "Không rõ"}\n` +
                    `Kiểm tra:\n` +
                    `1. Stream Key đúng chưa?\n` +
                    `2. Facebook Live đã được tạo chưa?\n` +
                    `3. Check server logs để biết chi tiết.`
                )
              );
            }
          } catch {
            // ignore
          }
        };
        wsRef.current?.addEventListener("message", handler);
      });

      setStatus("⏳ Đang khởi động FFmpeg trên server…");
      wsRef.current?.send(JSON.stringify({ type: "start", streamKey }));
      await waitStarted;

      const rec = new MediaRecorder(canvasStream, {
        mimeType: "video/webm;codecs=vp8,opus",
        videoBitsPerSecond,
      });

      rec.ondataavailable = async (e) => {
        if (!e.data || e.data.size === 0) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
          return;

        const buf = new Uint8Array(await e.data.arrayBuffer());
        if (buf.byteLength > 0 && buf.byteLength < 1024 * 1024) {
          wsRef.current.send(
            JSON.stringify({
              type: "stream",
              data: Array.from(buf),
            })
          );
        }
      };

      rec.onerror = (err) => {
        setStatus("Lỗi MediaRecorder: " + err.message);
        setStatusType("error");
        setIsStreaming(false);
      };

      rec.start(200);
      mediaRecorderRef.current = rec;

      setIsStreaming(true);
      setStatus("✅ Đang streaming lên Facebook Live…");
      setStatusType("success");
    } catch (err) {
      setStatus("Lỗi: " + err.message);
      setStatusType("error");
      setIsStreaming(false);
    } finally {
      setLoading(false);
    }
  };

  const stopStreaming = () => {
    try {
      setLoading(true);
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
      setIsStreaming(false);
      setStatus("Đã dừng streaming");
      setStatusType("info");
    } catch (e) {
      setStatus("Lỗi khi dừng: " + e.message);
      setStatusType("error");
    } finally {
      setLoading(false);
    }
  };

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
                Facebook Live với Full Score Overlay
              </Typography>
            </Box>

            {(isStreaming || isConnected) && (
              <Box sx={{ display: "flex", gap: 1 }}>
                {isConnected && !isStreaming && (
                  <Chip
                    icon={<RadioButtonChecked />}
                    label="WS CONNECTED"
                    color="primary"
                    sx={{ fontWeight: "bold", px: 1 }}
                  />
                )}
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
                        gap: 1,
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

                      {/* NEW: Switch camera button */}
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<FlipCameraAndroid />}
                        onClick={toggleCamera}
                        disabled={!canSwitchCamera || isStreaming || loading}
                      >
                        Đổi camera (
                        {facingMode === "environment" ? "sau" : "trước"})
                      </Button>
                    </Box>

                    <Box
                      sx={{
                        position: "relative",
                        width: "100%",
                        paddingBottom: "56.25%",
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
                          background: "#000",
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
                        Stream Preview (Match ID: {matchId || "N/A"})
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        position: "relative",
                        width: "100%",
                        paddingBottom: "56.25%",
                        background: "#000",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <canvas
                        ref={canvasRef}
                        width={videoWidth}
                        height={videoHeight}
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
                        ✅{" "}
                        <strong>Full ScoreOverlay y hệt component gốc</strong>{" "}
                        với meta, pills, serve balls, bảng sets. Tự động cập
                        nhật realtime.
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
                        mb: 3,
                      }}
                    >
                      <Info color="primary" />
                      <Typography variant="h6" fontWeight={600}>
                        Cài đặt Stream
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
                        placeholder="Nhập stream key từ Facebook Live"
                        value={streamKey}
                        onChange={(e) => setStreamKey(e.target.value)}
                        size="medium"
                        disabled={isStreaming}
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
                        onClick={isStreaming ? stopStreaming : startStreaming}
                        disabled={
                          loading || (!isStreaming && !streamKey.trim())
                        }
                        sx={{ py: 1.5, fontWeight: "bold", fontSize: "1rem" }}
                      >
                        {loading
                          ? "Đang xử lý..."
                          : isStreaming
                          ? "Dừng Stream"
                          : "Bắt đầu Stream"}
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

                      {overlayData && (
                        <Alert severity="success" variant="outlined">
                          <Typography variant="body2" fontWeight={600}>
                            📊 Overlay Data
                          </Typography>
                          <Typography
                            variant="caption"
                            component="div"
                            sx={{ mt: 1 }}
                          >
                            Team A:{" "}
                            {overlayData.teams?.A?.name ||
                              overlayData.pairA?.player1?.nickname ||
                              "N/A"}
                            <br />
                            Team B:{" "}
                            {overlayData.teams?.B?.name ||
                              overlayData.pairB?.player1?.nickname ||
                              "N/A"}
                            <br />
                            Score:{" "}
                            {overlayData.gameScores?.[
                              overlayData.currentGame || 0
                            ]?.a || 0}{" "}
                            -{" "}
                            {overlayData.gameScores?.[
                              overlayData.currentGame || 0
                            ]?.b || 0}
                          </Typography>
                        </Alert>
                      )}
                    </Box>
                  </CardContent>
                </Card>

                <Card elevation={2}>
                  <CardContent>
                    <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                        <strong>✅ Full ScoreOverlay</strong>
                        <br />
                        Overlay đầy đủ y hệt ScoreOverlay component: meta
                        header, tournament, phase badge, team pills, serve
                        balls, bảng sets.
                      </Typography>
                    </Alert>

                    <Alert severity="info" variant="outlined">
                      <Typography
                        variant="body2"
                        component="div"
                        sx={{ lineHeight: 1.6 }}
                      >
                        <strong>Hướng dẫn:</strong>
                        <ol style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
                          <li>Cho phép truy cập camera/micro</li>
                          <li>Nhập Facebook Stream Key</li>
                          <li>Nhấn "Bắt đầu Stream"</li>
                          <li>Overlay tự động cập nhật theo API</li>
                        </ol>
                      </Typography>
                    </Alert>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
        </Paper>
      </Container>

      {/* Hidden overlay container for reference */}
      <div
        ref={overlayContainerRef}
        style={{
          position: "fixed",
          top: -9999,
          left: -9999,
          pointerEvents: "none",
        }}
      />
    </Box>
  );
}
