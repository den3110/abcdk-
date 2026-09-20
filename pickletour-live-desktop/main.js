// PickleTour Live — Electron main process.
// Đăng nhập admin → chọn giải/sân/cam → tạo phiên runner:"client" trên backend
// → lấy worker-config → spawn worker.py (GPU) local → preview HLS.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

let win;
// sessionId → { proc, previewDir, previewServer, previewPort, cfg }
const running = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 940, minHeight: 640,
    title: "PickleTour Live",
    backgroundColor: "#0b1120",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { stopAll(); if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", stopAll);

function stopAll() {
  for (const [sid] of running) stopWorker(sid);
}

// ───────────────────────── HTTP helpers (authed) ─────────────────────────
async function apiFetch(baseUrl, apiPath, { method = "GET", token, body } = {}) {
  const url = baseUrl.replace(/\/$/, "") + apiPath;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ───────────────────────── Python / ffmpeg detect ────────────────────────
function detectPython() {
  for (const cand of [process.env.PICKLETOUR_PYTHON, "python3", "python"]) {
    if (!cand) continue;
    try {
      const r = spawnSync(cand, ["-c", "import imou; print('ok')"], { encoding: "utf8" });
      if (r.status === 0 && /ok/.test(r.stdout)) return cand;
    } catch {}
  }
  return null;
}
function detectFfmpeg() {
  for (const cand of [process.env.FFMPEG_PATH, "ffmpeg"]) {
    if (!cand) continue;
    try { const r = spawnSync(cand, ["-version"], { encoding: "utf8" }); if (r.status === 0) return cand; } catch {}
  }
  return null;
}
function detectEncoders(ffmpeg) {
  try {
    const r = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    const out = r.stdout || "";
    const list = [];
    for (const [enc, label] of [
      ["h264_nvenc", "NVIDIA NVENC (GPU)"],
      ["h264_videotoolbox", "Apple VideoToolbox (GPU)"],
      ["h264_qsv", "Intel QuickSync (GPU)"],
      ["h264_vaapi", "VAAPI (GPU)"],
      ["libx264", "x264 (CPU)"],
    ]) if (out.includes(" " + enc)) list.push({ value: enc, label });
    return list;
  } catch { return [{ value: "libx264", label: "x264 (CPU)" }]; }
}

// ───────────────────────── Preview HLS static server ─────────────────────
function startPreviewServer(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "");
      const fp = path.join(dir, rel || "index.m3u8");
      if (!fp.startsWith(dir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ct = fp.endsWith(".m3u8") ? "application/vnd.apple.mpegurl"
          : fp.endsWith(".ts") ? "video/mp2t" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ───────────────────────── Worker lifecycle ──────────────────────────────
function workerScriptPath() {
  // Ưu tiên bản đóng gói trong app; fallback repo.
  const bundled = path.join(__dirname, "worker", "worker.py");
  return fs.existsSync(bundled) ? bundled : bundled;
}

async function startWorker({ baseUrl, token, form }) {
  const python = detectPython();
  const ffmpeg = detectFfmpeg();
  if (!ffmpeg) throw new Error("Chưa cài ffmpeg. Cài ffmpeg rồi thử lại (xem README).");
  if (!python) throw new Error("Chưa cài Python + ImouPkg. Chạy scripts/setup (xem README).");

  // 1) Tạo phiên trên backend (runner=client) — backend tạo FB live + overlay.
  const session = await apiFetch(baseUrl, "/api/tournament-auto-live/start", {
    method: "POST", token,
    body: {
      tournamentId: form.tournamentId,
      courtStationId: form.courtStationId,
      imouDeviceId: form.imouDeviceId,
      venueId: form.venueId,
      destinations: form.destinations,
      layout: form.layout,
      runner: "client",
    },
  });
  const sid = session._id;

  // 2) Lấy worker-config (session Imou đã giải mã, dests, URLs, token)
  const cfg = await apiFetch(baseUrl, `/api/tournament-auto-live/${sid}/worker-config`, { token });

  // 3) Thư mục preview HLS + static server
  const previewDir = path.join(os.tmpdir(), `ptlive-preview-${sid}`);
  fs.mkdirSync(previewDir, { recursive: true });
  const previewServer = await startPreviewServer(previewDir);
  const previewPort = previewServer.address().port;

  // 4) Spawn worker.py với GPU + preview
  const env = {
    ...process.env,
    PICKLETOUR_PYTHON: undefined,
    AUTOLIVE_SESSION_ID: cfg.sessionId,
    AUTOLIVE_WORKER_TOKEN: cfg.workerToken,
    AUTOLIVE_OVERLAY_URL: cfg.overlayUrl,
    AUTOLIVE_HEARTBEAT_URL: cfg.heartbeatUrl,
    AUTOLIVE_SESSION_POST_URL: cfg.sessionPostUrl,
    AUTOLIVE_IMOU_SESSION_JSON: cfg.imouSession ? JSON.stringify(cfg.imouSession) : "",
    AUTOLIVE_IMOU_PHONE: cfg.imouCreds?.phone || "",
    AUTOLIVE_IMOU_PASSWORD: cfg.imouCreds?.password || "",
    AUTOLIVE_IMOU_AREA_CODE: cfg.imouCreds?.areaCode || "84",
    AUTOLIVE_IMOU_DEVICE_ID: cfg.imouDeviceId,
    AUTOLIVE_DESTINATIONS: JSON.stringify(cfg.destinations || []),
    AUTOLIVE_ENCODER: form.encoder || "auto",
    AUTOLIVE_PREVIEW_HLS_DIR: previewDir,
    AUTOLIVE_RUNNER_LABEL: form.runnerLabel || os.hostname(),
    FFMPEG_PATH: ffmpeg,
  };
  const logFile = path.join(previewDir, "worker.log");
  const logFd = fs.openSync(logFile, "a");
  const proc = spawn(python, [workerScriptPath()], { env, stdio: ["ignore", logFd, logFd] });
  running.set(sid, { proc, previewDir, previewServer, previewPort, cfg, logFile });

  proc.on("exit", (code) => {
    sendToRenderer("worker-exit", { sessionId: sid, code });
    cleanupWorker(sid);
  });

  return {
    sessionId: sid,
    previewUrl: `http://127.0.0.1:${previewPort}/index.m3u8`,
    watchUrls: (session.destinations || []).map((d) => d.watchUrl).filter(Boolean),
    logFile,
  };
}

function cleanupWorker(sid) {
  const r = running.get(sid);
  if (!r) return;
  try { r.previewServer?.close(); } catch {}
  running.delete(sid);
}

function stopWorker(sid) {
  const r = running.get(sid);
  if (!r) return;
  try { r.proc.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { r.proc.kill("SIGKILL"); } catch {} }, 5000);
  cleanupWorker(sid);
}

function sendToRenderer(channel, payload) {
  try { win?.webContents.send(channel, payload); } catch {}
}

// ───────────────────────── IPC ───────────────────────────────────────────
ipcMain.handle("env-check", () => {
  const ffmpeg = detectFfmpeg();
  const python = detectPython();
  return {
    ffmpeg: !!ffmpeg, python: !!python,
    encoders: ffmpeg ? detectEncoders(ffmpeg) : [],
    hostname: os.hostname(), platform: `${os.type()} ${os.arch()}`,
  };
});

ipcMain.handle("login", async (_e, { baseUrl, email, password }) => {
  const data = await apiFetch(baseUrl, "/api/admin/login", { method: "POST", body: { email, password } });
  const token = data.token || data.user?.token;
  if (!token) throw new Error("Đăng nhập không trả token");
  return { token, user: data.user };
});

ipcMain.handle("api-get", async (_e, { baseUrl, token, path: p }) =>
  apiFetch(baseUrl, p, { token }));

ipcMain.handle("start", async (_e, args) => startWorker(args));
ipcMain.handle("stop", async (_e, { baseUrl, token, sessionId }) => {
  stopWorker(sessionId);
  try { await apiFetch(baseUrl, `/api/tournament-auto-live/${sessionId}/stop`, { method: "POST", token }); } catch {}
  return { ok: true };
});
ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));
ipcMain.handle("open-log", (_e, sessionId) => {
  const r = running.get(sessionId);
  if (r?.logFile) shell.openPath(r.logFile);
});
