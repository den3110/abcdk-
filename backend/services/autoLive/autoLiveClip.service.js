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
import AutoLiveSegment from "../../models/autoLiveSegmentModel.js";
import LiveRecordingV2 from "../../models/liveRecordingV2Model.js";
import TournamentAutoLiveSession from "../../models/tournamentAutoLiveSessionModel.js";
import { uploadRecordingToDrive } from "../driveRecordings.service.js";
import { buildRecordingPlaybackUrl } from "../liveRecordingV2Export.service.js";
import {
  isRecordingR2Configured,
  getRecordingStorageTargets,
  createRecordingSegmentUploadUrl,
  putRecordingObjectFromFile,
  downloadRecordingObjectToFile,
  deleteRecordingObjects,
} from "../liveRecordingV2Storage.service.js";
import {
  loadLiveRecordingStorageTargetsConfig,
} from "../liveRecordingStorageTargetsConfig.service.js";

export const SEGMENT_SEC = 300; // độ dài mỗi segment ghi (đồng bộ với worker desktop)
// Segment auto-live giờ nằm trên Cloudflare R2 (giống bản mobile) — tiết kiệm đĩa VPS.
// SEG_ROOT chỉ còn dùng cho: (a) temp tải segment R2 về khi cắt, (b) phiên LEGACY còn
// segment nằm ở đĩa (tương thích ngược, dọn nốt).
const SEG_ROOT = path.join(os.tmpdir(), "autolive-rec");
// Prefix object trên R2 cho segment auto-live.
const r2PrefixForSession = (sid) => `autolive/segments/${String(sid)}`;
const r2KeyForSegment = (sid, name) => `${r2PrefixForSession(sid)}/${name}`;

// Chọn R2 target cho 1 phiên (ổn định theo sessionId → mọi segment cùng phiên vào cùng
// target, dễ dọn; trải tải giữa các phiên). Trả null nếu R2 chưa cấu hình.
async function pickTargetForSession(sessionId) {
  try { await loadLiveRecordingStorageTargetsConfig(); } catch { /* dùng cache/env */ }
  if (!isRecordingR2Configured()) return null;
  const targets = (getRecordingStorageTargets() || []).filter((t) => t?.enabled !== false && t?.id);
  if (!targets.length) return null;
  let h = 0;
  const s = String(sessionId);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return targets[h % targets.length];
}
const GAP_TOLERANCE_MS = 4000; // khe hở giữa 2 segment liền kề vẫn coi là liên tục
const MAX_ATTEMPTS = 5;
const WORKER_TICK_MS = 60_000;

// ── Lưu trữ segment ────────────────────────────────────────────────────────
export function segmentDir(sessionId) {
  return path.join(SEG_ROOT, String(sessionId));
}

// Segment ghi ở dạng MPEG-TS (chống hỏng khi crash, concat -c copy dễ). Tên:
// rec-<runEpochSec>-<index>.ts (runEpochSec = time.time() lúc ffmpeg run bắt đầu).
const SEG_NAME_RE = /^rec-(\d+)-(\d+)\.ts$/;
function parseSegName(name) {
  const m = SEG_NAME_RE.exec(String(name || ""));
  if (!m) return null;
  return { runEpoch: Number(m[1]), index: Number(m[2]) };
}

/** Thư mục temp (xoá ngay sau khi dùng) để relay/cắt — KHÔNG lưu lâu dài trên VPS. */
function tmpDir() {
  return path.join(SEG_ROOT, "_tmp");
}

/**
 * Nhận 1 segment từ desktop (stream) → RELAY thẳng lên R2 (không giữ ở đĩa VPS).
 * Dùng cho bản desktop CŨ (đang POST raw). Buffer tạm 1 file, probe thời lượng, PUT lên
 * R2, ghi registry, rồi xoá temp ngay. Trả {saved, name, bytes}.
 */
