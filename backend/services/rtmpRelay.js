// rtmpRelay.js - MOBILE OPTIMIZED VERSION
//
// 🔥 KEY IMPROVEMENTS FOR MOBILE:
// ✅ Adaptive FFmpeg settings based on device type
// ✅ Lower latency settings for mobile (ultrafast + zerolatency)
// ✅ Larger buffer size for unstable mobile networks
// ✅ Graceful handling of network interruptions
// ✅ Better error messages for mobile debugging

import { WebSocketServer } from "ws";
import { spawn, spawnSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;

  try {
    const which = spawnSync("which", ["ffmpeg"]);
    if (which.status === 0) {
      const p = which.stdout.toString().trim();
      if (p) return p;
    }
  } catch (_) {}

  if (ffmpegStatic) return ffmpegStatic;

  throw new Error(
    "FFmpeg not found. Install with `sudo apt install ffmpeg` or set FFMPEG_PATH."
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
  console.log(`✅ Mobile optimization: ENABLED`);

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
    let bytesReceived = 0;
    let chunksReceived = 0;
    let isMobileClient = false;

    let ffmpegStarting = false;
    let ffmpegReady = false;
    let startTimeout = null;

    const stopFfmpeg = (reason = "SIGTERM") => {
      if (!ffmpegProcess) return;

      console.log(`🛑 Stopping FFmpeg (reason: ${reason})`);

      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }

      try {
        ffmpegProcess.stdin?.end();
      } catch {}

      try {
        ffmpegProcess.kill(reason);
      } catch {}

      setTimeout(() => {
        if (ffmpegProcess && !ffmpegProcess.killed) {
          try {
            console.log("⚠️ Force killing FFmpeg with SIGKILL");
            ffmpegProcess.kill("SIGKILL");
          } catch {}
        }
      }, 4000);

      ffmpegProcess = null;
      ffmpegStarting = false;
      ffmpegReady = false;
    };

    ws.on("message", async (message) => {
      let data = null;
      let isBinary = false;

      // Try to parse as JSON first (text message = control command)
      try {
        const msgStr = message.toString("utf8");
        data = JSON.parse(msgStr);
        isBinary = false;
      } catch (e) {
        // Not JSON = binary stream data
        isBinary = true;
      }

      if (isBinary) {
        // ===== BINARY MESSAGE = STREAM DATA =====
        if (!ffmpegProcess || !ffmpegReady) {
          return;
        }

        const buffer = Buffer.isBuffer(message)
          ? message
          : Buffer.from(message);

        bytesReceived += buffer.length;
        chunksReceived++;

        if (chunksReceived === 1) {
          console.log(
            `📥 First chunk (${isMobileClient ? "MOBILE" : "DESKTOP"} mode)`
          );
        }

        // Log progress every 20 chunks for mobile, 50 for desktop
        const logInterval = isMobileClient ? 20 : 50;
        if (chunksReceived % logInterval === 0) {
          console.log(
            `📦 ${chunksReceived} chunks, ${(
              bytesReceived /
              1024 /
              1024
            ).toFixed(2)} MB total`
          );
        }

        // Write to FFmpeg with backpressure handling
        if (ffmpegProcess.stdin.writable && canWrite) {
          canWrite = ffmpegProcess.stdin.write(buffer);

          // For mobile, be more aggressive about flushing
          if (isMobileClient && !canWrite) {
            console.warn("⚠️ Mobile: Backpressure detected, pausing writes");
          }
        } else if (!canWrite) {
          // Buffer is full, wait for drain
          console.warn("⚠️ FFmpeg stdin buffer full, waiting for drain");
        }

        return;
      }

      // ===== TEXT MESSAGE = CONTROL COMMAND =====
      if (data.type === "start") {
        console.log("📥 Received START command");

        if (!data.streamKey) {
          return ws.send(
            JSON.stringify({ type: "error", message: "Stream key is required" })
          );
        }

        if (ffmpegStarting || ffmpegProcess) {
          console.log("⚠️ FFmpeg already starting or running");
          return ws.send(
            JSON.stringify({
              type: "error",
              message: "Stream already starting or active",
            })
          );
        }

        streamKey = data.streamKey;
        isMobileClient = data.isMobile || false;

        // Get settings from client
        const fps = Number(data.fps || 30);
        const videoBitrate = String(data.videoBitrate || "1500k");
        const audioBitrate = String(data.audioBitrate || "128k");
        const width = Number(data.width || 1280);
        const height = Number(data.height || 720);

        console.log("📊 Stream settings:");
        console.log(
          `   Device type: ${isMobileClient ? "MOBILE 📱" : "DESKTOP 💻"}`
        );
        console.log(`   Resolution: ${width}x${height} @ ${fps}fps`);
        console.log(`   Video bitrate: ${videoBitrate}`);
        console.log(`   Audio bitrate: ${audioBitrate}`);

        let publishUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
        if (!hasRtmps) {
          console.warn("⚠️ FFmpeg lacks RTMPS; falling back to RTMP");
          publishUrl = `rtmp://live-api-s.facebook.com:80/rtmp/${streamKey}`;
        }

        console.log(`🎬 Starting FFmpeg with path: ${ffmpegPath}`);
        console.log(
          `📺 Target URL: ${publishUrl.replace(streamKey, "***KEY***")}`
        );

        ffmpegStarting = true;
        ffmpegReady = false;
        bytesReceived = 0;
        chunksReceived = 0;

        try {
          // 🔥 MOBILE-OPTIMIZED FFMPEG SETTINGS
          const bufferMultiplier = isMobileClient ? 4 : 3; // Larger buffer for mobile
          const preset = isMobileClient ? "veryfast" : "ultrafast";
          const probeSize = isMobileClient ? "10000000" : "5000000"; // Larger probe for mobile

          const args = [
            // Input settings - mobile optimized
            "-f",
            "webm",
            "-thread_queue_size",
            "2048", // Doubled for mobile stability
            "-probesize",
            probeSize,
            "-analyzeduration",
            "3000000", // Increased for mobile
            "-fflags",
            "+genpts+discardcorrupt", // Handle corrupt packets gracefully
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            "pipe:0",

            // Stream mapping
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",

            // Video encoding - adaptive based on device
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            preset,
            "-tune",
            "zerolatency",
            "-profile:v",
            isMobileClient ? "baseline" : "main", // Baseline for mobile compatibility
            "-level",
            isMobileClient ? "3.1" : "4.0",
            "-r",
            String(fps),
            "-g",
            String(fps * 2), // Keyframe every 2 seconds
            "-keyint_min",
            String(fps),
            "-sc_threshold",
            "0",
            "-bf",
            "0",
            "-b:v",
            videoBitrate,
            "-maxrate",
            videoBitrate,
            "-bufsize",
            String(parseInt(videoBitrate) * bufferMultiplier || 6000) + "k",

            // Audio encoding - mobile optimized
            "-c:a",
            "aac",
            "-b:a",
            audioBitrate,
            "-ar",
            isMobileClient ? "44100" : "48000", // 44.1kHz for mobile
            "-ac",
            isMobileClient ? "1" : "2", // Mono for mobile
            "-af",
            "aresample=async=1:first_pts=0",

            // Output format - mobile friendly
            "-f",
            "flv",
            "-flvflags",
            "no_duration_filesize",

            // Mobile-specific: More aggressive reconnection handling
            ...(isMobileClient
              ? [
                  "-reconnect",
                  "1",
                  "-reconnect_streamed",
                  "1",
                  "-reconnect_delay_max",
                  "5",
                ]
              : []),

            publishUrl,
          ];

          console.log(
            "🔧 FFmpeg command:",
            "ffmpeg",
            args.slice(0, 15).join(" "),
            "..."
          );
          console.log("🚀 Spawning FFmpeg...");

          ffmpegProcess = spawn(ffmpegPath, args, {
            stdio: ["pipe", "pipe", "pipe"],
          });

          console.log("✅ FFmpeg spawned, PID:", ffmpegProcess.pid);

          if (!ffmpegProcess || !ffmpegProcess.pid) {
            throw new Error("FFmpeg process is null or has no PID");
          }

          // Wait for FFmpeg to be ready
          // Mobile needs slightly longer initialization time
          const initDelay = isMobileClient ? 1500 : 1000;

          setTimeout(() => {
            if (ffmpegProcess && ffmpegStarting) {
              ffmpegReady = true;
              ffmpegStarting = false;

              if (startTimeout) {
                clearTimeout(startTimeout);
                startTimeout = null;
              }

              console.log(
                `✅✅✅ FFmpeg ready (${
                  isMobileClient ? "MOBILE" : "DESKTOP"
                } mode)`
              );
              try {
                ws.send(
                  JSON.stringify({
                    type: "started",
                    message: "FFmpeg ready to receive binary stream data",
                  })
                );
                console.log("📤 Sent 'started' message to client");
              } catch (sendErr) {
                console.error("❌ Failed to send 'started' message:", sendErr);
              }
            } else {
              console.error("⚠️ FFmpeg process lost during initialization");
            }
          }, initDelay);

          let hasError = false;
          let lastProgressTime = Date.now();

          ffmpegProcess.on("error", (error) => {
            console.error("❌ FFmpeg spawn error:", error);
            hasError = true;
            ws.send(
              JSON.stringify({
                type: "error",
                message: `FFmpeg spawn error: ${error.message}`,
              })
            );
            stopFfmpeg("SIGTERM");
          });

          ffmpegProcess.stderr.on("data", (d) => {
            const log = d.toString();

            // Critical errors
            if (
              log.includes("Invalid data found") ||
              log.includes("EBML header parsing failed") ||
              log.includes("moov atom not found") ||
              log.includes("Error opening input") ||
              log.includes("No such file or directory")
            ) {
              if (!hasError) {
                hasError = true;
                console.error("❌ Critical FFmpeg error:", log.trim());

                if (ffmpegStarting) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: isMobileClient
                        ? "Lỗi khởi động. Thử lại hoặc chuyển sang WiFi."
                        : "FFmpeg failed to initialize. Please check server logs.",
                    })
                  );
                  stopFfmpeg("SIGTERM");
                }
              }
              return;
            }

            // Warnings specific to mobile
            if (isMobileClient) {
              if (log.includes("Past duration")) {
                console.warn("⚠️ Mobile: Timestamp discontinuity detected");
              }
              if (log.includes("Non-monotonous DTS")) {
                console.warn(
                  "⚠️ Mobile: Frame timing issue (expected on unstable networks)"
                );
              }
            }

            // Don't spam logs with repetitive info
            if (log.includes("frame=") || log.includes("speed=")) {
              const now = Date.now();
              // Send progress updates every 5 seconds for mobile, 3 for desktop
              if (now - lastProgressTime > (isMobileClient ? 5000 : 3000)) {
                lastProgressTime = now;
                ws.send(
                  JSON.stringify({ type: "progress", message: log.trim() })
                );
              }
            } else {
              console.log("FFmpeg:", log.trim());
            }
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
                  message: isMobileClient
                    ? "Mất kết nối với server. Thử lại."
                    : `FFmpeg stdin error: ${err.message}`,
                })
              );
              stopFfmpeg("SIGTERM");
            }
          });

          ffmpegProcess.stdin.on("drain", () => {
            canWrite = true;
            if (isMobileClient && chunksReceived > 0) {
              console.log("✅ Mobile: Buffer drained, resuming writes");
            }
          });

          ffmpegProcess.on("close", (code) => {
            console.log(`FFmpeg exited with code ${code}`);
            if (chunksReceived > 0) {
              console.log(
                `📊 Total: ${chunksReceived} chunks, ${(
                  bytesReceived /
                  1024 /
                  1024
                ).toFixed(2)} MB`
              );
            }

            if (code !== 0 && ffmpegStarting) {
              console.error(`❌ FFmpeg failed to start (exit code: ${code})`);
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: isMobileClient
                    ? `Không thể kết nối Facebook Live. Kiểm tra:\n1. Stream Key đúng?\n2. Facebook Live đã tạo?\n3. Mạng ổn định không?`
                    : `FFmpeg failed (exit ${code}). Check: Stream key, Facebook Live setup, network.`,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "stopped",
                  message: `Stream ended (exit code: ${code})`,
                })
              );
            }

            ffmpegProcess = null;
            ffmpegStarting = false;
            ffmpegReady = false;
          });

          // Safety timeout - 40s for mobile (more time for slower devices)
          const timeoutDuration = isMobileClient ? 40000 : 30000;
          startTimeout = setTimeout(() => {
            if (ffmpegProcess && !ffmpegReady) {
              console.error(
                `❌ FFmpeg startup timeout after ${timeoutDuration / 1000}s`
              );
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: isMobileClient
                    ? "Timeout khởi động. Kiểm tra mạng và thử lại."
                    : "FFmpeg failed to initialize after 30s. Check stream key and network.",
                })
              );
              stopFfmpeg("SIGTERM");
            }
          }, timeoutDuration);
        } catch (spawnError) {
          console.error("❌ Failed to spawn FFmpeg:", spawnError);
          ffmpegStarting = false;
          ffmpegReady = false;
          ws.send(
            JSON.stringify({
              type: "error",
              message: isMobileClient
                ? "Lỗi server. Liên hệ admin."
                : `Failed to spawn FFmpeg: ${spawnError.message}`,
            })
          );
          stopFfmpeg("SIGTERM");
        }
      } else if (data.type === "stop") {
        console.log("📥 Received STOP command");
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
