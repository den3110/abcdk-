/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  Add as AddIcon,
  Cached as CachedIcon,
  Casino as CasinoIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Healing as HealingIcon,
  LocationOn as LocationOnIcon,
  OpenInNew as OpenInNewIcon,
  PauseCircleOutline as PauseCircleOutlineIcon,
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  SportsTennis as SportsTennisIcon,
  SwapCalls as SwapCallsIcon,
  SwapHoriz as SwapHorizIcon,
  SwapVert as SwapVertIcon,
  Sync as SyncIcon,
  Undo as UndoIcon,
} from "@mui/icons-material";
import { useSelector } from "react-redux";
import { useLiveMatch } from "../../hook/useLiveMatch";
import {
  getMatchCourtStationName,
  getMatchDisplayCode,
  getMatchSideDisplayName,
  getPlayerDisplayName,
  normalizeMatchDisplay,
} from "../../utils/matchDisplay";

const textOf = (value) => (value && String(value).trim()) || "";

const playerLabel = (player, source) => getPlayerDisplayName(player, source) || "";

const matchCode = (match) =>
  getMatchDisplayCode(match) ||
  textOf(match?.displayCode) ||
  textOf(match?.globalCode) ||
  textOf(match?.code) ||
  `R${match?.round ?? "?"}-${(match?.order ?? 0) + 1}`;

const courtLabelOf = (match) =>
  textOf(getMatchCourtStationName(match)) ||
  textOf(match?.courtStationName) ||
  textOf(match?.courtStationLabel) ||
  textOf(match?.courtLabel) ||
  textOf(match?.court?.name) ||
  textOf(match?.court?.label) ||
  "Chưa gán sân";

const sidePairOf = (match, side) => {
  if (side === "A") {
    return match?.pairA || match?.teams?.A || match?.teamA || match?.sideA || null;
  }
  return match?.pairB || match?.teams?.B || match?.teamB || match?.sideB || null;
};

const currentGameIndexOf = (match) => {
  const value = Number(match?.currentGame);
  return Number.isInteger(value) && value >= 0 ? value : 0;
};

const scoreValue = (entry, key) =>
  Number(entry?.[key] ?? entry?.[key.toUpperCase()] ?? 0);

const gameScoresOf = (match) =>
  (Array.isArray(match?.gameScores)
    ? match.gameScores
    : Array.isArray(match?.scores)
      ? match.scores
      : []
  ).map((item) => ({
    a: scoreValue(item, "a"),
    b: scoreValue(item, "b"),
  }));

const currentScoreOf = (match) => {
  const scores = gameScoresOf(match);
  const index = currentGameIndexOf(match);
  const game = scores[index] || {};
  return {
    a: Number(game?.a || 0),
    b: Number(game?.b || 0),
  };
};

const flipSlotNumbers = (source = {}) =>
  Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      Number(value) === 1 ? 2 : Number(value) === 2 ? 1 : value,
    ]),
  );

const ownerLabel = (owner) =>
  textOf(owner?.displayName) || textOf(owner?.deviceName) || "trọng tài khác";

const needWins = (bestOf = 3) => Math.floor(bestOf / 2) + 1;

const isGameWin = (a = 0, b = 0, pointsToWin = 11, winByTwo = true) => {
  const max = Math.max(Number(a || 0), Number(b || 0));
  const min = Math.min(Number(a || 0), Number(b || 0));
  if (max < Number(pointsToWin || 11)) return false;
  return winByTwo ? max - min >= 2 : max - min >= 1;
};

const currentSlotFromBase = (base, teamScore) =>
  Number(teamScore || 0) % 2 === 0 ? Number(base || 1) : Number(base || 1) === 1 ? 2 : 1;

const normalizeLayout = (layout) =>
  layout?.left === "B" || layout?.right === "A"
    ? { left: "B", right: "A" }
    : { left: "A", right: "B" };

const preStartRightSlotForSide = (side, layout) =>
  normalizeLayout(layout).left === side ? 2 : 1;

const breakTypeFromNote = (note) => {
  const prefix = textOf(note).split(":")[0].trim().toLowerCase();
  return prefix === "medical" || prefix === "timeout" ? prefix : "";
};

const normalizeBreakState = (rawBreak) => {
  if (!rawBreak) return null;
  if (typeof rawBreak === "object") {
    const note = textOf(rawBreak.note);
    return {
      active:
        rawBreak.active === true ||
        rawBreak.isActive === true ||
        rawBreak.enabled === true,
      afterGame:
        typeof rawBreak.afterGame === "number" ? rawBreak.afterGame : null,
      note,
      startedAt: rawBreak.startedAt || rawBreak.startAt || null,
      expectedResumeAt:
        rawBreak.expectedResumeAt || rawBreak.resumeAt || rawBreak.endTime || null,
      type: textOf(rawBreak.type).toLowerCase() || breakTypeFromNote(note),
    };
  }
  const normalized = String(rawBreak).toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return { active: true, note: "", expectedResumeAt: null, type: "timeout" };
  }
  return null;
};

const userIdOf = (user) => {
  const raw = user?.user?._id || user?.user || user?._id || user?.id || user?.uid;
  if (raw) return String(raw);
  return (
    textOf(user?.fullName) ||
    textOf(user?.name) ||
    textOf(user?.displayName) ||
    textOf(user?.nickName) ||
    ""
  );
};

const playerIdCandidatesOf = (player) => {
  const candidates = [
    player?.user?._id,
    player?.user,
    player?._id,
    player?.id,
    player?.uid,
    player?.fullName,
    player?.name,
    player?.displayName,
    player?.nickName,
    player?.nickname,
  ]
    .map((value) => textOf(value))
    .filter(Boolean);

  return [...new Set(candidates)];
};

const resolveBaseSlotForPlayer = (player, teamBase = {}) => {
  const keys = playerIdCandidatesOf(player);
  for (const key of keys) {
    const slot = Number(teamBase?.[key]);
    if (slot === 1 || slot === 2) return slot;
  }
  return null;
};

const normalizeSlotsBaseForPlayers = (players, rawTeamBase = {}) => {
  const teamBase = rawTeamBase && typeof rawTeamBase === "object" ? { ...rawTeamBase } : {};
  (Array.isArray(players) ? players : []).slice(0, 2).forEach((player, index) => {
    const existingSlot = resolveBaseSlotForPlayer(player, teamBase);
    if (existingSlot === 1 || existingSlot === 2) return;
    const fallbackKey = playerIdCandidatesOf(player)[0] || userIdOf(player);
    if (!fallbackKey) return;
    teamBase[fallbackKey] = index === 0 ? 1 : 2;
  });
  return teamBase;
};

const playerMatchesId = (player, value) => {
  const target = textOf(value);
  if (!target) return false;
  return playerIdCandidatesOf(player).some((candidate) => candidate === target);
};

const playerCurrentSlot = (player, side, base = {}, score = { a: 0, b: 0 }) => {
  const teamBase = base?.[side] || {};
  const baseSlot = resolveBaseSlotForPlayer(player, teamBase);
  if (baseSlot !== 1 && baseSlot !== 2) return null;
  const teamScore = side === "A" ? Number(score?.a || 0) : Number(score?.b || 0);
  return Number(currentSlotFromBase(baseSlot, teamScore));
};

const orderPlayersForPanel = (
  players,
  { side, base = {}, score = { a: 0, b: 0 } } = {},
) => {
  const list = Array.isArray(players) ? [...players] : [];
  return list
    .map((player, index) => ({
      player,
      index,
      slot: playerCurrentSlot(player, side, base, score),
    }))
    .sort((left, right) => {
      const leftSlot = Number.isFinite(left.slot) ? left.slot : Number.POSITIVE_INFINITY;
      const rightSlot = Number.isFinite(right.slot) ? right.slot : Number.POSITIVE_INFINITY;
      if (leftSlot !== rightSlot) return leftSlot - rightSlot;
      return left.index - right.index;
    })
    .map((item) => item.player);
};

