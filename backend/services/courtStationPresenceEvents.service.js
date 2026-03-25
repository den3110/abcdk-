let courtClusterPresencePublisher = null;
let courtStationPresencePublisher = null;

function normalizeId(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeIds(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => normalizeId(value)).filter(Boolean))
  );
}

export function registerCourtStationPresencePublishers({
  publishCluster = null,
  publishStation = null,
} = {}) {
  courtClusterPresencePublisher =
    typeof publishCluster === "function" ? publishCluster : null;
  courtStationPresencePublisher =
    typeof publishStation === "function" ? publishStation : null;
}

export async function publishCourtClusterPresenceUpdate(payload = {}) {
  if (typeof courtClusterPresencePublisher !== "function") return false;
  const clusterId = normalizeId(payload.clusterId);
  if (!clusterId) return false;
  try {
    await courtClusterPresencePublisher({
      clusterId,
      reason: normalizeId(payload.reason) || "unknown_event",
      stationIds: normalizeIds(payload.stationIds),
      mode: payload.mode === "reconcile" ? "reconcile" : "event",
      at:
        payload.at instanceof Date && Number.isFinite(payload.at.getTime())
          ? payload.at
          : new Date(),
    });
    return true;
  } catch (error) {
    console.warn(
      "[court-station-presence-events] cluster publish failed:",
      error?.message || error
    );
    return false;
  }
}

export async function publishCourtStationPresenceUpdate(payload = {}) {
  if (typeof courtStationPresencePublisher !== "function") return false;
  const stationId = normalizeId(payload.stationId);
  if (!stationId) return false;
  try {
    await courtStationPresencePublisher({
      stationId,
      clusterId: normalizeId(payload.clusterId),
      reason: normalizeId(payload.reason) || "unknown_event",
      mode: payload.mode === "reconcile" ? "reconcile" : "event",
      at:
        payload.at instanceof Date && Number.isFinite(payload.at.getTime())
          ? payload.at
          : new Date(),
    });
    return true;
  } catch (error) {
    console.warn(
      "[court-station-presence-events] station publish failed:",
      error?.message || error
    );
    return false;
  }
}
