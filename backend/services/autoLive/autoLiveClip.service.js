// Cắt clip TỪNG TRẬN từ bản ghi của phiên auto-live "xuyên suốt" rồi upload Drive.
//
// Luồng:
//   1) worker desktop ghi segment MP4 local: tên `rec-<runEpochSec>-<index>.mp4`
//      (runEpochSec = time.time() lúc ffmpeg run bắt đầu; index tăng 000,001,...).
//   2) Trong khung giờ đêm, desktop đẩy từng segment về:
//        POST /internal/recording/segment?sessionId=&file=  (body = nội dung file)
//      → lưu vào SEG_ROOT/<sessionId>/<file>.
//   3) pollOnce (đổi trận) / stopAutoLive tạo AutoLiveClip {match,startAt,endAt}.
//   4) Worker này (setInterval) quét AutoLiveClip "pending": nếu ĐỦ segment phủ
//      [startAt,endAt] đã có trên server → cắt (concat + -ss/-t -c copy) → upload
//      Drive (uploadRecordingToDrive) → set Match.video + status "done".
//   5) Khi mọi clip của phiên đã xong và phiên đã stopped → dọn SEG_ROOT/<sid>.
//
// Mốc thời gian: startMs mỗi segment = runEpoch + tổng thời lượng các segment
// trước nó (probe bằng ffmpeg -i) → chống trôi (drift) do GOP; dùng epoch UTC nên
// không lệch múi giờ với Match.startedAt/finishedAt.
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

import Match from "../../models/matchModel.js";
import Tournament from "../../models/tournamentModel.js";
import AutoLiveClip from "../../models/autoLiveClipModel.js";
import TournamentAutoLiveSession from "../../models/tournamentAutoLiveSessionModel.js";
import { uploadRecordingToDrive } from "../driveRecordings.service.js";
import { getLiveRecordingExportWindowDecision } from "../liveRecordingExportWindow.service.js";

export const SEGMENT_SEC = 300; // độ dài mỗi segment ghi (đồng bộ với worker desktop)
const SEG_ROOT = path.join(os.tmpdir(), "autolive-rec");
const GAP_TOLERANCE_MS = 4000; // khe hở giữa 2 segment liền kề vẫn coi là liên tục
const MAX_ATTEMPTS = 5;
const WORKER_TICK_MS = 60_000;

// ── Lưu trữ segment ────────────────────────────────────────────────────────
export function segmentDir(sessionId) {
  return path.join(SEG_ROOT, String(sessionId));
}

const SEG_NAME_RE = /^rec-(\d+)-(\d+)\.mp4$/;
function parseSegName(name) {
  const m = SEG_NAME_RE.exec(String(name || ""));
  if (!m) return null;
  return { runEpoch: Number(m[1]), index: Number(m[2]) };
}

/** Nhận 1 segment từ desktop (stream) → ghi ra đĩa. Trả {saved, name, bytes}. */
export async function saveSegmentStream(sessionId, fileName, reqStream) {
  const name = path.basename(String(fileName || ""));
  if (!parseSegName(name)) {
    const e = new Error("Tên segment không hợp lệ (rec-<epoch>-<index>.mp4)");
    e.status = 400; throw e;
  }
  const dir = segmentDir(sessionId);
  await fsp.mkdir(dir, { recursive: true });
  const dest = path.join(dir, name);
  const tmp = dest + ".part";
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    reqStream.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    reqStream.pipe(out);
  });
  await fsp.rename(tmp, dest);
  const st = await fsp.stat(dest);
  return { saved: true, name, bytes: st.size };
}

async function listSegmentFiles(sessionId) {
  const dir = segmentDir(sessionId);
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  return names.filter((n) => parseSegName(n)).map((n) => ({ name: n, ...parseSegName(n) }));
}

// ── Probe thời lượng (dùng chính ffmpeg-static, parse stderr) ────────────────
function probeDurationMs(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegStatic, ["-hide_banner", "-i", inputPath], {
      stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      if (!m) return resolve(0);
      const sec = (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
      resolve(Math.round(sec * 1000));
    });
  });
}

/** Xây timeline tuyệt đối cho từng segment: startMs = runEpoch*1000 + Σ dur trước. */
async function buildTimeline(sessionId) {
  const dir = segmentDir(sessionId);
  const files = await listSegmentFiles(sessionId);
  // Nhóm theo runEpoch, sắp theo index; cộng dồn thời lượng trong từng run.
  const byRun = new Map();
  for (const f of files) {
    if (!byRun.has(f.runEpoch)) byRun.set(f.runEpoch, []);
    byRun.get(f.runEpoch).push(f);
  }
  const timeline = [];
  for (const [runEpoch, arr] of byRun) {
    arr.sort((a, b) => a.index - b.index);
    let cursor = runEpoch * 1000;
    for (const f of arr) {
      const p = path.join(dir, f.name);
      const durMs = await probeDurationMs(p);
      if (durMs <= 0) continue;
      timeline.push({ path: p, startMs: cursor, endMs: cursor + durMs, durMs });
      cursor += durMs;
    }
  }
  timeline.sort((a, b) => a.startMs - b.startMs);
  return timeline;
}

