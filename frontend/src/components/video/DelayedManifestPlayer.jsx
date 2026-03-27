/* eslint-disable react/prop-types */
import { Alert } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAspectRatio } from "./AspectMediaFrame";
import NativeVideoPlayer from "./NativeVideoPlayer";

/** Number of segments per batch (~2s per segment → ~20s per batch). */
const BATCH_SIZE = 10;

/** How many batches to fetch ahead of the currently playing batch. */
const PREFETCH_AHEAD_BATCHES = 2;

/* ────────────────────────── manifest helpers ────────────────────────── */

function normalizeManifestItems(manifest) {
  const segments = Array.isArray(manifest?.segments) ? manifest.segments : [];
  return segments
    .map((segment) => ({
      url: typeof segment?.url === "string" ? segment.url.trim() : "",
      index: Number(segment?.index ?? -1),
      durationSeconds: Number(segment?.durationSeconds || 2),
    }))
    .filter((segment) => segment.url);
}

/**
 * Split flat segment array into batches.
 * Each batch = { startIndex, segments[], totalDuration }
 */
function buildBatches(segments) {
  const batches = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const slice = segments.slice(i, i + BATCH_SIZE);
    batches.push({
      startIndex: i,
      segments: slice,
      totalDuration: slice.reduce((s, seg) => s + seg.durationSeconds, 0),
    });
  }
  return batches;
}

/**
 * Fetch all segments in a batch concurrently and return a single blob URL.
 * Returns { blobUrl, duration } or null on failure.
 */
async function fetchBatch(batch, signal) {
  const fetches = batch.segments.map(async (seg) => {
    const res = await fetch(seg.url, { cache: "force-cache", signal });
    if (!res.ok) throw new Error(`Segment HTTP ${res.status}`);
    return res.arrayBuffer();
  });
  const buffers = await Promise.all(fetches);
  if (signal?.aborted) return null;
  const blob = new Blob(buffers, { type: "video/mp4" });
  return {
    blobUrl: URL.createObjectURL(blob),
    duration: batch.totalDuration,
  };
}

/* ────────────────────────── component ────────────────────────── */

