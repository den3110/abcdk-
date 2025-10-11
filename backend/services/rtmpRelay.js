// services/rtmpRelay.js
import { WebSocketServer } from "ws";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWin = process.platform === "win32";

// Ưu tiên đường dẫn thực tế trên Linux
const CANDIDATES = [
  process.env.FFMPEG_PATH,
  isWin ? "C:\\ffmpeg\\bin\\ffmpeg.exe" : "/usr/bin/ffmpeg",
  isWin
    ? "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe"
    : "/usr/local/bin/ffmpeg",
  "ffmpeg",
];

const FFMPEG_BIN =
  CANDIDATES.find((p) => p && (p === "ffmpeg" || fs.existsSync(p))) || "ffmpeg";

// Kiểm tra RTMPS support (ESM-safe, KHÔNG dùng require)
function checkRtmpsSupport() {
  try {
    const out = execFileSync(FFMPEG_BIN, ["-protocols"], { encoding: "utf8" });
    if (!out.includes("rtmps")) {
      console.error(
        "⚠️  FFmpeg không có RTMPS. Cài bản đầy đủ (Ubuntu): sudo apt install -y ffmpeg"
      );
      // vẫn tiếp tục, nhiều build có RTMPS nhưng không liệt kê
    } else {
      console.log(`✅ FFmpeg OK (rtmps): ${FFMPEG_BIN}`);
    }
  } catch (e) {
    console.warn("⚠️  Không thể kiểm tra FFmpeg protocols:", e.message);
  }
}

function normalizeFbBase(urlStr) {
  let u = String(urlStr || "").trim();
  u = u.replace(/[\r\n]/g, "").replace(/\s+/g, "");
  if (!u) u = "rtmps://live-api-s.facebook.com:443/rtmp/";
  if (!/\/rtmp\/$/.test(u)) {
    u = u.replace(/\/+$/, "") + "/rtmp/";
  }
  return u;
}

function buildFbOutUrl(server_url, stream_key) {
  const base = normalizeFbBase(server_url);
  let key = String(stream_key || "").trim();
  key = key.replace(/[\r\n]/g, "").replace(/\s+/g, "");
  if (!key) throw new Error("Missing Facebook stream_key");
  const full = base + key;
  if (/\/rtmp\/$/.test(full)) throw new Error("Invalid FB URL (missing key)");
  return full;
}

function startFfmpeg({
  server_url,
  stream_key,
  videoBitrate = "3500k",
  audioBitrate = "128k",
  fps = 30,
}) {
  const fpsStr = String(fps);
  const gop = String(fps * 2);

  // THÊM: Validate input parameters
  if (!server_url || !stream_key) {
    throw new Error("Missing server_url or stream_key");
  }

  const outUrl = buildFbOutUrl(server_url, stream_key);

  console.log(`🎥 Full RTMPS URL: ${outUrl}`);
  console.log(`🎥 URL length: ${outUrl.length} chars`);

  const args = [
    // SỬA: Thêm flags để handle WebM input tốt hơn
    "-re",
    "-fflags",
    "+genpts+igndts", // ← THÊM igndts
    "-flags",
    "low_delay",
    "-avioflags",
    "direct",
    "-f",
    "webm",
    "-thread_queue_size",
    "512", // ← GIẢM từ 4096 xuống 512
    "-use_wallclock_as_timestamps",
    "1",
    "-fflags",
    "nobuffer+flush_packets",
    "-i",
    "pipe:0",

    // Video encoding
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-r",
    fpsStr,
    "-g",
    gop,
    "-b:v",
    videoBitrate,
    "-maxrate",
    videoBitrate,
    "-bufsize",
    "3500k", // ← GIẢM từ 2M xuống 3500k
    "-profile:v",
    "high",
    "-level:v",
    "4.1",

    // Audio encoding
    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
    "-ar",
    "44100",
    "-ac",
    "2",

    // Output settings
    "-flush_packets",
    "1",
    "-muxdelay",
    "0",
    "-f",
    "flv",

    // THÊM: Flags để handle lỗi tốt hơn
    "-avoid_negative_ts",
    "make_zero",
    "-copytb",
    "1",

    outUrl,
  ];

  console.log("\n🔧 FFmpeg Command:");
  console.log(FFMPEG_BIN + " " + args.join(" "));

  const proc = spawn(FFMPEG_BIN, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // THÊM: Pipe stderr để debug
  proc.stderr.on("data", (data) => {
    const line = data.toString().trim();
    if (line) {
      console.log("[ffmpeg-stderr]", line);
    }
  });

  return proc;
}

export function attachRtmpRelay(server, { path = "/ws/rtmp" } = {}) {
  checkRtmpsSupport();

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: true,
    maxPayload: 10 * 1024 * 1024,
  });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      pathname = u.pathname || "";
    } catch {}
    if (pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req)
    );
  });

  const pingLoop = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {}
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {}
    }
  }, 30000);

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    let ffmpeg = null;
    let configured = false;

    ws.on("message", (msg) => {
      if (!configured) {
        let cfg;
        try {
          cfg = JSON.parse(msg.toString());
        } catch {
          try {
            ws.close(1003, "Bad init payload");
          } catch {}
          return;
        }

        if (!cfg?.server_url || !cfg?.stream_key) {
          try {
            ws.close(1003, "Missing RTMP params");
          } catch {}
          return;
        }

        try {
          ffmpeg = startFfmpeg(cfg);

          ffmpeg.stderr.on("data", (line) => {
            const s = line.toString().trim();
            if (s) {
              console.log("[ffmpeg]", s);
              try {
                ws.send(JSON.stringify({ type: "ffmpeg_log", line: s }));
              } catch {}
            }
          });

          ffmpeg.on("spawn", () => {
            try {
              ws.send(JSON.stringify({ type: "ready" }));
            } catch {}
          });
          ffmpeg.on("error", (e) => {
            try {
              ws.send(
                JSON.stringify({ type: "ffmpeg_error", message: e.message })
              );
            } catch {}
            try {
              ws.close(1011, "ffmpeg spawn error");
            } catch {}
          });
          ffmpeg.on("close", (code) => {
            try {
              ws.close(1011, "ffmpeg closed: " + code);
            } catch {}
          });

          configured = true;
        } catch (e) {
          try {
            ws.send(
              JSON.stringify({ type: "ffmpeg_error", message: e.message })
            );
          } catch {}
          try {
            ws.close(1011, "ffmpeg init fail");
          } catch {}
        }
        return;
      }

      // Backpressure
      if (Buffer.isBuffer(msg)) {
        if (ffmpeg?.stdin?.writableLength > 64 * 1024 * 1024) return;
        try {
          ffmpeg.stdin.write(msg);
        } catch {}
      }
    });

    ws.on("close", () => {
      try {
        ffmpeg?.stdin?.end();
      } catch {}
      try {
        ffmpeg?.kill("SIGINT");
      } catch {}
    });
  });

  wss.on("close", () => clearInterval(pingLoop));
  console.log(
    `[RTMP-Relay] mounted at ${path} (noServer), using FFmpeg: ${FFMPEG_BIN}`
  );
  return wss;
}
