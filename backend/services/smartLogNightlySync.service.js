import { getObserverSinkConfig } from "./observerConfig.service.js";
import { fetchObserverJson } from "./observerReadProxy.service.js";
import { insertPrimaryLogEventsFromObserver } from "./primaryLogSink.service.js";

let syncTimer = null;
let syncInFlight = false;
let syncState = {
  lastRunAt: null,
  lastResult: null,
  lastError: null,
};

function isNightlyWindow(now, startHour, endHour) {
  const hour = now.getHours();
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function buildSince(cfg) {
  const lookbackMs =
    Math.max(1, Number(cfg.nightlySyncLookbackHours || 24)) * 60 * 60 * 1000;
  return new Date(Date.now() - lookbackMs).toISOString();
}

export function getSmartLogNightlySyncState() {
  return {
    ...syncState,
    inFlight: syncInFlight,
  };
}

export async function syncObserverLogsToPrimary(options = {}) {
  const cfg = getObserverSinkConfig();
  const force = options.force === true;

  if (!cfg.nightlySyncEnabled && !force) {
    return { ok: false, skipped: true, reason: "nightly_sync_disabled" };
  }
  if (!cfg.primaryLogEnabled && !force) {
    return { ok: false, skipped: true, reason: "primary_log_disabled" };
  }
  if (syncInFlight) {
    return { ok: false, skipped: true, reason: "sync_in_flight" };
  }

  const now = new Date();
  if (
    !force &&
    !isNightlyWindow(
      now,
      Number(cfg.nightlySyncStartHour || 1),
      Number(cfg.nightlySyncEndHour || 5)
    )
  ) {
    return { ok: false, skipped: true, reason: "outside_nightly_window" };
  }

  syncInFlight = true;
  syncState.lastRunAt = now.toISOString();

  try {
    const response = await fetchObserverJson("/api/observer/read/events", {
      query: {
        source: cfg.sourceName,
        since: buildSince(cfg),
        limit: cfg.nightlySyncLimit || 500,
      },
    });
    const items = Array.isArray(response?.items) ? response.items : [];
    const inserted = await insertPrimaryLogEventsFromObserver(items);
    const result = {
      ok: true,
      fetched: items.length,
      inserted: inserted.inserted || 0,
      duplicates: inserted.duplicates === true,
      syncedAt: new Date().toISOString(),
    };
    syncState.lastResult = result;
    syncState.lastError = null;
    return result;
  } catch (error) {
    const result = {
      ok: false,
      error: error?.message || String(error),
      failedAt: new Date().toISOString(),
    };
    syncState.lastError = result;
    throw error;
  } finally {
    syncInFlight = false;
  }
}

export function startSmartLogNightlySync() {
  const cfg = getObserverSinkConfig();
  if (!cfg.nightlySyncEnabled || syncTimer) return;
  syncTimer = setInterval(() => {
    void syncObserverLogsToPrimary().catch(() => {});
  }, cfg.nightlySyncIntervalMs);
  if (typeof syncTimer.unref === "function") syncTimer.unref();
  void syncObserverLogsToPrimary().catch(() => {});
}

export function restartSmartLogNightlySync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  startSmartLogNightlySync();
}

export function shutdownSmartLogNightlySync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
