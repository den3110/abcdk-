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
import { getValidPageToken } from "../fbTokenService.js";
import { fbCreateLiveOnPage, fbGetLiveVideo, fbEndLiveVideo } from "../facebookLive.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.resolve(__dirname, "../../scripts/autoLive/worker.py");
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
export async function getCachedOverlayPng(sessionId) {
  const doc = await TournamentAutoLiveSession.findById(sessionId)
    .select("_id court status overlayVersion layout")
    .lean();
  if (!doc) return null;
  if (doc.status === "stopped") return null;
  const token = `${doc.overlayVersion || 0}:${Math.floor(Date.now() / SPONSOR_BUCKET_MS)}`;
  const cached = overlayCache.get(String(sessionId));
  if (cached && cached.token === token) return cached.buf;
  const data = await loadOverlayData(doc.court);
  if (data) data.layout = doc.layout || {};
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
  // Token đổi ~mỗi 800ms để overlay bắt kịp điểm số mới (referee patch) mà vẫn
  // tránh render mọi request (~2fps worker fetch).
  const token = Math.floor(Date.now() / 800);
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
    sourceUrl,
  } = input || {};
  const src = (sourceUrl || "").trim();
  if (!tournamentId || !courtStationId || !Array.isArray(destinations) || !destinations.length) {
    const err = new Error("Thiếu tournamentId/courtStationId/destinations");
    err.status = 400; throw err;
  }
  if (!src && !imouDeviceId) {
    const err = new Error("Cần chọn camera Imou hoặc nhập Custom link");
    err.status = 400; throw err;
  }
  const station = await CourtStation.findById(courtStationId).select("_id clusterId").lean();
  if (!station) { const e = new Error("Court không tồn tại"); e.status = 404; throw e; }

  // Nguồn Imou cần venue + session; nguồn URL thì bỏ qua toàn bộ Imou.
  let venueId, imouSession = null, imouCreds = null;
  if (!src) {
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
  const title = tournament?.name || "PickleTour Live";
  const preparedDest = await prepareDestinations(destinations, title);

  const runner = input.runner === "client" ? "client" : "server";

  // Court exclusivity: 1 sân chỉ 1 phiên active. Dọn phiên cũ còn "sống" trên
  // cùng sân (thường là phiên treo/mồ côi lần chạy trước chưa stop) → set "stopped".
  // Nếu không, phiên mới lên "live" sẽ đụng unique index {court,status} → E11000
  // ở heartbeat (client-runner chỉ lên "live" qua heartbeat).
  try {
    await TournamentAutoLiveSession.updateMany(
      { court: courtStationId, status: { $in: ["starting", "live", "reconnecting", "paused"] } },
      { $set: {
          status: "stopped", stoppedAt: new Date(),
          lastError: "Bị thay bởi phiên mới trên cùng sân", lastErrorAt: new Date(),
        } }
    );
  } catch (e) {
    console.warn("[autolive] dedupe court sessions error:", e?.message || e);
  }

  const session = await TournamentAutoLiveSession.create({
    tournament: tournamentId, court: courtStationId, venue: venueId,
    imouDeviceId: imouDeviceId || "", sourceUrl: src,
    startedBy, destinations: preparedDest, autoNext,
    layout: layout && typeof layout === "object" ? layout : undefined,
    advanced: advanced && typeof advanced === "object" ? advanced : undefined,
    runner,
    status: "starting", workerId: crypto.randomUUID(),
    startedAt: new Date(),
  });

  // Client-runner: KHÔNG spawn trên server. App desktop lấy worker-config rồi
  // tự chạy (GPU). Backend vẫn poll để bump overlay + theo dõi heartbeat.
  if (runner === "client") {
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
  return env;
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
    AUTOLIVE_IMOU_DEVICE_ID: session.imouDeviceId || "",
    AUTOLIVE_SOURCE_URL: session.sourceUrl || "",
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
  clearProcSample(String(sessionId));
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
  const session = await TournamentAutoLiveSession.findById(sessionId);
  if (!session) return null;
  const tournament = await Tournament.findById(session.tournament).select("name").lean();
  const title = tournament?.name || "PickleTour Live";
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
  session.destinations = fresh;
  await session.save();
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
  const doc = await TournamentAutoLiveSession.findById(sessionId).select("status runner court");
  if (!doc) return null;
  // Client tự stop khi admin đã dừng phiên.
  if (doc.status === "stopped") return { _stopped: true };
  try {
    await TournamentAutoLiveSession.updateOne({ _id: sessionId }, { $set: set });
  } catch (e) {
    // E11000 {court,status:"live"}: có phiên "ma" khác đang giữ slot live trên cùng
    // sân (lần chạy trước chưa stop). Phiên đang gửi heartbeat MỚI là phiên thật →
    // dọn các phiên khác trên sân rồi thử lại. KHÔNG 500 (tránh spam Telegram + để
    // worker vẫn nhận được phản hồi stop).
    if (e?.code === 11000 && doc.court) {
      try {
        await TournamentAutoLiveSession.updateMany(
          {
            _id: { $ne: sessionId },
            court: doc.court,
            status: { $in: ["starting", "live", "reconnecting", "paused"] },
          },
          { $set: {
              status: "stopped", stoppedAt: new Date(),
              lastError: "Bị thay bởi phiên đang chạy trên cùng sân (dedupe heartbeat)",
              lastErrorAt: new Date(),
            } }
        );
        await TournamentAutoLiveSession.updateOne({ _id: sessionId }, { $set: set });
      } catch (e2) {
        console.warn("[autolive] heartbeat dedupe retry failed:", e2?.message || e2);
      }
    } else {
      console.warn("[autolive] heartbeat update failed:", e?.message || e);
    }
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
  return {
    sessionId: String(s._id),
    imouDeviceId: s.imouDeviceId || "",
    sourceUrl: s.sourceUrl || "",
    imouSession: imouSession || null,
    imouCreds: imouCreds ? {
      phone: imouCreds.phone, password: imouCreds.password, areaCode: imouCreds.areaCode || "84",
    } : null,
    destinations: (s.destinations || []).map((d) => ({
      type: d.type, streamUrl: d.streamUrl, streamKey: d.streamKey || "",
    })),
    workerToken: process.env.AUTOLIVE_WORKER_TOKEN || "",
    advancedEnv: advancedEnv(s.advanced), // {AUTOLIVE_VIDEO_BITRATE,...} app set vào env worker
    overlayUrl: `${base}/api/tournament-auto-live/overlay/${s._id}.png`,
    heartbeatUrl: `${base}/api/tournament-auto-live/internal/heartbeat`,
    sessionPostUrl: `${base}/api/tournament-auto-live/internal/imou-session`,
    destinationsUrl: `${base}/api/tournament-auto-live/internal/destinations`,
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
