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
import FbToken from "../models/fbTokenModel.js";
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
  fbGetLiveVideo,
} from "./facebookLive.service.js";
import { getMeFromToken } from "./fbGraph.js";

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

// Cache tên tài khoản FB theo user token (tránh gọi /me mỗi lần poll).
const _ownerCache = new Map(); // token -> { name, till }
const OWNER_TTL = 10 * 60 * 1000;

async function resolveOwnerName(longUserToken) {
  const key = String(longUserToken || "");
  if (!key) return "";
  const hit = _ownerCache.get(key);
  if (hit && hit.till > Date.now()) return hit.name;
  let name = "";
  try {
    const me = await getMeFromToken(key);
    name = me?.name || "";
  } catch {
    name = ""; // token hỏng → không lấy được tên
  }
  _ownerCache.set(key, { name, till: Date.now() + OWNER_TTL });
  return name;
}

/** Tên tài khoản FB sở hữu 1 page (theo longUserToken của page). */
async function ownerNameOfPage(page) {
  return resolveOwnerName(page?.longUserToken || "");
}

/** Danh sách page để CHỌN test: kèm trạng thái + TÊN TÀI KHOẢN sở hữu. */
export async function listTestablePages() {
  const pages = await FbToken.find({})
    .select("pageId pageName isBusy needsReauth disabled pageToken longUserToken")
    .sort({ pageName: 1 })
    .lean();

  // Gom theo user token để chỉ gọi /me 1 lần cho mỗi tài khoản.
  const tokens = [...new Set(pages.map((p) => p.longUserToken).filter(Boolean))];
  const ownerByToken = {};
  await Promise.all(
    tokens.map(async (t) => {
      ownerByToken[t] = await resolveOwnerName(t);
    })
  );

  return pages.map((p) => {
    const hasToken = Boolean(String(p.pageToken || "").trim());
    const owner = ownerByToken[p.longUserToken] || "";
    let reason = "";
    if (p.disabled) reason = "Đã tắt";
    else if (p.needsReauth) reason = "Cần reauth";
    else if (!hasToken) reason = "Chưa có page token";
    else if (p.isBusy) reason = "Đang bận";
    return {
      pageId: p.pageId,
      pageName: p.pageName || p.pageId,
      ownerName: owner,
      account: owner || (p.longUserToken ? `acct:${String(p.longUserToken).slice(-6)}` : ""),
      isBusy: Boolean(p.isBusy),
      needsReauth: Boolean(p.needsReauth),
      disabled: Boolean(p.disabled),
      hasToken,
      testable: hasToken && !p.needsReauth && !p.isBusy && !p.disabled,
      reason,
    };
  });
}

/** Khởi 1 phiên test cho 1 page (đã giữ chỗ busy). Trả về entry kết quả. */
async function startOnePageTest(page, startedBy) {
  const pageId = page.pageId;
  const pageName = page.pageName || pageId;
  const sessionId = randomUUID();

  await markFacebookPageBusy({ pageId, matchId: null, liveVideoId: null });

  const ownerName = await ownerNameOfPage(page);

  const doc = await FbLiveTestSession.create({
    sessionId,
    pageId,
    pageName,
    ownerName,
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

    // Link xem: FB thường trả permalink_url ngay lúc tạo; nếu chưa có thì hỏi lại.
    let permalink = live?.permalink_url || "";
    if (!permalink) {
      const info = await fbGetLiveVideo({
        liveVideoId,
        pageAccessToken: pageToken,
        fields: "permalink_url,status",
      }).catch(() => null);
      permalink = info?.permalink_url || "";
    }

    doc.liveVideoId = liveVideoId;
    doc.permalinkUrl = permalink ? `https://www.facebook.com${permalink}` : "";
    doc.status = "live";
    doc.hostPid = process.pid;
    await doc.save();

    await markFacebookPageBusy({ pageId, matchId: null, liveVideoId });
    spawnPusher(sessionId, secureStreamUrl);

    // Sau ~8s (khi stream đã chảy) ép LIVE_NOW cho chắc.
    setTimeout(() => {
      fbGoLive({ liveVideoId, pageAccessToken: pageToken }).catch(() => {});
    }, 8000);

    return {
      sessionId,
      pageId,
      pageName,
      ownerName,
      liveVideoId,
      permalinkUrl: doc.permalinkUrl,
      status: "live",
    };
  } catch (err) {
    doc.status = "error";
    doc.error = err?.response?.data?.error?.message || err?.message || "Lỗi tạo live";
    doc.stoppedAt = new Date();
    await doc.save();
    await markFacebookPageFreeByPage(pageId, { delayMs: 0 }).catch(() => {});
    return { sessionId, pageId, pageName, ownerName, status: "error", error: doc.error };
  }
}

/**
 * Bắt đầu test live.
 *  - `pageIds` (mảng): test đúng các page được CHỌN (bỏ qua page bận/cần reauth kèm lý do).
 *  - ngược lại: lấy `count` page rảnh bất kỳ trong pool.
 */
export async function startFbLiveTests({ count = 3, pageIds = null, startedBy = "" } = {}) {
  const created = [];
  let stoppedReason = "";

  if (Array.isArray(pageIds) && pageIds.length) {
    const wanted = [...new Set(pageIds.map((x) => String(x).trim()).filter(Boolean))].slice(
      0,
      MAX_COUNT
    );
    for (const pid of wanted) {
      const page = await FbToken.findOne({ pageId: pid }).lean();
      if (!page) {
        created.push({ pageId: pid, pageName: pid, status: "error", error: "Không tìm thấy page" });
        continue;
      }
      if (page.needsReauth) {
        created.push({ pageId: pid, pageName: page.pageName || pid, status: "error", error: "Page cần reauth" });
        continue;
      }
      if (page.disabled) {
        created.push({ pageId: pid, pageName: page.pageName || pid, status: "error", error: "Page đã tắt" });
        continue;
      }
      if (page.isBusy) {
        created.push({ pageId: pid, pageName: page.pageName || pid, status: "error", error: "Page đang bận" });
        continue;
      }
      created.push(await startOnePageTest(page, startedBy));
    }
    if (wanted.length < pageIds.length) {
      stoppedReason = `Giới hạn ${MAX_COUNT} page/lần`;
    }
  } else {
    const want = Math.min(MAX_COUNT, Math.max(1, Number(count) || 1));
    for (let i = 0; i < want; i += 1) {
      const page = await pickFreeFacebookPage();
      if (!page) {
        stoppedReason = "Hết page rảnh trong pool";
        break;
      }
      created.push(await startOnePageTest(page, startedBy));
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