export async function saveSegmentStream(sessionId, fileName, reqStream) {
  const name = path.basename(String(fileName || ""));
  const parsed = parseSegName(name);
  if (!parsed) {
    const e = new Error("Tên segment không hợp lệ (rec-<epoch>-<index>.ts)");
    e.status = 400; throw e;
  }

  const target = await pickTargetForSession(sessionId);
  // R2 chưa cấu hình → fallback LƯU ĐĨA (giữ hành vi cũ, không mất clip).
  if (!target) {
    const dir = segmentDir(sessionId);
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, name);
    const tmp = dest + ".part";
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      reqStream.on("error", reject); out.on("error", reject); out.on("finish", resolve);
      reqStream.pipe(out);
    });
    await fsp.rename(tmp, dest);
    const st = await fsp.stat(dest);
    return { saved: true, name, bytes: st.size, storage: "disk" };
  }

  await fsp.mkdir(tmpDir(), { recursive: true });
  const tmp = path.join(tmpDir(), `${sessionId}-${name}-${Date.now()}.part`);
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      reqStream.on("error", reject); out.on("error", reject); out.on("finish", resolve);
      reqStream.pipe(out);
    });
    const st = await fsp.stat(tmp);
    const durMs = await probeDurationMs(tmp);
    const objectKey = r2KeyForSegment(sessionId, name);
    await putRecordingObjectFromFile({
      objectKey, filePath: tmp, contentType: "video/mp2t", storageTargetId: target.id,
    });
    await AutoLiveSegment.updateOne(
      { session: sessionId, name },
      { $set: {
          session: sessionId, name, runEpoch: parsed.runEpoch, index: parsed.index,
          objectKey, storageTargetId: target.id, bucketName: target.bucketName || "",
          durMs, sizeBytes: st.size,
        } },
      { upsert: true }
    );
    return { saved: true, name, bytes: st.size, storage: "r2" };
  } finally {
    fsp.unlink(tmp).catch(() => {});
  }
}

/** Cấp presigned PUT để desktop (bản mới) đẩy segment THẲNG lên R2 (không qua VPS). */
export async function presignSegment(sessionId, fileName) {
  const name = path.basename(String(fileName || ""));
  if (!parseSegName(name)) {
    const e = new Error("Tên segment không hợp lệ (rec-<epoch>-<index>.ts)");
    e.status = 400; throw e;
  }
  const target = await pickTargetForSession(sessionId);
  if (!target) { const e = new Error("R2 chưa cấu hình (admin live-playback)"); e.status = 503; throw e; }
  const objectKey = r2KeyForSegment(sessionId, name);
  const presigned = await createRecordingSegmentUploadUrl({
    objectKey, contentType: "video/mp2t", storageTargetId: target.id, expiresInSeconds: 1800,
  });
  return {
    uploadUrl: presigned.uploadUrl, objectKey,
    storageTargetId: target.id, bucketName: target.bucketName || "",
    contentType: "video/mp2t",
  };
}

/** Desktop (bản mới) báo đã PUT xong 1 segment lên R2 → ghi registry. */
export async function registerUploadedSegment(sessionId, body = {}) {
  const name = path.basename(String(body.file || body.name || ""));
  const parsed = parseSegName(name);
  if (!parsed) { const e = new Error("Tên segment không hợp lệ"); e.status = 400; throw e; }
  const objectKey = String(body.objectKey || r2KeyForSegment(sessionId, name));
  await AutoLiveSegment.updateOne(
    { session: sessionId, name },
    { $set: {
        session: sessionId, name, runEpoch: parsed.runEpoch, index: parsed.index,
        objectKey, storageTargetId: String(body.storageTargetId || ""),
        bucketName: String(body.bucketName || ""),
        durMs: Math.max(0, Number(body.durMs) || 0),
        sizeBytes: Math.max(0, Number(body.bytes || body.sizeBytes) || 0),
      } },
    { upsert: true }
  );
  return { ok: true, name };
}

