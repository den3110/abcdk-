/* eslint-disable react/prop-types */
import { Box } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import AspectMediaFrame, { resolveAspectRatio } from "./AspectMediaFrame";
import DelayedManifestPlayer from "./DelayedManifestPlayer";
import NativeVideoPlayer from "./NativeVideoPlayer";

const IFRAME_KINDS = new Set([
  "iframe",
  "iframe_html",
  "yt",
  "vimeo",
  "twitch",
  "facebook",
]);

export default function UnifiedStreamPlayer({
  source,
  autoplay = true,
  remountKey = "",
  onEnded,
  previewOnlyUntilPlay = false,
  useNativeControls = false,
}) {
  const resolvedSource = source || null;
  const kind = String(resolvedSource?.kind || "")
    .trim()
    .toLowerCase();
  const delayedManifestUrl =
    typeof resolvedSource?.meta?.delayedManifestUrl === "string"
      ? resolvedSource.meta.delayedManifestUrl.trim()
      : "";
  const [preferDelayedManifestFallback, setPreferDelayedManifestFallback] =
    useState(false);

  useEffect(() => {
    setPreferDelayedManifestFallback(false);
  }, [resolvedSource?.key, resolvedSource?.embedUrl, delayedManifestUrl, kind]);

  const fallbackSource = useMemo(() => {
    if (kind !== "hls" || !preferDelayedManifestFallback || !delayedManifestUrl) {
      return null;
    }
    return {
      ...resolvedSource,
      kind: "delayed_manifest",
      embedUrl: delayedManifestUrl,
      url: delayedManifestUrl,
      playUrl: delayedManifestUrl,
      meta: {
        ...(resolvedSource?.meta || {}),
        hlsUrl:
          typeof resolvedSource?.embedUrl === "string"
            ? resolvedSource.embedUrl.trim()
            : "",
      },
    };
  }, [delayedManifestUrl, kind, preferDelayedManifestFallback, resolvedSource]);

  const handlePlaybackError = useCallback(() => {
    if (kind === "hls" && delayedManifestUrl) {
      setPreferDelayedManifestFallback(true);
    }
  }, [delayedManifestUrl, kind]);
  const ratio = resolveAspectRatio(resolvedSource?.aspect);
  const key =
    remountKey ||
    resolvedSource?.key ||
    resolvedSource?.embedUrl ||
    resolvedSource?.openUrl ||
    kind;

  if (!resolvedSource) {
    return null;
  }

  if (fallbackSource) {
    return (
      <DelayedManifestPlayer
        key={`${key}:delayed-fallback`}
        source={fallbackSource}
        autoplay={autoplay}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
        useNativeControls={useNativeControls}
        showLiveBadge={fallbackSource?.meta?.showLiveBadge !== false}
      />
    );
  }

  if (kind === "file" || kind === "hls") {
    return (
      <NativeVideoPlayer
        key={key}
        src={resolvedSource.embedUrl}
        kind={kind}
        fallbackUrl={
          resolvedSource.openUrl || resolvedSource.url || resolvedSource.embedUrl
        }
        initialRatio={ratio}
        title={resolvedSource.label || (kind === "hls" ? "Live stream" : "Video")}
        subtitle={resolvedSource.providerLabel || ""}
        autoplay={autoplay}
        onEnded={onEnded}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
        useNativeControls={useNativeControls}
        onPlaybackError={handlePlaybackError}
      />
    );
  }

  if (kind === "delayed_manifest") {
    return (
      <DelayedManifestPlayer
        key={key}
        source={resolvedSource}
        autoplay={autoplay}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
        useNativeControls={useNativeControls}
        showLiveBadge={resolvedSource?.meta?.showLiveBadge !== false}
      />
    );
  }

  if (kind === "iframe_html" && resolvedSource.embedHtml) {
    return (
      <AspectMediaFrame ratio={ratio} key={key}>
        <Box
          sx={{
            width: "100%",
            height: "100%",
            "& iframe": {
              width: "100%",
              height: "100%",
              border: 0,
            },
          }}
          dangerouslySetInnerHTML={{ __html: resolvedSource.embedHtml }}
        />
      </AspectMediaFrame>
    );
  }

  if (IFRAME_KINDS.has(kind) && resolvedSource.embedUrl) {
    return (
      <AspectMediaFrame ratio={ratio} key={key}>
        <iframe
          src={resolvedSource.embedUrl}
          title={resolvedSource.label || resolvedSource.providerLabel || "Video"}
          allow={
            resolvedSource.allow ||
            "autoplay; encrypted-media; picture-in-picture; fullscreen"
          }
          allowFullScreen
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      </AspectMediaFrame>
    );
  }

  return null;
}
