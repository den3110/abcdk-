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

export default function FacebookLiveStreamerPro({
  matchId,
  wsUrl = "ws://localhost:5002/ws/rtmp",
  apiUrl = "http://localhost:5001/api/overlay/match",
  videoWidth = 1280,
  videoHeight = 720,
  fps = 30,
  videoBitsPerSecond = 2500,
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

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const camStreamRef = useRef(null);
  const wsRef = useRef(null);
  const videoEncoderRef = useRef(null);
  const encodingLoopRef = useRef(null);
  const overlayFetchingRef = useRef(false);
  const prevOverlayDataRef = useRef(null);
  const frameCountRef = useRef(0);
  const statsRef = useRef({ sent: 0, dropped: 0, lastLog: Date.now() });
  const isEncodingRef = useRef(false);

  const canSwitchCamera =
    videoDevices.length > 1 ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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

  useEffect(() => {
    (async () => {
      await initCamera("user");
    })();
    return () => {
      stopCurrentStream();

      // Cleanup encoder and WebSocket on unmount
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
          videoEncoderRef.current.close();
        }
      } catch {}

      try {
        wsRef.current?.close();
      } catch {}
    };
  }, [fps, videoHeight, videoWidth]);

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
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    let running = true;
    let lastOverlayDraw = 0;

    const overlayChanged = () => {
      const prev = prevOverlayDataRef.current;
      const curr = overlayData;
      if (!prev && !curr) return false;
      if (!prev || !curr) return true;
      try {
        const prevScore = prev.gameScores?.[prev.currentGame ?? 0];
        const currScore = curr.gameScores?.[curr.currentGame ?? 0];
        return (
          prevScore?.a !== currScore?.a ||
          prevScore?.b !== currScore?.b ||
          prev.currentGame !== curr.currentGame ||
          prev.serve?.side !== curr.serve?.side
        );
      } catch {
        return true;
      }
    };

    const drawFrame = (now) => {
      if (!running) return;

      if (video.readyState >= 2 && video.videoWidth) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (overlayData && now - lastOverlayDraw > 16 && overlayChanged()) {
        drawFullScoreOverlay(ctx, canvas.width, canvas.height, overlayData);
        prevOverlayDataRef.current = JSON.parse(JSON.stringify(overlayData));
        lastOverlayDraw = now;
      }
    };

    const useRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    if (useRVFC) {
      const loop = (now) => {
        drawFrame(now);
        if (!running) return;
        video.requestVideoFrameCallback(loop);
      };
      video.requestVideoFrameCallback(loop);
    } else {
      const loop = (now) => {
        drawFrame(now);
        if (!running) return;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    return () => {
      running = false;
    };
  }, [overlayData]);

  const drawFullScoreOverlay = (ctx, w, h, data) => {
    ctx.save();

    const drawRoundedRect = (x, y, w2, h2, r) => {
      const radius = Math.min(r, w2 / 2, h2 / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w2 - radius, y);
      ctx.quadraticCurveTo(x + w2, y, x + w2, y + radius);
      ctx.lineTo(x + w2, y + h2 - radius);
      ctx.quadraticCurveTo(x + w2, y + h2, x + w2 - radius, y + h2);
      ctx.lineTo(x + radius, y + h2);
      ctx.quadraticCurveTo(x, y + h2, x, y + h2 - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    };

    const teamA = data?.teams?.A?.name || "Team A";
    const teamB = data?.teams?.B?.name || "Team B";
    const currentGame = data?.currentGame ?? 0;
    const gameScores = data?.gameScores || [{ a: 0, b: 0 }];
    const currentScore = gameScores[currentGame] || { a: 0, b: 0 };
    const scoreA = currentScore.a || 0;
    const scoreB = currentScore.b || 0;
    const serveSide = (data?.serve?.side || "A").toUpperCase();
    const tourName = data?.tournament?.name || "";

    const accentA = "#25C2A0";
    const accentB = "#4F46E5";
    const bg = "rgba(11,15,20,0.85)";
    const fg = "#E6EDF3";
    const muted = "#9AA4AF";

    const overlayX = 16,
      overlayY = 16,
      overlayW = 320,
      overlayH = 120;

    ctx.fillStyle = bg;
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 20;
    drawRoundedRect(overlayX, overlayY, overlayW, overlayH, 16);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = muted;
    ctx.font = "500 11px Inter, system-ui";
    ctx.textAlign = "left";
    ctx.fillText(tourName || "—", overlayX + 14, overlayY + 22);

    const rowAY = overlayY + 42;
    ctx.fillStyle = accentA;
    ctx.beginPath();
    ctx.arc(overlayX + 18, rowAY, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.font = "600 16px Inter, system-ui";
    ctx.fillText(teamA, overlayX + 32, rowAY + 5);

    ctx.font = "800 24px Inter, system-ui";
    ctx.textAlign = "right";
    ctx.fillText(String(scoreA), overlayX + overlayW - 14, rowAY + 8);

    const rowBY = rowAY + 38;
    ctx.fillStyle = accentB;
    ctx.beginPath();
    ctx.arc(overlayX + 18, rowBY, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.font = "600 16px Inter, system-ui";
    ctx.textAlign = "left";
    ctx.fillText(teamB, overlayX + 32, rowBY + 5);

    ctx.font = "800 24px Inter, system-ui";
    ctx.textAlign = "right";
    ctx.fillText(String(scoreB), overlayX + overlayW - 14, rowBY + 8);

    ctx.restore();
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

          const buffer = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(buffer);

          try {
            ws.send(buffer);
            statsRef.current.sent++;

            const now = Date.now();
            if (now - statsRef.current.lastLog > 3000) {
              const elapsed = (now - statsRef.current.lastLog) / 1000;
              const fps = (statsRef.current.sent / elapsed).toFixed(1);
              console.log(
                `📊 FPS: ${fps}, Sent: ${statsRef.current.sent}, Dropped: ${statsRef.current.dropped}`
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
        codec: "avc1.42001f", // Baseline Profile, Level 3.1 (supports up to 720p)
        width: videoWidth,
        height: videoHeight,
        bitrate: videoBitsPerSecond * 1000,
        framerate: fps,
        hardwareAcceleration: "prefer-hardware",
        latencyMode: "realtime",
        bitrateMode: "constant",
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
            // Check encoder is still valid
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
            // Stop loop on error
            encodingLoopRef.current = null;
            isEncodingRef.current = false;
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
      // Stop encoding loop first
      isEncodingRef.current = false;

      if (encodingLoopRef.current) {
        cancelAnimationFrame(encodingLoopRef.current);
        encodingLoopRef.current = null;
      }

      // Wait a bit for any pending encodes to finish
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
                        ⚡ <strong>PRO MODE</strong>: WebCodecs H264, GPU
                        encode, FFmpeg copy (no re-encode), &lt;1s latency
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
                          <li>FFmpeg chỉ mux, không re-encode</li>
                          <li>Latency &lt;1 giây (như OBS)</li>
                          <li>CPU thấp hơn 70%</li>
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
