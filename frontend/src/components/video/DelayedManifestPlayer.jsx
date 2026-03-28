/* eslint-disable react/prop-types */
import { Alert } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAspectRatio } from "./AspectMediaFrame";
import NativeVideoPlayer from "./NativeVideoPlayer";

const WARMUP_WINDOW_SEGMENTS = 6;

function normalizeManifestItems(manifest) {
  const segments = Array.isArray(manifest?.segments) ? manifest.segments : [];
  const playable = segments
    .map((segment) => ({
      key: `segment:${segment?.index ?? ""}`,
      url: typeof segment?.url === "string" ? segment.url.trim() : "",
      index: Number(segment?.index ?? -1),
      durationSeconds: Number(segment?.durationSeconds || 2),
      kind: "segment",
    }))
    .filter((segment) => segment.url);

  const finalPlaybackUrl =
    typeof manifest?.finalPlaybackUrl === "string"
      ? manifest.finalPlaybackUrl.trim()
      : "";

  if (finalPlaybackUrl) {
    playable.push({
      key: "final",
      url: finalPlaybackUrl,
      index: Number.MAX_SAFE_INTEGER,
      durationSeconds: 0,
      kind: "final",
    });
  }

  return playable;
}

function mergeManifestItems(previousItems, incomingItems, currentKey) {
  const previous = Array.isArray(previousItems) ? previousItems : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  const byKey = new Map();

  previous.forEach((item) => {
    if (item?.key) {
      byKey.set(item.key, item);
    }
  });
  incoming.forEach((item) => {
    if (item?.key) {
      byKey.set(item.key, {
        ...(byKey.get(item.key) || {}),
        ...item,
      });
    }
  });

  const currentIndex = previous.findIndex((item) => item?.key === currentKey);
  const preservedTail = currentIndex > 0 ? previous.slice(currentIndex) : previous;
  const merged = [];
  const seen = new Set();

  preservedTail.forEach((item) => {
    const resolved = byKey.get(item?.key);
    if (!resolved || seen.has(resolved.key)) return;
    merged.push(resolved);
    seen.add(resolved.key);
  });

  incoming.forEach((item) => {
    const resolved = byKey.get(item?.key) || item;
    if (!resolved?.key || seen.has(resolved.key)) return;
    merged.push(resolved);
    seen.add(resolved.key);
  });

  return merged;
}

