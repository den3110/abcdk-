/* eslint-disable react/prop-types */
import { Alert } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAspectRatio } from "./AspectMediaFrame";
import NativeVideoPlayer from "./NativeVideoPlayer";

const WARMUP_WINDOW_SEGMENTS = 8;
const BLOB_PREFETCH_SEGMENTS = 3;
const BACK_BUFFER_SEGMENTS = 6;

function normalizeManifestItems(manifest, baseUrl = "") {
  const segments = Array.isArray(manifest?.segments) ? manifest.segments : [];
  // Resolve relative segment URLs against the CDN base URL.
  // Manifest from R2 may have relative filenames like "segment_00863.mp4"
  // which need to be resolved to absolute CDN paths.
  const resolveUrl = (url) => {
    if (!url) return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    // Already absolute
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    // Relative — prepend base URL
    if (baseUrl) {
      const base = baseUrl.replace(/\/+$/, "");
      return `${base}/${trimmed.replace(/^\/+/, "")}`;
    }
    return trimmed;
  };

  const playable = segments
    .map((segment) => ({
      key: `segment:${segment?.index ?? ""}`,
      url: resolveUrl(typeof segment?.url === "string" ? segment.url : ""),
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
  const preservedTail = currentIndex > 0
    ? previous.slice(Math.max(0, currentIndex - BACK_BUFFER_SEGMENTS))
    : previous;
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

function pickInitialPlaybackItem(
  items = [],
  { isLive = false, delaySeconds = 0 } = {},
) {
  const segmentItems = (Array.isArray(items) ? items : []).filter(
    (item) => item?.kind === "segment",
  );
  if (!segmentItems.length) {
    return items[0] || null;
  }

  if (!isLive) {
    return segmentItems[0] || items[0] || null;
  }

  const desiredLagSeconds = Math.max(12, Number(delaySeconds || 0));
  const totalDuration = segmentItems.reduce(
    (sum, item) => sum + Math.max(0, Number(item?.durationSeconds || 0)),
    0,
  );
  const targetOffset = Math.max(0, totalDuration - desiredLagSeconds);

  let elapsed = 0;
  for (const item of segmentItems) {
    const duration = Math.max(0, Number(item?.durationSeconds || 0));
    if (elapsed + duration > targetOffset) {
      return item;
    }
    elapsed += duration;
  }

  return segmentItems[0] || items[0] || null;
}

function parseSegmentIndexFromKey(key) {
  const matched = String(key || "").match(/^segment:(\d+)$/);
  if (!matched) return null;
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
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
  const warmedKeysRef = useRef(new Set());
  const blobCacheRef = useRef(new Map()); // key → blobUrl
  const playlistRefreshSecondsRef = useRef(
    Number(source?.meta?.refreshSeconds) >= 0
      ? Number(source?.meta?.refreshSeconds)
      : 4,
  );

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

  // Track blob readiness so stagedNextPlaybackUrl updates when blob is ready
  const [, setBlobReady] = useState(0);

  const stagedNextPlaybackUrl = stagedNextItem?.key
    ? blobCacheRef.current?.get(stagedNextItem.key) || stagedNextItem.url || ""
    : "";

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

  // Clean up blob URLs on unmount
  useEffect(() => {
    const blobCache = blobCacheRef.current;
    const warmedKeys = warmedKeysRef.current;
    return () => {
      for (const blobUrl of blobCache.values()) {
        try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
      }
      blobCache.clear();
      warmedKeys.clear();
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
    for (const key of warmedKeysRef.current) {
      if (!warmupKeys.has(key)) {
        warmedKeysRef.current.delete(key);
      }
    }

    // Prefetch upcoming segments
    warmupItems.forEach((item, idx) => {
      if (!item?.key || !item?.url || item.kind === "final") return;
      if (warmupControllersRef.current.has(item.key)) return;

      const controller = new AbortController();
      warmupControllersRef.current.set(item.key, controller);

      if (idx < BLOB_PREFETCH_SEGMENTS) {
        if (blobCacheRef.current.has(item.key)) {
          warmupControllersRef.current.delete(item.key);
          return;
        }
        // Keep a few upcoming segments as full blobs so playback behaves like
        // a buffered queue instead of depending on a last-second fetch.
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
        if (warmedKeysRef.current.has(item.key)) {
          warmupControllersRef.current.delete(item.key);
          return;
        }
        // Further segments: HTTP cache warmup only
        fetch(item.url, {
          cache: "force-cache",
          signal: controller.signal,
        })
          .then(() => {
            if (!controller.signal.aborted) {
              warmedKeysRef.current.add(item.key);
            }
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
      // Compute CDN base URL for resolving relative segment filenames.
      // segmentBaseUrl: full CDN path to /segments/ directory (from backend)
      // Fallback: publicBaseUrl + /segments or manifest URL directory.
      const cdnBase =
        (typeof source?.meta?.segmentBaseUrl === "string"
          ? source.meta.segmentBaseUrl.trim().replace(/\/+$/, "")
          : "") ||
        (typeof source?.meta?.publicBaseUrl === "string" && source.meta.publicBaseUrl.trim()
          ? `${source.meta.publicBaseUrl.trim().replace(/\/+$/, "")}/segments`
          : "") ||
        (typeof source?.embedUrl === "string"
          ? source.embedUrl.trim().replace(/\/[^/]*$/, "")
          : "");
      const playable = normalizeManifestItems(manifest, cdnBase);
      const mStatus =
        typeof manifest?.status === "string" ? manifest.status.trim() : "";
      const manifestUsesSafeLiveWindow =
        manifest?.usesSafeLiveWindow === true ||
        (Boolean(source?.embedUrl) &&
          !/\/api\/live\/recordings\/v2\/[^/]+\/temp(?:\/playlist)?(?:\?|$)/i.test(
            String(source?.embedUrl || ""),
          ));
      const manifestRefreshSeconds = Number(manifest?.refreshSeconds);
      if (Number.isFinite(manifestRefreshSeconds) && manifestRefreshSeconds >= 0) {
        playlistRefreshSecondsRef.current = manifestRefreshSeconds;
      }
      setManifestStatus(mStatus);

      setItems((previousItems) => {
        const merged = mergeManifestItems(
          previousItems,
          playable,
          currentKeyRef.current,
        );

        if (!currentKeyRef.current) {
          const preferredStartIndex = Number(manifest?.recommendedStartIndex);
          const preferredStartItem = Number.isFinite(preferredStartIndex)
            ? merged.find(
              (item) =>
                item?.kind === "segment" &&
                Number(item?.index) === preferredStartIndex,
            )
            : null;
          const startItem = preferredStartItem || pickInitialPlaybackItem(merged, {
            isLive: mStatus !== "final",
            delaySeconds:
              manifestUsesSafeLiveWindow ? 12 : source?.delaySeconds,
          });
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
    const isFinishedSource =
      !showLiveBadge ||
      String(source?.meta?.status || "").toLowerCase() === "final" ||
      String(source?.meta?.status || "").toLowerCase() === "finished";
    const sourceManifestUrl =
      typeof source?.embedUrl === "string" ? source.embedUrl.trim() : "";
    const isBackendTempPlaylistSource =
      /\/api\/live\/recordings\/v2\/[^/]+\/temp(?:\/playlist)?(?:\?|$)/i.test(
        sourceManifestUrl,
      );
    const shouldPreferCdnManifest =
      Boolean(sourceManifestUrl) && !isBackendTempPlaylistSource;

    const buildPlaylistUrl = () => {
      const baseUrl = isBackendTempPlaylistSource && sourceManifestUrl
        ? sourceManifestUrl
        : recordingId
          ? `${(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "")}/api/live/recordings/v2/${recordingId}/temp/playlist`
          : "";
      if (!baseUrl) return "";

      const currentSegmentIndex = parseSegmentIndexFromKey(currentKeyRef.current);
      if (!Number.isFinite(currentSegmentIndex) || currentSegmentIndex <= 0) {
        return baseUrl;
      }

      const url = new URL(baseUrl, window.location.origin);
      url.searchParams.set(
        "afterIndex",
        String(Math.max(0, currentSegmentIndex - BACK_BUFFER_SEGMENTS)),
      );
      return url.toString();
    };

    const applyPlaylistSegments = (playlistData) => {
      if (!playlistData?.segments?.length) return false;
      const backendRefreshSeconds = Number(playlistData?.refreshSeconds);
      if (Number.isFinite(backendRefreshSeconds) && backendRefreshSeconds >= 0) {
        playlistRefreshSecondsRef.current = backendRefreshSeconds;
      }
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

      const isLive = !isFinishedSource;

      setItems((previousItems) => {
        const merged = mergeManifestItems(
          previousItems,
          playable,
          currentKeyRef.current,
        );

        if (!currentKeyRef.current) {
          const preferredStartIndex = Number(playlistData?.recommendedStartIndex);
          const preferredStartItem = Number.isFinite(preferredStartIndex)
            ? merged.find(
              (item) =>
                item?.kind === "segment" &&
                Number(item?.index) === preferredStartIndex,
            )
            : null;
          const startItem = preferredStartItem || pickInitialPlaybackItem(merged, {
            isLive,
            delaySeconds: source?.delaySeconds,
          });
          const nextKey = startItem?.key || merged[0]?.key || "";
          if (nextKey) {
            currentKeyRef.current = nextKey;
            setCurrentKey(nextKey);
            waitingForNextRef.current = false;
            setWaitingForNext(false);
          }
        } else if (waitingForNextRef.current) {
          // Advance to next segment if one appeared
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
      setManifestStatus(isFinishedSource ? "final" : "");
      setLoading(false);
      setError("");
      return true;
    };

    const tryFetchCdnManifest = async () => {
      if (!sourceManifestUrl) return false;
      const response = await fetch(sourceManifestUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Manifest HTTP ${response.status}`);
      }

      const manifest = await response.json();
      if (cancelled) return true;
      applyManifest(manifest);
      return true;
    };

    const tryFetchBackendPlaylist = async () => {
      if (!recordingId && !isBackendTempPlaylistSource) return false;
      const playlistUrl = buildPlaylistUrl();
      if (!playlistUrl) return false;

      const playlistResponse = await fetch(playlistUrl, {
        cache: "no-store",
      });
      if (!playlistResponse.ok) {
        throw new Error(`Playlist HTTP ${playlistResponse.status}`);
      }

      const playlistData = await playlistResponse.json();
      if (cancelled) return true;
      if (applyPlaylistSegments(playlistData)) {
        return true;
      }
      return false;
    };

    const fetchManifest = async () => {
      try {
        // ALWAYS try backend playlist FIRST — it returns signed
        // download URLs that bypass CDN path/storage-target issues.
        // During live, re-poll every time for new segments.
        let applied = false;
        let lastError = null;

        if (shouldPreferCdnManifest) {
          try {
            applied = await tryFetchCdnManifest();
          } catch (manifestError) {
            lastError = manifestError;
          }
        }

        if (!applied && (recordingId || isBackendTempPlaylistSource)) {
          try {
            applied = await tryFetchBackendPlaylist();
          } catch (playlistError) {
            lastError = playlistError;
          }
        }

        if (!applied) {
          throw lastError || new Error("Khong tai duoc delayed manifest.");
        }
      } catch (fetchError) {
        if (cancelled) return;
        setLoading(false);
        setError(
          fetchError?.message || "Không tải được delayed manifest từ CDN.",
        );
      } finally {
        if (!cancelled) {
          const sourceRefreshSeconds = Number(source?.meta?.refreshSeconds);
          const fallbackRefreshSeconds =
            Number.isFinite(sourceRefreshSeconds) && sourceRefreshSeconds >= 0
              ? sourceRefreshSeconds
              : 4;
          const baseRefreshSeconds = Number.isFinite(
            playlistRefreshSecondsRef.current,
          )
            ? playlistRefreshSecondsRef.current
            : fallbackRefreshSeconds;

          if (waitingForNextRef.current) {
            timerId = window.setTimeout(fetchManifest, 1500);
          } else if (baseRefreshSeconds > 0) {
            timerId = window.setTimeout(
              fetchManifest,
              baseRefreshSeconds * 1000,
            );
          }
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
    playlistRefreshSecondsRef.current =
      Number(source?.meta?.refreshSeconds) >= 0
        ? Number(source?.meta?.refreshSeconds)
        : 4;
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
    showLiveBadge,
    source?.embedUrl,
    source?.disabledReason,
    source?.delaySeconds,
    source?.meta?.refreshSeconds,
    source?.meta?.publicBaseUrl,
    source?.meta?.recordingId,
    source?.meta?.segmentBaseUrl,
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
      {error && manifestStatus === "final" ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
    </>
  );
}
