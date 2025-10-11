// src/screens/LiveStudio/BrowserStudio.jsx
import React, { useEffect, useRef, useState } from "react";
import * as htmlToImage from "html-to-image";
import ScoreOverlay from "../PickleBall/ScoreOverlay";

export default function BrowserStudio({
  matchId,
  fbServer,
  fbKey,
  wsUrl,
  width = 1280,
  height = 720,
  overlayFps = 8,
  outFps = 30,
}) {
  const camVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayNodeRef = useRef(null);
  const wsRef = useRef(null);
  const recRef = useRef(null);

  const [status, setStatus] = useState("initializing");
  const [err, setErr] = useState("");
  const [stats, setStats] = useState({ chunks: 0, bytes: 0, wsBuffer: 0 });

  const startedRef = useRef(false);

  useEffect(() => {
    let stream;
    let raf;
    let overlayTimer;
    let overlayImg = new Image();
    let lastUrl = "";
    let alive = true;
    let frameCount = 0;

    async function start() {
      if (startedRef.current) return;
      startedRef.current = true;

      try {
        // ==================== 1. CAMERA + MIC ====================
        setStatus("requesting camera/mic");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: outFps },
            facingMode: "environment",
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 48000,
          },
        });

        const v = camVideoRef.current;
        if (!v) throw new Error("Video element not found");

        v.srcObject = stream;

        // Đợi video metadata
        if (v.readyState < 1) {
          await new Promise((resolve) => {
            v.addEventListener("loadedmetadata", resolve, { once: true });
          });
        }

        // Đợi video có frame thật sự
        await new Promise((resolve) => {
          const check = setInterval(() => {
            if (v.readyState >= 2 && v.videoWidth > 0) {
              clearInterval(check);
              resolve();
            }
          }, 50);
          setTimeout(() => {
            clearInterval(check);
            resolve();
          }, 5000);
        });

        // Play video
        if (v.paused) {
          await v.play().catch(console.error);
        }

        console.log("✅ Camera ready:", {
          readyState: v.readyState,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
        });

        // ==================== 2. CANVAS SETUP ====================
        const cv = canvasRef.current;
        const ctx = cv.getContext("2d", { alpha: false });

        // Update overlay
        const updateOverlay = async () => {
          const node = overlayNodeRef.current;
          if (!node) return;
          try {
            const dataUrl = await htmlToImage.toPng(node, {
              width,
              height,
              pixelRatio: 1,
              backgroundColor: "transparent",
              cacheBust: true,
            });
            if (dataUrl && dataUrl !== lastUrl) {
              const img = new Image();
              img.onload = () => {
                overlayImg = img;
              };
              img.src = dataUrl;
              lastUrl = dataUrl;
            }
          } catch (e) {
            console.warn("Overlay update failed:", e);
          }
        };

        const overlayInterval =
          overlayFps > 0 ? Math.round(1000 / overlayFps) : 200;
        await updateOverlay();
        overlayTimer = setInterval(updateOverlay, overlayInterval);

        // Draw loop
        const draw = () => {
          if (!alive) return;
          const vv = camVideoRef.current;

          // Vẽ video
          if (vv && vv.readyState >= 2) {
            ctx.drawImage(vv, 0, 0, width, height);
            frameCount++;
          }

          // Vẽ overlay
          if (overlayImg && overlayImg.complete && overlayImg.width > 0) {
            ctx.drawImage(overlayImg, 0, 0, width, height);
          }

          raf = requestAnimationFrame(draw);
        };
        draw();

        // Đợi canvas vẽ được ít nhất 30 frames (1 giây)
        setStatus("warming up canvas");
        await new Promise((resolve) => {
          const checkFrames = setInterval(() => {
            if (frameCount >= 30) {
              clearInterval(checkFrames);
              resolve();
            }
          }, 100);
          setTimeout(() => {
            clearInterval(checkFrames);
            resolve();
          }, 3000);
        });

        console.log(`✅ Canvas warmed up with ${frameCount} frames`);

        // ==================== 3. WEBSOCKET ====================
        setStatus("connecting to relay");
        const loc = window.location;
        const autoWs = `${loc.protocol === "https:" ? "wss" : "ws"}://${
          loc.host
        }/ws/rtmp`;
        const wsEndpoint = wsUrl || autoWs;

        const ws = new WebSocket(wsEndpoint);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        // Outbox queue
        const outbox = [];
        let pumping = false;

        const pump = () => {
          if (pumping) return;
          pumping = true;

          (function loop() {
            if (!alive || ws.readyState !== 1) {
              pumping = false;
              return;
            }

            if (outbox.length === 0) {
              pumping = false;
              return;
            }

            // Đợi nếu buffer quá đầy
            if (ws.bufferedAmount > 1 * 1024 * 1024) {
              setTimeout(loop, 10);
              return;
            }

            const buf = outbox.shift();
            try {
              ws.send(buf);
            } catch (e) {
              console.error("WS send error:", e);
            }

            setImmediate ? setImmediate(loop) : setTimeout(loop, 0);
          })();
        };

        ws.onopen = () => {
          const cleanServer = (fbServer || "").trim().replace(/\s+/g, "");
          const cleanKey = (fbKey || "").trim().replace(/\s+/g, "");

          if (!cleanServer || !cleanKey) {
            setErr("Missing server URL or stream key");
            ws.close();
            return;
          }

          if (/\s/.test(cleanServer) || /\s/.test(cleanKey)) {
            setErr("Stream URL or key contains whitespace");
            ws.close();
            return;
          }

          console.log("🔑 Stream key length:", cleanKey.length);

          ws.send(
            JSON.stringify({
              server_url: cleanServer,
              stream_key: cleanKey,
              videoBitrate: "3500k",
              audioBitrate: "128k",
              fps: outFps,
            })
          );

          setStatus("waiting for relay ready");
        };

        ws.onmessage = async (ev) => {
          if (!alive) return;

          try {
            const msg = JSON.parse(ev.data);

            if (msg?.type === "ready") {
              console.log("🎬 Relay ready, starting MediaRecorder");

              // ==================== 4. MEDIARECORDER ====================
              const outputStream = cv.captureStream(outFps);
              const audioTrack = stream.getAudioTracks()[0];
              if (audioTrack) {
                outputStream.addTrack(audioTrack);
              }

              console.log(
                "🎥 Output tracks:",
                outputStream.getTracks().map((t) => ({
                  kind: t.kind,
                  label: t.label,
                  enabled: t.enabled,
                  readyState: t.readyState,
                }))
              );

              // Thử H.264 trước (hardware encode, keyframe đáng tin cậy hơn)
              let mime = "video/webm;codecs=h264,opus";
              if (!MediaRecorder.isTypeSupported(mime)) {
                // Fallback VP8
                mime = "video/webm;codecs=vp8,opus";
                if (!MediaRecorder.isTypeSupported(mime)) {
                  setErr("Browser doesn't support H264/VP8 recording");
                  ws.close();
                  return;
                }
              }

              console.log("🎬 Using codec:", mime);

              const mr = new MediaRecorder(outputStream, {
                mimeType: mime,
                videoBitsPerSecond: 3_500_000,
                audioBitsPerSecond: 128_000,
              });
              recRef.current = mr;

              let chunkCount = 0;
              let totalBytes = 0;
              let firstChunkTime = null;

              mr.ondataavailable = async (e) => {
                if (!e.data || e.data.size === 0) {
                  console.warn("⚠️ Empty chunk received");
                  return;
                }

                chunkCount++;
                totalBytes += e.data.size;

                if (!firstChunkTime) {
                  firstChunkTime = Date.now();
                  console.log("✅ First chunk received:", e.data.size, "bytes");
                }

                if (ws.readyState === 1) {
                  const ab = await e.data.arrayBuffer();
                  outbox.push(ab);
                  pump();

                  // Update stats every 10 chunks
                  if (chunkCount % 10 === 0) {
                    setStats({
                      chunks: chunkCount,
                      bytes: totalBytes,
                      wsBuffer: ws.bufferedAmount,
                    });
                    console.log(
                      `📦 Chunk #${chunkCount}: ${(
                        totalBytes /
                        1024 /
                        1024
                      ).toFixed(2)}MB, WS buffer: ${(
                        ws.bufferedAmount / 1024
                      ).toFixed(0)}KB`
                    );
                  }
                } else {
                  console.warn("⚠️ WS not open, dropping chunk");
                }
              };

              mr.onstart = () => {
                console.log("✅ MediaRecorder started");
                setStatus("🔴 LIVE → Facebook");
              };

              mr.onerror = (e) => {
                const errMsg = e.error?.message || String(e);
                console.error("❌ MediaRecorder error:", errMsg);
                setErr("MediaRecorder: " + errMsg);
              };

              mr.onstop = () => {
                console.log("🛑 MediaRecorder stopped");
              };

              // Start với timeslice nhỏ để có keyframe sớm
              mr.start(100);
              console.log("🎬 MediaRecorder.start(100) called");

              // TRICK: Request keyframe sau 500ms
              setTimeout(() => {
                if (mr.state === "recording") {
                  try {
                    // Force keyframe bằng cách requestFrame (nếu browser hỗ trợ)
                    if (typeof mr.requestData === "function") {
                      mr.requestData();
                      console.log("🔑 Requested keyframe");
                    }
                  } catch (e) {
                    console.warn("Cannot request keyframe:", e);
                  }
                }
              }, 500);
            } else if (msg?.type === "ffmpeg_error") {
              console.error("❌ FFmpeg error:", msg.message);
              setErr("FFmpeg: " + msg.message);
            } else if (msg?.type === "ffmpeg_log") {
              const line = msg.line || "";

              // Log important info
              if (line.includes("frame=") || line.includes("fps=")) {
                console.log("📊", line.trim());
              }

              // Log errors
              if (
                line.toLowerCase().includes("error") ||
                line.includes("failed") ||
                line.includes("Discarding")
              ) {
                console.warn("⚠️ FFmpeg:", line.trim());
              }
            }
          } catch (e) {
            console.error("WS message parse error:", e);
          }
        };

        ws.onerror = (e) => {
          console.error("❌ WebSocket error:", e);
          setErr("WebSocket connection error");
        };

        ws.onclose = (e) => {
          console.log("🔌 WebSocket closed:", e.code, e.reason);
          setStatus((s) => (s.includes("LIVE") ? "stopped" : "disconnected"));
        };
      } catch (e) {
        console.error("❌ Startup error:", e);
        setErr(e.message || String(e));
        setStatus("error");
        startedRef.current = false;
      }
    }

    start();

    // ==================== CLEANUP ====================
    return () => {
      console.log("🧹 Cleaning up BrowserStudio");
      alive = false;

      cancelAnimationFrame(raf);
      clearInterval(overlayTimer);

      try {
        if (recRef.current && recRef.current.state !== "inactive") {
          recRef.current.stop();
        }
      } catch (e) {
        console.warn("Cleanup recorder error:", e);
      }

      try {
        wsRef.current?.close();
      } catch (e) {
        console.warn("Cleanup WS error:", e);
      }

      try {
        stream?.getTracks()?.forEach((t) => t.stop());
      } catch (e) {
        console.warn("Cleanup tracks error:", e);
      }

      startedRef.current = false;
    };
  }, [matchId, fbServer, fbKey, wsUrl, width, height, overlayFps, outFps]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Status:{" "}
          <span
            style={{ color: status.includes("LIVE") ? "#22c55e" : "#64748b" }}
          >
            {status}
          </span>
        </div>

        {err && (
          <div
            style={{
              padding: 12,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              color: "#dc2626",
              marginBottom: 8,
            }}
          >
            ⚠️ {err}
          </div>
        )}

        {stats.chunks > 0 && (
          <div
            style={{ fontSize: 13, color: "#64748b", fontFamily: "monospace" }}
          >
            📦 Chunks: {stats.chunks} | 💾 Sent:{" "}
            {(stats.bytes / 1024 / 1024).toFixed(2)}MB | 📡 Buffer:{" "}
            {(stats.wsBuffer / 1024).toFixed(0)}KB
          </div>
        )}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "auto auto", gap: 16 }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 4,
              color: "#64748b",
            }}
          >
            Camera Preview
          </div>
          <video
            ref={camVideoRef}
            muted
            playsInline
            style={{
              width: width / 2,
              background: "#000",
              borderRadius: 8,
              display: "block",
            }}
          />
        </div>

        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 4,
              color: "#64748b",
            }}
          >
            Output (with overlay)
          </div>
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{
              width: width / 2,
              background: "#000",
              borderRadius: 8,
              display: "block",
            }}
          />
        </div>
      </div>

      {/* Off-screen overlay renderer */}
      <div
        style={{
          position: "absolute",
          left: -99999,
          top: -99999,
          width,
          height,
          pointerEvents: "none",
          display: "none"
        }}
      >
        <ScoreOverlay ref={overlayNodeRef} matchIdProp={matchId} disableLogo />
      </div>
    </div>
  );
}
