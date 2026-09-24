// Shared Dahua/DMSS P2P tunnel manager.
//
// Đầu thu Dahua chỉ cho ~1 PHIÊN P2P đồng thời → KHÔNG mở 8 tunnel cho 8 cam.
// Thay vào đó: MỘT tunnel dh-p2p (một phiên P2P) cho mỗi SERIAL đầu thu, rồi
// nhiều court pull nhiều KÊNH khác nhau qua CÙNG tunnel đó (mỗi kết nối RTSP =
// một realm PTCP, dh-p2p ghép kênh sẵn). Nhờ vậy 1 phiên P2P phục vụ nhiều cam.
//
// Tunnel chạy DETACHED (sống qua pm2 restart) trên CỔNG CỐ ĐỊNH theo serial (để
// SOURCE_URL của worker không đổi khi respawn). reconcile() (chạy ở background
// job leader) đảm bảo: serial nào còn phiên auto-live active thì tunnel sống;
// serial nào hết thì kill tunnel.
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import net from "net";
import path from "path";
import crypto from "crypto";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import Venue from "../../models/venueModel.js";
import { decryptToken } from "../secret.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAHUA_P2P_BIN = process.env.AUTOLIVE_DAHUA_P2P_BIN
  || path.resolve(__dirname, "../../scripts/dahua-p2p/target/release/dh-p2p");

// Cổng local cố định theo serial (ổn định qua respawn/pm2 restart). Dải 15000-16999.
export function portForSerial(serial) {
  const h = crypto.createHash("md5").update(String(serial)).digest();
  return 15000 + (h.readUInt16BE(0) % 2000);
}

// state theo serial: { proc, port, ready, startingPromise, username, password, idleSince }
const tunnels = new Map();

// ── Cư xử "giống DMSS" để tránh Dahua cloud rate-limit ──────────────────────
// 1) LINGER: sau khi court cuối dừng, GIỮ tunnel sống thêm 1 lúc thay vì kill
//    ngay → start lại nhanh thì TÁI DÙNG phiên cũ (không mở phiên P2P mới).
// 2) BACKOFF: khi connect lỗi (đầu thu bận/throttle) thì GIÃN dần lần thử, không
//    respawn dồn dập (respawn dồn chính là thứ nuôi rate-limit).
const LINGER_MS = Number(process.env.AUTOLIVE_DAHUA_TUNNEL_LINGER_MS) || 90000;
const backoffState = new Map(); // serial -> { fails, nextAttemptAt }

function backoffRemainingMs(serial) {
  const b = backoffState.get(serial);
  return b ? Math.max(0, b.nextAttemptAt - Date.now()) : 0;
}
function recordSpawnFail(serial) {
  const b = backoffState.get(serial) || { fails: 0, nextAttemptAt: 0 };
  b.fails += 1;
  // 15s, 30s, 60s, 120s, … cap 5 phút.
  const delay = Math.min(300000, 15000 * 2 ** (b.fails - 1));
  b.nextAttemptAt = Date.now() + delay;
  backoffState.set(serial, b);
  return delay;
}
function recordSpawnOk(serial) { backoffState.delete(serial); }

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isPortListening(port) {
  return new Promise((res) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => { s.destroy(); res(true); });
    s.on("error", () => res(false));
    s.setTimeout(1500, () => { s.destroy(); res(false); });
  });
}

function logPath(serial) {
  return path.join(os.tmpdir(), `dahua-tunnel-${String(serial).replace(/[^A-Za-z0-9]/g, "")}.log`);
}

