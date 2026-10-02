// PickleTour Live — Electron main process.
// Đăng nhập admin → chọn giải/sân/cam → tạo phiên runner:"client" trên backend
// → lấy worker-config → spawn worker.py (GPU) local → preview HLS.
const { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

let win;
// sessionId → { proc, previewDir, previewServer, previewPort, cfg }
const running = new Map();

// ── Cấu hình app (lưu ở userData/settings.json) ──
function settingsPath() {
  try { return path.join(app.getPath("userData"), "settings.json"); } catch { return null; }
}
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")) || {}; } catch { return {}; }
}
function writeSettings(patch) {
  try {
    const cur = readSettings();
    const next = { ...cur, ...patch };
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
    return next;
  } catch (e) { console.error("[settings] write fail", e?.message || e); return readSettings(); }
}

// Thư mục mặc định lưu record/segment/clip: CÙNG chỗ file .exe (bản đóng gói) →
// <thư mục app>/records; bản dev → <cwd>/records. Người dùng đổi được (settings).
function defaultRecordsDir() {
  let base;
  if (app.isPackaged) {
    try { base = path.dirname(app.getPath("exe")); } catch { base = process.cwd(); }
  } else {
    base = process.cwd();
  }
  return path.join(base, "records");
}
function recordsBaseDir() {
  const custom = (readSettings().recordsDir || "").trim();
  const dir = custom || defaultRecordsDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
// perMatchLive (client): sid → poll timer chờ trận bắt đầu để start/stop ffmpeg.
const armedPolls = new Map();
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
    icon: path.join(__dirname, "renderer", "assets", "logo.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  // Resume đẩy segment recording còn sót (nếu app từng tắt giữa chừng).
  setTimeout(() => { try { resumePendingUploaders(); } catch (e) { console.error("[rec-upload] resume fail", e?.message || e); } }, 6000);
  // Tự bật điều khiển từ xa nếu lần trước đã bật.
  try { if (readSettings().controlEnabled) startControlServer(); } catch (e) { console.error("[control] auto-start fail", e?.message || e); }
  // Tự dọn records đã xử lý (tránh đầy ổ cứng).
  try { startRecordsCleanup(); } catch (e) { console.error("[cleanup] start fail", e?.message || e); }
  // Khôi phục các lịch hẹn giờ live còn hiệu lực (app từng tắt/mở lại).
  try { restoreSchedules(); } catch (e) { console.error("[schedule] restore fail", e?.message || e); }
});
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

function dahuaChannelUrl(port, user, pass, channel, subtype) {
  const u = encodeURIComponent(user || "admin");
  const p = encodeURIComponent(pass || "");
  return `rtsp://${u}:${p}@127.0.0.1:${port}/cam/realmonitor?channel=${channel || 1}&subtype=${subtype || 0}`;
}

// Spawn tiến trình tunnel cho 1 serial, chờ "Ready". Trả { proc, port }.
async function spawnDahuaTunnelProc(serial, user, pass, logFd) {
  const bin = bundledDhP2p();
  if (!bin) throw new Error("Bản build chưa kèm tunnel Dahua (thiếu bin/dh-p2p). Tải bản mới hơn.");
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
      + "hoặc Dahua cloud rate-limit — thử lại sau).");
  }
  return { proc, port };
}

// ── Quản lý tunnel DÙNG CHUNG theo serial (cư xử giống DMSS) ────────────────
// 1 phiên P2P/đầu thu, tái dùng cho nhiều court trên MÁY NÀY; LINGER giữ phiên
// sau khi court cuối dừng (start lại nhanh → tái dùng, không mở phiên mới);
// BACKOFF khi lỗi để không kết nối dồn dập (thứ nuôi rate-limit).
const dahuaTunnels = new Map(); // serial -> { proc, port, user, pass, refs:Set, lingerTimer }
const dahuaBackoff = new Map(); // serial -> nextAttemptAt(ms)
const DAHUA_LINGER_MS = 90000;

// d = { serial, username, password, channel, subtype }. Trả rtspUrl kênh yêu cầu.
async function acquireDahuaTunnel(sid, d, logFd) {
  const serial = String(d.serial || "").trim();
  const user = String(d.username || "admin").trim();
  const pass = String(d.password || "");
  if (!serial || !pass) throw new Error("Cấu hình đầu thu Dahua thiếu serial hoặc mật khẩu.");

  let t = dahuaTunnels.get(serial);
  if (t && t.proc && !t.proc.killed) {
    if (t.lingerTimer) { clearTimeout(t.lingerTimer); t.lingerTimer = null; } // huỷ linger → tái dùng
    t.refs.add(sid);
    return dahuaChannelUrl(t.port, t.user, t.pass, d.channel, d.subtype);
  }
  const wait = (dahuaBackoff.get(serial) || 0) - Date.now();
  if (wait > 0) {
    throw new Error(`Đầu thu đang tạm bị Dahua giới hạn — thử lại sau ~${Math.ceil(wait / 1000)}s.`);
  }
  let spawned;
  try {
    spawned = await spawnDahuaTunnelProc(serial, user, pass, logFd);
  } catch (e) {
    const fails = ((dahuaBackoff.get(serial + ":f") || 0) + 1);
    dahuaBackoff.set(serial + ":f", fails);
    dahuaBackoff.set(serial, Date.now() + Math.min(300000, 15000 * 2 ** (fails - 1)));
    throw e;
  }
  dahuaBackoff.delete(serial); dahuaBackoff.delete(serial + ":f");
  t = { proc: spawned.proc, port: spawned.port, user, pass, refs: new Set([sid]), lingerTimer: null };
  // Tunnel chết ngoài ý muốn → xoá khỏi map để lần sau spawn lại.
  spawned.proc.on("exit", () => { if (dahuaTunnels.get(serial) === t) dahuaTunnels.delete(serial); });
  dahuaTunnels.set(serial, t);
  return dahuaChannelUrl(t.port, user, pass, d.channel, d.subtype);
}

