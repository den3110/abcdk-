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
import { seedLabel, nameWithNick } from "../TournamentBracket";
import PublicProfileDialog from "../../../components/PublicProfileDialog";
import { FeedStylePlayerDialog } from "../../../components/video";
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

const hasResolvedPair = (pair) =>
  Boolean(
    pair &&
    (pair?.player1 ||
      pair?.player2 ||
      pair?.name ||
      pair?.teamName ||
      pair?.label ||
      pair?.displayName),
  );

function extractDisplayCodeText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(
    /\b(?:V\d+(?:-B[^-\s]+)?(?:-NT)?-T\d+|WB\d+-T\d+|LB\d+-T\d+|GF(?:\d+)?-T\d+)\b/i,
  );
  return match ? match[0].toUpperCase() : "";
}

const ceilPow2Local = (n) =>
  Math.pow(2, Math.ceil(Math.log2(Math.max(1, Number(n) || 1))));

function readBracketScaleLocal(bracket) {
  const teamsFromRoundKey = (key) => {
    if (!key) return 0;
    const upper = String(key).toUpperCase();
    if (upper === "F") return 2;
    if (upper === "SF") return 4;
    if (upper === "QF") return 8;
    if (/^R\d+$/i.test(upper)) return parseInt(upper.slice(1), 10);
    return 0;
  };

  const candidates = [
    teamsFromRoundKey(bracket?.ko?.startKey),
    teamsFromRoundKey(bracket?.prefill?.roundKey),
    Array.isArray(bracket?.prefill?.pairs)
      ? bracket.prefill.pairs.length * 2
      : 0,
    Array.isArray(bracket?.prefill?.seeds)
      ? bracket.prefill.seeds.length * 2
      : 0,
    bracket?.drawScale,
    bracket?.targetScale,
    bracket?.maxSlots,
    bracket?.capacity,
    bracket?.size,
    bracket?.scale,
    bracket?.meta?.drawSize,
    bracket?.meta?.scale,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 2);

  if (!candidates.length) return 0;
  return ceilPow2Local(Math.max(...candidates));
}

function roundsCountForBracketLocal(bracket, matchesOfThis = []) {
  const type = String(bracket?.type || "").toLowerCase();
  if (type === "group") return 1;

  if (type === "roundelim") {
    let maxRounds =
      Number(bracket?.meta?.maxRounds) ||
      Number(bracket?.config?.roundElim?.maxRounds) ||
      0;
    if (!maxRounds) {
      const maxRoundFromMatches =
        Math.max(
          0,
          ...(matchesOfThis || []).map((match) => Number(match?.round || 1)),
        ) || 1;
      maxRounds = Math.max(1, maxRoundFromMatches);
    }
    return maxRounds;
  }

  const roundsFromMatches = (() => {
    const rounds = (matchesOfThis || []).map((match) =>
      Number(match?.round || 1),
    );
    if (!rounds.length) return 0;
    return Math.max(1, Math.max(...rounds) - Math.min(...rounds) + 1);
  })();

  if (roundsFromMatches) return roundsFromMatches;

  const firstPairs =
    (Array.isArray(bracket?.prefill?.seeds) && bracket.prefill.seeds.length) ||
    (Array.isArray(bracket?.prefill?.pairs) && bracket.prefill.pairs.length) ||
    0;
  if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));

  const scale = readBracketScaleLocal(bracket);
  if (scale) return Math.ceil(Math.log2(scale));

  return 1;
}

function normalizeDoubleElimBranchLocal(match) {
  const branch = String(match?.branch || "").trim().toLowerCase();
  const phase = String(match?.phase || "").trim().toLowerCase();
  if (branch === "gf" || phase === "grand_final") return "gf";
  if (branch === "lb" || phase === "losers") return "lb";
  return "wb";
}

const winnerRoundMatchCodePreviewLocal = (baseRound, roundIndex, order = 1) =>
  `V${baseRound + roundIndex - 1}-T${order}`;

const loserRoundMatchCodePreviewLocal = (baseRound, roundIndex, order = 1) =>
  `V${baseRound + roundIndex - 1}-NT-T${order}`;

