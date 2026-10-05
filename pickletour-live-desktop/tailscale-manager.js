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

const { spawnSync, execFile } = require("child_process");
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
// Windows: tìm CLI chính thức (nếu còn) để fallback khi daemon đang chạy là bản chính thức.
function officialWinTailscaleBin() {
  if (!isWin()) return null;
  const candidates = [
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}
function bundledTailscaleBin() { return exe("tailscale"); }
// Chọn CLI khớp version daemon đang chạy (CLI/daemon lệch major.minor → `up` có thể
// silently no-op). Trên Windows có thể có cả 2: bundle (vd 1.104) và chính thức (vd 1.102).
// Dò bằng cách so daemon version với từng CLI version, cache để tránh gọi lặp.
let _cachedCli = null;
let _cachedCliTs = 0;
function tailscaleBin() {
  const bundled = bundledTailscaleBin();
  if (!isWin()) return bundled;
  const official = officialWinTailscaleBin();
  if (!official) return bundled;
  // Cache 10s để tránh spawnSync mỗi lần tsCli.
  if (_cachedCli && Date.now() - _cachedCliTs < 10000) return _cachedCli;
  _cachedCli = bundled;
  try {
    const r = spawnSync(bundled, ["status", "--json", "--peers=false"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0 && r.stdout) {
      const st = JSON.parse(r.stdout);
      const dv = String(st.Version || "").split("-")[0]; // vd "1.104.0"
      if (dv) {
        const majMin = dv.split(".").slice(0, 2).join(".");
        const bv = spawnSync(bundled, ["--version"], { encoding: "utf8", timeout: 3000 });
        const bundledVer = ((bv.stdout || "").split("\n")[0] || "").trim();
        if (!bundledVer.startsWith(majMin)) {
          const ov = spawnSync(official, ["--version"], { encoding: "utf8", timeout: 3000 });
          const officialVer = ((ov.stdout || "").split("\n")[0] || "").trim();
          if (officialVer.startsWith(majMin)) _cachedCli = official;
        }
      }
    }
  } catch {}
  _cachedCliTs = Date.now();
  return _cachedCli;
}
function available() { return Boolean(tailscaledBin() && bundledTailscaleBin()); }

function stateDir() {
  const base = _app ? _app.getPath("userData") : path.join(os.tmpdir(), "pickletour-live");
  const d = path.join(base, "tailscale");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
function opLogPath() { return path.join(stateDir(), "op.log"); }
function fileLog(...parts) {
  try {
    const line = `[${new Date().toISOString()}] ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
    fs.appendFileSync(opLogPath(), line);
  } catch {}
}
function sockPath() {
  // Windows: KHÔNG ép named pipe tùy chỉnh (tailscaled.exe dùng pipe mặc định
  // \\.\pipe\ProtectedPrefix\Administrators\Tailscale\tailscaled) → trả "" để CLI + daemon
  // cùng dùng mặc định. macOS: socket riêng trong thư mục app (không đụng Tailscale chính thức).
  if (isWin()) return "";
  return path.join(stateDir(), "tailscaled.sock");
}
function statePath() { return path.join(stateDir(), "tailscaled.state"); }
function logPath() { return path.join(stateDir(), "tailscaled.log"); }

// Chạy CLI tailscale (không cần root sau khi đã set operator). Trả {code, stdout, stderr}.
function tsCli(args, { timeout = 15000 } = {}) {
  const bin = tailscaleBin();
  if (!bin) return { code: -1, stdout: "", stderr: "thiếu bin/tailscale" };
  const sock = sockPath();
  const full = sock ? ["--socket", sock, ...args] : [...args];
  const r = spawnSync(bin, full, { encoding: "utf8", timeout });
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
  // Nhặt cảnh báo từ daemon (Health[]) để surface lên UI khi chưa connected.
  if (!_state.connected && Array.isArray(st.Health) && st.Health.length) {
    _state.health = st.Health.join("; ");
  } else {
    _state.health = "";
  }
  return _state;
}

function status() { return { ...refreshState(), available: available() }; }

// Bọc 1 đối số cho shell bằng NHÁY ĐƠN (an toàn với khoảng trắng trong đường dẫn,
// vd "Application Support", "PickleTour Live.app"). Escape nháy đơn bên trong.
function shq(s) { return "'" + String(s).replace(/'/g, `'\\''`) + "'"; }

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

// Windows: bọc 1 đối số cho PowerShell single-quoted string.
function psq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// Windows: spawn 1 tiến trình nền với quyền admin (UAC popup) — KHÔNG chờ exit.
// Dùng cho tailscaled.exe (daemon chạy mãi).
function spawnElevatedWinDetached(exePath, args) {
  const argList = args.map(psq).join(",");
  const ps = `try { Start-Process -FilePath ${psq(exePath)} -ArgumentList ${argList} -Verb RunAs -WindowStyle Hidden -ErrorAction Stop; exit 0 } catch { exit 1 }`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { timeout: 60000 }, (err) => {
      resolve({ ok: !err, error: err?.message || "" });
    });
  });
}

// Windows: chạy 1 lệnh với quyền admin (UAC popup) và CHỜ exit. Trả mã thoát + output.
// Dùng cho tailscale.exe up/down/logout. Dùng wrapper .cmd để BẮT stdout/stderr
// (Start-Process -Verb RunAs không cho kèm -RedirectStandardOutput).
function runElevatedWinWait(exePath, args) {
  const ts = Date.now();
  const wrapper = path.join(os.tmpdir(), `ptlive-ts-${ts}.cmd`);
  const outFile = path.join(os.tmpdir(), `ptlive-ts-${ts}.log`);
  const argLine = args.map((a) => `"${String(a).replace(/"/g, '""')}"`).join(" ");
  const body = [
    `@echo off`,
    `"${exePath}" ${argLine} > "${outFile}" 2>&1`,
    `echo __EXITCODE__=%ERRORLEVEL% >> "${outFile}"`,
  ].join("\r\n");
  try { fs.writeFileSync(wrapper, body, "utf8"); } catch (e) {
    return Promise.resolve({ ok: false, code: -1, error: "Không ghi được wrapper: " + (e?.message || e), stdout: "" });
  }
  const ps = `try { $p = Start-Process -FilePath ${psq(wrapper)} -Verb RunAs -PassThru -Wait -WindowStyle Hidden -ErrorAction Stop; exit $p.ExitCode } catch { exit 1 }`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { timeout: 180000 }, (err) => {
      let stdout = "", code = 0;
      try { stdout = fs.readFileSync(outFile, "utf8"); } catch {}
      const m = stdout.match(/__EXITCODE__=(-?\d+)/);
      if (m) { code = parseInt(m[1], 10); stdout = stdout.replace(/__EXITCODE__=-?\d+\s*$/, "").trim(); }
      try { fs.unlinkSync(wrapper); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
      const scrub = args.map((a) => String(a).replace(/(authkey=)[^\s"]+/i, "$1<redacted>"));
      _log("elevated", exePath, "args=", scrub, "exit=", code, "err=", err?.message || "", "out=", stdout.slice(0, 300));
      fileLog("elevated", path.basename(exePath), "args=", scrub, "exit=", code, "err=", err?.message || "", "out=", stdout.slice(0, 500));
      resolve({ ok: !err && code === 0, code, error: err?.message || "", stdout });
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

const LAUNCHD_LABEL = "vn.pickletour.tailscaled";
const LAUNCHD_PLIST = `/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist`;

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Tạo nội dung plist LaunchDaemon chạy tailscaled (root, nền, tự bật lại) — launchd
// giữ tiến trình sống kể cả sau khi app thoát / reboot (không dùng nohup vì osascript
// không có tty → "can't detach from console").
function buildPlist({ tsd, dir, sock, log }) {
  const args = [tsd, `--statedir=${dir}`, `--socket=${sock}`, "--tun=utun", "--port=0"];
  const argXml = args.map((a) => `    <string>${xmlEsc(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEsc(log)}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(log)}</string>
</dict>
</plist>
`;
}

async function ensureUpMac({ authKey, hostname, loginServer }) {
  const tsd = tailscaledBin();
  const ts = tailscaleBin();
  const sock = sockPath();
  const dir = stateDir(); // THƯ MỤC state cho tailscaled (--statedir cần 1 directory)
  const log = logPath();
  const user = os.userInfo().username || process.env.USER || "";

  // Nếu daemon chưa chạy (socket không phản hồi) → cần root để cài LaunchDaemon.
  const daemonUp = readStatus() != null;

  if (!daemonUp) {
    if (!authKey) {
      _state.lastError = "Chưa có authKey để kết nối tailnet.";
      return status();
    }
    // Ghi plist ra file tạm (user ghi được) rồi copy vào /Library/LaunchDaemons (root).
    const tmpPlist = path.join(dir, "tailscaled.plist");
    try { fs.writeFileSync(tmpPlist, buildPlist({ tsd, dir, sock, log })); } catch (e) {
      _state.lastError = "Không ghi được cấu hình dịch vụ: " + (e?.message || e);
      return status();
    }
    const loginArg = loginServer ? ` --login-server=${shq(loginServer)}` : "";
    // 1 lần hỏi mật khẩu: cài + nạp LaunchDaemon (tailscaled root, tự bật lại) → chờ
    // socket → up + set operator (để sau này user điều khiển không cần root).
    const script = [
      `mkdir -p ${shq(dir)}`,
      `cp ${shq(tmpPlist)} ${shq(LAUNCHD_PLIST)}`,
      `chown root:wheel ${shq(LAUNCHD_PLIST)}`,
      `chmod 644 ${shq(LAUNCHD_PLIST)}`,
      // Nạp lại sạch (bỏ bản cũ nếu có) để áp đúng tham số hiện tại.
      `launchctl bootout system ${shq(LAUNCHD_PLIST)} 2>/dev/null || launchctl unload ${shq(LAUNCHD_PLIST)} 2>/dev/null || true`,
      `launchctl bootstrap system ${shq(LAUNCHD_PLIST)} 2>/dev/null || launchctl load -w ${shq(LAUNCHD_PLIST)} 2>/dev/null || true`,
      `for i in $(seq 1 40); do ${shq(ts)} --socket=${shq(sock)} status >/dev/null 2>&1 && break; sleep 0.5; done`,
      `${shq(ts)} --socket=${shq(sock)} up --authkey=${shq(authKey)} --hostname=${shq(hostname)} --operator=${shq(user)} --accept-routes --reset${loginArg}`,
      // Cho user đọc socket ngay phiên đầu (các lần sau daemon tự set theo operator).
      `chmod 0666 ${shq(sock)} 2>/dev/null || true`,
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
  const ts = tailscaleBin();
  const dir = stateDir();
  fileLog("ensureUpWin start · tailscaled=", tsd, " · tailscaleCli=", ts, " · hostname=", hostname);
  // 1) Có daemon đang chạy không? (service Tailscale chính thức, hoặc app đã spawn trước đó).
  //    CLI đọc status qua pipe mặc định — chỉ cần read, user process làm được.
  let daemonUp = readStatus() != null;
  if (!daemonUp) {
    // Không có tailscaled nào → spawn qua UAC (cần admin cho wintun). 1 lần popup.
    const r = await spawnElevatedWinDetached(tsd, ["--statedir", dir, "--port", "0"]);
    if (!r.ok) {
      _state.lastError = "Không chạy được tailscaled (UAC bị từ chối): " + r.error;
      return status();
    }
    for (let i = 0; i < 30; i++) {
      if (readStatus() != null) { daemonUp = true; break; }
      await new Promise((r2) => setTimeout(r2, 500));
    }
    if (!daemonUp) {
      _state.lastError = "tailscaled chưa khởi động sau khi được cấp quyền.";
      return status();
    }
  }
  // 2) `tailscale up` trên Windows phải chạy qua UAC vì pipe daemon có ACL Administrators-only.
  //    Nếu gọi trực tiếp từ user process → thường exit 0 nhưng silently no-op (không áp authKey).
  if (authKey) {
    // KHÔNG dùng --reset: nó reset mọi pref chưa truyền về default và có thể làm
    // WantRunning=false ngay sau khi login → daemon bị "disconnecting" trong chính request.
    // --timeout=60s để CLI chờ login hoàn tất đồng bộ (mặc định có thể fire-and-forget).
    // --unattended (Windows-only) BẮT BUỘC: tailscaled Windows chạy "client mode" — khi
    // client cuối (chính CLI up này) thoát, daemon tự "disconnecting Tailscale" → NoState.
    const upArgs = ["up", "--authkey=" + authKey, "--hostname=" + hostname, "--accept-routes", "--timeout=60s", "--unattended"];
    if (loginServer) upArgs.push("--login-server=" + loginServer);
    const r = await runElevatedWinWait(ts, upArgs);
    if (!r.ok) {
      _state.lastError = "Lệnh 'tailscale up' lỗi (mã " + r.code + "): " + (r.stdout?.trim() || r.error || "không rõ nguyên nhân");
      return status();
    }
    // Có output nhưng exit 0 (ví dụ cảnh báo version) — vẫn tiếp tục poll.
    if (r.stdout && r.stdout.trim()) _log("tailscale up stdout:", r.stdout.trim().slice(0, 500));
  }
  // 3) Poll tới khi connected (~30s). Nếu vẫn fail → surface Health[] từ daemon.
  for (let i = 0; i < 30; i++) { refreshState(); if (_state.connected) break; await new Promise((r) => setTimeout(r, 1000)); }
  if (!_state.connected) {
    const hints = [];
    if (_state.backendState) hints.push("BackendState=" + _state.backendState);
    if (_state.health) hints.push(_state.health);
    _state.lastError = "Chưa vào được tailnet. " + (hints.join(" · ") || "Thử lại hoặc kiểm tra authKey.");
  }
  return status();
}

// Ngắt kết nối (node ephemeral → tự rời tailnet).
// macOS: không cần root nhờ operator đã set. Windows: pipe ACL Admin-only → qua UAC.
async function down() {
  if (isWin()) {
    const ts = tailscaleBin();
    if (ts) {
      try { await runElevatedWinWait(ts, ["down"]); } catch {}
      try { await runElevatedWinWait(ts, ["logout"]); } catch {}
    }
    try { if (_daemonProc && !_daemonProc.killed) _daemonProc.kill(); } catch {}
    return;
  }
  try { tsCli(["down"], { timeout: 8000 }); } catch {}
  try { tsCli(["logout"], { timeout: 8000 }); } catch {}
  try { if (_daemonProc && !_daemonProc.killed) _daemonProc.kill(); } catch {}
}

module.exports = { init, available, ensureUp, status, refreshState, down, sockPath };
