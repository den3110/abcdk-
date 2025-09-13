// src/screens/PickleBall/match/MatchContent.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Link as MuiLink,
  Button,
  Paper,
  Typography,
  TextField,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import { useSelector } from "react-redux";
import {
  PlayCircle as PlayIcon,
  ContentCopy as ContentCopyIcon,
  OpenInNew as OpenInNewIcon,
  AccessTime as TimeIcon,
} from "@mui/icons-material";
import { depLabel, seedLabel, nameWithNick } from "../TournamentBracket";
import PublicProfileDialog from "../../../components/PublicProfileDialog";

// ---- Sub-component: PlayerLink ----
function PlayerLink({ person, onOpen }) {
  if (!person) return null;

  const uid =
    person?.user?._id ||
    person?.user?.id ||
    person?.user ||
    person?._id ||
    person?.id ||
    null;

  const handleClick = () => {
    if (!uid) return;
    onOpen?.(uid);
  };

  return (
    <MuiLink
      component="button"
      underline="hover"
      onClick={handleClick}
      sx={{
        p: 0,
        m: 0,
        font: "inherit",
        color: "inherit",
        cursor: "pointer",
        "&:hover": { textDecorationColor: "inherit" },
      }}
      title={nameWithNick(person)}
    >
      {nameWithNick(person)}
    </MuiLink>
  );
}

/* ===================== Hooks chống nháy & tiện ích ===================== */
function useDelayedFlag(flag, ms = 250) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let t;
    if (flag) t = setTimeout(() => setShow(true), ms);
    else setShow(false);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return show;
}
function useThrottledStable(
  value,
  { interval = 280, isEqual = (a, b) => a === b } = {}
) {
  const [display, setDisplay] = useState(value ?? null);
  const latestRef = useRef(value);
  const timerRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    latestRef.current = value;
    if (!mountedRef.current) {
      mountedRef.current = true;
      setDisplay(value ?? null);
      return;
    }
    if (isEqual(value, display)) return;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setDisplay(latestRef.current ?? null);
    }, interval);
  }, [value, display, interval, isEqual]);

  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);
  return display;
}
function useShowAfterFetch(m, loading) {
  const [display, setDisplay] = useState(null);
  const shownIdRef = useRef(null);
  const selectedId = m?._id ?? null;

  useEffect(() => {
    if (loading) {
      if (selectedId !== shownIdRef.current) setDisplay(null);
      return;
    }
    setDisplay(m ?? null);
    shownIdRef.current = selectedId;
  }, [selectedId, loading, m]);

  const waitingNewSelection =
    loading || (selectedId && selectedId !== shownIdRef.current);
  return [display, waitingNewSelection];
}

/* ===================== Time helpers & compare ===================== */
function ts(x) {
  if (!x) return 0;
  const d = typeof x === "number" ? new Date(x) : new Date(String(x));
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}
function toDateSafe(x) {
  const t = ts(x);
  return t ? new Date(t) : null;
}
function pickDisplayTime(m) {
  return m?.scheduledAt ?? m?.startedAt ?? m?.assignedAt ?? null;
}
function formatClock(d) {
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const dd = pad(d.getDate());
  const MM = pad(d.getMonth() + 1);
  return `${hh}:${mm} • ${dd}/${MM}`;
}
function isMatchEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a._id !== b._id) return false;
  if (a.status !== b.status) return false;

  const ra = a.rules || {};
  const rb = b.rules || {};
  if ((ra.bestOf ?? 3) !== (rb.bestOf ?? 3)) return false;
  if ((ra.pointsToWin ?? 11) !== (rb.pointsToWin ?? 11)) return false;
  if ((ra.winByTwo ?? false) !== (rb.winByTwo ?? false)) return false;

  const gsA = JSON.stringify(a.gameScores || []);
  const gsB = JSON.stringify(b.gameScores || []);
  if (gsA !== gsB) return false;

  if (ts(a.scheduledAt) !== ts(b.scheduledAt)) return false;
  if (ts(a.startedAt) !== ts(b.startedAt)) return false;
  if (ts(a.assignedAt) !== ts(b.assignedAt)) return false;
  if (ts(a.finishedAt) !== ts(b.finishedAt)) return false;

  const saA = a.seedA ?? null;
  const saB = b.seedA ?? null;
  const sbA = a.seedB ?? null;
  const sbB = b.seedB ?? null;

  const paA = a.pairA?._id ?? a.pairA ?? null;
  const paB = b.pairA?._id ?? b.pairA ?? null;
  const pbA = a.pairB?._id ?? a.pairB ?? null;
  const pbB = b.pairB?._id ?? b.pairB ?? null;

  return saA === saB && sbA === sbB && paA === paB && pbA === pbB;
}
function lastGameScore(gameScores) {
  if (!Array.isArray(gameScores) || !gameScores.length) return { a: 0, b: 0 };
  return gameScores[gameScores.length - 1] || { a: 0, b: 0 };
}
function countGamesWon(gameScores) {
  let A = 0,
    B = 0;
  for (const g of gameScores || []) {
    if ((g?.a ?? 0) > (g?.b ?? 0)) A++;
    else if ((g?.b ?? 0) > (g?.a ?? 0)) B++;
  }
  return { A, B };
}

