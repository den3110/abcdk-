// rtmpRelayPro.js - PROFESSIONAL GRADE (WebCodecs support)
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

export async function attachRtmpRelayPro(server, options = {}) {
  const wss = new WebSocketServer({
    server,
    path: options.path || "/ws/rtmp",
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024, // 50MB for raw frames
  });

  console.log(`✅ PRO RTMP Relay WebSocket: ${options.path || "/ws/rtmp"}`);

  // Keepalive
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);
  wss.on("close", () => clearInterval(interval));

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    ws._socket?.setNoDelay?.(true);

    console.log(`📡 WebCodecs client: ${req.socket.remoteAddress}`);

    let ffmpeg = null;
    let config = null;
    let stats = { videoFrames: 0, audioFrames: 0, startTime: 0 };

    const cleanup = () => {
      if (ffmpeg) {
        try {
          ffmpeg.stdin?.end();
        } catch {}
        try {
          ffmpeg.kill("SIGTERM");
        } catch {}
        setTimeout(() => {
          try {
            ffmpeg?.kill("SIGKILL");
          } catch {}
        }, 1500);
        ffmpeg = null;
      }
      config = null;
    };

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        // Binary = H264 NAL units from WebCodecs
        if (!ffmpeg || !config) return;

        try {
          if (ffmpeg.stdin?.writable) {
            ffmpeg.stdin.write(data);
            stats.videoFrames++;
          }
        } catch (err) {
          console.error("❌ Write error:", err.message);
        }
        return;
      }

      // Text = control messages
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (!msg?.type) return;

      if (msg.type === "start") {
        if (ffmpeg) {
          ws.send(
            JSON.stringify({ type: "error", message: "Already streaming" })
          );
          return;
        }

        config = {
          streamKey: msg.streamKey,
          width: msg.width || 1280,
          height: msg.height || 720,
          fps: msg.fps || 30,
          videoBitrate: msg.videoBitrate || "2500k",
          audioBitrate: msg.audioBitrate || "192k",
        };

        if (!config.streamKey) {
          ws.send(
            JSON.stringify({ type: "error", message: "streamKey required" })
          );
          return;
        }

        const { streamKey, width, height, fps, videoBitrate, audioBitrate } =
          config;
        const rtmpUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;

        console.log(
          `🎬 Starting PRO stream: ${width}x${height}@${fps}fps, ${videoBitrate}`
        );

        // FFmpeg args: H264 annex-b input → FLV output (NO RE-ENCODING!)
        // Simplified: NO AUDIO for now (testing)
        const args = [
          "-hide_banner",
          "-loglevel",
          "info", // More verbose for debugging

          // Video input: raw H264 stream
          "-f",
          "h264",
          "-r",
          String(fps),
          "-i",
          "pipe:0",

          // Video: COPY (no re-encode!)
          "-c:v",
          "copy",

          // NO AUDIO (for testing)
          "-an",

          // Output
          "-f",
          "flv",
          "-flvflags",
          "no_duration_filesize",
          rtmpUrl,
        ];

        try {
          ffmpeg = spawn(ffmpegStatic || "ffmpeg", args, {
            stdio: ["pipe", "pipe", "pipe"],
          });

          if (!ffmpeg.pid) throw new Error("FFmpeg spawn failed");

          stats = { videoFrames: 0, audioFrames: 0, startTime: Date.now() };

          ffmpeg.stdin.on("error", (e) => {
            if (e.code !== "EPIPE") {
              console.error("❌ stdin error:", e.message);
            }
          });

          ffmpeg.stderr.on("data", (d) => {
            const log = d.toString();
            if (log.includes("error") || log.includes("Error")) {
              console.error("❌ FFmpeg:", log.trim());
            }
            // Send progress to client
            if (log.includes("frame=") || log.includes("speed=")) {
              try {
                ws.send(
                  JSON.stringify({ type: "progress", message: log.trim() })
                );
              } catch {}
            }
          });

          ffmpeg.on("close", (code) => {
            const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
            const fps = (stats.videoFrames / elapsed).toFixed(1);
            console.log(
              `🛑 FFmpeg exit ${code}. Frames: ${stats.videoFrames}, Avg FPS: ${fps}, Duration: ${elapsed}s`
            );
            cleanup();
            try {
              ws.send(JSON.stringify({ type: "stopped", code }));
            } catch {}
          });

          // Send success immediately
          ws.send(
            JSON.stringify({
              type: "started",
              message: "WebCodecs PRO mode: H264 copy, <1s latency",
            })
          );

          console.log("✅ FFmpeg ready, waiting for H264 frames...");

          // Check if data is being received after 5 seconds
          setTimeout(() => {
            if (stats.videoFrames === 0) {
              console.warn("⚠️ WARNING: No frames received after 5 seconds!");
              try {
                ws.send(
                  JSON.stringify({
                    type: "warning",
                    message: "No frames received. Check encoder output.",
                  })
                );
              } catch {}
            } else {
              console.log(
                `✅ Receiving frames OK: ${stats.videoFrames} frames in 5s`
              );
            }
          }, 5000);
        } catch (err) {
          console.error("❌ Spawn error:", err);
          ws.send(JSON.stringify({ type: "error", message: err.message }));
          cleanup();
        }
      } else if (msg.type === "stop") {
        cleanup();
        ws.send(
          JSON.stringify({ type: "stopped", message: "Stopped by user" })
        );
      }
    });

    ws.on("close", () => {
      console.log("📴 Client disconnected");
      cleanup();
    });
    ws.on("error", (err) => {
      console.error("WS error:", err.message);
      cleanup();
    });
  });

  return wss;
}