export default function DelayedManifestPlayer({
  source,
  autoplay = true,
  previewOnlyUntilPlay = false,
  useNativeControls = false,
  showLiveBadge = true,
}) {
  // ─── state ───
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // All segments from manifest
  const [allSegments, setAllSegments] = useState([]);
  // Manifest status ("live" | "final" | …)
  const [manifestStatus, setManifestStatus] = useState("");
  // Fetched batch blob URLs:  batchIndex → { blobUrl, duration }
  const [batchCache, setBatchCache] = useState({});
  // Currently playing batch index
  const [activeBatchIdx, setActiveBatchIdx] = useState(0);
  // Time offset: sum of all previous batches' durations
  const [timeOffset, setTimeOffset] = useState(0);

  const batchCacheRef = useRef({});
  const activeBatchIdxRef = useRef(0);
  const fetchControllersRef = useRef(new Map());
  const manifestTimerRef = useRef(null);

  // ─── derived ───
  const batches = useMemo(() => buildBatches(allSegments), [allSegments]);

  const totalDuration = useMemo(
    () => allSegments.reduce((s, seg) => s + seg.durationSeconds, 0),
    [allSegments],
  );

  const activeBatch = batches[activeBatchIdx] ?? null;
  const activeBlobUrl = batchCache[activeBatchIdx]?.blobUrl || "";

  // Next batch (for queue-mode staged source)
  const nextBatchIdx = activeBatchIdx + 1;
  const nextBlobUrl =
    nextBatchIdx < batches.length
      ? batchCache[nextBatchIdx]?.blobUrl || ""
      : "";

  // Cumulative start time for each batch (for seek mapping)
  const cumulativeStartTimes = useMemo(() => {
    const starts = [];
    let acc = 0;
    for (const b of batches) {
      starts.push(acc);
      acc += b.totalDuration;
    }
    return starts;
  }, [batches]);

  // ─── sync refs ───
  useEffect(() => {
    batchCacheRef.current = batchCache;
  }, [batchCache]);
  useEffect(() => {
    activeBatchIdxRef.current = activeBatchIdx;
  }, [activeBatchIdx]);

  // ─── cleanup all blob URLs ───
  const cleanupAllBlobs = useCallback(() => {
    for (const ctrl of fetchControllersRef.current.values()) ctrl.abort();
    fetchControllersRef.current.clear();
    for (const entry of Object.values(batchCacheRef.current)) {
      if (entry?.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    }
    setBatchCache({});
    batchCacheRef.current = {};
  }, []);

  // ─── fetch a single batch and store it ───
  const ensureBatchFetched = useCallback(
    async (batchIdx) => {
      if (batchIdx < 0 || batchIdx >= batches.length) return;
      // Already cached or in-flight?
      if (batchCacheRef.current[batchIdx]) return;
      const key = `batch:${batchIdx}`;
      if (fetchControllersRef.current.has(key)) return;

      const controller = new AbortController();
      fetchControllersRef.current.set(key, controller);

      try {
        const result = await fetchBatch(
          batches[batchIdx],
          controller.signal,
        );
        if (!result || controller.signal.aborted) return;
        setBatchCache((prev) => {
          const next = { ...prev, [batchIdx]: result };
          batchCacheRef.current = next;
          return next;
        });
      } catch {
        // Will retry on next cycle
      } finally {
        fetchControllersRef.current.delete(key);
      }
    },
    [batches],
  );

  // ─── prefetch window: active + N ahead ───
  useEffect(() => {
    if (!batches.length) return;
    const toFetch = [];
    for (
      let i = activeBatchIdx;
      i < Math.min(batches.length, activeBatchIdx + 1 + PREFETCH_AHEAD_BATCHES);
      i++
    ) {
      toFetch.push(i);
    }
    toFetch.forEach((idx) => ensureBatchFetched(idx));

    // Prune old batches behind activeBatchIdx - 1
    const pruneThreshold = activeBatchIdx - 1;
    if (pruneThreshold >= 0) {
      setBatchCache((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const idx = Number(key);
          if (idx < pruneThreshold) {
            if (next[idx]?.blobUrl) URL.revokeObjectURL(next[idx].blobUrl);
            delete next[idx];
            changed = true;
          }
        }
        if (changed) batchCacheRef.current = next;
        return changed ? next : prev;
      });
    }
  }, [activeBatchIdx, batches.length, ensureBatchFetched]);

  // ─── manifest polling ───
  useEffect(() => {
    let cancelled = false;

    const applyManifest = (manifest) => {
      const playable = normalizeManifestItems(manifest);
      const status =
        typeof manifest?.status === "string" ? manifest.status.trim() : "";

      setManifestStatus(status);
      setAllSegments((prev) => {
        // Only grow — never shrink the list (live mode: new segments appear)
        if (playable.length <= prev.length) return prev;
        return playable;
      });
      setLoading(false);

      if (!playable.length) {
        setError(
          source?.disabledReason || "Server 2 đang chuẩn bị dữ liệu video.",
        );
      } else {
        setError("");
      }
    };

    const fetchManifest = async () => {
      try {
        const response = await fetch(source?.embedUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
        const manifest = await response.json();
        if (cancelled) return;
        applyManifest(manifest);
      } catch (fetchError) {
        if (cancelled) return;
        setLoading(false);
        setError(fetchError?.message || "Không tải được manifest từ CDN.");
      } finally {
        if (!cancelled) {
          const refreshSeconds =
            Number(source?.meta?.refreshSeconds || 6) > 0
              ? Number(source?.meta?.refreshSeconds || 6)
              : 6;
          manifestTimerRef.current = window.setTimeout(
            fetchManifest,
            refreshSeconds * 1000,
          );
        }
      }
    };

    // Reset everything
    setAllSegments([]);
    setActiveBatchIdx(0);
    activeBatchIdxRef.current = 0;
    setTimeOffset(0);
    setLoading(true);
    setError("");
    setManifestStatus("");
    cleanupAllBlobs();
    fetchManifest();

    return () => {
      cancelled = true;
      if (manifestTimerRef.current) {
        window.clearTimeout(manifestTimerRef.current);
        manifestTimerRef.current = null;
      }
      cleanupAllBlobs();
    };
  }, [
    cleanupAllBlobs,
    source?.embedUrl,
    source?.disabledReason,
    source?.meta?.refreshSeconds,
  ]);

  // ─── auto-update timeOffset when activeBatchIdx changes ───
  useEffect(() => {
    setTimeOffset(cumulativeStartTimes[activeBatchIdx] || 0);
  }, [activeBatchIdx, cumulativeStartTimes]);

  // ─── handle batch ended → advance to next ───
  const handleEnded = useCallback(() => {
    setActiveBatchIdx((prev) => {
      const next = prev + 1;
      if (next < batches.length) {
        activeBatchIdxRef.current = next;
        return next;
      }
      // No more batches
      return prev;
    });
  }, [batches.length]);

  const handleAdvanceToStagedSource = useCallback(
    (token) => {
      const idx = Number(String(token || "").replace("batch:", ""));
      if (Number.isFinite(idx) && idx >= 0 && idx < batches.length) {
        activeBatchIdxRef.current = idx;
        setActiveBatchIdx(idx);
      } else {
        handleEnded();
      }
    },
    [batches.length, handleEnded],
  );

  // ─── seek handler: map global time → batch ───
  const handleSeekToBatch = useCallback(
    (globalTime) => {
      for (let i = cumulativeStartTimes.length - 1; i >= 0; i--) {
        if (globalTime >= cumulativeStartTimes[i]) {
          if (i !== activeBatchIdxRef.current) {
            activeBatchIdxRef.current = i;
            setActiveBatchIdx(i);
          }
          return cumulativeStartTimes[i];
        }
      }
      return 0;
    },
    [cumulativeStartTimes],
  );

  // ─── render ───
  if (loading) {
    return <Alert severity="info">Đang tải video từ PickleTour...</Alert>;
  }

  if (!activeBlobUrl && !allSegments.length) {
    return (
      <Alert severity="info">{error || "Server 2 đang chuẩn bị."}</Alert>
    );
  }

  if (!activeBlobUrl) {
    return <Alert severity="info">Đang tải batch video...</Alert>;
  }

  return (
    <>
      <NativeVideoPlayer
        key={`batch-${activeBatchIdx}`}
        src={activeBlobUrl}
        kind="file"
        fallbackUrl={source?.openUrl || source?.url || ""}
        initialRatio={resolveAspectRatio(source?.aspect)}
        title={source?.label || "Server 2"}
        subtitle={source?.providerLabel || "PickleTour Video"}
        onEnded={handleEnded}
        autoplay={autoplay}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
        useNativeControls={useNativeControls}
        liveMode={showLiveBadge && manifestStatus !== "final"}
        queueModeEnabled={Boolean(nextBlobUrl)}
        holdLastFrameOnSourceChange
        stagedNextSrc={nextBlobUrl}
        stagedNextToken={`batch:${nextBatchIdx}`}
        onAdvanceToStagedSource={handleAdvanceToStagedSource}
        totalDuration={totalDuration > 0 ? totalDuration : undefined}
        totalTimeOffset={timeOffset}
        onSeekGlobal={handleSeekToBatch}
      />
      {error ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
    </>
  );
}