function releaseDahuaTunnel(sid) {
  for (const [serial, t] of dahuaTunnels) {
    if (!t.refs.has(sid)) continue;
    t.refs.delete(sid);
    if (t.refs.size === 0 && !t.lingerTimer) {
      // LINGER: giữ phiên thêm 1 lúc rồi mới kill (tái dùng nếu start lại nhanh).
      t.lingerTimer = setTimeout(() => {
        if (t.refs.size === 0) {
          try { t.proc.kill("SIGTERM"); } catch {}
          const p = t.proc;
          setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 4000);
          dahuaTunnels.delete(serial);
        }
      }, DAHUA_LINGER_MS);
    }
  }
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

// Browser overlay (client): render 1 trang web TRANSPARENT bằng offscreen
// BrowserWindow → PNG có alpha → phục vụ qua TCP cho ffmpeg image2pipe (lớp
// overlay DƯỚI scoreboard native). Trả { port, close() }.
async function startBrowserOverlay(url) {
  const net = require("net");
  const fps = 2;
  const win = new BrowserWindow({
    width: 1920, height: 1080, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try { win.webContents.setFrameRate(fps); } catch {}
  let lastPng = null;
  win.webContents.on("paint", (_e, _dirty, image) => {
    try { lastPng = image.toPNG(); } catch {}
  });
  win.loadURL(url).catch((e) => console.error("[browser-overlay] loadURL fail:", e?.message || e));
  const server = net.createServer((sock) => {
    const iv = setInterval(() => {
      if (lastPng) { try { sock.write(lastPng); } catch {} }
    }, Math.round(1000 / fps));
    const done = () => clearInterval(iv);
    sock.on("close", done); sock.on("error", done);
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  console.log(`[browser-overlay] render ${url} → tcp://127.0.0.1:${port}`);
  return {
    port,
    close() {
      try { server.close(); } catch {}
      try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
    },
  };
}

// ───────────────────── Recording clip: đẩy segment về server ──────────────
// worker.py ghi segment TS vào previewDir/rec (rec-<epoch>-<idx>.ts). Uploader này
// poll server (khung giờ đêm) rồi PUT từng segment CHƯA có lên server. Sống lâu hơn
// worker: sau khi phiên dừng vẫn upload nốt rồi tự dọn + tắt.
const uploaders = new Map(); // sid -> { timer }
const REC_NAME_RE = /^rec-\d+-\d+\.ts$/;

function putFileStream(urlStr, token, filePath) {
  return new Promise((resolve, reject) => {
    let stat;
    try { stat = fs.statSync(filePath); } catch (e) { return reject(e); }
    let u; try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search, method: "POST",
        headers: { "x-worker-token": token || "", "content-type": "application/octet-stream", "content-length": stat.size },
      },
      (res) => {
        let body = ""; res.on("data", (c) => (body += c));
        res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300)
          ? resolve(body) : reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
      }
    );
    req.on("error", reject);
    fs.createReadStream(filePath).on("error", reject).pipe(req);
  });
}

async function fetchRecordingPlan(cfg, sid) {
  const res = await fetch(`${cfg.recordingPlanUrl}?sessionId=${sid}`, {
    headers: { "x-worker-token": cfg.workerToken || "" },
  });
  if (!res.ok) throw new Error(`plan HTTP ${res.status}`);
  return res.json();
}

// PUT 1 file lên URL bất kỳ (presigned R2) — KHÔNG gắn worker token (R2 ký sẵn trong URL).
function putToUrl(urlStr, filePath, contentType) {
  return new Promise((resolve, reject) => {
    let stat; try { stat = fs.statSync(filePath); } catch (e) { return reject(e); }
    let u; try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "PUT",
      headers: { "content-type": contentType || "application/octet-stream", "content-length": stat.size },
    }, (res) => {
      let body = ""; res.on("data", (c) => (body += c));
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300)
        ? resolve(body) : reject(new Error(`R2 PUT HTTP ${res.statusCode}: ${body.slice(0, 160)}`)));
    });
    req.on("error", reject);
    fs.createReadStream(filePath).on("error", reject).pipe(req);
  });
}

