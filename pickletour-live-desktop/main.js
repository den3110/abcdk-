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
// Xem thử nguồn TRƯỚC khi live (1 preview tại 1 thời điểm): { proc, dir, server }
let previewState = null;
let lastPreviewLog = null; // đường log preview gần nhất (đọc tail khi lỗi)

function tailFile(fp, maxBytes = 6000) {
  try {
    const st = fs.statSync(fp);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(fp, "r");
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}

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
async function apiFetch(baseUrl, apiPath, { method = "GET", token, body, headers } = {}) {
  const url = baseUrl.replace(/\/$/, "") + apiPath;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
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
// venv do app tự tạo (ghi vào userData — luôn ghi được, kể cả app ở /Applications
// hay Program Files; sống qua update, khác với .venv trong bundle read-only).
function userPyenvDir() {
  try { return path.join(app.getPath("userData"), "pyenv"); } catch { return null; }
}
function venvPythonPath(venvDir) {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}
function pythonHasImou(cmd) {
  if (!cmd) return false;
  try {
    const r = spawnSync(cmd, ["-c", "import imou,sys;print('ok')"], { encoding: "utf8" });
    return r.status === 0 && /ok/.test(r.stdout || "");
  } catch { return false; }
}

function detectPython() {
  // Ưu tiên: env → venv app tự tạo (userData) → .python-path (setup cũ) → tên phổ biến.
  const venvPy = (() => { const d = userPyenvDir(); return d ? venvPythonPath(d) : null; })();
  const fromFile = (() => {
    try { return fs.readFileSync(path.join(__dirname, ".python-path"), "utf8").trim(); } catch { return null; }
  })();
  const cands = [process.env.PICKLETOUR_PYTHON, venvPy, fromFile,
    "python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
  for (const cand of cands) {
    if (!cand) continue;
    if (pythonHasImou(cand)) return cand;
  }
  return null;
}

// Python 3.10+ bất kỳ (chưa cần imou) để tạo venv cho auto-setup.
function detectBasePython() {
  for (const cand of [process.env.PICKLETOUR_PYTHON,
    "python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"]) {
    if (!cand) continue;
    try {
      const r = spawnSync(cand, ["-c", "import sys;print(sys.version_info[0],sys.version_info[1])"], { encoding: "utf8" });
      if (r.status === 0) {
        const [maj, min] = (r.stdout || "").trim().split(/\s+/).map(Number);
        if (maj === 3 && min >= 10) return cand;
      }
    } catch {}
  }
  return null;
}

function vendorImouDir() {
  // asar:false → resources/app/vendor/imou-pkg (đóng gói) hoặc ./vendor/imou-pkg (dev).
  const p = path.join(__dirname, "vendor", "imou-pkg");
  return fs.existsSync(p) ? p : null;
}

// Tự tạo venv + cài ImouPkg (từ vendor bundled) → trả python dùng được.
// Cần internet lần đầu (kéo phụ thuộc: pycryptodomex, requests…). onProgress(msg).
function ensurePythonSetup(onProgress) {
  const log = (m) => { try { onProgress && onProgress(m); } catch {} };
  const existing = detectPython();
  if (existing) return { ok: true, python: existing, already: true };
  const base = detectBasePython();
  if (!base) {
    const e = new Error("Không thấy Python 3.10+ trên máy. Cài Python (tick Add to PATH) rồi thử lại.");
    e.code = "NO_BASE_PYTHON"; throw e;
  }
  const venvDir = userPyenvDir();
  if (!venvDir) throw new Error("Không xác định được thư mục dữ liệu app.");
  log(`Tạo môi trường Python (venv) tại:\n${venvDir}`);
  let r = spawnSync(base, ["-m", "venv", venvDir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("Tạo venv thất bại: " + (r.stderr || r.stdout || "").slice(0, 400));
  const py = venvPythonPath(venvDir);
  log("Nâng cấp pip…");
  spawnSync(py, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"], { encoding: "utf8" });
  const vendor = vendorImouDir();
  log("Cài ImouPkg + phụ thuộc (cần internet)…");
  r = spawnSync(py, ["-m", "pip", "install", "--quiet", vendor || "imou"], { encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) throw new Error("Cài ImouPkg thất bại: " + (r.stderr || r.stdout || "").slice(0, 400));
  if (!pythonHasImou(py)) throw new Error("Cài xong nhưng import imou vẫn lỗi. Xem lại internet/Python.");
  log("Hoàn tất! Python đã sẵn sàng.");
  return { ok: true, python: py };
}
// ── Bản TỰ CHỨA (bundled): ffmpeg/ffprobe tĩnh + worker đóng gói (PyInstaller)
// nằm trong thư mục bin/ cạnh app → KHÔNG cần cài Python/ffmpeg. Nếu có đủ →
// dùng luôn (double-click là chạy). Thiếu → fallback về python + ffmpeg hệ thống.
function binPath(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const p = path.join(__dirname, "bin", exe);
  return fs.existsSync(p) ? p : null;
}
function bundledWorkerBin() { return binPath("ptlive-worker"); }
function bundledFfmpeg() { return binPath("ffmpeg"); }
function bundledFfprobe() { return binPath("ffprobe"); }
function bundledDhP2p() { return binPath("dh-p2p"); }
function isSelfContained() { return !!(bundledWorkerBin() && bundledFfmpeg()); }

// ── Nguồn đầu thu Dahua/DMSS qua P2P (client-side, KHÔNG dùng VPS làm cầu) ──
// Spawn binary dh-p2p (bin/) mở tunnel P2P tới đầu thu từ xa chỉ bằng serial +
// mật khẩu → RTSP local 127.0.0.1:<port> → dùng như nguồn URL bình thường.
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = require("net").createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// d = { serial, username, password, channel, subtype }. logFd (tuỳ chọn) để ghi
// log tunnel. Trả { proc, port, rtspUrl }. Ném lỗi nếu không Ready.
async function spawnDahuaTunnel(d, logFd) {
  const bin = bundledDhP2p();
  if (!bin) throw new Error("Bản build chưa kèm tunnel Dahua (thiếu bin/dh-p2p). Tải bản mới hơn.");
  const serial = String(d.serial || "").trim();
  const user = String(d.username || "admin").trim();
  const pass = String(d.password || "");
  const channel = Number(d.channel) || 1;
  const subtype = Number(d.subtype) || 0;
  if (!serial || !pass) throw new Error("Cấu hình đầu thu Dahua thiếu serial hoặc mật khẩu.");
  const port = await pickFreePort();
  // DIRECT hole-punch (KHÔNG --relay): relay không có media.
  const args = ["-u", user, "-w", pass, "-p", `127.0.0.1:${port}:554`, serial];
  const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  const ready = await new Promise((resolve) => {
    let done = false;
    const onData = (buf) => {
      const s = buf.toString("utf8");
      if (logFd != null) { try { fs.writeSync(logFd, `[dahua-p2p] ${s}`); } catch {} }
      if (!done && s.includes("Ready to connect")) { done = true; resolve(true); }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", () => { if (!done) { done = true; resolve(false); } });
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 45000);
  });
  if (!ready) {
    try { proc.kill("SIGKILL"); } catch {}
    throw new Error("Không kết nối được đầu thu Dahua qua P2P (đầu thu đang bận phiên khác "
      + "hoặc Dahua cloud rate-limit — thử lại sau vài phút).");
  }
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(pass);
  const rtspUrl = `rtsp://${u}:${p}@127.0.0.1:${port}/cam/realmonitor?channel=${channel}&subtype=${subtype}`;
  return { proc, port, rtspUrl };
}

function detectFfmpeg() {
  for (const cand of [bundledFfmpeg(), process.env.FFMPEG_PATH, "ffmpeg"]) {
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
  const selfContained = isSelfContained();
  const python = selfContained ? null : detectPython();
  const ffmpeg = detectFfmpeg();
  if (!ffmpeg) throw new Error("Chưa cài ffmpeg. Cài ffmpeg rồi thử lại (xem README).");
  if (!selfContained && !python) {
    throw new Error("Chưa cài Python + ImouPkg. Bấm 'Cài đặt tự động' hoặc chạy scripts/setup (xem README).");
  }

  stopPreview(); // bắt đầu live → giải phóng preview đang xem thử (nếu có)

  // 1) Tạo phiên trên backend (runner=client) — backend tạo FB live + overlay.
  const session = await apiFetch(baseUrl, "/api/tournament-auto-live/start", {
    method: "POST", token,
    body: {
      tournamentId: form.tournamentId,
      courtStationId: form.courtStationId,
      imouDeviceId: form.imouDeviceId,
      venueId: form.venueId,
      sourceUrl: form.sourceUrl,
      dahuaP2p: form.dahuaP2p, // { channel, subtype } — creds lấy từ worker-config
      destinations: form.destinations,
      layout: form.layout,
      advanced: form.advanced,
      runner: "client",
    },
  });
  const sid = session._id;

  // 2) Lấy worker-config (session Imou đã giải mã, dests, URLs, token, dahuaP2p creds)
  const cfg = await apiFetch(baseUrl, `/api/tournament-auto-live/${sid}/worker-config`, { token });

  // 3) Thư mục preview HLS + static server
  const previewDir = path.join(os.tmpdir(), `ptlive-preview-${sid}`);
  fs.mkdirSync(previewDir, { recursive: true });
  const previewServer = await startPreviewServer(previewDir);
  const previewPort = previewServer.address().port;

  // 3b) Nguồn đầu thu Dahua P2P: mở tunnel NGAY TRÊN MÁY NÀY (client) → RTSP local.
  // Hoàn toàn tài nguyên client, không qua VPS. Nếu lỗi → dừng sớm, báo rõ.
  let dahuaTunnel = null;
  let dahuaSourceUrl = "";
  if (cfg.dahuaP2p && cfg.dahuaP2p.serial) {
    const tlogFd = fs.openSync(path.join(previewDir, "dahua-tunnel.log"), "a");
    try {
      dahuaTunnel = await spawnDahuaTunnel(cfg.dahuaP2p, tlogFd);
      dahuaSourceUrl = dahuaTunnel.rtspUrl;
    } catch (e) {
      try { fs.closeSync(tlogFd); } catch {}
      try { await apiFetch(baseUrl, `/api/tournament-auto-live/${sid}/stop`, { method: "POST", token }); } catch {}
      try { previewServer.close(); } catch {}
      throw e;
    }
    try { fs.closeSync(tlogFd); } catch {}
  }

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
    AUTOLIVE_IMOU_DEVICE_ID: cfg.imouDeviceId || "",
    // Dahua P2P: dùng RTSP tunnel local (client). Nếu không thì nguồn URL từ backend.
    AUTOLIVE_SOURCE_URL: dahuaSourceUrl || cfg.sourceUrl || "",
    AUTOLIVE_DESTINATIONS: JSON.stringify(cfg.destinations || []),
    AUTOLIVE_ENCODER: form.encoder || "auto",
    AUTOLIVE_PREVIEW_HLS_DIR: previewDir,
    AUTOLIVE_RUNNER_LABEL: form.runnerLabel || os.hostname(),
    FFMPEG_PATH: ffmpeg,
    // Bản tự chứa: prepend bin/ vào PATH để worker gọi bare "ffmpeg"/"ffprobe"
    // trúng binary tĩnh đóng gói (không cần cài hệ thống).
    ...(selfContained
      ? { PATH: `${path.join(__dirname, "bin")}${path.delimiter}${process.env.PATH || ""}` }
      : {}),
    // Cấu hình nâng cao (backend trả về từ session.advanced) — bitrate, res, fps…
    ...(cfg.advancedEnv || {}),
  };
  const logFile = path.join(previewDir, "worker.log");
  const logFd = fs.openSync(logFile, "a");
  // Tự chứa → spawn binary worker đã đóng gói (không cần Python); ngược lại
  // spawn python worker.py.
  const proc = selfContained
    ? spawn(bundledWorkerBin(), [], { env, stdio: ["ignore", logFd, logFd] })
    : spawn(python, [workerScriptPath()], { env, stdio: ["ignore", logFd, logFd] });
  running.set(sid, { proc, previewDir, previewServer, previewPort, cfg, logFile, dahuaTunnel });

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
  // Đóng tunnel Dahua P2P đi kèm phiên này (nếu có) → nhả phiên P2P cho đầu thu.
  if (r.dahuaTunnel?.proc) {
    try { r.dahuaTunnel.proc.kill("SIGTERM"); } catch {}
    const tp = r.dahuaTunnel.proc;
    setTimeout(() => { try { tp.kill("SIGKILL"); } catch {} }, 4000);
  }
  running.delete(sid);
}

function stopWorker(sid) {
  const r = running.get(sid);
  if (!r) return;
  try { r.proc.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { r.proc.kill("SIGKILL"); } catch {} }, 5000);
  cleanupWorker(sid);
}

// ───────────────────────── Xem thử nguồn (preview trước khi live) ─────────
// Chạy worker.py ở chế độ AUTOLIVE_PREVIEW_ONLY: chỉ đọc nguồn (RTSP/m3u8/RTMP/
// HTTP hoặc Imou DHAV) → xuất HLS cục bộ, KHÔNG overlay/heartbeat/đích FB-YT.
async function startPreview({ baseUrl, token, source, destinations, overlayUrl }) {
  const selfContained = isSelfContained();
  const python = selfContained ? null : detectPython();
  const ffmpeg = detectFfmpeg();
  if (!ffmpeg) throw new Error("Chưa cài ffmpeg. Cài ffmpeg rồi thử lại (xem README).");
  if (!selfContained && !python) {
    throw new Error("Chưa cài Python + ImouPkg. Bấm 'Cài đặt tự động' hoặc chạy scripts/setup (xem README).");
  }

  stopPreview(); // chỉ 1 preview 1 lúc

  // Nguồn → env cho worker
  const srcEnv = {};
  if (source?.kind === "url") {
    const u = String(source.sourceUrl || "").trim();
    if (!u) throw new Error("Nhập link nguồn (m3u8 / RTSP / RTMP).");
    srcEnv.AUTOLIVE_SOURCE_URL = u;
  } else if (source?.kind === "imou") {
    if (!source.imouDeviceId) throw new Error("Chọn camera Imou.");
    // Lấy session Imou đã giải mã của cam (như app iOS/Android).
    const r = await apiFetch(
      baseUrl,
      `/api/tournament-auto-live/court-imou-session?imouDeviceId=${encodeURIComponent(source.imouDeviceId)}`,
      { token }
    );
    const s = r?.imouSession || null; // camelCase từ backend → snake_case cho imou-pkg
    srcEnv.AUTOLIVE_IMOU_DEVICE_ID = source.imouDeviceId;
    srcEnv.AUTOLIVE_IMOU_SESSION_JSON = s ? JSON.stringify({
      uuid_user: s.uuidUser, uuid_key: s.uuidKey,
      session_id: s.sessionId, regional_host: s.regionalHost,
    }) : "";
    srcEnv.AUTOLIVE_IMOU_PHONE = r?.imouCreds?.phone || "";
    srcEnv.AUTOLIVE_IMOU_PASSWORD = r?.imouCreds?.password || "";
    srcEnv.AUTOLIVE_IMOU_AREA_CODE = r?.imouCreds?.areaCode || "84";
  } else {
    throw new Error("Nguồn xem thử không hợp lệ.");
  }

  const previewId = `preview-${Date.now()}`;
  const dir = path.join(os.tmpdir(), `ptlive-${previewId}`);
  fs.mkdirSync(dir, { recursive: true });
  const server = await startPreviewServer(dir);
  const port = server.address().port;

  const env = {
    ...process.env,
    PICKLETOUR_PYTHON: undefined,
    AUTOLIVE_PREVIEW_ONLY: "1",
    AUTOLIVE_SESSION_ID: previewId,
    AUTOLIVE_PREVIEW_HLS_DIR: dir,
    AUTOLIVE_ENCODER: source.encoder || "auto",
    // Rỗng = chỉ xem thử; có đích RTMP = live thẳng (không qua server pickletour).
    AUTOLIVE_DESTINATIONS: JSON.stringify(Array.isArray(destinations) ? destinations : []),
    // Trận ngẫu nhiên: overlay bảng điểm PNG từ backend (userMatch).
    ...(overlayUrl ? { AUTOLIVE_OVERLAY_URL: overlayUrl } : {}),
    FFMPEG_PATH: ffmpeg,
    ...srcEnv,
    ...(selfContained
      ? { PATH: `${path.join(__dirname, "bin")}${path.delimiter}${process.env.PATH || ""}` }
      : {}),
  };
  const logFile = path.join(dir, "preview.log");
  lastPreviewLog = logFile;
  const logFd = fs.openSync(logFile, "a");
  const proc = selfContained
    ? spawn(bundledWorkerBin(), [], { env, stdio: ["ignore", logFd, logFd] })
    : spawn(python, [workerScriptPath()], { env, stdio: ["ignore", logFd, logFd] });
  previewState = { proc, dir, server, logFile };
  proc.on("exit", (code) => {
    sendToRenderer("preview-exit", { code, log: tailFile(logFile) });
  });

  return { previewUrl: `http://127.0.0.1:${port}/index.m3u8`, logFile };
}

function stopPreview() {
  const p = previewState;
  previewState = null;
  if (!p) return;
  try { p.proc.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { p.proc.kill("SIGKILL"); } catch {} }, 4000);
  try { p.server?.close(); } catch {}
}

function sendToRenderer(channel, payload) {
  try { win?.webContents.send(channel, payload); } catch {}
}

// ───────────────────────── IPC ───────────────────────────────────────────
ipcMain.handle("env-check", () => {
  const selfContained = isSelfContained();
  const ffmpeg = detectFfmpeg();
  // Tự chứa → coi như Python "sẵn sàng" (không cần); ngược lại dò python hệ thống.
  const python = selfContained ? true : !!detectPython();
  return {
    ffmpeg: !!ffmpeg, python,
    selfContained,
    // Có thể tự setup Python trong app (đã có base python 3.10+ nhưng thiếu imou)?
    canAutoSetupPython: !selfContained && !python && !!detectBasePython(),
    encoders: ffmpeg ? detectEncoders(ffmpeg) : [],
    hostname: os.hostname(), platform: `${os.type()} ${os.arch()}`,
  };
});

// Tự setup Python (venv + Imou) — gọi từ nút "Cài đặt tự động" ở renderer.
ipcMain.handle("setup-python", async () => {
  return ensurePythonSetup((m) => { try { win?.webContents.send("setup-progress", m); } catch {} });
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
ipcMain.handle("preview-start", async (_e, args) => startPreview({ ...args, destinations: [] }));
ipcMain.handle("preview-stop", () => { stopPreview(); return { ok: true }; });
// Live THẲNG tới RTMP (không qua server pickletour): như preview nhưng có đích RTMP.
ipcMain.handle("direct-start", async (_e, args) => startPreview(args));
ipcMain.handle("direct-stop", () => { stopPreview(); return { ok: true }; });

// Trận NGẪU NHIÊN (standalone, không thuộc giải): tạo UserMatch (tên trận + tên
// VĐV 2 đội) → live thẳng RTMP kèm overlay bảng điểm. Chấm điểm qua referee API.
let randomMatchId = null;
ipcMain.handle("random-start", async (_e, { baseUrl, token, source, destinations, title, teamA, teamB }) => {
  const participants = [];
  const push = (side, order, name) => {
    const n = String(name || "").trim();
    if (n) participants.push({ side, order, displayName: n });
  };
  push("A", 1, teamA?.[0]); push("A", 2, teamA?.[1]);
  push("B", 1, teamB?.[0]); push("B", 2, teamB?.[1]);
  if (participants.length < 2) throw new Error("Nhập tối thiểu 1 VĐV mỗi đội.");
  // 1) Tạo UserMatch trên backend (chỉ để có id + overlay + nơi chấm điểm).
  const match = await apiFetch(baseUrl, "/api/user-matches", {
    method: "POST", token,
    body: { title: String(title || "").trim() || "Trận giao hữu", participants, sportType: "pickleball" },
  });
  const matchId = match?._id || match?.id;
  if (!matchId) throw new Error("Không tạo được trận (UserMatch).");
  randomMatchId = String(matchId);
  // 2) Live thẳng RTMP + overlay bảng điểm PNG (userMatch).
  const overlayUrl = `${baseUrl.replace(/\/$/, "")}/api/tournament-auto-live/overlay/usermatch/${matchId}.png`;
  const res = await startPreview({ baseUrl, token, source, destinations, overlayUrl });
  return { ...res, matchId: randomMatchId };
});
ipcMain.handle("random-stop", () => { stopPreview(); randomMatchId = null; return { ok: true }; });
// Chấm điểm trận ngẫu nhiên: PATCH referee (header user-match). side A/B, delta ±1.
ipcMain.handle("match-score", async (_e, { baseUrl, token, matchId, side, delta }) => {
  const id = matchId || randomMatchId;
  if (!id) throw new Error("Chưa có trận đang live.");
  return apiFetch(baseUrl, `/api/referee/matches/${id}/score`, {
    method: "PATCH", token,
    headers: { "x-pkt-match-kind": "user" },
    body: { op: "inc", side, delta: Number(delta) || 1 },
  });
});
ipcMain.handle("preview-log", () => ({ log: lastPreviewLog ? tailFile(lastPreviewLog) : "" }));
ipcMain.handle("preview-openlog", () => { if (lastPreviewLog) shell.openPath(lastPreviewLog); });
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
