const STORAGE_PREFIX = "PT_REFEREE_LIVE_SYNC_WEB_V1";

function storageKey(matchId) {
  return `${STORAGE_PREFIX}:${String(matchId || "").trim()}`;
}

export function createEmptyLiveSyncState(matchId) {
  return {
    matchId: String(matchId || ""),
    snapshot: null,
    featureEnabled: true,
    mode: "offline_sync_v1",
    settingsUpdatedAt: null,
    lastAckedServerVersion: 0,
    queue: [],
    owner: null,
    lastRejectedBatch: [],
    updatedAt: null,
  };
}

export async function loadRefereeLiveSyncState(matchId) {
  if (!matchId || typeof window === "undefined") {
    return createEmptyLiveSyncState(matchId);
  }
  try {
    const raw = window.localStorage.getItem(storageKey(matchId));
    if (!raw) return createEmptyLiveSyncState(matchId);
    const parsed = JSON.parse(raw);
    const rejectedIds = new Set(
      (Array.isArray(parsed?.lastRejectedBatch) ? parsed.lastRejectedBatch : [])
        .map((item) => String(item?.clientEventId || "").trim())
        .filter(Boolean)
    );
    const queue = Array.isArray(parsed?.queue)
      ? parsed.queue.filter((event) => {
          const clientEventId = String(event?.clientEventId || "").trim();
          return !clientEventId || !rejectedIds.has(clientEventId);
        })
      : [];
    return {
      ...createEmptyLiveSyncState(matchId),
      ...parsed,
      matchId: String(matchId),
      queue,
      lastRejectedBatch: Array.isArray(parsed?.lastRejectedBatch)
        ? parsed.lastRejectedBatch
        : [],
    };
  } catch {
    return createEmptyLiveSyncState(matchId);
  }
}

export async function saveRefereeLiveSyncState(matchId, state) {
  if (!matchId || typeof window === "undefined") return;
  const nextState = {
    ...createEmptyLiveSyncState(matchId),
    ...(state || {}),
    matchId: String(matchId),
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(storageKey(matchId), JSON.stringify(nextState));
}

export async function clearRefereeLiveSyncState(matchId) {
  if (!matchId || typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(matchId));
}
