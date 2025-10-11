// services/rtmpRelay.js - FIXED VERSION

import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWin = process.platform === "win32";

// ⚠️ QUAN TRỌNG: Phải dùng bản FULL, không dùng essentials
const CANDIDATES = [
  process.env.FFMPEG_PATH,
  isWin ? "C:\\ffmpeg\\bin\\ffmpeg.exe" : null, // Đường dẫn custom
  isWin ? "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe" : null,
  "ffmpeg",
];

const FFMPEG_BIN =
  CANDIDATES.find((p) => p && (p === "ffmpeg" || fs.existsSync(p))) || "ffmpeg";

// Kiểm tra FFmpeg có hỗ trợ RTMPS không
function checkRtmpsSupport() {
  try {
    const { execSync } = require("child_process");
    const output = execSync(`"${FFMPEG_BIN}" -protocols`, { encoding: "utf8" });
    const hasRtmps = output.includes("rtmps");

    if (!hasRtmps) {
      console.error(`
╔═══════════════════════════════════════════════════════════╗
║  ⚠️  FFmpeg KHÔNG hỗ trợ RTMPS!                           ║
║                                                           ║
║  Bạn đang dùng bản "essentials" thiếu OpenSSL.           ║
║                                                           ║
║  Giải pháp:                                               ║
║  1. Tải bản FULL từ:                                      ║
║     https://www.gyan.dev/ffmpeg/builds/                   ║
║     → Chọn "ffmpeg-release-full.7z"                       ║
║                                                           ║
║  2. Giải nén và set biến môi trường:                      ║
║     set FFMPEG_PATH=C:\\path\\to\\ffmpeg-full\\bin\\ffmpeg.exe ║
║                                                           ║
║  3. Hoặc cài qua Chocolatey (FULL version):               ║
║     choco install ffmpeg-full                             ║
╚═══════════════════════════════════════════════════════════╝
      `);
      return false;
    }

    console.log(`✅ FFmpeg hỗ trợ RTMPS: ${FFMPEG_BIN}`);
    return true;
  } catch (e) {
    console.warn("⚠️  Không thể kiểm tra FFmpeg protocols:", e.message);
    return true; // Tiếp tục thử
  }
}

// Chuẩn hoá base RTMPS cho Facebook
function normalizeFbBase(urlStr) {
  let u = String(urlStr || "").trim();
  if (!u) u = "rtmps://live-api-s.facebook.com:443/rtmp/";
  u = u.replace(/\s+/g, "");
  if (!/\/rtmp\/$/.test(u)) {
    u = u.replace(/\/+$/, "") + "/rtmp/";
  }
  return u;
}

function buildFbOutUrl(server_url, stream_key) {
  const base = normalizeFbBase(server_url);
  let key = String(stream_key || "").trim();

  // Loại bỏ ALL khoảng trắng, tab, newline
  key = key.replace(/[\r\n\t\s]+/g, "");

  if (!key) throw new Error("Missing Facebook stream_key");

  const fullUrl = base + key;

  // Validate URL không có khoảng trắng
  if (/\s/.test(fullUrl)) {
    throw new Error(`Invalid URL contains whitespace: "${fullUrl}"`);
  }

  console.log(`✅ Built URL (length=${fullUrl.length}): ${fullUrl}`);
  return fullUrl;
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
  const outUrl = buildFbOutUrl(server_url, stream_key);

  console.log(`🎥 Full RTMPS URL: ${outUrl}`);
  console.log(`🎥 URL length: ${outUrl.length} chars`);

  const args = [
    "-re",
    "-f",
    "webm",
    "-thread_queue_size",
    "4096",
    "-fflags",
    "+genpts",
    "-use_wallclock_as_timestamps",
    "1",
    "-fflags",
    "nobuffer",
    "-i",
    "pipe:0",

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
    "2M",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-x264-params",
    `keyint=${gop}:min-keyint=${gop}:scenecut=0:nal-hrd=cbr`,

    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
    "-ar",
    "44100",
    "-ac",
    "2",

    "-flush_packets",
    "1",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-flvflags",
    "no_duration_filesize",

    // Output format và URL
    "-f",
    "flv",
    outUrl,
  ];

  const proc = spawn(FFMPEG_BIN, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // LOG FULL COMMAND
  console.log("\n🔧 FFmpeg Command:");
  console.log(FFMPEG_BIN);
  console.log(args.join(" \\\n  "));
  console.log("\n");

  return proc;
}

export function attachRtmpRelay(server, { path = "/ws/rtmp" } = {}) {
  // Kiểm tra RTMPS support khi khởi động
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

          ffmpeg.stderr.setEncoding("utf8");
          ffmpeg.stderr.on("data", (line) => {
            const s = line.toString().trim();
            if (s) {
              console.log("[ffmpeg]", s);

              // Highlight important messages
              if (
                s.includes("frame=") ||
                s.includes("fps=") ||
                s.includes("bitrate=")
              ) {
                console.log("📊 Streaming:", s);
              }
              if (
                s.includes("error") ||
                s.includes("Error") ||
                s.includes("failed")
              ) {
                console.error("❌ FFmpeg Error:", s);
              }

              try {
                ws.send(JSON.stringify({ type: "ffmpeg_log", line: s }));
              } catch {}
            }
          });

          ffmpeg.on("spawn", () => {
            console.log("✅ FFmpeg process spawned");
            try {
              ws.send(JSON.stringify({ type: "ready" }));
            } catch {}
          });

          ffmpeg.on("error", (e) => {
            console.error("❌ FFmpeg spawn error:", e.message);
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
            console.log(`🛑 FFmpeg closed with code: ${code}`);
            try {
              ws.close(1011, "ffmpeg closed: " + code);
            } catch {}
          });

          configured = true;
        } catch (e) {
          console.error("❌ FFmpeg init failed:", e.message);
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
