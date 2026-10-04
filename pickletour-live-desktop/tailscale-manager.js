// tailscale-manager.js — Tích hợp Tailscale vào app live, không cần cài app Tailscale.
// Mục tiêu: mở app → máy TỰ vào tailnet (có IP 100.x như 1 interface thật) để backend
// (điều khiển từ xa, bình luận, observer) tới được máy, và máy tới được cam/NVR.
//
// Cách làm (macOS): chạy `tailscaled` (kèm trong bin/) ở chế độ hệ thống (TUN utun) —
// cần quyền root 1 LẦN (hỏi mật khẩu qua hộp thoại hệ thống). Sau đó set --operator=<user>
// để các lần sau `tailscale up/status/down` chạy KHÔNG cần root. Node là EPHEMERAL +
// preauthorized (key do backend cấp) → tự biến mất khỏi tailnet khi offline.
//
// Windows: chạy tailscaled như tiến trình nền (cần quyền admin cho wintun) — bản MVP
// khởi chạy trực tiếp; nếu thiếu quyền sẽ báo lỗi để người dùng mở app bằng admin.

const { spawn, spawnSync, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let _app = null;
let _binDir = null;
let _log = (..._a) => {};
let _state = { running: false, connected: false, ip: "", backendState: "", lastError: "" };
let _daemonProc = null; // chỉ giữ ref khi tự spawn (không qua elevation)

function init({ app, binDir, logger } = {}) {
  _app = app;
  _binDir = binDir;
  if (typeof logger === "function") _log = logger;
}

function isMac() { return process.platform === "darwin"; }
function isWin() { return process.platform === "win32"; }

function exe(name) {
  const n = isWin() ? `${name}.exe` : name;
  const p = path.join(_binDir || __dirname, n);
  return fs.existsSync(p) ? p : null;
}
function tailscaledBin() { return exe("tailscaled"); }
function tailscaleBin() { return exe("tailscale"); }
function available() { return Boolean(tailscaledBin() && tailscaleBin()); }

function stateDir() {
  const base = _app ? _app.getPath("userData") : path.join(os.tmpdir(), "pickletour-live");
  const d = path.join(base, "tailscale");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
function sockPath() {
  // Socket riêng cho app → KHÔNG đụng Tailscale chính thức (nếu có cài).
  if (isWin()) return "\\\\.\\pipe\\pickletour-tailscaled";
  return path.join(stateDir(), "tailscaled.sock");
}
function statePath() { return path.join(stateDir(), "tailscaled.state"); }
function logPath() { return path.join(stateDir(), "tailscaled.log"); }

// Chạy CLI tailscale (không cần root sau khi đã set operator). Trả {code, stdout, stderr}.
function tsCli(args, { timeout = 15000 } = {}) {
  const bin = tailscaleBin();
  if (!bin) return { code: -1, stdout: "", stderr: "thiếu bin/tailscale" };
  const r = spawnSync(bin, ["--socket", sockPath(), ...args], { encoding: "utf8", timeout });
  return { code: r.status == null ? -1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Đọc trạng thái qua `tailscale status --json`.
function readStatus() {
  const r = tsCli(["status", "--json", "--peers=false"], { timeout: 8000 });
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function refreshState() {
  const st = readStatus();
  if (!st) {
    _state.running = false;
    _state.connected = false;
    _state.ip = "";
    _state.backendState = "";
    return _state;
  }
  _state.running = true;
  _state.backendState = String(st.BackendState || "");
  const ips = (st.Self && Array.isArray(st.Self.TailscaleIPs)) ? st.Self.TailscaleIPs : [];
  const v4 = ips.find((x) => /^100\./.test(String(x))) || "";
  _state.ip = v4;
  _state.connected = _state.backendState === "Running" && Boolean(v4);
  return _state;
}

function status() { return { ...refreshState(), available: available() }; }

// Shell-escape cho `do shell script` của osascript (bọc trong nháy kép).
function shq(s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

// macOS: chạy 1 script có quyền root qua hộp thoại hệ thống (hỏi mật khẩu 1 lần).
function runElevatedMac(script) {
  return new Promise((resolve) => {
    // do shell script nhận chuỗi; escape nháy kép + backslash.
    const osa = `do shell script "${script.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" with administrator privileges`;
    execFile("/usr/bin/osascript", ["-e", osa], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: (stderr || err.message || "").toString().trim() });
      else resolve({ ok: true, stdout: (stdout || "").toString() });
    });
  });
}

// Đảm bảo tailscaled đang chạy + đã kết nối tailnet bằng authKey. Idempotent.
// opts: { authKey, loginServer, hostname }
async function ensureUp(opts = {}) {
  _state.lastError = "";
  if (!available()) {
    _state.lastError = "Bản app chưa kèm Tailscale (thiếu bin/tailscaled).";
    return status();
  }
  // Đã kết nối rồi → thôi.
  refreshState();
  if (_state.connected) return status();

  const authKey = String(opts.authKey || "").trim();
  const hostname = String(opts.hostname || os.hostname() || "pickletour-live").replace(/[^A-Za-z0-9-]/g, "-").slice(0, 60) || "pickletour-live";
  const loginServer = String(opts.loginServer || "").trim();

  if (isMac()) return ensureUpMac({ authKey, hostname, loginServer });
  if (isWin()) return ensureUpWin({ authKey, hostname, loginServer });
  _state.lastError = "Nền tảng chưa hỗ trợ tự chạy Tailscale.";
  return status();
}

async function ensureUpMac({ authKey, hostname, loginServer }) {
  const tsd = tailscaledBin();
  const ts = tailscaleBin();
  const sock = sockPath();
  const dir = statePath();
  const log = logPath();
  const user = os.userInfo().username || process.env.USER || "";

  // Nếu daemon chưa chạy (socket không phản hồi) → cần root để khởi chạy TUN.
  const daemonUp = readStatus() != null;

  if (!daemonUp) {
    if (!authKey) {
      _state.lastError = "Chưa có authKey để kết nối tailnet.";
      return status();
    }
    // 1 lần hỏi mật khẩu: khởi chạy tailscaled (root, nền) + up + set operator.
    const loginArg = loginServer ? ` --login-server=${shq(loginServer)}` : "";
    const script = [
      `mkdir -p ${shq(dir)}`,
      // Khởi chạy daemon nền nếu chưa có (nohup để sống sau khi shell root thoát).
      `if ! ${shq(ts)} --socket=${shq(sock)} status >/dev/null 2>&1; then `
        + `nohup ${shq(tsd)} --statedir=${shq(dir)} --socket=${shq(sock)} --tun=utun --port=0 >> ${shq(log)} 2>&1 & `
        + `for i in $(seq 1 30); do ${shq(ts)} --socket=${shq(sock)} status >/dev/null 2>&1 && break; sleep 0.5; done; fi`,
      // Kết nối + cho phép user điều khiển không cần root các lần sau.
      `${shq(ts)} --socket=${shq(sock)} up --authkey=${shq(authKey)} --hostname=${shq(hostname)} --operator=${shq(user)} --accept-routes --reset${loginArg}`,
    ].join("; ");
    const r = await runElevatedMac(script);
    if (!r.ok) {
      _state.lastError = "Không khởi chạy được Tailscale: " + (r.error || "bị từ chối quyền");
      return status();
    }
  } else {
    // Daemon đã chạy → chỉ cần up (operator đã set từ trước nên không cần root).
    if (authKey) {
      const loginArg = loginServer ? ["--login-server", loginServer] : [];
      const r = tsCli(["up", "--authkey", authKey, "--hostname", hostname, "--accept-routes", ...loginArg], { timeout: 60000 });
      if (r.code !== 0) _state.lastError = (r.stderr || r.stdout || "tailscale up lỗi").trim();
    }
  }

  // Chờ kết nối (poll tối đa ~20s).
  for (let i = 0; i < 20; i++) {
    refreshState();
    if (_state.connected) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  return status();
}

async function ensureUpWin({ authKey, hostname, loginServer }) {
  const tsd = tailscaledBin();
  const sock = sockPath();
  const dir = statePath();
  // Windows: spawn tailscaled nền (cần wintun + quyền admin; nếu thiếu → báo lỗi).
  const daemonUp = readStatus() != null;
  if (!daemonUp) {
    try {
      // Windows: dùng wintun mặc định (cần quyền admin). Không ép --tun.
      _daemonProc = spawn(tsd, ["--statedir", dir, "--socket", sock, "--port", "0"], {
        detached: true, stdio: "ignore", windowsHide: true,
      });
      _daemonProc.unref();
    } catch (e) {
      _state.lastError = "Không chạy được tailscaled (thử mở app bằng quyền admin): " + (e?.message || e);
      return status();
    }
    for (let i = 0; i < 30; i++) { if (readStatus() != null) break; await new Promise((r) => setTimeout(r, 500)); }
  }
  if (authKey) {
    const loginArg = loginServer ? ["--login-server", loginServer] : [];
    const r = tsCli(["up", "--authkey", authKey, "--hostname", hostname, "--accept-routes", ...loginArg], { timeout: 60000 });
    if (r.code !== 0) _state.lastError = (r.stderr || r.stdout || "tailscale up lỗi").trim();
  }
  for (let i = 0; i < 20; i++) { refreshState(); if (_state.connected) break; await new Promise((r) => setTimeout(r, 1000)); }
  return status();
}

// Ngắt kết nối (node ephemeral → tự rời tailnet). KHÔNG cần root nhờ operator đã set.
function down() {
  try { tsCli(["down"], { timeout: 8000 }); } catch {}
  try { tsCli(["logout"], { timeout: 8000 }); } catch {}
  try { if (_daemonProc && !_daemonProc.killed) _daemonProc.kill(); } catch {}
}

module.exports = { init, available, ensureUp, status, refreshState, down, sockPath };
