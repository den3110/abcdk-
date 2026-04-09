import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import {
  AccessTimeRounded as AccessTimeRoundedIcon,
  ArrowDownwardRounded as ArrowDownwardRoundedIcon,
  CheckCircleRounded as CheckCircleRoundedIcon,
  GridViewRounded as GridViewRoundedIcon,
  InfoOutlined as InfoOutlinedIcon,
  KeyboardArrowDownRounded as KeyboardArrowDownRoundedIcon,
  KeyboardArrowUpRounded as KeyboardArrowUpRoundedIcon,
  OpenInNewRounded as OpenInNewRoundedIcon,
  RefreshRounded as RefreshRoundedIcon,
  VolumeOffRounded as VolumeOffRoundedIcon,
  VolumeUpRounded as VolumeUpRoundedIcon,
} from "@mui/icons-material";

import SEOHead from "../../components/SEOHead";
import ResponsiveMatchViewer from "../PickleBall/match/ResponsiveMatchViewer";
import { UnifiedStreamPlayer } from "../../components/video";
import { useRegisterChatBotPageSnapshot } from "../../context/ChatBotPageContext.jsx";
import {
  useGetLiveFeedProbeQuery,
  useGetLiveFeedQuery,
} from "../../slices/liveApiSlice";

const FEED_LIMIT = 8;
const PTR_THRESHOLD = 80;
const PTR_MAX = 120;
const PLAYER_WINDOW = 1;
const RENDER_WINDOW = 2;

function sid(value) {
  return String(value?._id || value?.id || value || "").trim();
}

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

function extractScoreTuple(score) {
  if (!score || typeof score !== "object") return null;

  const left =
    score.scoreA ??
    score.teamA ??
    score.sideA ??
    score.a ??
    score.left ??
    score.home ??
    null;
  const right =
    score.scoreB ??
    score.teamB ??
    score.sideB ??
    score.b ??
    score.right ??
    score.away ??
    null;

  if (Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return [Number(left), Number(right)];
  }

  return null;
}