// POST JSON có worker token (xin presign / báo hoàn tất).
async function postJsonWorker(urlStr, token, obj) {
  const res = await fetch(urlStr, {
    method: "POST",
    headers: { "x-worker-token": token || "", "content-type": "application/json" },
    body: JSON.stringify(obj || {}),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 160)}`);
  try { return JSON.parse(txt); } catch { return {}; }
}

// Probe thời lượng (ms) segment bằng ffmpeg (parse "Duration:") — desktop có sẵn file local.
function probeSegmentDurationMs(filePath) {
  return new Promise((resolve) => {
    const ff = detectFfmpeg();
    if (!ff) return resolve(0);
    const child = spawn(ff, ["-hide_banner", "-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      if (!m) return resolve(0);
      resolve(Math.round(((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])) * 1000));
    });
  });
}

// Đẩy 1 segment THẲNG lên Cloudflare R2 (presign → PUT R2 → báo hoàn tất). Không qua đĩa VPS.
async function uploadSegmentToR2(cfg, sid, name, filePath) {
  const base = cfg.recordingSegmentUrl; // .../internal/recording/segment
  const token = cfg.workerToken || "";
  const pre = await postJsonWorker(`${base}-presign?sessionId=${sid}&file=${encodeURIComponent(name)}`, token, {});
  if (!pre?.uploadUrl) throw new Error("presign thiếu uploadUrl");
  await putToUrl(pre.uploadUrl, filePath, pre.contentType || "video/mp2t");
  let bytes = 0; try { bytes = fs.statSync(filePath).size; } catch {}
  const durMs = await probeSegmentDurationMs(filePath);
  await postJsonWorker(`${base}-complete?sessionId=${sid}`, token, {
    file: name, objectKey: pre.objectKey, storageTargetId: pre.storageTargetId,
    bucketName: pre.bucketName, durMs, bytes,
  });
}

function startSegmentUploader({ sid, cfg, previewDir }) {
  if (!cfg.recordClips || !cfg.recordingPlanUrl || !cfg.recordingSegmentUrl) return;
  if (uploaders.has(sid)) return;
  const recDir = path.join(previewDir, "rec");
  const token = cfg.workerToken || "";
  const uploaded = new Set();
  let busy = false;

  // Sidecar để RESUME sau khi app khởi động lại (đẩy nốt segment còn sót).
  try {
    fs.mkdirSync(recDir, { recursive: true });
    fs.writeFileSync(path.join(recDir, "upload.json"), JSON.stringify({
      sessionId: sid, workerToken: token,
      recordingPlanUrl: cfg.recordingPlanUrl, recordingSegmentUrl: cfg.recordingSegmentUrl,
    }));
  } catch {}

  let lastHave = [];
  // Đếm độc lập với đĩa (vì segment đã đẩy sẽ bị xoá local ngay để tiết kiệm ổ máy live).
  const seen = new Set();
  const emit = (extra = {}) => {
    try { fs.readdirSync(recDir).filter((n) => REC_NAME_RE.test(n)).forEach((n) => seen.add(n)); } catch {}
    for (const n of lastHave) seen.add(n);
    const serverHas = new Set([...lastHave, ...uploaded]);
    sendToRenderer("rec-upload", {
      sessionId: sid,
      total: seen.size,
      uploaded: [...seen].filter((n) => serverHas.has(n)).length,
      recording: running.has(sid),
      ...extra,
    });
  };
  emit({ uploading: false }); // báo ngay: đã bật ghi clip

  const tick = async () => {
    if (busy) return; busy = true;
    try {
      let files = [];
      try { files = fs.readdirSync(recDir).filter((n) => REC_NAME_RE.test(n)); } catch { files = []; }
      files.sort((a, b) => {
        try { return fs.statSync(path.join(recDir, a)).mtimeMs - fs.statSync(path.join(recDir, b)).mtimeMs; }
        catch { return 0; }
      });
      const workerRunning = running.has(sid);
      let plan = null;
      try { plan = await fetchRecordingPlan(cfg, sid); } catch { plan = null; }
      lastHave = plan?.have || lastHave;
      const have = new Set([...(plan?.have || []), ...uploaded]);
      let candidates = files.filter((n) => !have.has(n));
      // Giữ lại file MỚI NHẤT khi worker còn chạy (đang ghi dở → chưa hoàn tất).
      if (workerRunning && candidates.length) candidates = candidates.slice(0, -1);
      if (plan?.uploadNow && candidates.length) {
        emit({ uploading: true });
        for (const n of candidates) {
          try {
            if (plan?.r2Direct) {
              // Bản mới: đẩy THẲNG lên R2 (không tốn đĩa/băng thông VPS).
              await uploadSegmentToR2(cfg, sid, n, path.join(recDir, n));
            } else {
              // Fallback: POST về VPS (server tự relay lên R2 hoặc lưu đĩa nếu R2 chưa cấu hình).
              await putFileStream(`${cfg.recordingSegmentUrl}?sessionId=${sid}&file=${encodeURIComponent(n)}`, token, path.join(recDir, n));
            }
            uploaded.add(n);
            // Đã lên R2/server → xoá file segment local ngay để không đầy ổ máy live.
            try { fs.unlinkSync(path.join(recDir, n)); } catch {}
            console.log(`[rec-upload] ${sid} đã gửi ${n}${plan?.r2Direct ? " (R2)" : ""}`);
            emit({ uploading: true }); // cập nhật tiến độ sau mỗi segment
          } catch (e) { console.error(`[rec-upload] ${sid} lỗi ${n}:`, e?.message || e); break; }
        }
      }
      // Dừng + dọn khi worker đã tắt và mọi segment đã lên server.
      if (!workerRunning) {
        const serverHas = new Set([...(plan?.have || []), ...uploaded]);
        const remaining = files.filter((n) => !serverHas.has(n));
        if (remaining.length === 0) {
          const h = uploaders.get(sid); if (h?.timer) clearInterval(h.timer);
          uploaders.delete(sid);
          emit({ uploading: false, done: true });
          // Đã đẩy hết segment về server (server → Drive) + worker đã tắt → dọn TOÀN BỘ
          // thư mục phiên (segment + preview HLS + log) để không đầy ổ cứng.
          try { fs.rmSync(previewDir, { recursive: true, force: true }); } catch { try { fs.rmSync(recDir, { recursive: true, force: true }); } catch {} }
          console.log(`[rec-upload] ${sid} hoàn tất — đã dọn toàn bộ dữ liệu records của phiên.`);
          return;
        }
      }
      emit({ uploading: false });
    } finally { busy = false; }
  };

  const timer = setInterval(() => { tick().catch(() => {}); }, 60_000);
  uploaders.set(sid, { timer });
  setTimeout(() => { tick().catch(() => {}); }, 5_000); // thử sớm 1 lần
  console.log(`[rec-upload] ${sid} uploader chạy (poll 60s, đẩy real-time).`);
}

/** Khi mở lại app: quét các phiên còn segment chưa đẩy → tự đẩy nốt (resume). Cứu
 *  trường hợp máy lỡ tắt/khởi động lại giữa chừng — server vẫn cắt+upload Drive. */
function resumePendingUploaders() {
  let base;
  try { base = recordsBaseDir(); } catch { return; }
  let entries = [];
  try { entries = fs.readdirSync(base).filter((n) => n.startsWith("ptlive-preview-")); } catch { return; }
  for (const dirName of entries) {
    const previewDir = path.join(base, dirName);
    const recDir = path.join(previewDir, "rec");
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(recDir, "upload.json"), "utf8")); } catch { continue; }
    let hasTs = false;
    try { hasTs = fs.readdirSync(recDir).some((n) => REC_NAME_RE.test(n)); } catch {}
    if (!hasTs) continue; // đã đẩy hết + dọn → bỏ qua
    const sid = meta.sessionId;
    if (!sid || uploaders.has(sid) || running.has(sid)) continue;
    if (!meta.recordingPlanUrl || !meta.recordingSegmentUrl) continue;
    console.log(`[rec-upload] resume phiên ${sid} (còn segment chưa đẩy).`);
    startSegmentUploader({
      sid, previewDir,
      cfg: {
        recordClips: true, workerToken: meta.workerToken,
        recordingPlanUrl: meta.recordingPlanUrl, recordingSegmentUrl: meta.recordingSegmentUrl,
      },
    });
  }
}

// Tự dọn dữ liệu records ĐÃ XỬ LÝ để tránh đầy ổ cứng. Xoá thư mục phiên
// (ptlive-preview-<sid>) khi: (1) KHÔNG còn worker chạy + KHÔNG còn uploader,
// (2) không còn segment .ts chưa đẩy (đã lên server → Drive; hoặc live không ghi),
// (3) đủ cũ (an toàn, tránh xoá phiên vừa xong). Quét định kỳ + lúc mở app.
let _cleanupTimer = null;
function cleanupProcessedRecords() {
  let base; try { base = recordsBaseDir(); } catch { return; }
  let entries = []; try { entries = fs.readdirSync(base); } catch { return; }
  const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 giờ
  for (const name of entries) {
    if (!name.startsWith("ptlive-preview-")) continue;
    const sid = name.slice("ptlive-preview-".length);
    if (running.has(sid) || uploaders.has(sid)) continue; // đang chạy / đang đẩy → giữ
    const dir = path.join(base, name);
    const recDir = path.join(dir, "rec");
    // Còn segment .ts chưa đẩy → giữ (resume/uploader sẽ xử lý sau).
    let pendingTs = false;
    try { pendingTs = fs.readdirSync(recDir).some((n) => REC_NAME_RE.test(n)); } catch {}
    if (pendingTs) continue;
    // Đủ cũ chưa (theo mtime) để chắc chắn không phải phiên vừa kết thúc.
    let mtime = 0; try { mtime = fs.statSync(dir).mtimeMs; } catch {}
    if (Date.now() - mtime < MAX_AGE_MS) continue;
    try { fs.rmSync(dir, { recursive: true, force: true }); console.log(`[cleanup] đã xoá records đã xử lý: ${name}`); } catch {}
  }
}
function startRecordsCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => { try { cleanupProcessedRecords(); } catch (e) { console.error("[cleanup] lỗi", e?.message || e); } }, 30 * 60 * 1000);
  if (_cleanupTimer.unref) _cleanupTimer.unref();
  setTimeout(() => { try { cleanupProcessedRecords(); } catch {} }, 20_000); // quét sớm sau khi mở app
}

// ───────────────────────── Ẩn ngày/giờ camera (delogo) ───────────────────
// Chuyển cấu hình che OSD từ form (UI) → env cho worker. form.hideTimestamp bật
// tính năng; form.delogoBox {x,y,w,h} (toạ độ theo khung ĐÍCH 1920x1080) tuỳ chỉnh.
// Bỏ trống box → worker dùng mặc định (góc trên-phải, vị trí OSD Dahua phổ biến).
function delogoEnv(form) {
  if (!form || !form.hideTimestamp) return { AUTOLIVE_DELOGO: "" };
  const env = { AUTOLIVE_DELOGO: "1" };
  const b = form.delogoBox || {};
  const num = (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v))) : undefined);
  if (num(b.x) != null) env.AUTOLIVE_DELOGO_X = num(b.x);
  if (num(b.y) != null) env.AUTOLIVE_DELOGO_Y = num(b.y);
  if (num(b.w) != null) env.AUTOLIVE_DELOGO_W = num(b.w);
  if (num(b.h) != null) env.AUTOLIVE_DELOGO_H = num(b.h);
  return env;
}

// ───────────────────────── Hẹn giờ bắt đầu live ──────────────────────────
// Đặt lịch tự bắt đầu một sân vào thời điểm định trước (vd 07:00 ngày 03/10). Lưu
// vào settings.json → app khởi động lại vẫn còn lịch. Máy vừa bật mà đã quá giờ
// trong khoảng ân hạn (≤6h) thì bắt đầu ngay. Giữ máy không ngủ khi còn lịch chờ
// (powerSaveBlocker). Lưu ý: token đăng nhập được lưu theo lịch — nếu để quá lâu
// token có thể hết hạn, khi đó fire sẽ báo lỗi (đăng nhập lại rồi đặt lịch mới).
const scheduledJobs = new Map(); // id -> { id, startAt, args, label, timer }
let powerBlockerId = null;
const SCHEDULE_GRACE_MS = 6 * 3600 * 1000;
const TIMEOUT_MAX = 2 ** 31 - 1;

function ensurePowerBlocker() {
  if (powerBlockerId == null && scheduledJobs.size > 0) {
    try { powerBlockerId = powerSaveBlocker.start("prevent-app-suspension"); }
    catch (e) { console.error("[schedule] powerSaveBlocker fail", e?.message || e); }
  }
}
function releasePowerBlockerIfIdle() {
  if (powerBlockerId != null && scheduledJobs.size === 0) {
    try { powerSaveBlocker.stop(powerBlockerId); } catch {}
    powerBlockerId = null;
  }
}
function persistSchedules() {
  const list = [...scheduledJobs.values()].map((j) => ({
    id: j.id, startAt: j.startAt, args: j.args, label: j.label, meta: j.meta || {},
  }));
  writeSettings({ schedules: list });
}
function scheduleSummary() {
  return [...scheduledJobs.values()]
    .map((j) => ({ id: j.id, startAt: j.startAt, label: j.label, meta: j.meta || {}, title: j.args?.form?.title || "" }))
    .sort((a, b) => a.startAt - b.startAt);
}
async function fireSchedule(job) {
  if (job.timer) { try { clearTimeout(job.timer); } catch {} }
  scheduledJobs.delete(job.id);
  persistSchedules();
  releasePowerBlockerIfIdle();
  sendToRenderer("schedule-fired", { id: job.id, label: job.label, meta: job.meta || {} });
  try {
    const r = await startWorker(job.args);
    // Gửi kèm form + meta để renderer đăng ký phiên vào dashboard (tên giải/sân, title…).
    sendToRenderer("schedule-started", {
      id: job.id, label: job.label, meta: job.meta || {}, form: job.args?.form || null, result: r,
    });
  } catch (e) {
    sendToRenderer("schedule-error", { id: job.id, label: job.label, meta: job.meta || {}, message: e?.message || String(e) });
  }
}
function armSchedule(job, { persist = true } = {}) {
  const delay = job.startAt - Date.now();
  if (delay <= 0) {
    if (delay > -SCHEDULE_GRACE_MS) { void fireSchedule(job); }
    else { scheduledJobs.delete(job.id); if (persist) persistSchedules(); } // quá lâu → bỏ
    return;
  }
  scheduledJobs.set(job.id, job);
  // setTimeout tối đa ~24.8 ngày → chia nhỏ nếu xa hơn.
  job.timer = setTimeout(
    delay > TIMEOUT_MAX ? () => armSchedule(job, { persist: false }) : () => fireSchedule(job),
    Math.min(delay, TIMEOUT_MAX)
  );
  ensurePowerBlocker();
  if (persist) persistSchedules();
}
function restoreSchedules() {
  const list = readSettings().schedules;
  if (!Array.isArray(list)) return;
  for (const j of list) {
    if (!j || !j.id || !Number(j.startAt) || !j.args) continue;
    armSchedule({ id: j.id, startAt: Number(j.startAt), args: j.args, label: j.label || "", meta: j.meta || {} }, { persist: false });
  }
  persistSchedules(); // ghi lại sau khi lọc lịch quá hạn
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

  // 1) Tạo phiên trên backend (runner=client) — backend tạo FB live + overlay
  //    (perMatchLive: backend TẠO SAU khi trận bắt đầu; giờ trả session "paused").
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
      perMatchLive: !!form.perMatchLive,
      splitPerTournament: !!form.splitPerTournament, // tách live theo giải (đổi giải → live mới)
      title: form.title || "",
      recordClips: !!form.recordClips, // ghi + cắt clip từng trận lên Drive (live xuyên suốt)
      // Che ngày/giờ camera bằng overlay-box (bật/tắt được NGAY khi đang live, mỗi sân riêng).
      hideTimestamp: !!form.hideTimestamp,
      delogoBox: form.delogoBox || undefined,
      runner: "client",
      // ID máy này → backend cho phép NHIỀU luồng/sân (mỗi máy 1 luồng), chỉ dọn
      // luồng cũ trên CÙNG máy+sân thay vì stop luồng của máy khác.
      machineId: machineId(),
      overlayStyle: form.overlayStyle || "", // classic | A | B | C | D (PNG bỏ scoreboard nếu browser)
    },
  });
  const sid = session._id;

  // perMatch / split: CHƯA live — backend đặt status="live"/"paused" theo trận/giải;
  // app desktop tự start/stop ffmpeg theo status (armPerMatch dùng chung cho cả 2).
  if (form.perMatchLive || form.splitPerTournament) {
    armPerMatch({ baseUrl, token, form, sid });
    return { sessionId: sid, perMatchArmed: true, watchUrls: [] };
  }

  return await startFfmpegForSession({ baseUrl, token, form, sid });
}

/** Chờ trận bắt đầu (perMatchLive client): poll status → start/stop ffmpeg theo trận. */
function armPerMatch({ baseUrl, token, form, sid }) {
  if (armedPolls.has(sid)) return;
  const timer = setInterval(async () => {
    let s;
    try { s = await apiFetch(baseUrl, `/api/tournament-auto-live/${sid}`, { token }); }
    catch { return; }
    const st = s?.status;
    const streaming = running.has(sid);
    if (st === "live" && !streaming) {
      try {
        const r = await startFfmpegForSession({ baseUrl, token, form, sid });
        sendToRenderer("per-match", { kind: "live", sessionId: sid, ...r });
      } catch (e) { sendToRenderer("per-match", { kind: "error", sessionId: sid, message: e?.message || String(e) }); }
    } else if (st === "paused" && streaming) {
      cleanupWorker(sid); // dừng ffmpeg trận vừa xong, giữ armed chờ trận kế
      sendToRenderer("per-match", { kind: "paused", sessionId: sid });
    } else if (st === "stopped" || st === "error") {
      clearInterval(timer); armedPolls.delete(sid);
      if (running.has(sid)) cleanupWorker(sid);
      sendToRenderer("per-match", { kind: "ended", sessionId: sid, status: st, error: s?.lastError || "" });
    }
  }, 4000);
  armedPolls.set(sid, timer);
}

/** Lấy worker-config → tunnel (nếu Dahua) → spawn worker.py (GPU) + preview cho 1 phiên. */
async function startFfmpegForSession({ baseUrl, token, form, sid }) {
  const selfContained = isSelfContained();
  const python = selfContained ? null : detectPython();
  const ffmpeg = detectFfmpeg();
  // 2) Lấy worker-config (session Imou đã giải mã, dests, URLs, token, dahuaP2p creds)
  const cfg = await apiFetch(baseUrl, `/api/tournament-auto-live/${sid}/worker-config`, { token });

  // 3) Thư mục phiên (preview HLS + rec segment) — đặt trong thư mục records (cạnh
  //    .exe hoặc do người dùng chọn) để file record/segment/clip lớn lưu cố định.
  const previewDir = path.join(recordsBaseDir(), `ptlive-preview-${sid}`);
  fs.mkdirSync(previewDir, { recursive: true });
  const previewServer = await startPreviewServer(previewDir);
  const previewPort = previewServer.address().port;

  // 3b) Nguồn đầu thu Dahua P2P: mở tunnel NGAY TRÊN MÁY NÀY (client) → RTSP local.
  // Hoàn toàn tài nguyên client, không qua VPS. Nếu lỗi → dừng sớm, báo rõ.
  let dahuaSerial = "";
  let dahuaSourceUrl = "";
  if (cfg.dahuaP2p && cfg.dahuaP2p.serial) {
    dahuaSerial = cfg.dahuaP2p.serial;
    const tlogFd = fs.openSync(path.join(previewDir, "dahua-tunnel.log"), "a");
    try {
      // Tunnel DÙNG CHUNG theo serial (nhiều court cùng đầu thu → 1 phiên P2P).
      dahuaSourceUrl = await acquireDahuaTunnel(sid, cfg.dahuaP2p, tlogFd);
    } catch (e) {
      try { fs.closeSync(tlogFd); } catch {}
      try { await apiFetch(baseUrl, `/api/tournament-auto-live/${sid}/stop`, { method: "POST", token }); } catch {}
      try { previewServer.close(); } catch {}
      throw e;
    }
    try { fs.closeSync(tlogFd); } catch {}
  }

  // 3c) Browser overlay (tuỳ chọn): render trang web transparent → TCP feed cho ffmpeg.
  //     Nếu chọn kiểu overlay A/B/C/D (HTML cao cấp) → tự dựng URL trang overlay theo
  //     sid + theme + góc; nếu đã truyền browserOverlayUrl thủ công thì ưu tiên nó.
  let browserOverlay = null;
  let bovUrl = (form.browserOverlayUrl || "").trim();
  const ovStyle = String(form.overlayStyle || "").trim();
  // LUÔN chạy browser overlay để hiện TICKER (chữ chạy cuối màn hình). theme=classic
  // → trang chỉ hiện ticker (bảng điểm do PNG vẽ); theme=A/B/C/D → bảng điểm HTML + ticker.
  if (!bovUrl && form.noTicker !== true) {
    const theme = ["A", "B", "C", "D"].includes(ovStyle) ? ovStyle : "classic";
    const webBase = String(baseUrl || "").replace(/\/api\/?$/, "").replace(/\/+$/, "");
    const corner = (form.layout && form.layout.scoreboard) || "top-left";
    bovUrl = `${webBase}/overlay/live.html?sid=${encodeURIComponent(sid)}&theme=${theme}&corner=${encodeURIComponent(corner)}`;
  }
  if (bovUrl) {
    try { browserOverlay = await startBrowserOverlay(bovUrl); }
    catch (e) { console.error("[browser-overlay] start fail:", e?.message || e); }
  }

  // 4) Spawn worker.py với GPU + preview
  const env = {
    ...process.env,
    PICKLETOUR_PYTHON: undefined,
    AUTOLIVE_BROWSER_OVERLAY: browserOverlay ? `tcp://127.0.0.1:${browserOverlay.port}` : "",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
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
    // Che ngày/giờ camera = ffmpeg delogo (LÀM MỜ thật, canh theo khung 1920x1080).
    // Toggle khi đang live = khởi động lại worker sân này với env mới (restartWorkerDelogo).
    ...delogoEnv(form),
    AUTOLIVE_PREVIEW_HLS_DIR: previewDir,
    // Ghi recording để cắt clip từng trận (live xuyên suốt). worker.py ghi segment
    // TS vào previewDir/rec; main.js đẩy về server ban đêm (startSegmentUploader).
    AUTOLIVE_RECORD: cfg.recordClips ? "1" : "",
    // Bình luận viên: luôn mở sẵn đường nhận mic (im lặng khi chưa ai nói) → BLV có
    // thể vào BẤT KỲ luồng nào. Tắt bằng settings.commentaryEnabled=false.
    AUTOLIVE_COMMENTARY: readSettings().commentaryEnabled === false ? "" : "1",
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
  running.set(sid, { proc, previewDir, previewServer, previewPort, cfg, logFile, dahuaSerial, browserOverlay, baseUrl, token, form });

  // Recording clip từng trận: chạy uploader đẩy segment về server ban đêm. Uploader
  // SỐNG LÂU HƠN worker (phải upload nốt sau khi phiên dừng) nên KHÔNG gắn cleanupWorker.
  if (cfg.recordClips) { try { startSegmentUploader({ sid, cfg, previewDir }); } catch (e) { console.error("[rec-upload] start fail", e?.message || e); } }

  proc.on("exit", (code) => {
    sendToRenderer("worker-exit", { sessionId: sid, code });
    cleanupWorker(sid);
  });

  return {
    sessionId: sid,
    previewUrl: `http://127.0.0.1:${previewPort}/index.m3u8`,
    watchUrls: (cfg.destinations || []).map((d) => d.watchUrl).filter(Boolean),
    logFile,
  };
}

