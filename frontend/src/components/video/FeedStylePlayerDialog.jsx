import {
  Avatar,
  Box,
  Chip,
  Dialog,
  Divider,
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
import { resolveAspectRatio } from "./AspectMediaFrame";
import UnifiedStreamPlayer from "./UnifiedStreamPlayer";
import VidstackVideoPlayer, {
  supportsVidstackSource,
} from "./VidstackVideoPlayer";

function asTrimmed(value) {
  return String(value || "").trim();
}

const INTERACTIVE_IFRAME_KINDS = new Set([
  "facebook",
  "iframe",
  "iframe_html",
  "twitch",
  "vimeo",
  "yt",
  "youtube",
]);

function isInteractiveIframeSource(source) {
  const kind = asTrimmed(source?.kind).toLowerCase();
  const provider = asTrimmed(source?.provider).toLowerCase();
  return (
    INTERACTIVE_IFRAME_KINDS.has(kind) ||
    INTERACTIVE_IFRAME_KINDS.has(provider)
  );
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

function feedDisplayTime(item) {
  const status = asTrimmed(item?.status).toLowerCase();
  const replayState = asTrimmed(item?.replayState).toLowerCase();
  const isReplay =
    status === "finished" || Boolean(replayState && replayState !== "none");
  const value = isReplay ? item?.finishedAt : item?.updatedAt;
  return value ? relativeTime(value) : statusLabel(item?.status);
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

function scoreInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeGameScores(scores) {
  return (Array.isArray(scores) ? scores : [])
    .map((game) => ({
      a: scoreInt(game?.a ?? game?.A ?? game?.scoreA),
      b: scoreInt(game?.b ?? game?.B ?? game?.scoreB),
    }))
    .filter((game) => Number.isFinite(game.a) && Number.isFinite(game.b));
}

function countSets(games, side) {
  return games.filter((game) =>
    side === "A" ? game.a > game.b : game.b > game.a,
  ).length;
}

function ScoreTeamRow({ name, side, points, sets, winner }) {
  const isWinner = winner === side;
  return (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="center"
      sx={{
        px: 1.25,
        py: 1.15,
        borderRadius: 2,
        bgcolor: isWinner
          ? "rgba(52,211,153,0.13)"
          : "rgba(255,255,255,0.045)",
        border: `1px solid ${
          isWinner ? "rgba(52,211,153,0.32)" : "rgba(255,255,255,0.08)"
        }`,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={{
            color: isWinner ? "#8df0cb" : "rgba(255,255,255,0.54)",
            fontWeight: 800,
            letterSpacing: "0.08em",
          }}
        >
          ĐỘI {side}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "#fff",
            fontWeight: 800,
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {name || "Chưa có đội"}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography
          sx={{
            color: "#fff",
            fontSize: { xs: 36, md: 42 },
            lineHeight: 1,
            fontWeight: 900,
            minWidth: 42,
            textAlign: "center",
          }}
        >
          {points}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: "rgba(255,255,255,0.58)",
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          sets {sets}
        </Typography>
      </Stack>
    </Stack>
  );
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
  const usesInteractiveIframe = isInteractiveIframeSource(resolvedSource);
  const hasNativeMute = Boolean(
    resolvedSource &&
      isNativeKind(resolvedSource.kind, resolvedSource.key || activeStreamKey),
  );
  const playerAspectRatio = resolveAspectRatio(resolvedSource?.aspect);
  const playerObjectFit =
    asTrimmed(item?.preferredObjectFit).toLowerCase() === "contain" ||
    hasNativeMute ||
    usesInteractiveIframe
      ? "contain"
      : "cover";
  const statusMeta = statusTone(item?.status);
  const title = asTrimmed(item?.title) || "PickleTour Live";
  const subtitle =
    asTrimmed(item?.subtitle) ||
    asTrimmed(item?.displayCode) ||
    asTrimmed(item?.tournament?.name) ||
    "PickleTour Live";
  const tournamentName =
    asTrimmed(item?.tournament?.name) || "PickleTour Live";
  const metaText = feedDisplayTime(item);
  const tags = Array.isArray(item?.tags)
    ? item.tags.map(asTrimmed).filter(Boolean).slice(0, 4)
    : [];
  const codeChipLabel = asTrimmed(item?.codeChipLabel);
  const stageChipLabel = asTrimmed(item?.stageChipLabel);
  const posterUrl = asTrimmed(item?.posterUrl || item?.tournament?.image);
  const scoreboard = item?.scoreboard || {};
  const games = normalizeGameScores(scoreboard?.gameScores);
  const currentGame = Number(scoreboard?.currentGame) || games.length || 1;
  const currentScore = games[games.length - 1] || { a: 0, b: 0 };
  const setsA = countSets(games, "A");
  const setsB = countSets(games, "B");
  const teamA = asTrimmed(scoreboard?.teamA) || title.split(/\s+vs\s+/i)[0] || "";
  const teamB =
    asTrimmed(scoreboard?.teamB) ||
    title.split(/\s+vs\s+/i).slice(1).join(" vs ") ||
    "";
  const winner = asTrimmed(scoreboard?.winner).toUpperCase();

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
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background: usesVidstack
              ? "linear-gradient(180deg, rgba(4,8,14,0.12) 0%, rgba(4,8,14,0.04) 24%, rgba(4,8,14,0.1) 48%, rgba(0,0,0,0.42) 76%, rgba(0,0,0,0.78) 100%)"
              : "linear-gradient(180deg, rgba(4,8,14,0.16) 0%, rgba(4,8,14,0.08) 24%, rgba(4,8,14,0.18) 48%, rgba(0,0,0,0.54) 76%, rgba(0,0,0,0.9) 100%)",
          }}
        />

        <IconButton
          onClick={onClose}
          sx={{
            position: "absolute",
            top: { xs: 14, sm: 18 },
            right: { xs: 14, sm: 18 },
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
            zIndex: 2,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            p: { xs: 1.5, sm: 2, md: 3 },
            pt: { xs: 8.5, sm: 8.5, md: 3 },
            pointerEvents: "auto",
          }}
        >
          <Box
            sx={{
              width: "min(1680px, 100%)",
              height: {
                xs: "calc(100dvh - 92px)",
                md: "min(820px, calc(100dvh - 64px))",
              },
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(0, 1fr) minmax(330px, 390px)",
                xl: "minmax(0, 1fr) 420px",
              },
              gap: { xs: 1.5, md: 2 },
              minHeight: 0,
              overflow: { xs: "auto", md: "hidden" },
            }}
          >
            <Stack spacing={1} sx={{ minWidth: 0, minHeight: 0 }}>
              {streams.length > 1 ? (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  flexWrap="nowrap"
                  sx={{
                    overflowX: "auto",
                    pb: 0.25,
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
                            : "rgba(7,12,18,0.72)",
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

              <Box
                sx={{
                  flex: 1,
                  minHeight: { xs: 260, md: 0 },
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  bgcolor: "#000",
                  borderRadius: 2,
                  border: "1px solid rgba(255,255,255,0.1)",
                  boxShadow: "0 18px 60px rgba(0,0,0,0.38)",
                }}
              >
                <Box
                  sx={{
                    width: "100%",
                    height: "100%",
                    aspectRatio: `${playerAspectRatio}`,
                    bgcolor: "#000",
                  }}
                >
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
              </Box>
            </Stack>

            <Stack
              spacing={1.5}
              sx={{
                minWidth: 0,
                minHeight: 0,
                overflow: "auto",
                p: { xs: 1.5, md: 2 },
                borderRadius: 2,
                bgcolor: "rgba(7,12,18,0.74)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 18px 60px rgba(0,0,0,0.32)",
                backdropFilter: "blur(16px)",
                "&::-webkit-scrollbar": { width: 6 },
                "&::-webkit-scrollbar-thumb": {
                  bgcolor: "rgba(255,255,255,0.22)",
                  borderRadius: 999,
                },
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
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{ color: "#fff", fontWeight: 900, lineHeight: 1.15 }}
                  >
                    {tournamentName}
                  </Typography>
                  <Stack direction="row" spacing={0.45} alignItems="center">
                    <AccessTimeRoundedIcon
                      sx={{ fontSize: 13, color: "rgba(255,255,255,0.62)" }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        color: "rgba(255,255,255,0.62)",
                        fontWeight: 700,
                      }}
                    >
                      {metaText}
                    </Typography>
                  </Stack>
                </Box>
              </Stack>

              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={statusLabel(item?.status)}
                  sx={{
                    color: statusMeta.color,
                    bgcolor: statusMeta.background,
                    border: `1px solid ${statusMeta.border}`,
                    fontWeight: 800,
                  }}
                />
                {codeChipLabel ? (
                  <Chip
                    size="small"
                    label={codeChipLabel}
                    sx={{
                      color: "#fff",
                      bgcolor: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.12)",
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
                      bgcolor: "rgba(37,244,238,0.08)",
                      border: "1px solid rgba(37,244,238,0.22)",
                      fontWeight: 800,
                    }}
                  />
                ) : null}
              </Stack>

              <Typography
                variant="h6"
                sx={{
                  color: "#fff",
                  fontWeight: 900,
                  lineHeight: 1.25,
                  fontSize: { xs: 18, md: 20 },
                }}
              >
                {title}
              </Typography>

              <Typography
                variant="body2"
                sx={{ color: "rgba(255,255,255,0.66)", fontWeight: 700 }}
              >
                {subtitle}
              </Typography>

              <Stack spacing={1}>
                <ScoreTeamRow
                  name={teamA}
                  side="A"
                  points={currentScore.a}
                  sets={setsA}
                  winner={winner}
                />
                <ScoreTeamRow
                  name={teamB}
                  side="B"
                  points={currentScore.b}
                  sets={setsB}
                  winner={winner}
                />
              </Stack>

              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 2,
                  bgcolor: "rgba(255,255,255,0.045)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 0.75 }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: "rgba(255,255,255,0.56)",
                      fontWeight: 900,
                      letterSpacing: "0.08em",
                    }}
                  >
                    VÁN {currentGame}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: "rgba(255,255,255,0.56)", fontWeight: 800 }}
                  >
                    Sets {setsA} - {setsB}
                  </Typography>
                </Stack>

                {games.length ? (
                  <Stack spacing={0.5}>
                    {games.map((game, index) => (
                      <Stack
                        key={`game-${index}`}
                        direction="row"
                        alignItems="center"
                        sx={{
                          px: 1,
                          py: 0.75,
                          borderRadius: 1.5,
                          bgcolor:
                            index === games.length - 1
                              ? "rgba(37,244,238,0.08)"
                              : "rgba(255,255,255,0.035)",
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            flex: 1,
                            color: "rgba(255,255,255,0.68)",
                            fontWeight: 800,
                          }}
                        >
                          Ván {index + 1}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ color: "#fff", fontWeight: 900 }}
                        >
                          {game.a} - {game.b}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Typography
                    variant="body2"
                    sx={{ color: "rgba(255,255,255,0.58)" }}
                  >
                    Chưa có điểm cho trận này.
                  </Typography>
                )}
              </Box>

              {scoreboard?.startLabel || scoreboard?.endLabel ? (
                <Stack spacing={0.35}>
                  {scoreboard?.startLabel ? (
                    <Typography
                      variant="caption"
                      sx={{ color: "rgba(255,255,255,0.6)", fontWeight: 700 }}
                    >
                      {scoreboard.startLabel}
                    </Typography>
                  ) : null}
                  {scoreboard?.endLabel ? (
                    <Typography
                      variant="caption"
                      sx={{ color: "rgba(255,255,255,0.6)", fontWeight: 700 }}
                    >
                      {scoreboard.endLabel}
                    </Typography>
                  ) : null}
                </Stack>
              ) : null}

              {tags.length ? (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {tags.map((tag) => (
                    <Typography
                      key={`${asTrimmed(item?._id)}:${tag}`}
                      variant="caption"
                      sx={{ color: "#25f4ee", fontWeight: 900 }}
                    >
                      {tag.startsWith("#") ? tag : `#${tag}`}
                    </Typography>
                  ))}
                </Stack>
              ) : null}

              <Divider sx={{ borderColor: "rgba(255,255,255,0.1)" }} />

              <Stack direction="row" spacing={1.5} alignItems="center">
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
      </Box>
    </Dialog>
  );
}
