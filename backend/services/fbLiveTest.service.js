// services/fbLiveTest.service.js
// Test live nhiều page Facebook cùng lúc: mỗi phiên = 1 page rảnh + 1 live video +
// 1 tiến trình ffmpeg đẩy TEST PATTERN (không cần camera). Dùng để kiểm tra hệ thống
// chịu được bao nhiêu luồng đồng thời + token/page có live song song được không.
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";

// ⚠️ QUAN TRỌNG: đẩy RTMPS Facebook PHẢI dùng ffmpeg HỆ THỐNG (FFMPEG_PATH,
// vd /usr/bin/ffmpeg). Bản ffmpeg-static (johnvansickle static gnutls) BỊ SEGFAULT
// khi output rtmps → "code null". ffmpeg-static chỉ dùng làm fallback (dev/local).
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

import FbLiveTestSession from "../models/fbLiveTestSessionModel.js";
import {
  pickFreeFacebookPage,
  markFacebookPageBusy,
  markFacebookPageFreeByPage,
} from "./facebookPagePool.service.js";
import { getValidPageToken } from "./fbTokenService.js";
import {
  fbCreateLiveOnPage,
  fbGoLive,
  fbEndLiveVideo,
} from "./facebookLive.service.js";

// ffmpeg handle theo sessionId — chỉ tồn tại trong process đã spawn.
const _procs = new Map();

const MAX_COUNT = Math.max(1, Number(process.env.FB_LIVE_TEST_MAX || 10));
const AUTO_STOP_MIN = Math.max(1, Number(process.env.FB_LIVE_TEST_AUTOSTOP_MIN || 15));
// KHÔNG set busyMatch (field ObjectId ref Match) cho phiên test — sẽ CastError.
// Phiên test được theo dõi qua collection FbLiveTestSession (theo pageId).

function ffmpegArgs(secureStreamUrl, label = "") {
  // testsrc + tone sine, H.264/AAC, đẩy FLV vào RTMPS của Facebook.
  return [
    "-nostdin",
    "-re",
    "-f", "lavfi",
    "-i", `testsrc=size=1280x720:rate=30`,
    "-f", "lavfi",
    "-i", "sine=frequency=1000:sample_rate=44100",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-b:v", "2500k",
    "-maxrate", "2500k",
    "-bufsize", "5000k",
    "-pix_fmt", "yuv420p",
    "-g", "60",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-f", "flv",
    secureStreamUrl,
  ];
}

async function finishSessionAsError(sessionId, reason) {
  try {
    const doc = await FbLiveTestSession.findOne({ sessionId });
    if (doc && ["starting", "live"].includes(doc.status)) {
      doc.status = "error";
      doc.error = String(reason || "ffmpeg dừng").slice(0, 900);
      doc.stoppedAt = new Date();
      await doc.save();
      await markFacebookPageFreeByPage(doc.pageId, { delayMs: 0 }).catch(() => {});
    }
  } catch {}
}

function spawnPusher(sessionId, secureStreamUrl) {
  let proc;
  try {
    proc = spawn(FFMPEG_BIN, ffmpegArgs(secureStreamUrl), {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    finishSessionAsError(sessionId, `Không chạy được ffmpeg: ${e?.message || e}`);
    return null;
  }
  _procs.set(sessionId, proc);

  // Giữ lại đuôi log ffmpeg để biết lý do khi nó chết.
  let stderrTail = "";
  proc.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-2500);
  });

  proc.on("error", (e) => {
    _procs.delete(sessionId);
    console.error(`[fb-live-test] ffmpeg spawn error (${sessionId}):`, e?.message);
    finishSessionAsError(sessionId, `ffmpeg lỗi khởi chạy: ${e?.message || e}`);
  });

  proc.on("close", async (code, signal) => {
    _procs.delete(sessionId);
    const tail = stderrTail
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-5)
      .join(" | ");
    console.error(
      `[fb-live-test] ffmpeg exit (${sessionId}) code=${code} signal=${signal}\n${stderrTail.slice(-1500)}`
    );
    const doc = await FbLiveTestSession.findOne({ sessionId }).catch(() => null);
    if (doc && ["starting", "live"].includes(doc.status)) {
      const reason = signal ? `bị tín hiệu ${signal}` : `thoát code ${code}`;
      doc.status = code === 0 && !signal ? "stopped" : "error";
      if (doc.status === "error") {
        doc.error = `ffmpeg ${reason}${tail ? ` — ${tail}` : ""}`.slice(0, 900);
      }
      doc.stoppedAt = new Date();
      await doc.save().catch(() => {});
      await markFacebookPageFreeByPage(doc.pageId, { delayMs: 0 }).catch(() => {});
    }
  });
  return proc;
}

/**
 * Bắt đầu N phiên test trên N page rảnh.
 * Trả về danh sách phiên đã tạo (+ lý do dừng nếu hết page).
 */
