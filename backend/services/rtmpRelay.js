// rtmpRelayPro.js - PROFESSIONAL GRADE (WebCodecs support) - FULL DEBUG
import { WebSocketServer } from "ws";
import { spawn } from "child_process";

export async function attachRtmpRelayPro(server, options = {}) {
  const wss = new WebSocketServer({
    server,
    path: options.path || "/ws/rtmp",
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024,
  });

  console.log(`✅ PRO RTMP Relay WebSocket: ${options.path || "/ws/rtmp"}`);

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
        if (!ffmpeg || !config) return;

        try {
          if (ffmpeg.stdin?.writable) {
            // Check first frame for format validation
            if (stats.videoFrames === 0) {
              const firstBytes = new Uint8Array(data.slice(0, 100)); // Check first 100 bytes
              const hex = Array.from(firstBytes.slice(0, 8))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(" ");
              console.log(`🔍 First frame header: ${hex}`);

              // Check for Annex-B start codes
              if (
                (firstBytes[0] === 0 &&
                  firstBytes[1] === 0 &&
                  firstBytes[2] === 0 &&
                  firstBytes[3] === 1) ||
                (firstBytes[0] === 0 &&
                  firstBytes[1] === 0 &&
                  firstBytes[2] === 1)
              ) {
                console.log("✅ H264 format: Annex-B (correct)");

                // Check for SPS (0x67) and PPS (0x68) NAL units
                const dataStr = Array.from(firstBytes)
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
                const hasSPS =
                  dataStr.includes("00000001" + "67") ||
                  dataStr.includes("000001" + "67");
                const hasPPS =
                  dataStr.includes("00000001" + "68") ||
                  dataStr.includes("000001" + "68");

                if (hasSPS && hasPPS) {
                  console.log("✅ First frame contains SPS + PPS (good!)");
                } else {
                  console.warn(
                    "⚠️ First frame missing SPS or PPS - this may cause issues!"
                  );
                  console.warn(
                    `   SPS (0x67): ${hasSPS ? "Found" : "Missing"}`
                  );
                  console.warn(
                    `   PPS (0x68): ${hasPPS ? "Found" : "Missing"}`
                  );
                }
              } else {
                console.warn(
                  "⚠️ H264 format: NOT Annex-B! This will cause FFmpeg to fail."
                );
                console.warn("   Expected: 00 00 00 01 or 00 00 01");
                console.warn(`   Got: ${hex}`);
              }
            }

            ffmpeg.stdin.write(data);
            stats.videoFrames++;

            // Log first few frames
            if (stats.videoFrames <= 5) {
              console.log(
                `📥 Received frame #${stats.videoFrames}: ${data.byteLength} bytes`
              );
            }

            // Log stats every 100 frames
            if (stats.videoFrames % 100 === 0) {
              const elapsed = (Date.now() - stats.startTime) / 1000;
              const avgFps = (stats.videoFrames / elapsed).toFixed(1);
              console.log(
                `📊 Frames: ${
                  stats.videoFrames
                }, Avg FPS: ${avgFps}, Elapsed: ${elapsed.toFixed(1)}s`
              );
            }
          }
        } catch (err) {
          console.error("❌ Write error:", err.message);
        }
        return;
      }

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

        // DEBUG MODE: Set to true to save to file instead of streaming
        const DEBUG_SAVE_FILE = false;

        let outputTarget;
        if (DEBUG_SAVE_FILE) {
          outputTarget = `/tmp/test_stream_${Date.now()}.mp4`;
          console.log(`🎬 DEBUG MODE: Saving to ${outputTarget}`);
        } else {
          // Try RTMP instead of RTMPS (RTMPS can cause SIGSEGV on some systems)
          outputTarget = `rtmp://live-api-s.facebook.com:80/rtmp/${streamKey}`;
          console.log(
            `🎬 Starting PRO stream: ${width}x${height}@${fps}fps, ${videoBitrate}`
          );
          console.log(
            `🔗 RTMP URL: ${outputTarget.replace(streamKey, "***KEY***")}`
          );
        }

        // CRITICAL: Use -re to read at native framerate, add more buffer
        const args = [
          "-hide_banner",
          "-loglevel",
          "info", // Verbose output

          // Input
          "-f",
          "h264",
          "-use_wallclock_as_timestamps",
          "1",
          "-fflags",
          "+genpts",
          "-r",
          String(fps),
          "-i",
          "pipe:0",

          // Video: COPY (no re-encode)
          "-c:v",
          "copy",
          "-bsf:v",
          "dump_extra", // Add SPS/PPS to every keyframe

          // No audio
          "-an",
        ];

        // Output format depends on target
        if (DEBUG_SAVE_FILE) {
          args.push(
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+empty_moov",
            outputTarget
          );
        } else {
          // RTMP specific options to prevent crashes
          args.push(
            "-rtmp_buffer",
            "100",
            "-rtmp_live",
            "live",
            "-f",
            "flv",
            "-flvflags",
            "no_duration_filesize",
            outputTarget
          );
        }

        try {
          ffmpeg = spawn("ffmpeg", args, {
            stdio: ["pipe", "pipe", "pipe"],
          });

          if (!ffmpeg.pid) throw new Error("FFmpeg spawn failed");

          stats = { videoFrames: 0, audioFrames: 0, startTime: Date.now() };

          ffmpeg.stdin.on("error", (e) => {
            if (e.code !== "EPIPE") {
              console.error("❌ stdin error:", e.message);
            }
          });

          // CRITICAL: Log EVERYTHING from FFmpeg
          ffmpeg.stderr.on("data", (d) => {
            const log = d.toString().trim();
            console.log("📺 FFmpeg:", log);

            // Send progress to client
            if (log.includes("frame=") || log.includes("speed=")) {
              try {
                ws.send(JSON.stringify({ type: "progress", message: log }));
              } catch {}
            }
          });

          ffmpeg.on("close", (code, signal) => {
            const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
            const fps = (stats.videoFrames / elapsed).toFixed(1);
            console.log(
              `🛑 FFmpeg exit code=${code} signal=${signal}. Frames: ${stats.videoFrames}, Avg FPS: ${fps}, Duration: ${elapsed}s`
            );
            cleanup();
            try {
              ws.send(JSON.stringify({ type: "stopped", code, signal }));
            } catch {}
          });

          ws.send(
            JSON.stringify({
              type: "started",
              message: "WebCodecs PRO mode: H264 copy, <1s latency",
            })
          );

          console.log("✅ FFmpeg ready, waiting for H264 frames...");

          // Check after 5 seconds
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