function cleanupWorker(sid) {
  const r = running.get(sid);
  if (!r) return;
  try { r.previewServer?.close(); } catch {}
  try { r.browserOverlay?.close(); } catch {}
  // Nhả tunnel Dahua dùng chung: refcount-- + LINGER (giữ phiên P2P thêm 1 lúc để
  // start lại nhanh thì tái dùng, tránh mở phiên mới → tránh rate-limit).
  try { releaseDahuaTunnel(sid); } catch {}
  running.delete(sid);
}

function stopWorker(sid) {
  const r = running.get(sid);
  if (!r) return;
  try { r.proc.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { r.proc.kill("SIGKILL"); } catch {} }, 5000);
  cleanupWorker(sid);
}

// Bật/tắt (hoặc đổi vùng) LÀM MỜ ngày giờ (ffmpeg delogo) NGAY khi đang live: cập nhật
// env delogo rồi KHỞI ĐỘNG LẠI worker của sân đó (ffmpeg không đổi filter runtime được).
// Gây gián đoạn ~vài giây (RTMP tái kết nối), FB/YT live thường vẫn giữ.
async function restartWorkerDelogo({ sid, hideTimestamp, box }) {
  const r = running.get(sid);
  if (!r || !r.form) throw new Error("Sân chưa chạy worker — không thể đổi lúc này.");
  const { baseUrl, token, form } = r;
  form.hideTimestamp = !!hideTimestamp;
  if (box && typeof box === "object") form.delogoBox = box;
  // Gỡ listener exit để KHÔNG báo 'worker-exit' (đây là restart chủ động), rồi kill + dọn.
  try { r.proc.removeAllListeners("exit"); } catch {}
  try { r.proc.kill("SIGTERM"); } catch {}
  try { setTimeout(() => { try { r.proc.kill("SIGKILL"); } catch {} }, 4000); } catch {}
  cleanupWorker(sid);
  await new Promise((res) => setTimeout(res, 900));
  const res = await startFfmpegForSession({ baseUrl, token, form, sid });
  return { ok: true, hideTimestamp: form.hideTimestamp, delogoBox: form.delogoBox, previewUrl: res.previewUrl };
}
ipcMain.handle("toggle-delogo", async (_e, args) => restartWorkerDelogo(args || {}));

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
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    AUTOLIVE_PREVIEW_ONLY: "1",
    AUTOLIVE_SESSION_ID: previewId,
    AUTOLIVE_PREVIEW_HLS_DIR: dir,
    AUTOLIVE_ENCODER: source.encoder || "auto",
    // Ẩn ngày/giờ camera (delogo) — cho xem thử để căn chỉnh vùng trước khi live.
    ...delogoEnv(source),
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
// ── Hiệu năng máy (cho dashboard: CPU/RAM + ước tính còn bao nhiêu sân) ──
let _cpuSnap = null;
function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}
function sampleCpuPct() {
  const now = cpuSnapshot();
  if (!_cpuSnap) { _cpuSnap = now; return null; } // lần đầu chưa có delta
  const dIdle = now.idle - _cpuSnap.idle;
  const dTotal = now.total - _cpuSnap.total;
  _cpuSnap = now;
  if (dTotal <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
}
function localStats() {
  const cpus = os.cpus();
  const totalMemMB = Math.round(os.totalmem() / 1048576);
  const freeMemMB = Math.round(os.freemem() / 1048576);
  const cpuPct = sampleCpuPct();
  const liveCount = running.size;
  const CPU_BUDGET = 80;
  let moreCourts = null;
  if (cpuPct != null) {
    if (liveCount >= 1) {
      const perCourt = Math.max(cpuPct / liveCount, 1);
      moreCourts = Math.max(0, Math.floor((CPU_BUDGET - cpuPct) / perCourt));
    } else {
      moreCourts = Math.max(0, Math.floor((cpus.length * (CPU_BUDGET / 100)) / 1.25));
    }
  }
  return {
    cpuModel: cpus[0]?.model || "", cpuCount: cpus.length, cpuPct,
    totalMemMB, freeMemMB, usedMemMB: totalMemMB - freeMemMB,
    loadavg: os.loadavg().map((x) => Math.round(x * 100) / 100),
    platform: process.platform, arch: process.arch,
    liveCount, moreCourts,
  };
}
ipcMain.handle("sys-stats", () => localStats());

// ── Thư mục lưu record/segment/clip ──
ipcMain.handle("records-dir-get", () => ({
  dir: recordsBaseDir(),
  default: defaultRecordsDir(),
  custom: (readSettings().recordsDir || "").trim(),
}));
ipcMain.handle("records-dir-pick", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Chọn thư mục lưu record / segment / clip",
    defaultPath: recordsBaseDir(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths?.[0]) return { dir: recordsBaseDir(), changed: false };
  const chosen = path.join(r.filePaths[0], "records");
  try { fs.mkdirSync(chosen, { recursive: true }); } catch {}
  writeSettings({ recordsDir: chosen });
  return { dir: recordsBaseDir(), changed: true };
});
ipcMain.handle("records-dir-reset", () => {
  writeSettings({ recordsDir: "" });
  return { dir: recordsBaseDir(), default: defaultRecordsDir() };
});
ipcMain.handle("records-dir-open", () => {
  try { shell.openPath(recordsBaseDir()); } catch {}
  return { ok: true };
});

