// services/youtubeLiveTest.service.js
// Test live YouTube nhiều luồng cùng lúc: mỗi luồng = 1 broadcast + 1 liveStream RIÊNG
// (dedicatedStream) trên kênh đã kết nối; ffmpeg đẩy TEST PATTERN (không cần camera).
// Dùng /usr/bin/ffmpeg (FFMPEG_PATH) — ffmpeg-static segfault khi rtmps.
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";

import YtLiveTestSession from "../models/ytLiveTestSessionModel.js";
import { YouTubeProvider } from "./liveProviders/youtube.js";
import { getCfgStr } from "./config.service.js";

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const MAX_COUNT = Math.max(1, Number(process.env.YT_LIVE_TEST_MAX || 6));
const AUTO_STOP_MIN = Math.max(1, Number(process.env.YT_LIVE_TEST_AUTOSTOP_MIN || 15));

const _procs = new Map();

async function getProvider() {
  const refreshToken = (await getCfgStr("YOUTUBE_REFRESH_TOKEN", "")).trim();
  if (!refreshToken) {
    const err = new Error("Chưa kết nối YouTube (thiếu YOUTUBE_REFRESH_TOKEN). Vào YouTube Live Admin để connect.");
    err.status = 400;
    throw err;
  }
  return new YouTubeProvider({ refreshToken, accessToken: "", expiresAt: "" });
}

function ffmpegArgs(rtmpUrl) {
  return [
    "-nostdin", "-re",
    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
    "-pix_fmt", "yuv420p", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-f", "flv", rtmpUrl,
  ];
}

async function finishAsError(sessionId, reason) {
  try {
    const doc = await YtLiveTestSession.findOne({ sessionId });
    if (doc && ["starting", "live"].includes(doc.status)) {
      doc.status = "error";
      doc.error = String(reason || "ffmpeg dừng").slice(0, 900);
      doc.stoppedAt = new Date();
      await doc.save();
      await cleanupBroadcast(doc).catch(() => {});
    }
  } catch {}
}

async function cleanupBroadcast(doc) {
  if (!doc?.broadcastId && !doc?.streamId) return;
  try {
    const provider = await getProvider();
    await provider.endAndDelete({ broadcastId: doc.broadcastId, streamId: doc.streamId });
  } catch {}
}

function spawnPusher(sessionId, rtmpUrl) {
  let proc;
  try {
    proc = spawn(FFMPEG_BIN, ffmpegArgs(rtmpUrl), { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    finishAsError(sessionId, `Không chạy được ffmpeg: ${e?.message || e}`);
    return null;
  }
  _procs.set(sessionId, proc);

  let stderrTail = "";
  proc.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-2500);
  });
  proc.on("error", (e) => {
    _procs.delete(sessionId);
    finishAsError(sessionId, `ffmpeg lỗi khởi chạy: ${e?.message || e}`);
  });
  proc.on("close", async (code, signal) => {
    _procs.delete(sessionId);
    const tail = stderrTail.split("\n").map((l) => l.trim()).filter(Boolean).slice(-5).join(" | ");
    console.error(`[yt-live-test] ffmpeg exit (${sessionId}) code=${code} signal=${signal}\n${stderrTail.slice(-1500)}`);
    const doc = await YtLiveTestSession.findOne({ sessionId }).catch(() => null);
    if (doc && ["starting", "live"].includes(doc.status)) {
      const reason = signal ? `bị tín hiệu ${signal}` : `thoát code ${code}`;
      doc.status = code === 0 && !signal ? "stopped" : "error";
      if (doc.status === "error") doc.error = `ffmpeg ${reason}${tail ? ` — ${tail}` : ""}`.slice(0, 900);
      doc.stoppedAt = new Date();
      await doc.save().catch(() => {});
      await cleanupBroadcast(doc).catch(() => {});
    }
  });
  return proc;
}

