import {
  Avatar,
  Box,
  Chip,
  Dialog,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import {
  AccessTimeRounded as AccessTimeRoundedIcon,
  CloseRounded as CloseRoundedIcon,
  OpenInNewRounded as OpenInNewRoundedIcon,
  VolumeOffRounded as VolumeOffRoundedIcon,
  VolumeUpRounded as VolumeUpRoundedIcon,
} from "@mui/icons-material";
import UnifiedStreamPlayer from "./UnifiedStreamPlayer";
import VidstackVideoPlayer, {
  supportsVidstackSource,
} from "./VidstackVideoPlayer";

function asTrimmed(value) {
  return String(value || "").trim();
}

function isNativeKind(kind, key = "") {
  if (asTrimmed(key).toLowerCase() === "server2") return true;
  return ["file", "hls", "delayed_manifest"].includes(
    asTrimmed(kind).toLowerCase(),
  );
}

function relativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Math.max(0, Date.now() - date.getTime());
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec} giây trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} giờ trước`;
  const day = Math.floor(hour / 24);
  return `${day} ngày trước`;
}

function statusLabel(status) {
  switch (asTrimmed(status).toLowerCase()) {
    case "live":
      return "Đang live";
    case "assigned":
      return "Đã gán sân";
    case "queued":
      return "Chờ vào sân";
    case "finished":
      return "Xem lại";
    default:
      return status || "Đang chờ";
  }
}

function statusTone(status) {
  switch (asTrimmed(status).toLowerCase()) {
    case "live":
      return {
        color: "#ff6b57",
        background: "rgba(255,107,87,0.18)",
        border: "rgba(255,107,87,0.38)",
      };
    case "finished":
      return {
        color: "#8df0cb",
        background: "rgba(52,211,153,0.16)",
        border: "rgba(52,211,153,0.34)",
      };
    default:
      return {
        color: "#f6d365",
        background: "rgba(246,211,101,0.16)",
        border: "rgba(246,211,101,0.3)",
      };
  }
}

function buildGradientSeed(item) {
  const seed = asTrimmed(item?._id || item?.tournament?._id || item?.code || "feed");
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const secondaryHue = (hue + 54) % 360;
  return `linear-gradient(145deg, hsl(${hue} 72% 28%) 0%, hsl(${secondaryHue} 74% 12%) 55%, hsl(${(secondaryHue + 28) % 360} 64% 10%) 100%)`;
}

function buildInitials(value) {
  const text = asTrimmed(value);
  if (!text) return "PT";

  const parts = text
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return "PT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function RailButton({
  icon,
  label,
  disabled = false,
  onClick,
  href,
}) {
  return (
    <Stack spacing={0.5} alignItems="center">
      <IconButton
        component={href ? "a" : "button"}
        href={href || undefined}
        target={href ? "_blank" : undefined}
        rel={href ? "noreferrer" : undefined}
        disabled={disabled}
        onClick={onClick}
        sx={{
          width: 52,
          height: 52,
          color: "#fff",
          bgcolor: "rgba(255,255,255,0.14)",
          border: "1px solid rgba(255,255,255,0.16)",
          backdropFilter: "blur(14px)",
          transition: "transform 150ms ease, background-color 180ms ease",
          "&:hover": {
            bgcolor: "rgba(255,255,255,0.22)",
            transform: "scale(1.06)",
          },
          "&:active": {
            transform: "scale(0.9)",
          },
        }}
      >
        {icon}
      </IconButton>
      <Typography
        variant="caption"
        sx={{
          color: "rgba(255,255,255,0.88)",
          fontWeight: 700,
          letterSpacing: "0.01em",
          textShadow: "0 1px 2px rgba(0,0,0,0.7)",
        }}
      >
        {label}
      </Typography>
    </Stack>
  );
}

export default function FeedStylePlayerDialog({
  open,
  onClose,
  item,
  source,
  streams = [],
  activeStreamKey = "",
  onSelectStream,
  muted = true,
  onMutedChange,
}) {
  const resolvedSource = source || null;
  const openHref = asTrimmed(
    item?.primaryOpenUrl ||
      resolvedSource?.openUrl ||
      resolvedSource?.url ||
      resolvedSource?.playUrl,
  );
  const useNativeControls = Boolean(
    item?.useNativeControls || resolvedSource?.meta?.useNativeControls,
  );
  const usesVidstack = supportsVidstackSource(resolvedSource);
  const hasNativeMute = Boolean(
    resolvedSource &&
      isNativeKind(resolvedSource.kind, resolvedSource.key || activeStreamKey),
  );
  const playerObjectFit =
    asTrimmed(item?.preferredObjectFit).toLowerCase() === "contain" ||
    hasNativeMute
      ? "contain"
      : "cover";
  const closeButtonRight = usesVidstack
    ? { xs: 72, sm: 84 }
    : { xs: 14, sm: 18 };
  const topOverlayRight = usesVidstack
    ? { xs: 128, sm: 140 }
    : { xs: 72, sm: 84 };
  const bottomOffset = usesVidstack
    ? { xs: 104, sm: 118 }
    : useNativeControls
      ? { xs: 82, sm: 90 }
      : { xs: 18, sm: 22 };
  const statusMeta = statusTone(item?.status);
  const title = asTrimmed(item?.title) || "PickleTour Live";
  const subtitle =
    asTrimmed(item?.subtitle) ||
    asTrimmed(item?.displayCode) ||
    asTrimmed(item?.tournament?.name) ||
    "PickleTour Live";
  const tournamentName =
    asTrimmed(item?.tournament?.name) || "PickleTour Live";
  const metaText = item?.updatedAt
    ? relativeTime(item.updatedAt)
    : statusLabel(item?.status);
  const tags = Array.isArray(item?.tags)
    ? item.tags.map(asTrimmed).filter(Boolean).slice(0, 4)
    : [];
  const codeChipLabel = asTrimmed(item?.codeChipLabel);
  const stageChipLabel = asTrimmed(item?.stageChipLabel);
  const posterUrl = asTrimmed(item?.posterUrl || item?.tournament?.image);

  if (!open || !resolvedSource) {
    return null;
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: "#03060a",
        },
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: "100dvh",
          overflow: "hidden",
          background: buildGradientSeed(item),
        }}
      >
        {posterUrl ? (
          <Box
            component="img"
            src={posterUrl}
            alt=""
            sx={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scale(1.03)",
              filter: "saturate(1.06)",
            }}
          />
        ) : null}

        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background: usesVidstack
              ? "linear-gradient(180deg, rgba(4,8,14,0.12) 0%, rgba(4,8,14,0.04) 24%, rgba(4,8,14,0.1) 48%, rgba(0,0,0,0.42) 76%, rgba(0,0,0,0.78) 100%)"
              : "linear-gradient(180deg, rgba(4,8,14,0.16) 0%, rgba(4,8,14,0.08) 24%, rgba(4,8,14,0.18) 48%, rgba(0,0,0,0.54) 76%, rgba(0,0,0,0.9) 100%)",
          }}
        />

        <Box sx={{ position: "absolute", inset: 0 }}>
          {usesVidstack ? (
            <VidstackVideoPlayer
              source={resolvedSource}
              title={title}
              status={item?.status}
              poster={posterUrl}
              autoplay
              muted={muted}
              onMutedChange={onMutedChange}
              objectFit={playerObjectFit}
            />
          ) : (
            <UnifiedStreamPlayer
              source={resolvedSource}
              autoplay
              useNativeControls={useNativeControls}
              muted={muted}
              onMutedChange={onMutedChange}
              chromeMode="minimal"
              fillContainer
              objectFit={playerObjectFit}
            />
          )}
        </Box>

        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            pointerEvents:
              usesVidstack || useNativeControls ? "none" : "auto",
          }}
        />

        <IconButton
          onClick={onClose}
          sx={{
            position: "absolute",
            top: { xs: 14, sm: 18 },
            right: closeButtonRight,
            zIndex: 5,
            width: 46,
            height: 46,
            color: "#fff",
            bgcolor: "rgba(7,12,18,0.56)",
            border: "1px solid rgba(255,255,255,0.14)",
            backdropFilter: "blur(12px)",
            pointerEvents: "auto",
            "&:hover": {
              bgcolor: "rgba(7,12,18,0.72)",
            },
          }}
        >
          <CloseRoundedIcon />
        </IconButton>

        <Box
          sx={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            pointerEvents: "none",
          }}
        >
          <Stack
            spacing={1.1}
            sx={{
              position: "absolute",
              top: { xs: 16, sm: 18 },
              left: { xs: 16, sm: 18 },
              right: topOverlayRight,
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="flex-start"
              useFlexGap
              flexWrap="wrap"
              sx={{ pointerEvents: "auto" }}
            >
              <Chip
                size="small"
                label={statusLabel(item?.status)}
                sx={{
                  color: statusMeta.color,
                  bgcolor: statusMeta.background,
                  border: `1px solid ${statusMeta.border}`,
                  fontWeight: 800,
                  letterSpacing: "0.03em",
                  backdropFilter: "blur(10px)",
                }}
              />
              {codeChipLabel ? (
                <Chip
                  size="small"
                  label={codeChipLabel}
                  sx={{
                    color: "#fff",
                    bgcolor: "rgba(7,12,18,0.56)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    backdropFilter: "blur(10px)",
                    fontWeight: 800,
                  }}
                />
              ) : null}
              {stageChipLabel ? (
                <Chip
                  size="small"
                  label={stageChipLabel}
                  sx={{
                    color: "#25f4ee",
                    bgcolor: "rgba(7,12,18,0.56)",
                    border: "1px solid rgba(37,244,238,0.24)",
                    backdropFilter: "blur(10px)",
                    fontWeight: 800,
                  }}
                />
              ) : null}
            </Stack>

            {streams.length > 1 ? (
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                flexWrap="nowrap"
                sx={{
                  overflowX: "auto",
                  pb: 0.25,
                  pointerEvents: "auto",
                  "&::-webkit-scrollbar": { display: "none" },
                  scrollbarWidth: "none",
                }}
              >
                {streams.map((stream) => {
                  const streamKey = asTrimmed(stream?.key || stream?.url);
                  const selected = streamKey === asTrimmed(activeStreamKey);
                  return (
                    <Chip
                      key={streamKey}
                      clickable
                      onClick={() => onSelectStream?.(streamKey)}
                      label={stream?.label || stream?.displayLabel || "Video"}
                      sx={{
                        color: selected ? "#0a1016" : "#fff",
                        bgcolor: selected
                          ? "rgba(141,240,203,0.92)"
                          : "rgba(7,12,18,0.56)",
                        border: selected
                          ? "1px solid rgba(141,240,203,0.92)"
                          : "1px solid rgba(255,255,255,0.14)",
                        backdropFilter: "blur(10px)",
                        fontWeight: 800,
                      }}
                    />
                  );
                })}
              </Stack>
            ) : null}
          </Stack>

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-end"
            spacing={1.25}
            sx={{
              position: "absolute",
              left: { xs: 16, sm: 18 },
              right: { xs: 10, sm: 16 },
              bottom: bottomOffset,
            }}
          >
            <Stack
              spacing={1.15}
              sx={{
                flex: 1,
                minWidth: 0,
                pr: 1,
                maxWidth: { xs: "72%", sm: "74%", md: "66%" },
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Avatar
                  src={posterUrl || undefined}
                  alt={tournamentName}
                  sx={{
                    width: 42,
                    height: 42,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#fff",
                    border: "2px solid rgba(37,244,238,0.92)",
                    background: buildGradientSeed(item),
                  }}
                >
                  {buildInitials(tournamentName)}
                </Avatar>

                <Stack spacing={0.2} sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "#fff",
                      fontWeight: 800,
                      lineHeight: 1.1,
                      textShadow: "0 1px 4px rgba(0,0,0,0.5)",
                    }}
                  >
                    {tournamentName}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "rgba(255,255,255,0.72)",
                      maxWidth: { xs: "46vw", sm: "30vw" },
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {subtitle}
                  </Typography>
                </Stack>

                <Stack
                  direction="row"
                  spacing={0.45}
                  alignItems="center"
                  sx={{ color: "rgba(255,255,255,0.62)", minWidth: 0 }}
                >
                  <AccessTimeRoundedIcon sx={{ fontSize: 13 }} />
                  <Typography
                    variant="caption"
                    sx={{
                      color: "inherit",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {metaText}
                  </Typography>
                </Stack>
              </Stack>

              <Typography
                variant="body1"
                sx={{
                  color: "#fff",
                  fontWeight: 700,
                  lineHeight: 1.4,
                  fontSize: { xs: 14, sm: 15 },
                  textShadow: "0 1px 4px rgba(0,0,0,0.6)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  maxWidth: { xs: "100%", sm: "90%" },
                }}
              >
                {title}
              </Typography>

              {tags.length ? (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {tags.map((tag) => (
                    <Typography
                      key={`${asTrimmed(item?._id)}:${tag}`}
                      variant="caption"
                      sx={{
                        color: "#25f4ee",
                        fontWeight: 800,
                        cursor: "default",
                        textShadow: "0 1px 3px rgba(0,0,0,0.55)",
                      }}
                    >
                      {tag.startsWith("#") ? tag : `#${tag}`}
                    </Typography>
                  ))}
                </Stack>
              ) : null}
            </Stack>

            <Stack
              spacing={1.5}
              alignItems="center"
              sx={{
                pointerEvents: "auto",
                pb: 0.5,
                px: 0.5,
              }}
            >
              <RailButton
                icon={<OpenInNewRoundedIcon />}
                label="Mở link"
                href={openHref || undefined}
                disabled={!openHref}
              />
              {hasNativeMute && !usesVidstack ? (
                <RailButton
                  icon={
                    muted ? <VolumeOffRoundedIcon /> : <VolumeUpRoundedIcon />
                  }
                  label={muted ? "Bật tiếng" : "Tắt tiếng"}
                  onClick={() => onMutedChange?.(!muted)}
                />
              ) : null}
            </Stack>
          </Stack>
        </Box>
      </Box>
    </Dialog>
  );
}
