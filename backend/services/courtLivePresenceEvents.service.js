let courtLivePresencePublisher = null;

function normalizeCourtIds(courtIds) {
  if (!Array.isArray(courtIds)) return [];
  return Array.from(
    new Set(
      courtIds
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
}

function normalizePayload(payload = {}) {
  return {
    tournamentId: String(payload.tournamentId || "").trim(),
    courtIds: normalizeCourtIds(payload.courtIds),
    reason: String(payload.reason || "unknown_event").trim() || "unknown_event",
    mode: payload.mode === "reconcile" ? "reconcile" : "event",
    at:
      payload.at instanceof Date && Number.isFinite(payload.at.getTime())
        ? payload.at
        : new Date(),
  };
}

export function registerCourtLivePresencePublisher(publisher) {
  courtLivePresencePublisher =
    typeof publisher === "function" ? publisher : null;
}

export async function publishCourtLivePresenceUpdate(payload = {}) {
  const normalized = normalizePayload(payload);
  if (!normalized.tournamentId || typeof courtLivePresencePublisher !== "function") {
    return false;
  }
  try {
    await courtLivePresencePublisher(normalized);
    return true;
  } catch (error) {
    console.warn(
      "[court-live-presence-events] publish failed:",
      error?.message || error
    );
    return false;
  }
}