/** Segment đã có của phiên: hợp nhất R2 (registry) + đĩa legacy. */
async function listSegmentFiles(sessionId) {
  const out = [];
  const seen = new Set();
  // R2 (registry)
  try {
    const docs = await AutoLiveSegment.find({ session: sessionId })
      .select("name runEpoch index objectKey storageTargetId durMs").lean();
    for (const d of docs) {
      if (seen.has(d.name)) continue; seen.add(d.name);
      out.push({ name: d.name, runEpoch: d.runEpoch, index: d.index,
        objectKey: d.objectKey, storageTargetId: d.storageTargetId, durMs: d.durMs || 0, r2: true });
    }
  } catch { /* ignore */ }
  // Đĩa legacy (phiên cũ còn file trên VPS)
  try {
    const dir = segmentDir(sessionId);
    const names = await fsp.readdir(dir);
    for (const n of names) {
      const p = parseSegName(n);
      if (!p || seen.has(n)) continue; seen.add(n);
      out.push({ name: n, ...p, path: path.join(dir, n), r2: false });
    }
  } catch { /* không có thư mục legacy */ }
  return out;
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

// Cache thời lượng segment (segment bất biến sau khi upload) → khỏi probe lại mỗi tick.
const _durCache = new Map(); // `${path}:${size}` -> durMs
async function probeDurationCached(p) {
  let size = 0;
  try { size = (await fsp.stat(p)).size; } catch { return 0; }
  const key = `${p}:${size}`;
  if (_durCache.has(key)) return _durCache.get(key);
  const durMs = await probeDurationMs(p);
  if (durMs > 0) _durCache.set(key, durMs);
  return durMs;
}

/** Xây timeline tuyệt đối cho từng segment: startMs = runEpoch*1000 + Σ dur trước.
 *  Segment R2 lấy durMs từ registry (không tải/probe); segment đĩa legacy thì probe. */
async function buildTimeline(sessionId) {
  const files = await listSegmentFiles(sessionId);
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
      let durMs = Number(f.durMs) || 0;
      if (durMs <= 0 && f.path) durMs = await probeDurationCached(f.path); // legacy đĩa
      if (durMs <= 0) continue; // R2 chưa có dur hợp lệ → bỏ qua tới khi có
      timeline.push({
        name: f.name,
        path: f.path || null,                 // có = đĩa legacy; null = trên R2
        objectKey: f.objectKey || null,
        storageTargetId: f.storageTargetId || null,
        startMs: cursor, endMs: cursor + durMs, durMs,
      });
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
  // Segment R2 → tải về temp trước khi concat; segment đĩa legacy dùng path sẵn.
  const dlDir = path.join(tmpDir(), `cut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const toCleanup = [];
  try {
    await fsp.mkdir(dlDir, { recursive: true });
    const localPaths = [];
    for (const s of cov) {
      if (s.path) { localPaths.push(s.path); continue; }
      if (!s.objectKey) throw new Error(`segment thiếu objectKey: ${s.name}`);
      const dest = path.join(dlDir, s.name);
      await downloadRecordingObjectToFile({
        objectKey: s.objectKey, targetPath: dest, storageTargetId: s.storageTargetId || null,
      });
      localPaths.push(dest); toCleanup.push(dest);
    }
    const body = localPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
    await fsp.writeFile(listPath, body, "utf8");
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0",
      "-ss", relStartSec.toFixed(3), "-i", listPath,
      "-t", durSec.toFixed(3),
      // TS(ADTS AAC) → MP4 cần aac_adtstoasc; copy video (không encode lại).
      "-c", "copy", "-bsf:a", "aac_adtstoasc",
      "-movflags", "+faststart", "-y", outPath,
    ]);
  } finally {
    fsp.unlink(listPath).catch(() => {});
    for (const p of toCleanup) fsp.unlink(p).catch(() => {});
    fsp.rm(dlDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Tạo task khi trận kết thúc ──────────────────────────────────────────────
/** Tạo AutoLiveClip cho 1 trận vừa kết thúc (live xuyên suốt + recordClips). */
export async function createClipTaskForEndedMatch(session, matchId, { startAt, endAt } = {}) {
  try {
    if (!session?.recordClips || !matchId) return;
    const m = await Match.findById(matchId).select("startedAt finishedAt code labelKey").lean();
    // Ưu tiên mốc CHÍNH XÁC của trận (startedAt/finishedAt), fallback mốc poll.
    const s = m?.startedAt || startAt || session.lastMatchChangeAt;
    const e = m?.finishedAt || endAt || new Date();
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

// ── Kế hoạch cho desktop (poll) ──────────────────────────────────────────────
// Đẩy REAL-TIME (giống điện thoại đẩy R2 khi máy còn bật): server luôn cho upload
// khi recordClips bật → desktop tắt ban đêm vẫn OK vì segment đã nằm trên server.
// Việc cắt + upload Drive do SERVER làm độc lập (worker dưới).
export async function recordingPlan(sessionId) {
  const s = await TournamentAutoLiveSession.findById(sessionId).select("recordClips status").lean();
  if (!s) return { ok: false };
  const files = await listSegmentFiles(sessionId);
  // r2Direct=true → desktop (bản mới) xin presign rồi PUT THẲNG lên R2 (không qua VPS).
  // Nếu R2 chưa cấu hình, desktop cứ POST raw như cũ (server tự lưu đĩa fallback).
  let r2Direct = false;
  try { r2Direct = !!(await pickTargetForSession(sessionId)); } catch { r2Direct = false; }
  return {
    ok: true,
    recordClips: !!s.recordClips,
    uploadNow: !!s.recordClips,
    segmentSec: SEGMENT_SEC,
    r2Direct,
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
      // Dọn segment nguồn đã dùng xong (không phình đĩa server giữa sự kiện dài).
      await cleanupOldSegments(sid, timeline).catch(() => {});
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
  await fsp.mkdir(tmpDir(), { recursive: true });
  const outPath = path.join(tmpDir(), `clip-${clip.match}-${Date.now()}.mp4`);
  try {
    await cutClip(cov, startMs, endMs, outPath);
    const st = await fsp.stat(outPath);
    await AutoLiveClip.updateOne({ _id: clip._id }, { $set: { status: "uploading", fileSizeBytes: st.size } });
    const fileName = `${(clip.title || "clip").replace(/[^\p{L}\p{N} _.-]/gu, "").trim() || "clip"}.mp4`;
    const drive = await uploadRecordingToDrive({ filePath: outPath, fileName, mimeType: "video/mp4" });
    const durSec = Math.round((endMs - startMs) / 1000);
    // GIỐNG BẢN MOBILE NATIVE: tạo bản ghi LiveRecordingV2 "ready" trỏ tới file Drive,
    // rồi gán match.video = playbackUrl (endpoint /play proxy stream Drive, hỗ trợ
    // range/seek) thay vì link Drive thô. Upsert theo recordingSessionId → idempotent.
    let viewUrl = drive?.previewUrl || drive?.rawUrl || "";
    try {
      const rec = await LiveRecordingV2.findOneAndUpdate(
        { recordingSessionId: `autolive-clip-${clip._id}` },
        { $set: {
            match: clip.match, mode: "RECORD_ONLY", status: "ready",
            driveFileId: drive?.fileId || "", driveRawUrl: drive?.rawUrl || "",
            drivePreviewUrl: drive?.previewUrl || "",
            sizeBytes: st.size, durationSeconds: durSec,
            finalizedAt: new Date(), readyAt: new Date(),
            meta: { source: { type: "autolive_clip" }, autoLiveClipId: String(clip._id) },
          } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      const playbackUrl = buildRecordingPlaybackUrl(rec._id);
      if (rec.playbackUrl !== playbackUrl) {
        rec.playbackUrl = playbackUrl;
        await rec.save();
      }
      viewUrl = playbackUrl || viewUrl;
    } catch (e) {
      // Không tạo được LiveRecordingV2 → vẫn dùng link Drive trực tiếp làm fallback.
      console.warn("[autolive-clip] tạo LiveRecordingV2 lỗi:", e?.message || e);
    }
    await AutoLiveClip.updateOne({ _id: clip._id }, {
      $set: {
        status: "done", driveFileId: drive?.fileId || "", driveUrl: viewUrl,
        clipDurationSec: durSec, finishedAt: new Date(), lastError: "",
      },
    });
    // Gán link xem lại vào trận — thay link live đã kết thúc (giống mobile native).
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

/** Xoá hẳn 1 segment (R2 object + registry; hoặc file đĩa legacy). */
async function deleteSegment(seg) {
  if (seg.objectKey) {
    try {
      await deleteRecordingObjects([seg.objectKey], { storageTargetId: seg.storageTargetId || null });
    } catch { /* thử lần sau */ }
  }
  if (seg.path) { try { await fsp.unlink(seg.path); } catch { /* đã xoá */ } }
  if (seg.name) { try { await AutoLiveSegment.deleteOne({ session: seg.session, name: seg.name }); } catch { /* ignore */ } }
}

/** Dọn segment khi phiên đã stopped và không còn clip pending/cutting (R2 + đĩa legacy). */
async function cleanupFinishedSessions() {
  // Gộp các phiên có segment: trên R2 (registry) + đĩa legacy.
  const sids = new Set();
  try {
    const rows = await AutoLiveSegment.distinct("session");
    rows.forEach((s) => sids.add(String(s)));
  } catch { /* ignore */ }
  try {
    const dirs = await fsp.readdir(SEG_ROOT);
    dirs.filter((d) => /^[a-f0-9]{24}$/i.test(d)).forEach((d) => sids.add(d));
  } catch { /* ignore */ }

  for (const sid of sids) {
    const remaining = await AutoLiveClip.countDocuments({
      session: sid, status: { $in: ["pending", "cutting", "uploading"] },
    });
    if (remaining > 0) continue;
    const sess = await TournamentAutoLiveSession.findById(sid).select("status").lean();
    if (!sess) continue;
    if (!["stopped", "error"].includes(sess.status)) continue; // còn đang live → giữ segment
    try {
      // Xoá R2 objects của phiên
      const segs = await AutoLiveSegment.find({ session: sid }).select("name objectKey storageTargetId").lean();
      const byTarget = new Map();
      for (const s of segs) {
        if (!s.objectKey) continue;
        const t = s.storageTargetId || "";
        if (!byTarget.has(t)) byTarget.set(t, []);
        byTarget.get(t).push(s.objectKey);
      }
      for (const [t, keys] of byTarget) {
        await deleteRecordingObjects(keys, { storageTargetId: t || null }).catch(() => {});
      }
      await AutoLiveSegment.deleteMany({ session: sid });
      await fsp.rm(segmentDir(sid), { recursive: true, force: true }).catch(() => {});
      await TournamentAutoLiveSession.updateOne({ _id: sid }, { $set: { recordCleanedAt: new Date() } });
      console.log(`[autolive-clip] đã dọn segment phiên ${sid} (R2:${segs.length})`);
    } catch { /* để lần sau */ }
  }
}

/** Dọn segment nguồn đã dùng xong (tăng dần) — giữ R2/đĩa gọn giữa sự kiện dài.
 *  Chỉ xoá segment kết thúc TRƯỚC mốc còn cần (min của: clip pending sớm nhất, clip
 *  done muộn nhất) → không đụng segment của trận đang diễn ra / clip chờ xử lý. */
async function cleanupOldSegments(sessionId, timeline) {
  try {
    const done = await AutoLiveClip.find({ session: sessionId, status: "done" }).select("endAt").lean();
    if (!done.length) return; // chưa clip nào xong → giữ hết cho an toàn
    const pend = await AutoLiveClip.find({
      session: sessionId, status: { $in: ["pending", "cutting", "uploading"] },
    }).select("startAt").lean();
    const maxDoneEnd = Math.max(...done.map((c) => new Date(c.endAt).getTime()));
    const minPendStart = pend.length ? Math.min(...pend.map((c) => new Date(c.startAt).getTime())) : Infinity;
    const keepFrom = Math.min(maxDoneEnd, minPendStart);
    for (const seg of timeline) {
      if (seg.endMs <= keepFrom) {
        await deleteSegment({ ...seg, session: sessionId });
      }
    }
  } catch { /* bỏ qua, thử lần sau */ }
}

/** Danh sách clip cho admin giám sát (lọc theo tournament/session/status). */
export async function listClips({ tournamentId, sessionId, status, limit = 200 } = {}) {
  const q = {};
  if (tournamentId) q.tournament = tournamentId;
  if (sessionId) q.session = sessionId;
  if (status) q.status = status;
  const rows = await AutoLiveClip.find(q)
    .sort({ createdAt: -1 }).limit(Math.min(500, Number(limit) || 200))
    .populate("match", "code labelKey")
    .populate("tournament", "name")
    .lean();
  return rows.map((r) => ({
    _id: r._id,
    tournamentName: r.tournament?.name || "",
    matchCode: r.match?.code || r.match?.labelKey || "",
    title: r.title || "",
    status: r.status,
    driveUrl: r.driveUrl || "",
    driveFileId: r.driveFileId || "",
    clipDurationSec: r.clipDurationSec || 0,
    fileSizeBytes: r.fileSizeBytes || 0,
    startAt: r.startAt, endAt: r.endAt,
    attempts: r.attempts || 0,
    lastError: r.lastError || "",
    createdAt: r.createdAt, finishedAt: r.finishedAt,
  }));
}

export function startAutoLiveClipWorker() {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => { processPendingClips().catch(() => {}); }, WORKER_TICK_MS);
  if (_workerTimer.unref) _workerTimer.unref();
  console.log(`[autolive-clip] worker chạy (mỗi ${WORKER_TICK_MS / 1000}s)`);
}
