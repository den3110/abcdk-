/* eslint-disable react/prop-types */
import { Alert } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAspectRatio } from "./AspectMediaFrame";
import NativeVideoPlayer from "./NativeVideoPlayer";

const PREFETCH_WINDOW_SEGMENTS = 10;

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
  const [prefetchedUrls, setPrefetchedUrls] = useState({});
  const [manifestStatus, setManifestStatus] = useState("");
  const currentKeyRef = useRef("");
  const waitingForNextRef = useRef(false);
  const prefetchedUrlsRef = useRef({});
  const prefetchCacheRef = useRef(new Map());
  const prefetchControllersRef = useRef(new Map());

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
    return (
      prefetchedUrls[stagedNextItem.key] ||
      stagedNextItem.url ||
      ""
    );
  }, [prefetchedUrls, stagedNextItem]);

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

  useEffect(() => {
    prefetchedUrlsRef.current = prefetchedUrls;
  }, [prefetchedUrls]);

  const clearPrefetchResources = useCallback(() => {
    for (const controller of prefetchControllersRef.current.values()) {
      controller.abort();
    }
    prefetchControllersRef.current.clear();
    for (const blobUrl of prefetchCacheRef.current.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    prefetchCacheRef.current.clear();
  }, []);

  useEffect(() => {
    if (!currentItem?.key) {
      setCurrentPlaybackUrl("");
      return;
    }

    setCurrentPlaybackUrl(
      prefetchedUrlsRef.current[currentItem.key] || currentItem.url || "",
    );
  }, [currentItem?.key, currentItem?.url]);

  useEffect(() => {
    const currentIndex = items.findIndex((item) => item?.key === currentKey);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const retainItems = items.slice(startIndex, startIndex + PREFETCH_WINDOW_SEGMENTS);
    const retainKeys = new Set(retainItems.map((item) => item?.key).filter(Boolean));

    for (const [key, controller] of prefetchControllersRef.current.entries()) {
      if (!retainKeys.has(key)) {
        controller.abort();
        prefetchControllersRef.current.delete(key);
      }
    }

    for (const [key, blobUrl] of prefetchCacheRef.current.entries()) {
      if (!retainKeys.has(key)) {
        URL.revokeObjectURL(blobUrl);
        prefetchCacheRef.current.delete(key);
        setPrefetchedUrls((previous) => {
          if (!(key in previous)) return previous;
          const next = { ...previous };
          delete next[key];
          return next;
        });
      }
    }

    retainItems.forEach((item) => {
      if (!item?.key || !item?.url || item.kind === "final") return;
      if (prefetchCacheRef.current.has(item.key)) return;
      if (prefetchControllersRef.current.has(item.key)) return;

      const controller = new AbortController();
      prefetchControllersRef.current.set(item.key, controller);

      fetch(item.url, {
        cache: "force-cache",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Segment HTTP ${response.status}`);
          }
          return response.blob();
        })
        .then((blob) => {
          if (controller.signal.aborted) return;
          const objectUrl = URL.createObjectURL(blob);
          prefetchCacheRef.current.set(item.key, objectUrl);
          setPrefetchedUrls((previous) => ({
            ...previous,
            [item.key]: objectUrl,
          }));
        })
        .catch(() => {
          // Fallback to direct CDN URL if prefetch fails.
        })
        .finally(() => {
          prefetchControllersRef.current.delete(item.key);
        });
    });

    return () => {
      // noop: cleanup handled by retain/prune logic and source reset effect
    };
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
          const nextKey = merged[0]?.key || "";
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

    const fetchManifest = async () => {
      try {
        const response = await fetch(source?.embedUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Manifest HTTP ${response.status}`);
        }

        const manifest = await response.json();
        if (cancelled) return;
        applyManifest(manifest);
      } catch (fetchError) {
        if (cancelled) return;
        setLoading(false);
        setError(
          fetchError?.message || "Không tải được delayed manifest từ CDN.",
        );
      } finally {
        if (!cancelled) {
          const refreshSeconds =
            Number(source?.meta?.refreshSeconds || 6) > 0
              ? Number(source?.meta?.refreshSeconds || 6)
              : 6;
          timerId = window.setTimeout(fetchManifest, refreshSeconds * 1000);
        }
      }
    };

    setItems([]);
    setCurrentKey("");
    setLoading(true);
    setError("");
    setWaitingForNext(false);
    setCurrentPlaybackUrl("");
    setPrefetchedUrls({});
    setManifestStatus("");
    currentKeyRef.current = "";
    waitingForNextRef.current = false;
    clearPrefetchResources();
    fetchManifest();

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
      clearPrefetchResources();
    };
  }, [
    clearPrefetchResources,
    source?.embedUrl,
    source?.disabledReason,
    source?.meta?.refreshSeconds,
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
