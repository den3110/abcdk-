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
  const [videoSize, setVideoSize] = useState({ w: videoWidth, h: videoHeight });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null); // Canvas riêng cho overlay
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

  // Khởi tạo overlay canvas off-screen
  useEffect(() => {
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = videoWidth;
    overlayCanvas.height = videoHeight;
    overlayCanvasRef.current = overlayCanvas;
  }, [videoWidth, videoHeight]);

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

  // Vẽ overlay vào canvas riêng chỉ khi data thay đổi
  useEffect(() => {
    if (!overlayData || !overlayCanvasRef.current) return;

    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas.getContext("2d", { alpha: true });

    // Clear canvas với alpha để transparent
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Vẽ overlay
    drawFullScoreOverlay(
      ctx,
      overlayCanvas.width,
      overlayCanvas.height,
      overlayData
    );

    console.log("🎨 Overlay updated:", overlayData.currentGame);
  }, [overlayData]);

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

  // Main render loop: vẽ video + composite overlay
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

      // Vẽ video
      if (video.readyState >= 2 && video.videoWidth) {
        drawVideoCover(ctx, video, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Composite overlay lên trên (rất nhanh vì chỉ là drawImage)
      if (overlayCanvasRef.current) {
        ctx.drawImage(
          overlayCanvasRef.current,
          0,
          0,
          canvas.width,
          canvas.height
        );
      }
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
      const loop = () => {
        drawFrame();
        if (!running) return;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    return () => {
      running = false;
    };
  }, []);

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
                          transform:
                            facingMode === "user" ? "scaleX(-1)" : "none",
                          transformOrigin: "center",
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
                          <li>Overlay realtime, zero impact</li>
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
