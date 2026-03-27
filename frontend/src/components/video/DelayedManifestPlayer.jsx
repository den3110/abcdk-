/* eslint-disable react/prop-types */
import { Alert } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { resolveAspectRatio } from "./AspectMediaFrame";
import NativeVideoPlayer from "./NativeVideoPlayer";

export default function DelayedManifestPlayer({
  source,
  autoplay = true,
  previewOnlyUntilPlay = false,
  useNativeControls = false,
}) {
  const [items, setItems] = useState([]);
  const [currentUrl, setCurrentUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const applyManifest = (manifest) => {
      const segments = Array.isArray(manifest?.segments)
        ? manifest.segments
        : [];
      const playable = segments
        .map((segment) => ({
          key: `segment:${segment?.index ?? ""}`,
          url: typeof segment?.url === "string" ? segment.url.trim() : "",
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
        });
      }

      setItems(playable);
      setCurrentUrl((previousUrl) => {
        if (previousUrl && playable.some((item) => item.url === previousUrl)) {
          return previousUrl;
        }
        return playable[0]?.url || "";
      });
      setLoading(false);

      if (!playable.length) {
        setError(
          source?.disabledReason || "Server 2 dang chuan bi du lieu video.",
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
          fetchError?.message || "Khong tai duoc delayed manifest tu CDN.",
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
    setCurrentUrl("");
    setLoading(true);
    setError("");
    fetchManifest();

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [source?.embedUrl, source?.disabledReason, source?.meta?.refreshSeconds]);

  const handleEnded = useCallback(() => {
    setCurrentUrl((previousUrl) => {
      const currentIndex = items.findIndex((item) => item.url === previousUrl);
      if (currentIndex >= 0 && currentIndex < items.length - 1) {
        return items[currentIndex + 1].url;
      }
      return previousUrl;
    });
  }, [items]);

  if (loading) {
    return <Alert severity="info">Dang tai video tu PickleTour...</Alert>;
  }

  if (!currentUrl) {
    return <Alert severity="info">{error || "Server 2 dang chuan bi."}</Alert>;
  }

  return (
    <>
      <NativeVideoPlayer
        src={currentUrl}
        kind="file"
        fallbackUrl={source?.openUrl || source?.url || currentUrl}
        initialRatio={resolveAspectRatio(source?.aspect)}
        title={source?.label || "Server 2"}
        subtitle={source?.providerLabel || "PickleTour Video"}
        onEnded={handleEnded}
        autoplay={autoplay}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
        useNativeControls={useNativeControls}
      />
      {error ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
    </>
  );
}