// Giải phóng cổng cố định trước khi bind: kill tiến trình MỒ CÔI đang giữ cổng
// (vd tunnel cũ sống sót qua pm2 restart) → tránh panic AddrInUse khi spawn lại.
function killPortOccupant(port) {
  try {
    const out = spawnSync(
      "bash",
      [
        "-c",
        `ss -ltnpH 'sport = :${port}' 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2`,
      ],
      { encoding: "utf8", timeout: 4000 },
    );
    const pid = parseInt(String(out.stdout || "").trim(), 10);
    if (pid && pid > 0 && pid !== process.pid) {
      try { process.kill(pid, "SIGKILL"); } catch {}
      // chờ chút cho OS nhả cổng
      spawnSync("bash", ["-c", "sleep 0.6"], { timeout: 2000 });
    }
  } catch {
    /* best-effort */
  }
}

function spawnTunnelProc(serial, username, password, port) {
  killPortOccupant(port);
  // DIRECT hole-punch (KHÔNG --relay): relay không có media.
  const args = ["-u", username || "admin", "-w", password, "-p", `127.0.0.1:${port}:554`, serial];
  let fd;
  try { fd = fs.openSync(logPath(serial), "a"); } catch { fd = "ignore"; }
  const proc = spawn(DAHUA_P2P_BIN, args, { detached: true, stdio: ["ignore", fd, fd] });
  proc.unref();
  if (typeof fd === "number") { try { fs.closeSync(fd); } catch {} }
  return proc;
}

async function waitTunnelReady(serial, port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const log = fs.readFileSync(logPath(serial), "utf8");
      if (log.includes("Ready to connect")) return true;
    } catch { /* log chưa có */ }
    if (await isPortListening(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Đảm bảo có đúng MỘT tunnel sống cho serial này. Trả { port }. Ném lỗi nếu
 * tunnel không Ready (đầu thu bận phiên P2P khác / rate-limit Dahua cloud).
 * An toàn khi gọi đồng thời (nhiều court cùng serial khởi động 1 lúc).
 */
export async function ensureDahuaTunnel({ serial, username, password }) {
  serial = String(serial || "").trim();
  if (!serial || !password) throw new Error("Dahua tunnel thiếu serial/mật khẩu");
  const port = portForSerial(serial);

  const cur = tunnels.get(serial);
  if (cur?.startingPromise) { await cur.startingPromise; return { port }; }
  if (cur?.proc && isPidAlive(cur.proc.pid) && (await isPortListening(port))) {
    cur.idleSince = 0; // đang được dùng lại → huỷ linger, TÁI DÙNG phiên (như DMSS)
    return { port };
  }

  // Backoff: nếu vừa fail gần đây, không thử dồn (respawn dồn nuôi rate-limit).
  const wait = backoffRemainingMs(serial);
  if (wait > 0) {
    throw new Error(`Đầu thu đang tạm bị Dahua cloud giới hạn — thử lại sau ~${Math.ceil(wait / 1000)}s `
      + "(tránh kết nối dồn dập).");
  }

  const entry = { proc: null, port, ready: false, startingPromise: null, username, password, idleSince: 0 };
  const startingPromise = (async () => {
    try { fs.writeFileSync(logPath(serial), ""); } catch {}
    if (!fs.existsSync(DAHUA_P2P_BIN)) {
      throw new Error(`Không thấy dh-p2p binary: ${DAHUA_P2P_BIN} (chạy scripts/dahua-p2p/build.sh)`);
    }
    const proc = spawnTunnelProc(serial, username, password, port);
    entry.proc = proc;
    const ok = await waitTunnelReady(serial, port);
    if (!ok) {
      try { process.kill(proc.pid, "SIGKILL"); } catch {}
      tunnels.delete(serial);
      const delay = recordSpawnFail(serial);
      throw new Error("dh-p2p tunnel không Ready (đầu thu đang bận phiên P2P khác "
        + `hoặc Dahua cloud rate-limit) — sẽ giãn ~${Math.ceil(delay / 1000)}s trước khi thử lại.`);
    }
    entry.ready = true;
    recordSpawnOk(serial);
  })();
  entry.startingPromise = startingPromise;
  tunnels.set(serial, entry);
  try {
    await startingPromise;
  } finally {
    const e = tunnels.get(serial);
    if (e) e.startingPromise = null;
  }
  return { port };
}

/** Build RTSP URL local cho 1 kênh qua tunnel dùng chung. */
export function dahuaChannelUrl({ username, password, port, channel, subtype }) {
  const u = encodeURIComponent(username || "admin");
  const p = encodeURIComponent(password || "");
  return `rtsp://${u}:${p}@127.0.0.1:${port}/cam/realmonitor?channel=${channel || 1}&subtype=${subtype || 0}`;
}

export function killDahuaTunnel(serial) {
  const e = tunnels.get(serial);
  const pid = e?.proc?.pid;
  if (pid) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch {} }, 4000);
  }
  tunnels.delete(serial);
}