function buildGradientSeed(item) {
  const seed = sid(item?._id || item?.tournament?._id || item?.code || "feed");
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

function getFeedTitle(item) {
  const teamA = asTrimmed(item?.teamAName || item?.pairA?.name || "Đội A");
  const teamB = asTrimmed(item?.teamBName || item?.pairB?.name || "Đội B");
  return `${teamA} vs ${teamB}`;
}

function getFeedSubtitle(item) {
  return (
    asTrimmed(item?.displayCode) ||
    asTrimmed(item?.courtLabel) ||
    asTrimmed(item?.tournament?.name) ||
    "PickleTour Live"
  );
}

function buildFeedTags(item, scoreTuple) {
  const tags = [];
  const pushTag = (value) => {
    const normalized = asTrimmed(value);
    if (!normalized) return;
    tags.push(normalized.startsWith("#") ? normalized : `#${normalized}`);
  };

  pushTag(item?.displayCode);
  pushTag(item?.courtLabel);

  if (item?.currentGame > 0) {
    pushTag(`Game ${item.currentGame}`);
  }

  if (scoreTuple) {
    pushTag(`${scoreTuple[0]}-${scoreTuple[1]}`);
  }

  pushTag(statusLabel(item?.status));

  return tags.slice(0, 4);
}

function toUnifiedSource(stream) {
  if (!stream) return null;

  const playUrl = asTrimmed(stream?.playUrl);
  const openUrl = asTrimmed(stream?.openUrl);
  const embedUrl = asTrimmed(stream?.embedUrl);
  const kind = asTrimmed(stream?.kind).toLowerCase();

  return {
    ...stream,
    key: asTrimmed(stream?.key),
    kind,
    label:
      stream?.label || stream?.displayLabel || stream?.providerLabel || "Video",
    displayLabel: stream?.displayLabel || stream?.label || "Video",
    providerLabel: stream?.providerLabel || "",
    embedUrl:
      embedUrl ||
      (kind === "iframe" || kind === "facebook" || kind === "iframe_html"
        ? openUrl || playUrl
        : playUrl || openUrl),
    playUrl: playUrl || embedUrl || openUrl,
    openUrl: openUrl || playUrl || embedUrl,
    url: playUrl || embedUrl || openUrl,
  };
}

function selectFeedSource(item) {
  const streams = Array.isArray(item?.streams) ? item.streams : [];
  const preferredKey = asTrimmed(item?.feedPreferredStreamKey);
  const preferred =
    streams.find((stream) => asTrimmed(stream?.key) === preferredKey) ||
    streams.find(
      (stream) => asTrimmed(stream?.key) === asTrimmed(item?.defaultStreamKey),
    ) ||
    streams[0] ||
    null;
  return toUnifiedSource(preferred);
}

function isInteractiveTarget(target) {
  return Boolean(
    target instanceof Element &&
      target.closest(
        [
          "button",
          "a",
          "input",
          "textarea",
          "select",
          "[role='button']",
          "[data-feed-interactive='true']",
          ".MuiButtonBase-root",
        ].join(","),
      ),
  );
}

function FeedSkeletonCard({ item }) {
  return (
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
          background:
            "linear-gradient(135deg, rgba(13,18,28,0.96) 0%, rgba(22,34,56,0.88) 48%, rgba(9,14,23,0.98) 100%)",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "feed-skeleton-shimmer 1.6s ease-in-out infinite",
          "@keyframes feed-skeleton-shimmer": {
            "0%": { backgroundPosition: "-200% 0" },
            "100%": { backgroundPosition: "200% 0" },
          },
        }}
      />
      <Box sx={{ position: "absolute", top: 18, left: 18, zIndex: 2 }}>
        <Box
          sx={{
            width: 86,
            height: 24,
            borderRadius: 999,
            bgcolor: "rgba(255,255,255,0.12)",
          }}
        />
      </Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-end"
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          px: { xs: 2, sm: 2.5 },
          pb: { xs: 2.2, sm: 2.8 },
        }}
      >
        <Stack spacing={1.2} sx={{ width: "68%", maxWidth: 520 }}>
          <Box sx={{ width: 140, height: 14, borderRadius: 999, bgcolor: "rgba(255,255,255,0.12)" }} />
          <Box sx={{ width: "92%", height: 22, borderRadius: 999, bgcolor: "rgba(255,255,255,0.12)" }} />
          <Box sx={{ width: "76%", height: 22, borderRadius: 999, bgcolor: "rgba(255,255,255,0.12)" }} />
          <Stack direction="row" spacing={1}>
            <Box sx={{ width: 88, height: 12, borderRadius: 999, bgcolor: "rgba(255,255,255,0.1)" }} />
            <Box sx={{ width: 110, height: 12, borderRadius: 999, bgcolor: "rgba(255,255,255,0.1)" }} />
          </Stack>
        </Stack>
        <Stack spacing={1.5} alignItems="center">
          {[0, 1, 2].map((value) => (
            <Stack key={value} spacing={0.75} alignItems="center">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  bgcolor: "rgba(255,255,255,0.12)",
                }}
              />
              <Box sx={{ width: 44, height: 10, borderRadius: 999, bgcolor: "rgba(255,255,255,0.1)" }} />
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

function FeedActionButton({
  icon,
  label,
  disabled = false,
  onClick,
  href,
  component,
  to,
}) {
  return (
    <Stack spacing={0.5} alignItems="center">
      <IconButton
        component={component}
        href={href}
        to={to}
        data-feed-interactive="true"
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

function FeedInfoOverlay({ item, scoreTuple }) {
  const tournamentName = asTrimmed(item?.tournament?.name) || "PickleTour Live";
  const subtitle = getFeedSubtitle(item);
  const title = getFeedTitle(item);
  const tags = useMemo(() => buildFeedTags(item, scoreTuple), [item, scoreTuple]);
  const avatarSrc = asTrimmed(item?.tournament?.image);
  const metaText = item?.updatedAt ? relativeTime(item.updatedAt) : statusLabel(item?.status);

  return (
    <Stack
      spacing={1.15}
      sx={{
        animation: "feed-fade-up 320ms cubic-bezier(0.4, 0, 0.2, 1)",
        "@keyframes feed-fade-up": {
          from: {
            opacity: 0,
            transform: "translateY(16px)",
          },
          to: {
            opacity: 1,
            transform: "translateY(0)",
          },
        },
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Avatar
          src={avatarSrc || undefined}
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

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {tags.map((tag) => (
          <Typography
            key={`${sid(item)}:${tag}`}
            variant="caption"
            sx={{
              color: "#25f4ee",
              fontWeight: 800,
              cursor: "default",
              textShadow: "0 1px 3px rgba(0,0,0,0.55)",
            }}
          >
            {tag}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}

function FeedActionRail({
  item,
  muted,
  onMutedChange,
  onOpenDetail,
  hasNativeMute,
}) {
  return (
    <Stack
      spacing={1.5}
      alignItems="center"
      sx={{
        pointerEvents: "auto",
        pb: 0.5,
        px: 0.5,
      }}
    >
      <FeedActionButton
        icon={<InfoOutlinedIcon />}
        label="Chi tiết"
        onClick={() => onOpenDetail(item)}
      />
      <FeedActionButton
        icon={<OpenInNewRoundedIcon />}
        label="Mở link"
        href={item?.primaryOpenUrl || undefined}
        component="a"
        disabled={!item?.primaryOpenUrl}
      />
      {hasNativeMute ? (
        <FeedActionButton
          icon={muted ? <VolumeOffRoundedIcon /> : <VolumeUpRoundedIcon />}
          label={muted ? "Bật tiếng" : "Tắt tiếng"}
          onClick={() => onMutedChange(!muted)}
        />
      ) : null}
    </Stack>
  );
}

function FeedCard({
  item,
  isActive,
  shouldRenderPlayer,
  muted,
  onMutedChange,
  onOpenDetail,
}) {
  const source = useMemo(() => selectFeedSource(item), [item]);
  const scoreTuple = useMemo(() => extractScoreTuple(item?.score), [item?.score]);
  const hasNativeMute = Boolean(source && isNativeKind(source.kind, source.key));
  const statusMeta = statusTone(item?.status);

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
        background: buildGradientSeed(item),
      }}
    >
      {item?.posterUrl ? (
        <Box
          component="img"
          src={item.posterUrl}
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
          background:
            "linear-gradient(180deg, rgba(4,8,14,0.16) 0%, rgba(4,8,14,0.08) 24%, rgba(4,8,14,0.18) 48%, rgba(0,0,0,0.54) 76%, rgba(0,0,0,0.9) 100%)",
        }}
      />

      {shouldRenderPlayer && source ? (
        <Box sx={{ position: "absolute", inset: 0 }}>
          <UnifiedStreamPlayer
            source={source}
            autoplay={isActive}
            muted={muted}
            onMutedChange={onMutedChange}
            chromeMode="minimal"
            fillContainer
            objectFit="cover"
          />
        </Box>
      ) : null}

      <Box
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
        }}
      />

      <Box
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          pointerEvents: "none",
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="flex-start"
          sx={{
            position: "absolute",
            top: { xs: 16, sm: 18 },
            left: { xs: 16, sm: 18 },
            right: { xs: 16, sm: 18 },
          }}
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
            bottom: { xs: 18, sm: 22 },
          }}
        >
          <Stack
            spacing={1.2}
            sx={{
              flex: 1,
              minWidth: 0,
              pr: 1,
              maxWidth: { xs: "72%", sm: "74%", md: "66%" },
            }}
          >
            <FeedInfoOverlay item={item} scoreTuple={scoreTuple} />
          </Stack>

          <FeedActionRail
            item={item}
            muted={muted}
            onMutedChange={onMutedChange}
            onOpenDetail={onOpenDetail}
            hasNativeMute={hasNativeMute}
          />
        </Stack>
      </Box>

      <Box
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 3,
          zIndex: 4,
          bgcolor: "rgba(255,255,255,0.18)",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            width: isActive ? "100%" : "0%",
            height: "100%",
            background:
              "linear-gradient(90deg, rgba(255,107,87,0.92), rgba(141,240,203,0.92))",
            transition: isActive ? "width 220ms ease" : "none",
          }}
        />
      </Box>
    </Box>
  );
}