export async function startFbLiveTests({ count = 3, startedBy = "" } = {}) {
  const want = Math.min(MAX_COUNT, Math.max(1, Number(count) || 1));
  const created = [];
  let stoppedReason = "";

  for (let i = 0; i < want; i += 1) {
    const page = await pickFreeFacebookPage();
    if (!page) {
      stoppedReason = "Hết page rảnh trong pool";
      break;
    }
    const pageId = page.pageId;
    const pageName = page.pageName || pageId;
    const sessionId = randomUUID();

    // Giữ chỗ page NGAY để lần pick kế không trả lại chính nó.
    await markFacebookPageBusy({ pageId, matchId: null, liveVideoId: null });

    const doc = await FbLiveTestSession.create({
      sessionId,
      pageId,
      pageName,
      status: "starting",
      startedBy,
      autoStopAt: new Date(Date.now() + AUTO_STOP_MIN * 60 * 1000),
    });

    try {
      const pageToken = await getValidPageToken(pageId);
      const live = await fbCreateLiveOnPage({
        pageId,
        pageAccessToken: pageToken,
        title: `🔴 TEST LIVE — ${pageName}`,
        description: "Phiên test đa luồng PickleTour (test pattern).",
        status: "LIVE_NOW",
      });
      const liveVideoId = live?.id;
      const secureStreamUrl = live?.secure_stream_url;
      if (!liveVideoId || !secureStreamUrl) {
        throw new Error("Facebook không trả live video / stream url");
      }

      doc.liveVideoId = liveVideoId;
      doc.permalinkUrl = live?.permalink_url
        ? `https://www.facebook.com${live.permalink_url}`
        : "";
      doc.status = "live";
      doc.hostPid = process.pid;
      await doc.save();

      await markFacebookPageBusy({ pageId, matchId: null, liveVideoId });

      spawnPusher(sessionId, secureStreamUrl);

      // Sau ~8s (khi stream đã chảy) ép LIVE_NOW cho chắc.
      setTimeout(() => {
        fbGoLive({ liveVideoId, pageAccessToken: pageToken }).catch(() => {});
      }, 8000);

      created.push({
        sessionId,
        pageId,
        pageName,
        liveVideoId,
        permalinkUrl: doc.permalinkUrl,
        status: "live",
      });
    } catch (err) {
      doc.status = "error";
      doc.error = err?.response?.data?.error?.message || err?.message || "Lỗi tạo live";
      doc.stoppedAt = new Date();
      await doc.save();
      await markFacebookPageFreeByPage(pageId, { delayMs: 0 }).catch(() => {});
      created.push({
        sessionId,
        pageId,
        pageName,
        status: "error",
        error: doc.error,
      });
    }
  }

  return { created, count: created.length, stoppedReason, max: MAX_COUNT };
}

/** Danh sách phiên đang chạy (mới nhất trước). */
export async function listFbLiveTestSessions({ activeOnly = false } = {}) {
  const filter = activeOnly ? { status: { $in: ["starting", "live"] } } : {};
  const items = await FbLiveTestSession.find(filter)
    .sort({ startedAt: -1 })
    .limit(100)
    .lean();
  return items;
}

/** Dừng 1 phiên: kết thúc live FB + kill ffmpeg (nếu ở process này) + free page. */
export async function stopFbLiveTestSession(sessionId) {
  const doc = await FbLiveTestSession.findOne({ sessionId });
  if (!doc) return { ok: false, reason: "not-found" };

  // Kill ffmpeg nếu handle nằm ở process hiện tại.
  const proc = _procs.get(sessionId);
  if (proc) {
    try { proc.kill("SIGKILL"); } catch {}
    _procs.delete(sessionId);
  }

  // Kết thúc live FB (ffmpeg ở process khác sẽ tự chết khi FB đóng stream).
  if (doc.liveVideoId) {
    try {
      const pageToken = await getValidPageToken(doc.pageId);
      await fbEndLiveVideo({ liveVideoId: doc.liveVideoId, pageAccessToken: pageToken });
    } catch {}
  }

  await markFacebookPageFreeByPage(doc.pageId, { delayMs: 0 }).catch(() => {});

  if (["starting", "live"].includes(doc.status)) {
    doc.status = "stopped";
    doc.stoppedAt = new Date();
    await doc.save();
  }
  return { ok: true, sessionId };
}

/** Dừng tất cả phiên đang chạy. */
export async function stopAllFbLiveTestSessions() {
  const active = await FbLiveTestSession.find({
    status: { $in: ["starting", "live"] },
  }).select("sessionId").lean();
  let stopped = 0;
  for (const s of active) {
    const r = await stopFbLiveTestSession(s.sessionId);
    if (r.ok) stopped += 1;
  }
  return { ok: true, stopped };
}

/** Quét auto-stop: dừng phiên đã quá autoStopAt (an toàn, không chạy vô hạn). */
export async function sweepFbLiveTestAutoStop() {
  const due = await FbLiveTestSession.find({
    status: { $in: ["starting", "live"] },
    autoStopAt: { $lte: new Date() },
  }).select("sessionId").lean();
  for (const s of due) {
    await stopFbLiveTestSession(s.sessionId).catch(() => {});
  }
  return { swept: due.length };
}

// Quét auto-stop định kỳ (gọi ở server.js, chỉ leader). unref để không giữ process.
let _sweepTimer = null;
export function startFbLiveTestAutoStopSweep() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => {
    sweepFbLiveTestAutoStop().catch(() => {});
  }, 60 * 1000);
  if (_sweepTimer.unref) _sweepTimer.unref();
}
