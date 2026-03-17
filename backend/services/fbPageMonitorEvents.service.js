let fbPageMonitorPublisher = null;

let fbPageMonitorMeta = {
  realtimeMode: "event-driven",
  lastEventAt: null,
  lastEventReason: "bootstrap",
  lastEventMode: "event",
  lastPublishAt: null,
  lastPublishMode: "event",
  lastReconcileAt: null,
};

function normalizePageIds(pageIds) {
  if (!Array.isArray(pageIds)) return [];
  return Array.from(
    new Set(
      pageIds
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
}

function normalizePayload(payload = {}) {
  return {
    reason: String(payload.reason || "unknown_event").trim() || "unknown_event",
    pageIds: normalizePageIds(payload.pageIds),
    mode: payload.mode === "reconcile" ? "reconcile" : "event",
    at:
      payload.at instanceof Date && Number.isFinite(payload.at.getTime())
        ? payload.at
        : new Date(),
  };
}

export function registerFbPageMonitorPublisher(publisher) {
  fbPageMonitorPublisher =
    typeof publisher === "function" ? publisher : null;
}

export function setFbPageMonitorMeta(payload = {}) {
  const normalized = normalizePayload(payload);
  fbPageMonitorMeta = {
    ...fbPageMonitorMeta,
    realtimeMode: "event-driven",
    lastPublishAt: normalized.at,
    lastPublishMode: normalized.mode,
  };
  if (normalized.mode === "reconcile") {
    fbPageMonitorMeta.lastReconcileAt = normalized.at;
  } else {
    fbPageMonitorMeta.lastEventAt = normalized.at;
    fbPageMonitorMeta.lastEventReason = normalized.reason;
    fbPageMonitorMeta.lastEventMode = normalized.mode;
  }
  return { ...fbPageMonitorMeta };
}

export function getFbPageMonitorMeta() {
  return { ...fbPageMonitorMeta };
}

export async function publishFbPageMonitorUpdate(payload = {}) {
  const normalized = normalizePayload(payload);
  setFbPageMonitorMeta(normalized);
  if (typeof fbPageMonitorPublisher !== "function") return false;
  try {
    await fbPageMonitorPublisher(normalized);
    return true;
  } catch (error) {
    console.warn(
      "[fb-page-monitor-events] publish failed:",
      error?.message || error
    );
    return false;
  }
}
