// services/clip/clipWorker.service.js
// Worker XỬ LÝ TUẦN TỰ các yêu cầu cắt clip camera (ClipJob).
//
// Cơ chế "lần lượt, không đồng thời" (giống PickleBook — không cần Redis/queue lib):
//   • Chạy DUY NHẤT ở process background-leader (gọi từ server.js).
//   • setInterval poll DB mỗi POLL_MS. Mỗi tick:
//       - guard in-process: active >= CONCURRENCY (mặc định 1) → bỏ qua.
//       - claim NGUYÊN TỬ: findOneAndUpdate({status:queued} → processing,
//         sort createdAt) = mutex + FIFO. Kể cả nhiều tick/nhiều process,
//         mỗi job chỉ 1 nơi nhận.
//   • processJob spawn scripts/clip/clip_grab.py (ffmpeg chạy TRONG child) →
//     máy chủ chỉ chịu tải 1 lần cắt tại 1 thời điểm.
//   • Lỗi tạm thời (cam bận 555) → requeue nextAttemptAt=+2 phút, tối đa 4 lần.
//   • Boot recovery: job kẹt 'processing' (crash trước đó) → reset 'queued'.
//   • Cleanup mỗi giờ: expiresAt <= now → xoá file + doc (TTL mặc định 7 ngày).

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import ClipJob from "../../models/clipJobModel.js";
import Venue from "../../models/venueModel.js";
import { decryptToken } from "../secret.service.js";
import { pushToUsers } from "../venueNotify.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT = path.resolve(__dirname, "../../scripts/clip/clip_grab.py");

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const IMOU_PKG_PATH = process.env.IMOU_PKG_PATH || ""; // "" = imou đã cài trong venv
const CONCURRENCY = Math.min(2, Math.max(1, Number(process.env.CLIP_CONCURRENCY) || 1));
const POLL_MS = Number(process.env.CLIP_POLL_MS) || 5000;
const CLIP_TTL_DAYS = Number(process.env.CLIP_TTL_DAYS) || 7;
const MAX_ATTEMPTS = Number(process.env.CLIP_MAX_ATTEMPTS) || 4;

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "clips");

let active = 0;
let running = false;
let pollTimer = null;
let cleanupTimer = null;

function ensureUploadDir() {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* ignore */ }
}