function buildDoubleElimDisplayCodeMapLocal(
  matches,
  baseRoundStart = 1,
  configuredScale = 0,
) {
  const activeMatches = (matches || [])
    .slice()
    .sort(
      (a, b) =>
        Number(a?.round || 1) - Number(b?.round || 1) ||
        Number(a?.order || 0) - Number(b?.order || 0),
    );

  const winnersMatches = activeMatches.filter(
    (match) => normalizeDoubleElimBranchLocal(match) === "wb",
  );
  const losersMatches = activeMatches.filter(
    (match) => normalizeDoubleElimBranchLocal(match) === "lb",
  );
  const grandFinalMatches = activeMatches.filter(
    (match) => normalizeDoubleElimBranchLocal(match) === "gf",
  );

  const uniqueWinnerRounds = Array.from(
    new Set(
      winnersMatches
        .map((match) => Number(match?.round || 1))
        .filter(Number.isFinite),
    ),
  ).sort((a, b) => a - b);
  const uniqueLoserRounds = Array.from(
    new Set(
      losersMatches
        .map((match) => Number(match?.round || 1))
        .filter(Number.isFinite),
    ),
  ).sort((a, b) => a - b);
  const uniqueGrandFinalRounds = Array.from(
    new Set(
      grandFinalMatches
        .map((match) => Number(match?.round || 1))
        .filter(Number.isFinite),
    ),
  ).sort((a, b) => a - b);

  const winnerRoundMap = new Map(
    uniqueWinnerRounds.map((roundNo, index) => [roundNo, index + 1]),
  );
  const loserRoundMap = new Map(
    uniqueLoserRounds.map((roundNo, index) => [roundNo, index + 1]),
  );
  const grandFinalRoundMap = new Map(
    uniqueGrandFinalRounds.map((roundNo, index) => [roundNo, index + 1]),
  );

  const firstWinnerPairs = uniqueWinnerRounds.length
    ? winnersMatches.filter(
        (match) => Number(match?.round || 1) === uniqueWinnerRounds[0],
      ).length
    : 0;
  const firstLoserPairs = uniqueLoserRounds.length
    ? losersMatches.filter(
        (match) => Number(match?.round || 1) === uniqueLoserRounds[0],
      ).length
    : 0;
  const scaleForDoubleElim =
    configuredScale ||
    firstWinnerPairs * 2 ||
    Math.max(4, firstLoserPairs * 4) ||
    4;
  const startDrawSize = Math.max(4, firstLoserPairs * 4 || 4);
  const startWinnersRoundIndex = Math.max(
    1,
    Math.round(Math.log2(scaleForDoubleElim / startDrawSize)) + 1,
  );
  const losersBaseRound = baseRoundStart + startWinnersRoundIndex - 1;
  const grandFinalBaseRound =
    losersBaseRound + Math.max(1, uniqueLoserRounds.length);
  const codeByMatchId = new Map();

  for (const match of winnersMatches) {
    const id = String(match?._id || "");
    const localRound = winnerRoundMap.get(Number(match?.round || 1)) || 1;
    if (!id) continue;
    codeByMatchId.set(
      id,
      winnerRoundMatchCodePreviewLocal(
        baseRoundStart,
        localRound,
        Number(match?.order || 0) + 1,
      ),
    );
  }

  for (const match of losersMatches) {
    const id = String(match?._id || "");
    const localRound = loserRoundMap.get(Number(match?.round || 1)) || 1;
    if (!id) continue;
    codeByMatchId.set(
      id,
      loserRoundMatchCodePreviewLocal(
        losersBaseRound,
        localRound,
        Number(match?.order || 0) + 1,
      ),
    );
  }

  for (const match of grandFinalMatches) {
    const id = String(match?._id || "");
    const localRound = grandFinalRoundMap.get(Number(match?.round || 1)) || 1;
    if (!id) continue;
    codeByMatchId.set(
      id,
      `V${grandFinalBaseRound + localRound - 1}-T${Number(match?.order || 0) + 1}`,
    );
  }

  return codeByMatchId;
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

function isTemporaryRecordingPlaybackUrl(url) {
  return /\/api\/live\/recordings\/v2\/[^/]+\/temp(?:\/playlist)?(?:\?|$)/i.test(
    String(url || "").trim(),
  );
}

function normalizeStreams(m) {
  const out = [];
  const seen = new Set();
  const defaultStreamKey =
    typeof m?.defaultStreamKey === "string" ? m.defaultStreamKey.trim() : "";

  const pushUrl = (url, { label, primary = false } = {}) => {
    if (!isNonEmptyString(url)) return;
    const u = url.trim();
    if (isTemporaryRecordingPlaybackUrl(u)) return;
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
    const explicitEmbedHtml = isNonEmptyString(stream?.embedHtml)
      ? stream.embedHtml.trim()
      : "";
    const explicitEmbedUrl = isNonEmptyString(stream?.embedUrl)
      ? stream.embedUrl.trim()
      : "";
    const explicitAspect = isNonEmptyString(stream?.aspect)
      ? stream.aspect.trim()
      : "";
    let det;
    if (kind === "delayed_manifest") {
      det = {
        kind: "delayed_manifest",
        canEmbed: true,
        embedUrl: playUrl,
        aspect: explicitAspect || "16:9",
      };
    } else if (kind === "iframe_html" && explicitEmbedHtml) {
      det = {
        kind: "iframe_html",
        canEmbed: true,
        embedHtml: explicitEmbedHtml,
        aspect: explicitAspect || "16:9",
      };
    } else if (explicitEmbedUrl) {
      const detected = detectEmbed(explicitEmbedUrl);
      det = {
        ...detected,
        kind: kind || detected.kind,
        canEmbed: true,
        embedUrl: explicitEmbedUrl,
        allow:
          (typeof stream?.allow === "string" && stream.allow.trim()) ||
          detected.allow,
        aspect: explicitAspect || detected.aspect || "16:9",
      };
    } else {
      det = detectEmbed(playUrl);
    }
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
      embedHtml: explicitEmbedHtml || det.embedHtml || "",
      embedUrl: explicitEmbedUrl || det.embedUrl || "",
      allow:
        (typeof stream?.allow === "string" && stream.allow.trim()) ||
        det.allow ||
        "",
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
  if (!next.length) return current.length ? current : [];
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

  const previousByKey = new Map();
  current.forEach((item, index) => {
    previousByKey.set(makeKey(item, index), item);
  });

  // Primary pass: map incoming items, merging with matching existing items
  const result = next.map((item, index) => {
    const key = makeKey(item, index);
    const previous = previousByKey.get(key);
    return previous && item && typeof item === "object"
      ? {
          ...previous,
          ...item,
          meta:
            previous?.meta || item?.meta
              ? { ...(previous?.meta || {}), ...(item?.meta || {}) }
              : undefined,
        }
      : item;
  });

  // Second pass: append any existing items whose identity-based key
  // is NOT present in the incoming array (prevents tabs from vanishing
  // when data arrives in stages — e.g. facebookLive.watch_url loads late)
  const nextIdentityKeys = new Set();
  next.forEach((item) => {
    const identity = getStreamIdentity(item);
    if (identity) nextIdentityKeys.add(identity);
  });

  current.forEach((item) => {
    const identity = getStreamIdentity(item);
    if (identity && !nextIdentityKeys.has(identity)) {
      result.push(item);
    }
  });

  return result;
}

function stripLocalStreamPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }

  let changed = false;
  const next = { ...patch };
  [
    "video",
    "videoUrl",
    "stream",
    "link",
    "url",
    "streams",
    "defaultStreamKey",
  ].forEach((key) => {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  });

  if (next.meta && typeof next.meta === "object" && !Array.isArray(next.meta)) {
    const nextMeta = { ...next.meta };
    ["video", "videoUrl", "stream", "streams"].forEach((key) => {
      if (key in nextMeta) {
        delete nextMeta[key];
        changed = true;
      }
    });
    if (Object.keys(nextMeta).length) {
      next.meta = nextMeta;
    } else {
      delete next.meta;
      changed = true;
    }
  }

  if (!changed) return patch;
  return Object.keys(next).length ? next : null;
}

