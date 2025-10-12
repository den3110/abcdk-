// rtmpRelay.ubuntu.js
import { WebSocketServer } from "ws";
import { spawn, spawnSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";

function resolveFfmpegPath() {
  // 1) Env var
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;

  // 2) System ffmpeg on Ubuntu
  try {
    const which = spawnSync("which", ["ffmpeg"]);
    if (which.status === 0) {
      const p = which.stdout.toString().trim();
      if (p) return p;
    }
  } catch (_) {}

  // 3) Fallback to ffmpeg-static (may miss some protocols on Linux)
  if (ffmpegStatic) return ffmpegStatic;

  throw new Error(
    "FFmpeg not found. Please install with `sudo apt install ffmpeg` or set FFMPEG_PATH."
  );
}

async function ffmpegSupportsProtocol(bin, proto = "rtmps") {
  return await new Promise((resolve) => {
    try {
      const p = spawn(bin, ["-hide_banner", "-protocols"]);
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("close", () => {
        const text = (out + "\n" + err).toLowerCase();
        resolve(text.includes(` ${proto}\n`) || text.includes(`\n${proto}\n`));
      });
      p.on("error", () => resolve(false));
    } catch (_) {
      resolve(false);
    }
  });
}

export async function attachRtmpRelay(server, options = {}) {
  const wss = new WebSocketServer({
    server,
    path: options.path || "/ws/rtmp",
  });

  const ffmpegPath = resolveFfmpegPath();
  const hasRtmps = await ffmpegSupportsProtocol(ffmpegPath, "rtmps");

  console.log(
    `✅ RTMP Relay WebSocket listening on ${options.path || "/ws/rtmp"}`
  );
  console.log(`✅ FFmpeg path: ${ffmpegPath}`);
  console.log(`✅ RTMPS supported: ${hasRtmps ? "yes" : "no"}`);

  // Optional: heartbeat to close dead sockets
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {}
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));

    console.log(`📡 New WebSocket connection from ${req.socket.remoteAddress}`);

    let ffmpegProcess = null;
    let streamKey = null;
    let canWrite = true;

    const stopFfmpeg = (reason = "SIGTERM") => {
      if (!ffmpegProcess) return;
      try {
        ffmpegProcess.stdin?.end();
      } catch {}
      try {
        ffmpegProcess.kill(reason);
      } catch {}
      // Double-kill if hung
      setTimeout(() => {
        if (ffmpegProcess && !ffmpegProcess.killed) {
          try {
            ffmpegProcess.kill("SIGKILL");
          } catch {}
        }
      }, 4000);
      ffmpegProcess = null;
    };

    ws.on("message", async (message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch (e) {
        console.error("❌ JSON parse error:", e);
        return ws.send(
          JSON.stringify({ type: "error", message: "Invalid JSON" })
        );
      }

      if (data.type === "start") {
        console.log("📥 Received START command");
        if (!data.streamKey) {
          ws.send(
            JSON.stringify({ type: "error", message: "Stream key is required" })
          );
          return;
        }

        streamKey = data.streamKey;
        const fps = Number(data.fps || 30);
        const videoBitrate = String(data.videoBitrate || "4000k");
        const audioBitrate = String(data.audioBitrate || "128k");

        // Prefer RTMPS for Facebook
        let publishUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
        if (!hasRtmps) {
          console.warn(
            "⚠️ FFmpeg lacks RTMPS; falling back to RTMP (insecure). Install system ffmpeg on Ubuntu."
          );
          publishUrl = `rtmp://live-api-s.facebook.com:80/rtmp/${streamKey}`;
        }

        console.log(`🎬 Starting FFmpeg with path: ${ffmpegPath}`);
        console.log(`📺 Target URL: ${publishUrl}`);

        try {
          // Important flags for real-time piping from browser WebM (VP8/Opus)
          const args = [
            // Read from stdin as WebM
            "-f",
            "webm",
            "-thread_queue_size",
            "512",
            "-i",
            "pipe:0",

            // Generate timestamps if missing & low-latency tuning
            "-fflags",
            "+genpts",
            "-use_wallclock_as_timestamps",
            "1",
            "-flush_packets",
            "1",

            // Map flexibly (handle missing audio/video gracefully)
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",

            // Video
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-r",
            String(fps),
            "-g",
            String(fps * 2),
            "-keyint_min",
            String(fps * 2),
            "-x264-params",
            `scenecut=0:open_gop=0`,
            "-maxrate",
            videoBitrate,
            "-bufsize",
            String(parseInt(videoBitrate) * 2 || 8000) + "k",

            // Audio
            "-c:a",
            "aac",
            "-b:a",
            audioBitrate,
            "-ar",
            "44100",
            "-ac",
            "2",

            // Facebook prefers FLV container
            "-f",
            "flv",
            // "-rtmp_live", "live", // optional, some targets need this
            publishUrl,
          ];

          ffmpegProcess = spawn(ffmpegPath, args, {
            stdio: ["pipe", "pipe", "pipe"],
          });
          console.log("✅ FFmpeg process spawned, PID:", ffmpegProcess.pid);

          ffmpegProcess.stderr.on("data", (d) => {
            const log = d.toString();
            // Keep console concise but forward key lines to client
            if (
              log.includes("frame=") ||
              log.toLowerCase().includes("error") ||
              log.toLowerCase().includes("speed=")
            ) {
              ws.send(
                JSON.stringify({ type: "progress", message: log.trim() })
              );
            }
            console.log("FFmpeg:", log.trim());
          });

          ffmpegProcess.stdout.on("data", (d) => {
            const s = d.toString().trim();
            if (s) console.log("FFmpeg stdout:", s);
          });

          ffmpegProcess.stdin.on("error", (err) => {
            if (err && err.code !== "EPIPE") {
              console.error("❌ FFmpeg stdin error:", err);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `FFmpeg stdin error: ${err.message}`,
                })
              );
            }
          });

          ffmpegProcess.stdin.on("drain", () => {
            canWrite = true;
          });

          ffmpegProcess.on("error", (error) => {
            console.error("❌ FFmpeg spawn error:", error);
            ws.send(
              JSON.stringify({
                type: "error",
                message: `FFmpeg error: ${error.message}`,
              })
            );
            ffmpegProcess = null;
          });

          ffmpegProcess.on("close", (code) => {
            console.log(`FFmpeg exited with code ${code}`);
            ws.send(
              JSON.stringify({
                type: "stopped",
                message: `Stream ended (code: ${code})`,
              })
            );
            ffmpegProcess = null;
          });

          ws.send(
            JSON.stringify({
              type: "started",
              message: "Streaming to Facebook started",
            })
          );
          console.log(
            `🎥 FFmpeg started successfully, sent 'started' to client`
          );
        } catch (spawnError) {
          console.error("❌ Failed to spawn FFmpeg:", spawnError);
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed to spawn FFmpeg: ${spawnError.message}`,
            })
          );
          stopFfmpeg();
        }
      } else if (data.type === "stream") {
        if (!ffmpegProcess) {
          ws.send(
            JSON.stringify({ type: "error", message: "FFmpeg not started" })
          );
          return;
        }

        // Backpressure-aware write to stdin
        const buffer = Buffer.from(data.data);
        if (ffmpegProcess.stdin.writable && canWrite) {
          canWrite = ffmpegProcess.stdin.write(buffer);
          if (!canWrite) {
            // If overwhelmed, drop next chunks until 'drain' to keep realtime
            // (better than buffering indefinitely and adding latency)
          }
        } else {
          // Drop if not writable; keep realtime
        }
      } else if (data.type === "stop") {
        stopFfmpeg("SIGTERM");
        ws.send(
          JSON.stringify({ type: "stopped", message: "Stream stopped by user" })
        );
      }
    });

    ws.on("close", () => {
      console.log("📴 WebSocket disconnected");
      stopFfmpeg("SIGTERM");
    });

    ws.on("error", (error) => {
      console.error("❌ WebSocket error:", error);
      stopFfmpeg("SIGTERM");
    });
  });

  return wss;
}
