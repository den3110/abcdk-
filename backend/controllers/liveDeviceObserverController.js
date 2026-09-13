import asyncHandler from "express-async-handler";
import LiveDeviceState from "../models/liveDeviceStateModel.js";
import ObserverEvent from "../models/observerEventModel.js";
import {
  buildExpireAt,
  getObserverSourceName,
} from "../services/observerConfig.service.js";

// Port từ observer-vps/internal/observer/live_device.go: nhận telemetry máy live
// (heartbeat + event) từ app iOS/Android, lưu trạng thái hiện tại + log sự cố, và
// suy ra online/offline/nghi crash cho dashboard.

const LIVE_DEVICE_TTL_DAYS = 3;
const EVENT_TTL_DAYS = 7;
const DEFAULT_STALE_MS = 30_000;

// ---------- helpers ----------
const asStr = (v) => (v == null ? "" : String(v).trim());
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});

function firstStr(...vals) {
  for (const v of vals) {
    const s = asStr(v);
    if (s) return s;
  }
  return "";
}

function firstNonNil(...vals) {
  for (const v of vals) if (v != null) return v;
  return null;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clampInt(v, min, max) {
  const n = toInt(v, min);
  return Math.min(max, Math.max(min, n));
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toStringList(v) {
  if (Array.isArray(v)) {
    return v.map((x) => asStr(x)).filter(Boolean);
  }
  const s = asStr(v);
  return s ? [s] : [];
}

function normalizeLevel(v, fallback = "warn") {
  const s = asStr(v).toLowerCase();
  return ["debug", "info", "warn", "error"].includes(s) ? s : fallback;
}

function buildSource(req, explicit) {
  return (
    asStr(explicit) ||
    asStr(req.headers?.["x-pkt-observer-source"]) ||
    "live-app" ||
    getObserverSourceName()
  );
}

function principalOf(req) {
  const u = req?.user;
  if (!u) return null;
  return {
    userId: asStr(u._id),
    role: asStr(u.role) || (u.isAdmin ? "admin" : ""),
    displayName: firstStr(u.nickname, u.nickName, u.fullName, u.name),
  };
}

function mergeOperator(status, principal) {
  const operator = obj(status.operator);
  if (!principal) return operator;
  if (!firstStr(operator.userId) && principal.userId) operator.userId = principal.userId;
  if (!firstStr(operator.role) && principal.role) operator.role = principal.role;
  if (!firstStr(operator.displayName, operator.name) && principal.displayName)
    operator.displayName = principal.displayName;
  return operator;
}

// ---------- INGEST: heartbeat ----------
export const ingestLiveDeviceHeartbeat = asyncHandler(async (req, res) => {
  const body = obj(req.body);
  const now = new Date();
  const source = buildSource(req, body.source);
  let status = obj(body.status);
  if (!Object.keys(status).length) status = body;

  const deviceId = firstStr(
    body.deviceId,
    status.deviceId,
    status.clientSessionId,
    status.clientSessionIdRaw
  );
  if (!deviceId) {
    return res
      .status(400)
      .json({ ok: false, message: "deviceId or clientSessionId is required" });
  }

  const heartbeatIntervalMs = clampInt(
    firstStr(body.heartbeatIntervalMs, status.heartbeatIntervalMs) || 10000,
    3_000,
    120_000
  );
  const staleAfterMs = clampInt(
    firstStr(body.staleAfterMs, status.staleAfterMs) ||
      Math.max(DEFAULT_STALE_MS, heartbeatIntervalMs * 3),
    heartbeatIntervalMs,
    10 * 60 * 1000
  );

  const principal = principalOf(req);
  const operator = mergeOperator(status, principal);
  const warnings = toStringList(firstNonNil(status.warnings, body.warnings));
  const diagnostics = toStringList(firstNonNil(status.diagnostics, body.diagnostics));
  const recovery = obj(status.recovery);
  const overlay = obj(status.overlay);
  const stream = obj(status.stream);
  const recording = obj(status.recording);
  const thermal = obj(status.thermal);
  const battery = obj(status.battery);
  const network = obj(status.network);
  const presence = obj(status.presence);
  const route = obj(status.route);
  const court = obj(status.court);
  const match = obj(status.match);
  const app = obj(status.app);
  const device = obj(status.device);

  await LiveDeviceState.updateOne(
    { source, deviceId },
    {
      $set: {
        source,
        deviceId,
        platform: firstStr(status.platform, device.platform) || "ios",
        deviceName: firstStr(device.name, status.deviceName),
        deviceModel: firstStr(device.model, status.deviceModel),
        deviceManufacturer: firstStr(device.manufacturer, status.deviceManufacturer),
        deviceBrand: firstStr(device.brand, status.deviceBrand),
        deviceProduct: firstStr(device.product, status.deviceProduct),
        operatorUserId: firstStr(operator.userId),
        operatorName: firstStr(operator.displayName, operator.name),
        operatorRole: firstStr(operator.role),
        routeLabel: firstStr(route.label, status.routeLabel),
        screenState: firstStr(status.screenState, presence.screenState),
        courtId: firstStr(court.id, status.courtId),
        courtName: firstStr(court.name, status.courtName),
        matchId: firstStr(match.id, status.matchId),
        matchCode: firstStr(match.code, status.matchCode),
        streamState: firstStr(stream.state, status.streamState),
        overlayIssue: firstStr(overlay.issue, overlay.lastIssue, status.overlayIssue),
        recoverySeverity: firstStr(recovery.severity),
        recoveryStage: firstStr(recovery.stage),
        warningCount: warnings.length,
        heartbeatIntervalMs,
        staleAfterMs,
        capturedAt: toDate(firstNonNil(body.capturedAt, status.capturedAt)),
        lastSeenAt: now,
        receivedAt: now,
        expireAt: buildExpireAt(LIVE_DEVICE_TTL_DAYS, now),
        app,
        device,
        operator,
        route,
        court,
        match,
        stream,
        recording,
        overlay,
        presence,
        network,
        battery,
        thermal,
        recovery,
        warnings,
        diagnostics,
        payload: status,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return res.json({ ok: true, source, deviceId });
});

// ---------- INGEST: event(s) ----------
function buildEventEnvelope(req, raw, sourceFallback) {
  const source = buildSource(req, firstStr(raw.source, sourceFallback));
  let event = obj(raw.event);
  if (!Object.keys(event).length) event = raw;
  const status = obj(raw.status);
  const principal = principalOf(req);
  const occurredAt =
    toDate(firstNonNil(event.occurredAt, event.capturedAt, raw.capturedAt)) || new Date();
  const deviceId = firstStr(
    event.deviceId,
    raw.deviceId,
    status.deviceId,
    status.clientSessionId
  );
  const level = normalizeLevel(event.level);
  const reasonCode = firstStr(event.reasonCode);
  const reasonText = firstStr(event.reasonText, event.message, event.summary);
  const eventType = firstStr(event.type, reasonCode) || "heartbeat_event";
  const now = new Date();

  const payload = { ...obj(event.payload) };
  if (deviceId) payload.deviceId = deviceId;
  if (Object.keys(status).length) payload.status = status;
  if (principal?.userId) payload.authUserId = principal.userId;
  if (principal?.role) payload.authRole = principal.role;

  const doc = {
    source,
    category: "live_device",
    type: eventType,
    level,
    tags: [reasonCode, firstStr(event.stage), firstStr(event.severity)].filter(Boolean),
    occurredAt,
    receivedAt: now,
    expireAt: buildExpireAt(EVENT_TTL_DAYS, occurredAt),
    payload: {
      ...payload,
      deviceId,
      reasonCode,
      reasonText,
      stage: firstStr(event.stage),
      severity: firstStr(event.severity),
      matchId: firstStr(event.matchId, status.matchId),
      matchCode: firstStr(event.matchCode, status.matchCode),
      courtId: firstStr(event.courtId, status.courtId),
      courtName: firstStr(event.courtName, status.courtName),
      operatorName: firstStr(event.operatorName, status.operatorName),
    },
  };

  return { source, deviceId, occurredAt, level, eventType, reasonCode, reasonText, status, doc };
}

async function updateStateFromEvent(env) {
  const now = new Date();
  const set = {
    source: env.source,
    deviceId: env.deviceId,
    capturedAt: env.occurredAt,
    lastSeenAt: now,
    receivedAt: now,
    expireAt: buildExpireAt(LIVE_DEVICE_TTL_DAYS, now),
    lastEventType: env.eventType,
    lastEventLevel: env.level,
    lastEventReasonCode: env.reasonCode,
    lastEventReasonText: env.reasonText,
    lastEventAt: env.occurredAt,
  };

  if (Object.keys(env.status).length) {
    const status = env.status;
    const route = obj(status.route);
    const stream = obj(status.stream);
    const overlay = obj(status.overlay);
    const match = obj(status.match);
    const court = obj(status.court);
    const operator = obj(status.operator);
    set.routeLabel = firstStr(route.label, status.routeLabel);
    set.screenState = firstStr(status.screenState);
    set.streamState = firstStr(stream.state, status.streamState);
    set.overlayIssue = firstStr(overlay.issue, overlay.lastIssue, status.overlayIssue);
    set.recoverySeverity = firstStr(obj(status.recovery).severity);
    set.recoveryStage = firstStr(obj(status.recovery).stage);
    set.matchId = firstStr(match.id, status.matchId);
    set.matchCode = firstStr(match.code, status.matchCode);
    set.courtId = firstStr(court.id, status.courtId);
    set.courtName = firstStr(court.name, status.courtName);
    set.operatorUserId = firstStr(operator.userId, status.operatorUserId);
    set.operatorName = firstStr(operator.displayName, status.operatorName);
    set.app = obj(status.app);
    set.stream = stream;
    set.recording = obj(status.recording);
    set.overlay = overlay;
    set.thermal = obj(status.thermal);
    set.battery = obj(status.battery);
    set.network = obj(status.network);
    set.route = route;
    set.match = match;
    set.court = court;
    set.operator = operator;
  }

  const rc = env.reasonCode.toLowerCase();
  const et = env.eventType.toLowerCase();
  if (rc === "app_crash_recovered" || et === "app_crash_recovered") {
    set.lastCrashRecoveredAt = env.occurredAt;
    set.lastCrashRecoveredReason = env.reasonText;
  }
  if (et.startsWith("app_")) {
    set.lastLifecycleEventType = env.eventType;
    set.lastLifecycleEventAt = env.occurredAt;
    set.lastLifecycleEventReason = env.reasonText;
  }

  await LiveDeviceState.updateOne(
    { source: env.source, deviceId: env.deviceId },
    { $set: set, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
}

async function persistEnvelopes(envelopes) {
  if (!envelopes.length) return;
  await ObserverEvent.insertMany(
    envelopes.map((e) => e.doc),
    { ordered: false }
  ).catch((err) => {
    console.warn("[observer live-device] insert events failed:", err?.message || err);
  });
  for (const env of envelopes) {
    if (!env.deviceId) continue;
    await updateStateFromEvent(env).catch((err) =>
      console.warn("[observer live-device] update state failed:", err?.message || err)
    );
  }
}

export const ingestLiveDeviceEvent = asyncHandler(async (req, res) => {
  const body = obj(req.body);
  const env = buildEventEnvelope(req, body, asStr(body.source));
  await persistEnvelopes([env]);
  return res.json({ ok: true, source: env.source, deviceId: env.deviceId, accepted: 1 });
});

export const ingestLiveDeviceEvents = asyncHandler(async (req, res) => {
  const body = obj(req.body);
  const sourceFallback = asStr(body.source);
  let incoming = Array.isArray(body.events) ? body.events : [];
  if (!incoming.length && isObj(body.event)) incoming = [body.event];

  const envelopes = incoming
    .slice(0, 200)
    .filter(isObj)
    .map((raw) => buildEventEnvelope(req, raw, sourceFallback));
  await persistEnvelopes(envelopes);

  return res.json({
    ok: true,
    source: envelopes[0]?.source || sourceFallback || null,
    deviceId: envelopes[0]?.deviceId || null,
    accepted: envelopes.length,
  });
});

// ---------- READ: list for dashboard ----------
function detectUnexpectedDisconnect(row, now, lastSeenAt, staleAfterMs, isOnline) {
  const offlineForMs = now.getTime() - (lastSeenAt ? lastSeenAt.getTime() : 0);
  if (isOnline) return { suspectedCrash: false, reason: "", offlineForMs };
  if (offlineForMs < Math.max(staleAfterMs * 2, 20_000))
    return { suspectedCrash: false, reason: "", offlineForMs };

  const streamState = firstStr(row.streamState, obj(row.stream).state).toLowerCase();
  const recordingState = firstStr(obj(row.recording).stateText).toLowerCase();
  const route = obj(row.route);
  const overlay = obj(row.overlay);
  const matchId = firstStr(row.matchId, obj(row.match).id);
  const appActive = route.appIsActive === true;
  const liveLike = ["live", "connecting", "reconnecting"].includes(streamState);
  const recordingBusy = recordingState.includes("ghi") || recordingState.includes("record");
  if (!liveLike && !recordingBusy && !(appActive && matchId))
    return { suspectedCrash: false, reason: "", offlineForMs };

  let reason = "heartbeat_timeout_while_live";
  if (firstStr(row.overlayIssue, overlay.issue))
    reason = "heartbeat_timeout_after_overlay_issue";
  return { suspectedCrash: true, reason, offlineForMs };
}

function computeRow(row, now) {
  const lastSeenAt = toDate(firstNonNil(row.lastSeenAt, row.capturedAt)) || new Date(0);
  const staleAfterMs = clampInt(row.staleAfterMs, 5_000, 10 * 60 * 1000);
  const isOnline = now.getTime() - lastSeenAt.getTime() <= staleAfterMs;
  const crash = detectUnexpectedDisconnect(row, now, lastSeenAt, staleAfterMs, isOnline);
  return { lastSeenAt, staleAfterMs, isOnline, crash };
}

export const listLiveDevices = asyncHandler(async (req, res) => {
  const source = asStr(req.query.source);
  const platform = asStr(req.query.platform);
  const onlineOnly = ["true", "1"].includes(asStr(req.query.onlineOnly).toLowerCase());
  const limit = clampInt(req.query.limit || 50, 1, 200);

  const filter = {};
  if (source) filter.source = source;
  if (platform) filter.platform = platform;

  const rows = await LiveDeviceState.find(filter)
    .sort({ lastSeenAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  const now = new Date();
  const items = [];
  const counts = {
    total: 0,
    online: 0,
    live: 0,
    overlayIssues: 0,
    criticalRecoveries: 0,
    suspectedCrashes: 0,
  };

  for (const row of rows) {
    const { lastSeenAt, staleAfterMs, isOnline, crash } = computeRow(row, now);
    if (onlineOnly && !isOnline) continue;
    counts.total += 1;
    if (isOnline) counts.online += 1;
    const streamState = firstStr(row.streamState).toLowerCase();
    if (["live", "connecting", "reconnecting"].includes(streamState)) counts.live += 1;
    if (firstStr(row.overlayIssue)) counts.overlayIssues += 1;
    if (firstStr(row.recoverySeverity).toLowerCase() === "critical")
      counts.criticalRecoveries += 1;
    if (crash.suspectedCrash) counts.suspectedCrashes += 1;

    items.push({
      id: asStr(row._id),
      source: asStr(row.source),
      deviceId: asStr(row.deviceId),
      platform: asStr(row.platform),
      deviceName: asStr(row.deviceName),
      deviceModel: asStr(row.deviceModel),
      deviceManufacturer: asStr(row.deviceManufacturer),
      deviceBrand: asStr(row.deviceBrand),
      deviceProduct: asStr(row.deviceProduct),
      operatorUserId: asStr(row.operatorUserId),
      operatorName: asStr(row.operatorName),
      operatorRole: asStr(row.operatorRole),
      routeLabel: asStr(row.routeLabel),
      screenState: asStr(row.screenState),
      courtId: asStr(row.courtId),
      courtName: asStr(row.courtName),
      matchId: asStr(row.matchId),
      matchCode: asStr(row.matchCode),
      streamState: asStr(row.streamState),
      overlayIssue: asStr(row.overlayIssue),
      recoverySeverity: asStr(row.recoverySeverity),
      recoveryStage: asStr(row.recoveryStage),
      warningCount: clampInt(row.warningCount, 0, 999),
      heartbeatIntervalMs: clampInt(row.heartbeatIntervalMs, 0, 120_000),
      staleAfterMs,
      capturedAt: row.capturedAt,
      lastSeenAt,
      isOnline,
      offlineForMs: crash.offlineForMs,
      suspectedCrash: crash.suspectedCrash,
      suspectedCrashReason: crash.reason,
      lastEventType: asStr(row.lastEventType),
      lastEventLevel: asStr(row.lastEventLevel),
      lastEventReasonCode: asStr(row.lastEventReasonCode),
      lastEventReasonText: asStr(row.lastEventReasonText),
      lastEventAt: row.lastEventAt,
      lastCrashRecoveredAt: row.lastCrashRecoveredAt,
      lastCrashRecoveredReason: asStr(row.lastCrashRecoveredReason),
      app: obj(row.app),
      device: obj(row.device),
      operator: obj(row.operator),
      route: obj(row.route),
      court: obj(row.court),
      match: obj(row.match),
      stream: obj(row.stream),
      recording: obj(row.recording),
      overlay: obj(row.overlay),
      presence: obj(row.presence),
      network: obj(row.network),
      battery: obj(row.battery),
      thermal: obj(row.thermal),
      recovery: obj(row.recovery),
      warnings: toStringList(row.warnings),
      diagnostics: toStringList(row.diagnostics),
    });
  }

  return res.json({ ok: true, counts, items });
});

// GET /read/live-devices/events?deviceId=&limit=
export const listLiveDeviceEvents = asyncHandler(async (req, res) => {
  const deviceId = asStr(req.query.deviceId);
  const limit = clampInt(req.query.limit || 50, 1, 200);
  const filter = { category: "live_device" };
  if (deviceId) filter["payload.deviceId"] = deviceId;

  const rows = await ObserverEvent.find(filter)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  return res.json({
    ok: true,
    items: rows.map((r) => ({
      id: asStr(r._id),
      type: asStr(r.type),
      level: asStr(r.level),
      occurredAt: r.occurredAt,
      deviceId: asStr(obj(r.payload).deviceId),
      reasonCode: asStr(obj(r.payload).reasonCode),
      reasonText: asStr(obj(r.payload).reasonText),
      matchCode: asStr(obj(r.payload).matchCode),
      courtName: asStr(obj(r.payload).courtName),
      operatorName: asStr(obj(r.payload).operatorName),
      stage: asStr(obj(r.payload).stage),
      severity: asStr(obj(r.payload).severity),
    })),
  });
});