/** Session Imou (snake_case) mà clip_grab.py cần: {uuid_user,uuid_key,session_id,regional_host}. */
function decryptVenueSession(venue) {
  const cipher = venue?.imouSession?.cipher;
  if (!cipher) return null;
  const plain = decryptToken(cipher);
  if (!plain) return null;
  let s;
  try { s = JSON.parse(plain); } catch { return null; }
  const host = String(s.regionalHost || s.regional_host || "")
    .replace(/^https?:\/\//, "").replace(/:443$/, "").replace(/\/$/, "");
  const out = {
    uuid_user: s.uuidUser || s.uuid_user,
    uuid_key: s.uuidKey || s.uuid_key,
    session_id: s.sessionId || s.session_id,
    regional_host: host,
  };
  if (!out.uuid_user || !out.uuid_key || !out.session_id || !out.regional_host) return null;
  return out;
}

function decryptVenueCreds(venue) {
  const cipher = venue?.imouCreds?.cipher;
  if (!cipher) return null;
  const plain = decryptToken(cipher);
  if (!plain) return null;
  try {
    const c = JSON.parse(plain);
    if (c?.phone && c?.password) {
      return { phone: c.phone, password: c.password, area_code: c.areaCode || c.area_code || "84" };
    }
  } catch { /* ignore */ }
  return null;
}

/** Ánh xạ lỗi python → câu tiếng Việt thân thiện cho user. */
function friendlyError(code, stderr) {
  const s = String(stderr || "");
  if (code === 3) return "Không có bản ghi trên thẻ nhớ trong khung giờ này.";
  if (/12002/.test(s)) return "Phiên đăng nhập camera đã hết hạn — vui lòng liên hệ chủ sân đăng nhập lại Imou.";
  if (/no session|No session/.test(s)) return "Sân chưa cấu hình phiên đăng nhập camera.";
  if (/555/.test(s)) return "Camera đang bận, vui lòng thử lại sau ít phút.";
  return "Không cắt được clip (lỗi camera/máy chủ). Vui lòng thử lại.";
}

/** true nếu lỗi tạm thời (nên requeue) — cam bận. */
function isTransient(code, stderr) {
  return /555/.test(String(stderr || ""));
}

async function notifyDone(job) {
  try {
    const bid = job.booking ? String(job.booking) : "";
    await pushToUsers({
      recipients: [String(job.requestedBy)],
      type: "BOOKING",
      title: "🎬 Clip của bạn đã sẵn sàng",
      body: `Clip sân ${job.courtName || ""} (${job.durationSec}s) đã cắt xong. Bấm để xem.`,
      url: bid ? `/clips?booking=${bid}` : `/clips/${job._id}`,
      data: { kind: "clip_ready", clipJobId: String(job._id), fileUrl: job.fileUrl, bookingId: bid },
    });
  } catch (e) { console.error("[clipWorker] notifyDone:", e?.message || e); }
}

async function notifyFailed(job, message) {
  try {
    const bid = job.booking ? String(job.booking) : "";
    await pushToUsers({
      recipients: [String(job.requestedBy)],
      type: "BOOKING",
      title: "⚠️ Cắt clip thất bại",
      body: message || "Không cắt được clip. Vui lòng thử lại.",
      url: bid ? `/clips?booking=${bid}` : `/clips/${job._id}`,
      data: { kind: "clip_failed", clipJobId: String(job._id), bookingId: bid },
    });
  } catch (e) { console.error("[clipWorker] notifyFailed:", e?.message || e); }
}

function spawnCutter(params, onPid) {
  return new Promise((resolve) => {
    let stderr = "", stdout = "", done = false;
    const child = spawn(PYTHON_BIN, [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    if (onPid) onPid(child.pid);
    const finish = (v) => { if (!done) { done = true; resolve({ ...v, pid: child.pid }); } };
    // Hard timeout: durationSec*2 + 5 phút (khớp deadline trong clip_grab.py).
    const killAt = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, (Number(params.maxSeconds) || 1800) * 2000 + 300000);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { clearTimeout(killAt); finish({ code: -1, stderr: `spawn: ${e.message}`, stdout }); });
    child.on("close", (code) => { clearTimeout(killAt); finish({ code, stderr, stdout }); });
    child.stdin.write(JSON.stringify(params));
    child.stdin.end();
  });
}

async function processJob(job) {
  ensureUploadDir();
  const venue = await Venue.findById(job.venue).select("imouSession imouCreds").lean();
  const session = decryptVenueSession(venue);
  const creds = decryptVenueCreds(venue);
  if (!session && !creds) {
    await ClipJob.updateOne({ _id: job._id }, {
      status: "failed", error: "Sân chưa cấu hình phiên/creds Imou.", finishedAt: new Date(), progressPct: 0,
    });
    await notifyFailed(job, "Sân chưa cấu hình camera.");
    return;
  }

  const tmpOut = path.join(os.tmpdir(), `clip-${job._id}.mp4`);
  const params = {
    session: session || {},
    creds: creds || null,
    deviceId: job.deviceId,
    productId: job.productId || "",
    begin: job.beginLocal,
    end: job.endLocal,
    maxSeconds: job.durationSec + 2,
    out: tmpOut,
  };
  if (IMOU_PKG_PATH) params.pkgPath = IMOU_PKG_PATH;

  // Ước lượng tiến độ theo thời gian trôi (clip_grab không báo % chính xác).
  const startedMs = Date.now();
  const progTimer = setInterval(() => {
    const pct = Math.min(95, Math.round(((Date.now() - startedMs) / 1000) / job.durationSec * 100));
    ClipJob.updateOne({ _id: job._id, status: "processing" }, { progressPct: pct }).catch(() => {});
  }, 10000);

  let result;
  try {
    result = await spawnCutter(params, (pid) => {
      ClipJob.updateOne({ _id: job._id }, { workerPid: pid }).catch(() => {});
    });
  } finally {
    clearInterval(progTimer);
  }

  if (result.code === 0 && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 50000) {
    const finalPath = path.join(UPLOAD_DIR, `${job._id}.mp4`);
    try { fs.renameSync(tmpOut, finalPath); }
    catch { fs.copyFileSync(tmpOut, finalPath); try { fs.unlinkSync(tmpOut); } catch { /* */ } }
    const size = fs.statSync(finalPath).size;
    const expiresAt = new Date(Date.now() + CLIP_TTL_DAYS * 86400000);
    const fileUrl = `/uploads/clips/${job._id}.mp4`;
    await ClipJob.updateOne({ _id: job._id }, {
      status: "done", progressPct: 100, fileUrl, fileSize: size,
      finishedAt: new Date(), expiresAt, error: "",
    });
    console.log(`[clipWorker] job ${job._id} DONE ${size}B`);
    await notifyDone({ ...job, fileUrl });
    return;
  }

  // Dọn file tạm hỏng
  try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch { /* */ }

  // Lỗi tạm thời (cam bận) → requeue
  if (isTransient(result.code, result.stderr) && (job.attempts || 0) < MAX_ATTEMPTS) {
    const nextAttemptAt = new Date(Date.now() + 2 * 60000);
    await ClipJob.updateOne({ _id: job._id }, {
      status: "queued", progressPct: 0, nextAttemptAt,
      error: "Camera đang bận — sẽ tự thử lại.",
    });
    console.log(`[clipWorker] job ${job._id} TRANSIENT → requeue @${nextAttemptAt.toISOString()}`);
    return;
  }

  const msg = friendlyError(result.code, result.stderr);
  await ClipJob.updateOne({ _id: job._id }, {
    status: "failed", progressPct: 0, error: msg, finishedAt: new Date(),
  });
  console.error(`[clipWorker] job ${job._id} FAILED code=${result.code} :: ${String(result.stderr).slice(-300)}`);
  await notifyFailed(job, msg);
}

async function tick() {
  if (!running || active >= CONCURRENCY) return;
  let job;
  try {
    job = await ClipJob.findOneAndUpdate(
      {
        status: "queued",
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
      },
      { status: "processing", startedAt: new Date(), progressPct: 0, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, new: true },
    ).lean();
  } catch (e) {
    console.error("[clipWorker] claim error:", e?.message || e);
    return;
  }
  if (!job) return;

  active += 1;
  processJob(job)
    .catch(async (e) => {
      console.error("[clipWorker] processJob threw:", e?.message || e);
      await ClipJob.updateOne({ _id: job._id }, {
        status: "failed", error: "Lỗi xử lý nội bộ.", finishedAt: new Date(),
      }).catch(() => {});
    })
    .finally(() => { active -= 1; });
}

async function cleanup() {
  try {
    const expired = await ClipJob.find({ expiresAt: { $lte: new Date() } }).select("_id fileUrl").lean();
    for (const j of expired) {
      if (j.fileUrl) {
        const p = path.resolve(process.cwd(), "." + j.fileUrl); // /uploads/... → ./uploads/...
        try { fs.unlinkSync(p); } catch { /* file có thể đã mất */ }
      }
      await ClipJob.deleteOne({ _id: j._id }).catch(() => {});
    }
    if (expired.length) console.log(`[clipWorker] cleanup xoá ${expired.length} clip hết hạn`);
  } catch (e) { console.error("[clipWorker] cleanup:", e?.message || e); }
}

/** Khởi động worker (gọi 1 lần ở background-leader trong server.js). */
export async function startClipWorker() {
  if (running) return;
  running = true;
  ensureUploadDir();
  // Boot recovery: job kẹt 'processing' do crash → trả về queued.
  try {
    const r = await ClipJob.updateMany({ status: "processing" }, { status: "queued", progressPct: 0 });
    if (r?.modifiedCount) console.log(`[clipWorker] recover ${r.modifiedCount} job kẹt processing → queued`);
  } catch (e) { console.error("[clipWorker] recovery:", e?.message || e); }

  pollTimer = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
  cleanupTimer = setInterval(() => { cleanup().catch(() => {}); }, 3600000);
  cleanup().catch(() => {});
  console.log(`[clipWorker] started (concurrency=${CONCURRENCY}, poll=${POLL_MS}ms, ttl=${CLIP_TTL_DAYS}d)`);
}

export function stopClipWorker() {
  running = false;
  if (pollTimer) clearInterval(pollTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  pollTimer = cleanupTimer = null;
}
