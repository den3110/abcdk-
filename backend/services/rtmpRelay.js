// rtmpRelay.fixed.js
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

    // FIX: Track FFmpeg startup state
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

        // FIX: Prevent multiple start attempts
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
        const videoBitrate = String(data.videoBitrate || "4000k");
        const audioBitrate = String(data.audioBitrate || "128k");

        let publishUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
        if (!hasRtmps) {
          console.warn(
            "⚠️ FFmpeg lacks RTMPS; falling back to RTMP (insecure)"
          );
          publishUrl = `rtmp://live-api-s.facebook.com:80/rtmp/${streamKey}`;
        }

        console.log(`🎬 Starting FFmpeg with path: ${ffmpegPath}`);
        console.log(`📺 Target URL: ${publishUrl}`);

        // FIX: Set starting flag
        ffmpegStarting = true;
        ffmpegReady = false;
        bytesReceived = 0;
        chunksReceived = 0;

        try {
          const args = [
            // Input from stdin
            "-f",
            "webm",
            "-thread_queue_size",
            "1024", // Increased for mobile
            "-analyzeduration",
            "1M",
            "-probesize",
            "1M",
            "-i",
            "pipe:0",

            // Timestamps & low-latency
            "-fflags",
            "+genpts+nobuffer",
            "-use_wallclock_as_timestamps",
            "1",
            "-flush_packets",
            "1",
            "-max_delay",
            "500000",

            // Map streams flexibly
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",

            // Video encoding
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "main",
            "-level",
            "4.0",
            "-r",
            String(fps),
            "-g",
            String(fps * 2),
            "-keyint_min",
            String(fps),
            "-x264-params",
            "scenecut=0:open_gop=0:nal-hrd=cbr",
            "-maxrate",
            videoBitrate,
            "-bufsize",
            String(parseInt(videoBitrate) * 2 || 8000) + "k",
            "-b:v",
            videoBitrate,

            // Audio encoding
            "-c:a",
            "aac",
            "-b:a",
            audioBitrate,
            "-ar",
            "44100",
            "-ac",
            "2",
            "-strict",
            "experimental",

            // Output format
            "-f",
            "flv",
            "-flvflags",
            "no_duration_filesize",
            publishUrl,
          ];

          ffmpegProcess = spawn(ffmpegPath, args, {
            stdio: ["pipe", "pipe", "pipe"],
          });

          console.log("✅ FFmpeg process spawned, PID:", ffmpegProcess.pid);

          // FIX: Detect when FFmpeg is actually ready to receive data
          let firstFrameDetected = false;

          ffmpegProcess.stderr.on("data", (d) => {
            const log = d.toString();

            // FIX: Detect FFmpeg ready signals
            if (!firstFrameDetected && !ffmpegReady) {
              if (
                log.includes("Stream mapping:") ||
                log.includes("Press [q] to stop") ||
                log.includes("frame=") ||
                log.includes("Output #0")
              ) {
                firstFrameDetected = true;

                // FIX: Delay ready signal slightly to ensure stdin is truly ready
                setTimeout(() => {
                  if (ffmpegProcess && !ffmpegReady) {
                    ffmpegReady = true;
                    ffmpegStarting = false;

                    if (startTimeout) {
                      clearTimeout(startTimeout);
                      startTimeout = null;
                    }

                    console.log("✅ FFmpeg is READY to receive data");
                    ws.send(
                      JSON.stringify({
                        type: "started",
                        message: "Streaming to Facebook started",
                      })
                    );
                  }
                }, 500); // 500ms delay to ensure stability
              }
            }

            // Log progress
            if (
              log.includes("frame=") ||
              log.toLowerCase().includes("error") ||
              log.toLowerCase().includes("speed=")
            ) {
              ws.send(
                JSON.stringify({ type: "progress", message: log.trim() })
              );
            }

            // Detect errors
            if (
              log.toLowerCase().includes("error") ||
              log.toLowerCase().includes("invalid") ||
              log.toLowerCase().includes("failed")
            ) {
              console.error("⚠️ FFmpeg error:", log.trim());
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
                message: `FFmpeg error: ${error.message}`,
              })
            );
            stopFfmpeg("SIGTERM");
          });

          ffmpegProcess.on("close", (code) => {
            console.log(`FFmpeg exited with code ${code}`);
            console.log(
              `📊 Total: ${chunksReceived} chunks, ${(
                bytesReceived /
                1024 /
                1024
              ).toFixed(2)} MB`
            );

            ws.send(
              JSON.stringify({
                type: "stopped",
                message: `Stream ended (code: ${code})`,
              })
            );

            ffmpegProcess = null;
            ffmpegStarting = false;
            ffmpegReady = false;
          });

          // FIX: Safety timeout - if FFmpeg doesn't become ready in 15s, abort
          startTimeout = setTimeout(() => {
            if (ffmpegProcess && !ffmpegReady) {
              console.error("❌ FFmpeg startup timeout");
              ws.send(
                JSON.stringify({
                  type: "error",
                  message:
                    "FFmpeg failed to start within 15 seconds. Check server logs.",
                })
              );
              stopFfmpeg("SIGTERM");
            }
          }, 15000);
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
        // FIX: Only accept data when FFmpeg is truly ready
        if (!ffmpegProcess) {
          // Silently ignore if FFmpeg not started
          return;
        }

        if (ffmpegStarting || !ffmpegReady) {
          // FIX: Client should queue, but just in case - ignore
          console.log("⚠️ Received data while FFmpeg starting, ignoring");
          return;
        }

        const buffer = Buffer.from(data.data);
        bytesReceived += buffer.length;
        chunksReceived++;

        // Log every 100 chunks
        if (chunksReceived % 100 === 0) {
          console.log(
            `📦 Received ${chunksReceived} chunks, ${(
              bytesReceived /
              1024 /
              1024
            ).toFixed(2)} MB total`
          );
        }

        if (ffmpegProcess.stdin.writable && canWrite) {
          canWrite = ffmpegProcess.stdin.write(buffer);
          if (!canWrite) {
            // Backpressure - will resume on 'drain'
          }
        } else {
          // Drop frame if stdin not writable (keeps realtime)
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