export default function LiveFeedPage() {
  const [page, setPage] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [feedVisible, setFeedVisible] = useState(false);
  const [renderedIndices, setRenderedIndices] = useState(
    () => new Set([0, 1, 2]),
  );
  const [hasPendingNewItems, setHasPendingNewItems] = useState(false);
  const [viewerMatch, setViewerMatch] = useState(null);
  const [mutedById, setMutedById] = useState({});
  const [ptrPull, setPtrPull] = useState(0);
  const [ptrLoading, setPtrLoading] = useState(false);
  const [ptrSuccess, setPtrSuccess] = useState(false);
  const [isDraggingUi, setIsDraggingUi] = useState(false);

  const containerRef = useRef(null);
  const animationTimerRef = useRef(null);
  const successTimerRef = useRef(null);
  const wheelTimerRef = useRef(null);
  const dragStartYRef = useRef(null);
  const dragStartXRef = useRef(null);
  const currentDragDeltaRef = useRef(0);
  const isDraggingRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const ptrActiveRef = useRef(false);
  const activeIndexRef = useRef(0);

  const feedArgs = useMemo(
    () => ({
      page,
      limit: FEED_LIMIT,
      mode: "all",
    }),
    [page],
  );
  const probeArgs = useMemo(
    () => ({
      page: 1,
      limit: FEED_LIMIT,
      mode: "all",
    }),
    [],
  );

  const {
    data: feedData,
    isLoading,
    isFetching,
    refetch: refetchFeed,
  } = useGetLiveFeedQuery(feedArgs, {
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
  const { data: probeData, refetch: refetchProbe } = useGetLiveFeedProbeQuery(
    probeArgs,
    {
      pollingInterval: 15000,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    },
  );

  const items = useMemo(
    () => (Array.isArray(feedData?.items) ? feedData.items : []),
    [feedData?.items],
  );
  const liveCount = useMemo(
    () =>
      items.filter((item) => asTrimmed(item?.status).toLowerCase() === "live")
        .length,
    [items],
  );
  const currentItem = items[activeIndex] || items[0] || null;
  const pages = Math.max(1, Number(feedData?.pages || 1));
  const showPtrIndicator = ptrPull > 0 || ptrLoading || ptrSuccess;
  const ptrReady = ptrPull >= PTR_THRESHOLD;

  const clearGestureState = useCallback(() => {
    dragStartYRef.current = null;
    dragStartXRef.current = null;
    currentDragDeltaRef.current = 0;
    isDraggingRef.current = false;
    ptrActiveRef.current = false;
  }, []);

  const getSlideHeight = useCallback(
    () => containerRef.current?.clientHeight ?? window.innerHeight,
    [],
  );

  const setTranslate = useCallback((offsetY, animate) => {
    const inner = containerRef.current?.querySelector("[data-feed-inner='true']");
    if (!inner) return;
    inner.style.transition = animate
      ? "transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
      : "none";
    inner.style.transform = `translate3d(0, ${offsetY}px, 0)`;
  }, []);

  const snapToIndex = useCallback(
    (nextIndex, { animate = true } = {}) => {
      if (!items.length) return;

      const clamped = Math.max(0, Math.min(items.length - 1, nextIndex));
      const slideHeight = getSlideHeight();

      if (animationTimerRef.current) {
        window.clearTimeout(animationTimerRef.current);
      }

      isAnimatingRef.current = animate;
      setTranslate(-clamped * slideHeight, animate);
      setActiveIndex(clamped);
      activeIndexRef.current = clamped;
      setIsDraggingUi(false);

      if (animate) {
        animationTimerRef.current = window.setTimeout(() => {
          isAnimatingRef.current = false;
        }, 380);
      } else {
        isAnimatingRef.current = false;
      }
    },
    [getSlideHeight, items.length, setTranslate],
  );

  const handleResetFeed = useCallback(() => {
    setHasPendingNewItems(false);
    snapToIndex(0);

    if (page !== 1) {
      setPage(1);
    } else {
      refetchFeed();
    }

    refetchProbe();
  }, [page, refetchFeed, refetchProbe, snapToIndex]);

  const triggerRefresh = useCallback(() => {
    if (ptrLoading) return;

    setPtrLoading(true);
    setPtrSuccess(false);
    setPtrPull(0);
    handleResetFeed();

    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
    }

    window.setTimeout(() => {
      setPtrLoading(false);
      setPtrSuccess(true);
      successTimerRef.current = window.setTimeout(() => {
        setPtrSuccess(false);
      }, 1600);
    }, 900);
  }, [handleResetFeed, ptrLoading]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (isLoading && !items.length) {
      setFeedVisible(false);
      return undefined;
    }

    let raf1 = 0;
    let raf2 = 0;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setFeedVisible(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [isLoading, items.length]);

  useEffect(() => {
    if (!items.length) {
      setRenderedIndices(new Set());
      setActiveIndex(0);
      activeIndexRef.current = 0;
      setTranslate(0, false);
      return;
    }

    const clamped = Math.min(activeIndexRef.current, items.length - 1);
    if (clamped !== activeIndexRef.current) {
      setActiveIndex(clamped);
      activeIndexRef.current = clamped;
    }

    setRenderedIndices((previous) => {
      const next = new Set(previous);
      for (
        let index = Math.max(0, clamped - RENDER_WINDOW);
        index <= Math.min(items.length - 1, clamped + RENDER_WINDOW + 1);
        index += 1
      ) {
        next.add(index);
      }
      return next;
    });

    setTranslate(-clamped * getSlideHeight(), false);
  }, [getSlideHeight, items.length, setTranslate]);

  useEffect(() => {
    const probeItems = Array.isArray(probeData?.items) ? probeData.items : [];
    if (!items.length || !probeItems.length) return;

    const currentTopIds = items
      .slice(0, probeItems.length)
      .map((item) => sid(item))
      .join("|");
    const nextTopIds = probeItems.map((item) => sid(item)).join("|");

    if (currentTopIds && nextTopIds && currentTopIds !== nextTopIds) {
      setHasPendingNewItems(true);
    }
  }, [items, probeData?.items]);

  useEffect(() => {
    if (page >= pages || activeIndex < Math.max(0, items.length - 2) || isFetching) {
      return;
    }
    setPage((current) => current + 1);
  }, [activeIndex, isFetching, items.length, page, pages]);

  useEffect(() => {
    const handleResize = () => {
      setTranslate(-activeIndexRef.current * getSlideHeight(), false);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [getSlideHeight, setTranslate]);

  const settleGesture = useCallback(() => {
    if (ptrActiveRef.current) {
      const shouldRefresh = ptrPull >= PTR_THRESHOLD;
      clearGestureState();
      setIsDraggingUi(false);
      if (shouldRefresh) {
        triggerRefresh();
      } else {
        setPtrPull(0);
      }
      return;
    }

    if (dragStartYRef.current === null || !isDraggingRef.current) {
      clearGestureState();
      setIsDraggingUi(false);
      return;
    }

    const delta = currentDragDeltaRef.current;
    const threshold = getSlideHeight() * 0.2;

    if (delta < -threshold) {
      snapToIndex(activeIndexRef.current + 1);
    } else if (delta > threshold) {
      snapToIndex(activeIndexRef.current - 1);
    } else {
      snapToIndex(activeIndexRef.current);
    }

    clearGestureState();
  }, [clearGestureState, getSlideHeight, ptrPull, snapToIndex, triggerRefresh]);

  const handleTouchStart = useCallback(
    (event) => {
      if (
        isAnimatingRef.current ||
        ptrLoading ||
        isInteractiveTarget(event.target)
      ) {
        return;
      }

      const point = event.touches?.[0];
      if (!point) return;

      dragStartYRef.current = point.clientY;
      dragStartXRef.current = point.clientX;
      currentDragDeltaRef.current = 0;
      isDraggingRef.current = false;
      ptrActiveRef.current = false;
    },
    [ptrLoading],
  );

  const handleTouchMove = useCallback(
    (event) => {
      if (dragStartYRef.current === null || !items.length) return;

      const point = event.touches?.[0];
      if (!point) return;

      const deltaY = point.clientY - dragStartYRef.current;
      const deltaX =
        dragStartXRef.current === null
          ? 0
          : Math.abs(point.clientX - dragStartXRef.current);

      if (activeIndexRef.current === 0 && deltaY > 0 && !ptrLoading) {
        if (!isDraggingRef.current && !ptrActiveRef.current) {
          if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > deltaX) {
            ptrActiveRef.current = true;
            setIsDraggingUi(true);
          }
        }

        if (ptrActiveRef.current) {
          event.preventDefault();
          setPtrPull(Math.min(deltaY * 0.5, PTR_MAX));
          return;
        }
      }

      if (!isDraggingRef.current) {
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > deltaX) {
          isDraggingRef.current = true;
          setIsDraggingUi(true);
        } else if (deltaX > Math.abs(deltaY)) {
          clearGestureState();
          return;
        }
      }

      if (isDraggingRef.current) {
        event.preventDefault();
        currentDragDeltaRef.current = deltaY;
        const slideHeight = getSlideHeight();
        const baseOffset = -activeIndexRef.current * slideHeight;
        let resistedDelta = deltaY;

        if (
          (activeIndexRef.current === 0 && deltaY > 0) ||
          (activeIndexRef.current === items.length - 1 && deltaY < 0)
        ) {
          resistedDelta = deltaY * 0.25;
        }

        setTranslate(baseOffset + resistedDelta, false);
      }
    },
    [clearGestureState, getSlideHeight, items.length, ptrLoading, setTranslate],
  );

  const handleMouseDown = useCallback((event) => {
    if (
      event.button !== 0 ||
      isAnimatingRef.current ||
      isInteractiveTarget(event.target)
    ) {
      return;
    }

    dragStartYRef.current = event.clientY;
    dragStartXRef.current = event.clientX;
    currentDragDeltaRef.current = 0;
    isDraggingRef.current = false;
    ptrActiveRef.current = false;
  }, []);

  const handleMouseMove = useCallback(
    (event) => {
      if (dragStartYRef.current === null || event.buttons === 0 || !items.length) {
        return;
      }

      const deltaY = event.clientY - dragStartYRef.current;
      const deltaX =
        dragStartXRef.current === null
          ? 0
          : Math.abs(event.clientX - dragStartXRef.current);

      if (!isDraggingRef.current) {
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > deltaX) {
          isDraggingRef.current = true;
          setIsDraggingUi(true);
        } else if (deltaX > Math.abs(deltaY)) {
          clearGestureState();
          return;
        }
      }

      if (isDraggingRef.current) {
        event.preventDefault();
        currentDragDeltaRef.current = deltaY;
        const slideHeight = getSlideHeight();
        const baseOffset = -activeIndexRef.current * slideHeight;
        let resistedDelta = deltaY;

        if (
          (activeIndexRef.current === 0 && deltaY > 0) ||
          (activeIndexRef.current === items.length - 1 && deltaY < 0)
        ) {
          resistedDelta = deltaY * 0.25;
        }

        setTranslate(baseOffset + resistedDelta, false);
      }
    },
    [clearGestureState, getSlideHeight, items.length, setTranslate],
  );

  const handleWheel = useCallback(
    (event) => {
      if (
        !items.length ||
        isAnimatingRef.current ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) {
        return;
      }

      event.preventDefault();

      if (wheelTimerRef.current) {
        return;
      }

      snapToIndex(activeIndexRef.current + (event.deltaY > 0 ? 1 : -1));
      wheelTimerRef.current = window.setTimeout(() => {
        wheelTimerRef.current = null;
      }, 360);
    },
    [items.length, snapToIndex],
  );

  useEffect(
    () => () => {
      if (animationTimerRef.current) {
        window.clearTimeout(animationTimerRef.current);
      }
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current);
      }
      if (wheelTimerRef.current) {
        window.clearTimeout(wheelTimerRef.current);
      }
    },
    [],
  );

  const handleMutedChange = useCallback((matchId, nextMuted) => {
    const normalizedId = sid(matchId);
    if (!normalizedId) return;
    setMutedById((current) => ({
      ...current,
      [normalizedId]: nextMuted,
    }));
  }, []);

  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "live_feed",
      entityTitle: "Live Feed PickleTour",
      sectionTitle: currentItem?.tournament?.name || "Feed live",
      pageSummary:
        "Feed dọc toàn màn hình cho các trận đang live và các trận xem lại có stream công khai.",
      activeLabels: [
        currentItem?.displayCode || "",
        currentItem?.courtLabel || "",
        hasPendingNewItems ? "Có trận mới" : "",
      ],
      visibleActions: ["Chi tiết", "Mở link", "Xem theo cụm sân"],
      highlights: items
        .slice(Math.max(0, activeIndex), Math.max(0, activeIndex) + 3)
        .map((item) => item?.displayCode || item?.teamAName || "")
        .filter(Boolean),
      metrics: [
        `Đã tải: ${items.length}`,
        `Đang live: ${liveCount}`,
        `Trang: ${Math.min(page, pages)}/${pages}`,
      ],
    }),
    [activeIndex, currentItem, hasPendingNewItems, items, liveCount, page, pages],
  );

  useRegisterChatBotPageSnapshot(chatBotSnapshot);

  return (
    <>
      <SEOHead
        title="PickleTour Live Feed"
        description="Feed live dọc toàn màn hình cho các trận đang phát và các trận xem lại có stream công khai."
        path="/live"
      />

      <Box
        sx={{
          position: "relative",
          height: "100dvh",
          bgcolor: "#03060a",
          color: "#fff",
          overflow: "hidden",
          userSelect: "none",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at top left, rgba(255,107,87,0.14), transparent 28%), radial-gradient(circle at top right, rgba(141,240,203,0.12), transparent 30%)",
            pointerEvents: "none",
          }}
        />

        {isLoading && !items.length ? (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 40,
              pointerEvents: "none",
              opacity: feedVisible ? 0 : 1,
              transition: "opacity 320ms ease",
            }}
          >
            <FeedSkeletonCard item={items[0] || null} />
          </Box>
        ) : null}

        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 25,
            px: { xs: 1.4, sm: 2 },
            pt: { xs: 1.4, sm: 2 },
            pointerEvents: "none",
          }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
            spacing={1}
          >
            <Stack spacing={1} sx={{ pointerEvents: "auto" }}>
              <Chip
                label={`PickleTour Live Feed${liveCount ? ` | ${liveCount} LIVE` : ""}`}
                sx={{
                  alignSelf: "flex-start",
                  color: "#fff",
                  bgcolor: "rgba(6,10,16,0.62)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  backdropFilter: "blur(14px)",
                  fontWeight: 800,
                }}
              />
              {hasPendingNewItems ? (
                <Button
                  data-feed-interactive="true"
                  variant="contained"
                  onClick={handleResetFeed}
                  sx={{
                    alignSelf: "flex-start",
                    borderRadius: 999,
                    textTransform: "none",
                    fontWeight: 800,
                    bgcolor: "#ff6b57",
                    color: "#0b1017",
                    "&:hover": {
                      bgcolor: "#ff7d6d",
                    },
                  }}
                >
                  Có trận mới
                </Button>
              ) : null}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ pointerEvents: "auto" }}>
              <Button
                data-feed-interactive="true"
                component={RouterLink}
                to="/live/clusters"
                startIcon={<GridViewRoundedIcon />}
                sx={{
                  borderRadius: 999,
                  textTransform: "none",
                  fontWeight: 700,
                  color: "#fff",
                  bgcolor: "rgba(6,10,16,0.62)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  backdropFilter: "blur(14px)",
                  "&:hover": {
                    bgcolor: "rgba(18,24,35,0.76)",
                  },
                }}
              >
                Cụm sân
              </Button>
              <IconButton
                data-feed-interactive="true"
                onClick={handleResetFeed}
                sx={{
                  width: 44,
                  height: 44,
                  color: "#fff",
                  bgcolor: "rgba(6,10,16,0.62)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  backdropFilter: "blur(14px)",
                }}
              >
                {isFetching ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <RefreshRoundedIcon />
                )}
              </IconButton>
            </Stack>
          </Stack>
        </Box>

        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 30,
            display: { xs: "flex", md: "none" },
            justifyContent: "center",
            pointerEvents: "none",
            height: showPtrIndicator ? (ptrLoading || ptrSuccess ? 72 : ptrPull) : 0,
            transition: ptrActiveRef.current ? "none" : "height 240ms ease",
            overflow: "hidden",
          }}
        >
          <Stack
            spacing={0.75}
            alignItems="center"
            justifyContent="flex-end"
            sx={{ pt: 1.5, pb: 1.2 }}
          >
            {ptrSuccess ? (
              <>
                <CheckCircleRoundedIcon sx={{ color: "#4ade80" }} />
                <Typography variant="caption" sx={{ color: "#4ade80", fontWeight: 800 }}>
                  Đã làm mới
                </Typography>
              </>
            ) : ptrLoading ? (
              <>
                <CircularProgress size={22} sx={{ color: "#fff" }} />
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.82)", fontWeight: 800 }}>
                  Đang làm mới...
                </Typography>
              </>
            ) : (
              <>
                <ArrowDownwardRoundedIcon
                  sx={{
                    color: ptrReady ? "#4ade80" : "#fff",
                    transform: ptrReady ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 180ms ease",
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    color: ptrReady ? "#4ade80" : "rgba(255,255,255,0.82)",
                    fontWeight: 800,
                  }}
                >
                  {ptrReady ? "Thả để làm mới" : "Kéo xuống để làm mới"}
                </Typography>
              </>
            )}
          </Stack>
        </Box>

        {!isLoading && !items.length ? (
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={2}
            sx={{ minHeight: "100dvh", px: 3, textAlign: "center" }}
          >
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              Chưa có trận để hiển thị
            </Typography>
            <Typography
              variant="body1"
              sx={{ color: "rgba(255,255,255,0.72)", maxWidth: 560 }}
            >
              Khi có trận đang live hoặc video xem lại công khai, feed sẽ tự xuất
              hiện tại đây.
            </Typography>
            <Stack direction="row" spacing={1.25}>
              <Button
                data-feed-interactive="true"
                variant="contained"
                onClick={handleResetFeed}
                sx={{ borderRadius: 999, textTransform: "none", fontWeight: 800 }}
              >
                Làm mới
              </Button>
              <Button
                data-feed-interactive="true"
                component={RouterLink}
                to="/live/clusters"
                variant="outlined"
                sx={{
                  borderRadius: 999,
                  textTransform: "none",
                  fontWeight: 800,
                  color: "#fff",
                  borderColor: "rgba(255,255,255,0.24)",
                }}
              >
                Xem theo cụm sân
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Box
            ref={containerRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={settleGesture}
            onTouchCancel={settleGesture}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={settleGesture}
            onMouseLeave={settleGesture}
            onWheel={handleWheel}
            sx={{
              position: "relative",
              height: "100%",
              overflow: "hidden",
              touchAction: "none",
              cursor: { md: isDraggingUi ? "grabbing" : "grab" },
            }}
          >
            <Stack
              data-feed-inner="true"
              sx={{
                transform: "translate3d(0, 0, 0)",
                willChange: "transform",
                marginTop:
                  showPtrIndicator && !ptrLoading && !ptrSuccess
                    ? `${ptrPull}px`
                    : 0,
                transition: ptrActiveRef.current
                  ? "none"
                  : "margin-top 240ms ease, opacity 320ms ease",
                opacity: feedVisible ? 1 : 0,
              }}
            >
              {items.map((item, index) => {
                const matchId = sid(item) || `feed-item-${index}`;
                const muted = mutedById[matchId] ?? true;
                const shouldRenderCard = renderedIndices.has(index);
                const shouldRenderPlayer =
                  shouldRenderCard &&
                  Math.abs(index - activeIndex) <= PLAYER_WINDOW;

                return (
                  <Box key={matchId} sx={{ width: "100%", height: "100dvh" }}>
                    {shouldRenderCard ? (
                      <FeedCard
                        item={item}
                        isActive={index === activeIndex}
                        shouldRenderPlayer={shouldRenderPlayer}
                        muted={muted}
                        onMutedChange={(nextMuted) =>
                          handleMutedChange(matchId, nextMuted)
                        }
                        onOpenDetail={setViewerMatch}
                      />
                    ) : (
                      <Box
                        sx={{
                          width: "100%",
                          height: "100%",
                          background: buildGradientSeed(item),
                          opacity: 0.18,
                        }}
                      />
                    )}
                  </Box>
                );
              })}
            </Stack>

            {items.length > 1 ? (
              <Stack
                spacing={1}
                sx={{
                  display: { xs: "none", md: "flex" },
                  position: "absolute",
                  top: "50%",
                  right: 20,
                  zIndex: 26,
                  transform: "translateY(-50%)",
                }}
              >
                <IconButton
                  data-feed-interactive="true"
                  onClick={() => snapToIndex(activeIndex - 1)}
                  disabled={activeIndex <= 0}
                  sx={{
                    width: 44,
                    height: 44,
                    color: "#fff",
                    bgcolor: "rgba(255,255,255,0.16)",
                    border: "1px solid rgba(255,255,255,0.16)",
                    backdropFilter: "blur(12px)",
                    "&.Mui-disabled": {
                      color: "rgba(255,255,255,0.34)",
                    },
                  }}
                >
                  <KeyboardArrowUpRoundedIcon />
                </IconButton>
                <IconButton
                  data-feed-interactive="true"
                  onClick={() => snapToIndex(activeIndex + 1)}
                  disabled={activeIndex >= items.length - 1}
                  sx={{
                    width: 44,
                    height: 44,
                    color: "#fff",
                    bgcolor: "rgba(255,255,255,0.16)",
                    border: "1px solid rgba(255,255,255,0.16)",
                    backdropFilter: "blur(12px)",
                    "&.Mui-disabled": {
                      color: "rgba(255,255,255,0.34)",
                    },
                  }}
                >
                  <KeyboardArrowDownRoundedIcon />
                </IconButton>
              </Stack>
            ) : null}

            {items.length ? (
              <Chip
                label={`${Math.min(activeIndex + 1, items.length)} / ${items.length}`}
                sx={{
                  display: { xs: "none", md: "inline-flex" },
                  position: "absolute",
                  top: 74,
                  right: 20,
                  zIndex: 26,
                  color: "rgba(255,255,255,0.82)",
                  bgcolor: "rgba(6,10,16,0.62)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  backdropFilter: "blur(12px)",
                  fontWeight: 800,
                }}
              />
            ) : null}
          </Box>
        )}
      </Box>

      <ResponsiveMatchViewer
        open={Boolean(viewerMatch)}
        matchId={viewerMatch?._id || ""}
        courtStationId={viewerMatch?.courtStationId || ""}
        initialMatch={viewerMatch || null}
        onClose={() => setViewerMatch(null)}
        zIndex={1700}
      />
    </>
  );
}
