// server/rtmpRelay.js
// ESM: cần "type": "module" trong package.json
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import { parse as parseUrl } from "url";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";

function resolveFfmpegCmd() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
 
  return "ffmpeg"; // fallback PATH hệ thống
}

function buildOutUrl(server_url, stream_key) {
  let s = String(server_url || "").trim();
  let k = String(stream_key || "").trim();
  if (!s) throw new Error("Missing server_url");
  if (!k) throw new Error("Missing stream_key");
  if (!s.endsWith("/")) s += "/";
  if (k.startsWith("/")) k = k.slice(1);
  return s + k; // giữ nguyên query ?...
}

export function attachRtmpRelay(server, { path = "/ws/rtmp" } = {}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parseUrl(req.url);
    if (pathname !== path) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req)
    );
  });

  wss.on("connection", (ws) => {
    let ffmpeg = null;
    let gotConfig = false;

    // hàng đợi & backpressure
    const queue = [];
    let writing = false;

    // trạng thái
    let pingTimer = null;
    let stopped = false;
    let ffAlive = false;
    let stdinClosed = false;

    // keepalive
    pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.ping();
        } catch {}
      }
    }, 15000);

    const send = (type, payload = {}) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify({ type, ...payload }));
        } catch {}
      }
    };

    const stop = (reason = "normal") => {
      if (stopped) return;
      stopped = true;

      clearInterval(pingTimer);

      try {
        ffmpeg?.stdin?.end();
      } catch {}
      try {
        ffmpeg?.kill("SIGINT");
      } catch {}

      try {
        ws.close(1000, reason);
      } catch {}
    };

    const flush = () => {
      if (writing) return;
      writing = true;

      const MAX_BURST = 200; // giới hạn số gói mỗi lượt để không chiếm event-loop quá lâu
      let sent = 0;

      const loop = () => {
        if (stopped || !ffAlive || stdinClosed) {
          writing = false;
          return;
        }
        while (queue.length && sent < MAX_BURST) {
          const buf = queue[0];
          let ok = false;
          try {
            ok = ffmpeg.stdin.write(buf);
          } catch (e) {
            // lỗi sync hiếm gặp
            send("ffmpeg_error", {
              message: "stdin write failed: " + (e.message || e),
            });
            writing = false;
            return stop("stdin-failed");
          }

          if (!ok) {
            // đợi drain rồi tiếp tục
            ffmpeg.stdin.once("drain", () => {
              sent = 0; // reset burst
              loop();
            });
            writing = false;
            return;
          }
          queue.shift();
          sent++;
        }

        if (queue.length === 0) {
          writing = false;
          return;
        }
        // còn dữ liệu nhưng đã đạt MAX_BURST
        setImmediate(loop);
      };

      loop();
    };

    ws.on("message", (data, isBinary) => {
      if (stopped) return;

      // gói đầu: JSON config
      if (!gotConfig && !isBinary) {
        let cfg;
        try {
          cfg = JSON.parse(data.toString());
        } catch {
          send("ffmpeg_error", { message: "Bad JSON config" });
          return stop("bad-config");
        }

        const {
          server_url,
          stream_key,
          videoBitrate = "3500k",
          audioBitrate = "128k",
          fps = 30,
        } = cfg || {};

        let outUrl;
        try {
          outUrl = buildOutUrl(server_url, stream_key);
        } catch (e) {
          send("ffmpeg_error", { message: e.message || "Bad URL" });
          return stop("bad-config");
        }

        const kbps =
          parseInt(String(videoBitrate).replace(/[^0-9]/g, ""), 10) || 3500;
        const bufsize = `${kbps * 2}k`;

        const args = [
          "-hide_banner",
          "-loglevel",
          "verbose",
          "-stats",
          "-re",
          "-fflags",
          "nobuffer",
          "-thread_queue_size",
          "2048",
          "-f",
          "webm",
          "-i",
          "pipe:0",
          "-analyzeduration",
          "0",
          "-probesize",
          "32M",
          "-use_wallclock_as_timestamps",
          "1",

          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(fps),
          "-g",
          String(fps * 2),
          "-sc_threshold",
          "0", // khóa GOP, tránh tự cắt keyframe
          "-x264-params",
          `keyint=${fps * 2}:min-keyint=${fps * 2}:scenecut=0`,
          "-b:v",
          videoBitrate,
          "-maxrate",
          videoBitrate,
          "-bufsize",
          bufsize,

          "-c:a",
          "aac",
          "-ac",
          "2",

          "-f",
          "flv",
          "-flvflags",
          "no_duration_filesize",
          "-rtmp_live",
          "live",
          "-muxdelay",
          "0",
          "-muxpreload",
          "0",
          "-rw_timeout",
          "15000000", // 15s
          outUrl,
        ];

        const cmd = resolveFfmpegCmd();
        console.log("[RTMP Relay] Using ffmpeg at:", cmd);
        console.log("[RTMP Relay] OUT =", outUrl);

        try {
          const finalArgs = process.env.FFMPEG_REPORT
            ? ["-report", ...args]
            : args;
          ffmpeg = spawn(cmd, finalArgs, { stdio: ["pipe", "pipe", "pipe"] });
        } catch (e) {
          send("ffmpeg_error", {
            message: `Cannot spawn ffmpeg: ${e.message}`,
          });
          return stop("spawn-failed");
        }

        ffAlive = true;
        stdinClosed = false;

        // forward log → FE
        ffmpeg.stderr.on("data", (chunk) =>
          send("ffmpeg_log", { line: chunk.toString() })
        );
        ffmpeg.stdout.on("data", (chunk) =>
          send("ffmpeg_log", { line: chunk.toString() })
        );

        // BẮT LỖI TRÊN STDIN (ngăn uncaughtException: write EOF)
        ffmpeg.stdin.on("error", (e) => {
          const code = e?.code || "";
          if (code === "EPIPE" || code === "EOF") {
            send("ffmpeg_error", { message: `stdin closed (${code})` });
          } else {
            send("ffmpeg_error", { message: `stdin error: ${e.message || e}` });
          }
          stdinClosed = true;
          return stop("stdin-error");
        });
        ffmpeg.stdin.on("close", () => {
          stdinClosed = true;
        });

        ffmpeg.on("error", (e) => {
          send("ffmpeg_error", { message: e.message || String(e) });
          ffAlive = false;
          return stop("ffmpeg-error");
        });

        ffmpeg.on("close", (code, signal) => {
          send("ffmpeg_exit", { code, signal });
          ffAlive = false;
          stdinClosed = true;
          return stop("ffmpeg-exit");
        });

        gotConfig = true;
        send("ready");

        // flush các binary đã queue (nếu FE gửi sớm)
        flush();
        return;
      }

      // sau khi ready: nhận binary WebM chunk
      if (isBinary) {
        if (stopped || !ffAlive || stdinClosed) return;

        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        queue.push(buf);

        // chặn tràn RAM: giữ tối đa ~50MB trong queue
        const totalQueuedBytes = queue.reduce((s, b) => s + b.byteLength, 0);
        if (totalQueuedBytes > 50 * 1024 * 1024) {
          // bỏ bớt frame cũ (drop frames) để kịp live
          while (
            queue.length &&
            queue.reduce((s, b) => s + b.byteLength, 0) > 25 * 1024 * 1024
          ) {
            queue.shift();
          }
          send("ffmpeg_log", {
            line: "[warn] Dropping old frames to relieve backpressure\n",
          });
        }

        flush();
      }
    });

    ws.on("close", () => {
      stop("ws-close");
    });

    ws.on("error", () => {
      stop("ws-error");
    });
  });

  return wss;
}
