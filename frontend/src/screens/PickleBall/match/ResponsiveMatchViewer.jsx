// src/screens/PickleBall/match/ResponsiveMatchViewer.jsx
/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useSelector } from "react-redux";
import { Close as CloseIcon } from "@mui/icons-material";
import { useLiveMatch } from "../../../hook/useLiveMatch";
import {
  useGetMatchPublicQuery,
  useListTournamentBracketsQuery,
} from "../../../slices/tournamentsApiSlice";
import { useGetLiveCourtQuery } from "../../../slices/liveApiSlice";
import { addBusinessBreadcrumb } from "../../../utils/sentry";
import MatchContent from "./MatchContent";

/* =========================
 * Helpers: V/T (+B cho vòng bảng)
 * ========================= */

// 2^⌈log2(n)⌉
const ceilPow2 = (n) =>
  Math.pow(2, Math.ceil(Math.log2(Math.max(1, Number(n) || 1))));

/** Ước lượng số vòng cho 1 bracket theo schema */
const estimateRoundsForBracket = (b) => {
  if (!b) return 1;

  const fromMetaRounds =
    Number(b?.meta?.maxRounds) || Number(b?.drawRounds) || Number(b?.rounds);
  if (fromMetaRounds) return Math.max(1, fromMetaRounds);

  const metaDrawSize = Number(b?.meta?.drawSize) || 0;
  if (metaDrawSize >= 2) {
    const scale = ceilPow2(metaDrawSize);
    return Math.ceil(Math.log2(scale));
  }

  const reDraw = Number(b?.config?.roundElim?.drawSize) || 0;
  if (reDraw >= 2) {
    const scale = ceilPow2(reDraw);
    return Math.ceil(Math.log2(scale));
  }

  return 1;
};

const normalizeType = (t) => String(t || "").toLowerCase();
const isGroupType = (t) => {
  const x = normalizeType(t);
  return (
    x === "group" ||
    x === "round_robin" ||
    x === "gsl" ||
    x === "groups" ||
    x === "rr"
  );
};
const isKnockoutType = (t) => {
  const x = normalizeType(t);
  return (
    x === "knockout" ||
    x === "double_elim" ||
    x === "roundelim" ||
    x === "round_elim"
  );
};

/** Cộng dồn V theo thứ tự các brackets trước bracket hiện tại */
const computeBaseRoundStart = (brackets, currentBracketId) => {
  if (!Array.isArray(brackets) || !currentBracketId) return 1;
  let base = 1;
  for (const b of brackets) {
    const bid = String(b?._id || "");
    if (!bid) continue;
    if (bid === String(currentBracketId)) break;

    if (isGroupType(b?.type)) {
      base += 1;
    } else if (isKnockoutType(b?.type)) {
      base += estimateRoundsForBracket(b);
    }
  }
  return base;
};

// Lấy bracket cho match: ưu tiên m.bracket (đã populate), rồi mới tới list
const getBracketForMatch = (m, brackets) => {
  if (m?.bracket && typeof m.bracket === "object") return m.bracket;
  const id = m?.bracket?._id || m?.bracket || null;
  if (!id) return null;
  return (
    (brackets || []).find((b) => String(b?._id || "") === String(id)) || null
  );
};

const letterToIndex = (s) => {
  const ch = String(s || "")
    .trim()
    .toUpperCase();
  if (!ch) return null;
  const c = ch.charCodeAt(0);
  if (c >= 65 && c <= 90) return c - 65 + 1; // A=1
  return null;
};

