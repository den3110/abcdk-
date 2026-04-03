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
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
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
  WarningAmber as WarningAmberIcon,
} from "@mui/icons-material";
import { useSelector } from "react-redux";
import { useLiveMatch } from "../../hook/useLiveMatch";
import {
  getMatchCourtStationName,
  getMatchDisplayCode,
  getPairDisplayName,
  getPlayerDisplayName,
  normalizeMatchDisplay,
} from "../../utils/matchDisplay";

const textOf = (value) => (value && String(value).trim()) || "";

const pairLabel = (pair, source) => getPairDisplayName(pair, source) || "TBD";

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

const normalizeBreakState = (rawBreak) => {
  if (!rawBreak) return null;
  if (typeof rawBreak === "object") {
    return {
      active:
        rawBreak.active === true ||
        rawBreak.isActive === true ||
        rawBreak.enabled === true,
      afterGame:
        typeof rawBreak.afterGame === "number" ? rawBreak.afterGame : null,
      note: textOf(rawBreak.note),
      startedAt: rawBreak.startedAt || rawBreak.startAt || null,
      expectedResumeAt:
        rawBreak.expectedResumeAt || rawBreak.resumeAt || rawBreak.endTime || null,
      type: textOf(rawBreak.type),
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

function PlayerRow({ label, slot, isServer, muted, borderColor, accentColor }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
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
      <Chip
        size="small"
        label={`Ô ${slot || "?"}`}
        sx={{
          height: 24,
          fontWeight: 800,
          bgcolor: alpha("#ffffff", 0.06),
          color: muted,
          border: "1px solid",
          borderColor: alpha("#ffffff", 0.08),
        }}
      />
    </Stack>
  );
}

function TeamPanel({
  title,
  pair,
  players,
  slotMap,
  isServing,
  isActiveSide,
  serverUid,
  onSwapSlots,
  match,
  muted,
  borderColor,
  accentColor,
  align = "left",
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
          {pairLabel(pair, match)}
        </Typography>
      </Box>

      <Stack spacing={1}>
        {players.length ? (
          players.map((player) => {
            const uid = userIdOf(player);
            const slot = slotMap?.[uid] || slotMap?.[String(uid)] || null;
            return (
              <PlayerRow
                key={uid || playerLabel(player, match)}
                label={playerLabel(player, match)}
                slot={slot}
                isServer={Boolean(uid) && String(serverUid || "") === String(uid)}
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
  const currentBase = useMemo(
    () => match?.slots?.base || match?.meta?.slots?.base || { A: {}, B: {} },
    [match?.meta?.slots?.base, match?.slots?.base],
  );
  const currentLayout = useMemo(
    () => normalizeLayout(match?.meta?.refereeLayout),
    [match?.meta?.refereeLayout],
  );
  const activeSide = match?.serve?.side === "B" ? "B" : "A";
  const activeServerNum = Number(match?.serve?.server) === 1 ? 1 : 2;
  const leftSide = currentLayout.left;
  const rightSide = currentLayout.right;
  const leftPair = sidePairOf(match, leftSide);
  const rightPair = sidePairOf(match, rightSide);
  const playersA = useMemo(() => playersOf(sidePairOf(match, "A"), eventType), [eventType, match]);
  const playersB = useMemo(() => playersOf(sidePairOf(match, "B"), eventType), [eventType, match]);
  const pairPlayers = useMemo(() => ({ A: playersA, B: playersB }), [playersA, playersB]);

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
  const needsStartAction =
    Boolean(match?._id) && match?.status !== "live" && match?.status !== "finished";
  const isOwner = sync?.isOwner ?? true;
  const featureEnabled = sync?.featureEnabled !== false;
  const canControl = Boolean(match?._id) && (!featureEnabled || isOwner);
  const canScoreByMatchState =
    Boolean(match?._id) &&
    match?.status === "live" &&
    canControl &&
    !breakState?.active;
  const canUndo = Boolean(match?._id) && match?.status === "live" && canControl;

  const [pointsToWin, setPointsToWin] = useState("");
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [courts, setCourts] = useState([]);
  const [courtsLoading, setCourtsLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);

  const currentCourtId = textOf(match?.court?._id || match?.courtId || match?.courtStationId);
  const currentCourtLabel = courtLabelOf(match || {});

  useEffect(() => {
    setPointsToWin(
      match?.rules?.pointsToWin != null ? String(match.rules.pointsToWin) : "",
    );
  }, [match?.rules?.pointsToWin]);

  useEffect(() => {
    setSelectedCourtId(currentCourtId);
  }, [currentCourtId]);

  const buildSlotMap = useCallback(
    (side) => {
      const score = side === "A" ? currentScore.a : currentScore.b;
      return Object.entries(currentBase?.[side] || {}).reduce((acc, [uid, baseSlot]) => {
        acc[String(uid)] = currentSlotFromBase(baseSlot, score);
        return acc;
      }, {});
    },
    [currentBase, currentScore.a, currentScore.b],
  );

  const slotMapA = useMemo(() => buildSlotMap("A"), [buildSlotMap]);
  const slotMapB = useMemo(() => buildSlotMap("B"), [buildSlotMap]);

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
    const fallback = findUidAtCurrentSlot(activeSide, activeServerNum);
    return fallback || "";
  }, [activeServerNum, activeSide, findUidAtCurrentSlot, match?.serve?.serverId]);

  const headerText = [
    String(matchCode(match || {})).toUpperCase(),
    `BO${rules.bestOf}`,
    `G${currentGame + 1}`,
  ].join(" | ");

  const preStartServeSideLabel =
    activeSide === leftSide ? "Đội bên trái" : "Đội bên phải";
  const callout = useMemo(() => {
    if (breakState?.active) {
      return breakState?.type === "medical"
        ? "Nghỉ y tế đang diễn ra"
        : "Timeout đang diễn ra";
    }
    if (needsStartAction) {
      return "Chạm để chọn đội giao trước cho game này";
    }
    return `${activeSide === leftSide ? "Đội bên trái" : "Đội bên phải"} giao · Người giao ${activeServerNum}`;
  }, [activeServerNum, activeSide, breakState?.active, breakState?.type, leftSide, needsStartAction]);

  const handleError = useCallback((nextError) => {
    setActionError(textOf(nextError?.message) || "Thao tác không thành công.");
  }, []);

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

  const flipWholeMatch = useCallback(async () => {
    const nextBase = {
      A: flipSlotNumbers(currentBase?.A || {}),
      B: flipSlotNumbers(currentBase?.B || {}),
    };
    const nextLayout =
      currentLayout.left === "B" ? { left: "A", right: "B" } : { left: "B", right: "A" };
    await runBusy("swap-sides", () =>
      api.setSlotsBase({
        base: nextBase,
        layout: nextLayout,
        serve: match?.serve || null,
      }),
    );
  }, [api, currentBase, currentLayout, match?.serve, runBusy]);

  const flipTeamSlots = useCallback(
    async (side) => {
      const nextBase = {
        ...currentBase,
        [side]: flipSlotNumbers(currentBase?.[side] || {}),
      };
      await runBusy(`swap-${side}`, () =>
        api.setSlotsBase({
          base: nextBase,
          layout: currentLayout,
          serve: match?.serve || null,
        }),
      );
    },
    [api, currentBase, currentLayout, match?.serve, runBusy],
  );

  const toggleServerNum = useCallback(async () => {
    if (!match?._id || !canControl) return;
    const nextServer = activeServerNum === 1 ? 2 : 1;
    let serverId = findUidAtCurrentSlot(activeSide, nextServer);
    if (!serverId) {
      const teamPlayers = pairPlayers[activeSide] || [];
      serverId =
        teamPlayers
          .map((player) => userIdOf(player))
          .find((uid) => uid && uid !== textOf(match?.serve?.serverId)) || "";
    }
    await runBusy("toggle-server-num", () =>
      api.setServe({
        side: activeSide,
        server: nextServer,
        serverId: serverId || null,
      }),
    );
  }, [
    activeServerNum,
    activeSide,
    api,
    canControl,
    findUidAtCurrentSlot,
    match?._id,
    match?.serve?.serverId,
    pairPlayers,
    runBusy,
  ]);

  const toggleServeSide = useCallback(async () => {
    if (!match?._id || !canControl) return;
    const nextSide = activeSide === "A" ? "B" : "A";
    const preMatchSlot = currentLayout.left === nextSide ? 2 : 1;
    const nextServer = needsStartAction ? 2 : 1;
    const preferredSlot = needsStartAction ? preMatchSlot : 1;
    let serverId = findUidAtCurrentSlot(nextSide, preferredSlot);
    if (!serverId) {
      serverId = firstPlayerIdOfSide(match, nextSide, eventType);
    }
    await runBusy("toggle-serve-side", () =>
      api.setServe({
        side: nextSide,
        server: nextServer,
        serverId: serverId || null,
      }),
    );
  }, [
    activeSide,
    api,
    canControl,
    currentLayout.left,
    eventType,
    findUidAtCurrentSlot,
    match,
    needsStartAction,
    runBusy,
  ]);

  const handleRandomDraw = useCallback(async () => {
    const nextLayout = Math.random() > 0.5 ? { left: "A", right: "B" } : { left: "B", right: "A" };
    const nextSide = Math.random() > 0.5 ? "A" : "B";
    const preferredSlot = nextLayout.left === nextSide ? 2 : 1;
    const serverId =
      findUidAtCurrentSlot(nextSide, preferredSlot, currentBase, { a: 0, b: 0 }) ||
      firstPlayerIdOfSide(match, nextSide, eventType) ||
      null;

    await runBusy("draw", () =>
      api.setSlotsBase({
        base: currentBase,
        layout: nextLayout,
        serve: {
          side: nextSide,
          server: 2,
          serverId,
        },
      }),
    );
  }, [api, currentBase, eventType, findUidAtCurrentSlot, match, runBusy]);

  const handleBreak = useCallback(
    async (type, side) => {
      const timeoutMinutes = Number(match?.timeoutMinutes || 1);
      const expectedResumeAt = new Date(Date.now() + timeoutMinutes * 60000).toISOString();
      await runBusy(`${type}-${side}`, () =>
        api.setBreak({
          active: true,
          note: `${type}:${side}`,
          type,
          afterGame: currentGame,
          expectedResumeAt,
        }),
      );
    },
    [api, currentGame, match?.timeoutMinutes, runBusy],
  );

  const handleContinue = useCallback(async () => {
    await runBusy("continue", () =>
      api.setBreak({
        active: false,
        note: "",
        afterGame: currentGame,
      }),
    );
  }, [api, currentGame, runBusy]);

  const handleUpdateSettings = useCallback(async () => {
    await runBusy("settings", () =>
      api.updateSettings({
        pointsToWin: Number(pointsToWin || match?.rules?.pointsToWin || 11),
      }),
    );
  }, [api, match?.rules?.pointsToWin, pointsToWin, runBusy]);

  const handleAssignCourt = useCallback(async () => {
    if (!selectedCourtId) return;
    await runBusy("assign-court", () => api.assignCourt({ courtId: selectedCourtId }));
  }, [api, runBusy, selectedCourtId]);

  const handleUnassignCourt = useCallback(async () => {
    await runBusy("unassign-court", () => api.unassignCourt({ toStatus: "queued" }));
  }, [api, runBusy]);

  const cta = useMemo(() => {
    if (match?.status === "finished") return null;
    if (needsStartAction) {
      return {
        label: "Bắt đầu",
        danger: false,
        onPress: () => runBusy("start", () => api.start()),
      };
    }

    const needed = needWins(rules.bestOf);
    const decidedWinner = wins.a >= needed ? "A" : wins.b >= needed ? "B" : "";

    if (matchDecided && decidedWinner) {
      return {
        label: "Kết thúc trận",
        danger: true,
        onPress: () => runBusy(`finish-${decidedWinner}`, () => api.finish(decidedWinner, "finish")),
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
            runBusy(`finish-${winnerBySets}`, () => api.finish(winnerBySets, "finish")),
        };
      }

      return {
        label: "Bắt game tiếp",
        danger: false,
        onPress: () => runBusy("next-game", () => api.nextGame({ autoNext: true })),
      };
    }

    return null;
  }, [
    api,
    currentGameFinished,
    currentScore.a,
    currentScore.b,
    match?.status,
    matchDecided,
    needsStartAction,
    rules.bestOf,
    runBusy,
    wins.a,
    wins.b,
  ]);

  const midLabel = activeServerNum === 1 ? "Đổi tay" : "Đổi giao";
  const midIcon = activeServerNum === 1 ? <SwapVertIcon /> : <SwapCallsIcon />;
  const onMidPress = activeServerNum === 1 ? toggleServerNum : toggleServeSide;
  const leftEnabled = canScoreByMatchState && activeSide === leftSide && !busy;
  const rightEnabled = canScoreByMatchState && activeSide === rightSide && !busy;
  const syncTone = !featureEnabled
    ? "default"
    : sync?.hasConflict
      ? "error"
      : isOwner
        ? "success"
        : "warning";
  const syncLabel = !featureEnabled
    ? "Khóa trọng tài tắt"
    : sync?.hasConflict
      ? `Đang khóa bởi ${ownerLabel(sync?.owner)}`
      : isOwner
        ? "Bạn đang giữ quyền"
        : `Đang do ${ownerLabel(sync?.owner)} điều khiển`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="xl"
      PaperProps={{
        sx: {
          background: ui.paper,
          backgroundImage: "none",
          color: ui.text,
          borderRadius: fullScreen ? 0 : 4,
          overflow: "hidden",
        },
      }}
    >
      <DialogContent
        sx={{
          p: { xs: 1.2, sm: 1.6, md: 2 },
          bgcolor: "transparent",
        }}
      >
        <Stack spacing={1.5}>
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
                  onClick={() => runBusy("undo", () => api.undo())}
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
                  disabled={!canControl || Boolean(busy)}
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
                  disabled={!canControl || Boolean(busy)}
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
                  onClick={async () => {
                    setToolsOpen(true);
                    if (!courts.length && !courtsLoading) {
                      await loadCourts();
                    }
                  }}
                  disabled={!canControl}
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
          {sync?.hasConflict ? (
            <Alert
              severity="warning"
              icon={<WarningAmberIcon />}
              action={
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => sync.takeover?.()}>
                    Take over
                  </Button>
                  <Button size="small" onClick={() => sync.discardRejected?.()}>
                    Bỏ queue
                  </Button>
                </Stack>
              }
            >
              Trận đang bị khóa bởi {ownerLabel(sync?.owner)}. Bạn cần takeover để tiếp tục chấm.
            </Alert>
          ) : null}
          {featureEnabled && !sync?.hasConflict && !isOwner ? (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={() => sync.takeover?.()}>
                  Take over
                </Button>
              }
            >
              Trận hiện do {ownerLabel(sync?.owner)} điều khiển.
            </Alert>
          ) : null}

          <Box
            sx={{
              p: { xs: 1.25, md: 1.4 },
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              bgcolor: ui.card,
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", md: "center" }}
              spacing={1}
            >
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  label={syncLabel}
                  color={syncTone}
                  sx={{
                    fontWeight: 800,
                    maxWidth: "100%",
                  }}
                />
                {sync?.pendingCount ? (
                  <Chip
                    label={`Chờ sync ${sync.pendingCount}`}
                    sx={{
                      fontWeight: 800,
                      color: "#fbbf24",
                      bgcolor: alpha("#fbbf24", 0.12),
                      border: "1px solid",
                      borderColor: alpha("#fbbf24", 0.24),
                    }}
                  />
                ) : null}
              </Stack>

              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
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
                pair={leftPair}
                players={pairPlayers[leftSide] || []}
                slotMap={leftSide === "A" ? slotMapA : slotMapB}
                isServing={activeSide === leftSide}
                isActiveSide={activeSide === leftSide}
                serverUid={serverUidShow}
                onSwapSlots={() => flipTeamSlots(leftSide)}
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
                      disabled={!canControl || Boolean(busy)}
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
                pair={rightPair}
                players={pairPlayers[rightSide] || []}
                slotMap={rightSide === "A" ? slotMapA : slotMapB}
                isServing={activeSide === rightSide}
                isActiveSide={activeSide === rightSide}
                serverUid={serverUidShow}
                onSwapSlots={() => flipTeamSlots(rightSide)}
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
                    disabled={!canControl || Boolean(busy)}
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
                    disabled={!canControl || Boolean(busy)}
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
                    onClick={() => runBusy("point-left", () => api[leftSide === "A" ? "pointA" : "pointB"](1))}
                    disabled={!leftEnabled}
                    startIcon={busy === "point-left" ? <CircularProgress size={14} /> : <RefreshIcon sx={{ transform: "rotate(90deg)" }} />}
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
                    disabled={!canControl || Boolean(busy)}
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
                    onClick={() => runBusy("point-right", () => api[rightSide === "A" ? "pointA" : "pointB"](1))}
                    disabled={!rightEnabled}
                    startIcon={busy === "point-right" ? <CircularProgress size={14} /> : <RefreshIcon sx={{ transform: "rotate(90deg)" }} />}
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
                        disabled={busy === "settings" || !canControl}
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

                  <Stack spacing={0.8} flex={1}>
                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: ui.muted }}>
                      Gán sân
                    </Typography>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1.25}
                      alignItems={{ xs: "stretch", sm: "center" }}
                    >
                      <Button
                        variant="outlined"
                        startIcon={courtsLoading ? <CircularProgress size={14} /> : <RefreshIcon />}
                        onClick={loadCourts}
                        disabled={courtsLoading || busy === "courts" || !canControl}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Tải sân
                      </Button>
                      <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 220 } }}>
                        <InputLabel id="referee-court-select-label">Sân</InputLabel>
                        <Select
                          labelId="referee-court-select-label"
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
                      <Button
                        variant="contained"
                        onClick={handleAssignCourt}
                        disabled={!selectedCourtId || !canControl}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Gán
                      </Button>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={handleUnassignCourt}
                        disabled={!currentCourtId || !canControl}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Bỏ gán
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
                            runBusy(item, () =>
                              api.setServe({ side, server: Number(server) }),
                            )
                          }
                          disabled={!canControl || Boolean(busy)}
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
                        onClick={() => runBusy("finish-a", () => api.finish("A", "finish"))}
                        disabled={!canControl || Boolean(busy)}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Finish A
                      </Button>
                      <Button
                        variant="contained"
                        color="success"
                        onClick={() => runBusy("finish-b", () => api.finish("B", "finish"))}
                        disabled={!canControl || Boolean(busy)}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Finish B
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() => runBusy("forfeit-a", () => api.forfeit("A", "forfeit"))}
                        disabled={!canControl || Boolean(busy)}
                        sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                      >
                        Forfeit A
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() => runBusy("forfeit-b", () => api.forfeit("B", "forfeit"))}
                        disabled={!canControl || Boolean(busy)}
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
      </DialogContent>
    </Dialog>
  );
}