/** Tìm dãy segment liên tục phủ [startMs,endMs]. null nếu chưa đủ (chờ upload). */
function coveringSegments(timeline, startMs, endMs) {
  const cov = timeline.filter((s) => s.endMs > startMs && s.startMs < endMs);
  if (!cov.length) return null;
  cov.sort((a, b) => a.startMs - b.startMs);
  if (cov[0].startMs > startMs) return null;           // chưa có phần đầu trận
  if (cov[cov.length - 1].endMs < endMs) return null;  // chưa có phần cuối trận
  for (let i = 1; i < cov.length; i++) {
    if (cov[i].startMs - cov[i - 1].endMs > GAP_TOLERANCE_MS) return null; // đứt khúc
  }
  return cov;
}

// ── Cắt clip (concat + copy) ────────────────────────────────────────────────
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-800) || `ffmpeg code ${code}`)));
  });
}

async function cutClip(cov, startMs, endMs, outPath) {
  const relStartSec = Math.max(0, (startMs - cov[0].startMs) / 1000);
  const durSec = Math.max(1, (endMs - startMs) / 1000);
  const listPath = outPath + ".concat.txt";
  const body = cov.map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  await fsp.writeFile(listPath, body, "utf8");
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0",
      "-ss", relStartSec.toFixed(3), "-i", listPath,
      "-t", durSec.toFixed(3),
      "-c", "copy", "-movflags", "+faststart", "-y", outPath,
    ]);
  } finally {
    fsp.unlink(listPath).catch(() => {});
  }
}

// ── Tạo task khi trận kết thúc ──────────────────────────────────────────────
/** Tạo AutoLiveClip cho 1 trận vừa kết thúc (live xuyên suốt + recordClips). */
export async function createClipTaskForEndedMatch(session, matchId, { startAt, endAt } = {}) {
  try {
    if (!session?.recordClips || !matchId) return;
    const m = await Match.findById(matchId).select("startedAt finishedAt code labelKey").lean();
    const s = startAt || m?.startedAt || session.lastMatchChangeAt;
    const e = endAt || m?.finishedAt || new Date();
    if (!s || !e || new Date(e) <= new Date(s)) return; // mốc không hợp lệ → bỏ
    const tour = await Tournament.findById(session.tournament).select("name").lean();
    const label = m?.code || m?.labelKey || "";
    const title = `${tour?.name || "PickleTour"}${label ? " - " + label : ""}`.slice(0, 200);
    await AutoLiveClip.updateOne(
      { session: session._id, match: matchId },
      {
        $setOnInsert: {
          session: session._id, tournament: session.tournament, court: session.court,
          match: matchId, title, startAt: new Date(s), endAt: new Date(e), status: "pending",
        },
      },
      { upsert: true }
    );
    console.log(`[autolive-clip] tạo task clip match=${matchId} [${new Date(s).toISOString()} → ${new Date(e).toISOString()}]`);
  } catch (err) {
    console.warn("[autolive-clip] tạo task lỗi:", err?.message || err);
  }
}

// ── Kế hoạch cho desktop (poll): có nên upload segment lúc này không ─────────
export function recordingUploadAllowedNow() {
  // Tái dùng khung giờ đêm của recording (mặc định 02:00–06:00). Nếu tắt gate thì
  // luôn cho upload (shouldQueueNow=true).
  try { return !!getLiveRecordingExportWindowDecision(new Date()).shouldQueueNow; }
  catch { return true; }
}

export async function recordingPlan(sessionId) {
  const s = await TournamentAutoLiveSession.findById(sessionId).select("recordClips status").lean();
  if (!s) return { ok: false };
  const files = await listSegmentFiles(sessionId);
  return {
    ok: true,
    recordClips: !!s.recordClips,
    uploadNow: !!s.recordClips && recordingUploadAllowedNow(),
    segmentSec: SEGMENT_SEC,
    have: files.map((f) => f.name), // segment server đã có → desktop khỏi gửi lại
  };
}

// ── Worker xử lý clip (setInterval) ─────────────────────────────────────────
let _workerTimer = null;
let _processing = false;