/* ===================== Stream detect & normalize ===================== */
function safeURL(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
function detectEmbed(url) {
  const u = safeURL(url);
  if (!u) return { kind: "unknown", canEmbed: false, aspect: "16:9" };

  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  let aspect = "16:9"; // default hint

  // YouTube: watch?v=, youtu.be, /live/:id, /shorts/:id, /embed/:id
  const ytId = (() => {
    if (host.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = path.split("/").filter(Boolean);
      if (parts.length >= 2 && ["live", "shorts", "embed"].includes(parts[0])) {
        if (parts[0] === "shorts") aspect = "9:16";
        return parts[1];
      }
    }
    if (host === "youtu.be") {
      return path.replace(/^\/+/, "").split("/")[0];
    }
    return null;
  })();
  if (ytId) {
    return {
      kind: "yt",
      canEmbed: true,
      embedUrl: `https://www.youtube.com/embed/${ytId}`,
      allow:
        "autoplay; encrypted-media; picture-in-picture; web-share; fullscreen",
      aspect,
    };
  }

  // Vimeo
  if (host.includes("vimeo.com")) {
    const m = path.match(/\/(\d+)/);
    if (m?.[1]) {
      return {
        kind: "vimeo",
        canEmbed: true,
        embedUrl: `https://player.vimeo.com/video/${m[1]}`,
        allow: "autoplay; fullscreen; picture-in-picture",
        aspect, // 16:9
      };
    }
  }

  // Twitch
  if (host.includes("twitch.tv")) {
    const parent =
      typeof window !== "undefined" ? window.location.hostname : "localhost";
    const videoMatch = path.match(/\/videos\/(\d+)/);
    if (videoMatch?.[1]) {
      return {
        kind: "twitch",
        canEmbed: true,
        embedUrl: `https://player.twitch.tv/?video=${videoMatch[1]}&parent=${parent}`,
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        aspect,
      };
    }
    const channelMatch = path.split("/").filter(Boolean)[0];
    if (channelMatch) {
      return {
        kind: "twitch",
        canEmbed: true,
        embedUrl: `https://player.twitch.tv/?channel=${channelMatch}&parent=${parent}`,
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        aspect,
      };
    }
  }

  // Facebook
  if (host.includes("facebook.com") || host.includes("fb.watch")) {
    const href = encodeURIComponent(url);
    return {
      kind: "facebook",
      canEmbed: true,
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&width=1280`,
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
      aspect,
    };
  }

  // HLS (.m3u8)
  if (/\.(m3u8)(\?|$)/i.test(u.pathname + u.search)) {
    return { kind: "hls", canEmbed: true, embedUrl: url, aspect };
  }

  // MP4/WebM/OGG
  if (/\.(mp4|webm|ogv?)(\?|$)/i.test(u.pathname)) {
    return { kind: "file", canEmbed: true, embedUrl: url, aspect };
  }

  // Google Drive preview
  if (host.includes("drive.google.com")) {
    const m = url.match(/\/file\/d\/([^/]+)\//);
    if (m?.[1]) {
      return {
        kind: "iframe",
        canEmbed: true,
        embedUrl: `https://drive.google.com/file/d/${m[1]}/preview`,
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        aspect,
      };
    }
  }

  // Mặc định: thử iframe
  return {
    kind: "iframe",
    canEmbed: true,
    embedUrl: url,
    allow: "autoplay; fullscreen; picture-in-picture",
    aspect,
  };
}
function providerLabel(kind, fallback = "Link") {
  switch (kind) {
    case "yt":
      return "YouTube";
    case "vimeo":
      return "Vimeo";
    case "twitch":
      return "Twitch";
    case "facebook":
      return "Facebook";
    case "hls":
      return "HLS";
    case "file":
      return "Video";
    case "iframe":
      return "Embed";
    default:
      return fallback;
  }
}
function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}
function normalizeStreams(m) {
  const out = [];
  const seen = new Set();

  const pushUrl = (url, { label, primary = false } = {}) => {
    if (!isNonEmptyString(url)) return;
    const u = url.trim();
    if (seen.has(u)) return;
    const det = detectEmbed(u);
    out.push({
      label: label || (primary ? "Video" : providerLabel(det.kind, "Link")),
      url: u,
      primary,
      ...det,
    });
    seen.add(u);
  };

  // Ưu tiên: m.video là nguồn chính
  if (isNonEmptyString(m?.video)) pushUrl(m.video, { primary: true });

  // Một số field quen thuộc khác
  const singles = [
    ["Video", m?.videoUrl],
    ["Stream", m?.stream],
    ["Link", m?.link],
    ["URL", m?.url],
    ["Video", m?.meta?.video],
    ["Video", m?.meta?.videoUrl],
    ["Stream", m?.meta?.stream],
    ["Link", m?.links?.video],
    ["Stream", m?.links?.stream],
    ["URL", m?.links?.url],
    ["Video", m?.sources?.video],
    ["Stream", m?.sources?.stream],
    ["URL", m?.sources?.url],
  ];
  for (const [label, val] of singles) {
    if (isNonEmptyString(val)) pushUrl(val, { label });
  }

  // Mảng string
  const asStrArray = (arr) =>
    Array.isArray(arr) ? arr.filter(isNonEmptyString) : [];
  for (const url of asStrArray(m?.videos)) pushUrl(url, { label: "Video" });
  for (const url of asStrArray(m?.links)) pushUrl(url, { label: "Link" });
  for (const url of asStrArray(m?.sources)) pushUrl(url, { label: "Nguồn" });

  // Mảng object { url|href|src, label? }
  const pushList = (list) => {
    for (const it of Array.isArray(list) ? list : []) {
      const url = it?.url || it?.href || it?.src;
      const label = it?.label;
      pushUrl(url, { label });
    }
  };
  pushList(m?.streams);
  pushList(m?.meta?.streams);
  pushList(m?.links?.items);
  pushList(m?.sources?.items);

  return out;
}

