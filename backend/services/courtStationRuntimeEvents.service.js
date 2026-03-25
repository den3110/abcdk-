let courtClusterRuntimePublisher = null;
let courtStationRuntimePublisher = null;

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

export function registerCourtStationRuntimePublishers({
  publishCluster = null,
  publishStation = null,
} = {}) {
  courtClusterRuntimePublisher =
    typeof publishCluster === "function" ? publishCluster : null;
  courtStationRuntimePublisher =
    typeof publishStation === "function" ? publishStation : null;
}

export async function publishCourtClusterRuntimeUpdate(payload = {}) {
  const clusterId = normalizeId(payload.clusterId);
  if (!clusterId || typeof courtClusterRuntimePublisher !== "function") {
    return false;
  }
  try {
    await courtClusterRuntimePublisher({
      clusterId,
      stationIds: normalizeIds(payload.stationIds),
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
      "[court-station-runtime-events] cluster publish failed:",
      error?.message || error
    );
    return false;
  }
}

export async function publishCourtStationRuntimeUpdate(payload = {}) {
  const stationId = normalizeId(payload.stationId);
  if (!stationId || typeof courtStationRuntimePublisher !== "function") {
    return false;
  }
  try {
    await courtStationRuntimePublisher({
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
      "[court-station-runtime-events] station publish failed:",
      error?.message || error
    );
    return false;
  }
}
