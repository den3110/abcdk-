// src/screens/PickleBall/match/MatchContent.jsx
/* eslint-disable react/prop-types */
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
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
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  InputAdornment,
  Skeleton,
} from "@mui/material";
import { useSelector } from "react-redux";
import {
  PlayCircle as PlayIcon,
  ContentCopy as ContentCopyIcon,
  OpenInNew as OpenInNewIcon,
  AccessTime as TimeIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  CheckCircle as WinIcon,
  Flag as StatusIcon,
  Undo as UndoIcon,
  Group as GroupIcon,
  Search as SearchIcon,
  SwapHoriz as SwapIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";
import { depLabel, seedLabel, nameWithNick } from "../TournamentBracket";
import PublicProfileDialog from "../../../components/PublicProfileDialog";
import { UnifiedStreamPlayer } from "../../../components/video";
import { useAdminPatchMatchMutation } from "../../../slices/matchesApiSlice";
import { useLocation, useParams } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import {
  useLazySearchRegistrationsQuery,
  useVerifyManagerQuery,
  useListTournamentBracketsQuery,
  useListTournamentMatchesQuery,
} from "../../../slices/tournamentsApiSlice";
import { useSocket } from "../../../context/SocketContext";
import MatchRowActions from "../../../components/MatchRowActions";
import {
  getTournamentNameDisplayMode,
  getTournamentPairName,
} from "../../../utils/tournamentName";

/* ====================== utils ====================== */
const sid = (x) => {
  if (!x) return "";
  const v = x?._id ?? x?.id ?? x;
  return v ? String(v) : "";
};
const getMatchIdFromPayload = (payload = {}) =>
  sid(payload.matchId) ||
  sid(payload.match) ||
  sid(payload.id) ||
  sid(payload._id) ||
  sid(payload?.data?.matchId) ||
  sid(payload?.data?.match) ||
  sid(payload?.snapshot?._id) ||
  "";

const isSameId = (a, b) => a && b && String(a) === String(b);

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
  if ((a.video || "") !== (b.video || "")) return false;
  if ((a.videoUrl || "") !== (b.videoUrl || "")) return false;
  if ((a.defaultStreamKey || "") !== (b.defaultStreamKey || "")) return false;

  const ra = a.rules || {};
  const rb = b.rules || {};
  if ((ra.bestOf ?? 3) !== (rb.bestOf ?? 3)) return false;
  if ((ra.pointsToWin ?? 11) !== (rb.pointsToWin ?? 11)) return false;
  if ((ra.winByTwo ?? false) !== (rb.winByTwo ?? false)) return false;

  const gsA = JSON.stringify(a.gameScores || []);
  const gsB = JSON.stringify(b.gameScores || []);
  if (gsA !== gsB) return false;

  const streamFingerprint = (match) => {
    const canonical = Array.isArray(match?.streams)
      ? match.streams.map((stream, index) => ({
          key:
            stream?.key ||
            stream?.playUrl ||
            stream?.openUrl ||
            stream?.url ||
            `idx:${index}`,
          ready: stream?.ready,
          status: stream?.status || "",
        }))
      : [];
    if (canonical.length) return JSON.stringify(canonical);

    const legacyList = [
      ...(Array.isArray(match?.meta?.streams) ? match.meta.streams : []),
      ...(Array.isArray(match?.links?.items) ? match.links.items : []),
      ...(Array.isArray(match?.sources?.items) ? match.sources.items : []),
    ].map(
      (stream, index) =>
        stream?.url ||
        stream?.href ||
        stream?.src ||
        stream?.playUrl ||
        stream?.openUrl ||
        `idx:${index}`,
    );

    return JSON.stringify(legacyList);
  };

  if (streamFingerprint(a) !== streamFingerprint(b)) return false;

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

/* ====================== current V helpers (label fix) ====================== */
function extractCurrentV(m) {
  const tryStrings = [
    m?.code,
    m?.name,
    m?.label,
    m?.displayCode,
    m?.displayName,
    m?.matchCode,
    m?.slotCode,
    m?.bracketCode,
    m?.bracketLabel,
    m?.meta?.code,
    m?.meta?.label,
  ];
  for (const s of tryStrings) {
    if (typeof s === "string") {
      const k = s.match(/\bV(\d+)-T(\d+)\b/i);
      if (k) return parseInt(k[1], 10);
    }
  }
  const nums = [m?.v, m?.V, m?.roundV, m?.meta?.v]
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  return nums.length ? nums[0] : null;
}
function smartDepLabel(m, prevDep) {
  const raw = depLabel(prevDep);
  const currV = extractCurrentV(m);
  return String(raw).replace(/\b([WL])-V(\d+)-T(\d+)\b/gi, (_s, wl, v, t) => {
    const pv = parseInt(v, 10);
    const newV =
      currV != null
        ? Math.max(1, currV - 1)
        : m?.prevBracket?.type !== "group"
          ? pv + 2
          : pv + 1;
    return `${wl}-V${newV}-T${t}`;
  });
}

/* ====================== Group completion helpers (KO gating) ====================== */
const _norm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

function buildGroupIndexLocal(bracket) {
  const byRegId = new Map();
  (bracket?.groups || []).forEach((g) => {
    (g?.regIds || []).forEach((rid) => {
      if (rid)
        byRegId.set(String(rid), String(g.name || g.code || g._id || ""));
    });
  });
  return { byRegId };
}
function makeMatchGroupLabelFnFor(bracket) {
  const { byRegId } = buildGroupIndexLocal(bracket || {});
  return (m) => {
    const aId = m?.pairA?._id && String(m.pairA._id);
    const bId = m?.pairB?._id && String(m.pairB._id);
    const ga = aId && byRegId.get(aId);
    const gb = bId && byRegId.get(bId);
    const key = ga && gb && ga === gb ? ga : null;
    return key ? String(key) : null;
  };
}
function expectedRRMatchesLocal(bracket, g) {
  const n =
    (Array.isArray(g?.regIds) ? g.regIds.length : 0) ||
    Number(g?.expectedSize ?? bracket?.config?.roundRobin?.groupSize ?? 0) ||
    0;
  const roundsPerPair =
    Number(bracket?.config?.roundRobin?.roundsPerPair ?? 1) || 1;
  if (n < 2) return 0;
  return ((n * (n - 1)) / 2) * roundsPerPair;
}

/* ====================== stream helpers ====================== */
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
  let aspect = "16:9";

  // YouTube
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
        aspect,
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

  if (/\/api\/live\/recordings\/v2\/[^/]+\/(?:play|raw)(?:\?|$)/i.test(url)) {
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
function isFacebookUrl(url) {
  const u = safeURL(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return host.includes("facebook.com") || host.includes("fb.watch");
}
function normalizeStreams(m) {
  const out = [];
  const seen = new Set();
  const defaultStreamKey =
    typeof m?.defaultStreamKey === "string" ? m.defaultStreamKey.trim() : "";

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

  const pushCanonicalStream = (stream) => {
    const playUrl = isNonEmptyString(stream?.playUrl)
      ? stream.playUrl.trim()
      : "";
    if (!playUrl) return false;
    const dedupeKey =
      stream?.key && typeof stream.key === "string"
        ? `key:${stream.key}`
        : `url:${playUrl}`;
    if (seen.has(dedupeKey) || seen.has(playUrl)) return true;

    const kind = String(stream?.kind || "")
      .trim()
      .toLowerCase();
    const det =
      kind === "delayed_manifest"
        ? {
            kind: "delayed_manifest",
            canEmbed: true,
            embedUrl: playUrl,
            aspect: "16:9",
          }
        : detectEmbed(playUrl);
    out.push({
      key: stream?.key || null,
      label:
        stream?.displayLabel ||
        stream?.label ||
        providerLabel(det.kind, "Link"),
      url: playUrl,
      openUrl:
        typeof stream?.openUrl === "string" && stream.openUrl.trim()
          ? stream.openUrl.trim()
          : "",
      primary:
        Boolean(stream?.primary) ||
        (defaultStreamKey && String(stream?.key || "") === defaultStreamKey),
      providerLabel: stream?.providerLabel || providerLabel(det.kind, "Link"),
      delaySeconds: Number(stream?.delaySeconds || 0),
      ready: stream?.ready !== false,
      disabledReason:
        typeof stream?.disabledReason === "string" ? stream.disabledReason : "",
      status: typeof stream?.status === "string" ? stream.status : "",
      meta: stream?.meta || {},
      ...det,
    });
    seen.add(dedupeKey);
    seen.add(playUrl);
    return true;
  };

  const canonicalStreams = Array.isArray(m?.streams)
    ? m.streams.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          (isNonEmptyString(item?.playUrl) || isNonEmptyString(item?.openUrl)),
      )
    : [];
  if (canonicalStreams.length > 0) {
    canonicalStreams
      .slice()
      .sort((a, b) => Number(a?.priority || 99) - Number(b?.priority || 99))
      .forEach((stream) => {
        pushCanonicalStream(stream);
      });
    return out;
  }

  const fb = m?.facebookLive || {};
  const normalizedMatchStatus = String(m?.status || "")
    .trim()
    .toLowerCase();
  const normalizedFbStatus = String(fb?.status || "")
    .trim()
    .toLowerCase();
  const finishedLike =
    ["finished", "ended", "stopped"].includes(normalizedMatchStatus) ||
    ["finished", "ended", "stopped"].includes(normalizedFbStatus);
  const primaryVideo = isNonEmptyString(m?.video) ? m.video.trim() : "";
  const preferFinishedFacebookVideo =
    finishedLike &&
    isFacebookUrl(primaryVideo) &&
    isNonEmptyString(fb?.video_permalink_url) &&
    fb.video_permalink_url.trim() !== primaryVideo;

  if (preferFinishedFacebookVideo) {
    pushUrl(fb.video_permalink_url, {
      label: "Facebook Video",
      primary: true,
    });
  }
  if (primaryVideo)
    pushUrl(primaryVideo, { primary: !preferFinishedFacebookVideo });
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
  for (const [label, val] of singles) pushUrl(val, { label });

  const facebookSingles = finishedLike
    ? [
        ["Facebook Video", fb?.video_permalink_url],
        ["Facebook Watch", fb?.watch_url],
        ["Facebook Live", fb?.permalink_url],
        ["Facebook Raw", fb?.raw_permalink_url],
        ["Facebook Embed", fb?.embed_url],
      ]
    : [
        ["Facebook Watch", fb?.watch_url],
        ["Facebook Live", fb?.permalink_url],
        ["Facebook Video", fb?.video_permalink_url],
        ["Facebook Raw", fb?.raw_permalink_url],
        ["Facebook Embed", fb?.embed_url],
      ];
  for (const [label, val] of facebookSingles) pushUrl(val, { label });

  const asStrArray = (arr) =>
    Array.isArray(arr) ? arr.filter(isNonEmptyString) : [];
  for (const url of asStrArray(m?.videos)) pushUrl(url, { label: "Video" });
  for (const url of asStrArray(m?.links)) pushUrl(url, { label: "Link" });
  for (const url of asStrArray(m?.sources)) pushUrl(url, { label: "Nguồn" });

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

function getStreamIdentity(stream) {
  return stream?.key || stream?.url || stream?.embedUrl || "";
}

function mergeRenderableStreams(existing, incoming) {
  const current = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return current;
  if (!current.length) return next;

  const makeKey = (item, index) => {
    const identity = getStreamIdentity(item);
    if (identity) return identity;
    const openUrl =
      typeof item?.openUrl === "string" && item.openUrl.trim()
        ? item.openUrl.trim()
        : "";
    if (openUrl) return `open:${openUrl}`;
    return `idx:${index}`;
  };

  const merged = new Map();
  current.forEach((item, index) => {
    merged.set(makeKey(item, index), item);
  });
  next.forEach((item, index) => {
    const key = makeKey(item, current.length + index);
    const previous = merged.get(key);
    merged.set(
      key,
      previous && item && typeof item === "object"
        ? {
            ...previous,
            ...item,
            meta:
              previous?.meta || item?.meta
                ? { ...(previous?.meta || {}), ...(item?.meta || {}) }
                : undefined,
          }
        : item,
    );
  });

  return Array.from(merged.values());
}

function mergeCanonicalStreamLists(existing, incoming) {
  const current = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!next.length) return current;

  const makeKey = (item, index) => {
    if (!item || typeof item !== "object") return `idx:${index}`;
    const key =
      typeof item.key === "string" && item.key.trim() ? item.key.trim() : "";
    if (key) return `key:${key}`;
    const playUrl =
      typeof item.playUrl === "string" && item.playUrl.trim()
        ? item.playUrl.trim()
        : "";
    if (playUrl) return `play:${playUrl}`;
    const openUrl =
      typeof item.openUrl === "string" && item.openUrl.trim()
        ? item.openUrl.trim()
        : "";
    if (openUrl) return `open:${openUrl}`;
    return `idx:${index}`;
  };

  const merged = new Map();
  current.forEach((item, index) => {
    merged.set(makeKey(item, index), item);
  });
  next.forEach((item, index) => {
    const key = makeKey(item, current.length + index);
    const previous = merged.get(key);
    merged.set(
      key,
      previous && item && typeof item === "object"
        ? {
            ...previous,
            ...item,
            meta:
              previous?.meta || item?.meta
                ? { ...(previous?.meta || {}), ...(item?.meta || {}) }
                : undefined,
          }
        : item,
    );
  });

  return Array.from(merged.values());
}
/* ====================== PlayerLink & team helpers ====================== */
function PlayerLink({ person, onOpen, displayMode = "nickname" }) {
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
      title={nameWithNick(person, displayMode)}
    >
      {nameWithNick(person, displayMode)}
    </MuiLink>
  );
}
const idOf = (x) => x?._id || x?.id || x?.value || x || null;
function pairLabel(reg, isSingle, displayMode = "nickname") {
  return getTournamentPairName(
    reg,
    isSingle ? "single" : "double",
    displayMode,
    {
      fallback:
        reg?.code ||
        reg?.shortCode ||
        String(reg?._id || reg?.id || reg)
          .slice(-5)
          .toUpperCase() ||
        "â€”",
    },
  ); /*
  if (!reg) return "—";
  const p1 = reg?.player1 || reg?.players?.[0] || reg?.p1;
  const p2 = reg?.player2 || reg?.players?.[1] || reg?.p2;

  const display = (p = {}) => {
    const name = p.fullName || p.name || "";
    const nick = p.nickName || p.nickname || "";
    return nick ? `${nick}` : name || nick || "";
  };

  const n1 = display(p1);
  const n2 = !isSingle && p2 ? display(p2) : null;
  const code =
    reg?.code ||
    reg?.shortCode ||
    String(reg?._id || reg?.id || reg)
      .slice(-5)
      .toUpperCase();

  return [n1, n2].filter(Boolean).join(" & ") || code || "—";
*/
}
function useDebounced(value, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ====================== EditTeamsDialog ====================== */
function EditTeamsDialog({
  open,
  onClose,
  tournamentId,
  isSingle,
  displayMode = "nickname",
  defaultA,
  defaultB,
  onSaved,
  patchMatch,
  patching,
}) {
  const { tournamentId: tidParam, tid, tId, id: idParam } = useParams();
  const location = useLocation();
  const qs = new URLSearchParams(location.search);
  const tidQuery =
    qs.get("tournamentId") || qs.get("tournament") || qs.get("tid");
  const effectiveTid =
    tournamentId || tidParam || tid || tId || idParam || tidQuery || null;

  const [selA, setSelA] = useState(defaultA || null);
  const [selB, setSelB] = useState(defaultB || null);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 350);

  useEffect(() => {
    if (open) {
      setSelA(defaultA || null);
      setSelB(defaultB || null);
      setQ("");
    }
  }, [open, defaultA, defaultB]);

  const [triggerSearch, { data = [], isFetching }] =
    useLazySearchRegistrationsQuery();

  useEffect(() => {
    if (!open || !effectiveTid) return;
    triggerSearch({ id: effectiveTid, q: dq, limit: 200 });
  }, [open, effectiveTid, dq, triggerSearch]);

  const options = data;

  const handleSwap = () => {
    const a = selA;
    setSelA(selB);
    setSelB(a);
  };

  const handleClear = () => {
    setSelA(null);
    setSelB(null);
  };

  const handleSave = async () => {
    await patchMatch({
      pairA: idOf(selA),
      pairB: idOf(selB),
    });
    onSaved?.(selA, selB);
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
      PaperProps={{ sx: { height: { xs: "85vh", md: "75vh" } } }}
    >
      <DialogTitle>Chỉnh đội A / B</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            size="small"
            placeholder='Tìm đăng ký / VĐV… (hỗ trợ: "cụm từ")'
            value={q}
            onChange={(e) => setQ(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            helperText="Tìm theo tên, nick, mã, shortId hoặc số điện thoại (≥6 số)."
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Box flex={1}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Chọn đội A
              </Typography>
              <Autocomplete
                disablePortal
                loading={isFetching}
                options={options}
                value={selA}
                onChange={(_, v) => setSelA(v)}
                getOptionLabel={(o) => pairLabel(o, isSingle, displayMode)}
                isOptionEqualToValue={(o, v) => idOf(o) === idOf(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder="Chọn đội A"
                  />
                )}
              />
            </Box>

            <Box flex={1}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Chọn đội B
              </Typography>
              <Autocomplete
                disablePortal
                loading={isFetching}
                options={options}
                value={selB}
                onChange={(_, v) => setSelB(v)}
                getOptionLabel={(o) => pairLabel(o, isSingle, displayMode)}
                isOptionEqualToValue={(o, v) => idOf(o) === idOf(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder="Chọn đội B"
                  />
                )}
              />
            </Box>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<SwapIcon />}
              onClick={handleSwap}
            >
              Đổi A ↔ B
            </Button>
            <Button
              variant="text"
              size="small"
              startIcon={<ClearIcon />}
              onClick={handleClear}
            >
              Xoá chọn
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={patching}>
          Huỷ
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={patching}>
          Lưu đội
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ====================== LOCK: chỉ cập nhật đúng match đang mở ====================== */
function useLockedMatch(m, { loading }) {
  const [lockedId, setLockedId] = useState(() => (m?._id ? String(m._id) : ""));
  const [view, setView] = useState(() => (m?._id ? m : null));

  // Pattern: Derived state during render. React will re-render before DOM paint.
  // Tránh flash 1 frame lỗi do useEffect chạy chậm hơn render.
  if (m?._id && !lockedId) {
    setLockedId(String(m._id));
    setView(m);
  } else if (m?._id && lockedId && String(m._id) === lockedId) {
    if (!isMatchEqual(view, m)) {
      setView(m);
    }
  }

  const waiting = loading && !view;

  return { lockedId, view, setView, waiting };
}

/* ====================== Main ====================== */
export default function MatchContent({ m, isLoading, liveLoading, onSaved }) {
  const { userInfo } = useSelector((s) => s.auth || {});
  const roleStr = String(userInfo?.role || "").toLowerCase();
  const roles = new Set(
    [...(userInfo?.roles || []), ...(userInfo?.permissions || [])]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase()),
  );
  const isAdmin = !!(
    userInfo?.isAdmin ||
    roleStr === "admin" ||
    roles.has("admin") ||
    roles.has("superadmin")
  );

  const { tournamentId: tidParam, id: idParam } = useParams();
  const location = useLocation();
  const qs = new URLSearchParams(location.search);
  const tidQuery = qs.get("tournamentId") || qs.get("tournament") || null;

  const tour =
    m?.tournament && typeof m.tournament === "object" ? m.tournament : null;
  const displayMode = getTournamentNameDisplayMode(tour);

  const tournamentId =
    tidParam ||
    idParam ||
    tidQuery ||
    tour?._id ||
    tour?.id ||
    m?.tournament?._id ||
    m?.tournament?.id ||
    null;

  const needsGroupSeedResolution = useMemo(
    () =>
      (!m?.pairA && m?.seedA?.type === "groupRank") ||
      (!m?.pairB && m?.seedB?.type === "groupRank"),
    [m?.pairA, m?.pairB, m?.seedA?.type, m?.seedB?.type],
  );

  const { data: brackets = [], isFetching: fetchingBrackets } =
    useListTournamentBracketsQuery(
      tournamentId && needsGroupSeedResolution ? tournamentId : skipToken,
    );
  const { data: allMatchesFetched = [], isFetching: fetchingMatches } =
    useListTournamentMatchesQuery(
      tournamentId && needsGroupSeedResolution ? { tournamentId } : skipToken,
    );

  const byBracket = useMemo(() => {
    const m = {};
    (brackets || []).forEach((b) => (m[b._id] = []));
    (allMatchesFetched || []).forEach((mt) => {
      const bid = mt?.bracket?._id || mt?.bracket;
      if (m[bid]) m[bid].push(mt);
    });
    return m;
  }, [brackets, allMatchesFetched]);

  const { data: verifyRes, isFetching: verifyingMgr } = useVerifyManagerQuery(
    tournamentId ? tournamentId : skipToken,
  );
  const isManager = !!verifyRes?.isManager;
  const canEdit = isAdmin || isManager;

  const [profileUserId, setProfileUserId] = useState(null);
  const openProfile = (uid) => {
    if (!uid) return;
    const norm = uid?._id || uid?.id || uid?.userId || uid?.uid || uid || null;
    if (norm) setProfileUserId(String(norm));
  };
  const closeProfile = () => setProfileUserId(null);

  const socketCtx = useSocket();
  const socket = socketCtx?.socket || socketCtx;

  const loading = Boolean(isLoading || liveLoading);
  const globalLoading = Boolean(
    loading ||
    (needsGroupSeedResolution && (fetchingBrackets || fetchingMatches)),
  );

  const {
    lockedId,
    view: mm,
    waiting,
  } = useLockedMatch(m, { loading: globalLoading });

  const groupDoneByStage = useMemo(() => {
    const stageMap = new Map();

    (brackets || []).forEach((br, bi) => {
      if (String(br?.type || "").toLowerCase() !== "group") return;

      const ms = byBracket?.[br._id] || [];
      const keyOf = makeMatchGroupLabelFnFor(br);

      const stageNo = Number(br?.stage ?? bi + 1);
      const merged = stageMap.get(stageNo) || new Map();

      (br?.groups || []).forEach((g, gi) => {
        const altKeys = [
          String(g.name || g.code || g._id || String(gi + 1)),
          String(g.code || ""),
          String(g.name || ""),
          String(gi + 1),
        ]
          .filter(Boolean)
          .map(_norm);

        const keySet = new Set(altKeys);
        const arr = ms.filter((m) => keySet.has(_norm(keyOf(m))));

        const finishedCount = arr.filter(
          (m) => String(m?.status || "").toLowerCase() === "finished",
        ).length;
        const anyUnfinished = arr.some(
          (m) => String(m?.status || "").toLowerCase() !== "finished",
        );
        const expected = expectedRRMatchesLocal(br, g);

        const done =
          expected > 0 ? finishedCount >= expected && !anyUnfinished : false;

        altKeys.forEach((k) => {
          merged.set(k, merged.has(k) ? merged.get(k) && done : done);
        });
      });

      stageMap.set(stageNo, merged);
    });

    return stageMap;
  }, [brackets, byBracket]);

  const isSeedBlockedByUnfinishedGroup = useCallback(
    (seed) => {
      if (!seed || seed.type !== "groupRank") return false;

      const stageFromSeed = Number(
        seed?.ref?.stage ?? seed?.ref?.stageIndex ?? NaN,
      );
      const currentStage = Number(mm?.bracket?.stage ?? mm?.stage ?? NaN);
      const stageNo = Number.isFinite(stageFromSeed)
        ? stageFromSeed
        : Number.isFinite(currentStage)
          ? currentStage - 1
          : NaN;

      const groupCode = String(
        seed?.ref?.groupCode ?? seed?.ref?.group ?? "",
      ).trim();
      if (!Number.isFinite(stageNo) || !groupCode) return true;

      const stageMap = groupDoneByStage.get(stageNo);
      if (!stageMap) return true;

      const done = stageMap.get(_norm(groupCode));
      return done !== true;
    },
    [groupDoneByStage, mm?.bracket?.stage, mm?.stage],
  );

  const showSpinner = waiting;
  const showError = !waiting && !mm;

  const [localPatch, setLocalPatch] = useState(null);
  useEffect(() => {
    setLocalPatch(null);
  }, [lockedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = localPatch?.status || mm?.status || "scheduled";
  const shownGameScores = localPatch?.gameScores ?? mm?.gameScores ?? [];

  // Streams
  const normalizedStreams = useMemo(
    () => normalizeStreams(localPatch ? { ...mm, ...localPatch } : mm || {}),
    [mm, localPatch],
  );
  const [stableStreams, setStableStreams] = useState(() => normalizedStreams);
  const streams = stableStreams;
  const [activeIdx, setActiveIdx] = useState(() => {
    const arr = normalizedStreams;
    if (!arr.length) return -1;
    const primary = arr.findIndex((s) => s.primary);
    if (primary >= 0) return primary;
    const emb = arr.findIndex((s) => s.canEmbed);
    if (emb >= 0) return emb;
    return 0;
  });
  const [showPlayer, setShowPlayer] = useState(false);
  const prevStreamsLenRef = useRef(0);
  const lastActiveStreamIdentityRef = useRef("");
  const activeStream =
    activeIdx >= 0 && activeIdx < streams.length ? streams[activeIdx] : null;
  // Reset chọn stream khi đổi trận
  useEffect(() => {
    // Use m prop directly: mm state may be stale at this point
    const source = mm || m || {};
    const arr = normalizeStreams(source);
    setStableStreams(arr);
    const pick = () => {
      if (!arr.length) return -1;
      const p = arr.findIndex((s) => s.primary);
      if (p >= 0) return p;
      const e = arr.findIndex((s) => s.canEmbed);
      if (e >= 0) return e;
      return 0;
    };
    setActiveIdx(pick());
    setShowPlayer(false);
    prevStreamsLenRef.current = arr.length;
    lastActiveStreamIdentityRef.current = "";
  }, [lockedId, m, mm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-bật player khi lần đầu có stream
  useEffect(() => {
    setStableStreams((prev) => mergeRenderableStreams(prev, normalizedStreams));
  }, [normalizedStreams]);

  useEffect(() => {
    const curr = streams || [];
    const prevLen = prevStreamsLenRef.current;
    const previousIdentity = lastActiveStreamIdentityRef.current;

    if (prevLen === 0 && curr.length > 0) {
      const pick = () => {
        const p = curr.findIndex((s) => s.primary);
        if (p >= 0) return p;
        const e = curr.findIndex((s) => s.canEmbed);
        if (e >= 0) return e;
        return 0;
      };
      const idx = pick();
      setActiveIdx(idx);
    }

    if (previousIdentity) {
      const preservedIdx = curr.findIndex(
        (item) => getStreamIdentity(item) === previousIdentity,
      );
      if (preservedIdx >= 0 && preservedIdx !== activeIdx) {
        setActiveIdx(preservedIdx);
        prevStreamsLenRef.current = curr.length;
        return;
      }
    }

    if (activeIdx >= curr.length) {
      setActiveIdx(curr.length ? 0 : -1);
    }

    prevStreamsLenRef.current = curr.length;
  }, [streams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lastActiveStreamIdentityRef.current = getStreamIdentity(activeStream);
  }, [activeStream]);

  // Overlay URL
  const overlayUrl =
    lockedId && typeof window !== "undefined" && window?.location?.origin
      ? `${window.location.origin}/overlay/score?matchId=${lockedId}&theme=dark&size=md&showSets=1&autoNext=1`
      : "";

  // Time labels
  const startedAt = toDateSafe(mm?.startedAt);
  const scheduledAt = toDateSafe(mm?.scheduledAt || mm?.assignedAt);
  const finishedAt = toDateSafe(mm?.finishedAt);
  const startLabel =
    status === "live"
      ? startedAt
        ? `Bắt đầu: ${formatClock(startedAt)}`
        : scheduledAt
          ? `Giờ đấu: ${formatClock(scheduledAt)}`
          : null
      : scheduledAt
        ? `Giờ đấu: ${formatClock(scheduledAt)}`
        : null;
  const endLabel =
    status === "finished" && finishedAt
      ? `Kết thúc: ${formatClock(finishedAt)}`
      : null;

  const isSingle =
    String(mm?.tournament?.eventType || "").toLowerCase() === "single";
  const blockA = isSeedBlockedByUnfinishedGroup(mm?.seedA);
  const blockB = isSeedBlockedByUnfinishedGroup(mm?.seedB);

  // ====== Edit scores ======
  const [editMode, setEditMode] = useState(false);
  const [editScores, setEditScores] = useState(() => [
    ...(shownGameScores || []),
  ]);

  // Khi đổi match: thoát edit, sync lại từ server/localPatch
  useEffect(() => {
    setEditMode(false);
    setEditScores([...(localPatch?.gameScores ?? mm?.gameScores ?? [])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedId]);

  // Khi có cập nhật gameScores từ socket/server:
  // - Nếu KHÔNG ở editMode -> cập nhật editScores để luôn khớp.
  // - Nếu đang editMode -> giữ nguyên editScores (user đang nhập tay).
  useEffect(() => {
    if (!editMode) {
      setEditScores([...(localPatch?.gameScores ?? mm?.gameScores ?? [])]);
    }
  }, [localPatch?.gameScores, mm?.gameScores, editMode]);

  // 👉 ĐẢM BẢO luôn có 1 dòng khi vào edit (kể cả đang LIVE và chưa có set)
  const enterEditMode = useCallback(() => {
    setEditMode(true);
    setEditScores((prev) =>
      Array.isArray(prev) && prev.length > 0 ? prev : [{ a: 0, b: 0 }],
    );
  }, []);

  const sanitizeInt = (v) => {
    const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 99);
  };
  const setCell = (idx, side, val) => {
    setEditScores((old) => {
      const arr = [...(Array.isArray(old) ? old : [])];
      while (arr.length <= idx) arr.push({ a: 0, b: 0 });
      const row = { ...(arr[idx] || { a: 0, b: 0 }) };
      row[side] = sanitizeInt(val);
      arr[idx] = row;
      return arr;
    });
  };
  const addSet = () => setEditScores((old) => [...(old || []), { a: 0, b: 0 }]);
  const removeSet = (idx) =>
    setEditScores((old) => (old || []).filter((_, i) => i !== idx));
  const resetEdits = () =>
    setEditScores([...(localPatch?.gameScores ?? mm?.gameScores ?? [])]);

  const [adminPatchMatch, { isLoading: patching }] =
    useAdminPatchMatchMutation();

  const handleSaveScores = async () => {
    if (!canEdit || !lockedId) return;
    try {
      await adminPatchMatch({
        id: lockedId,
        body: { gameScores: editScores },
      }).unwrap();
      setLocalPatch((p) => ({ ...(p || {}), gameScores: editScores }));
      toast.success("Đã lưu tỉ số.");
      setEditMode(false);
    } catch (e) {
      toast.error(`Lưu tỉ số thất bại: ${e?.data?.message || e?.message || e}`);
    }
  };

  const handleSetWinner = async (side /* 'A' | 'B' */) => {
    if (!canEdit || !lockedId) return;
    try {
      await adminPatchMatch({
        id: lockedId,
        body: { winner: side, status: "finished" },
      }).unwrap();
      setLocalPatch((p) => ({ ...(p || {}), status: "finished" }));
      toast.success(`Đã đặt đội ${side} thắng & kết thúc trận.`);
    } catch (e) {
      toast.error(
        `Đặt thắng/thua thất bại: ${e?.data?.message || e?.message || e}`,
      );
    }
  };

  const handleSetStatus = async (newStatus) => {
    if (!canEdit || !lockedId) return;
    try {
      await adminPatchMatch({
        id: lockedId,
        body: { status: newStatus },
      }).unwrap();
      setLocalPatch((p) => ({ ...(p || {}), status: newStatus }));
      toast.success(`Đã đổi trạng thái: ${newStatus}`);
    } catch (e) {
      toast.error(
        `Đổi trạng thái thất bại: ${e?.data?.message || e?.message || e}`,
      );
    }
  };

  // Chỉnh đội
  const [teamsOpen, setTeamsOpen] = useState(false);
  const patchTeams = async (body) => {
    try {
      await adminPatchMatch({ id: lockedId, body }).unwrap();
      toast.success("Đã lưu đội A/B. Reload trang để áp dụng");
    } catch (e) {
      const msg = e?.data?.message || e?.message || "Lỗi không xác định";
      toast.error(`Lưu đội thất bại: ${msg}`);
      throw e;
    }
  };
  const handleTeamsSavedLocal = (newA, newB) => {
    setLocalPatch((p) => ({
      ...(p || {}),
      pairA: newA
        ? {
            _id: idOf(newA),
            player1: newA.player1,
            player2: newA.player2,
            code: newA.code,
          }
        : null,
      pairB: newB
        ? {
            _id: idOf(newB),
            player1: newB.player1,
            player2: newB.player2,
            code: newB.code,
          }
        : null,
    }));
  };

  /* ====================== Socket listeners ====================== */
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const debouncedRefreshRef = useRef(null);
  const debouncedRefresh = () => {
    if (debouncedRefreshRef.current) clearTimeout(debouncedRefreshRef.current);
    debouncedRefreshRef.current = setTimeout(() => {
      onSavedRef.current?.();
    }, 200);
  };

  const applyLocalScoreIfAny = (payload = {}) => {
    const gameScores =
      payload.gameScores ??
      payload.scores ??
      payload.data?.gameScores ??
      payload.data?.scores ??
      payload.snapshot?.gameScores;
    if (Array.isArray(gameScores)) {
      setLocalPatch((p) => ({ ...(p || {}), gameScores }));
    }
  };

  const applyLocalStreamIfAny = (payload = {}) => {
    const snap = payload.snapshot || payload.data || payload || {};

    const candidates = [
      snap.video,
      snap.videoUrl,
      snap.meta?.video,
      snap.link,
      snap.url,
      snap.sources?.video,
    ]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);

    const streamsArr =
      snap.streams ||
      snap.meta?.streams ||
      snap.links?.items ||
      snap.sources?.items ||
      [];

    const hasVideo = candidates.length > 0;
    const hasStreams = Array.isArray(streamsArr) && streamsArr.length > 0;

    if (!hasVideo && !hasStreams) return;

    setLocalPatch((p) => {
      const next = { ...(p || {}) };
      const currentSource = p ? { ...mm, ...p } : mm || {};
      const existingStreams =
        currentSource.streams ||
        currentSource.meta?.streams ||
        currentSource.links?.items ||
        currentSource.sources?.items ||
        [];
      if (hasVideo) {
        const v = candidates[0];
        next.video = v;
        next.videoUrl = v;
        next.meta = { ...(next.meta || {}), video: v };
      }
      if (hasStreams) {
        const mergedStreams = mergeCanonicalStreamLists(
          existingStreams,
          streamsArr,
        );
        next.streams = mergedStreams;
        next.meta = { ...(next.meta || {}), streams: mergedStreams };
      }
      if (
        typeof snap.defaultStreamKey === "string" &&
        snap.defaultStreamKey.trim()
      ) {
        next.defaultStreamKey = snap.defaultStreamKey.trim();
      }
      return next;
    });
  };

  useEffect(() => {
    if (!socket || !lockedId) return;

    const forThis = (payload) =>
      isSameId(getMatchIdFromPayload(payload), lockedId);

    const SCORE_EVENTS = [
      "score:updated",
      "score:patched",
      "score:added",
      "score:undone",
      "match:snapshot",
    ];
    const REFRESH_EVENTS = [
      "match:patched",
      "match:started",
      "match:finished",
      "match:forfeited",
      "draw:matchUpdated",
      "match:teamsUpdated",
      "status:updated",
    ];
    const STREAM_EVENTS = ["match:snapshot", "stream:updated", "video:set"];

    const onScore = (payload = {}) => {
      if (!forThis(payload)) return;
      applyLocalScoreIfAny(payload);
      const hasScores = Array.isArray(
        payload.gameScores ??
          payload.scores ??
          payload?.data?.gameScores ??
          payload?.data?.scores ??
          payload?.snapshot?.gameScores,
      );
      if (!hasScores) debouncedRefresh();
    };

    const onGenericRefresh = (payload = {}) => {
      if (!forThis(payload)) return;
      debouncedRefresh();
    };

    const onStream = (payload = {}) => {
      if (!forThis(payload)) return;
      applyLocalStreamIfAny(payload);
    };

    SCORE_EVENTS.forEach((ev) => socket.on(ev, onScore));
    REFRESH_EVENTS.forEach((ev) => socket.on(ev, onGenericRefresh));
    STREAM_EVENTS.forEach((ev) => socket.on(ev, onStream));

    return () => {
      SCORE_EVENTS.forEach((ev) => socket.off(ev, onScore));
      REFRESH_EVENTS.forEach((ev) => socket.off(ev, onGenericRefresh));
      STREAM_EVENTS.forEach((ev) => socket.off(ev, onStream));
      if (debouncedRefreshRef.current) {
        clearTimeout(debouncedRefreshRef.current);
        debouncedRefreshRef.current = null;
      }
    };
  }, [socket, lockedId]);

  /* ====================== Render ====================== */
  if (showSpinner) {
    return (
      <Stack spacing={2} sx={{ position: "relative", p: { xs: 1, md: 2 } }}>
        <Skeleton variant="rounded" height={60} />
        <Skeleton variant="rounded" height={140} />
        <Skeleton variant="rounded" height={100} />
        <Stack direction="row" spacing={1.5}>
          <Skeleton variant="rounded" width={120} height={40} />
          <Skeleton variant="rounded" width={120} height={40} />
        </Stack>
      </Stack>
    );
  }
  if (showError) {
    return <Alert severity="error">Không tải được dữ liệu trận.</Alert>;
  }
  if (!mm) {
    return null;
  }

  const canSeeOverlay = canEdit;

  return (
    <Stack spacing={2} sx={{ position: "relative" }}>
      {/* Header trạng thái */}
      <Alert icon={<PlayIcon />} severity="info">
        {status === "live"
          ? streams.length
            ? "Trận đang live — bạn có thể mở liên kết hoặc xem trong nền."
            : "Trận đang live — chưa có link."
          : status === "finished"
            ? "Trận đã diễn ra."
            : "Trận chưa diễn ra."}
      </Alert>

      {/* Khu video */}
      {activeStream && (
        <Stack spacing={1.5}>
          {/* ── Server Tabs ── */}
          {streams.length > 1 && (
            <Box
              sx={{
                display: "flex",
                gap: 0.5,
                p: 0.5,
                borderRadius: 2,
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(0,0,0,0.04)",
              }}
            >
              {streams.map((stream, index) => {
                const selected = index === activeIdx;
                const subtitle =
                  String(stream.providerLabel || "")
                    .trim()
                    .toLowerCase() ===
                  String(stream.label || "")
                    .trim()
                    .toLowerCase()
                    ? ""
                    : stream.providerLabel || "";
                return (
                  <Button
                    key={stream.key || `${stream.url}-${index}`}
                    size="small"
                    disableElevation
                    variant={selected ? "contained" : "text"}
                    onClick={() => setActiveIdx(index)}
                    sx={{
                      flex: 1,
                      borderRadius: 1.5,
                      textTransform: "none",
                      fontWeight: selected ? 700 : 500,
                      fontSize: "0.8rem",
                      py: 0.75,
                      transition: "all .2s",
                      ...(selected
                        ? {
                            bgcolor: "primary.main",
                            color: "#fff",
                            boxShadow: "0 2px 8px rgba(25,118,210,0.25)",
                          }
                        : {
                            color: "text.secondary",
                            "&:hover": {
                              bgcolor: (theme) =>
                                theme.palette.mode === "dark"
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(0,0,0,0.06)",
                            },
                          }),
                    }}
                  >
                    {stream.label}
                    {subtitle ? ` · ${subtitle}` : ""}
                  </Button>
                );
              })}
            </Box>
          )}

          {!activeStream.ready && activeStream.disabledReason && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              {activeStream.disabledReason}
            </Alert>
          )}

          {/* ── Video Action Buttons ── */}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {activeStream.canEmbed && (
              <Button
                size="small"
                disableElevation
                variant={showPlayer ? "contained" : "outlined"}
                onClick={() => setShowPlayer((v) => !v)}
                startIcon={<PlayIcon />}
                sx={{
                  borderRadius: 2,
                  textTransform: "none",
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  px: 2,
                  ...(showPlayer
                    ? {
                        background: "linear-gradient(135deg, #1976d2, #42a5f5)",
                        boxShadow: "0 2px 8px rgba(25,118,210,0.3)",
                        "&:hover": {
                          background:
                            "linear-gradient(135deg, #1565c0, #1e88e5)",
                        },
                      }
                    : {
                        borderColor: "primary.main",
                      }),
                }}
              >
                {showPlayer ? "Thu gọn" : "Xem video trong nền"}
              </Button>
            )}
            <Button
              variant="outlined"
              size="small"
              endIcon={<OpenInNewIcon sx={{ fontSize: "0.9rem !important" }} />}
              component={MuiLink}
              href={
                activeStream.openUrl ||
                (activeStream.kind === "delayed_manifest"
                  ? ""
                  : activeStream.url)
              }
              disabled={
                !activeStream.openUrl &&
                activeStream.kind === "delayed_manifest"
              }
              target="_blank"
              rel="noreferrer"
              underline="none"
              sx={{
                borderRadius: 2,
                textTransform: "none",
                fontWeight: 600,
                fontSize: "0.8rem",
                px: 2,
                borderColor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.15)"
                    : "rgba(0,0,0,0.15)",
              }}
            >
              Mở link trực tiếp
            </Button>
          </Stack>

          {showPlayer && activeStream.canEmbed && (
            <UnifiedStreamPlayer source={activeStream} />
          )}
        </Stack>
      )}

      {/* Overlay */}
      {overlayUrl && canSeeOverlay && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 2.5,
            borderColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.08)",
          }}
        >
          <Stack spacing={1.25}>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 700, fontSize: "0.85rem" }}
            >
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
                InputProps={{
                  readOnly: true,
                  sx: { borderRadius: 2, fontSize: "0.8rem" },
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        aria-label="Copy overlay URL"
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(overlayUrl);
                            toast.success("Đã copy overlay URL");
                          } catch {
                            toast.info(
                              "Không copy được, vui lòng bôi đen và copy thủ công.",
                            );
                          }
                        }}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                size="small"
                disableElevation
                variant="contained"
                color="primary"
                startIcon={<OpenInNewIcon />}
                component={MuiLink}
                href={overlayUrl}
                target="_blank"
                rel="noreferrer"
                underline="none"
                sx={{
                  color: "white !important",
                  whiteSpace: "nowrap",
                  borderRadius: 2,
                  textTransform: "none",
                  fontWeight: 600,
                  fontSize: "0.8rem",
                }}
              >
                Mở overlay
              </Button>
            </Stack>
            <Button
              size="small"
              disableElevation
              variant="contained"
              color="primary"
              startIcon={<OpenInNewIcon />}
              component={MuiLink}
              href={overlayUrl + "&overlay=1&isactivebreak=1"}
              target="_blank"
              rel="noreferrer"
              underline="none"
              sx={{
                color: "white !important",
                whiteSpace: "nowrap",
                borderRadius: 2,
                textTransform: "none",
                fontWeight: 600,
                fontSize: "0.8rem",
                background: "linear-gradient(135deg, #1976d2, #42a5f5)",
                boxShadow: "0 2px 8px rgba(25,118,210,0.25)",
                "&:hover": {
                  background: "linear-gradient(135deg, #1565c0, #1e88e5)",
                },
              }}
            >
              Mở overlay đầy đủ
            </Button>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: "0.7rem" }}
            >
              Dán link vào OBS/StreamYard (Browser Source) để hiển thị tỉ số.
            </Typography>

            <Divider sx={{ my: 0.5 }} />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              <MatchRowActions match={m} />
            </Box>
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
            {mm?.pairA && !blockA ? (
              <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
                <PlayerLink
                  person={mm.pairA?.player1}
                  onOpen={openProfile}
                  displayMode={displayMode}
                />
                {!isSingle && mm.pairA?.player2 && (
                  <>
                    {" "}
                    &{" "}
                    <PlayerLink
                      person={mm.pairA.player2}
                      onOpen={openProfile}
                      displayMode={displayMode}
                    />
                  </>
                )}
              </Typography>
            ) : (
              <Typography variant="h6">
                {mm?.previousA
                  ? smartDepLabel(mm, mm.previousA)
                  : seedLabel(mm?.seedA)}
              </Typography>
            )}
          </Box>

          {/* Điểm hiện tại */}
          <Box textAlign="center" minWidth={140}>
            {status === "live" && (
              <Typography variant="caption" color="text.secondary">
                Ván hiện tại
              </Typography>
            )}
            <Typography variant="h4" fontWeight={800}>
              {shownGameScores?.[shownGameScores.length - 1]?.a ?? 0} –{" "}
              {shownGameScores?.[shownGameScores.length - 1]?.b ?? 0}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sets:{" "}
              {shownGameScores.filter((g) => (g?.a ?? 0) > (g?.b ?? 0)).length}{" "}
              –{" "}
              {shownGameScores.filter((g) => (g?.b ?? 0) > (g?.a ?? 0)).length}
            </Typography>
          </Box>

          {/* Đội B */}
          <Box flex={1} textAlign={{ xs: "left", sm: "right" }}>
            <Typography variant="body2" color="text.secondary">
              Đội B
            </Typography>
            {mm?.pairB && !blockB ? (
              <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
                <PlayerLink
                  person={mm.pairB?.player1}
                  onOpen={openProfile}
                  displayMode={displayMode}
                />
                {!isSingle && mm.pairB?.player2 && (
                  <>
                    {" "}
                    &{" "}
                    <PlayerLink
                      person={mm.pairB.player2}
                      onOpen={openProfile}
                      displayMode={displayMode}
                    />
                  </>
                )}
              </Typography>
            ) : (
              <Typography variant="h6">
                {mm?.previousB
                  ? smartDepLabel(mm, mm.previousB)
                  : seedLabel(mm?.seedB)}
              </Typography>
            )}
          </Box>
        </Stack>

        {/* Bảng set điểm */}
        {!!(editMode ? editScores?.length : shownGameScores?.length) && (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Set</TableCell>
                <TableCell align="center">A</TableCell>
                <TableCell align="center">B</TableCell>
                {canEdit && editMode && <TableCell align="center" width={56} />}
              </TableRow>
            </TableHead>
            <TableBody>
              {(editMode ? editScores : shownGameScores).map((g, idx) => (
                <TableRow key={idx}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell align="center">
                    {canEdit && editMode ? (
                      <TextField
                        size="small"
                        type="number"
                        inputProps={{
                          min: 0,
                          max: 99,
                          inputMode: "numeric",
                        }}
                        value={g?.a ?? 0}
                        onChange={(e) => setCell(idx, "a", e.target.value)}
                        sx={{ width: 88 }}
                      />
                    ) : (
                      (g?.a ?? 0)
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {canEdit && editMode ? (
                      <TextField
                        size="small"
                        type="number"
                        inputProps={{
                          min: 0,
                          max: 99,
                          inputMode: "numeric",
                        }}
                        value={g?.b ?? 0}
                        onChange={(e) => setCell(idx, "b", e.target.value)}
                        sx={{ width: 88 }}
                      />
                    ) : (
                      (g?.b ?? 0)
                    )}
                  </TableCell>
                  {canEdit && editMode && (
                    <TableCell align="center">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => removeSet(idx)}
                        aria-label="Xoá set"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Chips rule & trạng thái */}
        <Divider sx={{ my: 2 }} />
        <Stack
          direction="row"
          flexWrap="wrap"
          sx={{ gap: 1, alignItems: "center" }}
        >
          {startLabel && (
            <Chip size="small" icon={<TimeIcon />} label={startLabel} />
          )}
          {endLabel && (
            <Chip size="small" icon={<TimeIcon />} label={endLabel} />
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
          <Chip
            size="small"
            color={
              status === "finished"
                ? "success"
                : status === "live"
                  ? "primary"
                  : "default"
            }
            label={
              status === "live"
                ? "Đang diễn ra"
                : status === "finished"
                  ? "Hoàn thành"
                  : "Dự kiến"
            }
          />
        </Stack>

        {/* Admin/Manager controls */}
        {canEdit && (
          <>
            <Divider sx={{ my: 2 }} />
            <Alert severity="warning" icon={<EditIcon />}>
              Chế độ quản trị: chỉnh sửa tỉ số / đặt đội thắng / đổi trạng thái
              / <b>chỉnh đội A/B</b>.
            </Alert>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              useFlexGap
              flexWrap="wrap"
              sx={{
                mt: 1,
                gap: { xs: 1, sm: 1.5 },
                "& > *": { width: { xs: "100%", sm: "auto" } },
              }}
            >
              {!editMode ? (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<EditIcon />}
                  onClick={enterEditMode} // <-- luôn có 1 dòng input khi bật edit
                >
                  Chỉnh sửa tỉ số
                </Button>
              ) : (
                <>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={handleSaveScores}
                    disabled={patching || verifyingMgr || !canEdit}
                  >
                    Lưu tỉ số
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UndoIcon />}
                    onClick={resetEdits}
                    disabled={patching || verifyingMgr || !canEdit}
                  >
                    Hoàn tác
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={addSet}
                    disabled={patching || verifyingMgr || !canEdit}
                  >
                    Thêm set
                  </Button>
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => setEditMode(false)}
                    disabled={patching || verifyingMgr || !canEdit}
                  >
                    Thoát chỉnh sửa
                  </Button>
                </>
              )}

              <Button
                variant="outlined"
                size="small"
                startIcon={<WinIcon />}
                onClick={() => handleSetWinner("A")}
                disabled={patching || verifyingMgr || !canEdit}
              >
                Đặt A thắng
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<WinIcon />}
                onClick={() => handleSetWinner("B")}
                disabled={patching || verifyingMgr || !canEdit}
              >
                Đặt B thắng
              </Button>

              <Button
                variant={status === "scheduled" ? "contained" : "outlined"}
                size="small"
                startIcon={<StatusIcon />}
                onClick={() => handleSetStatus("scheduled")}
                disabled={patching || verifyingMgr || !canEdit}
              >
                Chuyển Scheduled
              </Button>
              <Button
                variant={status === "live" ? "contained" : "outlined"}
                size="small"
                startIcon={<StatusIcon />}
                onClick={() => handleSetStatus("live")}
                disabled={patching || verifyingMgr || !canEdit}
              >
                Chuyển Live
              </Button>
              <Button
                variant={status === "finished" ? "contained" : "outlined"}
                size="small"
                startIcon={<StatusIcon />}
                onClick={() => handleSetStatus("finished")}
                disabled={patching || verifyingMgr || !canEdit}
              >
                Chuyển Finished
              </Button>

              <Button
                variant="outlined"
                size="small"
                startIcon={<GroupIcon />}
                onClick={() => setTeamsOpen(true)}
                disabled={patching || verifyingMgr || !lockedId || !canEdit}
              >
                Chỉnh đội A/B
              </Button>
            </Stack>
          </>
        )}
      </Paper>

      {/* Dialog chọn đội */}
      <EditTeamsDialog
        open={teamsOpen}
        onClose={() => setTeamsOpen(false)}
        tournamentId={tournamentId}
        isSingle={isSingle}
        displayMode={displayMode}
        defaultA={localPatch?.pairA ?? mm?.pairA ?? null}
        defaultB={localPatch?.pairB ?? mm?.pairB ?? null}
        onSaved={handleTeamsSavedLocal}
        patchMatch={patchTeams}
        patching={patching}
      />

      {/* Popup hồ sơ VĐV */}
      <PublicProfileDialog
        open={Boolean(profileUserId)}
        onClose={closeProfile}
        userId={profileUserId}
      />
    </Stack>
  );
}
