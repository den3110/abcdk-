// REST API cho auto-live tournament.
import asyncHandler from "express-async-handler";
import TournamentAutoLiveSession from "../models/tournamentAutoLiveSessionModel.js";
import Venue from "../models/venueModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import Tournament from "../models/tournamentModel.js";
import CourtStation from "../models/courtStationModel.js";
import CourtCluster from "../models/courtClusterModel.js";
import FbToken from "../models/fbTokenModel.js";
import {
  startAutoLive, stopAutoLive, recordHeartbeat, getCachedOverlayPng, backfillWatchUrls,
  saveImouSessionFromWorker, getImouSessionForWorker, getSystemStats,
  refreshDestinationsForWorker, getWorkerConfig, getCourtImouSessionForApp,
} from "../services/autoLive/tournamentAutoLive.service.js";

// GET /api/tournament-auto-live/court-imou-session?imouDeviceId=xxx (admin)
// App live iOS lấy session Imou đã giải mã của cam để tự kéo cam làm nguồn.
export const courtImouSession = asyncHandler(async (req, res) => {
  const r = await getCourtImouSessionForApp(req.query.imouDeviceId);
  if (r?.error) { res.status(r.code || 400); throw new Error(r.error); }
  res.json(r);
});

// GET /api/tournament-auto-live/:id/worker-config (admin) — app desktop lấy để tự chạy
export const workerConfig = asyncHandler(async (req, res) => {
  const cfg = await getWorkerConfig(req.params.id);
  if (!cfg) { res.status(404); throw new Error("Session không tồn tại"); }
  res.json(cfg);
});

// GET /api/tournament-auto-live/internal/destinations?sessionId= (worker token)
export const internalRefreshDestinations = asyncHandler(async (req, res) => {
  assertWorkerToken(req, res);
  const dests = await refreshDestinationsForWorker(String(req.query?.sessionId || ""));
  res.json({ destinations: dests || [] });
});

// GET /api/tournament-auto-live/internal/imou-session?sessionId=
export const internalGetImouSession = asyncHandler(async (req, res) => {
  assertWorkerToken(req, res);
  const sess = await getImouSessionForWorker(String(req.query?.sessionId || ""));
  if (!sess) { res.status(404).json({ session: null }); return; }
  res.json({ session: sess });
});

function assertWorkerToken(req, res) {
  const token = req.header("x-worker-token") || "";
  if (!process.env.AUTOLIVE_WORKER_TOKEN || token !== process.env.AUTOLIVE_WORKER_TOKEN) {
    res.status(403); throw new Error("bad worker token");
  }
}

// POST /api/tournament-auto-live/internal/imou-session  { sessionId, session }
export const internalImouSession = asyncHandler(async (req, res) => {
  assertWorkerToken(req, res);
  const ok = await saveImouSessionFromWorker(String(req.body?.sessionId || ""), req.body?.session);
  res.json({ ok });
});

function stripSecrets(doc) {
  if (!doc) return doc;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  o.destinations = (o.destinations || []).map((d) => ({
    type: d.type, label: d.label, pageId: d.pageId, pageName: d.pageName,
    broadcastId: d.broadcastId, watchUrl: d.watchUrl || "",
    hasKey: !!(d.streamKey || (d.streamUrl && d.streamUrl.includes("?"))),
  }));
  o.cpuPct = o.cpuPct || 0;
  o.memMB = o.memMB || 0;
  o.bitrateKbps = o.bitrateKbps || 0;
  o.fps = o.fps || 0;
  o.speed = o.speed || 0;
  o.runner = o.runner || "server";
  o.runnerLabel = o.runnerLabel || "";
  o.runnerOs = o.runnerOs || "";
  o.encoder = o.encoder || "";
  return o;
}

// GET /api/tournament-auto-live/stats — tài nguyên máy chủ + ước tính capacity
export const getStats = asyncHandler(async (req, res) => {
  res.json(await getSystemStats());
});

// POST /api/tournament-auto-live/start
export const startSession = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const doc = await startAutoLive({
    tournamentId: body.tournamentId,
    courtStationId: body.courtStationId,
    imouDeviceId: body.imouDeviceId,
    venueId: body.venueId,
    sourceUrl: body.sourceUrl,
    destinations: body.destinations,
    autoNext: body.autoNext !== false,
    layout: body.layout,
    advanced: body.advanced,
    runner: body.runner,
    startedBy: req.user?._id,
  });
  res.status(201).json(stripSecrets(doc));
});

// POST /api/tournament-auto-live/:id/stop
export const stopSession = asyncHandler(async (req, res) => {
  const doc = await stopAutoLive(req.params.id);
  res.json(stripSecrets(doc));
});

// GET /api/tournament-auto-live/sessions?tournamentId=...
export const listSessions = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.tournamentId) q.tournament = req.query.tournamentId;
  if (req.query.status) q.status = req.query.status;
  let docs = await TournamentAutoLiveSession.find(q)
    .sort({ updatedAt: -1 })
    .populate("court", "_id name code")
    .populate("tournament", "_id name")
    .lean({ virtuals: false });
  const needBackfill = docs
    .filter((d) => ["live", "starting", "reconnecting"].includes(d.status)
      && (d.destinations || []).some((x) => x.type === "fb" && x.broadcastId && !x.watchUrl))
    .map((d) => d._id);
  if (needBackfill.length) {
    await backfillWatchUrls(needBackfill);
    docs = await TournamentAutoLiveSession.find(q)
      .sort({ updatedAt: -1 })
      .populate("court", "_id name code")
      .populate("tournament", "_id name")
      .lean({ virtuals: false });
  }
  res.json(docs.map(stripSecrets));
});