const extractIndexFromToken = (token) => {
  const s = String(token || "").trim();
  if (!s) return null;

  if (/^[A-Za-z]$/.test(s)) return letterToIndex(s);

  const m1 = s.match(/\b([A-Za-z])\b/);
  if (m1?.[1]) {
    const idx = letterToIndex(m1[1]);
    if (idx) return idx;
  }

  const m2 = s.match(/\b(\d+)\b/);
  if (m2?.[1]) return Number(m2[1]);

  return null;
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const pickString = (incoming, fallback) => {
  if (typeof incoming === "string" && incoming.trim()) return incoming;
  return fallback;
};

const pickArray = (incoming, fallback) => {
  if (Array.isArray(incoming) && incoming.length > 0) return incoming;
  return Array.isArray(fallback) ? fallback : incoming;
};

const pickRicherArray = (incoming, fallback) => {
  const next = Array.isArray(incoming) ? incoming : [];
  const prev = Array.isArray(fallback) ? fallback : [];
  if (!next.length) return prev;
  if (!prev.length) return next;
  return next.length >= prev.length ? next : prev;
};

const mergeNestedObject = (previous, incoming) => {
  if (isPlainObject(previous) && isPlainObject(incoming)) {
    return { ...previous, ...incoming };
  }
  if (isPlainObject(incoming)) return incoming;
  return previous ?? incoming ?? null;
};

function mergeLockedMatchPayload(previous, incoming) {
  if (!incoming) return previous || null;
  if (!previous) return incoming;

  return {
    ...previous,
    ...incoming,
    status: pickString(incoming.status, previous.status),
    video: pickString(incoming.video, previous.video),
    videoUrl: pickString(incoming.videoUrl, previous.videoUrl),
    stream: pickString(incoming.stream, previous.stream),
    link: pickString(incoming.link, previous.link),
    url: pickString(incoming.url, previous.url),
    defaultStreamKey: pickString(
      incoming.defaultStreamKey,
      previous.defaultStreamKey,
    ),
    gameScores: pickArray(incoming.gameScores, previous.gameScores),
    streams: pickRicherArray(incoming.streams, previous.streams),
    videos: pickRicherArray(incoming.videos, previous.videos),
    links: isPlainObject(incoming.links)
      ? {
          ...(isPlainObject(previous.links) ? previous.links : {}),
          ...incoming.links,
          items: pickRicherArray(incoming.links?.items, previous.links?.items),
          video: pickString(incoming.links?.video, previous.links?.video),
          stream: pickString(incoming.links?.stream, previous.links?.stream),
          url: pickString(incoming.links?.url, previous.links?.url),
        }
      : previous.links,
    sources: isPlainObject(incoming.sources)
      ? {
          ...(isPlainObject(previous.sources) ? previous.sources : {}),
          ...incoming.sources,
          items: pickRicherArray(
            incoming.sources?.items,
            previous.sources?.items,
          ),
          video: pickString(incoming.sources?.video, previous.sources?.video),
          stream: pickString(
            incoming.sources?.stream,
            previous.sources?.stream,
          ),
          url: pickString(incoming.sources?.url, previous.sources?.url),
        }
      : previous.sources,
    meta: isPlainObject(incoming.meta)
      ? {
          ...(isPlainObject(previous.meta) ? previous.meta : {}),
          ...incoming.meta,
          video: pickString(incoming.meta?.video, previous.meta?.video),
          videoUrl: pickString(
            incoming.meta?.videoUrl,
            previous.meta?.videoUrl,
          ),
          stream: pickString(incoming.meta?.stream, previous.meta?.stream),
          streams: pickRicherArray(
            incoming.meta?.streams,
            previous.meta?.streams,
          ),
        }
      : previous.meta,
    tournament: mergeNestedObject(previous.tournament, incoming.tournament),
    bracket: mergeNestedObject(previous.bracket, incoming.bracket),
    pool: mergeNestedObject(previous.pool, incoming.pool),
    rules: mergeNestedObject(previous.rules, incoming.rules),
    pairA: mergeNestedObject(previous.pairA, incoming.pairA),
    pairB: mergeNestedObject(previous.pairB, incoming.pairB),
    liveBy: mergeNestedObject(previous.liveBy, incoming.liveBy),
    previousA: mergeNestedObject(previous.previousA, incoming.previousA),
    previousB: mergeNestedObject(previous.previousB, incoming.previousB),
    facebookLive: isPlainObject(incoming.facebookLive)
      ? {
          ...(isPlainObject(previous.facebookLive)
            ? previous.facebookLive
            : {}),
          ...incoming.facebookLive,
          permalink_url: pickString(
            incoming.facebookLive?.permalink_url,
            previous.facebookLive?.permalink_url,
          ),
          video_permalink_url: pickString(
            incoming.facebookLive?.video_permalink_url,
            previous.facebookLive?.video_permalink_url,
          ),
          watch_url: pickString(
            incoming.facebookLive?.watch_url,
            previous.facebookLive?.watch_url,
          ),
          embed_url: pickString(
            incoming.facebookLive?.embed_url,
            previous.facebookLive?.embed_url,
          ),
          raw_permalink_url: pickString(
            incoming.facebookLive?.raw_permalink_url,
            previous.facebookLive?.raw_permalink_url,
          ),
        }
      : previous.facebookLive,
  };
}

const groupNameCandidates = (g) =>
  [g?.name, g?.label, g?.groupName, g?.groupLabel, g?.title, g?.key].filter(
    Boolean,
  );

/** Trả về chỉ số bảng (1-based) nếu xác định được */
const resolveGroupIndex = (m, brackets) => {
  if (m?.pool) {
    const byName = extractIndexFromToken(m.pool.name);
    if (Number.isFinite(byName) && byName > 0) return byName;

    const poolId = m.pool.id || m.pool._id || null;
    if (poolId) {
      const br = getBracketForMatch(m, brackets);
      const groups = Array.isArray(br?.groups) ? br.groups : [];
      if (groups.length) {
        const i = groups.findIndex(
          (g) => String(g?._id || "") === String(poolId),
        );
        if (i >= 0) return i + 1;
      }
    }
  }

  const numericCandidates = [
    m?.groupIndex != null ? Number(m.groupIndex) + 1 : null,
    Number(m?.groupNo) || null,
    Number(m?.poolNo) || null,
    Number(m?.meta?.groupNo) || null,
    Number(m?.meta?.poolNo) || null,
  ].filter((x) => Number.isFinite(x) && x > 0);
  if (numericCandidates.length) return numericCandidates[0];

  const textSignals = [
    m?.groupLabel,
    m?.groupName,
    m?.poolLabel,
    m?.poolName,
    m?.meta?.groupLabel,
    m?.meta?.groupName,
    m?.groupKey,
    m?.poolKey,
    m?.meta?.groupKey,
    m?.meta?.poolKey,
  ].filter(Boolean);

  for (const t of textSignals) {
    const idx = extractIndexFromToken(t);
    if (Number.isFinite(idx) && idx > 0) return idx;
  }

  const br = getBracketForMatch(m, brackets);
  const groups = Array.isArray(br?.groups) ? br.groups : [];

  if (groups.length === 1) return 1;

  if (groups.length && textSignals.length) {
    for (const t of textSignals) {
      const needle = String(t || "")
        .trim()
        .toLowerCase();
      const hit = groups.findIndex((g) =>
        groupNameCandidates(g).some(
          (cand) =>
            String(cand || "")
              .trim()
              .toLowerCase() === needle,
        ),
      );
      if (hit >= 0) return hit + 1;
    }
  }

  for (const t of textSignals) {
    const li = letterToIndex(t);
    if (li) return li;
  }

  return null;
};

const makeMatchCode = (m, brackets) => {
  if (!m) return "";
  const br = getBracketForMatch(m, brackets);
  const currentBracketId = br?._id || m?.bracket?._id || m?.bracket || null;

  const baseRoundStart = computeBaseRoundStart(
    brackets || [],
    currentBracketId,
  );
  const roundIdx = Number.isFinite(Number(m?.rrRound || m?.round))
    ? Number(m.rrRound || m.round)
    : 1;
  const orderOneBased = Number.isFinite(Number(m?.order))
    ? Number(m.order) + 1
    : 1;

  const displayRound = baseRoundStart + (roundIdx - 1);

  const typeOrFormat = normalizeType(br?.type || m?.type || m?.format);
  if (isGroupType(typeOrFormat) || normalizeType(m?.format) === "group") {
    const bIdx = resolveGroupIndex(m, brackets);
    if (bIdx) return `V${1}-B${bIdx}-T${orderOneBased}`;
  }

  return `V${displayRound}-T${orderOneBased}`;
};

/* =========================
 * Hook: LOCK match theo matchId (chỉ nhận data đúng id)
 * ========================= */
function useLockedDialogMatch({
  open,
  matchId,
  initialMatch,
  base,
  live,
  courtMatch,
  isLoadingBase,
  isLoadingLive,
  isLoadingCourt,
}) {
  const lockedId = String(matchId || "");
  const previousLockedIdRef = useRef("");
  const pick = useCallback(
    (cand) => {
      const id = String(cand?._id || cand?.id || "");
      return id && id === lockedId ? cand : null;
    },
    [lockedId],
  );
  const buildMerged = useCallback(() => {
    let merged = null;
    [initialMatch, courtMatch, base, live].forEach((cand) => {
      merged = mergeLockedMatchPayload(merged, pick(cand));
    });
    return merged;
  }, [base, courtMatch, initialMatch, live, pick]);
  const pickInitial = () => {
    return buildMerged();
  };
  const [mm, setMm] = useState(() => pickInitial());

  // Reset khi đổi match hoặc đóng dialog
  useEffect(() => {
    if (!open || !lockedId) {
      previousLockedIdRef.current = "";
      const t = setTimeout(() => {
        setMm(null);
      }, 300); // Đợi Dialog MUI ẩn hẳn (duration ~225ms) mới clear data để tránh flash lỗi "Không tải được dữ liệu"
      return () => clearTimeout(t);
    }

    const seeded = buildMerged();
    const isMatchChanged = previousLockedIdRef.current !== lockedId;
    previousLockedIdRef.current = lockedId;

    setMm((prev) => {
      if (isMatchChanged) return seeded || null;
      if (!seeded) return prev;
      if (!prev) return seeded;
      return mergeLockedMatchPayload(prev, seeded);
    });
  }, [open, lockedId, initialMatch, base, live, courtMatch, buildMerged]);

  // Nhận dữ liệu — chỉ lấy data trùng matchId
  // (đã gộp logic từ effect trước đó, không cần 2 effect chạy cùng deps)

  const loading =
    (!mm && (isLoadingBase || isLoadingLive || isLoadingCourt)) ||
    (!mm && open);

  return { mm, loading };
}

/* =========================
 * ResponsiveMatchViewer (đã khóa theo matchId)
 * ========================= */
function ResponsiveMatchViewerBody({
  open,
  matchId,
  courtStationId: forcedCourtStationId = null,
  initialMatch = null,
  onClose,
  zIndex,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { userInfo } = useSelector((s) => s.auth || {});
  const token = userInfo?.token;
  const openTraceRef = useRef("");

  const { data: seedBase, refetch: refetchSeedBase } = useGetMatchPublicQuery(
    matchId,
    {
      skip: !matchId || !open,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    },
  );
  const activeCourtStationId = useMemo(
    () =>
      String(
        forcedCourtStationId ||
          initialMatch?.courtStationId ||
          initialMatch?.courtStation?._id ||
          seedBase?.courtStationId ||
          "",
      ).trim(),
    [forcedCourtStationId, initialMatch, seedBase?.courtStationId],
  );
  const {
    data: liveCourt,
    isFetching: isFetchingCourt,
    refetch: refetchLiveCourt,
  } = useGetLiveCourtQuery(activeCourtStationId, {
    skip: !open || !activeCourtStationId,
    pollingInterval: 5000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
  const effectiveMatchId = matchId || liveCourt?.currentMatch?._id || null;

  // Queries
  const {
    data: base,
    isLoading: isLoadingBase,
    refetch: refetchBase,
  } = useGetMatchPublicQuery(effectiveMatchId, {
    skip: !effectiveMatchId || !open,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
  const { loading: isLoadingLive, data: live } = useLiveMatch(
    open ? effectiveMatchId : null,
    token,
  );

  // LOCK: chỉ lấy data trùng matchId
  const { mm, loading } = useLockedDialogMatch({
    open,
    matchId: effectiveMatchId,
    initialMatch,
    base,
    live,
    courtMatch: liveCourt?.currentMatch || null,
    isLoadingBase,
    isLoadingLive,
    isLoadingCourt: isFetchingCourt,
  });

  // TournamentId cho brackets dựa trên match đã LOCK
  const tournamentId = useMemo(() => {
    if (!mm) return null;
    if (mm.tournament && typeof mm.tournament === "object") {
      return mm.tournament._id || mm.tournament.id || null;
    }
    return mm.tournament || null;
  }, [mm]);

  const { data: brackets = [], refetch: refetchBrackets } =
    useListTournamentBracketsQuery(tournamentId, {
      skip: !open || !tournamentId,
    });

  const code = mm ? makeMatchCode(mm, brackets) : "";
  const status = mm?.status || "scheduled";

  useEffect(() => {
    if (!open || !effectiveMatchId) return;
    const traceKey = `${effectiveMatchId}:${activeCourtStationId || "no-court"}`;
    if (openTraceRef.current === traceKey) return;
    openTraceRef.current = traceKey;

    addBusinessBreadcrumb("live.viewer.open", {
      source: "responsive_match_viewer",
      matchId: effectiveMatchId,
      matchCode:
        code ||
        initialMatch?.displayCode ||
        initialMatch?.code ||
        initialMatch?.globalCode ||
        undefined,
      courtStationId: activeCourtStationId || undefined,
      status,
      isMobile,
    });
  }, [
    activeCourtStationId,
    code,
    effectiveMatchId,
    initialMatch?.code,
    initialMatch?.displayCode,
    initialMatch?.globalCode,
    isMobile,
    open,
    status,
  ]);

  useEffect(() => {
    if (!open) {
      openTraceRef.current = "";
    }
  }, [open]);

  const StatusChip = (
    <Chip
      size="small"
      sx={{
        ml: 1,
        ...(status === "live" && {
          bgcolor: "#f97316", // Explicit orange
          color: "#ffffff",
          fontWeight: 600,
        }),
      }}
      label={
        status === "live"
          ? "Đang diễn ra"
          : status === "finished"
            ? "Hoàn thành"
            : "Dự kiến"
      }
      color={
        status === "finished"
          ? "success"
          : status !== "live"
            ? "default"
            : "warning"
      }
    />
  );

  const handleSaved = () => {
    // Refetch dữ liệu public + brackets; UI trong dialog không bị nhảy vì đã LOCK theo matchId
    refetchSeedBase?.();
    refetchBase?.();
    refetchBrackets?.();
    refetchLiveCourt?.();
  };
  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        keepMounted
        sx={{ ...(zIndex ? { zIndex } : {}) }}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            height: "92vh",
            maxHeight: "100vh",
            minHeight: "80vh",
          },
        }}
      >
        <Box
          sx={{
            p: 2,
            pt: 1.25,
            maxWidth: 1000,
            mx: "auto",
            width: "100%",
            pb: 6,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 4,
              bgcolor: "text.disabled",
              borderRadius: 2,
              mx: "auto",
              mb: 1.25,
            }}
          />
          <Box sx={{ position: "relative", pb: 1 }}>
            <Typography variant="h6">
              Trận đấu • {code}
              {StatusChip}
            </Typography>
            <IconButton
              onClick={onClose}
              sx={{ position: "absolute", right: -6, top: -6 }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          <Box sx={{ overflowY: "auto", pr: { md: 1 }, pb: 1 }}>
            <MatchContent
              key={String(effectiveMatchId || matchId || "")}
              m={mm}
              isLoading={loading}
              liveLoading={false}
              onSaved={handleSaved}
            />
          </Box>
        </Box>
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      sx={{ ...(zIndex ? { zIndex } : {}) }}
    >
      <DialogTitle sx={{ pr: 6 }}>
        Trận đấu • {code}
        {StatusChip}
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 10 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <MatchContent
          key={String(effectiveMatchId || matchId || "")}
          m={mm}
          isLoading={loading}
          liveLoading={false}
          onSaved={handleSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

export default function ResponsiveMatchViewer(props) {
  const viewerKey = String(
    props.matchId ||
      props.courtStationId ||
      props.initialMatch?._id ||
      props.initialMatch?.id ||
      "",
  );

  return <ResponsiveMatchViewerBody key={viewerKey} {...props} />;
}
