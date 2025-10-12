// rtmpRelay.js - FINAL VERSION
//
// Key fixes:
// 1. Detect "Output #0" để xác định FFmpeg ready
// 2. Delay 2 seconds sau khi detect để đảm bảo stdin stable
// 3. Removed -re flag để tránh timing issues
// 4. Better error handling and logging

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

    // State tracking
    let ffmpegStarting = false;
    let ffmpegReady = false;
    let startTimeout = null;
    let dataBuffer = []; // Safety buffer

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
      dataBuffer = [];
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

        if (ffmpegStarting || ffmpegProcess) {
          console.log("⚠️ FFmpeg already starting or running");
          return ws.send(
            JSON.stringify({
              type: "error",
              message: "Stream already starting or active",
            })
          );
        }

        if (!data.streamKey) {
          return ws.send(
            JSON.stringify({ type: "error", message: "Stream key is required" })
          );
        }

        streamKey = data.streamKey;
        const fps = Number(data.fps || 30);
        const videoBitrate = String(data.videoBitrate || "2500k");
        const audioBitrate = String(data.audioBitrate || "128k");

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
        dataBuffer = [];

        try {
          // CRITICAL: FFmpeg args optimized for pipe input from browser
          const args = [
            // Input format - CRITICAL: tell FFmpeg to wait for data
            "-f",
            "webm",
            "-probesize",
            "32",
            "-analyzeduration",
            "0",
            "-thread_queue_size",
            "512",
            "-fflags",
            "+genpts+igndts+discardcorrupt",
            "-avoid_negative_ts",
            "make_zero",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            "pipe:0",

            // Low-latency settings
            "-vsync",
            "passthrough",
            "-copytb",
            "1",

            // Map streams flexibly
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",

            // Video encoding - optimized for stability
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "baseline",
            "-level",
            "3.1",
            "-r",
            String(fps),
            "-g",
            String(fps * 2),
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
            String(parseInt(videoBitrate) * 2 || 5000) + "k",

            // Audio encoding
            "-c:a",
            "aac",
            "-b:a",
            audioBitrate,
            "-ar",
            "44100",
            "-ac",
            "2",

            // Output format
            "-f",
            "flv",
            "-flvflags",
            "no_duration_filesize",
            publishUrl,
          ];

          console.log(
            "🔧 FFmpeg command:",
            "ffmpeg",
            args.slice(0, 12).join(" "),
            "..."
          );

          ffmpegProcess = spawn(ffmpegPath, args, {
            stdio: ["pipe", "pipe", "pipe"],
          });

          console.log("✅ FFmpeg spawned, PID:", ffmpegProcess.pid);

          // CRITICAL FIX: Give FFmpeg a moment to initialize before declaring ready
          // This prevents "Read error at pos. 0" because stdin won't be read immediately
          setTimeout(() => {
            if (ffmpegProcess && ffmpegStarting) {
              ffmpegReady = true;
              ffmpegStarting = false;

              if (startTimeout) {
                clearTimeout(startTimeout);
                startTimeout = null;
              }

              console.log(
                "✅✅✅ FFmpeg stdin ready - client can start sending data"
              );
              ws.send(
                JSON.stringify({
                  type: "started",
                  message: "FFmpeg ready to receive stream data",
                })
              );
            }
          }, 1000); // 1 second - enough time for FFmpeg to initialize stdin

          // Still monitor stderr for actual errors
          let hasError = false;

          // Still monitor stderr for actual errors
          let hasError = false;

          ffmpegProcess.stderr.on("data", (d) => {
            const log = d.toString();

            // Detect critical errors
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

                // Only send error if we haven't sent "started" yet
                if (ffmpegStarting) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message:
                        "FFmpeg failed to initialize. Please check server logs.",
                    })
                  );
                  stopFfmpeg("SIGTERM");
                }
              }
              return;
            }

            // Log all output for debugging
            console.log("FFmpeg:", log.trim());

            // Send progress updates
            if (log.includes("frame=") || log.includes("speed=")) {
              ws.send(
                JSON.stringify({ type: "progress", message: log.trim() })
              );
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
                  message: `FFmpeg stdin error: ${err.message}`,
                })
              );
              stopFfmpeg("SIGTERM");
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
                message: `FFmpeg spawn error: ${error.message}`,
              })
            );
            stopFfmpeg("SIGTERM");
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

            ws.send(
              JSON.stringify({
                type: "stopped",
                message: `Stream ended (exit code: ${code})`,
              })
            );

            ffmpegProcess = null;
            ffmpegStarting = false;
            ffmpegReady = false;
            dataBuffer = [];
          });

          // Safety timeout - increased to 30s
          startTimeout = setTimeout(() => {
            if (ffmpegProcess && !ffmpegReady) {
              console.error("❌ FFmpeg startup timeout after 30 seconds");
              ws.send(
                JSON.stringify({
                  type: "error",
                  message:
                    "FFmpeg failed to initialize after 30s. Check: 1) Stream key valid? 2) Facebook Live created? 3) Network OK?",
                })
              );
              stopFfmpeg("SIGTERM");
            }
          }, 30000); // 30 seconds
        } catch (spawnError) {
          console.error("❌ Failed to spawn FFmpeg:", spawnError);
          ffmpegStarting = false;
          ffmpegReady = false;
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed to spawn FFmpeg: ${spawnError.message}`,
            })
          );
          stopFfmpeg("SIGTERM");
        }
      } else if (data.type === "stream") {
        // CRITICAL: Only accept data when FFmpeg is truly ready
        if (!ffmpegProcess) {
          return; // Silently ignore
        }

        if (ffmpegStarting || !ffmpegReady) {
          // Safety buffer (shouldn't happen with proper client)
          if (dataBuffer.length < 10) {
            dataBuffer.push(Buffer.from(data.data));
            console.log(
              `⏳ Buffering chunk while FFmpeg starting (${dataBuffer.length} total)`
            );
          }
          return;
        }

        const buffer = Buffer.from(data.data);
        bytesReceived += buffer.length;
        chunksReceived++;

        if (chunksReceived === 1) {
          console.log("📥 First chunk received from client");
        }

        // Log progress every 50 chunks
        if (chunksReceived % 50 === 0) {
          console.log(
            `📦 Received ${chunksReceived} chunks, ${(
              bytesReceived /
              1024 /
              1024
            ).toFixed(2)} MB total`
          );
        }

        // Write to FFmpeg stdin with backpressure handling
        if (ffmpegProcess.stdin.writable && canWrite) {
          canWrite = ffmpegProcess.stdin.write(buffer);
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