export default function DelayedManifestPlayer({
  source,
  autoplay = true,
  previewOnlyUntilPlay = false,
  useNativeControls = false,
  showLiveBadge = true,
}) {
  const [items, setItems] = useState([]);
  const [currentKey, setCurrentKey] = useState("");
  const [currentPlaybackUrl, setCurrentPlaybackUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waitingForNext, setWaitingForNext] = useState(false);
  const [manifestStatus, setManifestStatus] = useState("");
  const currentKeyRef = useRef("");
  const waitingForNextRef = useRef(false);
  const warmupControllersRef = useRef(new Map());

  const currentItem = useMemo(() => {
    if (!items.length) return null;
    return (
      items.find((item) => item?.key === currentKey) ||
      items[0] ||
      null
    );
  }, [currentKey, items]);

  const currentUrl = currentItem?.url || "";
  const currentItemIndex = useMemo(() => {
    return items.findIndex((item) => item?.key === currentKey);
  }, [currentKey, items]);
  const stagedNextItem = useMemo(() => {
    if (!items.length) return null;
    if (currentItemIndex < 0) return items[1] || null;
    return items[currentItemIndex + 1] || null;
  }, [currentItemIndex, items]);
  const stagedNextPlaybackUrl = useMemo(() => {
    if (!stagedNextItem?.key) return "";
    // Prefer blob URL (preloaded in memory) for gapless switching
    const blobUrl = blobCacheRef.current?.get(stagedNextItem.key);
    if (blobUrl) return blobUrl;
    return stagedNextItem.url || "";
  }, [stagedNextItem, blobReady]);

  // Track blob readiness so stagedNextPlaybackUrl updates when blob is ready
  const [blobReady, setBlobReady] = useState(0);

  // ── Total duration from all segments ──
  const totalDuration = useMemo(() => {
    return items
      .filter((item) => item?.kind === "segment")
      .reduce((sum, item) => sum + (item?.durationSeconds || 0), 0);
  }, [items]);

  // ── Time offset: sum of durations of all segments before the current one ──
  const timeOffset = useMemo(() => {
    if (currentItemIndex <= 0) return 0;
    return items
      .slice(0, currentItemIndex)
      .filter((item) => item?.kind === "segment")
      .reduce((sum, item) => sum + (item?.durationSeconds || 0), 0);
  }, [currentItemIndex, items]);

  // ── Seek-to-segment: given a global time, find which segment to jump to ──
  const handleSeekGlobal = useCallback(
    (globalTime) => {
      let acc = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item?.kind !== "segment") continue;
        const segEnd = acc + (item?.durationSeconds || 0);
        if (globalTime < segEnd || i === items.length - 1) {
          // Jump to this segment
          if (item.key !== currentKeyRef.current) {
            currentKeyRef.current = item.key;
            waitingForNextRef.current = false;
            setWaitingForNext(false);
            setCurrentKey(item.key);
          }
          return acc; // return the new offset
        }
        acc = segEnd;
      }
      return 0;
    },
    [items],
  );

  useEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  useEffect(() => {
    waitingForNextRef.current = waitingForNext;
  }, [waitingForNext]);



  const clearWarmupResources = useCallback(() => {
    for (const controller of warmupControllersRef.current.values()) {
      controller.abort();
    }
    warmupControllersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!currentItem?.key) {
      setCurrentPlaybackUrl("");
      return;
    }
    setCurrentPlaybackUrl(currentItem.url || "");
  }, [currentItem?.key, currentItem?.url]);

  // ── Blob prefetch for next segment (gapless switching) ──
  // The NEXT segment is downloaded as a blob URL so NativeVideoPlayer's
  // hidden slot has data ready in memory → instant switch, no visible reload.
  // Further segments use HTTP cache warmup for later preloading.
  const blobCacheRef = useRef(new Map()); // key → blobUrl

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      for (const blobUrl of blobCacheRef.current.values()) {
        try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
      }
      blobCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const currentIndex = items.findIndex((item) => item?.key === currentKey);
    const startIndex = Math.max(0, currentIndex >= 0 ? currentIndex + 1 : 0);
    const warmupItems = items.slice(startIndex, startIndex + WARMUP_WINDOW_SEGMENTS);
    const warmupKeys = new Set(warmupItems.map((item) => item?.key).filter(Boolean));

    // Abort warmups for segments we no longer care about
    for (const [key, controller] of warmupControllersRef.current.entries()) {
      if (!warmupKeys.has(key)) {
        controller.abort();
        warmupControllersRef.current.delete(key);
      }
    }

    // Revoke blob URLs for segments we passed
    for (const [key, blobUrl] of blobCacheRef.current.entries()) {
      if (!warmupKeys.has(key)) {
        try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
        blobCacheRef.current.delete(key);
      }
    }

    // Prefetch upcoming segments
    warmupItems.forEach((item, idx) => {
      if (!item?.key || !item?.url || item.kind === "final") return;
      if (warmupControllersRef.current.has(item.key)) return;

      const controller = new AbortController();
      warmupControllersRef.current.set(item.key, controller);

      if (idx === 0) {
        // NEXT segment: full blob prefetch for gapless switching
        fetch(item.url, { signal: controller.signal })
          .then((res) => {
            if (!res.ok) throw new Error("Prefetch failed");
            return res.blob();
          })
          .then((blob) => {
            if (controller.signal.aborted) return;
            const blobUrl = URL.createObjectURL(blob);
            blobCacheRef.current.set(item.key, blobUrl);
            setBlobReady((c) => c + 1); // trigger re-evaluation of stagedNextPlaybackUrl
          })
          .catch(() => { /* Prefetch failure is non-critical */ })
          .finally(() => {
            warmupControllersRef.current.delete(item.key);
          });
      } else {
        // Further segments: HTTP cache warmup only
        fetch(item.url, {
          cache: "force-cache",
          signal: controller.signal,
        })
          .catch(() => { /* Warmup failure is non-critical */ })
          .finally(() => {
            warmupControllersRef.current.delete(item.key);
          });
      }
    });
  }, [currentKey, items]);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const applyManifest = (manifest) => {
      const playable = normalizeManifestItems(manifest);
      const mStatus =
        typeof manifest?.status === "string" ? manifest.status.trim() : "";
      setManifestStatus(mStatus);

      setItems((previousItems) => {
        const merged = mergeManifestItems(
          previousItems,
          playable,
          currentKeyRef.current,
        );

        if (!currentKeyRef.current) {
          // For live manifests, start from near the tail (latest content)
          // so viewers see the current score, not the beginning.
          // For final/finished recordings, start from the beginning.
          const isLive = mStatus !== "final";
          const segmentItems = merged.filter((item) => item?.kind === "segment");
          let startItem;
          if (isLive && segmentItems.length > 2) {
            // Start ~2 segments before the end to give buffer for prefetch
            startItem = segmentItems[segmentItems.length - 2];
          } else {
            startItem = merged[0];
          }
          const nextKey = startItem?.key || merged[0]?.key || "";
          if (nextKey) {
            currentKeyRef.current = nextKey;
            setCurrentKey(nextKey);
            waitingForNextRef.current = false;
            setWaitingForNext(false);
          }
        } else if (waitingForNextRef.current) {
          const currentIndex = merged.findIndex(
            (item) => item?.key === currentKeyRef.current,
          );
          if (currentIndex >= 0 && currentIndex < merged.length - 1) {
            const nextKey = merged[currentIndex + 1]?.key || "";
            if (nextKey) {
              currentKeyRef.current = nextKey;
              setCurrentKey(nextKey);
              waitingForNextRef.current = false;
              setWaitingForNext(false);
            }
          }
        }

        return merged;
      });

      setLoading(false);

      if (!playable.length && !currentKeyRef.current) {
        setError(
          source?.disabledReason || "Server 2 đang chuẩn bị dữ liệu video.",
        );
      } else if (waitingForNextRef.current) {
        setError(
          mStatus === "final"
            ? "Đang chuyển sang bản playback hoàn chỉnh."
            : "Đang đợi segment tiếp theo từ PickleTour CDN.",
        );
      } else {
        setError("");
      }
    };

    const recordingId =
      typeof source?.meta?.recordingId === "string"
        ? source.meta.recordingId.trim()
        : "";
    const expectedSegmentCount =
      Number(source?.meta?.uploadedSegmentCount || 0) || 0;
    const isFinishedSource =
      String(source?.meta?.status || "").toLowerCase() === "final" ||
      String(source?.meta?.status || "").toLowerCase() === "finished" ||
      String(source?.meta?.status || "").toLowerCase() === "ready";
    let usedBackendPlaylist = false;

    const buildPlaylistUrl = () => {
      if (!recordingId) return "";
      const apiBase =
        typeof window !== "undefined"
          ? window.location.origin
          : "";
      return `${apiBase}/api/live/recordings/v2/${recordingId}/temp/playlist`;
    };

    const applyPlaylistSegments = (playlistData) => {
      if (!playlistData?.segments?.length) return false;
      const playable = playlistData.segments
        .map((segment) => ({
          key: `segment:${segment?.index ?? ""}`,
          url: typeof segment?.url === "string" ? segment.url.trim() : "",
          index: Number(segment?.index ?? -1),
          durationSeconds: Number(segment?.durationSeconds || 2),
          kind: "segment",
        }))
        .filter((seg) => seg.url);
      if (!playable.length) return false;

      setItems(() => {
        if (!currentKeyRef.current) {
          const nextKey = playable[0]?.key || "";
          if (nextKey) {
            currentKeyRef.current = nextKey;
            setCurrentKey(nextKey);
            waitingForNextRef.current = false;
            setWaitingForNext(false);
          }
        }
        return playable;
      });
      setManifestStatus("final");
      setLoading(false);
      setError("");
      return true;
    };

    const fetchManifest = async () => {
      try {
        // For finished recordings, try backend playlist FIRST —
        // it returns signed URLs with long TTL that support Range requests
        if (recordingId && isFinishedSource && !usedBackendPlaylist) {
          const playlistUrl = buildPlaylistUrl();
          if (playlistUrl) {
            try {
              const playlistResponse = await fetch(playlistUrl, {
                cache: "no-store",
              });
              if (playlistResponse.ok) {
                const playlistData = await playlistResponse.json();
                if (!cancelled && applyPlaylistSegments(playlistData)) {
                  usedBackendPlaylist = true;
                  return;
                }
              }
            } catch {
              // Backend playlist failed, fall through to R2 manifest
            }
          }
        }

        // Fetch R2 manifest
        const response = await fetch(source?.embedUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Manifest HTTP ${response.status}`);
        }

        const manifest = await response.json();
        if (cancelled) return;

        const manifestSegmentCount = Array.isArray(manifest?.segments)
          ? manifest.segments.length
          : 0;

        // If R2 manifest has way fewer segments than expected AND we have
        // a recordingId, switch to backend playlist for full segment list
        if (
          recordingId &&
          expectedSegmentCount > 0 &&
          manifestSegmentCount < expectedSegmentCount * 0.8 &&
          !usedBackendPlaylist
        ) {
          const playlistUrl = buildPlaylistUrl();
          if (playlistUrl) {
            try {
              const playlistResponse = await fetch(playlistUrl, {
                cache: "no-store",
              });
              if (playlistResponse.ok) {
                const playlistData = await playlistResponse.json();
                if (!cancelled && applyPlaylistSegments(playlistData)) {
                  usedBackendPlaylist = true;
                  return;
                }
              }
            } catch {
              // Backend playlist failed, fall through to R2 manifest
            }
          }
        }

        if (cancelled) return;
        applyManifest(manifest);
      } catch (fetchError) {
        if (cancelled) return;
        setLoading(false);
        setError(
          fetchError?.message || "Không tải được delayed manifest từ CDN.",
        );
      } finally {
        if (!cancelled && !usedBackendPlaylist) {
          const baseRefreshSeconds =
            Number(source?.meta?.refreshSeconds || 4) > 0
              ? Number(source?.meta?.refreshSeconds || 4)
              : 4;
          // When waiting for next segment, poll faster to minimize playback gap
          const effectiveMs = waitingForNextRef.current
            ? 1500
            : baseRefreshSeconds * 1000;
          timerId = window.setTimeout(fetchManifest, effectiveMs);
        }
      }
    };

    setItems([]);
    setCurrentKey("");
    setLoading(true);
    setError("");
    setWaitingForNext(false);
    setCurrentPlaybackUrl("");
    setManifestStatus("");
    currentKeyRef.current = "";
    waitingForNextRef.current = false;
    clearWarmupResources();
    fetchManifest();

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
      clearWarmupResources();
    };
  }, [
    clearWarmupResources,
    source?.embedUrl,
    source?.disabledReason,
    source?.meta?.refreshSeconds,
    source?.meta?.recordingId,
    source?.meta?.status,
  ]);

  const handleEnded = useCallback(() => {
    setCurrentKey((previousKey) => {
      const currentIndex = items.findIndex((item) => item.key === previousKey);
      if (currentIndex >= 0 && currentIndex < items.length - 1) {
        const nextKey = items[currentIndex + 1]?.key || previousKey;
        currentKeyRef.current = nextKey;
        waitingForNextRef.current = false;
        setWaitingForNext(false);
        return nextKey;
      }

      waitingForNextRef.current = true;
      setWaitingForNext(true);
      return previousKey;
    });
  }, [items]);

  const handleAdvanceToStagedSource = useCallback((nextKey) => {
    const normalizedNextKey = String(nextKey || "").trim();
    if (!normalizedNextKey) {
      handleEnded();
      return;
    }

    currentKeyRef.current = normalizedNextKey;
    waitingForNextRef.current = false;
    setWaitingForNext(false);
    setCurrentKey(normalizedNextKey);
  }, [handleEnded]);

  if (loading) {
    return <Alert severity="info">Đang tải video từ PickleTour...</Alert>;
  }

  if (!currentUrl) {
    return <Alert severity="info">{error || "Server 2 đang chuẩn bị."}</Alert>;
  }

  return (
    <>
      <NativeVideoPlayer
        src={currentPlaybackUrl}
        kind="file"
        fallbackUrl={source?.openUrl || source?.url || currentUrl}
        initialRatio={resolveAspectRatio(source?.aspect)}
        title={source?.label || "Server 2"}
        subtitle={source?.providerLabel || "PickleTour Video"}
        onEnded={handleEnded}
        autoplay={autoplay}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
        useNativeControls={useNativeControls}
        liveMode={showLiveBadge && manifestStatus !== "final"}
        queueModeEnabled
        holdLastFrameOnSourceChange
        stagedNextSrc={stagedNextPlaybackUrl}
        stagedNextToken={stagedNextItem?.key || ""}
        onAdvanceToStagedSource={handleAdvanceToStagedSource}
        totalDuration={totalDuration > 0 ? totalDuration : undefined}
        totalTimeOffset={timeOffset}
        onSeekGlobal={handleSeekGlobal}
      />
      {error ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
    </>
  );
}
