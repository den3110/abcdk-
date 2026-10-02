// Orchestrator auto-live: quản lý session per court, spawn Python worker,
// poll trận kế tiếp, giữ overlay data đồng bộ.
//
// Python worker chạy tách process (PID lưu vào session). Node giữ:
//   - Map<sessionId, ChildProcess> để kill / restart
//   - Poll interval mỗi 5s: nếu station.currentMatch đổi thì bump overlayVersion
//     (worker fetch PNG mới ở lần reload kế tiếp, không restart pipeline)
//   - Nếu status "finished" và có nextMatchId nhưng chưa arm → gọi arm để hệ
//     thống assign match sang court (reuse hàm nội bộ)
//
// LƯU Ý deploy: cần python3 + pip install ImouPkg trên VPS. Worker script ở
// scripts/autoLive/worker.py. Nếu Python không có sẵn, endpoint start sẽ trả
// 503 và log rõ để fix infra.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import mongoose from "mongoose";

import Venue from "../../models/venueModel.js";
import CourtStation from "../../models/courtStationModel.js";
import Match from "../../models/matchModel.js";
import Tournament from "../../models/tournamentModel.js";
import TournamentAutoLiveSession from "../../models/tournamentAutoLiveSessionModel.js";
import { decryptToken } from "../secret.service.js";
import { loadOverlayData, loadOverlayDataFromUserMatch, renderOverlayPng } from "./overlayRenderer.service.js";
import { sampleProcessTree, clearProcSample, systemCapacity } from "./procStat.service.js";
import { ensureDahuaTunnel, dahuaChannelUrl, triggerDahuaReconcile } from "./dahuaTunnel.service.js";
import { getValidPageToken } from "../fbTokenService.js";
import { fbCreateLiveOnPage, fbGetLiveVideo, fbEndLiveVideo, fbSetCrosspost, fbGetCrosspostStatus } from "../facebookLive.service.js";
import { YouTubeProvider } from "../liveProviders/youtube.js";
import { getCfgStr } from "../config.service.js";
import { createClipTaskForEndedMatch, startAutoLiveClipWorker } from "./autoLiveClip.service.js";
import AppSetting from "../../models/appSettingModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.resolve(__dirname, "../../scripts/autoLive/worker.py");
// Binary tunnel dh-p2p (nguồn đầu thu Dahua P2P). Build: scripts/dahua-p2p/build.sh
const DAHUA_P2P_BIN_DEFAULT = path.resolve(
  __dirname, "../../scripts/dahua-p2p/target/release/dh-p2p");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
// Lưới an toàn tuyệt đối (server-runner): worker.py đã có watchdog restart ở
// ~1800MB; nếu vì lý do gì đó nó vượt ngưỡng NÀY thì backend cưỡng bức dừng phiên
// để bảo vệ máy chủ (trước đây 1 luồng lỗi lên 19.6GB làm full RAM). 0 = tắt.
const MEM_HARD_CEILING_MB = Number(process.env.AUTOLIVE_MEM_CEILING_MB) || 3000;
// Từ chối start phiên server mới nếu RAM trống dưới ngưỡng (chống chồng luồng).
const MIN_FREE_MB_TO_START = Number(process.env.AUTOLIVE_MIN_FREE_MB) || 1200;

// Map sessionId → { proc|null, pollTimer }
// Worker Python chạy DETACHED (session riêng, log ra file) để pm2 restart /
// deploy backend KHÔNG làm rớt live. Sau khi backend khởi động lại, các
// phiên còn sống được "nhận nuôi" lại theo PID (adoptRunningSessions).
const registry = new Map();