// GET /api/tournament-auto-live/:id
export const getSession = asyncHandler(async (req, res) => {
  const doc = await TournamentAutoLiveSession.findById(req.params.id)
    .populate("court", "_id name code")
    .populate("tournament", "_id name")
    .lean();
  if (!doc) { res.status(404); throw new Error("Session không tồn tại"); }
  res.json(stripSecrets(doc));
});

// GET /api/tournament-auto-live/overlay/:id.png — Python worker fetch
// (không auth vì worker chạy nội bộ — bảo vệ bằng ID không đoán được +
// worker token trong header nếu cần). Buffer alpha PNG 1920x1080.
export const getOverlayImage = asyncHandler(async (req, res) => {
  const sessionId = String(req.params.id).replace(/\.png$/, "");
  const buf = await getCachedOverlayPng(sessionId);
  if (!buf) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  res.send(buf);
});

// GET /api/tournament-auto-live/tournaments?q=  — danh sách giải cho app desktop
export const listTournamentsForApp = asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const filter = q ? { name: { $regex: q, $options: "i" } } : {};
  const docs = await Tournament.find(filter)
    .select("_id name image startDate status isTest")
    .sort({ createdAt: -1 })
    .limit(q ? 50 : 100)
    .lean();
  res.json(docs.map((t) => ({
    _id: String(t._id), name: t.name, image: t.image || "",
    startDate: t.startDate, status: t.status, isTest: !!t.isTest,
  })));
});

// GET /api/tournament-auto-live/tournaments/:tid/courts — court stations của giải
export const listCourtsForApp = asyncHandler(async (req, res) => {
  const t = await Tournament.findById(req.params.tid).select("allowedCourtClusterIds name").lean();
  if (!t) { res.status(404); throw new Error("Tournament not found"); }
  const clusterIds = Array.isArray(t.allowedCourtClusterIds) ? t.allowedCourtClusterIds : [];
  const stations = await CourtStation.find({ clusterId: { $in: clusterIds } })
    .select("_id name code clusterId currentMatch order")
    .populate({ path: "clusterId", select: "name venueName" })
    .sort({ order: 1, name: 1 })
    .lean();
  res.json(stations.map((s) => ({
    _id: String(s._id), name: s.name, code: s.code || "",
    clusterName: s.clusterId?.venueName || s.clusterId?.name || "",
    hasMatch: !!s.currentMatch,
  })));
});

// GET /api/tournament-auto-live/fb-pages — pool fanpage (admin)
export const listFbPagesForApp = asyncHandler(async (req, res) => {
  const docs = await FbToken.find({ disabled: { $ne: true } })
    .select("pageId pageName isBusy needsReauth").sort({ pageName: 1 }).lean().catch(() => []);
  res.json((docs || []).filter((d) => d.pageId).map((d) => ({
    pageId: String(d.pageId), pageName: d.pageName || String(d.pageId),
    isBusy: !!d.isBusy, needsReauth: !!d.needsReauth,
  })));
});

// GET /api/tournament-auto-live/available-cams
// Trả toàn bộ cam Imou đã gắn vào các sân vật lý (VenueCourt) — flat, kèm
// venue/court label để admin chọn khi start auto-live cho court giải đấu
// (MVP: court giải chưa auto-link với venueCourt).
export const listAvailableCams = asyncHandler(async (req, res) => {
  const venues = await Venue.find({ "imouAccount.phone": { $exists: true, $ne: "" } })
    .select("_id name imouAccount")
    .lean();
  if (!venues.length) return res.json([]);
  const venueMap = new Map(venues.map((v) => [String(v._id), v]));
  const courts = await VenueCourt.find({
    venue: { $in: venues.map((v) => v._id) },
    $or: [
      { "imouCams.0": { $exists: true } },
      { "imou.deviceId": { $exists: true, $ne: "" } },
    ],
  })
    .select("_id name venue imou imouCams")
    .lean();
  const out = [];
  for (const c of courts) {
    const v = venueMap.get(String(c.venue));
    if (!v) continue;
    const cams = (c.imouCams && c.imouCams.length) ? c.imouCams
      : (c.imou?.deviceId ? [c.imou] : []);
    for (const cam of cams) {
      out.push({
        venueId: String(c.venue), venueName: v.name || "",
        courtId: String(c._id), courtName: c.name || "",
        deviceId: cam.deviceId, camName: cam.name || cam.deviceId,
      });
    }
  }
  res.json(out);
});

// POST /api/tournament-auto-live/internal/heartbeat
// Header: x-worker-token khớp AUTOLIVE_WORKER_TOKEN.
// Body: { sessionId }
export const internalHeartbeat = asyncHandler(async (req, res) => {
  const token = req.header("x-worker-token") || "";
  if (!process.env.AUTOLIVE_WORKER_TOKEN || token !== process.env.AUTOLIVE_WORKER_TOKEN) {
    res.status(403); throw new Error("bad worker token");
  }
  const b = req.body || {};
  const doc = await recordHeartbeat(String(b.sessionId || ""), {
    encoder: b.encoder, runnerLabel: b.runnerLabel, runnerOs: b.runnerOs,
    cpuPct: b.cpuPct, memMB: b.memMB,
    bitrateKbps: b.bitrateKbps, fps: b.fps, speed: b.speed,
  });
  // Trả stop=true để client (app desktop) tự dừng khi admin đã Dừng phiên.
  res.json({ ok: !!doc, stop: !!doc?._stopped });
});