// ══════════ Điều khiển từ xa (web mobile qua Tailscale/LAN) ══════════
const control = { server: null, port: 0, pin: "" };
const remotePending = new Map(); // id -> { resolve, timer }

function genPin() { return String(Math.floor(1000 + Math.random() * 9000)); }
function lanIps() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name in ifs) {
    for (const a of ifs[name] || []) {
      if (a.family === "IPv4" && !a.internal) {
        out.push({ name, address: a.address, tailscale: a.address.startsWith("100.") });
      }
    }
  }
  out.sort((x, y) => (y.tailscale ? 1 : 0) - (x.tailscale ? 1 : 0));
  return out;
}
// Gửi lệnh xuống renderer (nơi giữ token + state.sessions) và chờ trả lời.
function remoteInvoke(action, payload = {}, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve({ ok: false, error: "App chưa sẵn sàng" });
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { remotePending.delete(id); resolve({ ok: false, error: "timeout" }); }, timeoutMs);
    remotePending.set(id, { resolve, timer });
    win.webContents.send("remote-cmd", { id, action, payload });
  });
}
ipcMain.on("remote-reply", (_e, { id, ok, data, error }) => {
  const p = remotePending.get(id);
  if (!p) return;
  clearTimeout(p.timer); remotePending.delete(id);
  p.resolve({ ok, data, error });
});
function readReqBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 2e6) { reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}
function startControlServer() {
  if (control.server) return controlInfo();
  // PIN ỔN ĐỊNH qua các lần khởi động (lưu settings) → tránh lệch PIN với backend
  // khi renderer chưa kịp đăng ký lại sau restart (gây lỗi "Sai PIN" → proxy 401).
  if (!control.pin) {
    const s = readSettings();
    control.pin = (s.controlPin && String(s.controlPin)) || genPin();
    if (!s.controlPin) writeSettings({ controlPin: control.pin });
  }
  const srv = http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
    try {
      const u = new URL(req.url, "http://localhost");
      if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/index.html")) {
        let html = "<h1>control.html missing</h1>";
        try { html = fs.readFileSync(path.join(__dirname, "renderer", "control.html"), "utf8"); } catch {}
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); return;
      }
      if (!u.pathname.startsWith("/api/")) { res.writeHead(404); res.end("not found"); return; }
      const pin = u.searchParams.get("k") || req.headers["x-ctl-pin"] || "";
      if (pin !== control.pin) return send(401, { error: "Sai PIN" });
      // Bình luận viên: nhận PCM (s16le 48k mono) STREAM từ VPS (relay từ aiortc) →
      // chuyển tiếp vào cổng ingest cục bộ của worker sân (worker ghi commentary.port).
      if (req.method === "POST" && u.pathname === "/api/commentary") {
        const sid = u.searchParams.get("sid") || "";
        if (!sid) return send(400, { error: "thiếu sid" });
        let port = 0;
        try {
          port = parseInt(
            fs.readFileSync(path.join(os.tmpdir(), `autolive-${sid}`, "commentary.port"), "utf8").trim(),
            10,
          );
        } catch {}
        if (!port) return send(409, { error: "sân chưa sẵn sàng nhận bình luận" });
        const net = require("net");
        const sock = net.connect(port, "127.0.0.1");
        let replied = false;
        const finish = (code, obj) => {
          if (replied) return;
          replied = true;
          try { send(code, obj); } catch {}
        };
        sock.on("error", (e) => { try { req.destroy(); } catch {} finish(502, { error: "worker ingest: " + e.message }); });
        sock.on("close", () => finish(200, { ok: true }));
        req.on("error", () => { try { sock.destroy(); } catch {} });
        req.on("aborted", () => { try { sock.destroy(); } catch {} });
        req.on("end", () => { try { sock.end(); } catch {} });
        req.pipe(sock); // net.Socket đệm ghi tới khi connect xong
        return;
      }
      // Preview 360p cho BLV xem (độ trễ thấp): kéo MPEG-TS từ cổng fan-out của worker
      // → stream về VPS (aiortc đọc làm video track).
      if (req.method === "GET" && u.pathname === "/api/preview360") {
        const sid = u.searchParams.get("sid") || "";
        if (!sid) return send(400, { error: "thiếu sid" });
        let port = 0;
        try {
          port = parseInt(
            fs.readFileSync(path.join(os.tmpdir(), `autolive-${sid}`, "preview360.port"), "utf8").trim(),
            10,
          );
        } catch {}
        if (!port) return send(409, { error: "sân chưa có preview360" });
        const net = require("net");
        const sock = net.connect(port, "127.0.0.1");
        let headSent = false;
        sock.on("connect", () => {
          headSent = true;
          res.writeHead(200, { "content-type": "video/mp2t", "cache-control": "no-cache" });
          sock.pipe(res);
        });
        sock.on("error", (e) => {
          if (!headSent) { try { send(502, { error: "worker preview360: " + e.message }); } catch {} }
          else { try { res.end(); } catch {} }
        });
        req.on("close", () => { try { sock.destroy(); } catch {} });
        res.on("close", () => { try { sock.destroy(); } catch {} });
        return;
      }
      if (req.method === "GET" && u.pathname === "/api/state") {
        const r = await remoteInvoke("state");
        return send(200, { perf: localStats(), sessions: r.data?.sessions || [], ok: r.ok });
      }
      if (req.method === "GET" && u.pathname === "/api/get-opacity") {
        const r = await remoteInvoke("getOpacity");
        return send(r.ok ? 200 : 500, r.ok ? (r.data || {}) : { error: r.error || "lỗi" });
      }
      if (req.method === "GET" && u.pathname === "/api/options") {
        const payload = Object.fromEntries(u.searchParams.entries());
        const r = await remoteInvoke("options", payload);
        return send(r.ok ? 200 : 500, r.ok ? r.data : { error: r.error || "lỗi" });
      }
      if (req.method === "POST") {
        const body = await readReqBody(req);
        const j = body ? JSON.parse(body) : {};
        const map = { "/api/stop": "stop", "/api/stop-all": "stopAll", "/api/start": "start", "/api/set-layout": "setLayout", "/api/set-opacity": "setOpacity", "/api/schedule": "schedule", "/api/set-ts-cover": "setTimestampCover" };
        const action = map[u.pathname];
        if (!action) return send(404, { error: "not found" });
        const r = await remoteInvoke(action, j);
        return send(r.ok ? 200 : 500, r.ok ? (r.data || { ok: true }) : { error: r.error || "lỗi" });
      }
      send(404, { error: "not found" });
    } catch (e) { send(500, { error: String(e?.message || e) }); }
  });
  srv.on("error", (e) => { console.error("[control] server error:", e?.message || e); });
  const port = Number(readSettings().controlPort) || 8788;
  control.port = port; // set ngay để UI hiện đúng (listen là async)
  srv.listen(port, "0.0.0.0", () => {
    control.port = srv.address().port;
    console.log(`[control] listening 0.0.0.0:${control.port} pin=${control.pin}`);
  });
  control.server = srv;
  return controlInfo();
}
function stopControlServer() {
  try { control.server?.close(); } catch {}
  control.server = null; control.port = 0;
}
// ID máy ổn định (để app điều khiển nhiều máy) — persist ở settings.json.
function machineId() {
  let s = readSettings();
  if (!s.machineId) {
    const id = `pc-${os.hostname()}-${Math.random().toString(36).slice(2, 8)}`.replace(/\s+/g, "");
    writeSettings({ machineId: id });
    return id;
  }
  return s.machineId;
}
function controlInfo() {
  const ips = lanIps();
  const ts = ips.find((x) => x.tailscale);
  return {
    enabled: !!control.server, port: control.port, pin: control.pin, ips,
    machineId: machineId(), label: os.hostname(),
    tailscaleIp: ts ? ts.address : "",
  };
}
ipcMain.handle("control-get", () => controlInfo());
ipcMain.handle("control-enable", (_e, { enabled }) => {
  if (enabled) startControlServer(); else stopControlServer();
  writeSettings({ controlEnabled: !!enabled });
  return controlInfo();
});
ipcMain.handle("control-regen-pin", () => { control.pin = genPin(); writeSettings({ controlPin: control.pin }); return controlInfo(); });

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

