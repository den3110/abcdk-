// REST API cho auto-live tournament.
import asyncHandler from "express-async-handler";
import TournamentAutoLiveSession from "../models/tournamentAutoLiveSessionModel.js";
import {
  startAutoLive, stopAutoLive, recordHeartbeat, getCachedOverlayPng,
} from "../services/autoLive/tournamentAutoLive.service.js";

function stripSecrets(doc) {
  if (!doc) return doc;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  o.destinations = (o.destinations || []).map((d) => ({
    type: d.type, label: d.label, pageId: d.pageId, pageName: d.pageName,
    broadcastId: d.broadcastId,
    hasKey: !!(d.streamKey || (d.streamUrl && d.streamUrl.includes("?"))),
  }));
  return o;
}

// POST /api/tournament-auto-live/start
export const startSession = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const doc = await startAutoLive({
    tournamentId: body.tournamentId,
    courtStationId: body.courtStationId,
    imouDeviceId: body.imouDeviceId,
    destinations: body.destinations,
    autoNext: body.autoNext !== false,
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
  const docs = await TournamentAutoLiveSession.find(q)
    .sort({ updatedAt: -1 })
    .populate("court", "_id name code")
    .populate("tournament", "_id name")
    .lean({ virtuals: false });
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

// POST /api/tournament-auto-live/internal/heartbeat
// Header: x-worker-token khớp AUTOLIVE_WORKER_TOKEN.
// Body: { sessionId }
export const internalHeartbeat = asyncHandler(async (req, res) => {
  const token = req.header("x-worker-token") || "";
  if (!process.env.AUTOLIVE_WORKER_TOKEN || token !== process.env.AUTOLIVE_WORKER_TOKEN) {
    res.status(403); throw new Error("bad worker token");
  }
  const doc = await recordHeartbeat(String(req.body?.sessionId || ""));
  res.json({ ok: !!doc });
});