async function credsForSerial(venueId, serial) {
  const venue = await Venue.findById(venueId).select("dahuaNvr").lean().catch(() => null);
  const nvr = venue?.dahuaNvr;
  if (!nvr?.serial || nvr.serial !== serial || !nvr.credCipher) return null;
  const password = decryptToken(nvr.credCipher);
  if (!password) return null;
  return { serial, username: nvr.username || "admin", password };
}

let reconciling = false;
async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    const Session = mongoose.model("TournamentAutoLiveSession");
    const active = await Session.find({
      status: { $in: ["live", "starting", "reconnecting", "paused"] },
      "dahuaP2p.serial": { $exists: true, $ne: "" },
    }).select("dahuaP2p venue").lean();

    const wanted = new Map(); // serial -> venueId (bất kỳ session nào)
    for (const s of active) {
      if (s?.dahuaP2p?.serial) wanted.set(s.dahuaP2p.serial, s.venue);
    }

    // Serial còn phiên active → đảm bảo tunnel sống (respawn nếu chết, cùng cổng).
    for (const [serial, venueId] of wanted) {
      const port = portForSerial(serial);
      const entry = tunnels.get(serial);
      if (entry) entry.idleSince = 0; // đang dùng → huỷ linger
      const alive = isPidAlive(entry?.proc?.pid);
      const listening = await isPortListening(port);
      if (alive && listening) continue;
      // Backoff: đang trong cửa sổ giãn thì KHÔNG respawn (tránh dồn dập).
      const wait = backoffRemainingMs(serial);
      if (wait > 0) continue;
      const creds = await credsForSerial(venueId, serial);
      if (!creds) continue;
      try {
        await ensureDahuaTunnel(creds);
        console.log(`[dahua-tunnel] reconcile: (re)spawned tunnel serial=${serial} port=${port}`);
      } catch (e) {
        console.warn(`[dahua-tunnel] reconcile spawn fail serial=${serial}:`, e?.message || e);
      }
    }

    // Serial không còn phiên active → LINGER: giữ tunnel thêm LINGER_MS rồi mới
    // kill (start lại nhanh sẽ tái dùng phiên cũ, không mở phiên P2P mới — như DMSS).
    const now = Date.now();
    for (const serial of Array.from(tunnels.keys())) {
      if (wanted.has(serial)) continue;
      const entry = tunnels.get(serial);
      if (!entry) continue;
      if (!entry.idleSince) { entry.idleSince = now; continue; }
      if (now - entry.idleSince >= LINGER_MS) {
        killDahuaTunnel(serial);
        console.log(`[dahua-tunnel] reconcile: killed idle tunnel serial=${serial} (linger hết)`);
      }
    }
  } catch (e) {
    console.warn("[dahua-tunnel] reconcile error:", e?.message || e);
  } finally {
    reconciling = false;
  }
}

/** Gọi ở background job leader: giữ tunnel khớp với các phiên auto-live active. */
export function startDahuaTunnelReconcile() {
  const t = setInterval(reconcile, 20000);
  if (t.unref) t.unref();
  reconcile();
  console.log("[dahua-tunnel] reconcile loop started (20s)");
}

/** Chủ động chạy reconcile ngay (vd sau khi stop 1 phiên). */
export function triggerDahuaReconcile() {
  reconcile();
}
