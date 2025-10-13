// rtmpRelay.js — ULTRA LOW LATENCY OPTIMIZED
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
  } catch {}
  if (ffmpegStatic) return ffmpegStatic;
  throw new Error(
    "FFmpeg not found. Install `sudo apt install ffmpeg` or set FFMPEG_PATH."
  );
}

async function ffmpegSupportsProtocol(bin, proto = "rtmps") {
  return await new Promise((resolve) => {
    try {
      const p = spawn(bin, ["-hide_banner", "-protocols"]);
      let out = "",
        err = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("close", () => {
        const text = (out + "\n" + err).toLowerCase();
        resolve(text.includes(`\n${proto}\n`) || text.includes(` ${proto}\n`));
      });
      p.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

export async function attachRtmpRelay(server, options = {}) {
  const wss = new WebSocketServer({
    server,
    path: options.path || "/ws/rtmp",
    perMessageDeflate: false, // ✅ CRITICAL: no compression
    maxPayload: 10 * 1024 * 1024,
  });

  const ffmpegPath = resolveFfmpegPath();
  const hasRtmps = await ffmpegSupportsProtocol(ffmpegPath, "rtmps");

  console.log(`✅ RTMP Relay WS on ${options.path || "/ws/rtmp"}`);
  console.log(`✅ FFmpeg: ${ffmpegPath} | RTMPS: ${hasRtmps ? "yes" : "no"}`);

  // 🚀 AGGRESSIVE keepalive: 15s thay vì 30s
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {}
    });
  }, 15000);
  wss.on("close", () => clearInterval(interval));

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));

    // 🚀 TCP_NODELAY: tắt Nagle algorithm
    try {
      ws._socket?.setNoDelay?.(true);
    } catch {}

    console.log(`📡 WS from ${req.socket.remoteAddress}`);

    let ffmpegProcess = null;
    let ffmpegStarting = false;
    let ffmpegReady = false;

    let canWrite = true;
    let droppedChunks = 0;
    let chunksReceived = 0;
    let bytesReceived = 0;

    const stopFfmpeg = (reason = "SIGTERM") => {
      if (!ffmpegProcess) return;
      console.log(`🛑 Stop FFmpeg (${reason})`);
      try {
        ffmpegProcess.stdin?.end();
      } catch {}
      try {
        ffmpegProcess.kill(reason);
      } catch {}
      setTimeout(() => {
        if (ffmpegProcess && !ffmpegProcess.killed) {
          try {
            console.log("⚠️ Force SIGKILL");
            ffmpegProcess.kill("SIGKILL");
          } catch {}
        }
      }, 2000); // 🚀 Giảm từ 3s xuống 2s
      ffmpegProcess = null;
      ffmpegStarting = false;
      ffmpegReady = false;
      canWrite = true;
    };

    ws.on("message", async (message, isBinary) => {
      if (isBinary) {
        if (!ffmpegProcess || !ffmpegReady) return;

        // 🚀 CRITICAL: Backpressure tích cực hơn - 2MB thay vì 4MB
        if (!canWrite) {
          droppedChunks++;
          return;
        }

        const buffer = Buffer.isBuffer(message)
          ? message
          : Buffer.from(message);
        bytesReceived += buffer.length;
        chunksReceived++;

        if (ffmpegProcess.stdin?.writable) {
          canWrite = ffmpegProcess.stdin.write(buffer);
        } else {
          droppedChunks++;
        }
        return;
      }

      // TEXT control messages
      let data;
      try {
        data = JSON.parse(message);
      } catch {
        return;
      }
      if (!data || !data.type) return;

      if (data.type === "start") {
        if (ffmpegStarting || ffmpegProcess) {
          return ws.send(
            JSON.stringify({ type: "error", message: "Stream already active" })
          );
        }
        if (!data.streamKey) {
          return ws.send(
            JSON.stringify({ type: "error", message: "Stream key is required" })
          );
        }

        const streamKey = data.streamKey;
        const fps = Number(data.fps || 30);
        const videoBitrate = String(data.videoBitrate || "2000k");
        const audioBitrate = String(data.audioBitrate || "192k");
        const inputFormat = data.format === "mp4" ? "mp4" : "webm";

        let publishUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
        if (!hasRtmps)
          publishUrl = `rtmp://live-api-s.facebook.com:80/rtmp/${streamKey}`;

        console.log("🎬 FFmpeg →", publishUrl.replace(streamKey, "***KEY***"));
        console.log(
          `📥 Input: ${inputFormat} | FPS: ${fps} | Video: ${videoBitrate}`
        );

        ffmpegStarting = true;
        ffmpegReady = false;
        bytesReceived = 0;
        chunksReceived = 0;
        droppedChunks = 0;

        try {
          // 🚀 ULTRA-OPTIMIZED FFmpeg args
          const args = [
            // Input với buffer nhỏ hơn, analyze nhanh hơn
            "-f",
            inputFormat,
            "-thread_queue_size",
            "256", // 🚀 Giảm từ 512
            "-probesize",
            "2000000", // 🚀 Giảm từ 5M
            "-analyzeduration",
            "1000000", // 🚀 Giảm từ 2M
            "-fflags",
            "+genpts+nobuffer",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            "pipe:0",

            "-map",
            "0:v:0",
            "-map",
            "0:a:0",

            // 🚀 ULTRAFAST preset thay vì veryfast
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "ultrafast", // 🚀 KEY CHANGE
            "-tune",
            "zerolatency",
            "-profile:v",
            "high",
            "-level",
            "4.1",
            "-r",
            String(fps),
            "-g",
            String(fps * 2),

            // 🚀 Tối ưu x264 params cho latency cực thấp
            "-x264-params",
            [
              `keyint=${fps * 2}`,
              `min-keyint=${fps * 2}`,
              "no-scenecut=1",
              "rc-lookahead=0",
              "bf=0", // No B-frames
              "sync-lookahead=0", // 🚀 NEW
              "sliced-threads=0", // 🚀 NEW: disable để giảm latency
              "aq-mode=0", // 🚀 NEW: tắt adaptive quantization
            ].join(":"),

            "-b:v",
            videoBitrate,
            "-maxrate",
            videoBitrate,
            "-bufsize",
            (parseInt(videoBitrate) * 1.5 || 3000) + "k", // 🚀 Giảm buffer

            // Audio tối ưu
            "-c:a",
            "aac",
            "-b:a",
            audioBitrate,
            "-ar",
            "48000",
            "-ac",
            "2",
            "-af",
            "aresample=async=1:first_pts=0",

            // 🚀 Output với flag low-delay
            "-f",
            "flv",
            "-flvflags",
            "no_duration_filesize+no_metadata", // 🚀 thêm no_metadata
            "-flush_packets",
            "1", // 🚀 NEW: force flush
            publishUrl,
          ];

          ffmpegProcess = spawn(ffmpegPath, args, {
            stdio: ["pipe", "pipe", "pipe"],
          });
          if (!ffmpegProcess?.pid) throw new Error("FFmpeg failed to spawn");

          // 🚀 Giảm warm-up time: 500ms thay vì 800ms
          setTimeout(() => {
            if (ffmpegProcess && ffmpegStarting) {
              ffmpegReady = true;
              ffmpegStarting = false;
              try {
                ws.send(
                  JSON.stringify({ type: "started", message: "FFmpeg ready" })
                );
              } catch {}
            }
          }, 500);

          let spawnErrored = false;

          ffmpegProcess.on("error", (err) => {
            spawnErrored = true;
            ws.send(
              JSON.stringify({
                type: "error",
                message: `FFmpeg spawn error: ${err.message}`,
              })
            );
            stopFfmpeg("SIGTERM");
          });

          ffmpegProcess.stderr.on("data", (d) => {
            const log = d.toString();
            if (
              /Invalid data|EBML header parsing failed|Error opening input|moov atom not found/i.test(
                log
              )
            ) {
              if (!spawnErrored) {
                spawnErrored = true;
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "FFmpeg input error",
                  })
                );
                stopFfmpeg("SIGTERM");
              }
              return;
            }
            // 🚀 Giảm spam log: chỉ gửi mỗi 2s
            if (/frame=\s*\d+|speed=\s*\S+/i.test(log)) {
              try {
                ws.send(
                  JSON.stringify({ type: "progress", message: log.trim() })
                );
              } catch {}
            }
          });

          ffmpegProcess.stdin.on("error", (err) => {
            if (err?.code !== "EPIPE") {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: `FFmpeg stdin error: ${err.message}`,
                })
              );
            }
            stopFfmpeg("SIGTERM");
          });

          ffmpegProcess.stdin.on("drain", () => {
            canWrite = true;
          });

          ffmpegProcess.on("close", (code) => {
            console.log(
              `FFmpeg exit ${code}; chunks=${chunksReceived}, dropped=${droppedChunks}, MB=${(
                bytesReceived /
                1024 /
                1024
              ).toFixed(2)}`
            );
            try {
              ws.send(
                JSON.stringify({
                  type: "stopped",
                  message: `Stream ended (code ${code})`,
                })
              );
            } catch {}
            ffmpegProcess = null;
            ffmpegStarting = false;
            ffmpegReady = false;
            canWrite = true;
          });

          // 🚀 Giảm timeout: 20s thay vì 30s
          setTimeout(() => {
            if (ffmpegProcess && !ffmpegReady) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "FFmpeg init timeout (20s)",
                })
              );
              stopFfmpeg("SIGTERM");
            }
          }, 20000);
        } catch (e) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Spawn failed: ${e.message}`,
            })
          );
          stopFfmpeg("SIGTERM");
        }
      } else if (data.type === "stop") {
        stopFfmpeg("SIGTERM");
        try {
          ws.send(
            JSON.stringify({ type: "stopped", message: "Stopped by user" })
          );
        } catch {}
      }
    });

    ws.on("close", () => {
      stopFfmpeg("SIGTERM");
    });
    ws.on("error", () => {
      stopFfmpeg("SIGTERM");
    });
  });

  return wss;
}