// Generic request (POST/PUT/DELETE) — dùng cho thư viện nguồn RTSP.
ipcMain.handle("api-req", async (_e, { baseUrl, token, method, path: p, body }) =>
  apiFetch(baseUrl, p, { token, method: method || "GET", body }));

ipcMain.handle("start", async (_e, args) => startWorker(args));

// Hẹn giờ bắt đầu live: startAt = epoch ms. Trả về danh sách lịch hiện tại.
ipcMain.handle("schedule-add", (_e, { baseUrl, token, form, startAt, label, meta }) => {
  const at = Number(startAt);
  if (!Number.isFinite(at)) throw new Error("Thời điểm hẹn giờ không hợp lệ.");
  const id = `sch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  armSchedule({ id, startAt: at, args: { baseUrl, token, form }, label: label || form?.title || "", meta: meta || {} });
  return { id, startAt: at, schedules: scheduleSummary() };
});
ipcMain.handle("schedule-list", () => ({ schedules: scheduleSummary() }));
ipcMain.handle("schedule-cancel", (_e, { id }) => {
  const j = scheduledJobs.get(id);
  if (j?.timer) { try { clearTimeout(j.timer); } catch {} }
  scheduledJobs.delete(id);
  persistSchedules();
  releasePowerBlockerIfIdle();
  return { ok: true, schedules: scheduleSummary() };
});
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
  // Dừng cả armed-poll (perMatchLive) nếu có.
  const t = armedPolls.get(sessionId);
  if (t) { clearInterval(t); armedPolls.delete(sessionId); }
  stopWorker(sessionId);
  try { await apiFetch(baseUrl, `/api/tournament-auto-live/${sessionId}/stop`, { method: "POST", token }); } catch {}
  return { ok: true };
});
ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));
ipcMain.handle("open-log", (_e, sessionId) => {
  const r = running.get(sessionId);
  if (r?.logFile) shell.openPath(r.logFile);
});