/** Bắt đầu N luồng test trên kênh YouTube (mỗi luồng 1 broadcast+stream riêng). */
export async function startYtLiveTests({ count = 2, startedBy = "" } = {}) {
  const want = Math.min(MAX_COUNT, Math.max(1, Number(count) || 1));
  const created = [];
  const provider = await getProvider();
  const privacy = (await getCfgStr("YT_BROADCAST_PRIVACY", "unlisted")).trim() || "unlisted";

  for (let i = 0; i < want; i += 1) {
    const sessionId = randomUUID();
    const title = `🔴 TEST LIVE #${i + 1} — PickleTour`;
    const doc = await YtLiveTestSession.create({
      sessionId,
      title,
      status: "starting",
      startedBy,
      autoStopAt: new Date(Date.now() + AUTO_STOP_MIN * 60 * 1000),
    });
    try {
      const live = await provider.createLive({
        title,
        description: "Phiên test đa luồng YouTube (test pattern).",
        privacy,
        dedicatedStream: true,
      });
      const serverUrl = String(live?.serverUrl || "").replace(/\/+$/, "");
      const streamKey = live?.streamKey;
      if (!serverUrl || !streamKey) throw new Error("YouTube không trả ingestion (serverUrl/streamKey)");
      const rtmpUrl = `${serverUrl}/${streamKey}`;

      doc.broadcastId = live.platformLiveId || "";
      doc.streamId = live.streamId || "";
      doc.permalinkUrl = live.permalinkUrl || "";
      doc.status = "live";
      doc.hostPid = process.pid;
      await doc.save();

      spawnPusher(sessionId, rtmpUrl);
      created.push({ sessionId, broadcastId: doc.broadcastId, permalinkUrl: doc.permalinkUrl, title, status: "live" });
    } catch (err) {
      doc.status = "error";
      doc.error = err?.response?.data?.error?.message || err?.errors?.[0]?.message || err?.message || "Lỗi tạo live";
      doc.stoppedAt = new Date();
      await doc.save();
      await cleanupBroadcast(doc).catch(() => {});
      created.push({ sessionId, title, status: "error", error: doc.error });
      // Nếu lỗi quyền/giới hạn kênh → các luồng sau cũng lỗi tương tự, dừng sớm.
      if (/quota|limit|permission|not enabled|liveStreamingNotEnabled|too many/i.test(doc.error)) break;
    }
  }

  return { created, count: created.length, max: MAX_COUNT };
}

export async function listYtLiveTestSessions({ activeOnly = false } = {}) {
  const filter = activeOnly ? { status: { $in: ["starting", "live"] } } : {};
  const items = await YtLiveTestSession.find(filter).sort({ startedAt: -1 }).limit(100).lean();
  return items;
}

export async function stopYtLiveTestSession(sessionId) {
  const doc = await YtLiveTestSession.findOne({ sessionId });
  if (!doc) return { ok: false, reason: "not-found" };
  const proc = _procs.get(sessionId);
  if (proc) {
    try { proc.kill("SIGKILL"); } catch {}
    _procs.delete(sessionId);
  }
  await cleanupBroadcast(doc).catch(() => {});
  if (["starting", "live"].includes(doc.status)) {
    doc.status = "stopped";
    doc.stoppedAt = new Date();
    await doc.save();
  }
  return { ok: true, sessionId };
}

export async function stopAllYtLiveTestSessions() {
  const active = await YtLiveTestSession.find({ status: { $in: ["starting", "live"] } }).select("sessionId").lean();
  let stopped = 0;
  for (const s of active) {
    const r = await stopYtLiveTestSession(s.sessionId);
    if (r.ok) stopped += 1;
  }
  return { ok: true, stopped };
}

export async function sweepYtLiveTestAutoStop() {
  const due = await YtLiveTestSession.find({
    status: { $in: ["starting", "live"] },
    autoStopAt: { $lte: new Date() },
  }).select("sessionId").lean();
  for (const s of due) await stopYtLiveTestSession(s.sessionId).catch(() => {});
  return { swept: due.length };
}

let _sweepTimer = null;
export function startYtLiveTestAutoStopSweep() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => { sweepYtLiveTestAutoStop().catch(() => {}); }, 60 * 1000);
  if (_sweepTimer.unref) _sweepTimer.unref();
}
