/* eslint-disable react/prop-types */
import { Box } from "@mui/material";
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
}) {
  if (!source) {
    return null;
  }

  const kind = String(source.kind || "").trim().toLowerCase();
  const ratio = resolveAspectRatio(source?.aspect);
  const key = remountKey || source?.key || source?.embedUrl || source?.openUrl || kind;

  if (kind === "file" || kind === "hls") {
    return (
      <NativeVideoPlayer
        key={key}
        src={source.embedUrl}
        kind={kind}
        fallbackUrl={source.openUrl || source.url || source.embedUrl}
        initialRatio={ratio}
        title={source.label || (kind === "hls" ? "Live stream" : "Video")}
        subtitle={source.providerLabel || ""}
        autoplay={autoplay}
        onEnded={onEnded}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
      />
    );
  }

  if (kind === "delayed_manifest") {
    return (
      <DelayedManifestPlayer
        key={key}
        source={source}
        autoplay={autoplay}
        previewOnlyUntilPlay={previewOnlyUntilPlay}
      />
    );
  }

  if (kind === "iframe_html" && source.embedHtml) {
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
          dangerouslySetInnerHTML={{ __html: source.embedHtml }}
        />
      </AspectMediaFrame>
    );
  }

  if (IFRAME_KINDS.has(kind) && source.embedUrl) {
    return (
      <AspectMediaFrame ratio={ratio} key={key}>
        <iframe
          src={source.embedUrl}
          title={source.label || source.providerLabel || "Video"}
          allow={
            source.allow || "autoplay; encrypted-media; picture-in-picture; fullscreen"
          }
          allowFullScreen
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      </AspectMediaFrame>
    );
  }

  return null;
}
