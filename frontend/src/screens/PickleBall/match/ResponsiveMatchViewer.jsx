// src/screens/PickleBall/match/ResponsiveMatchViewer.jsx
import React, { useEffect, useMemo, useState } from "react";
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

const groupNameCandidates = (g) =>
  [g?.name, g?.label, g?.groupName, g?.groupLabel, g?.title, g?.key].filter(
    Boolean
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
          (g) => String(g?._id || "") === String(poolId)
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
              .toLowerCase() === needle
        )
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
    currentBracketId
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
  base,
  live,
  isLoadingBase,
  isLoadingLive,
}) {
  const lockedId = String(matchId || "");
  const [mm, setMm] = useState(null);

  // Reset khi đổi match hoặc đóng dialog
  useEffect(() => {
    if (!open || !lockedId) {
      setMm(null);
      return;
    }
    // khi mở lại thì cho phép nhận dữ liệu mới đúng id
    // (mm sẽ được set ở effect dưới)
  }, [open, lockedId]);

  // Nhận dữ liệu nhưng chỉ khi _id trùng matchId
  useEffect(() => {
    if (!open || !lockedId) return;

    const pick = (cand) => {
      const id = String(cand?._id || cand?.id || "");
      return id && id === lockedId ? cand : null;
    };

    // Ưu tiên live nếu đúng id, nếu không thì base
    const next = pick(live) || pick(base);
    if (!next) return;

    setMm((prev) => {
      // nếu cùng id thì cập nhật, không cần so sánh sâu
      if (!prev) return next;
      const prevId = String(prev?._id || prev?.id || "");
      return prevId === lockedId ? next : prev;
    });
  }, [open, lockedId, base, live]);

  const loading = (!mm && (isLoadingBase || isLoadingLive)) || (!mm && open);

  return { mm, loading };
}

/* =========================
 * ResponsiveMatchViewer (đã khóa theo matchId)
 * ========================= */
function ResponsiveMatchViewer({ open, matchId, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { userInfo } = useSelector((s) => s.auth || {});
  const token = userInfo?.token;

  // Queries
  const {
    data: base,
    isLoading: isLoadingBase,
    refetch: refetchBase,
  } = useGetMatchPublicQuery(matchId, {
    skip: !matchId || !open,
  });
  const { loading: isLoadingLive, data: live } = useLiveMatch(
    open ? matchId : null,
    token
  );

  // LOCK: chỉ lấy data trùng matchId
  const { mm, loading } = useLockedDialogMatch({
    open,
    matchId,
    base,
    live,
    isLoadingBase,
    isLoadingLive,
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
      skip: !tournamentId,
    });

  const code = mm ? makeMatchCode(mm, brackets) : "";
  const status = mm?.status || "scheduled";

  const StatusChip = (
    <Chip
      size="small"
      sx={{ ml: 1 }}
      label={
        status === "live"
          ? "Đang diễn ra"
          : status === "finished"
          ? "Hoàn thành"
          : "Dự kiến"
      }
      color={
        status === "live"
          ? "warning"
          : status === "finished"
          ? "success"
          : "default"
      }
    />
  );

  const handleSaved = () => {
    // Refetch dữ liệu public + brackets; UI trong dialog không bị nhảy vì đã LOCK theo matchId
    refetchBase?.();
    refetchBrackets?.();
  };

  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        keepMounted
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
              key={String(matchId || "")} // remount khi đổi trận
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
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
          key={String(matchId || "")} // remount khi đổi trận
          m={mm}
          isLoading={loading}
          liveLoading={false}
          onSaved={handleSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

export default ResponsiveMatchViewer;
