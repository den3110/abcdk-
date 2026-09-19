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
import { loadOverlayData, renderOverlayPng } from "./overlayRenderer.service.js";
import { getValidPageToken } from "../fbTokenService.js";
import { fbCreateLiveOnPage, fbGetLiveVideo, fbEndLiveVideo } from "../facebookLive.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.resolve(__dirname, "../../scripts/autoLive/worker.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

// Map sessionId → { proc|null, pollTimer }
// Worker Python chạy DETACHED (session riêng, log ra file) để pm2 restart /
// deploy backend KHÔNG làm rớt live. Sau khi backend khởi động lại, các
// phiên còn sống được "nhận nuôi" lại theo PID (adoptRunningSessions).
const registry = new Map();

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
  }).select("_id workerPid").lean();
  for (const d of docs) {
    const sid = String(d._id);
    if (isPidAlive(d.workerPid)) {
      if (!registry.has(sid)) registry.set(sid, { proc: null, pollTimer: null });
      startPoll(sid);
      console.log(`[auto-live] adopted session ${sid} pid=${d.workerPid}`);
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

/**
 * Trả về overlay PNG cho session (worker Python fetch qua ffmpeg).
 * KHÔNG dựa vào in-memory registry — pm2 cluster nhiều process, request có
 * thể vào bất kỳ worker Node nào. Load session từ DB, chỉ cần status không
 * phải "stopped", render trực tiếp từ overlay data hiện tại của court.
 * Cache theo overlayVersion để không render lại khi data chưa đổi.
 */
const overlayCache = new Map(); // sessionId → { buf, version }
export async function getCachedOverlayPng(sessionId) {
  const doc = await TournamentAutoLiveSession.findById(sessionId)
    .select("_id court status overlayVersion")
    .lean();
  if (!doc) return null;
  if (doc.status === "stopped") return null;
  const cached = overlayCache.get(String(sessionId));
  if (cached && cached.version === (doc.overlayVersion || 0)) return cached.buf;
  const data = await loadOverlayData(doc.court);
  const buf = renderOverlayPng(data);
  overlayCache.set(String(sessionId), { buf, version: doc.overlayVersion || 0 });
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
  if (newMatchId !== oldMatchId) {
    session.currentMatch = newMatchId || null;
    session.currentMatchLabel = newMatchId
      ? await matchShortLabel(newMatchId)
      : "";
    session.lastMatchChangeAt = new Date();
    await session.save();
    await bumpOverlayForSession(sessionId);
  } else {
    // Cùng match nhưng có thể tỉ số đổi — vẫn re-render để cập nhật scoreboard.
    await bumpOverlayForSession(sessionId);
  }
  // Worker chết (PID không còn) mà chưa ai mark → error. Cần vì sau khi
  // backend restart không còn handler 'exit' của process cũ.
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
  // Heartbeat: nếu quá 30s không có heartbeat từ worker → mark reconnecting.
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
      out.push({
        type: "fb", label: d.pageName || pageId, pageId, pageName: d.pageName || "",
        broadcastId: String(liveId || ""), streamUrl: secure, streamKey: "",
        watchUrl: fbWatchUrl(permalink, pageId, liveId),
      });
      continue;
    }
    if (d.type === "youtube") {
      const e = new Error(`YouTube destination chưa hỗ trợ ở MVP — dùng RTMP tuỳ chỉnh với URL từ YouTube Studio`);
      e.status = 501; throw e;
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
 * Start 1 session mới. `input`:
 *   { tournamentId, courtStationId, imouDeviceId, destinations[], startedBy, autoNext }
 * Trả về document session đã insert. Ném lỗi nếu court đã có session active.
 */
export async function startAutoLive(input) {
  const {
    tournamentId, courtStationId, imouDeviceId, destinations,
    startedBy, autoNext = true, venueId: explicitVenueId,
  } = input || {};
  if (!tournamentId || !courtStationId || !imouDeviceId || !Array.isArray(destinations) || !destinations.length) {
    const err = new Error("Thiếu tournamentId/courtStationId/imouDeviceId/destinations");
    err.status = 400; throw err;
  }
  const station = await CourtStation.findById(courtStationId).select("_id clusterId").lean();
  if (!station) { const e = new Error("Court không tồn tại"); e.status = 404; throw e; }

  // Ưu tiên venueId FE gửi lên (đến từ available-cams). Nếu không có, tra
  // ngược qua device: cam Imou nào có deviceId khớp trong toàn bộ VenueCourt.
  let venueId = explicitVenueId;
  if (!venueId) {
    const VenueCourt = mongoose.model("VenueCourt");
    const vc = await VenueCourt.findOne({
      $or: [
        { "imouCams.deviceId": imouDeviceId },
        { "imou.deviceId": imouDeviceId },
      ],
    }).select("venue").lean();
    venueId = vc?.venue;
  }
  if (!venueId) {
    const e = new Error("Không xác định được venue chứa cam");
    e.status = 400; throw e;
  }
  // Session đã lưu (nếu có) + creds để worker tự login lại khi bị đá (Imou
  // chỉ cho 1 phiên/tài khoản — app mobile login là phiên server chết, 12002).
  const imouSession = await decryptVenueImouSession(venueId);
  const imouCreds = await decryptVenueImouCreds(venueId);
  if (!imouSession && !(imouCreds?.phone && imouCreds?.password)) {
    const e = new Error("Venue chưa có session lẫn tài khoản Imou. Chủ sân cần mở app mobile → Cài đặt cam Imou → Login lại.");
    e.status = 400; throw e;
  }

  // Chuẩn hoá destinations: FB/YT chưa có streamUrl → gọi Graph API tạo
  // live_video / broadcast, lấy secure_stream_url. RTMP giữ nguyên.
  const tournament = await Tournament.findById(tournamentId).select("name").lean();
  const title = tournament?.name || "PickleTour Live";
  const preparedDest = await prepareDestinations(destinations, title);

  const session = await TournamentAutoLiveSession.create({
    tournament: tournamentId, court: courtStationId, venue: venueId,
    imouDeviceId, startedBy, destinations: preparedDest, autoNext,
    status: "starting", workerId: crypto.randomUUID(),
    startedAt: new Date(),
  });

  try {
    const proc = spawnWorker(session, imouSession, imouCreds);
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

function spawnWorker(session, imouSession, imouCreds) {
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
    AUTOLIVE_IMOU_DEVICE_ID: session.imouDeviceId,
    AUTOLIVE_DESTINATIONS: JSON.stringify(session.destinations.map((d) => ({
      type: d.type, streamUrl: d.streamUrl, streamKey: d.streamKey || "",
    }))),
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
    const doc = await TournamentAutoLiveSession.findById(session._id);
    if (!doc) return;
    if (doc.status === "stopped") return; // user chủ động stop
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
  // Kết thúc live FB để page không treo "đang phát" với hình đứng.
  for (const d of session.destinations || []) {
    if (d.type !== "fb" || !d.broadcastId || !d.pageId) continue;
    try {
      const token = await getValidPageToken(d.pageId);
      await fbEndLiveVideo({ liveVideoId: d.broadcastId, pageAccessToken: token });
    } catch (e) {
      console.warn(`[auto-live] end FB live ${d.broadcastId} fail:`, e?.message || e);
    }
  }
  return session.toObject();
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

export async function recordHeartbeat(sessionId) {
  const doc = await TournamentAutoLiveSession.findByIdAndUpdate(
    sessionId,
    { workerLastHeartbeatAt: new Date(), $unset: {}, $set: { status: "live" } },
    { new: true }
  );
  return doc;
}

export function listActiveInMemory() {
  return Array.from(registry.entries()).map(([sid, entry]) => ({
    sessionId: sid, pid: entry.proc?.pid, hasCache: !!entry.overlayCache,
  }));
}