/* ===================== AspectBox ===================== */
const supportsAR =
  typeof CSS !== "undefined" && typeof CSS.supports === "function"
    ? CSS.supports("aspect-ratio", "1 / 1")
    : false;

function AspectBox({ ratio = 16 / 9, children }) {
  const pct = ratio > 0 ? (1 / ratio) * 100 : 56.25;
  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        ...(supportsAR ? { aspectRatio: `${ratio}` } : { pt: `${pct}%` }),
        bgcolor: "black",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <Box sx={{ position: "absolute", inset: 0 }}>{children}</Box>
    </Box>
  );
}

/* ===================== HLS loader qua CDN ===================== */
let __hlsLoaderPromise = null;
function loadHlsFromCDN() {
  if (__hlsLoaderPromise) return __hlsLoaderPromise;
  __hlsLoaderPromise = new Promise((resolve, reject) => {
    const exist = document.querySelector("script[data-hlsjs]");
    if (exist) {
      exist.addEventListener("load", () => resolve(window.Hls));
      exist.addEventListener("error", reject);
      if (window.Hls) return resolve(window.Hls);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.16/dist/hls.min.js";
    s.async = true;
    s.defer = true;
    s.setAttribute("data-hlsjs", "1");
    s.onload = () => resolve(window.Hls);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return __hlsLoaderPromise;
}

/* ===================== StreamPlayer ===================== */
function StreamPlayer({ stream }) {
  const videoRef = useRef(null);
  const [hlsError, setHlsError] = useState("");
  const [ratio, setRatio] = useState(
    stream?.aspect === "9:16" ? 9 / 16 : 16 / 9
  );

  useEffect(() => {
    setRatio(stream?.aspect === "9:16" ? 9 / 16 : 16 / 9);
  }, [stream?.aspect, stream?.embedUrl]);

  useEffect(() => {
    setHlsError("");
    if (!stream) return;

    if (stream.kind === "hls" && videoRef.current) {
      const video = videoRef.current;

      const onMeta = () => {
        if (video.videoWidth && video.videoHeight) {
          setRatio(video.videoWidth / video.videoHeight);
        }
      };

      // Safari hỗ trợ HLS native
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = stream.embedUrl;
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        return () => {
          video.removeEventListener("loadedmetadata", onMeta);
        };
      }

      let hls;
      let cancelled = false;

      (async () => {
        try {
          const HlsCtor = await loadHlsFromCDN();
          if (!cancelled && HlsCtor?.isSupported()) {
            hls = new HlsCtor({ enableWorker: true });
            hls.loadSource(stream.embedUrl);
            hls.attachMedia(video);
            video.addEventListener("loadedmetadata", onMeta);
          } else if (!cancelled) {
            setHlsError("Trình duyệt không hỗ trợ HLS.");
          }
        } catch (e) {
          if (!cancelled) setHlsError("Không tải được trình phát HLS (CDN).");
        }
      })();

      return () => {
        cancelled = true;
        try {
          video.removeEventListener("loadedmetadata", onMeta);
          hls?.destroy();
        } catch {}
      };
    }
  }, [stream]);

  if (!stream || !stream.canEmbed) return null;

  switch (stream.kind) {
    case "yt":
    case "vimeo":
    case "twitch":
    case "facebook":
    case "iframe":
      return (
        <AspectBox ratio={ratio}>
          <iframe
            src={stream.embedUrl}
            title="Video"
            allow={stream.allow || "autoplay; fullscreen; picture-in-picture"}
            allowFullScreen
            style={{ width: "100%", height: "100%", border: 0 }}
          />
        </AspectBox>
      );
    case "hls":
      return (
        <>
          <AspectBox ratio={ratio}>
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              style={{ width: "100%", height: "100%" }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) {
                  setRatio(v.videoWidth / v.videoHeight);
                }
              }}
            />
          </AspectBox>
          {hlsError && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {hlsError}{" "}
              <MuiLink href={stream.url} target="_blank" rel="noreferrer">
                Mở link trực tiếp
              </MuiLink>
              .
            </Alert>
          )}
        </>
      );
    case "file":
      return (
        <AspectBox ratio={ratio}>
          <video
            src={stream.embedUrl}
            controls
            autoPlay
            playsInline
            style={{ width: "100%", height: "100%" }}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) {
                setRatio(v.videoWidth / v.videoHeight);
              }
            }}
          />
        </AspectBox>
      );
    default:
      return null;
  }
}