async function processPendingClips() {
  if (_processing) return;
  _processing = true;
  try {
    const pending = await AutoLiveClip.find({ status: "pending", attempts: { $lt: MAX_ATTEMPTS } })
      .sort({ createdAt: 1 }).limit(20).lean();
    // Nhóm theo phiên để chỉ build timeline 1 lần / phiên.
    const bySession = new Map();
    for (const c of pending) {
      const k = String(c.session);
      if (!bySession.has(k)) bySession.set(k, []);
      bySession.get(k).push(c);
    }
    for (const [sid, clips] of bySession) {
      let timeline;
      try { timeline = await buildTimeline(sid); } catch { timeline = []; }
      if (!timeline.length) continue;
      for (const clip of clips) {
        const cov = coveringSegments(timeline, new Date(clip.startAt).getTime(), new Date(clip.endAt).getTime());
        if (!cov) continue; // chưa đủ segment → chờ lần sau
        await processOneClip(clip, cov);
      }
    }
    await cleanupFinishedSessions();
  } catch (e) {
    console.warn("[autolive-clip] worker tick lỗi:", e?.message || e);
  } finally {
    _processing = false;
  }
}

async function processOneClip(clip, cov) {
  const claimed = await AutoLiveClip.findOneAndUpdate(
    { _id: clip._id, status: "pending" },
    { $set: { status: "cutting", startedProcessingAt: new Date(), lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!claimed) return; // đã bị tick khác chiếm
  const startMs = new Date(clip.startAt).getTime();
  const endMs = new Date(clip.endAt).getTime();
  const outPath = path.join(segmentDir(clip.session), `clip-${clip.match}-${Date.now()}.mp4`);
  try {
    await cutClip(cov, startMs, endMs, outPath);
    const st = await fsp.stat(outPath);
    await AutoLiveClip.updateOne({ _id: clip._id }, { $set: { status: "uploading", fileSizeBytes: st.size } });
    const fileName = `${(clip.title || "clip").replace(/[^\p{L}\p{N} _.-]/gu, "").trim() || "clip"}.mp4`;
    const drive = await uploadRecordingToDrive({ filePath: outPath, fileName, mimeType: "video/mp4" });
    const viewUrl = drive?.previewUrl || drive?.rawUrl || "";
    await AutoLiveClip.updateOne({ _id: clip._id }, {
      $set: {
        status: "done", driveFileId: drive?.fileId || "", driveUrl: viewUrl,
        clipDurationSec: Math.round((endMs - startMs) / 1000), finishedAt: new Date(), lastError: "",
      },
    });
    // Gán link xem lại (Drive VOD) vào trận — thay link live đã kết thúc.
    if (viewUrl) await Match.updateOne({ _id: clip.match }, { $set: { video: viewUrl } }).catch(() => {});
    console.log(`[autolive-clip] DONE match=${clip.match} → ${viewUrl}`);
  } catch (e) {
    const failed = (clip.attempts + 1) >= MAX_ATTEMPTS;
    await AutoLiveClip.updateOne({ _id: clip._id }, {
      $set: { status: failed ? "failed" : "pending", lastError: String(e?.message || e).slice(0, 500) },
    });
    console.warn(`[autolive-clip] cắt/upload lỗi match=${clip.match} (attempt ${clip.attempts + 1}):`, e?.message || e);
  } finally {
    fsp.unlink(outPath).catch(() => {});
  }
}

/** Dọn thư mục segment tạm khi phiên đã stopped và không còn clip pending/cutting. */
async function cleanupFinishedSessions() {
  let dirs = [];
  try { dirs = await fsp.readdir(SEG_ROOT); } catch { return; }
  for (const sid of dirs) {
    if (!/^[a-f0-9]{24}$/i.test(sid)) continue;
    const remaining = await AutoLiveClip.countDocuments({
      session: sid, status: { $in: ["pending", "cutting", "uploading"] },
    });
    if (remaining > 0) continue;
    const sess = await TournamentAutoLiveSession.findById(sid).select("status recordCleanedAt").lean();
    if (!sess) continue;
    if (!["stopped", "error"].includes(sess.status)) continue; // còn đang live → giữ segment
    try {
      await fsp.rm(segmentDir(sid), { recursive: true, force: true });
      await TournamentAutoLiveSession.updateOne({ _id: sid }, { $set: { recordCleanedAt: new Date() } });
      console.log(`[autolive-clip] đã dọn segment tạm phiên ${sid}`);
    } catch { /* để lần sau */ }
  }
}

export function startAutoLiveClipWorker() {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => { processPendingClips().catch(() => {}); }, WORKER_TICK_MS);
  if (_workerTimer.unref) _workerTimer.unref();
  console.log(`[autolive-clip] worker chạy (mỗi ${WORKER_TICK_MS / 1000}s)`);
}
