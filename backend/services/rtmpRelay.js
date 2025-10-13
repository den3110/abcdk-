// rtmpRelayPro.js - FINAL FIXED VERSION
// Copy TOÀN BỘ file này thay thế file cũ
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
              const firstBytes = new Uint8Array(data.slice(0, 100));
              const hex = Array.from(firstBytes.slice(0, 8))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(" ");
              console.log(`🔍 First frame header: ${hex}`);

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

            if (stats.videoFrames <= 5) {
              console.log(
                `📥 Received frame #${stats.videoFrames}: ${data.byteLength} bytes`
              );
            }

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

        // 🔧 DEBUG MODE: Đổi thành true để test save file local trước
        const DEBUG_SAVE_FILE = false;

        let outputTarget;
        if (DEBUG_SAVE_FILE) {
          outputTarget = `/tmp/test_stream_${Date.now()}.mp4`;
          console.log(`🎬 DEBUG MODE: Saving to ${outputTarget}`);
          console.log(
            `   After streaming, check: ls -lh /tmp/test_stream_*.mp4`
          );
        } else {
          // ✅ QUAN TRỌNG: Dùng RTMPS (SSL) - Facebook yêu cầu
          outputTarget = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
          console.log(
            `🎬 Starting PRO stream: ${width}x${height}@${fps}fps, ${videoBitrate}`
          );
          console.log(
            `🔗 RTMPS URL: ${outputTarget.replace(streamKey, "***KEY***")}`
          );
        }

        const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
        console.log(`🎥 Using FFmpeg: ${ffmpegPath}`);

        // ✅ SIMPLIFIED args - thêm silent audio cho Facebook
        const args = [
          "-hide_banner",
          "-loglevel",
          "info",

          // Input 1: raw H264 stream
          "-f",
          "h264",
          "-i",
          "pipe:0",

          // Input 2: silent audio
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=48000:cl=stereo",

          // ✅ Map streams explicitly
          "-map",
          "0:v", // Video from input 0
          "-map",
          "1:a", // Audio from input 1

          // Video: COPY (no re-encode)
          "-c:v",
          "copy",

          // Audio: encode to AAC
          "-c:a",
          "aac",
          "-b:a",
          "128k",

          // Stop when video ends
          "-shortest",
        ];

        // Output format
        if (DEBUG_SAVE_FILE) {
          args.push(
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+empty_moov",
            outputTarget
          );
        } else {
          args.push(
            "-f",
            "flv",
            "-flvflags",
            "no_duration_filesize",
            outputTarget
          );
        }

        console.log(
          `🔧 FFmpeg command: ${ffmpegPath} ${args
            .slice(0, -1)
            .join(" ")} [OUTPUT]`
        );

        try {
          ffmpeg = spawn(ffmpegPath, args, {
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
            const log = d.toString().trim();
            console.log("📺 FFmpeg:", log);

            // Check for specific errors
            if (log.includes("Cannot read RTMP handshake")) {
              console.error("❌ RTMP handshake failed!");
              console.error("   Possible causes:");
              console.error("   1. Invalid stream key");
              console.error(
                "   2. Facebook stream not ready (start in dashboard first)"
              );
              console.error("   3. Network/firewall blocking");
              console.error(
                "   💡 Try: Set DEBUG_SAVE_FILE=true to test H264 locally first"
              );
            }
            if (
              log.includes("Unsupported protocol") ||
              log.includes("Protocol not found")
            ) {
              console.error("❌ FFmpeg doesn't support RTMPS!");
              console.error(
                "   Install: sudo apt install ffmpeg libssl-dev librtmp-dev"
              );
            }

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