const playersOf = (entry, eventType = "double") => {
  const normalizedEventType =
    textOf(eventType).toLowerCase() === "single" ? "single" : "double";
  if (!entry) return [];
  if (Array.isArray(entry?.players) && entry.players.length) {
    return entry.players.filter(Boolean);
  }
  if (normalizedEventType === "single") {
    const singlePlayer = entry?.player1 || entry?.p1 || entry?.user || entry;
    return singlePlayer ? [singlePlayer] : [];
  }
  return [entry?.player1 || entry?.p1, entry?.player2 || entry?.p2].filter(Boolean);
};

const firstPlayerIdOfSide = (match, side, eventType) =>
  userIdOf(playersOf(sidePairOf(match, side), eventType)[0]);

function BreakCountdown({ endTime, color = "#ef4444" }) {
  const [text, setText] = useState("00:00");

  useEffect(() => {
    if (!endTime) {
      setText("00:00");
      return undefined;
    }

    const render = () => {
      const target = new Date(endTime).getTime();
      if (!Number.isFinite(target)) {
        setText("00:00");
        return;
      }
      const diff = Math.max(0, target - Date.now());
      const minutes = String(Math.floor(diff / 60000)).padStart(2, "0");
      const seconds = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
      setText(`${minutes}:${seconds}`);
    };

    render();
    const timer = window.setInterval(render, 1000);
    return () => window.clearInterval(timer);
  }, [endTime]);

  return (
    <Typography
      sx={{
        fontSize: { xs: 28, md: 34 },
        fontWeight: 900,
        letterSpacing: "-0.04em",
        color,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {text}
    </Typography>
  );
}

function LiveClock({ color = "inherit" }) {
  const [text, setText] = useState(() =>
    new Date().toLocaleTimeString("vi-VN", { hour12: false }),
  );

  useEffect(() => {
    const render = () =>
      setText(new Date().toLocaleTimeString("vi-VN", { hour12: false }));
    render();
    const timer = window.setInterval(render, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Typography
      sx={{
        color,
        fontWeight: 900,
        fontSize: { xs: 18, md: 20 },
        letterSpacing: "-0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {text}
    </Typography>
  );
}

function PlayerRow({ label, isServer, muted, borderColor, accentColor }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="flex-start"
      spacing={1}
      sx={{
        px: 1.25,
        py: 0.9,
        borderRadius: 999,
        border: "1px solid",
        borderColor,
        bgcolor: isServer ? alpha(accentColor, 0.16) : alpha("#ffffff", 0.02),
        minHeight: 40,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: isServer ? accentColor : alpha(muted, 0.34),
            boxShadow: isServer ? `0 0 0 4px ${alpha(accentColor, 0.18)}` : "none",
            flexShrink: 0,
          }}
        />
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: isServer ? 800 : 600,
            color: "#f8fafc",
            lineHeight: 1.2,
          }}
        >
          {label || "Chưa có VĐV"}
        </Typography>
      </Stack>
    </Stack>
  );
}

function TeamPanel({
  title,
  teamLabel,
  players,
  isServing,
  isActiveSide,
  serverUid,
  onSwapSlots,
  match,
  muted,
  borderColor,
  accentColor,
  align = "left",
  swapDisabled = false,
}) {
  const alignedText = align === "right" ? "right" : "left";

  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        borderRadius: 4,
        border: "1px solid",
        borderColor: isActiveSide ? alpha(accentColor, 0.62) : borderColor,
        bgcolor: isActiveSide ? alpha(accentColor, 0.14) : alpha("#ffffff", 0.02),
        p: { xs: 1.4, md: 1.8 },
        display: "flex",
        flexDirection: "column",
        gap: 1.2,
        minHeight: { xs: 196, md: 224 },
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        sx={{ flexWrap: "wrap" }}
      >
        <Chip
          size="small"
          icon={<SportsTennisIcon sx={{ fontSize: 16 }} />}
          label={title}
          sx={{
            fontWeight: 800,
            bgcolor: isServing ? alpha(accentColor, 0.22) : alpha("#ffffff", 0.05),
            color: isServing ? accentColor : muted,
            border: "1px solid",
            borderColor: isServing ? alpha(accentColor, 0.36) : borderColor,
          }}
        />
        <Button
          size="small"
          variant="text"
          onClick={onSwapSlots}
          disabled={swapDisabled}
          sx={{
            minWidth: 0,
            px: 1.1,
            py: 0.55,
            borderRadius: 999,
            color: muted,
            fontWeight: 800,
            textTransform: "none",
          }}
        >
          Đổi tay
        </Button>
      </Stack>

      <Box sx={{ textAlign: alignedText }}>
        <Typography
          sx={{
            fontSize: { xs: 19, md: 24 },
            fontWeight: 900,
            letterSpacing: "-0.03em",
            color: "#f8fafc",
            lineHeight: 1.05,
          }}
        >
          {teamLabel}
        </Typography>
      </Box>

      <Stack spacing={1}>
        {players.length ? (
          players.map((player) => {
            const uid = userIdOf(player);
            return (
              <PlayerRow
                key={uid || playerLabel(player, match)}
                label={playerLabel(player, match)}
                isServer={playerMatchesId(player, serverUid)}
                muted={muted}
                borderColor={borderColor}
                accentColor={accentColor}
              />
            );
          })
        ) : (
          <PlayerRow
            label="Chưa đủ VĐV"
            slot="?"
            isServer={false}
            muted={muted}
            borderColor={borderColor}
            accentColor={accentColor}
          />
        )}
      </Stack>
    </Box>
  );
}

export default function RefereeScoreDialog({
  open,
  matchId,
  initialMatch = null,
  onClose,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { userInfo } = useSelector((state) => state.auth || {});
  const token = userInfo?.token || "";
  const { data, error, api, sync } = useLiveMatch(matchId, token, {
    offlineSync: true,
    enabled: open && Boolean(matchId),
  });

  const match = useMemo(
    () => normalizeMatchDisplay(data || initialMatch || null, data || initialMatch || null),
    [data, initialMatch],
  );

  const ui = useMemo(
    () => ({
      paper:
        theme.palette.mode === "dark"
          ? "linear-gradient(180deg, #121417 0%, #0a0b0d 100%)"
          : "linear-gradient(180deg, #f7f9fc 0%, #edf2fb 100%)",
      panel:
        theme.palette.mode === "dark"
          ? "rgba(19, 22, 26, 0.94)"
          : "rgba(255, 255, 255, 0.98)",
      card:
        theme.palette.mode === "dark"
          ? "rgba(20, 23, 27, 0.98)"
          : "rgba(255,255,255,0.98)",
      border:
        theme.palette.mode === "dark"
          ? "rgba(255,255,255,0.09)"
          : "rgba(15,23,42,0.08)",
      softBorder:
        theme.palette.mode === "dark"
          ? "rgba(255,255,255,0.06)"
          : "rgba(15,23,42,0.05)",
      muted:
        theme.palette.mode === "dark"
          ? "rgba(226,232,240,0.72)"
          : "rgba(51,65,85,0.76)",
      text: theme.palette.mode === "dark" ? "#f8fafc" : "#0f172a",
      accent: theme.palette.mode === "dark" ? "#60a5fa" : "#2563eb",
      accentSoft:
        theme.palette.mode === "dark"
          ? "rgba(96,165,250,0.16)"
          : "rgba(37,99,235,0.12)",
      success: "#22c55e",
      warning: "#f59e0b",
      danger: "#ef4444",
    }),
    [theme],
  );

  const eventType =
    textOf(match?.tournament?.eventType || match?.eventType).toLowerCase() === "single"
      ? "single"
      : "double";
  const rules = useMemo(
    () => ({
      bestOf: Number(match?.rules?.bestOf ?? 3),
      pointsToWin: Number(match?.rules?.pointsToWin ?? 11),
      winByTwo: Boolean(match?.rules?.winByTwo ?? true),
    }),
    [match?.rules?.bestOf, match?.rules?.pointsToWin, match?.rules?.winByTwo],
  );

  const gameScores = useMemo(() => gameScoresOf(match), [match]);
  const currentGame = currentGameIndexOf(match || {});
  const currentScore = useMemo(() => currentScoreOf(match || {}), [match]);
  const breakState = useMemo(
    () => normalizeBreakState(match?.isBreak || match?.break || match?.pause),
    [match?.break, match?.isBreak, match?.pause],
  );
  const rawBase = useMemo(
    () => match?.slots?.base || match?.meta?.slots?.base || { A: {}, B: {} },
    [match?.meta?.slots?.base, match?.slots?.base],
  );
  const currentLayout = useMemo(
    () => normalizeLayout(match?.meta?.refereeLayout),
    [match?.meta?.refereeLayout],
  );
  const activeSide = match?.serve?.side === "B" ? "B" : "A";
  const rawServerNum = Number(match?.serve?.server ?? 1) === 2 ? 2 : 1;
  const leftSide = currentLayout.left;
  const rightSide = currentLayout.right;
  const isDouble = eventType !== "single";
  const playersA = useMemo(() => playersOf(sidePairOf(match, "A"), eventType), [eventType, match]);
  const playersB = useMemo(() => playersOf(sidePairOf(match, "B"), eventType), [eventType, match]);
  const pairPlayers = useMemo(() => ({ A: playersA, B: playersB }), [playersA, playersB]);
  const currentBase = useMemo(
    () => ({
      A: normalizeSlotsBaseForPlayers(pairPlayers.A || [], rawBase?.A || {}),
      B: normalizeSlotsBaseForPlayers(pairPlayers.B || [], rawBase?.B || {}),
    }),
    [pairPlayers, rawBase],
  );
  const displayedPlayers = useMemo(
    () => ({
      left: orderPlayersForPanel(pairPlayers[leftSide] || [], {
        side: leftSide,
        base: currentBase,
        score: currentScore,
      }),
      right: orderPlayersForPanel(pairPlayers[rightSide] || [], {
        side: rightSide,
        base: currentBase,
        score: currentScore,
      }),
    }),
    [currentBase, currentScore, leftSide, pairPlayers, rightSide],
  );

  const wins = useMemo(() => {
    return gameScores.reduce(
      (acc, score) => {
        if (!isGameWin(score?.a, score?.b, rules.pointsToWin, rules.winByTwo)) return acc;
        if (Number(score?.a || 0) > Number(score?.b || 0)) acc.a += 1;
        if (Number(score?.b || 0) > Number(score?.a || 0)) acc.b += 1;
        return acc;
      },
      { a: 0, b: 0 },
    );
  }, [gameScores, rules.pointsToWin, rules.winByTwo]);

  const leftGameScore = leftSide === "A" ? currentScore.a : currentScore.b;
  const rightGameScore = rightSide === "A" ? currentScore.a : currentScore.b;
  const leftSetWins = leftSide === "A" ? wins.a : wins.b;
  const rightSetWins = rightSide === "A" ? wins.a : wins.b;
  const matchDecided =
    match?.status === "finished" ||
    wins.a >= needWins(rules.bestOf) ||
    wins.b >= needWins(rules.bestOf);
  const currentGameFinished = isGameWin(
    currentScore.a,
    currentScore.b,
    rules.pointsToWin,
    rules.winByTwo,
  );
  const waitingNextGameStart =
    Boolean(match?._id) &&
    Boolean(breakState?.active) &&
    Number.isInteger(breakState?.afterGame) &&
    Number(breakState.afterGame) < Number(currentGame) &&
    Number(currentScore.a) === 0 &&
    Number(currentScore.b) === 0;
  const needsStartAction =
    Boolean(match?._id) &&
    ((match?.status !== "live" && match?.status !== "finished") || waitingNextGameStart);
  const activeServerNum = needsStartAction && isDouble ? 1 : rawServerNum;
  const isOpeningServe =
    isDouble && Boolean(match?.serve?.opening) && activeServerNum === 1;
  const isPreStartOrOpening =
    needsStartAction ||
    (Number(currentScore.a) === 0 && Number(currentScore.b) === 0 && isOpeningServe);
  const isOwner = sync?.isOwner ?? true;
  const featureEnabled = sync?.featureEnabled !== false;
  const isBreakActive = Boolean(breakState?.active);
  const breakLocksLiveControls =
    Boolean(match?._id) && match?.status === "live" && isBreakActive;
  const canScoreByMatchState =
    Boolean(match?._id) &&
    match?.status === "live" &&
    !breakLocksLiveControls;
  const canUndo =
    Boolean(match?._id) && match?.status === "live" && !breakLocksLiveControls;

  const [pointsToWin, setPointsToWin] = useState("");
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [courts, setCourts] = useState([]);
  const [courtsLoading, setCourtsLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [courtDialogOpen, setCourtDialogOpen] = useState(false);
  const [toast, setToast] = useState({
    open: false,
    message: "",
    severity: "info",
  });

  const currentCourtId = textOf(match?.court?._id || match?.courtId || match?.courtStationId);
  const currentCourtLabel = courtLabelOf(match || {});
  const isInteractionLocked = Boolean(match?._id) && featureEnabled && !isOwner;

  useEffect(() => {
    setPointsToWin(
      match?.rules?.pointsToWin != null ? String(match.rules.pointsToWin) : "",
    );
  }, [match?.rules?.pointsToWin]);

  useEffect(() => {
    setSelectedCourtId(currentCourtId);
  }, [currentCourtId]);

  const findUidAtCurrentSlot = useCallback(
    (side, slot, base = currentBase, score = currentScore) => {
      const teamScore = side === "A" ? score.a : score.b;
      return (
        Object.entries(base?.[side] || {}).find(
          ([, value]) => Number(currentSlotFromBase(value, teamScore)) === Number(slot),
        )?.[0] || ""
      );
    },
    [currentBase, currentScore],
  );

  const serverUidShow = useMemo(() => {
    const serveUid = textOf(match?.serve?.serverId);
    if (serveUid) return serveUid;
    const fallbackSlot = isPreStartOrOpening
      ? preStartRightSlotForSide(activeSide, currentLayout)
      : activeServerNum;
    const fallback = findUidAtCurrentSlot(activeSide, fallbackSlot);
    return fallback || "";
  }, [
    activeServerNum,
    activeSide,
    currentLayout,
    findUidAtCurrentSlot,
    isPreStartOrOpening,
    match?.serve?.serverId,
  ]);

  const headerText = [
    String(matchCode(match || {})).toUpperCase(),
    `BO${rules.bestOf}`,
    `G${currentGame + 1}`,
  ].join(" | ");

  const preStartServeSideLabel =
    activeSide === leftSide ? "Đội bên trái" : "Đội bên phải";
  const serveNotation = useMemo(() => {
    const servingScore = activeSide === "A" ? currentScore.a : currentScore.b;
    const receivingScore = activeSide === "A" ? currentScore.b : currentScore.a;
    return `${servingScore}-${receivingScore}-${activeServerNum}`;
  }, [activeServerNum, activeSide, currentScore.a, currentScore.b]);
  const callout = useMemo(() => {
    if (breakState?.active) {
      return breakState?.type === "medical"
        ? "Nghỉ y tế đang diễn ra"
        : "Timeout đang diễn ra";
    }
    if (needsStartAction) {
      return isDouble ? "0-0-1" : "0-0";
    }
    return serveNotation;
  }, [breakState?.active, breakState?.type, isDouble, needsStartAction, serveNotation]);

  const handleError = useCallback((nextError) => {
    setActionError(textOf(nextError?.message) || "Thao tác không thành công.");
  }, []);

  const pushToast = useCallback((message, severity = "info") => {
    setToast({
      open: true,
      message,
      severity,
    });
  }, []);

  const closeToast = useCallback(() => {
    setToast((prev) => ({ ...prev, open: false }));
  }, []);

  const ensureInteractionAllowed = useCallback(() => {
    if (!match?._id) return false;
    if (!isInteractionLocked) return true;
    const lockedMessage = sync?.hasConflict
      ? `Trận đang bị khóa bởi ${ownerLabel(sync?.owner)}.`
      : `Trận đang do ${ownerLabel(sync?.owner)} điều khiển.`;
    pushToast(lockedMessage, "info");
    return false;
  }, [isInteractionLocked, match?._id, pushToast, sync?.hasConflict, sync?.owner]);

  const ensureLiveControlsAllowed = useCallback(() => {
    if (!ensureInteractionAllowed()) return false;
    if (!breakLocksLiveControls) return true;
    pushToast(
      breakState?.type === "medical"
        ? "Nghỉ y tế đang bật, hãy tiếp tục trận trước khi đổi vị trí, đổi giao hoặc chấm điểm."
        : "Timeout đang bật, hãy tiếp tục trận trước khi đổi vị trí, đổi giao hoặc chấm điểm.",
      "info",
    );
    return false;
  }, [breakLocksLiveControls, breakState?.type, ensureInteractionAllowed, pushToast]);

  const runBusy = useCallback(
    async (key, task) => {
      setActionError("");
      setBusy(key);
      try {
        await task();
      } catch (nextError) {
        handleError(nextError);
      } finally {
        setBusy("");
      }
    },
    [handleError],
  );

  const runProtectedBusy = useCallback(
    async (key, task) => {
      if (!ensureInteractionAllowed()) return;
      await runBusy(key, task);
    },
    [ensureInteractionAllowed, runBusy],
  );

  const runLiveControlBusy = useCallback(
    async (key, task) => {
      if (!ensureLiveControlsAllowed()) return;
      await runBusy(key, task);
    },
    [ensureLiveControlsAllowed, runBusy],
  );

  const loadCourts = useCallback(async () => {
    setCourtsLoading(true);
    await runBusy("courts", async () => {
      const result = await api.listCourts({ includeBusy: true });
      const items = Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result)
          ? result
          : [];
      setCourts(items);
    });
    setCourtsLoading(false);
  }, [api, runBusy]);

  const openCourtDialog = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    setCourtDialogOpen(true);
    if (!courts.length && !courtsLoading) {
      await loadCourts();
    }
  }, [courts.length, courtsLoading, ensureInteractionAllowed, loadCourts]);

  const flipWholeMatch = useCallback(async () => {
    const nextBase = {
      A: flipSlotNumbers(currentBase?.A || {}),
      B: flipSlotNumbers(currentBase?.B || {}),
    };
    const nextLayout =
      currentLayout.left === "B" ? { left: "A", right: "B" } : { left: "B", right: "A" };
    let nextServe = match?.serve || null;
    if (isPreStartOrOpening) {
      const targetSlot = preStartRightSlotForSide(activeSide, nextLayout);
      const serverId =
        findUidAtCurrentSlot(activeSide, targetSlot, nextBase, { a: 0, b: 0 }) ||
        firstPlayerIdOfSide(match, activeSide, eventType) ||
        null;
      nextServe = {
        side: activeSide,
        server: 1,
        serverId,
        opening: isDouble,
      };
    }
    await runLiveControlBusy("swap-sides", () =>
      api.setSlotsBase({
        base: nextBase,
        layout: nextLayout,
        serve: nextServe,
      }),
    );
  }, [
    activeSide,
    api,
    currentBase,
    currentLayout,
    eventType,
    findUidAtCurrentSlot,
    isDouble,
    isPreStartOrOpening,
    match,
    runLiveControlBusy,
  ]);

  const flipTeamSlots = useCallback(
    async (side) => {
      const nextBase = {
        ...currentBase,
        [side]: flipSlotNumbers(currentBase?.[side] || {}),
      };
      let nextServe = match?.serve || null;
      if (isPreStartOrOpening && side === activeSide) {
        const targetSlot = preStartRightSlotForSide(side, currentLayout);
        const serverId =
          findUidAtCurrentSlot(side, targetSlot, nextBase, { a: 0, b: 0 }) ||
          firstPlayerIdOfSide(match, side, eventType) ||
          null;
        nextServe = {
          side,
          server: 1,
          serverId,
          opening: isDouble,
        };
      }
      await runLiveControlBusy(`swap-${side}`, () =>
        api.setSlotsBase({
          base: nextBase,
          layout: currentLayout,
          serve: nextServe,
        }),
      );
    },
    [
      activeSide,
      api,
      currentBase,
      currentLayout,
      eventType,
      findUidAtCurrentSlot,
      isDouble,
      isPreStartOrOpening,
      match,
      runLiveControlBusy,
    ],
  );

  const toggleServerNum = useCallback(async () => {
    if (!match?._id) return;
    const preStartOpening = isDouble && isPreStartOrOpening;
    const nextServer = preStartOpening ? 1 : activeServerNum === 1 ? 2 : 1;
    const nextSlot = preStartOpening
      ? preStartRightSlotForSide(activeSide, currentLayout)
      : nextServer;
    let serverId = findUidAtCurrentSlot(activeSide, nextSlot);
    if (!serverId) {
      const teamPlayers = pairPlayers[activeSide] || [];
      serverId =
        teamPlayers
          .map((player) => userIdOf(player))
          .find((uid) => uid && uid !== textOf(match?.serve?.serverId)) || "";
    }
    await runLiveControlBusy("toggle-server-num", () =>
      api.setServe({
        side: activeSide,
        server: nextServer,
        serverId: serverId || null,
        opening: preStartOpening,
      }),
    );
  }, [
    activeServerNum,
    activeSide,
    api,
    currentLayout,
    findUidAtCurrentSlot,
    isDouble,
    isPreStartOrOpening,
    match?._id,
    match?.serve?.serverId,
    pairPlayers,
    runLiveControlBusy,
  ]);

  const toggleServeSide = useCallback(async () => {
    if (!match?._id) return;
    const nextSide = activeSide === "A" ? "B" : "A";
    const opening = isDouble && isPreStartOrOpening;
    const preferredSlot = opening
      ? preStartRightSlotForSide(nextSide, currentLayout)
      : 1;
    let serverId = findUidAtCurrentSlot(nextSide, preferredSlot);
    if (!serverId) {
      serverId = firstPlayerIdOfSide(match, nextSide, eventType);
    }
    await runLiveControlBusy("toggle-serve-side", () =>
      api.setServe({
        side: nextSide,
        server: 1,
        serverId: serverId || null,
        opening,
      }),
    );
  }, [
    activeSide,
    api,
    currentLayout,
    eventType,
    findUidAtCurrentSlot,
    isDouble,
    isPreStartOrOpening,
    match,
    runLiveControlBusy,
  ]);

  const handleRandomDraw = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    const nextLayout = Math.random() > 0.5 ? { left: "A", right: "B" } : { left: "B", right: "A" };
    const nextSide = Math.random() > 0.5 ? "A" : "B";
    const preferredSlot = isDouble
      ? preStartRightSlotForSide(nextSide, nextLayout)
      : 1;
    const serverId =
      findUidAtCurrentSlot(nextSide, preferredSlot, currentBase, { a: 0, b: 0 }) ||
      firstPlayerIdOfSide(match, nextSide, eventType) ||
      null;

    await runProtectedBusy("draw", () =>
      api.setSlotsBase({
        base: currentBase,
        layout: nextLayout,
        serve: {
          side: nextSide,
          server: 1,
          serverId,
          opening: isDouble,
        },
      }),
    );
  }, [
    api,
    currentBase,
    ensureInteractionAllowed,
    eventType,
    findUidAtCurrentSlot,
    isDouble,
    match,
    runProtectedBusy,
  ]);

  const handleBreak = useCallback(
    async (type, side) => {
      if (!ensureInteractionAllowed()) return;
      const durationMinutes = type === "medical" ? 5 : Number(match?.timeoutMinutes || 1);
      const expectedResumeAt = new Date(Date.now() + durationMinutes * 60000).toISOString();
      await runProtectedBusy(`${type}-${side}`, () =>
        api.setBreak({
          active: true,
          note: `${type}:${side}`,
          type,
          afterGame: currentGame,
          expectedResumeAt,
        }),
      );
    },
    [api, currentGame, ensureInteractionAllowed, match?.timeoutMinutes, runProtectedBusy],
  );

  const handleContinue = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("continue", () =>
      api.setBreak({
        active: false,
        note: "",
        afterGame: currentGame,
      }),
    );
  }, [api, currentGame, ensureInteractionAllowed, runProtectedBusy]);

  const handleUpdateSettings = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("settings", () =>
      api.updateSettings({
        pointsToWin: Number(pointsToWin || match?.rules?.pointsToWin || 11),
      }),
    );
  }, [api, ensureInteractionAllowed, match?.rules?.pointsToWin, pointsToWin, runProtectedBusy]);

  const handleAssignCourt = useCallback(async () => {
    if (!selectedCourtId) return;
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("assign-court", () => api.assignCourt({ courtId: selectedCourtId }));
    setCourtDialogOpen(false);
    pushToast("Đã gán sân.", "success");
  }, [api, ensureInteractionAllowed, pushToast, runProtectedBusy, selectedCourtId]);

  const handleUnassignCourt = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("unassign-court", () => api.unassignCourt({ toStatus: "queued" }));
    setCourtDialogOpen(false);
    pushToast("Đã bỏ gán sân.", "success");
  }, [api, ensureInteractionAllowed, pushToast, runProtectedBusy]);

  const handleStart = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("start", async () => {
      await api.start();
      if (breakState?.active) {
        await api.setBreak({
          active: false,
          note: "",
          afterGame: currentGame,
        });
      }
    });
  }, [api, breakState?.active, currentGame, ensureInteractionAllowed, runProtectedBusy]);

  const cta = useMemo(() => {
    if (match?.status === "finished") return null;
    if (needsStartAction) {
      return {
        label: "Bắt đầu",
        danger: false,
        onPress: handleStart,
      };
    }

    const needed = needWins(rules.bestOf);
    const decidedWinner = wins.a >= needed ? "A" : wins.b >= needed ? "B" : "";

    if (matchDecided && decidedWinner) {
      return {
        label: "Kết thúc trận",
        danger: true,
        onPress: () =>
          runProtectedBusy(`finish-${decidedWinner}`, () =>
            api.finish(decidedWinner, "finish"),
          ),
      };
    }

    if (currentGameFinished) {
      const previewWinner = currentScore.a > currentScore.b ? "A" : "B";
      const previewA = wins.a + (previewWinner === "A" ? 1 : 0);
      const previewB = wins.b + (previewWinner === "B" ? 1 : 0);
      const winnerBySets = previewA >= needed ? "A" : previewB >= needed ? "B" : "";

      if (winnerBySets) {
        return {
          label: "Kết thúc trận",
          danger: true,
          onPress: () =>
            runProtectedBusy(`finish-${winnerBySets}`, () =>
              api.finish(winnerBySets, "finish"),
            ),
        };
      }

      return {
        label: "Bắt game tiếp",
        danger: false,
        onPress: () =>
          runProtectedBusy("next-game", () => api.nextGame({ autoNext: true })),
      };
    }

    return null;
  }, [
    api,
    currentGameFinished,
    currentScore.a,
    currentScore.b,
    handleStart,
    match?.status,
    matchDecided,
    needsStartAction,
    rules.bestOf,
    runProtectedBusy,
    wins.a,
    wins.b,
  ]);

  const midLabel = activeServerNum === 1 ? "Đổi tay" : "Đổi giao";
  const midIcon = activeServerNum === 1 ? <SwapVertIcon /> : <SwapCallsIcon />;
  const onMidPress = activeServerNum === 1 ? toggleServerNum : toggleServeSide;
  const leftEnabled = canScoreByMatchState && activeSide === leftSide && !busy;
  const rightEnabled = canScoreByMatchState && activeSide === rightSide && !busy;
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="lg"
        BackdropProps={{
          sx: {
            background:
              theme.palette.mode === "dark"
                ? "rgba(2, 6, 12, 0.78)"
                : "rgba(15, 23, 42, 0.52)",
            backdropFilter: "blur(12px) saturate(130%)",
          },
        }}
        PaperProps={{
          sx: {
            background: ui.paper,
            backgroundImage: "none",
            color: ui.text,
            borderRadius: fullScreen ? 0 : 4,
            overflow: "hidden",
            width: fullScreen ? "100%" : "min(1240px, calc(100vw - 72px))",
            border: "1px solid",
            borderColor: alpha("#ffffff", theme.palette.mode === "dark" ? 0.08 : 0.12),
            boxShadow:
              theme.palette.mode === "dark"
                ? "0 32px 120px rgba(0, 0, 0, 0.58)"
                : "0 32px 100px rgba(15, 23, 42, 0.22)",
          },
        }}
      >
      <DialogContent
        sx={{
          p: { xs: 1.2, sm: 1.6, md: 2 },
          bgcolor: "transparent",
        }}
      >
        <Box
          sx={{
            position: "relative",
            p: { xs: 0.9, sm: 1.1, md: 1.25 },
            borderRadius: fullScreen ? 0 : 4.5,
            border: "1px solid",
            borderColor: alpha("#ffffff", theme.palette.mode === "dark" ? 0.06 : 0.1),
            bgcolor:
              theme.palette.mode === "dark"
                ? "rgba(9, 11, 15, 0.76)"
                : "rgba(255, 255, 255, 0.9)",
            boxShadow:
              theme.palette.mode === "dark"
                ? "inset 0 1px 0 rgba(255,255,255,0.04)"
                : "inset 0 1px 0 rgba(255,255,255,0.55)",
            overflow: "hidden",
            "&::before": {
              content: '""',
              position: "absolute",
              inset: 0,
              background:
                theme.palette.mode === "dark"
                  ? "radial-gradient(circle at top left, rgba(96,165,250,0.14), transparent 30%), radial-gradient(circle at top right, rgba(245,158,11,0.08), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))"
                  : "radial-gradient(circle at top left, rgba(37,99,235,0.08), transparent 30%), radial-gradient(circle at top right, rgba(245,158,11,0.06), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0))",
              pointerEvents: "none",
            },
          }}
        >
          <Stack spacing={1.5} sx={{ position: "relative", zIndex: 1 }}>
          <Box
            sx={{
              p: { xs: 1.25, md: 1.5 },
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              bgcolor: ui.panel,
              backdropFilter: "blur(20px)",
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={1.25}
              alignItems={{ xs: "stretch", md: "center" }}
            >
              <Stack direction="row" spacing={1.1} alignItems="center" sx={{ minWidth: 0 }}>
                <IconButton
                  onClick={onClose}
                  sx={{
                    width: 42,
                    height: 42,
                    border: "1px solid",
                    borderColor: ui.border,
                    bgcolor: alpha("#ffffff", 0.02),
                    color: ui.text,
                    flexShrink: 0,
                  }}
                >
                  <CloseIcon />
                </IconButton>

                <Chip
                  label={headerText}
                  sx={{
                    minHeight: 42,
                    borderRadius: 999,
                    px: 1.2,
                    fontWeight: 900,
                    fontSize: { xs: 13, md: 16 },
                    color: ui.text,
                    bgcolor: alpha("#ffffff", 0.05),
                    border: "1px solid",
                    borderColor: ui.border,
                    "& .MuiChip-label": { px: 0.8 },
                  }}
                />
              </Stack>

              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                flexWrap="wrap"
                justifyContent={{ xs: "flex-start", md: "flex-end" }}
              >
                <Button
                  variant="outlined"
                  onClick={() => runLiveControlBusy("undo", () => api.undo())}
                  disabled={!canUndo || busy === "undo"}
                  startIcon={busy === "undo" ? <CircularProgress size={14} /> : <UndoIcon />}
                  sx={{
                    minHeight: 40,
                    borderRadius: 999,
                    px: 1.5,
                    color: "#fbbf24",
                    borderColor: alpha("#fbbf24", 0.36),
                    bgcolor: alpha("#fbbf24", 0.12),
                    fontWeight: 800,
                  }}
                >
                  Hoàn tác
                </Button>

                <Button
                  variant="outlined"
                  onClick={flipWholeMatch}
                  disabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                  startIcon={<SwapHorizIcon />}
                  sx={{
                    minHeight: 40,
                    borderRadius: 999,
                    px: 1.5,
                    color: ui.accent,
                    borderColor: alpha(ui.accent, 0.34),
                    bgcolor: ui.accentSoft,
                    fontWeight: 800,
                  }}
                >
                  Đổi bên
                </Button>

                <Button
                  variant="outlined"
                  onClick={toggleServerNum}
                  disabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                  sx={{
                    minWidth: 44,
                    minHeight: 40,
                    borderRadius: 2.5,
                    px: 1.2,
                    color: ui.text,
                    borderColor: ui.border,
                    bgcolor: alpha("#ffffff", 0.03),
                    fontWeight: 900,
                    fontSize: 18,
                  }}
                >
                  {activeServerNum}
                </Button>

                <Button
                  variant="outlined"
                  onClick={openCourtDialog}
                  startIcon={<LocationOnIcon />}
                  sx={{
                    minHeight: 40,
                    borderRadius: 999,
                    px: 1.5,
                    color: ui.text,
                    borderColor: ui.border,
                    bgcolor: alpha("#ffffff", 0.03),
                    fontWeight: 800,
                  }}
                >
                  {currentCourtId ? "Đổi sân" : "Gán sân"}
                </Button>

                {match?.video ? (
                  <Button
                    variant="outlined"
                    onClick={() =>
                      window.open(match.video, "_blank", "noopener,noreferrer")
                    }
                    startIcon={<OpenInNewIcon />}
                    sx={{
                      minHeight: 40,
                      borderRadius: 999,
                      px: 1.5,
                      color: ui.text,
                      borderColor: ui.border,
                      bgcolor: alpha("#ffffff", 0.03),
                      fontWeight: 800,
                    }}
                  >
                    Mở video
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Box>

          {error ? (
            <Alert severity="error">
              {textOf(error?.message) || "Không tải được dữ liệu trận."}
            </Alert>
          ) : null}
          {actionError ? <Alert severity="error">{actionError}</Alert> : null}

          <Box
            sx={{
              px: { xs: 1.25, md: 1.4 },
              py: 1,
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              bgcolor: ui.card,
            }}
          >
            <Stack
              direction="row"
              justifyContent="flex-end"
              alignItems="center"
              spacing={1}
              useFlexGap
              flexWrap="wrap"
            >
              <Chip
                label={currentCourtLabel}
                sx={{
                  fontWeight: 800,
                  bgcolor: alpha("#ffffff", 0.05),
                  color: ui.muted,
                  border: "1px solid",
                  borderColor: ui.border,
                }}
              />
              <Chip
                label={textOf(match?.status || "scheduled").toUpperCase()}
                sx={{
                  fontWeight: 900,
                  bgcolor:
                    match?.status === "live"
                      ? alpha(ui.warning, 0.14)
                      : match?.status === "finished"
                        ? alpha(ui.success, 0.14)
                        : alpha("#ffffff", 0.05),
                  color:
                    match?.status === "live"
                      ? "#ffcc80"
                      : match?.status === "finished"
                        ? "#86efac"
                        : ui.muted,
                  border: "1px solid",
                  borderColor: ui.border,
                }}
              />
            </Stack>
          </Box>

          <Box
            sx={{
              p: { xs: 1.2, md: 1.45 },
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              bgcolor: ui.card,
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={{ xs: 1.2, md: 1.4 }}
              alignItems="stretch"
            >
              <TeamPanel
                title="Đội bên trái"
                teamLabel={getMatchSideDisplayName(match, leftSide, "TBD")}
                players={displayedPlayers.left}
                isServing={activeSide === leftSide}
                isActiveSide={activeSide === leftSide}
                serverUid={serverUidShow}
                onSwapSlots={() => flipTeamSlots(leftSide)}
                swapDisabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                match={match}
                muted={ui.muted}
                borderColor={ui.softBorder}
                accentColor={ui.accent}
              />

              <Box
                sx={{
                  width: { xs: "100%", md: 280 },
                  borderRadius: 4,
                  border: "1px solid",
                  borderColor: ui.softBorder,
                  bgcolor: alpha("#ffffff", 0.025),
                  px: { xs: 1.2, md: 1.5 },
                  py: { xs: 1.45, md: 1.7 },
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 1.45,
                  minHeight: { xs: 190, md: 224 },
                }}
              >
                {needsStartAction ? (
                  <>
                    <Typography
                      sx={{
                        fontSize: 14,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: ui.muted,
                      }}
                    >
                      Giao trước
                    </Typography>
                    <Button
                      variant="outlined"
                      onClick={toggleServeSide}
                      disabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                      startIcon={<SwapCallsIcon />}
                      sx={{
                        minHeight: 56,
                        minWidth: 0,
                        width: "100%",
                        borderRadius: 999,
                        borderColor: alpha(ui.accent, 0.35),
                        bgcolor: alpha(ui.accent, 0.12),
                        color: ui.accent,
                        fontWeight: 900,
                        fontSize: 18,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {preStartServeSideLabel}
                    </Button>
                    <Typography
                      sx={{
                        fontSize: 13,
                        color: ui.muted,
                        textAlign: "center",
                        maxWidth: 220,
                      }}
                    >
                      Chạm để đổi đội giao trước cho game hiện tại.
                    </Typography>
                  </>
                ) : (
                  <>
                    <Stack
                      direction="row"
                      spacing={0.8}
                      useFlexGap
                      flexWrap="wrap"
                      justifyContent="center"
                    >
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<PauseCircleOutlineIcon />}
                        onClick={() => handleBreak("timeout", leftSide)}
                        disabled={!canScoreByMatchState || Boolean(busy)}
                        sx={{
                          borderRadius: 999,
                          borderColor: ui.softBorder,
                          color: ui.muted,
                          textTransform: "none",
                          fontWeight: 800,
                        }}
                      >
                        Timeout trái
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<HealingIcon />}
                        onClick={() => handleBreak("medical", leftSide)}
                        disabled={!canScoreByMatchState || Boolean(busy)}
                        sx={{
                          borderRadius: 999,
                          borderColor: ui.softBorder,
                          color: ui.muted,
                          textTransform: "none",
                          fontWeight: 800,
                        }}
                      >
                        Y tế trái
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<PauseCircleOutlineIcon />}
                        onClick={() => handleBreak("timeout", rightSide)}
                        disabled={!canScoreByMatchState || Boolean(busy)}
                        sx={{
                          borderRadius: 999,
                          borderColor: ui.softBorder,
                          color: ui.muted,
                          textTransform: "none",
                          fontWeight: 800,
                        }}
                      >
                        Timeout phải
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<HealingIcon />}
                        onClick={() => handleBreak("medical", rightSide)}
                        disabled={!canScoreByMatchState || Boolean(busy)}
                        sx={{
                          borderRadius: 999,
                          borderColor: ui.softBorder,
                          color: ui.muted,
                          textTransform: "none",
                          fontWeight: 800,
                        }}
                      >
                        Y tế phải
                      </Button>
                    </Stack>

                    <Typography
                      sx={{
                        fontSize: { xs: 16, md: 18 },
                        fontWeight: 900,
                        letterSpacing: "-0.02em",
                        color: ui.text,
                        textAlign: "center",
                      }}
                    >
                      {callout}
                    </Typography>

                    <Stack direction="row" alignItems="center" spacing={2.2}>
                      <Typography
                        sx={{
                          fontSize: { xs: 44, md: 56 },
                          lineHeight: 1,
                          fontWeight: 900,
                          color: ui.success,
                          letterSpacing: "-0.06em",
                        }}
                      >
                        {leftGameScore}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: { xs: 12, md: 13 },
                          textTransform: "uppercase",
                          fontWeight: 800,
                          letterSpacing: "0.12em",
                          color: ui.muted,
                        }}
                      >
                        Game
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: { xs: 44, md: 56 },
                          lineHeight: 1,
                          fontWeight: 900,
                          color: ui.success,
                          letterSpacing: "-0.06em",
                        }}
                      >
                        {rightGameScore}
                      </Typography>
                    </Stack>

                    <Stack direction="row" alignItems="center" spacing={2.2}>
                      <Typography
                        sx={{
                          fontSize: { xs: 28, md: 34 },
                          lineHeight: 1,
                          fontWeight: 900,
                          letterSpacing: "-0.05em",
                          color: ui.text,
                        }}
                      >
                        {leftSetWins}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: { xs: 12, md: 13 },
                          textTransform: "uppercase",
                          fontWeight: 800,
                          letterSpacing: "0.12em",
                          color: ui.muted,
                        }}
                      >
                        Match
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: { xs: 28, md: 34 },
                          lineHeight: 1,
                          fontWeight: 900,
                          letterSpacing: "-0.05em",
                          color: ui.text,
                        }}
                      >
                        {rightSetWins}
                      </Typography>
                    </Stack>
                  </>
                )}
              </Box>

              <TeamPanel
                title="Đội bên phải"
                teamLabel={getMatchSideDisplayName(match, rightSide, "TBD")}
                players={displayedPlayers.right}
                isServing={activeSide === rightSide}
                isActiveSide={activeSide === rightSide}
                serverUid={serverUidShow}
                onSwapSlots={() => flipTeamSlots(rightSide)}
                swapDisabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                match={match}
                muted={ui.muted}
                borderColor={ui.softBorder}
                accentColor={ui.accent}
                align="right"
              />
            </Stack>
          </Box>

          <Box
            sx={{
              position: "relative",
              p: { xs: 1.2, md: 1.45 },
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              bgcolor: ui.card,
              minHeight: { xs: 96, md: 126 },
              overflow: "hidden",
            }}
          >
            {breakState?.active ? (
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="center"
                alignItems="center"
                spacing={2}
                sx={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 2,
                  bgcolor: alpha("#0b0c0f", 0.94),
                  borderRadius: 4,
                  px: 2,
                }}
              >
                <Typography
                  sx={{
                    fontSize: { xs: 15, md: 16 },
                    fontWeight: 800,
                    color: breakState?.type === "medical" ? "#fca5a5" : "#fdba74",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {breakState?.type === "medical" ? "Nghỉ y tế" : "Timeout"}
                </Typography>
                <BreakCountdown
                  endTime={breakState?.expectedResumeAt}
                  color={breakState?.type === "medical" ? "#ef4444" : "#f59e0b"}
                />
                <Button
                  variant="contained"
                  onClick={handleContinue}
                  disabled={busy === "continue"}
                  startIcon={
                    busy === "continue" ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />
                  }
                  sx={{
                    minHeight: 48,
                    borderRadius: 999,
                    px: 2.25,
                    fontWeight: 900,
                    bgcolor: "#10b981",
                    "&:hover": { bgcolor: "#059669" },
                  }}
                >
                  Tiếp tục
                </Button>
              </Stack>
            ) : null}

            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "center" }}
              spacing={1.25}
            >
              <Box sx={{ minWidth: { md: 140 } }}>
                <LiveClock color={ui.text} />
              </Box>

              {needsStartAction ? (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  flexWrap="wrap"
                  justifyContent="center"
                  flex={1}
                >
                  {cta ? (
                    <Button
                      variant="contained"
                      onClick={cta.onPress}
                      disabled={Boolean(busy)}
                      sx={{
                        minHeight: 52,
                        borderRadius: 3,
                        px: 2.6,
                        fontWeight: 900,
                        fontSize: 18,
                        bgcolor: ui.success,
                        "&:hover": { bgcolor: "#16a34a" },
                      }}
                    >
                      {cta.label}
                    </Button>
                  ) : null}
                  <Button
                    variant="outlined"
                    onClick={flipWholeMatch}
                    disabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                    startIcon={<SwapHorizIcon />}
                    sx={{
                      minHeight: 52,
                      borderRadius: 3,
                      px: 2.2,
                      fontWeight: 800,
                      borderColor: ui.border,
                      color: ui.text,
                    }}
                  >
                    Đổi bên
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleRandomDraw}
                    disabled={!match?._id || Boolean(busy)}
                    startIcon={<CasinoIcon />}
                    sx={{
                      minHeight: 52,
                      borderRadius: 3,
                      px: 2.2,
                      fontWeight: 800,
                      borderColor: alpha(ui.accent, 0.34),
                      color: ui.accent,
                      bgcolor: ui.accentSoft,
                    }}
                  >
                    Bốc thăm
                  </Button>
                </Stack>
              ) : (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  alignItems="stretch"
                  justifyContent="center"
                  flex={1}
                  sx={{ width: "100%" }}
                >
                  <Button
                    variant="outlined"
                    onClick={() =>
                      runLiveControlBusy("point-left", () =>
                        api[leftSide === "A" ? "pointA" : "pointB"](1),
                      )
                    }
                    disabled={!leftEnabled}
                    startIcon={busy === "point-left" ? <CircularProgress size={14} /> : <AddIcon />}
                    sx={{
                      minHeight: 56,
                      flex: 1,
                      borderRadius: 3,
                      borderColor:
                        activeSide === leftSide ? alpha(ui.accent, 0.45) : ui.border,
                      bgcolor:
                        activeSide === leftSide ? alpha(ui.accent, 0.18) : alpha("#ffffff", 0.02),
                      color: activeSide === leftSide ? "#ffffff" : ui.text,
                      fontWeight: 900,
                      fontSize: { xs: 16, md: 18 },
                    }}
                  >
                    Đội bên trái
                  </Button>

                  <Button
                    variant="contained"
                    onClick={onMidPress}
                    disabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                    startIcon={midIcon}
                    sx={{
                      minHeight: 56,
                      minWidth: isMobile ? "100%" : 164,
                      borderRadius: 3,
                      bgcolor: "#d97706",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: { xs: 16, md: 17 },
                      "&:hover": { bgcolor: "#b45309" },
                    }}
                  >
                    {midLabel}
                  </Button>

                  <Button
                    variant="outlined"
                    onClick={() =>
                      runLiveControlBusy("point-right", () =>
                        api[rightSide === "A" ? "pointA" : "pointB"](1),
                      )
                    }
                    disabled={!rightEnabled}
                    startIcon={busy === "point-right" ? <CircularProgress size={14} /> : <AddIcon />}
                    sx={{
                      minHeight: 56,
                      flex: 1,
                      borderRadius: 3,
                      borderColor:
                        activeSide === rightSide ? alpha(ui.accent, 0.45) : ui.border,
                      bgcolor:
                        activeSide === rightSide ? alpha(ui.accent, 0.18) : alpha("#ffffff", 0.02),
                      color: activeSide === rightSide ? "#ffffff" : ui.text,
                      fontWeight: 900,
                      fontSize: { xs: 16, md: 18 },
                    }}
                  >
                    Đội bên phải
                  </Button>
                </Stack>
              )}

              {!needsStartAction && cta ? (
                <Box sx={{ minWidth: { md: 170 } }}>
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={cta.onPress}
                    disabled={Boolean(busy)}
                    sx={{
                      minHeight: 52,
                      borderRadius: 3,
                      fontWeight: 900,
                      fontSize: { xs: 16, md: 17 },
                      bgcolor: cta.danger ? ui.danger : ui.success,
                      "&:hover": {
                        bgcolor: cta.danger ? "#dc2626" : "#16a34a",
                      },
                    }}
                  >
                    {cta.label}
                  </Button>
                </Box>
              ) : (
                <Box sx={{ minWidth: { md: 170 } }} />
              )}
            </Stack>
          </Box>

          <Accordion
            expanded={toolsOpen}
            onChange={(_, expanded) => setToolsOpen(expanded)}
            sx={{
              bgcolor: ui.card,
              borderRadius: "18px !important",
              border: "1px solid",
              borderColor: ui.border,
              "&::before": { display: "none" },
              overflow: "hidden",
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ color: ui.text }} />}
              sx={{
                minHeight: 64,
                "& .MuiAccordionSummary-content": {
                  my: 0,
                },
              }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "flex-start", sm: "center" }}
                justifyContent="space-between"
                sx={{ width: "100%" }}
              >
                <Box>
                  <Typography sx={{ fontSize: 18, fontWeight: 900, color: ui.text }}>
                    Công cụ trọng tài
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: ui.muted }}>
                    Gán sân, cập nhật điểm set, takeover, sync và thao tác phụ.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip
                    size="small"
                    label={`${gameScores.length || 1} game`}
                    sx={{
                      fontWeight: 800,
                      color: ui.muted,
                      bgcolor: alpha("#ffffff", 0.05),
                      border: "1px solid",
                      borderColor: ui.softBorder,
                    }}
                  />
                  <Chip
                    size="small"
                    label={`Điểm set ${rules.pointsToWin}`}
                    sx={{
                      fontWeight: 800,
                      color: ui.muted,
                      bgcolor: alpha("#ffffff", 0.05),
                      border: "1px solid",
                      borderColor: ui.softBorder,
                    }}
                  />
                </Stack>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 2 }}>
              <Stack spacing={2}>
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={2}
                  alignItems={{ xs: "stretch", md: "center" }}
                >
                  <Stack spacing={0.8} flex={1}>
                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: ui.muted }}>
                      Điểm set
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                      <TextField
                        type="number"
                        size="small"
                        label="Points to win"
                        value={pointsToWin}
                        onChange={(event) => setPointsToWin(event.target.value)}
                        sx={{
                          maxWidth: 180,
                          "& .MuiOutlinedInput-root": {
                            borderRadius: 3,
                            bgcolor: alpha("#ffffff", 0.02),
                          },
                        }}
                      />
                      <Button
                        variant="contained"
                        onClick={handleUpdateSettings}
                        disabled={busy === "settings" || !match?._id}
                        sx={{
                          minHeight: 42,
                          borderRadius: 999,
                          fontWeight: 800,
                          alignSelf: { xs: "stretch", sm: "center" },
                        }}
                      >
                        Lưu cấu hình
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>

                <Stack spacing={0.8}>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: ui.muted }}>
                    Điều khiển tay giao
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {["A-1", "A-2", "B-1", "B-2"].map((item) => {
                      const [side, server] = item.split("-");
                      return (
                        <Button
                          key={item}
                          variant="outlined"
                          onClick={() =>
                            runLiveControlBusy(item, () =>
                              api.setServe({
                                side,
                                server: Number(server),
                                opening:
                                  Number(server) === 1 &&
                                  isDouble &&
                                  isPreStartOrOpening,
                              }),
                            )
                          }
                          disabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                          sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                        >
                          {item}
                        </Button>
                      );
                    })}
                  </Stack>
                </Stack>

                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={2}
                  alignItems={{ xs: "stretch", md: "center" }}
                >
                  <Stack spacing={0.8} flex={1}>
                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: ui.muted }}>
                      Đồng bộ quyền chấm
                    </Typography>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      <Button
                        variant="outlined"
                        startIcon={<SyncIcon />}
                        onClick={() => sync?.syncNow?.()}
                        disabled={!sync?.pendingCount || sync?.syncing}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Sync ngay
                      </Button>
                      {featureEnabled ? (
                        <Button
                          variant="outlined"
                          startIcon={<CachedIcon />}
                          onClick={() => sync?.claim?.()}
                          disabled={sync?.claiming}
                          sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                        >
                          Claim
                        </Button>
                      ) : null}
                      {featureEnabled ? (
                        <Button
                          variant="outlined"
                          color="warning"
                          onClick={() => sync?.takeover?.()}
                          sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                        >
                          Take over
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>

                  <Stack spacing={0.8} flex={1}>
                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: ui.muted }}>
                      Kết thúc trận
                    </Typography>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      <Button
                        variant="contained"
                        color="success"
                        onClick={() =>
                          runProtectedBusy("finish-a", () => api.finish("A", "finish"))
                        }
                        disabled={!match?._id || Boolean(busy)}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Finish A
                      </Button>
                      <Button
                        variant="contained"
                        color="success"
                        onClick={() =>
                          runProtectedBusy("finish-b", () => api.finish("B", "finish"))
                        }
                        disabled={!match?._id || Boolean(busy)}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Finish B
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() =>
                          runProtectedBusy("forfeit-a", () => api.forfeit("A", "forfeit"))
                        }
                        disabled={!match?._id || Boolean(busy)}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Forfeit A
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() =>
                          runProtectedBusy("forfeit-b", () => api.forfeit("B", "forfeit"))
                        }
                        disabled={!match?._id || Boolean(busy)}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Forfeit B
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </Stack>
            </AccordionDetails>
          </Accordion>
          </Stack>
        </Box>
      </DialogContent>
      </Dialog>

      <Dialog
        open={courtDialogOpen}
        onClose={() => setCourtDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: 4,
            background: ui.paper,
            color: ui.text,
            border: "1px solid",
            borderColor: ui.border,
            boxShadow: "0 24px 80px rgba(0,0,0,0.42)",
          },
        }}
      >
        <DialogContent sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography sx={{ fontSize: 22, fontWeight: 900, color: ui.text }}>
                  Gán sân
                </Typography>
                <Typography sx={{ fontSize: 13, color: ui.muted }}>
                  Chọn sân để gán cho trận hiện tại.
                </Typography>
              </Box>
              <IconButton
                onClick={() => setCourtDialogOpen(false)}
                sx={{
                  width: 40,
                  height: 40,
                  border: "1px solid",
                  borderColor: ui.border,
                  color: ui.text,
                }}
              >
                <CloseIcon />
              </IconButton>
            </Stack>

            <Stack spacing={1.25}>
              <Button
                variant="outlined"
                startIcon={courtsLoading ? <CircularProgress size={14} /> : <RefreshIcon />}
                onClick={loadCourts}
                disabled={courtsLoading || busy === "courts"}
                sx={{ minHeight: 44, borderRadius: 999, fontWeight: 800, alignSelf: "flex-start" }}
              >
                Tải sân
              </Button>

              <FormControl size="small" fullWidth>
                <InputLabel id="referee-court-dialog-select-label">Sân</InputLabel>
                <Select
                  labelId="referee-court-dialog-select-label"
                  label="Sân"
                  value={selectedCourtId}
                  onChange={(event) => setSelectedCourtId(event.target.value)}
                  sx={{
                    borderRadius: 3,
                    bgcolor: alpha("#ffffff", 0.02),
                  }}
                >
                  {courts.map((court) => (
                    <MenuItem key={court?._id || court?.id} value={court?._id || court?.id}>
                      {textOf(court?.name) || textOf(court?.label) || textOf(court?.code)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button
                variant="contained"
                onClick={handleAssignCourt}
                disabled={!selectedCourtId}
                sx={{ minHeight: 44, borderRadius: 999, fontWeight: 800, flex: 1 }}
              >
                Gán sân
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={handleUnassignCourt}
                disabled={!currentCourtId}
                sx={{ minHeight: 44, borderRadius: 999, fontWeight: 800, flex: 1 }}
              >
                Bỏ gán
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={2200}
        onClose={closeToast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={closeToast} severity={toast.severity} variant="filled" sx={{ width: "100%" }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </>
  );
}
