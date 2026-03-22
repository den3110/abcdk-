const WINDOW_MS = Math.max(
  60_000,
  Number(process.env.PEAK_RUNTIME_METRICS_WINDOW_MS || 5 * 60_000)
);
const MAX_SAMPLES_PER_ENDPOINT = Math.max(
  200,
  Number(process.env.PEAK_RUNTIME_METRICS_MAX_SAMPLES_PER_ENDPOINT || 1500)
);
const MAX_ENDPOINTS = Math.max(
  20,
  Number(process.env.PEAK_RUNTIME_METRICS_MAX_ENDPOINTS || 200)
);

const endpointSamples = new Map();

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePathname(pathname = "") {
  return String(pathname || "")
    .replace(/[0-9a-f]{24}(?=\/|$)/gi, ":id")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      ":uuid"
    )
    .replace(/\/\d+(?=\/|$)/g, "/:num");
}

function buildHotPathKey(method, pathname, searchParams) {
  if (
    method === "GET" &&
    /^\/api\/live-app\/courts\/[^/]+\/runtime$/i.test(pathname)
  ) {
    return "courtRuntime";
  }
  if (
    method === "GET" &&
    /^\/api\/live-app\/matches\/[^/]+\/runtime$/i.test(pathname)
  ) {
    return "matchRuntime";
  }
  if (
    method === "GET" &&
    /^\/api\/overlay\/match\/[^/]+$/i.test(pathname)
  ) {
    return "overlayMatch";
  }
  if (
    method === "GET" &&
    /^\/api\/overlay\/courts\/[^/]+\/next$/i.test(pathname)
  ) {
    return "overlayNextCourt";
  }
  if (method === "GET" && /^\/api\/courts\/[^/]+$/i.test(pathname)) {
    return "courtInfo";
  }
  if (method === "GET" && pathname === "/api/live/matches") {
    return "liveMatches";
  }
  if (method === "GET" && /^\/api\/tournaments\/[^/]+\/brackets$/i.test(pathname)) {
    return "tournamentBrackets";
  }
  if (method === "GET" && /^\/api\/tournaments\/[^/]+$/i.test(pathname)) {
    return "tournamentInfo";
  }
  if (method === "GET" && /^\/api\/tournaments\/[^/]+\/matches$/i.test(pathname)) {
    return searchParams?.get("view") === "bracket"
      ? "tournamentMatchesBracket"
      : "tournamentMatchesGeneric";
  }
  if (method === "POST" && pathname === "/api/live/recordings/v2/segments/presign") {
    return "recordingSegmentPresign";
  }
  if (
    method === "POST" &&
    pathname === "/api/live/recordings/v2/segments/presign-batch"
  ) {
    return "recordingSegmentPresignBatch";
  }
  if (
    method === "POST" &&
    pathname === "/api/live/recordings/v2/segments/complete"
  ) {
    return "recordingSegmentComplete";
  }
  if (method === "POST" && pathname === "/api/live/recordings/v2/finalize") {
    return "recordingFinalize";
  }
  return null;
}

function pruneEntries(entries, nowTs) {
  const cutoff = nowTs - WINDOW_MS;
  while (entries.length && entries[0].ts < cutoff) {
    entries.shift();
  }
  if (entries.length > MAX_SAMPLES_PER_ENDPOINT) {
    entries.splice(0, entries.length - MAX_SAMPLES_PER_ENDPOINT);
  }
}

function calcP95(sortedDurations) {
  if (!sortedDurations.length) return 0;
  const index = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1)
  );
  return sortedDurations[index];
}

function summarizeEntries(entries) {
  if (!entries.length) {
    return {
      count: 0,
      reqPerMin: 0,
      avgMs: 0,
      p95Ms: 0,
      errors4xx: 0,
      errors5xx: 0,
    };
  }

  const durations = entries
    .map((entry) => asNumber(entry.durationMs))
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const errors4xx = entries.filter(
    (entry) => entry.statusCode >= 400 && entry.statusCode < 500
  ).length;
  const errors5xx = entries.filter((entry) => entry.statusCode >= 500).length;

  return {
    count: entries.length,
    reqPerMin: Number(((entries.length * 60_000) / WINDOW_MS).toFixed(2)),
    avgMs: Number((totalMs / Math.max(1, durations.length)).toFixed(1)),
    p95Ms: calcP95(durations),
    errors4xx,
    errors5xx,
  };
}

function buildProcessSnapshot() {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
    heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
    heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(1)),
    externalMb: Number((memory.external / 1024 / 1024).toFixed(1)),
  };
}

export function recordRequestMetric({
  method,
  url,
  statusCode,
  durationMs,
}) {
  try {
    const normalizedMethod = String(method || "GET").toUpperCase();
    const parsed = new URL(String(url || "/"), "http://pickletour.local");
    const pathname = parsed.pathname || "/";
    const route = normalizePathname(pathname);
    const nowTs = Date.now();
    const key = `${normalizedMethod} ${route}`;
    const hotPathKey = buildHotPathKey(
      normalizedMethod,
      pathname,
      parsed.searchParams
    );

    let samples = endpointSamples.get(key);
    if (!samples) {
      if (endpointSamples.size >= MAX_ENDPOINTS) {
        const oldestKey = endpointSamples.keys().next().value;
        if (oldestKey) endpointSamples.delete(oldestKey);
      }
      samples = [];
      endpointSamples.set(key, samples);
    }

    samples.push({
      ts: nowTs,
      durationMs: asNumber(durationMs),
      statusCode: asNumber(statusCode),
      hotPathKey,
    });
    pruneEntries(samples, nowTs);
  } catch (_) {
    // Metrics are best-effort only.
  }
}

export function getPeakRuntimeMetricsSnapshot() {
  const nowTs = Date.now();
  const totals = [];
  const hotBuckets = new Map();

  for (const [key, entries] of endpointSamples.entries()) {
    pruneEntries(entries, nowTs);
    if (!entries.length) {
      endpointSamples.delete(key);
      continue;
    }

    const summary = summarizeEntries(entries);
    const [method, ...rest] = key.split(" ");
    totals.push({
      key,
      method,
      path: rest.join(" "),
      ...summary,
    });

    for (const entry of entries) {
      if (!entry.hotPathKey) continue;
      const bucket = hotBuckets.get(entry.hotPathKey) || [];
      bucket.push(entry);
      hotBuckets.set(entry.hotPathKey, bucket);
    }
  }

  totals.sort((a, b) => b.count - a.count || b.p95Ms - a.p95Ms);

  const allEntries = Array.from(endpointSamples.values()).flat();
  const summary = summarizeEntries(allEntries);

  const hotPaths = {};
  for (const [key, entries] of hotBuckets.entries()) {
    hotPaths[key] = summarizeEntries(entries);
  }

  return {
    ok: true,
    capturedAt: new Date().toISOString(),
    windowMs: WINDOW_MS,
    process: buildProcessSnapshot(),
    totals: summary,
    endpoints: totals.slice(0, 30),
    hotPaths,
  };
}
