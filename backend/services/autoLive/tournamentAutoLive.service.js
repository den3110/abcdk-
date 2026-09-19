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
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import mongoose from "mongoose";

import Venue from "../../models/venueModel.js";
import CourtStation from "../../models/courtStationModel.js";
import Match from "../../models/matchModel.js";
import TournamentAutoLiveSession from "../../models/tournamentAutoLiveSessionModel.js";
import { decryptToken } from "../secret.service.js";
import { loadOverlayData, renderOverlayPng } from "./overlayRenderer.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.resolve(__dirname, "../../scripts/autoLive/worker.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

// Map sessionId → { proc, pollTimer, overlayCache: { buf, version } }
const registry = new Map();

/** Trả về overlay data cached, nếu chưa có render lần đầu. */
export async function getCachedOverlayPng(sessionId) {
  const entry = registry.get(String(sessionId));
  if (!entry) return null;
  if (!entry.overlayCache?.buf) {
    const doc = await TournamentAutoLiveSession.findById(sessionId).lean();
    if (!doc) return null;
    const data = await loadOverlayData(doc.court);
    const buf = renderOverlayPng(data);
    entry.overlayCache = { buf, version: doc.overlayVersion || 0 };
  }
  return entry.overlayCache.buf;
}

async function bumpOverlayForSession(sessionId) {
  const doc = await TournamentAutoLiveSession.findByIdAndUpdate(
    sessionId,
    { $inc: { overlayVersion: 1 } },
    { new: true }
  );
  if (!doc) return null;
  const data = await loadOverlayData(doc.court);
  const buf = renderOverlayPng(data);
  const entry = registry.get(String(sessionId));
  if (entry) entry.overlayCache = { buf, version: doc.overlayVersion };
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

async function decryptVenueImouCreds(venueId) {
  const venue = await Venue.findById(venueId).select("imouCreds").lean();
  const cipher = venue?.imouCreds?.cipher;
  if (!cipher) return null;
  const plain = decryptToken(cipher);
  if (!plain) return null;
  try { return JSON.parse(plain); } catch { return null; }
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
  const creds = await decryptVenueImouCreds(venueId);
  if (!creds?.phone || !creds?.password) {
    const e = new Error("Venue chưa lưu credentials Imou (chủ sân cần login lại)"); e.status = 400; throw e;
  }

  const session = await TournamentAutoLiveSession.create({
    tournament: tournamentId, court: courtStationId, venue: venueId,
    imouDeviceId, startedBy, destinations, autoNext,
    status: "starting", workerId: crypto.randomUUID(),
    startedAt: new Date(),
  });

  try {
    const proc = spawnWorker(session, creds);
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

function spawnWorker(session, creds) {
  const backendBase = process.env.PUBLIC_BACKEND_URL || "http://localhost:5001";
  const overlayUrl = `${backendBase}/api/tournament-auto-live/overlay/${session._id}.png`;
  const heartbeatUrl = `${backendBase}/api/tournament-auto-live/internal/heartbeat`;
  const args = [WORKER_SCRIPT];
  const env = {
    ...process.env,
    AUTOLIVE_SESSION_ID: String(session._id),
    AUTOLIVE_WORKER_TOKEN: process.env.AUTOLIVE_WORKER_TOKEN || "changeme",
    AUTOLIVE_OVERLAY_URL: overlayUrl,
    AUTOLIVE_HEARTBEAT_URL: heartbeatUrl,
    AUTOLIVE_IMOU_PHONE: creds.phone,
    AUTOLIVE_IMOU_PASSWORD: creds.password,
    AUTOLIVE_IMOU_AREA_CODE: creds.areaCode || "84",
    AUTOLIVE_IMOU_DEVICE_ID: session.imouDeviceId,
    AUTOLIVE_DESTINATIONS: JSON.stringify(session.destinations.map((d) => ({
      type: d.type, streamUrl: d.streamUrl, streamKey: d.streamKey || "",
    }))),
  };
  const proc = spawn(PYTHON_BIN, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", (b) => process.stdout.write(`[autolive:${session._id}] ${b}`));
  proc.stderr.on("data", (b) => process.stderr.write(`[autolive:${session._id} ERR] ${b}`));
  proc.on("exit", async (code, signal) => {
    console.log(`[auto-live] worker exit sid=${session._id} code=${code} signal=${signal}`);
    const doc = await TournamentAutoLiveSession.findById(session._id);
    if (!doc) return;
    if (doc.status === "stopped") return; // user chủ động stop
    doc.status = code === 0 ? "stopped" : "error";
    doc.lastError = `worker exited code=${code} signal=${signal || ""}`.trim();
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
  const entry = registry.get(String(sessionId));
  if (entry?.proc) {
    try { entry.proc.kill("SIGTERM"); } catch {}
    setTimeout(() => { try { entry.proc?.kill("SIGKILL"); } catch {} }, 5000);
  }
  stopPoll(sessionId);
  registry.delete(String(sessionId));
  return session.toObject();
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