function stripResolvedRealtimePatch(
  patch,
  { preserveGameScores = false } = {},
) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }

  let changed = false;
  const next = { ...patch };
  [
    "status",
    "winner",
    "currentGame",
    "serve",
    "rules",
    "pairA",
    "pairB",
    "startedAt",
    "finishedAt",
    "assignedAt",
  ].forEach((key) => {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  });

  if (!preserveGameScores && "gameScores" in next) {
    delete next.gameScores;
    changed = true;
  }

  if (!changed) return patch;
  return Object.keys(next).length ? next : null;
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
        "—",
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
  const nextId = m?._id ? String(m._id) : "";
  const previousLockedIdRef = useRef(nextId);
  const [lockedId, setLockedId] = useState(() => nextId);
  const [view, setView] = useState(() => (nextId ? m : null));

  useEffect(() => {
    if (!nextId) {
      if (!loading) {
        previousLockedIdRef.current = "";
        setLockedId("");
        setView(null);
      }
      return;
    }

    const isMatchChanged = previousLockedIdRef.current !== nextId;
    previousLockedIdRef.current = nextId;

    setLockedId(nextId);
    setView((prev) => {
      if (isMatchChanged || !prev) return m;
      return isMatchEqual(prev, m) ? prev : m;
    });
  }, [loading, m, nextId]);

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

  const isSingle =
    String(tour?.eventType || m?.tournament?.eventType || "").toLowerCase() ===
    "single";

  const needsSeedContextResolution = useMemo(() => {
    const unresolvedSideNeedsContext = (pair, previous, seed) =>
      !hasResolvedPair(pair) &&
      Boolean(
        previous ||
          [
            "groupRank",
            "stageMatchWinner",
            "stageMatchLoser",
            "matchWinner",
            "matchLoser",
          ].includes(String(seed?.type || "")),
      );

    return (
      unresolvedSideNeedsContext(m?.pairA, m?.previousA, m?.seedA) ||
      unresolvedSideNeedsContext(m?.pairB, m?.previousB, m?.seedB)
    );
  }, [
    m?.pairA,
    m?.pairB,
    m?.previousA,
    m?.previousB,
    m?.seedA?.type,
    m?.seedB?.type,
  ]);

  const { data: brackets = [], isFetching: fetchingBrackets } =
    useListTournamentBracketsQuery(
      tournamentId && needsSeedContextResolution ? tournamentId : skipToken,
    );
  const { data: allMatchesFetched = [], isFetching: fetchingMatches } =
    useListTournamentMatchesQuery(
      tournamentId && needsSeedContextResolution
        ? { tournamentId, view: "bracket" }
        : skipToken,
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

  const bracketsById = useMemo(() => {
    const map = new Map();
    (brackets || []).forEach((bracket) => {
      const bracketId = String(bracket?._id || "");
      if (bracketId) map.set(bracketId, bracket);
    });
    return map;
  }, [brackets]);

  const matchIndex = useMemo(() => {
    const map = new Map();
    (allMatchesFetched || []).forEach((match) => {
      const matchId = String(match?._id || "");
      if (matchId) map.set(matchId, match);
    });
    return map;
  }, [allMatchesFetched]);

  const matchRefIndex = useMemo(() => {
    const byId = new Map();
    const byBracketRoundOrder = new Map();
    const byStageRoundOrder = new Map();

    for (const match of allMatchesFetched || []) {
      const matchId = String(match?._id || "");
      const bracketId = String(match?.bracket?._id || match?.bracket || "");
      const stageNum = Number(
        match?.bracket?.stage ?? bracketsById.get(bracketId)?.stage,
      );
      const roundNum = Number(match?.round);
      const orderNum = Number(match?.order);

      if (matchId) byId.set(matchId, match);

      if (
        bracketId &&
        Number.isFinite(roundNum) &&
        Number.isFinite(orderNum)
      ) {
        byBracketRoundOrder.set(`${bracketId}:${roundNum}:${orderNum}`, match);
      }

      if (Number.isFinite(stageNum) && Number.isFinite(roundNum) && Number.isFinite(orderNum)) {
        byStageRoundOrder.set(`${stageNum}:${roundNum}:${orderNum}`, match);
      }
    }

    return { byId, byBracketRoundOrder, byStageRoundOrder };
  }, [allMatchesFetched, bracketsById]);

  const baseRoundStartByBracketId = useMemo(() => {
    const map = new Map();
    let accumulatedRounds = 0;

    for (const bracket of brackets || []) {
      const bracketId = String(bracket?._id || "");
      if (!bracketId) continue;
      map.set(bracketId, accumulatedRounds + 1);
      accumulatedRounds += roundsCountForBracketLocal(
        bracket,
        byBracket?.[bracket._id] || [],
      );
    }

    return map;
  }, [brackets, byBracket]);

  const firstBracketIdByStage = useMemo(() => {
    const map = new Map();

    for (const bracket of brackets || []) {
      const bracketId = String(bracket?._id || "");
      const stageNum = Number(bracket?.stage);
      if (!bracketId || !Number.isFinite(stageNum) || map.has(stageNum)) continue;
      map.set(stageNum, bracketId);
    }

    return map;
  }, [brackets]);

  const doubleElimDisplayCodeByMatchId = useMemo(() => {
    const map = new Map();

    for (const bracket of brackets || []) {
      if (String(bracket?.type || "").toLowerCase() !== "double_elim") continue;
      const bracketId = String(bracket?._id || "");
      if (!bracketId) continue;

      const localized = buildDoubleElimDisplayCodeMapLocal(
        byBracket?.[bracket._id] || [],
        baseRoundStartByBracketId.get(bracketId) || 1,
        readBracketScaleLocal(bracket),
      );

      for (const [matchId, code] of localized.entries()) {
        map.set(matchId, code);
      }
    }

    return map;
  }, [brackets, byBracket, baseRoundStartByBracketId]);

  const { data: verifyRes, isFetching: verifyingMgr } = useVerifyManagerQuery(
    userInfo?.token && tournamentId ? tournamentId : skipToken,
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
    (needsSeedContextResolution && (fetchingBrackets || fetchingMatches)),
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

  const findSourceMatchFromSeed = useCallback(
    (ownerMatch, seed) => {
      if (!seed) return null;

      const matchId = String(seed?.ref?.matchId || "");
      if (matchId && matchRefIndex.byId.has(matchId)) {
        return matchRefIndex.byId.get(matchId);
      }

      const roundNum = Number(seed?.ref?.round);
      const orderNum = Number(seed?.ref?.order);
      if (!Number.isFinite(roundNum) || !Number.isFinite(orderNum)) return null;

      const stageNum = Number(seed?.ref?.stageIndex ?? seed?.ref?.stage);
      if (Number.isFinite(stageNum)) {
        const byStage = matchRefIndex.byStageRoundOrder.get(
          `${stageNum}:${roundNum}:${orderNum}`,
        );
        if (byStage) return byStage;
      }

      const bracketId = String(ownerMatch?.bracket?._id || ownerMatch?.bracket || "");
      if (bracketId) {
        return (
          matchRefIndex.byBracketRoundOrder.get(
            `${bracketId}:${roundNum}:${orderNum}`,
          ) || null
        );
      }

      return null;
    },
    [matchRefIndex],
  );

  const getDisplayCodeForMatch = useCallback(
    (sourceMatch) => {
      if (!sourceMatch) return "";

      const matchId = String(sourceMatch?._id || "");
      if (matchId) {
        const localizedDoubleElimCode =
          doubleElimDisplayCodeByMatchId.get(matchId);
        if (localizedDoubleElimCode) return localizedDoubleElimCode;
      }

      const candidates = [
        sourceMatch?.displayCode,
        sourceMatch?.code,
        sourceMatch?.matchCode,
        sourceMatch?.slotCode,
        sourceMatch?.bracketCode,
        sourceMatch?.labelKey,
        sourceMatch?.meta?.code,
        sourceMatch?.meta?.label,
      ];
      for (const candidate of candidates) {
        const hit = extractDisplayCodeText(candidate);
        if (hit) return hit;
      }

      const bracketId = String(
        sourceMatch?.bracket?._id || sourceMatch?.bracket || "",
      );
      const baseRoundStart = baseRoundStartByBracketId.get(bracketId);
      const roundNum = Number(sourceMatch?.round);
      const orderNum = Number(sourceMatch?.order);
      const branch = String(
        sourceMatch?.branch || sourceMatch?.phase || "",
      ).toLowerCase();
      const isLosersBranch = branch === "lb" || branch === "losers";

      if (
        Number.isFinite(baseRoundStart) &&
        Number.isFinite(roundNum) &&
        Number.isFinite(orderNum)
      ) {
        const prefix = `V${baseRoundStart + roundNum - 1}`;
        return isLosersBranch
          ? `${prefix}-NT-T${orderNum + 1}`
          : `${prefix}-T${orderNum + 1}`;
      }

      return "";
    },
    [baseRoundStartByBracketId, doubleElimDisplayCodeByMatchId],
  );

  const resolveSeedReferenceLabel = useCallback(
    (seed, ownerMatch = null) => {
      if (!seed || !seed.type) return seedLabel(seed);

      const type = String(seed?.type || "");
      const isWinnerSeed =
        type === "stageMatchWinner" || type === "matchWinner";
      const isLoserSeed =
        type === "stageMatchLoser" || type === "matchLoser";

      if (!isWinnerSeed && !isLoserSeed) return seedLabel(seed);

      const prefix = isLoserSeed ? "L" : "W";
      const sourceMatch = findSourceMatchFromSeed(ownerMatch, seed);
      const sourceCode = getDisplayCodeForMatch(sourceMatch);
      if (sourceCode) return `${prefix}-${sourceCode}`;

      const stageNum = Number(seed?.ref?.stageIndex ?? seed?.ref?.stage);
      const roundNum = Number(seed?.ref?.round);
      const orderNum = Number(seed?.ref?.order);
      const bracketId = firstBracketIdByStage.get(stageNum);
      const baseRoundStart = bracketId
        ? baseRoundStartByBracketId.get(bracketId)
        : null;

      if (
        Number.isFinite(baseRoundStart) &&
        Number.isFinite(roundNum) &&
        Number.isFinite(orderNum)
      ) {
        return `${prefix}-V${baseRoundStart + roundNum - 1}-T${orderNum + 1}`;
      }

      const rawCode = extractDisplayCodeText(seed?.label);
      if (rawCode) return `${prefix}-${rawCode}`;

      return seedLabel({ ...seed, label: "" });
    },
    [
      findSourceMatchFromSeed,
      getDisplayCodeForMatch,
      firstBracketIdByStage,
      baseRoundStartByBracketId,
    ],
  );

  const resolvePendingSideLabel = useCallback(
    (match, side) => {
      if (!match) return "Chưa có đội";

      const seed = side === "A" ? match?.seedA : match?.seedB;
      const pair = side === "A" ? match?.pairA : match?.pairB;

      if (hasResolvedPair(pair)) {
        return pairLabel(pair, isSingle, displayMode);
      }

      if (seed && isSeedBlockedByUnfinishedGroup(seed)) {
        return resolveSeedReferenceLabel(seed, match);
      }

      const prev = side === "A" ? match?.previousA : match?.previousB;
      if (prev) {
        const prevId =
          typeof prev === "object" && prev?._id ? String(prev._id) : String(prev);
        const sourceMatch =
          matchIndex.get(prevId) || (typeof prev === "object" ? prev : null);
        const sourceCode = getDisplayCodeForMatch(sourceMatch);

        if (sourceMatch?.status === "finished" && sourceMatch?.winner) {
          const winnerPair =
            sourceMatch.winner === "A" ? sourceMatch.pairA : sourceMatch.pairB;
          if (hasResolvedPair(winnerPair)) {
            return `${pairLabel(winnerPair, isSingle, displayMode)}${
              sourceCode ? ` (W-${sourceCode})` : ""
            }`;
          }
        }

        if (sourceCode) return `W-${sourceCode}`;
        return resolveSeedReferenceLabel(seed, match);
      }

      if (seed && seed.type) {
        const sourceMatch = findSourceMatchFromSeed(match, seed);
        const sourceRefLabel = resolveSeedReferenceLabel(seed, match);
        const isWinnerSeed =
          seed?.type === "stageMatchWinner" || seed?.type === "matchWinner";
        const isLoserSeed =
          seed?.type === "stageMatchLoser" || seed?.type === "matchLoser";

        if (sourceMatch?.status === "finished" && sourceMatch?.winner) {
          const sourcePair = isLoserSeed
            ? sourceMatch.winner === "A"
              ? sourceMatch.pairB
              : sourceMatch.pairA
            : sourceMatch.winner === "A"
              ? sourceMatch.pairA
              : sourceMatch.pairB;

          if (hasResolvedPair(sourcePair)) {
            return `${pairLabel(sourcePair, isSingle, displayMode)}${
              sourceRefLabel ? ` (${sourceRefLabel})` : ""
            }`;
          }
        }

        if ((isWinnerSeed || isLoserSeed) && sourceRefLabel) {
          return sourceRefLabel;
        }

        return seedLabel(seed);
      }

      return "Chưa có đội";
    },
    [
      displayMode,
      findSourceMatchFromSeed,
      getDisplayCodeForMatch,
      isSeedBlockedByUnfinishedGroup,
      isSingle,
      matchIndex,
      resolveSeedReferenceLabel,
    ],
  );

  const showSpinner = waiting;
  const showError = !waiting && !mm;

  const [localPatch, setLocalPatch] = useState(null);
  const [editMode, setEditMode] = useState(false);
  useEffect(() => {
    setLocalPatch(null);
  }, [lockedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const normalizedStatus = String(mm?.status || "")
      .trim()
      .toLowerCase();
    if (!["finished", "ended", "stopped"].includes(normalizedStatus)) return;
    setLocalPatch((previous) => stripLocalStreamPatch(previous));
  }, [mm?.status, mm?.streams, mm?.video, mm?.videoUrl, mm?.defaultStreamKey]);

  const realtimeVersion = Number(mm?.liveVersion ?? mm?.version ?? NaN);
  const lastRealtimeVersionRef = useRef(null);
  useEffect(() => {
    if (!Number.isFinite(realtimeVersion)) return;
    if (lastRealtimeVersionRef.current === realtimeVersion) return;
    lastRealtimeVersionRef.current = realtimeVersion;
    setLocalPatch((previous) =>
      stripResolvedRealtimePatch(previous, {
        preserveGameScores: editMode,
      }),
    );
  }, [editMode, realtimeVersion]);
  useEffect(() => {
    lastRealtimeVersionRef.current = null;
  }, [lockedId]);

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
  const [playerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [playerDialogMuted, setPlayerDialogMuted] = useState(true);
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
    setPlayerDialogOpen(false);
    setPlayerDialogMuted(true);
    prevStreamsLenRef.current = arr.length;
    lastActiveStreamIdentityRef.current = "";
  }, [lockedId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    setPlayerDialogMuted(true);
  }, [lockedId, activeStream?.key]);

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

  const blockA =
    !hasResolvedPair(mm?.pairA) && isSeedBlockedByUnfinishedGroup(mm?.seedA);
  const blockB =
    !hasResolvedPair(mm?.pairB) && isSeedBlockedByUnfinishedGroup(mm?.seedB);
  const currentGameScore = Array.isArray(shownGameScores)
    ? shownGameScores[shownGameScores.length - 1] || null
    : null;
  const activeStreamOpenUrl =
    activeStream?.openUrl ||
    (activeStream?.kind === "delayed_manifest" ? "" : activeStream?.url) ||
    "";
  const playerDialogItem = useMemo(() => {
    const displayCode =
      String(
        mm?.displayCode ||
          mm?.codeDisplay ||
          mm?.code ||
          mm?.labelKeyDisplay ||
          "",
      ).trim();
    const stageLabel = (() => {
      const phase = String(mm?.phase || "").trim().toLowerCase();
      const branch = String(mm?.branch || "").trim().toLowerCase();
      const bracketType = String(mm?.bracket?.type || "").trim().toLowerCase();
      if (mm?.meta?.thirdPlace === true || branch === "consol") {
        return "Tranh 3-4";
      }
      if (phase === "grand_final" || branch === "gf") {
        return "Chung kết tổng";
      }
      if (
        mm?.pool?.name ||
        phase === "group" ||
        ["group", "round_robin", "gsl", "rr"].includes(bracketType)
      ) {
        return "Vòng bảng";
      }
      if (phase === "losers" || branch === "lb") {
        return "Nhánh thua";
      }
      if (phase === "winners" || branch === "wb") {
        return "Nhánh thắng";
      }
      return "";
    })();

    const tags = [
      displayCode ? `#${displayCode}` : "",
      mm?.courtLabel ? `#${String(mm.courtLabel).trim()}` : "",
      Number(mm?.currentGame) > 0 ? `#Game ${Number(mm.currentGame)}` : "",
      currentGameScore &&
      Number.isFinite(Number(currentGameScore?.a)) &&
      Number.isFinite(Number(currentGameScore?.b))
        ? `#${Number(currentGameScore.a)}-${Number(currentGameScore.b)}`
        : "",
      status === "live" ? "#Đang live" : status === "finished" ? "#Xem lại" : "",
    ].filter(Boolean);

    const preferredObjectFit =
      activeStream?.meta?.isCompleteVideo ||
      ["file", "hls", "delayed_manifest"].includes(
        String(activeStream?.kind || "").trim().toLowerCase(),
      )
        ? "contain"
        : "cover";

    return {
      _id: lockedId,
      tournament: mm?.tournament || null,
      status,
      updatedAt:
        mm?.updatedAt ||
        mm?.finishedAt ||
        mm?.startedAt ||
        mm?.scheduledAt ||
        null,
      posterUrl: mm?.tournament?.image || "",
      title: `${resolvePendingSideLabel(mm, "A")} vs ${resolvePendingSideLabel(mm, "B")}`,
      subtitle:
        String(
          mm?.courtLabel ||
            mm?.courtStationLabel ||
            displayCode ||
            mm?.tournament?.name ||
            "PickleTour Live",
        ).trim(),
      tags,
      codeChipLabel: displayCode ? `Mã ${displayCode}` : "",
      stageChipLabel: stageLabel,
      primaryOpenUrl: activeStreamOpenUrl,
      useNativeControls: Boolean(activeStream?.meta?.useNativeControls),
      preferredObjectFit,
    };
  }, [
    activeStream?.kind,
    activeStream?.meta?.isCompleteVideo,
    activeStream?.meta?.useNativeControls,
    activeStreamOpenUrl,
    currentGameScore,
    lockedId,
    mm,
    resolvePendingSideLabel,
    status,
  ]);

  // ====== Edit scores ======
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
            ? "Trận đang live — bạn có thể mở liên kết hoặc xem toàn màn hình."
            : "Trận đang live — Trận đấu đang được ghi hình và sẽ hiển thị video sau."
          : status === "finished"
            ? streams.length
              ? "Trận đã diễn ra."
              : "Trận đã diễn ra. Video bản ghi sẽ được hiển thị sau khi xử lý xong."
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
                variant="contained"
                onClick={() => setPlayerDialogOpen(true)}
                startIcon={<PlayIcon />}
                sx={{
                  borderRadius: 2,
                  textTransform: "none",
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  px: 2,
                  background: "linear-gradient(135deg, #1976d2, #42a5f5)",
                  boxShadow: "0 2px 8px rgba(25,118,210,0.3)",
                  "&:hover": {
                    background: "linear-gradient(135deg, #1565c0, #1e88e5)",
                  },
                }}
              >
                Xem toàn màn hình
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

        </Stack>
      )}

      <FeedStylePlayerDialog
        open={playerDialogOpen && Boolean(activeStream?.canEmbed)}
        onClose={() => setPlayerDialogOpen(false)}
        item={playerDialogItem}
        source={activeStream}
        streams={streams}
        activeStreamKey={String(activeStream?.key || activeStream?.url || "")}
        onSelectStream={(streamKey) => {
          const nextIdx = streams.findIndex((stream) => {
            const candidateKey = String(stream?.key || stream?.url || "").trim();
            return candidateKey === String(streamKey || "").trim();
          });
          if (nextIdx >= 0) {
            setActiveIdx(nextIdx);
          }
        }}
        muted={playerDialogMuted}
        onMutedChange={setPlayerDialogMuted}
      />

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
            {hasResolvedPair(mm?.pairA) && !blockA ? (
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
                {resolvePendingSideLabel(mm, "A")}
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
            {hasResolvedPair(mm?.pairB) && !blockB ? (
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
                {resolvePendingSideLabel(mm, "B")}
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