// sessionId đang được restart chủ động (per-match) → exit handler của worker cũ
// KHÔNG được mark session error/stopped.
const restartingSessions = new Set();
// Chống chạy chồng logic chuyển-trận per-match cho cùng session.
const perMatchInFlight = new Set();

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function workerLogPath(sessionId) {
  const dir = path.join(os.tmpdir(), `autolive-${sessionId}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "worker.log");
}

async function adoptRunningSessions() {
  const docs = await TournamentAutoLiveSession.find({
    status: { $in: ["starting", "live", "reconnecting"] },
  }).select("_id workerPid runner").lean();
  for (const d of docs) {
    const sid = String(d._id);
    // Client-runner: app chạy độc lập ngoài server → luôn adopt, heartbeat lo liveness.
    if (d.runner === "client" || isPidAlive(d.workerPid)) {
      if (!registry.has(sid)) registry.set(sid, { proc: null, pollTimer: null });
      startPoll(sid);
      console.log(`[auto-live] adopted session ${sid} runner=${d.runner} pid=${d.workerPid}`);
    } else {
      await TournamentAutoLiveSession.updateOne(
        { _id: d._id, status: { $ne: "stopped" } },
        { $set: { status: "error", lastError: "worker process không còn sau khi backend khởi động lại",
                  lastErrorAt: new Date(), stoppedAt: new Date() } }
      );
    }
  }
}
// Đợi mongoose kết nối xong (server.js connect ngay khi boot).
setTimeout(() => adoptRunningSessions().catch((e) =>
  console.error("[auto-live] adopt fail", e?.message || e)), 8000);
// Worker cắt clip từng trận + upload Drive (claim nguyên tử nên an toàn với PM2 cluster).
setTimeout(() => { try { startAutoLiveClipWorker(); } catch (e) {
  console.error("[autolive-clip] start worker fail", e?.message || e); } }, 9000);

/**
 * Trả về overlay PNG cho session (worker Python fetch qua ffmpeg).
 * KHÔNG dựa vào in-memory registry — pm2 cluster nhiều process, request có
 * thể vào bất kỳ worker Node nào. Load session từ DB, chỉ cần status không
 * phải "stopped", render trực tiếp từ overlay data hiện tại của court.
 * Cache theo overlayVersion để không render lại khi data chưa đổi.
 */
const overlayCache = new Map(); // sessionId → { buf, token }
// Sponsor xoay vòng mỗi 8s → re-render tối thiểu mỗi bucket kể cả điểm không đổi.
const SPONSOR_BUCKET_MS = 8000;

// Độ MỜ overlay (0..1) CHUNG cho mọi stream — chỉnh được khi đang live. Lưu AppSetting
// "autoLiveOverlayOpacity"; cache module (không hỏi DB mỗi lần render). 1 = đục hoàn toàn.
const OVERLAY_OPACITY_KEY = "autoLiveOverlayOpacity";
// Đọc LẠI từ DB theo TTL ngắn để MỌI instance pm2 (cluster) hội tụ cùng giá trị →
// hết lỗi nháy (trước đây mỗi instance cache vĩnh viễn, chỉ instance nhận PATCH đổi).
let _overlayOpacity = 1;
let _overlayOpacityAt = 0;
const OVERLAY_OPACITY_TTL = 1000;
async function ensureOverlayOpacity() {
  if (Date.now() - _overlayOpacityAt < OVERLAY_OPACITY_TTL) return _overlayOpacity;
  try {
    const doc = await AppSetting.findOne({ key: OVERLAY_OPACITY_KEY }).lean();
    const v = Number(doc?.value?.opacity);
    _overlayOpacity = Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
  } catch { /* giữ giá trị cũ */ }
  _overlayOpacityAt = Date.now();
  return _overlayOpacity;
}
export function getOverlayOpacitySync() {
  return _overlayOpacity == null ? 1 : _overlayOpacity;
}
export async function getOverlayOpacity() {
  return ensureOverlayOpacity();
}
export async function setOverlayOpacity(value) {
  let v = Number(value);
  if (!Number.isFinite(v)) throw new Error("Giá trị độ mờ không hợp lệ");
  v = Math.max(0.1, Math.min(1, v)); // tối thiểu 0.1 để overlay không biến mất hẳn
  await AppSetting.findOneAndUpdate(
    { key: OVERLAY_OPACITY_KEY },
    { $set: { key: OVERLAY_OPACITY_KEY, value: { opacity: v } } },
    { upsert: true }
  );
  _overlayOpacity = v;
  _overlayOpacityAt = Date.now();
  overlayCache.clear();        // bust cache → mọi stream render lại với độ mờ mới
  userOverlayCache.clear();
  return { ok: true, opacity: v };
}
export async function getCachedOverlayPng(sessionId) {
  const doc = await TournamentAutoLiveSession.findById(sessionId)
    .select("_id court status overlayVersion layout hideTimestamp timestampBox")
    .lean();
  if (!doc) return null;
  if (doc.status === "stopped") return null;
  const opacity = await ensureOverlayOpacity();
  const token = `${doc.overlayVersion || 0}:${Math.floor(Date.now() / SPONSOR_BUCKET_MS)}:${opacity}`;
  const cached = overlayCache.get(String(sessionId));
  if (cached && cached.token === token) return cached.buf;
  const data = await loadOverlayData(doc.court);
  if (data) {
    data.layout = doc.layout || {};
    data.opacity = opacity;
    data.hideTimestamp = !!doc.hideTimestamp;
    data.timestampBox = doc.timestampBox || null;
  }
  const buf = await renderOverlayPng(data);
  overlayCache.set(String(sessionId), { buf, token });
  return buf;
}

// Overlay PNG cho trận ngẫu nhiên (UserMatch) — desktop worker fetch trực tiếp
// bằng userMatchId (không cần session auto-live). Cache ~1s theo mốc thời gian.
const userOverlayCache = new Map();
export async function getUserMatchOverlayPng(userMatchId) {
  const id = String(userMatchId || "");
  const data = await loadOverlayDataFromUserMatch(id);
  if (!data) return null;
  const opacity = await ensureOverlayOpacity();
  data.opacity = opacity;
  // Token đổi ~mỗi 800ms để overlay bắt kịp điểm số mới (referee patch) mà vẫn
  // tránh render mọi request (~2fps worker fetch).
  const token = `${Math.floor(Date.now() / 800)}:${opacity}`;
  const cached = userOverlayCache.get(id);
  if (cached && cached.token === token) return cached.buf;
  const buf = await renderOverlayPng(data);
  userOverlayCache.set(id, { buf, token });
  return buf;
}

async function bumpOverlayForSession(sessionId) {
  // Chỉ bump version trong DB — render lazy khi worker fetch overlay PNG.
  const doc = await TournamentAutoLiveSession.findByIdAndUpdate(
    sessionId,
    { $inc: { overlayVersion: 1 } },
    { new: true }
  );
  return doc;
}

// Cập nhật VỊ TRÍ overlay NGAY CẢ KHI ĐANG LIVE: ghi layout + bump overlayVersion
// → worker fetch overlay PNG (~2fps) sẽ nhận vị trí mới ngay (không cần restart live).
const OVERLAY_CORNERS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
export async function updateSessionLayout(sessionId, layout = {}) {
  const doc = await TournamentAutoLiveSession.findById(sessionId).select("_id layout status court");
  if (!doc) { const e = new Error("Không tìm thấy phiên"); e.status = 404; throw e; }
  const cur = doc.layout || {};
  const next = { ...cur };
  for (const key of ["scoreboard", "brand", "sponsor"]) {
    const v = String(layout?.[key] || "").trim();
    if (v && OVERLAY_CORNERS.has(v)) next[key] = v;
  }
  doc.layout = next;
  doc.overlayVersion = (Number(doc.overlayVersion) || 0) + 1;
  await doc.save();
  // Xoá cache overlay để lần fetch kế render lại ngay.
  try { overlayCache.delete(String(sessionId)); } catch {}
  // GHI NHỚ vị trí overlay cho SÂN → lần tạo live sau tự dùng lại (không chỉnh lại).
  try {
    if (doc.court) {
      const $set = {};
      for (const key of ["scoreboard", "brand", "sponsor"]) {
        if (next[key]) $set[`overlayLayout.${key}`] = next[key];
      }
      if (Object.keys($set).length) {
        await CourtStation.updateOne({ _id: doc.court }, { $set });
      }
    }
  } catch (e) { console.warn("[auto-live] lưu overlayLayout cho sân lỗi:", e?.message || e); }
  return { ok: true, layout: next };
}

// Bật/tắt + đổi vùng CHE NGÀY GIỜ cho 1 sân NGAY khi đang live (không restart worker).
export async function setSessionTimestampCover(sessionId, { hideTimestamp, box } = {}) {
  const doc = await TournamentAutoLiveSession.findById(sessionId)
    .select("_id hideTimestamp timestampBox overlayVersion status");
  if (!doc) { const e = new Error("Không tìm thấy phiên"); e.status = 404; throw e; }
  if (hideTimestamp != null) doc.hideTimestamp = !!hideTimestamp;
  if (box && typeof box === "object") {
    const cur = doc.timestampBox || {};
    const num = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
    doc.timestampBox = {
      x: num(box.x, cur.x ?? 1360),
      y: num(box.y, cur.y ?? 46),
      w: num(box.w, cur.w ?? 544),
      h: num(box.h, cur.h ?? 72),
    };
  }
  doc.overlayVersion = (Number(doc.overlayVersion) || 0) + 1;
  await doc.save();
  try { overlayCache.delete(String(sessionId)); } catch {}
  return { ok: true, hideTimestamp: doc.hideTimestamp, timestampBox: doc.timestampBox };
}

async function pollOnce(sessionId) {
  const session = await TournamentAutoLiveSession.findById(sessionId);
  if (!session || ["stopped", "error"].includes(session.status)) {
    stopPoll(sessionId);
    return;
  }
  const station = await CourtStation.findById(session.court)
    .select("_id currentMatch")
    .lean();
  const newMatchId = station?.currentMatch ? String(station.currentMatch) : "";
  const oldMatchId = session.currentMatch ? String(session.currentMatch) : "";

  // perMatchLive: điều khiển theo TRẠNG THÁI trận — chỉ live khi trận BẮT ĐẦU
  // (status="live"), dừng khi kết thúc/đổi trận. Không live khi mới gán sân.
  // Server-runner: backend tự tạo broadcast + spawn/kill worker. Client-runner
  // (app desktop): backend tạo/kết thúc broadcast + đặt status; app desktop tự
  // start/stop ffmpeg theo status khi poll.
  if (session.perMatchLive) {
    try { await pollPerMatch(session, station); }
    catch (e) { console.warn("[auto-live] per-match poll lỗi:", e?.message || e); }
    return;
  }
  if (session.splitPerTournament) {
    try { await pollSplitTournament(session, station); }
    catch (e) { console.warn("[auto-live] split-tournament poll lỗi:", e?.message || e); }
    return;
  }

  if (newMatchId !== oldMatchId) {
    // Live xuyên suốt: gỡ link khỏi trận cũ, gắn vào trận mới đang trên sân → mỗi
    // trận hiện link "Xem trực tiếp" đúng khoảng thời gian nó được live.
    const urls = sessionWatchUrls(session);
    if (oldMatchId) {
      await clearLiveLinksFromMatch(oldMatchId, urls);
      // Trận cũ vừa kết thúc → tạo task cắt clip từ recording (nếu bật recordClips).
      if (session.recordClips) {
        await createClipTaskForEndedMatch(session, oldMatchId, {
          startAt: session.lastMatchChangeAt, endAt: new Date(),
        });
      }
    }
    session.currentMatch = newMatchId || null;
    session.currentMatchLabel = newMatchId
      ? await matchShortLabel(newMatchId)
      : "";
    session.lastMatchChangeAt = new Date();
    await session.save();
    if (newMatchId) await applyLiveLinksToMatch(session, newMatchId);
    await bumpOverlayForSession(sessionId);
  } else {
    // Cùng match nhưng có thể tỉ số đổi — vẫn re-render để cập nhật scoreboard.
    await bumpOverlayForSession(sessionId);
  }
  if (session.runner === "server") {
    // Worker chết (PID không còn) mà chưa ai mark → error.
    if (session.workerPid && !isPidAlive(session.workerPid)) {
      session.status = "error";
      session.lastError = `worker process ${session.workerPid} đã dừng (xem ${workerLogPath(sessionId)})`;
      session.lastErrorAt = new Date();
      session.stoppedAt = new Date();
      await session.save();
      stopPoll(sessionId);
      registry.delete(String(sessionId));
      return;
    }
    // Đo tài nguyên worker + ffmpeg (server-side)
    try {
      const { cpuPct, memMB } = sampleProcessTree(session.workerPid, String(session._id));
      session.cpuPct = cpuPct;
      session.memMB = memMB;
      await session.save();
      // Lưới an toàn cứng: vượt ngưỡng RAM → cưỡng bức dừng (bảo vệ máy chủ).
      if (MEM_HARD_CEILING_MB > 0 && memMB > MEM_HARD_CEILING_MB) {
        console.error(`[auto-live] session ${sessionId} RAM ${memMB}MB > ceiling ${MEM_HARD_CEILING_MB}MB → force stop`);
        try { process.kill(session.workerPid, "SIGKILL"); } catch { /* đã chết */ }
        session.status = "error";
        session.lastError = `Vượt ngưỡng RAM an toàn (${memMB}MB) — tự dừng để bảo vệ máy chủ. `
          + `Kiểm tra nguồn video có ổn định không.`;
        session.lastErrorAt = new Date();
        session.stoppedAt = new Date();
        await session.save();
        stopPoll(sessionId);
        registry.delete(String(sessionId));
        clearProcSample(String(sessionId));
        return;
      }
    } catch { /* /proc không có → bỏ qua */ }
  } else {
    // Client-runner: chết = quá lâu không heartbeat → error (app tự report CPU).
    const hbC = session.workerLastHeartbeatAt?.getTime() || 0;
    const startedMs = session.startedAt?.getTime() || Date.now();
    if (hbC && Date.now() - hbC > 60_000) {
      session.status = "error";
      session.lastError = "Client (app desktop) mất kết nối > 60s";
      session.lastErrorAt = new Date();
      session.stoppedAt = new Date();
      await session.save();
      stopPoll(sessionId);
      registry.delete(String(sessionId));
      return;
    }
    // Chưa từng heartbeat sau 90s kể từ start → app chưa nhận → error.
    if (!hbC && Date.now() - startedMs > 90_000) {
      session.status = "error";
      session.lastError = "Không có client nào nhận phiên (app desktop chưa chạy?)";
      session.lastErrorAt = new Date();
      session.stoppedAt = new Date();
      await session.save();
      stopPoll(sessionId);
      registry.delete(String(sessionId));
      return;
    }
  }

  // Heartbeat: nếu quá 30s không có heartbeat → mark reconnecting.
  const hb = session.workerLastHeartbeatAt?.getTime() || 0;
  if (hb && Date.now() - hb > 30_000 && session.status === "live") {
    session.status = "reconnecting";
    await session.save();
  }
}

async function matchShortLabel(id) {
  const m = await Match.findById(id).select("code labelKey").lean();
  return m?.code || m?.labelKey || String(id).slice(-6);
}

/** Danh sách watchUrl (FB/YouTube) của phiên — RTMP thuần không có. */
function sessionWatchUrls(session) {
  return (session.destinations || []).map((d) => d?.watchUrl).filter(Boolean);
}

/** Gắn link xem live (FB + YouTube) của phiên vào ĐÚNG trận đang live → lịch thi
 *  đấu / chi tiết trận hiện nút "Xem trực tiếp" (dùng match.video + liveTargets,
 *  đúng convention app live). RTMP thuần (không watchUrl) → bỏ qua. */
async function applyLiveLinksToMatch(session, matchId) {
  try {
    if (!matchId) return;
    const targets = (session.destinations || [])
      .filter((d) => (d.type === "fb" || d.type === "youtube") && d.watchUrl)
      .map((d) => ({
        platform: d.type === "fb" ? "facebook" : "youtube",
        pageId: d.pageId || null,
        liveId: d.broadcastId || null,
        watchUrl: d.watchUrl,
        createdAt: new Date(),
      }));
    if (!targets.length) return;
    await Match.updateOne(
      { _id: matchId },
      { $set: { liveTargets: targets, video: targets[0].watchUrl } }
    );
  } catch (e) {
    console.warn("[auto-live] gắn link live vào trận lỗi:", e?.message || e);
  }
}

/** Gỡ link live khỏi trận (khi trận kết thúc/đổi/dừng phiên). Chỉ xoá match.video
 *  khi nó ĐÚNG là link live của phiên (tránh đụng VOD/link khác); liveTargets do
 *  luồng live tạo nên gỡ luôn. */
async function clearLiveLinksFromMatch(matchId, knownUrls = []) {
  try {
    if (!matchId) return;
    if (knownUrls.length) {
      await Match.updateOne(
        { _id: matchId, video: { $in: knownUrls } },
        { $set: { video: "" } }
      ).catch(() => {});
    }
    await Match.updateOne(
      { _id: matchId },
      { $unset: { liveTargets: "" } }
    ).catch(() => {});
  } catch (e) {
    console.warn("[auto-live] gỡ link live khỏi trận lỗi:", e?.message || e);
  }
}

function stopPoll(sessionId) {
  const entry = registry.get(String(sessionId));
  if (entry?.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null; }
}

function startPoll(sessionId) {
  stopPoll(sessionId);
  const timer = setInterval(() => pollOnce(sessionId).catch((e) => {
    console.error("[auto-live] poll error", sessionId, e?.message);
  }), 5000);
  const entry = registry.get(String(sessionId)) || {};
  entry.pollTimer = timer;
  registry.set(String(sessionId), entry);
}

/**
 * Với mỗi destination:
 *  - type="fb": lấy pageAccessToken từ pool, tạo live_video, poll
 *    secure_stream_url, gắn vào streamUrl. broadcastId = live.id.
 *  - type="youtube": TODO — hiện chưa có helper stable trong repo, ném lỗi.
 *  - type="rtmp": giữ nguyên, chỉ cần có streamUrl.
 */
function fbWatchUrl(permalink, pageId, liveId) {
  if (permalink) return permalink.startsWith("http") ? permalink : `https://www.facebook.com${permalink}`;
  return liveId ? `https://www.facebook.com/${pageId}/videos/${liveId}` : "";
}

/** Phiên FB đang chạy nhưng thiếu watchUrl (tạo trước khi có field) → hỏi Graph 1 lần và lưu. */
export async function backfillWatchUrls(sessionIds) {
  for (const sid of sessionIds) {
    const doc = await TournamentAutoLiveSession.findById(sid);
    if (!doc) continue;
    let changed = false;
    for (const d of doc.destinations) {
      if (d.type !== "fb" || d.watchUrl || !d.broadcastId || !d.pageId) continue;
      try {
        const token = await getValidPageToken(d.pageId);
        const info = await fbGetLiveVideo({
          liveVideoId: d.broadcastId, pageAccessToken: token, fields: "id,permalink_url",
        });
        d.watchUrl = fbWatchUrl(info?.permalink_url || "", d.pageId, d.broadcastId);
        changed = true;
      } catch (e) {
        console.warn("[auto-live] backfill watchUrl fail", d.broadcastId, e?.message || e);
      }
    }
    if (changed) await doc.save();
  }
}

/** YouTubeProvider dùng refresh token đã kết nối ở /admin/youtube-live. */
async function getYouTubeProvider() {
  const refreshToken = (await getCfgStr("YOUTUBE_REFRESH_TOKEN", "")).trim();
  if (!refreshToken) {
    const e = new Error("Chưa kết nối YouTube (thiếu YOUTUBE_REFRESH_TOKEN). Vào /admin/youtube-live để connect.");
    e.status = 400; throw e;
  }
  return new YouTubeProvider({ refreshToken, accessToken: "", expiresAt: "" });
}

/** Kết thúc broadcast của các destination (best-effort): FB end, YouTube end+delete. */
async function endDestinationBroadcasts(destinations) {
  let ytProvider = null;
  for (const d of destinations || []) {
    try {
      if (d.type === "fb" && d.broadcastId && d.pageId) {
        const token = await getValidPageToken(d.pageId).catch(() => null);
        if (token) await fbEndLiveVideo({ liveVideoId: d.broadcastId, pageAccessToken: token });
      } else if (d.type === "youtube" && d.broadcastId) {
        if (!ytProvider) ytProvider = await getYouTubeProvider().catch(() => null);
        if (ytProvider) await ytProvider.endAndDelete({ broadcastId: d.broadcastId, streamId: d.ytStreamId || "" });
      }
    } catch (e) {
      console.warn(`[auto-live] end broadcast ${d.type} ${d.broadcastId} fail:`, e?.message || e);
    }
  }
}

async function prepareDestinations(destinations, title) {
  const out = [];
  for (const d of destinations || []) {
    if (d.type === "rtmp") {
      if (!d.streamUrl) {
        const e = new Error(`Destination RTMP thiếu streamUrl (label=${d.label || ""})`);
        e.status = 400; throw e;
      }
      out.push(d);
      continue;
    }
    if (d.type === "fb") {
      const pageId = d.pageId;
      if (!pageId) {
        const e = new Error(`Destination FB thiếu pageId`); e.status = 400; throw e;
      }
      let pageToken;
      try { pageToken = await getValidPageToken(pageId); }
      catch (e) { const err = new Error(`FB page token lỗi: ${e?.message || e}`); err.status = 400; throw err; }
      let live;
      try {
        live = await fbCreateLiveOnPage({
          pageId, pageAccessToken: pageToken, title, description: title, status: "LIVE_NOW",
        });
      } catch (e) { const err = new Error(`FB create live lỗi: ${e?.message || e}`); err.status = 400; throw err; }
      const liveId = live?.id || live?.liveVideoId;
      let secure = live?.secure_stream_url || "";
      let permalink = live?.permalink_url || "";
      for (let i = 0; i < 6 && !(secure && permalink); i++) {
        await new Promise((r) => setTimeout(r, 700));
        const info = await fbGetLiveVideo({
          liveVideoId: liveId, pageAccessToken: pageToken,
          fields: "id,status,secure_stream_url,stream_url,permalink_url",
        }).catch(() => null);
        secure = secure || info?.secure_stream_url || info?.stream_url || "";
        permalink = permalink || info?.permalink_url || "";
      }
      if (!secure) {
        const e = new Error(`FB không trả stream URL cho page ${d.pageName || pageId}`);
        e.status = 502; throw e;
      }
      // FB cần vài giây để ingest sẵn sàng sau khi tạo live_video; publish quá sớm
      // (nhất là khi tách live từng trận — tạo broadcast liên tiếp) sẽ bị FB huỷ phiên
      // "session has been invalidated" → luồng không lên. Chờ trước khi worker đẩy stream.
      const fbDelayMs = Math.max(0, Number(process.env.AUTOLIVE_FB_PUBLISH_DELAY_MS) || 6000);
      if (fbDelayMs) await new Promise((r) => setTimeout(r, fbDelayMs));
      // Crosspost (live chéo page): 1 luồng, hiện trên nhiều page. Cần quan hệ crosspost
      // đã thiết lập trong Business Suite. FB không báo lỗi nếu quan hệ sai → verify sau.
      let crosspostPages = [];
      const cpTargets = Array.isArray(d.crosspostPageIds) ? d.crosspostPageIds.filter(Boolean) : [];
      if (cpTargets.length) {
        try {
          await fbSetCrosspost({
            liveVideoId: liveId, pageAccessToken: pageToken,
            targets: cpTargets.map((pid) => ({ pageId: pid })),
          });
          // Xác nhận thực tế page nào đã nhận crosspost.
          const st = await fbGetCrosspostStatus({ liveVideoId: liveId, pageAccessToken: pageToken }).catch(() => null);
          const okIds = new Set(
            (st?.crossposted_broadcasts?.data || [])
              .map((b) => String(b?.from?.id || "")).filter(Boolean)
          );
          crosspostPages = cpTargets.map((pid) => ({ pageId: String(pid), ok: okIds.has(String(pid)) }));
          const okN = crosspostPages.filter((p) => p.ok).length;
          console.log(`[auto-live] crosspost live ${liveId}: ${okN}/${cpTargets.length} page nhận (page chính ${pageId})`);
          if (okN < cpTargets.length) {
            console.warn(`[auto-live] crosspost CHƯA đủ — kiểm tra quan hệ crossposting trong Business Suite cho các page: ${crosspostPages.filter(p=>!p.ok).map(p=>p.pageId).join(", ")}`);
          }
        } catch (e) {
          console.warn(`[auto-live] crosspost lỗi live ${liveId}:`, e?.message || e);
        }
      }
      out.push({
        type: "fb", label: d.pageName || pageId, pageId, pageName: d.pageName || "",
        broadcastId: String(liveId || ""), streamUrl: secure, streamKey: "",
        watchUrl: fbWatchUrl(permalink, pageId, liveId),
        crosspostPages,
      });
      continue;
    }
    if (d.type === "youtube") {
      // Nếu người dùng vẫn dán stream key thủ công (server_url + key) → giữ như RTMP.
      if (d.streamKey && d.streamUrl) {
        out.push({
          type: "youtube", label: d.label || "YouTube",
          streamUrl: d.streamUrl, streamKey: d.streamKey,
        });
        continue;
      }
      // Tự tạo broadcast + liveStream qua YouTube API (đã kết nối ở /admin/youtube-live).
      const yt = await getYouTubeProvider();
      let r;
      try {
        r = await yt.createLive({
          title, description: title, privacy: "public", dedicatedStream: true,
        });
      } catch (e) {
        const err = new Error(`YouTube create live lỗi: ${e?.response?.data?.error?.message || e?.message || e}`);
        err.status = 400; throw err;
      }
      if (!r?.serverUrl || !r?.streamKey) {
        const e = new Error("YouTube không trả ingestion (serverUrl/streamKey)"); e.status = 502; throw e;
      }
      out.push({
        type: "youtube", label: d.label || "YouTube",
        streamUrl: r.serverUrl, streamKey: r.streamKey,
        broadcastId: String(r.platformLiveId || ""),
        ytStreamId: String(r.streamId || ""),
        watchUrl: r.permalinkUrl || "",
      });
      continue;
    }
    const e = new Error(`Loại destination không hỗ trợ: ${d.type}`); e.status = 400; throw e;
  }
  return out;
}

async function decryptVenueImouCreds(venueId) {
  const venue = await Venue.findById(venueId).select("imouCreds").lean();
  const cipher = venue?.imouCreds?.cipher;
  if (!cipher) return null;
  const plain = decryptToken(cipher);
  if (!plain) return null;
  try { return JSON.parse(plain); } catch { return null; }
}

/**
 * Đầu thu Dahua/DMSS: trả { serial, username, password, channels } từ venue.dahuaNvr
 * (mật khẩu giải mã). null nếu venue chưa cấu hình đầu thu.
 */
async function decryptVenueDahuaCreds(venueId) {
  if (!venueId) return null;
  const venue = await Venue.findById(venueId).select("dahuaNvr").lean();
  const nvr = venue?.dahuaNvr;
  if (!nvr?.serial || !nvr?.credCipher) return null;
  const password = decryptToken(nvr.credCipher);
  if (!password) return null;
  return {
    serial: String(nvr.serial).trim(),
    username: String(nvr.username || "admin").trim(),
    channels: Number(nvr.channels) || 8,
    directHost: String(nvr.directHost || "").trim(),
    password,
  };
}

/**
 * Trả RTSP URL để kéo cam đầu thu Dahua của venue cho 1 kênh: ưu tiên directHost
 * (RTSP trực tiếp, full nét) → fallback P2P tunnel dùng chung. Dùng cho cả
 * auto-live lẫn preview (snapshot) ở admin. Ném lỗi nếu chưa cấu hình.
 */
export async function resolveDahuaRtsp({ venueId, channel = 1, subtype = 0 }) {
  const creds = await decryptVenueDahuaCreds(venueId);
  if (!creds?.serial || !creds?.password) {
    const e = new Error("Venue chưa cấu hình đầu thu Dahua (serial + mật khẩu)");
    e.status = 400;
    throw e;
  }
  const u = encodeURIComponent(creds.username || "admin");
  const p = encodeURIComponent(creds.password || "");
  const ch = Number(channel) || 1;
  const sub = Number(subtype) || 0;
  if (creds.directHost) {
    return `rtsp://${u}:${p}@${creds.directHost}/cam/realmonitor?channel=${ch}&subtype=${sub}`;
  }
  const { port } = await ensureDahuaTunnel({
    serial: creds.serial, username: creds.username, password: creds.password,
  });
  return dahuaChannelUrl({ username: creds.username, password: creds.password, port, channel: ch, subtype: sub });
}

/** Lưu cấu hình đầu thu Dahua P2P cho venue (mật khẩu mã hoá). */
export async function saveVenueDahuaNvr(venueId, { serial, username, password, channels, directHost }) {
  const { encryptToken } = await import("../secret.service.js");
  const set = {
    "dahuaNvr.serial": String(serial || "").trim(),
    "dahuaNvr.username": String(username || "admin").trim(),
    "dahuaNvr.updatedAt": new Date(),
  };
  if (channels != null && channels !== "") set["dahuaNvr.channels"] = Number(channels) || 8;
  if (directHost != null) {
    // Chuẩn hoá: bỏ scheme rtsp:// nếu người dùng dán vào, giữ host[:port].
    set["dahuaNvr.directHost"] = String(directHost).trim().replace(/^rtsp:\/\//i, "").replace(/\/+$/, "");
  }
  if (password) set["dahuaNvr.credCipher"] = encryptToken(String(password));
  await Venue.updateOne({ _id: venueId }, { $set: set });
  return true;
}

/**
 * Session lưu bởi mobile app (camelCase): {uuidUser,uuidKey,sessionId,regionalHost}.
 * Python cần snake_case: {uuid_user,uuid_key,session_id,regional_host}. Convert.
 */
async function decryptVenueImouSession(venueId) {
  const venue = await Venue.findById(venueId).select("imouSession").lean();
  const cipher = venue?.imouSession?.cipher;
  if (!cipher) return null;
  const plain = decryptToken(cipher);
  if (!plain) return null;
  let sess;
  try { sess = JSON.parse(plain); } catch { return null; }
  const host = String(sess.regionalHost || sess.regional_host || "")
    .replace(/^https?:\/\//, "").replace(/:443$/, "").replace(/\/$/, "");
  const out = {
    uuid_user: sess.uuidUser || sess.uuid_user,
    uuid_key: sess.uuidKey || sess.uuid_key,
    session_id: sess.sessionId || sess.session_id,
    regional_host: host,
    login_response: sess.loginResponse || sess.login_response || {},
  };
  if (!out.uuid_user || !out.uuid_key || !out.session_id || !out.regional_host) return null;
  return out;
}

/**
 * App live iOS (Plan A): lấy session Imou (camelCase) theo deviceId cam đã gắn
 * ở VenueCourt — để app tự kéo cam Imou làm nguồn (thay camera điện thoại) →
 * HaishinKit → FB. KHÔNG tạo session auto-live server; app tự lo FB/overlay.
 * Trả { imouDeviceId, venueId, imouSession:{uuidUser,uuidKey,sessionId,regionalHost} }
 * hoặc { error, code }.
 */
export async function getCourtImouSessionForApp(imouDeviceId) {
  const deviceId = String(imouDeviceId || "").trim();
  if (!deviceId) return { error: "Thiếu imouDeviceId", code: 400 };
  const VenueCourt = mongoose.model("VenueCourt");
  const vc = await VenueCourt.findOne({
    $or: [{ "imouCams.deviceId": deviceId }, { "imou.deviceId": deviceId }],
  }).select("venue").lean();
  if (!vc?.venue) return { error: "Không tìm thấy sân/venue cho deviceId này", code: 404 };
  const sess = await decryptVenueImouSession(vc.venue); // snake_case
  const creds = await decryptVenueImouCreds(vc.venue);  // {phone,password,areaCode}
  // Cần ÍT NHẤT 1 trong 2: session hợp lệ HOẶC creds để app tự đăng nhập.
  if (!sess && !(creds?.phone && creds?.password)) {
    return { error: "Venue chưa có phiên/creds Imou hợp lệ (cần đăng nhập Imou ở app quản lý)", code: 409 };
  }
  return {
    imouDeviceId: deviceId,
    venueId: String(vc.venue),
    imouSession: sess ? {
      uuidUser: sess.uuid_user, uuidKey: sess.uuid_key,
      sessionId: sess.session_id, regionalHost: sess.regional_host,
    } : null,
    // App dùng creds để tự relogin khi SaaS trả 12002 (session hết hạn/contention).
    imouCreds: (creds?.phone && creds?.password) ? {
      phone: creds.phone, password: creds.password, areaCode: creds.areaCode || "84",
    } : null,
  };
}

/**
 * App live ANDROID (Imou): trả RELAY URL DHAV (GetRealTransferStreamUrl) cho cam.
 * Backend chạy Python imou (đã test) lấy URL đã ký → Android chỉ cần DhRtspClient
 * + MediaCodec, khỏi port crypto/SaaS sang Kotlin. URL hết hạn ~10 phút → app gọi
 * lại mỗi lần reconnect. Trả { imouDeviceId, venueId, url } hoặc { error, code }.
 */
export async function getCourtImouStreamUrlForApp(imouDeviceId, streamId = "1") {
  const deviceId = String(imouDeviceId || "").trim();
  if (!deviceId) return { error: "Thiếu imouDeviceId", code: 400 };
  const VenueCourt = mongoose.model("VenueCourt");
  const vc = await VenueCourt.findOne({
    $or: [{ "imouCams.deviceId": deviceId }, { "imou.deviceId": deviceId }],
  }).select("venue").lean();
  if (!vc?.venue) return { error: "Không tìm thấy sân/venue cho deviceId này", code: 404 };
  const sess = await decryptVenueImouSession(vc.venue);  // snake_case
  const creds = await decryptVenueImouCreds(vc.venue);
  if (!sess && !(creds?.phone && creds?.password)) {
    return { error: "Venue chưa có phiên/creds Imou hợp lệ", code: 409 };
  }
  const input = JSON.stringify({
    session: sess || {},
    deviceId,
    creds: (creds?.phone && creds?.password)
      ? { phone: creds.phone, password: creds.password, area_code: creds.areaCode || "84" }
      : null,
    streamId: String(streamId || "1"),
  });
  const scriptPath = path.resolve(__dirname, "../../scripts/autoLive/get_imou_stream_url.py");
  return await new Promise((resolve) => {
    let out = "", err = "", done = false;
    const py = spawn(PYTHON_BIN, [scriptPath], { timeout: 30000 });
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    py.stdout.on("data", (d) => { out += d; });
    py.stderr.on("data", (d) => { err += d; });
    py.on("error", (e) => finish({ error: `spawn python: ${e.message}`, code: 500 }));
    py.on("close", () => {
      try {
        const line = out.trim().split("\n").filter(Boolean).pop() || "{}";
        const r = JSON.parse(line);
        if (r.error) finish({ error: r.error, code: 502 });
        else finish({ imouDeviceId: deviceId, venueId: String(vc.venue), url: r.url });
      } catch (e) {
        finish({ error: `python parse: ${e.message} :: ${err.slice(0, 200)}`, code: 502 });
      }
    });
    py.stdin.write(input); py.stdin.end();
  });
}

/**
 * Start 1 session mới. `input`:
 *   { tournamentId, courtStationId, imouDeviceId, destinations[], startedBy, autoNext }
 * Trả về document session đã insert. Ném lỗi nếu court đã có session active.
 */
export async function startAutoLive(input) {
  const {
    tournamentId, courtStationId, imouDeviceId, destinations,
    startedBy, autoNext = true, venueId: explicitVenueId, layout, advanced,
    sourceUrl, dahuaP2p, perMatchLive = false, title: customTitle,
    recordClips = false, splitPerTournament = false,
    hideTimestamp = false, timestampBox,
  } = input || {};
  // Tách live theo giải: chạy theo cơ chế status-driven (paused→live) như per-match.
  const lazyBroadcast = !!perMatchLive || !!splitPerTournament;
  const src = (sourceUrl || "").trim();
  const useDahua = !!(dahuaP2p && typeof dahuaP2p === "object"
    && (dahuaP2p.serial || dahuaP2p.channel != null || dahuaP2p.enabled));
  if (!tournamentId || !courtStationId || !Array.isArray(destinations) || !destinations.length) {
    const err = new Error("Thiếu tournamentId/courtStationId/destinations");
    err.status = 400; throw err;
  }
  if (!src && !imouDeviceId && !useDahua) {
    const err = new Error("Cần chọn camera Imou / đầu thu Dahua hoặc nhập Custom link");
    err.status = 400; throw err;
  }
  const station = await CourtStation.findById(courtStationId).select("_id clusterId overlayLayout").lean();
  if (!station) { const e = new Error("Court không tồn tại"); e.status = 404; throw e; }

  // Nguồn Imou cần venue + session; nguồn URL thì bỏ qua toàn bộ Imou.
  let venueId, imouSession = null, imouCreds = null, dahuaCfg = null;
  if (useDahua) {
    // Đầu thu Dahua P2P: cần venue (để lấy creds mã hoá). serial/pass ưu tiên
    // input (test), fallback venue.dahuaNvr.
    venueId = explicitVenueId;
    if (!venueId) {
      const e = new Error("Nguồn đầu thu Dahua cần chọn venue (venueId)");
      e.status = 400; throw e;
    }
    const stored = await decryptVenueDahuaCreds(venueId);
    const serial = String(dahuaP2p.serial || stored?.serial || "").trim();
    const username = String(dahuaP2p.username || stored?.username || "admin").trim();
    const password = String(dahuaP2p.password || stored?.password || "");
    if (!serial || !password) {
      const e = new Error("Chưa cấu hình đầu thu Dahua (serial + mật khẩu) cho venue này");
      e.status = 400; throw e;
    }
    dahuaCfg = {
      serial, username, password,
      channel: Number(dahuaP2p.channel) || 1,
      subtype: Number(dahuaP2p.subtype) || 0,
      directHost: stored?.directHost || "", // có → RTSP trực tiếp, bỏ P2P/relay
    };
  } else if (!src) {
    venueId = explicitVenueId;
    if (!venueId) {
      const VenueCourt = mongoose.model("VenueCourt");
      const vc = await VenueCourt.findOne({
        $or: [{ "imouCams.deviceId": imouDeviceId }, { "imou.deviceId": imouDeviceId }],
      }).select("venue").lean();
      venueId = vc?.venue;
    }
    if (!venueId) { const e = new Error("Không xác định được venue chứa cam"); e.status = 400; throw e; }
    imouSession = await decryptVenueImouSession(venueId);
    imouCreds = await decryptVenueImouCreds(venueId);
    if (!imouSession && !(imouCreds?.phone && imouCreds?.password)) {
      const e = new Error("Venue chưa có session lẫn tài khoản Imou. Chủ sân cần mở app mobile → Cài đặt cam Imou → Login lại.");
      e.status = 400; throw e;
    }
  }

  // Chuẩn hoá destinations: FB/YT chưa có streamUrl → gọi Graph API tạo
  // live_video / broadcast, lấy secure_stream_url. RTMP giữ nguyên.
  const tournament = await Tournament.findById(tournamentId).select("name").lean();
  // Tiêu đề live: dùng tiêu đề tuỳ chỉnh (nếu nhập), fallback tên giải.
  const baseTitle = String(customTitle || "").trim() || tournament?.name || "PickleTour Live";
  // perMatch / splitPerTournament: CHƯA tạo broadcast — chờ trận (pollOnce sẽ tạo). Chỉ lưu spec.
  const preparedDest = lazyBroadcast ? [] : await prepareDestinations(destinations, baseTitle);

  const runner = input.runner === "client" ? "client" : "server";
  // ID máy desktop (ổn định) — để hiển thị/nhóm luồng theo máy. Rỗng = server.
  const machineId = String(input.machineId || "").trim();

  // Vị trí overlay: ưu tiên layout client gửi; nếu không có → DÙNG LẠI vị trí đã lưu
  // cho SÂN này (overlayLayout) → tạo live lần sau không phải chỉnh lại.
  let effectiveLayout = layout && typeof layout === "object" ? layout : null;
  if (!effectiveLayout && station?.overlayLayout) {
    const ol = station.overlayLayout;
    const picked = {};
    for (const k of ["scoreboard", "brand", "sponsor"]) {
      if (ol[k]) picked[k] = ol[k];
    }
    if (Object.keys(picked).length) effectiveLayout = picked;
  }

  // KHÔNG dọn/stop phiên cũ trên cùng sân nữa: cho phép NHIỀU luồng live song song
  // trên 1 sân (kể cả cùng 1 máy). Phiên treo/mồ côi sẽ tự được dọn qua heartbeat
  // (pollOnce: client mất heartbeat >60s → error). Mỗi lần "thêm sân live" = 1 phiên mới.

  const session = await TournamentAutoLiveSession.create({
    tournament: tournamentId, court: courtStationId, venue: venueId,
    imouDeviceId: imouDeviceId || "", sourceUrl: src,
    dahuaP2p: dahuaCfg
      ? { serial: dahuaCfg.serial, channel: dahuaCfg.channel, subtype: dahuaCfg.subtype }
      : undefined,
    startedBy, destinations: preparedDest, autoNext, perMatchLive: !!perMatchLive,
    splitPerTournament: !perMatchLive && !!splitPerTournament,
    // destSpecs: cần cho tạo lại broadcast (per-match từng trận / split khi đổi giải).
    destSpecs: lazyBroadcast ? (destinations || []) : [],
    liveTitle: baseTitle,
    // Ghi + cắt clip từng trận lên Drive: chỉ live xuyên suốt (không per-match).
    recordClips: !perMatchLive && !!recordClips,
    layout: effectiveLayout || undefined,
    advanced: advanced && typeof advanced === "object" ? advanced : undefined,
    hideTimestamp: !!hideTimestamp,
    timestampBox: timestampBox && typeof timestampBox === "object" ? timestampBox : undefined,
    runner, machineId,
    status: lazyBroadcast ? "paused" : "starting", workerId: crypto.randomUUID(),
    startedAt: new Date(),
  });

  // Client-runner: KHÔNG spawn trên server. App desktop lấy worker-config rồi
  // tự chạy (GPU). Backend vẫn poll để bump overlay + theo dõi heartbeat.
  if (runner === "client") {
    startPoll(session._id);
    return session.toObject();
  }

  // perMatch / split (server): CHƯA lên live — chỉ poll, chờ trận (pollOnce sẽ tạo
  // broadcast + spawn worker). Chỉ gán sân sẽ KHÔNG live.
  if (lazyBroadcast) {
    startPoll(session._id);
    return session.toObject();
  }

  // Guard RAM (server-runner): không mở thêm luồng khi RAM trống quá thấp →
  // tránh chồng luồng làm full RAM máy chủ.
  const freeMB = Math.round(os.freemem() / 1024 / 1024);
  if (MIN_FREE_MB_TO_START > 0 && freeMB < MIN_FREE_MB_TO_START) {
    session.status = "error";
    session.lastError = `RAM máy chủ còn ${freeMB}MB (< ${MIN_FREE_MB_TO_START}MB) — không đủ mở thêm luồng. `
      + `Dừng bớt luồng đang chạy rồi thử lại.`;
    session.lastErrorAt = new Date();
    session.stoppedAt = new Date();
    await session.save();
    const e = new Error(session.lastError); e.status = 503; throw e;
  }

  try {
    // Nguồn đầu thu Dahua P2P (server-runner): mở/tái dùng MỘT tunnel dùng chung
    // cho serial này (nhiều court cùng đầu thu → cùng 1 phiên P2P, khác kênh) →
    // đưa RTSP local cho worker như nguồn URL thường.
    let dahuaSourceUrl = "";
    if (dahuaCfg) {
      const u = encodeURIComponent(dahuaCfg.username || "admin");
      const p = encodeURIComponent(dahuaCfg.password || "");
      if (dahuaCfg.directHost) {
        // RTSP TRỰC TIẾP (LAN/DDNS) — full bitrate, KHÔNG qua P2P/relay.
        dahuaSourceUrl =
          `rtsp://${u}:${p}@${dahuaCfg.directHost}/cam/realmonitor` +
          `?channel=${dahuaCfg.channel}&subtype=${dahuaCfg.subtype}`;
      } else {
        // Fallback: P2P tunnel (có thể rơi relay → kém ổn định).
        const { port } = await ensureDahuaTunnel({
          serial: dahuaCfg.serial, username: dahuaCfg.username, password: dahuaCfg.password,
        });
        dahuaSourceUrl = dahuaChannelUrl({
          username: dahuaCfg.username, password: dahuaCfg.password, port,
          channel: dahuaCfg.channel, subtype: dahuaCfg.subtype,
        });
      }
    }
    const proc = spawnWorker(session, imouSession, imouCreds, dahuaCfg, dahuaSourceUrl);
    const entry = { proc, overlayCache: null, pollTimer: null };
    registry.set(String(session._id), entry);
    session.workerPid = proc.pid || 0;
    session.workerStartedAt = new Date();
    session.status = "live";
    await session.save();
    startPoll(session._id);
    return session.toObject();
  } catch (e) {
    session.status = "error";
    session.lastError = String(e?.message || e).slice(0, 500);
    session.lastErrorAt = new Date();
    session.stoppedAt = new Date();
    await session.save();
    throw e;
  }
}

/** advanced (session) → env cho worker. Bỏ qua field rỗng/không hợp lệ. */
function advancedEnv(a) {
  a = a || {};
  const env = {};
  if (a.videoBitrateKbps) env.AUTOLIVE_VIDEO_BITRATE = String(a.videoBitrateKbps);
  if (a.maxBitrateKbps) env.AUTOLIVE_MAX_BITRATE = String(a.maxBitrateKbps);
  if (a.resolutionH) env.AUTOLIVE_RES_H = String(a.resolutionH);
  if (a.fps) env.AUTOLIVE_FPS = String(a.fps);
  if (a.audioBitrateKbps) env.AUTOLIVE_AUDIO_BITRATE = String(a.audioBitrateKbps);
  if (a.encoder && a.encoder !== "auto") env.AUTOLIVE_ENCODER = String(a.encoder);
  if (a.imouStreamId) env.AUTOLIVE_IMOU_STREAM_ID = String(a.imouStreamId); // "1"=luồng phụ nhẹ
  if (a.imouAudio) env.AUTOLIVE_IMOU_AUDIO = String(a.imouAudio);
  if (a.resyncSec != null && a.resyncSec !== "") env.AUTOLIVE_RESYNC_SEC = String(a.resyncSec); // re-sync mép live
  if (a.imouLiveStream) env.AUTOLIVE_IMOU_LIVE_STREAM = String(a.imouLiveStream); // rtmp/hls/rtsp cloud live
  if (a.fillScreen) env.AUTOLIVE_FILL_SCREEN = "1"; // phủ kín 16:9 (cắt viền) — cho nguồn 4:3
  return env;
}

function spawnWorker(session, imouSession, imouCreds, dahuaCfg, dahuaSourceUrl) {
  const backendBase = process.env.PUBLIC_BACKEND_URL || "http://localhost:5001";
  const overlayUrl = `${backendBase}/api/tournament-auto-live/overlay/${session._id}.png`;
  const heartbeatUrl = `${backendBase}/api/tournament-auto-live/internal/heartbeat`;
  const sessionPostUrl = `${backendBase}/api/tournament-auto-live/internal/imou-session`;
  const args = [WORKER_SCRIPT];
  const env = {
    ...process.env,
    AUTOLIVE_SESSION_ID: String(session._id),
    AUTOLIVE_WORKER_TOKEN: process.env.AUTOLIVE_WORKER_TOKEN || "changeme",
    AUTOLIVE_OVERLAY_URL: overlayUrl,
    AUTOLIVE_HEARTBEAT_URL: heartbeatUrl,
    AUTOLIVE_SESSION_POST_URL: sessionPostUrl,
    AUTOLIVE_IMOU_SESSION_JSON: imouSession ? JSON.stringify(imouSession) : "",
    AUTOLIVE_IMOU_PHONE: imouCreds?.phone || "",
    AUTOLIVE_IMOU_PASSWORD: imouCreds?.password || "",
    AUTOLIVE_IMOU_AREA_CODE: imouCreds?.areaCode || "84",
    AUTOLIVE_IMOU_DEVICE_ID: session.imouDeviceId || "",
    // Dahua P2P (server): backend đã mở tunnel dùng chung → truyền thẳng RTSP local
    // như nguồn URL (KHÔNG để worker tự spawn tunnel → tránh mở thêm phiên P2P).
    // Fallback: nếu vì lý do gì không có dahuaSourceUrl thì để worker tự spawn.
    AUTOLIVE_SOURCE_URL: dahuaSourceUrl || session.sourceUrl || "",
    AUTOLIVE_DAHUA_P2P_JSON: (dahuaCfg && !dahuaSourceUrl) ? JSON.stringify(dahuaCfg) : "",
    AUTOLIVE_DAHUA_P2P_BIN: process.env.AUTOLIVE_DAHUA_P2P_BIN || DAHUA_P2P_BIN_DEFAULT,
    AUTOLIVE_DESTINATIONS: JSON.stringify(session.destinations.map((d) => ({
      type: d.type, streamUrl: d.streamUrl, streamKey: d.streamKey || "",
    }))),
    ...advancedEnv(session.advanced),
  };
  // Log ra FILE (không pipe): nếu pipe mà backend chết thì Python print →
  // EPIPE → worker chết theo. detached + unref để pm2 restart không kill.
  const logFd = fs.openSync(workerLogPath(session._id), "a");
  const proc = spawn(PYTHON_BIN, args, {
    env, detached: true, stdio: ["ignore", logFd, logFd],
  });
  proc.unref();
  fs.closeSync(logFd);
  proc.on("exit", async (code, signal) => {
    console.log(`[auto-live] worker exit sid=${session._id} code=${code} signal=${signal}`);
    // Đang restart chủ động (per-match) → bỏ qua, respawn sẽ tiếp quản.
    if (restartingSessions.has(String(session._id))) return;
    const doc = await TournamentAutoLiveSession.findById(session._id);
    if (!doc) return;
    // "stopped" = user dừng; "paused" = per-match dừng worker chờ trận kế → không mark lỗi.
    if (doc.status === "stopped" || doc.status === "paused") return;
    doc.status = code === 0 ? "stopped" : "error";
    doc.lastError = `worker exited code=${code} signal=${signal || ""} (xem ${workerLogPath(session._id)})`.trim();
    doc.lastErrorAt = new Date();
    doc.stoppedAt = new Date();
    await doc.save();
    stopPoll(session._id);
    registry.delete(String(session._id));
  });
  return proc;
}

/** Re-resolve nguồn (imou/dahua/url) từ session để respawn worker (per-match restart). */
async function resolveSessionSource(session) {
  let imouSession = null, imouCreds = null, dahuaCfg = null, dahuaSourceUrl = "";
  if (session.dahuaP2p?.serial && session.venue) {
    const stored = await decryptVenueDahuaCreds(session.venue);
    dahuaCfg = {
      serial: session.dahuaP2p.serial,
      username: stored?.username || "admin",
      password: stored?.password || "",
      channel: Number(session.dahuaP2p.channel) || 1,
      subtype: Number(session.dahuaP2p.subtype) || 0,
      directHost: stored?.directHost || "",
    };
    const u = encodeURIComponent(dahuaCfg.username || "admin");
    const p = encodeURIComponent(dahuaCfg.password || "");
    if (dahuaCfg.directHost) {
      dahuaSourceUrl = `rtsp://${u}:${p}@${dahuaCfg.directHost}/cam/realmonitor`
        + `?channel=${dahuaCfg.channel}&subtype=${dahuaCfg.subtype}`;
    } else {
      const { port } = await ensureDahuaTunnel({
        serial: dahuaCfg.serial, username: dahuaCfg.username, password: dahuaCfg.password,
      });
      dahuaSourceUrl = dahuaChannelUrl({
        username: dahuaCfg.username, password: dahuaCfg.password, port,
        channel: dahuaCfg.channel, subtype: dahuaCfg.subtype,
      });
    }
  } else if (!session.sourceUrl && session.imouDeviceId && session.venue) {
    imouSession = await decryptVenueImouSession(session.venue);
    imouCreds = await decryptVenueImouCreds(session.venue);
  }
  return { imouSession, imouCreds, dahuaCfg, dahuaSourceUrl };
}

/** Respawn worker (server-runner) với destinations hiện tại của session. */
async function respawnWorkerForSession(session) {
  const { imouSession, imouCreds, dahuaCfg, dahuaSourceUrl } = await resolveSessionSource(session);
  const proc = spawnWorker(session, imouSession, imouCreds, dahuaCfg, dahuaSourceUrl);
  const entry = registry.get(String(session._id)) || {};
  entry.proc = proc;
  registry.set(String(session._id), entry);
  session.workerPid = proc.pid || 0;
  session.workerStartedAt = new Date();
  await session.save();
  return proc;
}

/** perMatchLive: điều khiển live theo TRẠNG THÁI trận trên sân.
 *  - Trận status="live" (đã bắt đầu) mà chưa live / đang live trận khác → GO LIVE.
 *  - Đang live nhưng trận kết thúc / đổi / rời sân → STOP (chờ trận kế).
 *  - Chỉ mới gán sân (status="assigned"/"queued") → KHÔNG live. */
async function pollPerMatch(session, station) {
  const sid = String(session._id);
  const curMatchId = station?.currentMatch ? String(station.currentMatch) : "";
  let curStatus = "";
  if (curMatchId) {
    const m = await Match.findById(curMatchId).select("status").lean();
    curStatus = m?.status || "";
  }
  const liveMatchId = session.liveMatchId ? String(session.liveMatchId) : "";
  const shouldLive = !!curMatchId && curStatus === "live";

  // 1) Trận mới đã BẮT ĐẦU → live cho trận đó (dừng trận cũ nếu đang live trận khác).
  if (shouldLive && liveMatchId !== curMatchId) {
    if (liveMatchId) { await perMatchStop(session); }
    await perMatchGoLive(session, curMatchId);
    return;
  }
  // 2) Đang live nhưng trận đã kết thúc / đổi / rời sân → dừng, chờ trận kế.
  if (liveMatchId && !(shouldLive && liveMatchId === curMatchId)) {
    await perMatchStop(session);
    return;
  }
  // 3) Đang live đúng trận → cập nhật overlay (điểm số). Worker chết → exit handler
  //    tự mark error (poll dừng ở nhịp sau).
  if (liveMatchId && curMatchId === liveMatchId) {
    await bumpOverlayForSession(sid);
    if (session.runner === "server") {
      try {
        const { cpuPct, memMB } = sampleProcessTree(session.workerPid, sid);
        session.cpuPct = cpuPct; session.memMB = memMB; await session.save();
      } catch { /* /proc không có */ }
    }
  }
  // 4) else: paused, chờ trận bắt đầu — không làm gì.
}

/** perMatchLive: tạo broadcast + spawn worker cho 1 trận (khi trận bắt đầu). */
async function perMatchGoLive(session, matchId) {
  const sid = String(session._id);
  if (perMatchInFlight.has(sid)) return;
  perMatchInFlight.add(sid);
  try {
    session.currentMatch = matchId;
    // Lấy giải TỪ CHÍNH TRẬN (không phải session) → sang nội dung khác thì title đúng giải.
    const m = await Match.findById(matchId).select("tournament code labelKey").lean();
    session.currentMatchLabel = m?.code || m?.labelKey || String(matchId).slice(-6);
    const tour = await Tournament.findById(m?.tournament || session.tournament).select("name").lean();
    // perMatchLive: tiêu đề TỰ ĐỘNG = "Tên giải - Tên trận" (bỏ qua tiêu đề tuỳ chỉnh).
    const base = tour?.name || "PickleTour Live";
    const title = `${base}${session.currentMatchLabel ? " - " + session.currentMatchLabel : ""}`.slice(0, 120);
    const specs = Array.isArray(session.destSpecs) ? session.destSpecs : [];
    if (!specs.length) { console.warn(`[auto-live] per-match go-live ${sid}: thiếu destSpecs`); return; }
    let fresh;
    try {
      fresh = await prepareDestinations(specs, title);
    } catch (e) {
      console.warn(`[auto-live] per-match tạo broadcast lỗi ${sid}:`, e?.message || e);
      return; // giữ paused, thử lại nhịp sau
    }
    session.destinations = fresh;
    session.liveMatchId = matchId;
    session.status = "live";
    session.lastMatchChangeAt = new Date();
    await session.save();
    // Gắn link xem live vào chính trận này → chi tiết trận hiện "Xem trực tiếp".
    await applyLiveLinksToMatch(session, matchId);
    // Server-runner: backend tự spawn ffmpeg. Client-runner: app desktop tự start
    // khi thấy status="live" + destinations (qua poll worker-config).
    if (session.runner === "server") await respawnWorkerForSession(session);
    console.log(`[auto-live] per-match GO LIVE ${sid} match=${matchId} runner=${session.runner} (${session.currentMatchLabel || ""})`);
  } finally {
    perMatchInFlight.delete(sid);
  }
}

/** perMatchLive: kết thúc broadcast + dừng worker khi trận xong; session về "paused". */
async function perMatchStop(session) {
  const sid = String(session._id);
  if (perMatchInFlight.has(sid)) return;
  perMatchInFlight.add(sid);
  try {
    // Server-runner: dừng worker ffmpeg trên máy chủ (client-runner: app desktop tự dừng).
    if (session.runner === "server") {
      restartingSessions.add(sid); // exit handler worker cũ KHÔNG mark error
      if (isPidAlive(session.workerPid)) { try { process.kill(session.workerPid, "SIGTERM"); } catch {} }
      setTimeout(() => restartingSessions.delete(sid), 4000);
    }
    // Gỡ link live khỏi trận vừa xong (nắm matchId + watchUrl TRƯỚC khi xoá destinations).
    const endedMatchId = session.liveMatchId ? String(session.liveMatchId) : "";
    const endedUrls = sessionWatchUrls(session);
    await endDestinationBroadcasts(session.destinations || []);
    session.destinations = [];
    session.liveMatchId = null;
    session.liveTournament = null; // split: hết broadcast của giải hiện tại
    session.workerPid = 0;
    session.cpuPct = 0; session.memMB = 0;
    session.status = "paused";
    await session.save();
    if (endedMatchId) await clearLiveLinksFromMatch(endedMatchId, endedUrls);
    clearProcSample(sid);
    console.log(`[auto-live] per-match STOP ${sid} — chờ trận kế.`);
  } finally {
    perMatchInFlight.delete(sid);
  }
}

// ── Tách live theo GIẢI (splitPerTournament): live xuyên suốt trong 1 giải, đổi
//    giải thì end live cũ + tạo live mới (title = tên giải mới). ─────────────
async function splitGoLive(session, matchId, tournamentId) {
  const sid = String(session._id);
  if (perMatchInFlight.has(sid)) return;
  perMatchInFlight.add(sid);
  try {
    const m = await Match.findById(matchId).select("code labelKey").lean();
    session.currentMatch = matchId;
    session.currentMatchLabel = m?.code || m?.labelKey || String(matchId).slice(-6);
    const tour = await Tournament.findById(tournamentId).select("name").lean();
    const title = (tour?.name || "PickleTour Live").slice(0, 120);
    const specs = Array.isArray(session.destSpecs) ? session.destSpecs : [];
    if (!specs.length) { console.warn(`[auto-live] split go-live ${sid}: thiếu destSpecs`); return; }
    let fresh;
    try { fresh = await prepareDestinations(specs, title); }
    catch (e) { console.warn(`[auto-live] split tạo broadcast lỗi ${sid}:`, e?.message || e); return; }
    session.destinations = fresh;
    session.liveTournament = tournamentId;
    session.liveMatchId = matchId;
    session.liveTitle = title;
    session.status = "live";
    session.lastMatchChangeAt = new Date();
    await session.save();
    await applyLiveLinksToMatch(session, matchId);
    if (session.runner === "server") await respawnWorkerForSession(session);
    console.log(`[auto-live] split GO LIVE ${sid} tournament=${tournamentId} (${title})`);
  } finally {
    perMatchInFlight.delete(sid);
  }
}

async function pollSplitTournament(session, station) {
  const sid = String(session._id);
  const curMatchId = station?.currentMatch ? String(station.currentMatch) : "";
  let curTid = "";
  if (curMatchId) {
    const m = await Match.findById(curMatchId).select("tournament").lean();
    curTid = m?.tournament ? String(m.tournament) : "";
  }
  const liveTid = session.liveTournament ? String(session.liveTournament) : "";

  // 1) Có trận thuộc GIẢI KHÁC (hoặc chưa live) → end live cũ + tạo live mới cho giải đó.
  if (curMatchId && curTid && curTid !== liveTid) {
    if (liveTid) await perMatchStop(session); // end broadcast cũ + pause (client tự dừng ffmpeg)
    await splitGoLive(session, curMatchId, curTid);
    return;
  }
  // 2) Cùng giải → live xuyên suốt, follow trận (overlay + link theo trận hiện tại).
  if (liveTid && curMatchId && curTid === liveTid) {
    if (String(session.currentMatch || "") !== curMatchId) {
      const prev = session.currentMatch ? String(session.currentMatch) : "";
      if (prev) await clearLiveLinksFromMatch(prev, sessionWatchUrls(session));
      session.currentMatch = curMatchId;
      session.currentMatchLabel = await matchShortLabel(curMatchId);
      session.lastMatchChangeAt = new Date();
      await session.save();
      await applyLiveLinksToMatch(session, curMatchId);
    }
    await bumpOverlayForSession(sid);
    if (session.runner === "server") {
      try { const { cpuPct, memMB } = sampleProcessTree(session.workerPid, sid); session.cpuPct = cpuPct; session.memMB = memMB; await session.save(); } catch {}
    }
    return;
  }
  // 3) Đang live nhưng sân tạm trống (giữa 2 trận cùng giải) → GIỮ live, chỉ bump overlay.
  if (liveTid && !curMatchId) { await bumpOverlayForSession(sid); return; }
  // 4) Chưa live + chưa có trận → chờ.
}

export async function stopAutoLive(sessionId) {
  const session = await TournamentAutoLiveSession.findById(sessionId);
  if (!session) { const e = new Error("Session không tồn tại"); e.status = 404; throw e; }
  session.status = "stopped";
  session.stoppedAt = new Date();
  await session.save();
  // Kill theo PID (worker detached, có thể được spawn bởi process backend cũ).
  const pid = session.workerPid;
  if (isPidAlive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    setTimeout(() => { if (isPidAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} } }, 6000);
  }
  stopPoll(sessionId);
  registry.delete(String(sessionId));
  clearProcSample(String(sessionId));
  // Nếu là phiên đầu thu Dahua: chạy reconcile để nhả tunnel dùng chung khi
  // không còn court nào dùng serial này (nếu còn court khác thì giữ nguyên).
  if (session.dahuaP2p?.serial) { try { triggerDahuaReconcile(); } catch {} }
  // Gỡ link live khỏi trận đang gắn (per-match: liveMatchId; xuyên suốt: currentMatch).
  const urls = sessionWatchUrls(session);
  const liveMids = [...new Set([session.liveMatchId, session.currentMatch].filter(Boolean).map(String))];
  for (const mid of liveMids) await clearLiveLinksFromMatch(mid, urls);
  // Trận đang phát dở khi dừng phiên → vẫn tạo task cắt clip (live xuyên suốt).
  if (session.recordClips && session.currentMatch) {
    await createClipTaskForEndedMatch(session, session.currentMatch, {
      startAt: session.lastMatchChangeAt, endAt: new Date(),
    });
  }
  // Kết thúc live FB + YouTube để không treo "đang phát" với hình đứng.
  await endDestinationBroadcasts(session.destinations || []);
  return session.toObject();
}

/** Worker bị 12002 → hỏi session mới nhất trong DB (app mobile có thể vừa
 *  login/upload) trước khi tự relogin. Trả snake_case cho Python. */
export async function getImouSessionForWorker(sessionId) {
  const doc = await TournamentAutoLiveSession.findById(sessionId).select("venue").lean();
  if (!doc) return null;
  const sess = await decryptVenueImouSession(doc.venue);
  if (!sess) return null;
  const venue = await Venue.findById(doc.venue).select("imouSession.updatedAt").lean();
  return { ...sess, updatedAt: venue?.imouSession?.updatedAt || null };
}

/** Worker phải restart ffmpeg (ffmpeg chết) → tạo lại FB live_video (key mới,
 *  FB không cho re-publish cùng key) và trả tee destinations mới. RTMP/YT giữ
 *  nguyên. Cập nhật session.destinations + watchUrl. */
export async function refreshDestinationsForWorker(sessionId) {
  const session = await TournamentAutoLiveSession.findById(sessionId).lean();
  if (!session) return null;
  // Phiên đang DỪNG/chờ trận (trọng tài vừa kết thúc trận) → KHÔNG tạo lại FB: tránh
  // tạo video FB thừa + tránh race VersionError với perMatchStop/stop đang sửa cùng doc.
  if (["stopped", "paused", "reconnecting"].includes(session.status)) return null;
  const tournament = await Tournament.findById(session.tournament).select("name").lean();
  const title = session.liveTitle || tournament?.name || "PickleTour Live";
  const fresh = [];
  for (const d of session.destinations || []) {
    if (d.type === "fb") {
      try {
        const [n] = await prepareDestinations(
          [{ type: "fb", pageId: d.pageId, pageName: d.pageName }], title);
        fresh.push(n);
      } catch (e) {
        console.warn("[auto-live] refresh FB dest fail:", e?.message || e);
        fresh.push(d); // giữ cũ (có thể vẫn fail nhưng không mất cấu hình)
      }
    } else {
      fresh.push(d);
    }
  }
  // Lưu bằng updateOne (KHÔNG dùng doc.save) để tránh VersionError khi phiên bị sửa
  // song song (perMatchStop/stop). CHỈ cập nhật nếu phiên vẫn còn "live".
  const r = await TournamentAutoLiveSession.updateOne(
    { _id: sessionId, status: "live" },
    { $set: { destinations: fresh } },
  );
  if (!r.matchedCount) return null; // phiên đã dừng trong lúc tạo lại → bỏ
  return fresh.map((d) => ({
    type: d.type, streamUrl: d.streamUrl, streamKey: d.streamKey || "",
  }));
}

/** Worker relogin Imou xong → lưu session mới (camelCase, mã hoá) vào venue. */
export async function saveImouSessionFromWorker(sessionId, sess) {
  const doc = await TournamentAutoLiveSession.findById(sessionId).select("venue").lean();
  if (!doc) return false;
  const forStorage = {
    uuidUser: sess?.uuid_user, uuidKey: sess?.uuid_key,
    sessionId: sess?.session_id, regionalHost: sess?.regional_host,
  };
  if (!forStorage.uuidUser || !forStorage.sessionId) return false;
  const { encryptToken } = await import("../secret.service.js");
  await Venue.updateOne(
    { _id: doc.venue },
    { $set: { imouSession: { cipher: encryptToken(JSON.stringify(forStorage)), updatedAt: new Date() } } }
  );
  return true;
}

export async function recordHeartbeat(sessionId, extra = {}) {
  const set = { workerLastHeartbeatAt: new Date(), status: "live" };
  if (extra.encoder) set.encoder = String(extra.encoder).slice(0, 40);
  if (extra.runnerLabel) set.runnerLabel = String(extra.runnerLabel).slice(0, 80);
  if (extra.runnerOs) set.runnerOs = String(extra.runnerOs).slice(0, 60);
  if (Number.isFinite(extra.cpuPct)) set.cpuPct = Math.max(0, Math.round(extra.cpuPct));
  if (Number.isFinite(extra.memMB)) set.memMB = Math.max(0, Math.round(extra.memMB));
  if (Number.isFinite(extra.bitrateKbps)) set.bitrateKbps = Math.max(0, Math.round(extra.bitrateKbps));
  if (Number.isFinite(extra.fps)) set.fps = Math.max(0, Math.round(extra.fps));
  if (Number.isFinite(extra.speed)) set.speed = Math.round((extra.speed) * 100) / 100;
  const doc = await TournamentAutoLiveSession.findById(sessionId).select("status runner court machineId");
  if (!doc) return null;
  // Client tự stop khi admin đã dừng phiên.
  if (doc.status === "stopped") return { _stopped: true };
  // Không còn unique index {court,...} nên heartbeat không đụng E11000; cho phép
  // nhiều luồng live song song cùng sân. Chỉ cập nhật trạng thái phiên này.
  try {
    await TournamentAutoLiveSession.updateOne({ _id: sessionId }, { $set: set });
  } catch (e) {
    console.warn("[autolive] heartbeat update failed:", e?.message || e);
  }
  return { _stopped: false };
}

/** Cấu hình đầy đủ để app desktop (client) tự chạy worker: session Imou đã
 *  giải mã, deviceId, destinations (kèm key), URL overlay/heartbeat/… */
export async function getWorkerConfig(sessionId) {
  const s = await TournamentAutoLiveSession.findById(sessionId).lean();
  if (!s) return null;
  const imouSession = await decryptVenueImouSession(s.venue);
  const imouCreds = await decryptVenueImouCreds(s.venue);
  const base = process.env.PUBLIC_BACKEND_URL || "http://localhost:5001";
  // Nguồn đầu thu Dahua P2P: kèm creds (từ venue) để client tự spawn tunnel.
  let dahuaP2p = null;
  if (s.dahuaP2p?.serial) {
    const stored = await decryptVenueDahuaCreds(s.venue);
    dahuaP2p = {
      serial: s.dahuaP2p.serial,
      username: stored?.username || "admin",
      password: stored?.password || "",
      channel: s.dahuaP2p.channel || 1,
      subtype: s.dahuaP2p.subtype || 0,
    };
  }
  return {
    sessionId: String(s._id),
    imouDeviceId: s.imouDeviceId || "",
    sourceUrl: s.sourceUrl || "",
    dahuaP2p,
    imouSession: imouSession || null,
    imouCreds: imouCreds ? {
      phone: imouCreds.phone, password: imouCreds.password, areaCode: imouCreds.areaCode || "84",
    } : null,
    destinations: (s.destinations || []).map((d) => ({
      type: d.type, streamUrl: d.streamUrl, streamKey: d.streamKey || "", watchUrl: d.watchUrl || "",
    })),
    workerToken: process.env.AUTOLIVE_WORKER_TOKEN || "",
    advancedEnv: advancedEnv(s.advanced), // {AUTOLIVE_VIDEO_BITRATE,...} app set vào env worker
    overlayUrl: `${base}/api/tournament-auto-live/overlay/${s._id}.png`,
    heartbeatUrl: `${base}/api/tournament-auto-live/internal/heartbeat`,
    sessionPostUrl: `${base}/api/tournament-auto-live/internal/imou-session`,
    destinationsUrl: `${base}/api/tournament-auto-live/internal/destinations`,
    // Ghi + cắt clip từng trận: bật ghi segment local + đẩy về server ban đêm.
    recordClips: !!s.recordClips,
    recordingPlanUrl: `${base}/api/tournament-auto-live/internal/recording/plan`,
    recordingSegmentUrl: `${base}/api/tournament-auto-live/internal/recording/segment`,
  };
}

/** Thống kê tài nguyên máy chủ + ước tính số luồng đồng thời. */
export async function getSystemStats() {
  const live = await TournamentAutoLiveSession.find({
    status: { $in: ["live", "reconnecting", "starting"] },
  }).select("cpuPct memMB").lean();
  return systemCapacity(live.map((s) => ({ cpuPct: s.cpuPct || 0, memMB: s.memMB || 0 })));
}

export function listActiveInMemory() {
  return Array.from(registry.entries()).map(([sid, entry]) => ({
    sessionId: sid, pid: entry.proc?.pid, hasCache: !!entry.overlayCache,
  }));
}