/* ===================== Component chính ===================== */
export default function MatchContent({ m, isLoading, liveLoading }) {
  // ——— hooks cố định ở đầu component ———
  const { userInfo } = useSelector((s) => s.auth || {});
  const roleStr = String(userInfo?.role || "").toLowerCase();
  const roles = new Set(
    [...(userInfo?.roles || []), ...(userInfo?.permissions || [])]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase())
  );

  const isAdmin = !!(
    userInfo?.isAdmin ||
    roleStr === "admin" ||
    roles.has("admin") ||
    roles.has("superadmin") ||
    roles.has("tournament:admin")
  );

  const tour =
    m?.tournament && typeof m.tournament === "object" ? m.tournament : null;

  const ownerId =
    (tour?.owner &&
      (tour.owner._id || tour.owner.id || tour.owner.userId || tour.owner)) ||
    (tour?.createdBy &&
      (tour.createdBy._id ||
        tour.createdBy.id ||
        tour.createdBy.userId ||
        tour.createdBy)) ||
    (tour?.organizer &&
      (tour.organizer._id ||
        tour.organizer.id ||
        tour.organizer.userId ||
        tour.organizer)) ||
    null;

  const managerIds = new Set(
    [
      ...(tour?.managers || []),
      ...(tour?.organizers || []),
      ...(tour?.staff || []),
      ...(tour?.moderators || []),
    ]
      .map((u) =>
        typeof u === "string"
          ? u
          : u?._id || u?.id || u?.userId || u?.uid || u?.email
      )
      .filter(Boolean)
  );

  const canManageFlag =
    m?.permissions?.canManage ||
    tour?.permissions?.canManage ||
    userInfo?.permissions?.includes?.("tournament:manage");

  const isManager = !!(
    tour &&
    (managerIds.has(
      userInfo?._id || userInfo?.id || userInfo?.userId || userInfo?.uid
    ) ||
      ownerId ===
        (userInfo?._id || userInfo?.id || userInfo?.userId || userInfo?.uid) ||
      canManageFlag)
  );

  const canSeeOverlay = isAdmin || isManager;

  // Popup hồ sơ
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState(null);
  const openProfile = (uid) => {
    if (!uid) return;
    const norm = uid?._id || uid?.id || uid?.userId || uid?.uid || uid || null;
    if (norm) {
      setProfileUserId(String(norm));
      setProfileOpen(true);
    }
  };
  const closeProfile = () => setProfileOpen(false);

  // Chống nháy & throttle
  const loading = Boolean(isLoading || liveLoading);
  const [baseMatch, waitingNewSelection] = useShowAfterFetch(m, loading);
  const showSpinnerDelayed = useDelayedFlag(waitingNewSelection, 250);
  const mm = useThrottledStable(baseMatch, {
    interval: 280,
    isEqual: isMatchEqual,
  });

  // Streams: chọn stream hoạt động (primary -> có thể embed -> đầu tiên)
  const streams = normalizeStreams(mm || {});
  const pickInitialIndex = (arr) => {
    if (!arr.length) return -1;
    const primary = arr.findIndex((s) => s.primary);
    if (primary >= 0) return primary;
    const emb = arr.findIndex((s) => s.canEmbed);
    if (emb >= 0) return emb;
    return 0;
  };
  const [activeIdx, setActiveIdx] = useState(pickInitialIndex(streams));
  const [showPlayer, setShowPlayer] = useState(false);

  useEffect(() => {
    setActiveIdx(pickInitialIndex(streams));
    setShowPlayer(false); // đổi trận -> ẩn player mặc định
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mm?._id]);

  const activeStream =
    activeIdx >= 0 && activeIdx < streams.length ? streams[activeIdx] : null;

  // Status & time
  const status = mm?.status || "scheduled";
  const overlayUrl =
    mm?._id && typeof window !== "undefined" && window?.location?.origin
      ? `${window.location.origin}/overlay/score?matchId=${mm._id}&theme=dark&size=md&showSets=1&autoNext=1`
      : "";
  const displayTime = toDateSafe(pickDisplayTime(mm));
  const timeLabel =
    displayTime && status !== "finished"
      ? `Giờ đấu: ${formatClock(displayTime)}`
      : displayTime && status === "finished"
      ? `Bắt đầu: ${formatClock(displayTime)}`
      : null;

  // Flags render
  const showSpinner = waitingNewSelection && showSpinnerDelayed;
  const showError = !waitingNewSelection && !baseMatch;

  /* ===================== RENDER ===================== */
  if (showSpinner) {
    return (
      <Box py={4} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (showError)
    return <Alert severity="error">Không tải được dữ liệu trận.</Alert>;
  if (!mm) return <Box py={2} />;

  const isSingle = String(mm?.tournament?.eventType).toLowerCase() === "single";

  return (
    <Stack spacing={2} sx={{ position: "relative" }}>
      {/* Header trạng thái */}
      <Alert icon={<PlayIcon />} severity="info">
        {status === "live"
          ? streams.length
            ? "Trận đang live — bạn có thể mở liên kết hoặc xem trong nền."
            : "Trận đang live — chưa có link."
          : status === "finished"
          ? streams.length
            ? "Trận đã diễn ra — bạn có thể mở liên kết hoặc xem lại trong nền."
            : "Trận đã diễn ra. Chưa có liên kết video."
          : streams.length
          ? "Trận chưa diễn ra — đã có liên kết sẵn."
          : "Trận chưa diễn ra. Chưa có liên kết video."}
      </Alert>

      {/* Khu video: đúng 2 nút theo yêu cầu */}
      {activeStream && (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {activeStream.canEmbed && (
              <Button
                size="small"
                variant={showPlayer ? "contained" : "outlined"}
                onClick={() => setShowPlayer((v) => !v)}
                startIcon={<PlayIcon />}
              >
                {showPlayer ? "Thu gọn video" : "Xem video trong nền"}
              </Button>
            )}

            <Button
              variant="outlined"
              size="small"
              endIcon={<OpenInNewIcon />}
              component={MuiLink}
              href={activeStream.url}
              target="_blank"
              rel="noreferrer"
              underline="none"
            >
              Mở link trực tiếp
            </Button>
          </Stack>

          {showPlayer && activeStream.canEmbed && (
            <StreamPlayer stream={activeStream} />
          )}
        </Stack>
      )}

      {/* Overlay */}
      {overlayUrl && canSeeOverlay && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Overlay tỉ số trực tiếp
            </Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <TextField
                size="small"
                fullWidth
                value={overlayUrl}
                InputProps={{ readOnly: true }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => navigator.clipboard.writeText(overlayUrl)}
                >
                  Copy link
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<OpenInNewIcon />}
                  component={MuiLink}
                  href={overlayUrl}
                  target="_blank"
                  rel="noreferrer"
                  underline="none"
                  sx={{ color: "white !important" }}
                >
                  Mở overlay
                </Button>
              </Stack>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Mẹo: dán link này vào OBS/StreamYard (Browser Source) để hiển thị
              tỉ số ở góc màn hình.
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Điểm số */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography fontWeight={700} gutterBottom>
          Điểm số
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems="center"
        >
          {/* Đội A */}
          <Box flex={1}>
            <Typography variant="body2" color="text.secondary">
              Đội A
            </Typography>
            {mm?.pairA ? (
              <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
                <PlayerLink person={mm.pairA?.player1} onOpen={openProfile} />
                {!isSingle && mm.pairA?.player2 && (
                  <>
                    {" "}
                    &{" "}
                    <PlayerLink
                      person={mm.pairA.player2}
                      onOpen={openProfile}
                    />
                  </>
                )}
              </Typography>
            ) : (
              <Typography variant="h6">
                {mm?.previousA ? depLabel(mm.previousA) : seedLabel(mm?.seedA)}
              </Typography>
            )}
          </Box>

          {/* Điểm hiện tại */}
          <Box textAlign="center" minWidth={140}>
            {mm?.status === "live" && (
              <Typography variant="caption" color="text.secondary">
                Ván hiện tại
              </Typography>
            )}
            <Typography variant="h4" fontWeight={800}>
              {lastGameScore(mm?.gameScores).a} –{" "}
              {lastGameScore(mm?.gameScores).b}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sets: {countGamesWon(mm?.gameScores).A} –{" "}
              {countGamesWon(mm?.gameScores).B}
            </Typography>
          </Box>

          {/* Đội B */}
          <Box flex={1} textAlign={{ xs: "left", sm: "right" }}>
            <Typography variant="body2" color="text.secondary">
              Đội B
            </Typography>
            {mm?.pairB ? (
              <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
                <PlayerLink person={mm.pairB?.player1} onOpen={openProfile} />
                {!isSingle && mm.pairB?.player2 && (
                  <>
                    {" "}
                    &{" "}
                    <PlayerLink
                      person={mm.pairB.player2}
                      onOpen={openProfile}
                    />
                  </>
                )}
              </Typography>
            ) : (
              <Typography variant="h6">
                {mm?.previousB ? depLabel(mm.previousB) : seedLabel(mm?.seedB)}
              </Typography>
            )}
          </Box>
        </Stack>

        {!!mm?.gameScores?.length && (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Set</TableCell>
                <TableCell align="center">A</TableCell>
                <TableCell align="center">B</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mm.gameScores.map((g, idx) => (
                <TableRow key={idx}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell align="center">{g.a ?? 0}</TableCell>
                  <TableCell align="center">{g.b ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Divider sx={{ my: 2 }} />
        <Stack
          direction="row"
          flexWrap="wrap"
          sx={{ gap: 1, alignItems: "center" }}
        >
          {timeLabel && (
            <Chip size="small" icon={<TimeIcon />} label={timeLabel} />
          )}
          <Chip size="small" label={`BO: ${mm.rules?.bestOf ?? 3}`} />
          <Chip
            size="small"
            label={`Điểm thắng: ${mm.rules?.pointsToWin ?? 11}`}
          />
          {mm.rules?.winByTwo && <Chip size="small" label="Phải chênh 2" />}
          {mm?.liveBy?.name && (
            <Chip size="small" label={`Trọng tài: ${mm.liveBy.name}`} />
          )}
        </Stack>
      </Paper>

      {/* Popup hồ sơ VĐV */}
      <PublicProfileDialog
        open={profileOpen}
        onClose={closeProfile}
        userId={profileUserId}
      />
    </Stack>
  );
}
