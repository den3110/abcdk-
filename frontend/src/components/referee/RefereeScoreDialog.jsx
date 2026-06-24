/* eslint-disable react/prop-types */
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { alpha, createTheme, ThemeProvider } from "@mui/material/styles";
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
import { useSocket } from "../../context/SocketContext";
import { useSocketRoomSet } from "../../hook/useSocketRoomSet";
import { useLiveMatch } from "../../hook/useLiveMatch";
import {
  useAssignTournamentMatchToCourtStationMutation,
  useFreeTournamentCourtStationMutation,
  useGetTournamentCourtClusterOptionsQuery,
  useGetTournamentCourtClusterRuntimeQuery,
} from "../../slices/courtClustersAdminApiSlice";
import {
  getMatchCourtStationName,
  getMatchDisplayCode,
  getMatchSideDisplayName,
  getPlayerDisplayName,
  mergeMatchPayload,
  normalizeMatchDisplay,
  resolveDisplayMode,
} from "../../utils/matchDisplay";

const OPENING_DOUBLES_SERVER = 2;
const SCORE_TAP_GUARD_MS = 120;
const SCORE_RENDER_GUARD_MS = 2500;
const SERVER_UID_PIN_MS = 1800;
const UNDO_TAP_GUARD_MS = 220;
const SEED_PLACEHOLDER_GRACE_MS = 260;
const SEED_REFERENCE_TYPES = new Set([
  "grouprank",
  "stagematchwinner",
  "stagematchloser",
  "matchwinner",
  "matchloser",
]);

const textOf = (value) => (value && String(value).trim()) || "";
const normalizeServeOverride = (serve) => {
  if (!serve) return null;
  return {
    side: serve?.side === "B" ? "B" : "A",
    server: Number(serve?.order ?? serve?.server ?? 1) === 2 ? 2 : 1,
    serverId: serve?.serverId || null,
    opening: Boolean(serve?.opening),
  };
};
const idOf = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return textOf(value?._id || value?.id || value?.uid);
  }
  return textOf(value);
};
const safeIdentityTextOf = (value) => {
  const text = textOf(value);
  return text === "[object Object]" ? "" : text;
};

const identityTextOf = (value) => {
  if (value == null) return "";
  if (typeof value === "object") {
    return (
      identityTextOf(value?._id) ||
      identityTextOf(value?.id) ||
      identityTextOf(value?.uid) ||
      identityTextOf(value?.fullName) ||
      identityTextOf(value?.name) ||
      identityTextOf(value?.displayName) ||
      identityTextOf(value?.shortName) ||
      identityTextOf(value?.nickName) ||
      identityTextOf(value?.nickname) ||
      safeIdentityTextOf(value)
    );
  }
  return safeIdentityTextOf(value);
};

const personIdentityCandidatesOf = (person) => {
  if (person == null) return [];
  if (typeof person !== "object") return [identityTextOf(person)].filter(Boolean);

  const nestedUser = person?.user;
  const nestedProfile = person?.profile;
  const candidates = [
    nestedUser?._id,
    nestedUser?.id,
    nestedUser?.uid,
    nestedUser,
    person?._id,
    person?.id,
    person?.uid,
    nestedProfile?._id,
    nestedProfile?.id,
    nestedProfile?.uid,
    person?.fullName,
    person?.name,
    person?.displayName,
    person?.shortName,
    person?.nickName,
    person?.nickname,
    nestedUser?.fullName,
    nestedUser?.name,
    nestedUser?.displayName,
    nestedUser?.shortName,
    nestedUser?.nickName,
    nestedUser?.nickname,
    nestedProfile?.fullName,
    nestedProfile?.name,
    nestedProfile?.displayName,
    nestedProfile?.shortName,
    nestedProfile?.nickName,
    nestedProfile?.nickname,
  ]
    .map((value) => identityTextOf(value))
    .filter(Boolean);

  return [...new Set(candidates)];
};

const playerLabel = (player, source) => getPlayerDisplayName(player, source) || "";

const isIdleCourtStation = (station) => {
  if (!station || station.isActive === false) return false;
  if (String(station?.assignmentMode || "manual").toLowerCase() !== "manual") {
    return false;
  }
  const status = String(station?.status || "idle").toLowerCase();
  if (status !== "idle") return false;
  const currentMatchId = idOf(
    station?.currentMatchId || station?.currentMatch?._id || station?.currentMatch,
  );
  if (currentMatchId) return false;
  if (Number(station?.queueCount || 0) > 0) return false;
  return true;
};

const courtStationLabel = (station) =>
  [textOf(station?.name), textOf(station?.code)]
    .filter(Boolean)
    .join(" · ") || "Sân";

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

const pairHasDisplayablePlayers = (pair) => {
  if (!pair) return false;
  const players = Array.isArray(pair?.players) ? pair.players : [];
  const pairLabel =
    textOf(pair?.displayName) ||
    textOf(pair?.teamName) ||
    textOf(pair?.label) ||
    textOf(pair?.name);
  return Boolean(
    players.length ||
      pair?.player1 ||
      pair?.player2 ||
      pair?.p1 ||
      pair?.p2 ||
      pair?.user ||
      (pairLabel && !isSeedReferenceDisplay(pairLabel)),
  );
};

const sideNeedsSeedResolution = (match, side) => {
  const normalizedSide = side === "B" ? "B" : "A";
  if (pairHasDisplayablePlayers(sidePairOf(match, normalizedSide))) return false;

  const seed = normalizedSide === "A" ? match?.seedA : match?.seedB;
  const previous = normalizedSide === "A" ? match?.previousA : match?.previousB;
  return Boolean(
    previous ||
      SEED_REFERENCE_TYPES.has(textOf(seed?.type).replace(/\s+/g, "").toLowerCase()),
  );
};

const isSeedReferenceDisplay = (value) => {
  const normalized = textOf(value)
    .replace(/\s+/g, "")
    .replace(/\([AB]\)$/i, "");
  if (!normalized) return false;
  return (
    /^(?:[WL]-)?V\d+(?:-[A-Z0-9]+)?(?:-NT)?-T\d+$/i.test(normalized) ||
    /^(?:W|L)-/i.test(normalized)
  );
};

const hasResolvedTeamDisplayLabel = (value) => {
  const label = textOf(value);
  if (!label) return false;
  if (/^(TBD|Registration|Chưa có đội|Đội A|Đội B|—)$/i.test(label)) {
    return false;
  }
  return !isSeedReferenceDisplay(label);
};

const fallbackPlayerLabelsFromTeamLabel = (value) => {
  const label = textOf(value);
  if (!hasResolvedTeamDisplayLabel(label)) return [];

  const parts = label
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length ? parts : [label];
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

const isGameWin = (a = 0, b = 0, pointsToWin = 11, winByTwo = true, cap = {}) => {
  const left = Number(a || 0);
  const right = Number(b || 0);
  const max = Math.max(left, right);
  const min = Math.min(left, right);
  const capMode = String(cap?.mode ?? "none");
  const capPoints = Number(cap?.points);

  if (
    (capMode === "hard" || capMode === "soft") &&
    Number.isFinite(capPoints) &&
    capPoints > 0 &&
    (left >= capPoints || right >= capPoints)
  ) {
    return left !== right;
  }

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

const oppositeSlot = (slot) => (Number(slot) === 1 ? 2 : 1);

const sameSlotBase = (left = {}, right = {}) => {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Number(left?.[key]) === Number(right?.[key]));
};

const sameSlotsBase = (left = {}, right = {}) =>
  sameSlotBase(left?.A, right?.A) && sameSlotBase(left?.B, right?.B);

const sameLayout = (left = {}, right = {}) => {
  const leftLayout = normalizeLayout(left);
  const rightLayout = normalizeLayout(right);
  return leftLayout.left === rightLayout.left && leftLayout.right === rightLayout.right;
};

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

const findUndoableLiveLogEntry = (liveLog) => {
  if (!Array.isArray(liveLog)) return null;
  for (let index = liveLog.length - 1; index >= 0; index -= 1) {
    const entry = liveLog[index];
    const type = textOf(entry?.type).toLowerCase();
    if (["finish", "forfeit", "start"].includes(type)) return null;
    if (["point", "serve", "slots"].includes(type)) return entry;
  }
  return null;
};

const userIdOf = (user) => {
  return personIdentityCandidatesOf(user)[0] || "";
};

const playerIdCandidatesOf = (player) => {
  return personIdentityCandidatesOf(player);
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

const hasCompleteSlotsBaseForPlayers = (players, rawTeamBase = {}) => {
  const list = (Array.isArray(players) ? players : []).filter(Boolean).slice(0, 2);
  if (list.length < 2) return true;
  const slots = list.map((player) => resolveBaseSlotForPlayer(player, rawTeamBase));
  return slots.every((slot) => slot === 1 || slot === 2) && new Set(slots).size === slots.length;
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

const refereeScoreDigitSx = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: { xs: 72, md: 92 },
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum"',
  letterSpacing: 0,
};

const refereeSetDigitSx = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: { xs: 42, md: 52 },
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum"',
  letterSpacing: 0,
};

const refereeScoreLabelSx = {
  width: { xs: 52, md: 64 },
  flexShrink: 0,
  textAlign: "center",
};

const stableButtonIconSx = {
  "& .MuiButton-startIcon": {
    width: 22,
    minWidth: 22,
    display: "inline-flex",
    justifyContent: "center",
  },
  "& .MuiButton-endIcon": {
    width: 22,
    minWidth: 22,
    display: "inline-flex",
    justifyContent: "center",
  },
};

const BreakCountdown = memo(function BreakCountdown({ endTime, color = "#ef4444" }) {
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
});

const LiveClock = memo(function LiveClock({ color = "inherit" }) {
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
});

const PlayerRow = memo(function PlayerRow({
  label,
  isServer,
  muted,
  borderColor,
  accentColor,
  textColor,
  rowBg,
}) {
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
        bgcolor: isServer ? alpha(accentColor, 0.16) : rowBg,
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
            color: textColor,
            lineHeight: 1.2,
          }}
        >
          {label || "Chưa có VĐV"}
        </Typography>
      </Stack>
    </Stack>
  );
});

const TeamPanel = memo(function TeamPanel({
  title,
  teamLabel,
  players,
  isServing,
  isActiveSide,
  serverUid,
  onSwapSlots,
  displayMode,
  muted,
  borderColor,
  accentColor,
  textColor,
  surfaceBg,
  surfaceStrongBg,
  align = "left",
  swapDisabled = false,
  loading = false,
  loadingRows = 2,
}) {
  const alignedText = align === "right" ? "right" : "left";
  const fallbackPlayerLabels = fallbackPlayerLabelsFromTeamLabel(teamLabel);

  return (
    <Box
      sx={{
        flex: { xs: "1 1 auto", md: "1 1 0" },
        minWidth: 0,
        borderRadius: 4,
        border: "1px solid",
        borderColor: isActiveSide ? alpha(accentColor, 0.62) : borderColor,
        bgcolor: isActiveSide ? alpha(accentColor, 0.14) : surfaceBg,
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
            bgcolor: isServing ? alpha(accentColor, 0.22) : surfaceStrongBg,
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
            color: textColor,
            lineHeight: 1.05,
          }}
        >
          {teamLabel}
        </Typography>
      </Box>

      <Stack spacing={1}>
        {loading ? (
          Array.from({ length: Math.max(1, Number(loadingRows) || 2) }).map((_, index) => (
            <Skeleton
              key={`player-order-skeleton-${index}`}
              variant="rounded"
              sx={{
                height: 40,
                borderRadius: 999,
                bgcolor: alpha(muted, 0.14),
                border: "1px solid",
                borderColor,
              }}
            />
          ))
        ) : players.length ? (
          players.map((player) => {
            const uid = userIdOf(player);
            return (
              <PlayerRow
                key={uid || playerLabel(player, displayMode)}
                label={playerLabel(player, displayMode)}
                isServer={playerMatchesId(player, serverUid)}
                muted={muted}
                borderColor={borderColor}
                accentColor={accentColor}
                textColor={textColor}
                rowBg={surfaceStrongBg}
              />
            );
          })
        ) : fallbackPlayerLabels.length ? (
          fallbackPlayerLabels.map((label, index) => (
            <PlayerRow
              key={`${label}-${index}`}
              label={label}
              isServer={false}
              muted={muted}
              borderColor={borderColor}
              accentColor={accentColor}
              textColor={textColor}
              rowBg={surfaceStrongBg}
            />
          ))
        ) : (
          <PlayerRow
            label="Chưa đủ VĐV"
            slot="?"
            isServer={false}
            muted={muted}
            borderColor={borderColor}
            accentColor={accentColor}
            textColor={textColor}
            rowBg={surfaceStrongBg}
          />
        )}
      </Stack>
    </Box>
  );
});

const PaperLine = memo(function PaperLine({ label, value, ui }) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        gap: 1.5,
        p: 1.25,
        borderRadius: 3,
        bgcolor: alpha("#ffffff", 0.03),
        border: "1px solid",
        borderColor: ui.border,
      }}
    >
      <Typography sx={{ color: ui.muted, fontWeight: 800 }}>{label}</Typography>
      <Typography sx={{ color: ui.text, fontWeight: 900, textAlign: "right" }}>
        {value}
      </Typography>
    </Box>
  );
});

export default function RefereeScoreDialog({
  open,
  matchId,
  initialMatch = null,
  onClose,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const fastInteractionTheme = useMemo(
    () =>
      createTheme(theme, {
        components: {
          MuiButtonBase: {
            defaultProps: {
              disableRipple: true,
              disableTouchRipple: true,
            },
          },
        },
      }),
    [theme],
  );
  const { userInfo } = useSelector((state) => state.auth || {});
  const socket = useSocket();
  const token = userInfo?.token || "";
  const {
    data,
    error,
    api,
    sync,
    loading: liveMatchLoading,
    refetch: refetchLiveMatch,
  } = useLiveMatch(matchId, token, {
    offlineSync: true,
    optimisticUpdates: false,
    persistCache: false,
    enabled: open && Boolean(matchId),
  });

  const match = useMemo(() => {
    if (data && initialMatch) {
      return mergeMatchPayload(initialMatch, data, initialMatch);
    }
    return normalizeMatchDisplay(data || initialMatch || null, initialMatch || data || null);
  }, [data, initialMatch]);
  const normalizedMatchId = idOf(match?._id || match?.id || matchId);
  const normalizedTournamentId = idOf(match?.tournament?._id || match?.tournament);
  const playerDisplayMode = useMemo(
    () =>
      resolveDisplayMode({
        displayNameMode: match?.displayNameMode,
        nameDisplayMode: match?.nameDisplayMode,
        tournament: {
          displayNameMode: match?.tournament?.displayNameMode,
          nameDisplayMode: match?.tournament?.nameDisplayMode,
        },
      }),
    [
      match?.displayNameMode,
      match?.nameDisplayMode,
      match?.tournament?.displayNameMode,
      match?.tournament?.nameDisplayMode,
    ],
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
      activeText: theme.palette.mode === "dark" ? "#f8fafc" : "#1d4ed8",
      subtleBg:
        theme.palette.mode === "dark"
          ? "rgba(255,255,255,0.02)"
          : "rgba(15,23,42,0.02)",
      subtleBgStrong:
        theme.palette.mode === "dark"
          ? "rgba(255,255,255,0.05)"
          : "rgba(15,23,42,0.035)",
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
      cap: {
        mode: String(match?.rules?.cap?.mode ?? "none"),
        points:
          match?.rules?.cap?.points == null
            ? null
            : Number(match.rules.cap.points),
      },
    }),
    [
      match?.rules?.bestOf,
      match?.rules?.cap?.mode,
      match?.rules?.cap?.points,
      match?.rules?.pointsToWin,
      match?.rules?.winByTwo,
    ],
  );

  const gameScores = useMemo(() => gameScoresOf(match), [match]);
  const currentGame = currentGameIndexOf(match || {});
  const rawCurrentScore = useMemo(() => currentScoreOf(match || {}), [match]);
  const scoreTapGuardRef = useRef({ side: "", until: 0 });
  const undoTapGuardUntilRef = useRef(0);
  const scoreGuardRef = useRef({ a: null, b: null, until: 0, mode: "max" });
  const lastServerUidRef = useRef("");
  const openingServerRef = useRef({ gameIndex: -1, side: "", uid: "" });
  const openingServeInitRef = useRef({});
  const forcedServerRef = useRef({
    uid: "",
    until: 0,
    gameIndex: -1,
    side: "",
    serverNum: 0,
  });
  const prevServeSnapRef = useRef({
    gameIndex: -1,
    scoreA: 0,
    scoreB: 0,
    activeSide: "A",
    activeServerNum: 1,
    serverUidShow: "",
  });
  const scoreGuard = scoreGuardRef.current;
  const scoreGuardOn = Date.now() < Number(scoreGuard?.until || 0);
  const currentScore = useMemo(
    () => ({
      a:
        scoreGuardOn && typeof scoreGuard?.a === "number"
          ? scoreGuard?.mode === "replace"
            ? scoreGuard.a
            : Math.max(rawCurrentScore.a, scoreGuard.a)
          : rawCurrentScore.a,
      b:
        scoreGuardOn && typeof scoreGuard?.b === "number"
          ? scoreGuard?.mode === "replace"
            ? scoreGuard.b
            : Math.max(rawCurrentScore.b, scoreGuard.b)
          : rawCurrentScore.b,
    }),
    [
      rawCurrentScore.a,
      rawCurrentScore.b,
      scoreGuard?.a,
      scoreGuard?.b,
      scoreGuard?.mode,
      scoreGuardOn,
    ],
  );
  const breakState = useMemo(
    () => normalizeBreakState(match?.isBreak || match?.break || match?.pause),
    [match?.break, match?.isBreak, match?.pause],
  );
  const [localBaseOverride, setLocalBaseOverride] = useState(null);
  const [localLayoutOverride, setLocalLayoutOverride] = useState(null);
  const [localServeOverride, setLocalServeOverride] = useState(null);
  const localBaseRef = useRef(null);
  const localLayoutRef = useRef(null);
  const localServeRef = useRef(null);
  const serverBaseSource = useMemo(
    () => match?.slots?.base || match?.meta?.slots?.base || null,
    [match?.meta?.slots?.base, match?.slots?.base],
  );
  const serverBase = useMemo(() => serverBaseSource || { A: {}, B: {} }, [serverBaseSource]);
  const rawBase = localBaseOverride || localBaseRef.current || serverBase;
  const serveState = useMemo(
    () => localServeOverride || localServeRef.current || match?.serve || {},
    [localServeOverride, match?.serve],
  );
  const serverLayout = useMemo(
    () => normalizeLayout(match?.meta?.refereeLayout),
    [match?.meta?.refereeLayout],
  );
  const currentLayout = localLayoutOverride || localLayoutRef.current || serverLayout;
  const activeSide = serveState?.side === "B" ? "B" : "A";
  const rawServerNum =
    Number(serveState?.order ?? serveState?.server ?? 1) === 2 ? 2 : 1;
  const leftSide = currentLayout.left;
  const rightSide = currentLayout.right;
  const isDouble = eventType !== "single";
  const leftTeamDisplayLabel = useMemo(
    () => getMatchSideDisplayName(match, leftSide, "TBD"),
    [leftSide, match],
  );
  const rightTeamDisplayLabel = useMemo(
    () => getMatchSideDisplayName(match, rightSide, "TBD"),
    [rightSide, match],
  );
  const leftSeedLabelPending = useMemo(
    () =>
      sideNeedsSeedResolution(match, leftSide) &&
      isSeedReferenceDisplay(leftTeamDisplayLabel),
    [leftSide, leftTeamDisplayLabel, match],
  );
  const rightSeedLabelPending = useMemo(
    () =>
      sideNeedsSeedResolution(match, rightSide) &&
      isSeedReferenceDisplay(rightTeamDisplayLabel),
    [match, rightSide, rightTeamDisplayLabel],
  );
  const hasSeedLabelFlash = leftSeedLabelPending || rightSeedLabelPending;
  const [holdingSeedLabels, setHoldingSeedLabels] = useState(false);
  useEffect(() => {
    if (!open || !match?._id || !hasSeedLabelFlash) {
      setHoldingSeedLabels(false);
      return undefined;
    }

    setHoldingSeedLabels(true);
    const timer = window.setTimeout(
      () => setHoldingSeedLabels(false),
      SEED_PLACEHOLDER_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [hasSeedLabelFlash, match?._id, open]);

  const showSeedLabelLoading =
    hasSeedLabelFlash && (holdingSeedLabels || liveMatchLoading);
  const loadingTeamLabel = "Đang nạp đội thi đấu...";
  const leftTeamLabelLoading = showSeedLabelLoading && leftSeedLabelPending;
  const rightTeamLabelLoading = showSeedLabelLoading && rightSeedLabelPending;
  const leftPanelTeamLabel = leftTeamLabelLoading
    ? loadingTeamLabel
    : leftTeamDisplayLabel;
  const rightPanelTeamLabel = rightTeamLabelLoading
    ? loadingTeamLabel
    : rightTeamDisplayLabel;
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
  const liveSyncBusy = Boolean(sync?.pendingCount || sync?.syncing);

  useEffect(() => {
    if (!localBaseOverride) return;
    if (liveSyncBusy) return;
    if (sameSlotsBase(localBaseOverride, serverBase)) {
      localBaseRef.current = null;
      setLocalBaseOverride(null);
    }
  }, [liveSyncBusy, localBaseOverride, serverBase]);

  useEffect(() => {
    if (!localBaseOverride) return undefined;
    if (liveSyncBusy) return undefined;
    const timeoutId = window.setTimeout(() => {
      localBaseRef.current = null;
      setLocalBaseOverride(null);
    }, SCORE_RENDER_GUARD_MS);
    return () => window.clearTimeout(timeoutId);
  }, [liveSyncBusy, localBaseOverride]);

  useEffect(() => {
    if (!localLayoutOverride) return;
    if (liveSyncBusy) return;
    if (sameLayout(localLayoutOverride, serverLayout)) {
      localLayoutRef.current = null;
      setLocalLayoutOverride(null);
    }
  }, [liveSyncBusy, localLayoutOverride, serverLayout]);

  useEffect(() => {
    if (!localLayoutOverride) return undefined;
    if (liveSyncBusy) return undefined;
    const timeoutId = window.setTimeout(() => {
      localLayoutRef.current = null;
      setLocalLayoutOverride(null);
    }, SCORE_RENDER_GUARD_MS);
    return () => window.clearTimeout(timeoutId);
  }, [liveSyncBusy, localLayoutOverride]);

  useEffect(() => {
    if (!localServeOverride) return;
    if (liveSyncBusy) return;
    const serverSide = match?.serve?.side === "B" ? "B" : "A";
    const serverNum =
      Number(match?.serve?.order ?? match?.serve?.server ?? 1) === 2 ? 2 : 1;
    const serverId = textOf(match?.serve?.serverId);
    const serverOpening = Boolean(match?.serve?.opening);
    if (
      serverSide === localServeOverride.side &&
      serverNum === localServeOverride.server &&
      serverId === textOf(localServeOverride.serverId) &&
      serverOpening === Boolean(localServeOverride.opening)
    ) {
      localServeRef.current = null;
      setLocalServeOverride(null);
    }
  }, [
    liveSyncBusy,
    localServeOverride,
    match?.serve?.opening,
    match?.serve?.order,
    match?.serve?.server,
    match?.serve?.serverId,
    match?.serve?.side,
  ]);

  useEffect(() => {
    if (!localServeOverride) return undefined;
    if (liveSyncBusy) return undefined;
    const timeoutId = window.setTimeout(() => {
      localServeRef.current = null;
      setLocalServeOverride(null);
    }, SCORE_RENDER_GUARD_MS);
    return () => window.clearTimeout(timeoutId);
  }, [liveSyncBusy, localServeOverride]);

  const wins = useMemo(() => {
    return gameScores.reduce(
      (acc, score) => {
        if (!isGameWin(score?.a, score?.b, rules.pointsToWin, rules.winByTwo, rules.cap)) return acc;
        if (Number(score?.a || 0) > Number(score?.b || 0)) acc.a += 1;
        if (Number(score?.b || 0) > Number(score?.a || 0)) acc.b += 1;
        return acc;
      },
      { a: 0, b: 0 },
    );
  }, [gameScores, rules.cap, rules.pointsToWin, rules.winByTwo]);

  const leftGameScore = leftSide === "A" ? currentScore.a : currentScore.b;
  const rightGameScore = rightSide === "A" ? currentScore.a : currentScore.b;
  const leftSetWins = leftSide === "A" ? wins.a : wins.b;
  const rightSetWins = rightSide === "A" ? wins.a : wins.b;
  const currentGameFinished = isGameWin(
    currentScore.a,
    currentScore.b,
    rules.pointsToWin,
    rules.winByTwo,
    rules.cap,
  );
  const currentGameWinner = currentGameFinished
    ? Number(currentScore.a || 0) > Number(currentScore.b || 0)
      ? "A"
      : "B"
    : "";
  const currentGameScoreFromServer = gameScores[currentGame] || {};
  const currentGameAlreadyCounted = isGameWin(
    currentGameScoreFromServer?.a,
    currentGameScoreFromServer?.b,
    rules.pointsToWin,
    rules.winByTwo,
    rules.cap,
  );
  const projectedWins = {
    a:
      wins.a +
      (currentGameWinner === "A" && !currentGameAlreadyCounted ? 1 : 0),
    b:
      wins.b +
      (currentGameWinner === "B" && !currentGameAlreadyCounted ? 1 : 0),
  };
  const matchDecided =
    match?.status === "finished" ||
    projectedWins.a >= needWins(rules.bestOf) ||
    projectedWins.b >= needWins(rules.bestOf);
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
  const activeServerNum =
    needsStartAction && isDouble ? OPENING_DOUBLES_SERVER : rawServerNum;
  const isOpeningServe = isDouble && Boolean(serveState?.opening);
  const isPreStartOrOpening =
    needsStartAction ||
    (Number(currentScore.a) === 0 && Number(currentScore.b) === 0 && isOpeningServe);
  const isOpeningServeLocked =
    isDouble &&
    Number(currentScore.a) === 0 &&
    Number(currentScore.b) === 0 &&
    (needsStartAction ||
      isOpeningServe ||
      activeServerNum === OPENING_DOUBLES_SERVER);
  const isOwner = sync?.isOwner ?? true;
  const featureEnabled = sync?.featureEnabled !== false;
  const isBreakActive = Boolean(breakState?.active);
  const breakLocksLiveControls =
    Boolean(match?._id) && match?.status === "live" && isBreakActive;
  const canScoreByMatchState =
    Boolean(match?._id) &&
    match?.status === "live" &&
    !breakLocksLiveControls;
  const lastUndoableEntry = useMemo(
    () => findUndoableLiveLogEntry(match?.liveLog),
    [match?.liveLog],
  );
  const canUndo =
    Boolean(match?._id) && match?.status === "live" && !breakLocksLiveControls;

  const [pointsToWin, setPointsToWin] = useState("");
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [selectedClusterId, setSelectedClusterId] = useState("");
  const [busy, setBusy] = useState("");
  const [, forceOptimisticRender] = useState(0);
  const [actionError, setActionError] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [courtDialogOpen, setCourtDialogOpen] = useState(false);
  const [drawDialogOpen, setDrawDialogOpen] = useState(false);
  const [drawPreview, setDrawPreview] = useState(null);
  const [toast, setToast] = useState({
    open: false,
    message: "",
    severity: "info",
  });
  const playerOrderBaseSource = localBaseOverride || localBaseRef.current || serverBaseSource || {};
  const playerOrderHydrating =
    open && isDouble && (liveMatchLoading || liveSyncBusy || busy === "start");
  const leftPlayerOrderLoading =
    playerOrderHydrating &&
    !hasCompleteSlotsBaseForPlayers(
      pairPlayers[leftSide] || [],
      playerOrderBaseSource?.[leftSide] || {},
    );
  const rightPlayerOrderLoading =
    playerOrderHydrating &&
    !hasCompleteSlotsBaseForPlayers(
      pairPlayers[rightSide] || [],
      playerOrderBaseSource?.[rightSide] || {},
    );
  const leftPanelLoading = leftTeamLabelLoading || leftPlayerOrderLoading;
  const rightPanelLoading = rightTeamLabelLoading || rightPlayerOrderLoading;
  const leftPanelLoadingRows = Math.max(1, Math.min(2, (pairPlayers[leftSide] || []).length || 2));
  const rightPanelLoadingRows = Math.max(1, Math.min(2, (pairPlayers[rightSide] || []).length || 2));

  const currentCourtStationId = idOf(
    match?.courtStationId || match?.courtStation?._id || match?.courtStation,
  );
  const currentCourtId = textOf(match?.court?._id || match?.courtId || currentCourtStationId);
  const currentCourtLabel = courtLabelOf(match || {});
  const isInteractionLocked = Boolean(match?._id) && featureEnabled && !isOwner;

  const {
    data: clusterOptionsData,
    isLoading: isLoadingClusterOptions,
    isFetching: isFetchingClusterOptions,
    refetch: refetchClusterOptions,
  } = useGetTournamentCourtClusterOptionsQuery(normalizedTournamentId, {
    skip: !open || !courtDialogOpen || !normalizedTournamentId,
    refetchOnMountOrArgChange: true,
  });

  const allowedClusterOptions = useMemo(() => {
    const selectedIds = Array.isArray(clusterOptionsData?.selectedIds)
      ? clusterOptionsData.selectedIds.map(idOf).filter(Boolean)
      : [];
    const items = Array.isArray(clusterOptionsData?.items)
      ? clusterOptionsData.items
      : [];
    const selectedItems = items.filter((cluster) =>
      selectedIds.includes(idOf(cluster?._id || cluster?.id)),
    );
    return selectedItems.length ? selectedItems : items;
  }, [clusterOptionsData?.items, clusterOptionsData?.selectedIds]);

  useEffect(() => {
    if (!courtDialogOpen) return;
    const allowedIds = allowedClusterOptions
      .map((cluster) => idOf(cluster?._id || cluster?.id))
      .filter(Boolean);
    if (selectedClusterId && allowedIds.includes(selectedClusterId)) return;

    const currentClusterId = idOf(
      match?.courtClusterId ||
        match?.courtStation?.clusterId ||
        match?.courtCluster?._id,
    );
    setSelectedClusterId(
      (currentClusterId && allowedIds.includes(currentClusterId)
        ? currentClusterId
        : allowedIds[0]) || "",
    );
  }, [
    allowedClusterOptions,
    courtDialogOpen,
    match?.courtCluster?._id,
    match?.courtClusterId,
    match?.courtStation?.clusterId,
    selectedClusterId,
  ]);

  const {
    data: courtRuntime,
    isLoading: isLoadingCourtRuntime,
    isFetching: isFetchingCourtRuntime,
    error: courtRuntimeError,
    refetch: refetchCourtRuntime,
  } = useGetTournamentCourtClusterRuntimeQuery(
    {
      tournamentId: normalizedTournamentId,
      clusterId: selectedClusterId,
    },
    {
      skip:
        !open ||
        !courtDialogOpen ||
        !normalizedTournamentId ||
        !selectedClusterId,
      refetchOnMountOrArgChange: true,
    },
  );

  const courtClusterRoomIds = useMemo(
    () => (courtDialogOpen && selectedClusterId ? [selectedClusterId] : []),
    [courtDialogOpen, selectedClusterId],
  );

  useSocketRoomSet(socket, courtClusterRoomIds, {
    subscribeEvent: "court-cluster:watch",
    unsubscribeEvent: "court-cluster:unwatch",
    payloadKey: "clusterId",
    onResync: () => {
      refetchCourtRuntime?.();
    },
  });

  useEffect(() => {
    if (!socket || !courtDialogOpen || !selectedClusterId) return undefined;

    const handleRuntimeUpdate = (payload) => {
      const payloadClusterId = idOf(
        payload?.cluster?._id ||
          payload?.clusterId ||
          payload?.station?.clusterId,
      );
      if (payloadClusterId !== selectedClusterId) return;
      refetchCourtRuntime?.();
    };

    socket.on("court-cluster:update", handleRuntimeUpdate);
    socket.on("court-station:update", handleRuntimeUpdate);
    return () => {
      socket.off("court-cluster:update", handleRuntimeUpdate);
      socket.off("court-station:update", handleRuntimeUpdate);
    };
  }, [courtDialogOpen, refetchCourtRuntime, selectedClusterId, socket]);

  const courts = useMemo(
    () =>
      (Array.isArray(courtRuntime?.stations) ? courtRuntime.stations : [])
        .filter(isIdleCourtStation)
        .sort((a, b) => {
          const orderDiff = Number(a?.order || 0) - Number(b?.order || 0);
          if (orderDiff) return orderDiff;
          return courtStationLabel(a).localeCompare(courtStationLabel(b), "vi", {
            numeric: true,
            sensitivity: "base",
          });
        }),
    [courtRuntime?.stations],
  );

  const courtsLoading =
    isLoadingClusterOptions ||
    isFetchingClusterOptions ||
    isLoadingCourtRuntime ||
    isFetchingCourtRuntime;

  const [assignMatchToCourtStation, { isLoading: assigningCourtStation }] =
    useAssignTournamentMatchToCourtStationMutation();
  const [freeCourtStation, { isLoading: freeingCourtStation }] =
    useFreeTournamentCourtStationMutation();

  useEffect(() => {
    setPointsToWin(
      match?.rules?.pointsToWin != null ? String(match.rules.pointsToWin) : "",
    );
  }, [match?.rules?.pointsToWin]);

  useEffect(() => {
    if (!courtDialogOpen) {
      setSelectedCourtId("");
    }
  }, [courtDialogOpen]);

  useEffect(() => {
    if (!courtDialogOpen || !selectedCourtId) return;
    const stillIdle = courts.some((court) => idOf(court?._id || court?.id) === selectedCourtId);
    if (!stillIdle) {
      setSelectedCourtId("");
    }
  }, [courtDialogOpen, courts, selectedCourtId]);

  useEffect(() => {
    localBaseRef.current = null;
    localLayoutRef.current = null;
    localServeRef.current = null;
    setLocalBaseOverride(null);
    setLocalLayoutOverride(null);
    setLocalServeOverride(null);
    scoreTapGuardRef.current = { side: "", until: 0 };
    undoTapGuardUntilRef.current = 0;
    scoreGuardRef.current = { a: null, b: null, until: 0, mode: "max" };
    lastServerUidRef.current = "";
    openingServerRef.current = { gameIndex: -1, side: "", uid: "" };
    openingServeInitRef.current = {};
    forcedServerRef.current = {
      uid: "",
      until: 0,
      gameIndex: -1,
      side: "",
      serverNum: 0,
    };
    prevServeSnapRef.current = {
      gameIndex: -1,
      scoreA: 0,
      scoreB: 0,
      activeSide: "A",
      activeServerNum: 1,
      serverUidShow: "",
    };
  }, [match?._id, open]);

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

  const openingRightServerUid = useMemo(() => {
    if (!isDouble || !isPreStartOrOpening) return "";
    const rightSlot = preStartRightSlotForSide(activeSide, currentLayout);
    return (
      findUidAtCurrentSlot(activeSide, rightSlot) ||
      findUidAtCurrentSlot(activeSide, oppositeSlot(rightSlot)) ||
      firstPlayerIdOfSide(match, activeSide, eventType) ||
      ""
    );
  }, [
    activeSide,
    currentLayout,
    eventType,
    findUidAtCurrentSlot,
    isDouble,
    isPreStartOrOpening,
    match,
  ]);

  const serverUidShow = useMemo(() => {
    const pinnedOpeningServer =
      openingServerRef.current.gameIndex === currentGame &&
      openingServerRef.current.side === activeSide
        ? openingServerRef.current.uid
        : "";
    const rawServerUid = textOf(serveState?.serverId);
    const forcedUid =
      forcedServerRef.current.uid &&
      Date.now() < Number(forcedServerRef.current.until || 0) &&
      forcedServerRef.current.gameIndex === currentGame &&
      forcedServerRef.current.side === activeSide &&
      Number(forcedServerRef.current.serverNum) === Number(activeServerNum)
        ? forcedServerRef.current.uid
        : "";
    const previous = prevServeSnapRef.current || {};
    const serveSameAsPrevious =
      previous.gameIndex === currentGame &&
      previous.activeSide === activeSide &&
      Number(previous.activeServerNum) === Number(activeServerNum);
    const serveSideScored =
      serveSameAsPrevious &&
      (activeSide === "A"
        ? Number(currentScore.a) === Number(previous.scoreA) + 1 &&
          Number(currentScore.b) === Number(previous.scoreB)
        : Number(currentScore.b) === Number(previous.scoreB) + 1 &&
          Number(currentScore.a) === Number(previous.scoreA));
    const stablePreviousUid =
      textOf(previous.serverUidShow) ||
      (isPreStartOrOpening ? "" : lastServerUidRef.current) ||
      "";
    const fallbackSlot = isPreStartOrOpening
      ? preStartRightSlotForSide(activeSide, currentLayout)
      : activeServerNum;
    const fallback = findUidAtCurrentSlot(activeSide, fallbackSlot);
    const staleLastServerUid = isPreStartOrOpening
      ? ""
      : lastServerUidRef.current || "";
    const openingCorrectedUid =
      isDouble && isPreStartOrOpening && openingRightServerUid
        ? openingRightServerUid
        : "";
    const baseUid = serveSideScored
      ? stablePreviousUid ||
        openingCorrectedUid ||
        rawServerUid ||
        (isOpeningServe ? pinnedOpeningServer : "") ||
        fallback ||
        ""
      : openingCorrectedUid ||
        rawServerUid ||
        (isOpeningServe ? pinnedOpeningServer : "") ||
        fallback ||
        staleLastServerUid ||
        "";
    return forcedUid || baseUid || "";
  }, [
    activeServerNum,
    activeSide,
    currentLayout,
    currentGame,
    currentScore.a,
    currentScore.b,
    findUidAtCurrentSlot,
    isOpeningServe,
    isDouble,
    isPreStartOrOpening,
    serveState?.serverId,
    openingRightServerUid,
  ]);

  useEffect(() => {
    if (!match?._id) return;
    if (liveMatchLoading && !data) return;
    if (!isDouble || !isPreStartOrOpening) return;
    if (Number(currentScore.a) !== 0 || Number(currentScore.b) !== 0) return;
    if (!openingRightServerUid) return;

    const initKey = `${match._id}:${currentGame}:${activeSide}:${openingRightServerUid}`;
    const currentServerId = textOf(match?.serve?.serverId);
    const currentServerNum =
      Number(match?.serve?.order ?? match?.serve?.server ?? 1) === 2 ? 2 : 1;
    const serveAlreadyCorrect =
      currentServerId === openingRightServerUid &&
      currentServerNum === OPENING_DOUBLES_SERVER &&
      Boolean(match?.serve?.opening);

    if (serveAlreadyCorrect) {
      openingServeInitRef.current[initKey] = true;
      openingServerRef.current = {
        gameIndex: currentGame,
        side: activeSide,
        uid: openingRightServerUid,
      };
      lastServerUidRef.current = openingRightServerUid;
      return;
    }

    if (openingServeInitRef.current[initKey]) return;
    openingServeInitRef.current[initKey] = true;
    openingServerRef.current = {
      gameIndex: currentGame,
      side: activeSide,
      uid: openingRightServerUid,
    };
    lastServerUidRef.current = openingRightServerUid;
    forcedServerRef.current = {
      uid: openingRightServerUid,
      until: Date.now() + SCORE_RENDER_GUARD_MS,
      gameIndex: currentGame,
      side: activeSide,
      serverNum: OPENING_DOUBLES_SERVER,
    };

    if (!isInteractionLocked) {
      const nextServe = {
        side: activeSide,
        server: OPENING_DOUBLES_SERVER,
        serverId: openingRightServerUid,
        opening: true,
      };
      localServeRef.current = nextServe;
      setLocalServeOverride(nextServe);
      api.setServe(nextServe);
    }
  }, [
    activeSide,
    api,
    data,
    currentGame,
    currentScore.a,
    currentScore.b,
    isDouble,
    isInteractionLocked,
    isPreStartOrOpening,
    liveMatchLoading,
    match?._id,
    match?.serve?.opening,
    match?.serve?.order,
    match?.serve?.server,
    match?.serve?.serverId,
    openingRightServerUid,
  ]);

  useEffect(() => {
    const isZeroZero = Number(currentScore.a) === 0 && Number(currentScore.b) === 0;
    if (!isZeroZero || !isOpeningServe) return;
    const rightSlot = preStartRightSlotForSide(activeSide, currentLayout);
    const uid =
      openingRightServerUid ||
      textOf(match?.serve?.serverId) ||
      findUidAtCurrentSlot(activeSide, rightSlot) ||
      findUidAtCurrentSlot(activeSide, oppositeSlot(rightSlot)) ||
      "";
    if (!uid) return;
    openingServerRef.current = { gameIndex: currentGame, side: activeSide, uid };
    lastServerUidRef.current = uid;
  }, [
    activeSide,
    currentGame,
    currentLayout,
    currentScore.a,
    currentScore.b,
    findUidAtCurrentSlot,
    isOpeningServe,
    match?.serve?.serverId,
    openingRightServerUid,
  ]);

  useEffect(() => {
    if (serverUidShow) lastServerUidRef.current = serverUidShow;
  }, [serverUidShow]);

  useEffect(() => {
    prevServeSnapRef.current = {
      gameIndex: currentGame,
      scoreA: currentScore.a,
      scoreB: currentScore.b,
      activeSide,
      activeServerNum,
      serverUidShow,
    };
  }, [
    activeServerNum,
    activeSide,
    currentGame,
    currentScore.a,
    currentScore.b,
    serverUidShow,
  ]);

  const headerText = [
    String(matchCode(match || {})).toUpperCase(),
    `BO${rules.bestOf}`,
    `G${currentGame + 1}`,
  ].join(" | ");

  const preStartServeSideLabel =
    activeSide === leftSide ? "Đội bên trái" : "Đội bên phải";
  const drawSideLabel = useCallback(
    (side) =>
      getMatchSideDisplayName(match, side, side === "A" ? "Đội A" : "Đội B") ||
      (side === "A" ? "Đội A" : "Đội B"),
    [match],
  );
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
    if (needsStartAction) return isDouble ? `0-0-${OPENING_DOUBLES_SERVER}` : "0-0";
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
      startTransition(() => {
        setBusy(key);
      });
      try {
        await task();
      } catch (nextError) {
        handleError(nextError);
      } finally {
        startTransition(() => {
          setBusy("");
        });
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

  const runLiveControlFast = useCallback(
    async (task) => {
      if (!ensureLiveControlsAllowed()) return false;
      setActionError("");
      try {
        await task();
        return true;
      } catch (nextError) {
        handleError(nextError);
        return false;
      }
    },
    [ensureLiveControlsAllowed, handleError],
  );

  const loadCourts = useCallback(async () => {
    await runBusy("courts", async () => {
      const tasks = [];
      if (courtDialogOpen && normalizedTournamentId) {
        tasks.push(refetchClusterOptions?.());
      }
      if (courtDialogOpen && normalizedTournamentId && selectedClusterId) {
        tasks.push(refetchCourtRuntime?.());
      }
      await Promise.all(tasks.filter(Boolean));
    });
  }, [
    courtDialogOpen,
    normalizedTournamentId,
    refetchClusterOptions,
    refetchCourtRuntime,
    runBusy,
    selectedClusterId,
  ]);

  const openCourtDialog = useCallback(() => {
    if (!ensureInteractionAllowed()) return;
    setCourtDialogOpen(true);
  }, [ensureInteractionAllowed]);

  const flipWholeMatch = useCallback(async () => {
    const baseForSwap = localBaseRef.current || currentBase;
    const layoutForSwap = localLayoutRef.current || currentLayout;
    const nextBase = {
      A: flipSlotNumbers(baseForSwap?.A || {}),
      B: flipSlotNumbers(baseForSwap?.B || {}),
    };
    const nextLayout =
      layoutForSwap.left === "B" ? { left: "A", right: "B" } : { left: "B", right: "A" };
    let nextServe = localServeRef.current || serveState || null;
    if (isPreStartOrOpening) {
      const targetSlot = preStartRightSlotForSide(activeSide, nextLayout);
      const serverId =
        findUidAtCurrentSlot(activeSide, targetSlot, nextBase, { a: 0, b: 0 }) ||
        firstPlayerIdOfSide(match, activeSide, eventType) ||
        null;
      nextServe = {
        side: activeSide,
        server: isDouble ? OPENING_DOUBLES_SERVER : 1,
        serverId,
        opening: isDouble,
      };
    }
    await runLiveControlBusy("swap-sides", () => {
      localBaseRef.current = nextBase;
      localLayoutRef.current = nextLayout;
      setLocalBaseOverride(nextBase);
      setLocalLayoutOverride(nextLayout);
      if (nextServe) {
        localServeRef.current = nextServe;
        setLocalServeOverride(nextServe);
      }
      return api.setSlotsBase({
        base: nextBase,
        layout: nextLayout,
        serve: nextServe,
      });
    });
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
    serveState,
  ]);

  const flipTeamSlots = useCallback(
    async (side) => {
      const baseForSwap = localBaseRef.current || currentBase;
      const layoutForSwap = localLayoutRef.current || currentLayout;
      const nextBase = {
        ...baseForSwap,
        [side]: flipSlotNumbers(baseForSwap?.[side] || {}),
      };
      let nextServe = localServeRef.current || serveState || null;
      if (isPreStartOrOpening && side === activeSide) {
        const targetSlot = preStartRightSlotForSide(side, layoutForSwap);
        const serverId =
          findUidAtCurrentSlot(side, targetSlot, nextBase, { a: 0, b: 0 }) ||
          firstPlayerIdOfSide(match, side, eventType) ||
          null;
        nextServe = {
          side,
          server: isDouble ? OPENING_DOUBLES_SERVER : 1,
          serverId,
          opening: isDouble,
        };
      }
      await runLiveControlBusy(`swap-${side}`, () => {
        localBaseRef.current = nextBase;
        setLocalBaseOverride(nextBase);
        if (nextServe) {
          localServeRef.current = nextServe;
          setLocalServeOverride(nextServe);
        }
        return api.setSlotsBase({
          base: nextBase,
          layout: layoutForSwap,
          serve: nextServe,
        });
      });
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
      serveState,
    ],
  );
  const handleSwapLeftSlots = useCallback(
    () => flipTeamSlots(leftSide),
    [flipTeamSlots, leftSide],
  );
  const handleSwapRightSlots = useCallback(
    () => flipTeamSlots(rightSide),
    [flipTeamSlots, rightSide],
  );

  const toggleServerNum = useCallback(async () => {
    if (!match?._id) return;
    if (isOpeningServeLocked) return;
    const preStartOpening = isDouble && isPreStartOrOpening;
    const currentServe = localServeRef.current || serveState || {};
    const baseForLookup = localBaseRef.current || currentBase;
    const layoutForServe = localLayoutRef.current || currentLayout;
    const effectiveSide =
      currentServe?.side === "A" || currentServe?.side === "B"
        ? currentServe.side
        : activeSide;
    const effectiveServerNum =
      Number(currentServe?.order ?? currentServe?.server ?? activeServerNum ?? 1) === 2
        ? 2
        : 1;
    const nextServer = preStartOpening
      ? OPENING_DOUBLES_SERVER
      : effectiveServerNum === 1
        ? 2
        : 1;
    const nextSlot = preStartOpening
      ? preStartRightSlotForSide(effectiveSide, layoutForServe)
      : nextServer;
    let serverId = findUidAtCurrentSlot(effectiveSide, nextSlot, baseForLookup);
    if (!serverId) {
      const teamPlayers = pairPlayers[effectiveSide] || [];
      serverId =
        teamPlayers
          .map((player) => userIdOf(player))
          .find((uid) => uid && uid !== textOf(currentServe?.serverId)) || "";
    }
    const nextServe = {
      side: effectiveSide,
      server: nextServer,
      serverId: serverId || null,
      opening: preStartOpening,
    };
    await runLiveControlBusy("toggle-server-num", () => {
      if (serverId) {
        lastServerUidRef.current = serverId;
        forcedServerRef.current = {
          uid: serverId,
          until: Date.now() + SERVER_UID_PIN_MS,
          gameIndex: currentGame,
          side: effectiveSide,
          serverNum: nextServer,
        };
      }
      localServeRef.current = nextServe;
      setLocalServeOverride(nextServe);
      return api.setServe(nextServe);
    });
  }, [
    activeServerNum,
    activeSide,
    api,
    currentBase,
    currentGame,
    currentLayout,
    findUidAtCurrentSlot,
    isDouble,
    isOpeningServeLocked,
    isPreStartOrOpening,
    match?._id,
    pairPlayers,
    runLiveControlBusy,
    serveState,
  ]);

  const toggleServeSide = useCallback(async () => {
    if (!match?._id) return;
    const currentServe = localServeRef.current || serveState || {};
    const baseForLookup = localBaseRef.current || currentBase;
    const layoutForServe = localLayoutRef.current || currentLayout;
    const currentSide =
      currentServe?.side === "A" || currentServe?.side === "B"
        ? currentServe.side
        : activeSide;
    const nextSide = currentSide === "A" ? "B" : "A";
    const opening = isDouble && needsStartAction;
    const preferredSlot = opening
      ? preStartRightSlotForSide(nextSide, layoutForServe)
      : 1;
    let serverId = findUidAtCurrentSlot(nextSide, preferredSlot, baseForLookup);
    if (!serverId) {
      serverId = firstPlayerIdOfSide(match, nextSide, eventType);
    }
    const nextServe = {
      side: nextSide,
      server: opening ? OPENING_DOUBLES_SERVER : 1,
      serverId: serverId || null,
      opening,
    };
    await runLiveControlBusy("toggle-serve-side", () => {
      if (serverId) {
        lastServerUidRef.current = serverId;
        forcedServerRef.current = {
          uid: serverId,
          until: Date.now() + SERVER_UID_PIN_MS,
          gameIndex: currentGame,
          side: nextSide,
          serverNum: nextServe.server,
        };
      }
      localServeRef.current = nextServe;
      setLocalServeOverride(nextServe);
      return api.setServe(nextServe);
    });
  }, [
    activeSide,
    api,
    currentBase,
    currentGame,
    currentLayout,
    eventType,
    findUidAtCurrentSlot,
    isDouble,
    match,
    needsStartAction,
    runLiveControlBusy,
    serveState,
  ]);

  const buildRandomDrawResult = useCallback(() => {
    const nextLayout = Math.random() > 0.5 ? { left: "A", right: "B" } : { left: "B", right: "A" };
    const nextSide = Math.random() > 0.5 ? "A" : "B";
    const preferredSlot = isDouble
      ? preStartRightSlotForSide(nextSide, nextLayout)
      : 1;
    const serverId =
      findUidAtCurrentSlot(nextSide, preferredSlot, currentBase, { a: 0, b: 0 }) ||
      firstPlayerIdOfSide(match, nextSide, eventType) ||
      null;
    return {
      nextLayout,
      nextSide,
      preferredSlot,
      serverId,
    };
  }, [
    currentBase,
    eventType,
    findUidAtCurrentSlot,
    isDouble,
    match,
  ]);

  const applyDrawResult = useCallback(async (result) => {
    if (!result) return;
    const baseForDraw = localBaseRef.current || currentBase;
    const nextServe = {
      side: result.nextSide,
      server: isDouble ? OPENING_DOUBLES_SERVER : 1,
      serverId: result.serverId,
      opening: isDouble,
    };
    await runProtectedBusy("draw", () => {
      localLayoutRef.current = result.nextLayout;
      localServeRef.current = nextServe;
      setLocalLayoutOverride(result.nextLayout);
      setLocalServeOverride(nextServe);
      return api.setSlotsBase({
        base: baseForDraw,
        layout: result.nextLayout,
        serve: nextServe,
      });
    });
  }, [
    api,
    currentBase,
    isDouble,
    runProtectedBusy,
  ]);

  const handleRandomDraw = useCallback(() => {
    if (!ensureInteractionAllowed()) return;
    setDrawPreview(buildRandomDrawResult());
    setDrawDialogOpen(true);
  }, [
    buildRandomDrawResult,
    ensureInteractionAllowed,
  ]);

  const rerollDrawPreview = useCallback(() => {
    setDrawPreview(buildRandomDrawResult());
  }, [buildRandomDrawResult]);

  const confirmRandomDraw = useCallback(async () => {
    const result = drawPreview || buildRandomDrawResult();
    await applyDrawResult(result);
    setDrawDialogOpen(false);
  }, [applyDrawResult, buildRandomDrawResult, drawPreview]);

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
  const handleTimeoutLeft = useCallback(
    () => handleBreak("timeout", leftSide),
    [handleBreak, leftSide],
  );
  const handleMedicalLeft = useCallback(
    () => handleBreak("medical", leftSide),
    [handleBreak, leftSide],
  );
  const handleTimeoutRight = useCallback(
    () => handleBreak("timeout", rightSide),
    [handleBreak, rightSide],
  );
  const handleMedicalRight = useCallback(
    () => handleBreak("medical", rightSide),
    [handleBreak, rightSide],
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
    if (!normalizedTournamentId || !normalizedMatchId) return;
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("assign-court", () =>
      assignMatchToCourtStation({
        tournamentId: normalizedTournamentId,
        stationId: selectedCourtId,
        matchId: normalizedMatchId,
      }).unwrap(),
    );
    await refetchLiveMatch?.();
    await refetchCourtRuntime?.();
    setCourtDialogOpen(false);
    pushToast("Đã gán sân.", "success");
  }, [
    assignMatchToCourtStation,
    ensureInteractionAllowed,
    normalizedMatchId,
    normalizedTournamentId,
    pushToast,
    refetchCourtRuntime,
    refetchLiveMatch,
    runProtectedBusy,
    selectedCourtId,
  ]);

  const handleUnassignCourt = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("unassign-court", async () => {
      if (currentCourtStationId && normalizedTournamentId) {
        await freeCourtStation({
          tournamentId: normalizedTournamentId,
          stationId: currentCourtStationId,
        }).unwrap();
        return;
      }
      await api.unassignCourt({ toStatus: "queued" });
    });
    await refetchLiveMatch?.();
    await refetchCourtRuntime?.();
    setCourtDialogOpen(false);
    pushToast("Đã bỏ gán sân.", "success");
  }, [
    api,
    currentCourtStationId,
    ensureInteractionAllowed,
    freeCourtStation,
    normalizedTournamentId,
    pushToast,
    refetchCourtRuntime,
    refetchLiveMatch,
    runProtectedBusy,
  ]);

  const handleStart = useCallback(async () => {
    if (!ensureInteractionAllowed()) return;
    await runProtectedBusy("start", async () => {
      if (isDouble && Number(currentScore.a) === 0 && Number(currentScore.b) === 0) {
        const baseForStart = localBaseRef.current || currentBase;
        const layoutForStart = localLayoutRef.current || currentLayout;
        const rightSlot = preStartRightSlotForSide(activeSide, layoutForStart);
        const serverId =
          openingRightServerUid ||
          textOf(match?.serve?.serverId) ||
          findUidAtCurrentSlot(activeSide, rightSlot, baseForStart) ||
          serverUidShow ||
          findUidAtCurrentSlot(activeSide, oppositeSlot(rightSlot), baseForStart) ||
          firstPlayerIdOfSide(match, activeSide, eventType) ||
          "";
        if (serverId && textOf(match?.serve?.serverId) !== serverId) {
          const nextServe = {
            side: activeSide,
            server: OPENING_DOUBLES_SERVER,
            serverId,
            opening: true,
          };
          lastServerUidRef.current = serverId;
          openingServerRef.current = {
            gameIndex: currentGame,
            side: activeSide,
            uid: serverId,
          };
          localServeRef.current = nextServe;
          setLocalServeOverride(nextServe);
          await api.setServe(nextServe);
        }
      }
      await api.start();
      if (breakState?.active) {
        await api.setBreak({
          active: false,
          note: "",
          afterGame: currentGame,
        });
      }
    });
  }, [
    activeSide,
    api,
    breakState?.active,
    currentBase,
    currentGame,
    currentLayout,
    currentScore.a,
    currentScore.b,
    ensureInteractionAllowed,
    eventType,
    findUidAtCurrentSlot,
    isDouble,
    match,
    openingRightServerUid,
    runProtectedBusy,
    serverUidShow,
  ]);

  const handleForfeitSide = useCallback(
    (forfeitedSide) => {
      const side = forfeitedSide === "A" ? "A" : "B";
      const winner = side === "A" ? "B" : "A";
      return runProtectedBusy(`forfeit-${side.toLowerCase()}`, () =>
        api.forfeit(winner, "forfeit", { forfeitedSide: side }),
      );
    },
    [api, runProtectedBusy],
  );

  const handleUndo = useCallback(async () => {
    if (!canUndo) return;
    const now = Date.now();
    if (now < Number(undoTapGuardUntilRef.current || 0)) return;
    undoTapGuardUntilRef.current = now + UNDO_TAP_GUARD_MS;

    const undoType = textOf(lastUndoableEntry?.type).toLowerCase();
    const payload = lastUndoableEntry?.payload || {};
    if (undoType === "point") {
      const team = textOf(payload?.team).toUpperCase();
      const step = Math.max(1, Number(payload?.step || 1) || 1);
      scoreGuardRef.current = {
        a: team === "A" ? Math.max(0, Number(currentScore.a || 0) - step) : currentScore.a,
        b: team === "B" ? Math.max(0, Number(currentScore.b || 0) - step) : currentScore.b,
        until: now + SCORE_RENDER_GUARD_MS,
        mode: "replace",
      };
      if (payload?.prevServe) {
        const prevServe = normalizeServeOverride(payload.prevServe);
        localServeRef.current = prevServe;
        setLocalServeOverride(prevServe);
      }
      forceOptimisticRender((value) => value + 1);
    } else if (undoType === "serve" && payload?.prevServe) {
      const prevServe = normalizeServeOverride(payload.prevServe);
      localServeRef.current = prevServe;
      setLocalServeOverride(prevServe);
    } else if (undoType === "slots") {
      if (payload?.prevBase) {
        localBaseRef.current = payload.prevBase;
        setLocalBaseOverride(payload.prevBase);
      }
      if (payload?.prevLayout) {
        const prevLayout = normalizeLayout(payload.prevLayout);
        localLayoutRef.current = prevLayout;
        setLocalLayoutOverride(prevLayout);
      }
      if (payload?.prevServe) {
        const prevServe = normalizeServeOverride(payload.prevServe);
        localServeRef.current = prevServe;
        setLocalServeOverride(prevServe);
      }
    }

    await runLiveControlFast(() => api.undo());
  }, [
    api,
    canUndo,
    currentScore.a,
    currentScore.b,
    lastUndoableEntry,
    runLiveControlFast,
  ]);

  const handlePoint = useCallback(
    async (key, side) => {
      if (side !== activeSide) return;
      if (!canScoreByMatchState || currentGameFinished || matchDecided) return;
      if (isInteractionLocked) {
        await runLiveControlFast(async () => {});
        return;
      }

      const now = Date.now();
      const tapGuard = scoreTapGuardRef.current;
      if (tapGuard?.side === side && now < Number(tapGuard.until || 0)) return;
      scoreTapGuardRef.current = {
        side,
        until: now + SCORE_TAP_GUARD_MS,
      };

      const previousServerUid = serverUidShow || lastServerUidRef.current;
      if (previousServerUid) {
        forcedServerRef.current = {
          uid: previousServerUid,
          until: now + SERVER_UID_PIN_MS,
          gameIndex: currentGame,
          side: activeSide,
          serverNum: activeServerNum,
        };
        lastServerUidRef.current = previousServerUid;
      }

      const currentGuard = scoreGuardRef.current;
      const guardActive = now < Number(currentGuard?.until || 0);
      const guardedA =
        guardActive && typeof currentGuard?.a === "number"
          ? Math.max(currentScore.a, currentGuard.a)
          : currentScore.a;
      const guardedB =
        guardActive && typeof currentGuard?.b === "number"
          ? Math.max(currentScore.b, currentGuard.b)
          : currentScore.b;
      scoreGuardRef.current = {
        a: side === "A" ? guardedA + 1 : guardedA,
        b: side === "B" ? guardedB + 1 : guardedB,
        until: now + SCORE_RENDER_GUARD_MS,
        mode: "max",
      };
      forceOptimisticRender((value) => value + 1);

      await runLiveControlFast(() =>
        api[side === "A" ? "pointA" : "pointB"](1),
      );

      if (previousServerUid) {
        lastServerUidRef.current = previousServerUid;
      }
    },
    [
      activeServerNum,
      activeSide,
      api,
      canScoreByMatchState,
      currentGame,
      currentGameFinished,
      currentScore.a,
      currentScore.b,
      isInteractionLocked,
      matchDecided,
      runLiveControlFast,
      serverUidShow,
    ],
  );
  const handlePointLeft = useCallback(
    () => handlePoint("point-left", leftSide),
    [handlePoint, leftSide],
  );
  const handlePointRight = useCallback(
    () => handlePoint("point-right", rightSide),
    [handlePoint, rightSide],
  );

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
    const decidedWinner =
      projectedWins.a >= needed ? "A" : projectedWins.b >= needed ? "B" : "";

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
    handleStart,
    match?.status,
    matchDecided,
    needsStartAction,
    projectedWins.a,
    projectedWins.b,
    rules.bestOf,
    runProtectedBusy,
  ]);

  const midUsesServeToggle =
    !isDouble || isOpeningServeLocked || isPreStartOrOpening || activeServerNum !== 1;
  const midLabel = midUsesServeToggle ? "Đổi giao" : "Đổi tay";
  const midIcon = midUsesServeToggle ? <SwapCallsIcon /> : <SwapVertIcon />;
  const onMidPress = midUsesServeToggle ? toggleServeSide : toggleServerNum;
  const scoreControlsEnabled =
    canScoreByMatchState && !currentGameFinished && !matchDecided && !busy;
  const leftEnabled = scoreControlsEnabled && activeSide === leftSide;
  const rightEnabled = scoreControlsEnabled && activeSide === rightSide;
  return (
    <ThemeProvider theme={fastInteractionTheme}>
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
                  onClick={handleUndo}
                  disabled={!canUndo}
                  startIcon={<UndoIcon />}
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
                  disabled={
                    !match?._id ||
                    Boolean(busy) ||
                    breakLocksLiveControls ||
                    isOpeningServeLocked
                  }
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
                teamLabel={leftPanelTeamLabel}
                players={leftPanelLoading ? [] : displayedPlayers.left}
                isServing={activeSide === leftSide}
                isActiveSide={activeSide === leftSide}
                serverUid={serverUidShow}
                onSwapSlots={handleSwapLeftSlots}
                swapDisabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                loading={leftPanelLoading}
                loadingRows={leftPanelLoadingRows}
                displayMode={playerDisplayMode}
                muted={ui.muted}
                borderColor={ui.softBorder}
                accentColor={ui.accent}
                textColor={ui.text}
                surfaceBg={ui.subtleBg}
                surfaceStrongBg={ui.subtleBgStrong}
              />

              <Box
                sx={{
                  width: { xs: "100%", md: 280 },
                  flexShrink: 0,
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
                        ...stableButtonIconSx,
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
                        onClick={handleTimeoutLeft}
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
                        onClick={handleMedicalLeft}
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
                        onClick={handleTimeoutRight}
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
                        onClick={handleMedicalRight}
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

                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="center"
                      spacing={{ xs: 0.8, md: 1.1 }}
                      sx={{ width: "100%" }}
                    >
                      <Typography
                        sx={{
                          fontSize: { xs: 44, md: 56 },
                          lineHeight: 1,
                          fontWeight: 900,
                          color: ui.success,
                          ...refereeScoreDigitSx,
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
                          ...refereeScoreLabelSx,
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
                          ...refereeScoreDigitSx,
                        }}
                      >
                        {rightGameScore}
                      </Typography>
                    </Stack>

                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="center"
                      spacing={{ xs: 0.8, md: 1.1 }}
                      sx={{ width: "100%" }}
                    >
                      <Typography
                        sx={{
                          fontSize: { xs: 28, md: 34 },
                          lineHeight: 1,
                          fontWeight: 900,
                          color: ui.text,
                          ...refereeSetDigitSx,
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
                          ...refereeScoreLabelSx,
                        }}
                      >
                        Match
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: { xs: 28, md: 34 },
                          lineHeight: 1,
                          fontWeight: 900,
                          color: ui.text,
                          ...refereeSetDigitSx,
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
                teamLabel={rightPanelTeamLabel}
                players={rightPanelLoading ? [] : displayedPlayers.right}
                isServing={activeSide === rightSide}
                isActiveSide={activeSide === rightSide}
                serverUid={serverUidShow}
                onSwapSlots={handleSwapRightSlots}
                swapDisabled={!match?._id || Boolean(busy) || breakLocksLiveControls}
                loading={rightPanelLoading}
                loadingRows={rightPanelLoadingRows}
                displayMode={playerDisplayMode}
                muted={ui.muted}
                borderColor={ui.softBorder}
                accentColor={ui.accent}
                textColor={ui.text}
                surfaceBg={ui.subtleBg}
                surfaceStrongBg={ui.subtleBgStrong}
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
                    ...stableButtonIconSx,
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
              <Box
                sx={{
                  width: { xs: "100%", md: 140 },
                  minWidth: { md: 140 },
                  display: "flex",
                  justifyContent: { xs: "center", md: "flex-start" },
                }}
              >
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
                  sx={{ minWidth: 0 }}
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
                      ...stableButtonIconSx,
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
                      ...stableButtonIconSx,
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
                  sx={{ width: "100%", minWidth: 0 }}
                >
                  <Button
                    variant="outlined"
                    onClick={handlePointLeft}
                    disabled={!leftEnabled}
                    startIcon={busy === "point-left" ? <CircularProgress size={14} /> : <AddIcon />}
                    sx={{
                      minHeight: 56,
                      flex: 1,
                      borderRadius: 3,
                      borderColor:
                        activeSide === leftSide ? alpha(ui.accent, 0.45) : ui.border,
                      bgcolor:
                        activeSide === leftSide ? alpha(ui.accent, 0.18) : ui.subtleBg,
                      color: activeSide === leftSide ? ui.activeText : ui.text,
                      fontWeight: 900,
                      fontSize: { xs: 16, md: 18 },
                      ...stableButtonIconSx,
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
                      ...stableButtonIconSx,
                    }}
                  >
                    {midLabel}
                  </Button>

                  <Button
                    variant="outlined"
                    onClick={handlePointRight}
                    disabled={!rightEnabled}
                    startIcon={busy === "point-right" ? <CircularProgress size={14} /> : <AddIcon />}
                    sx={{
                      minHeight: 56,
                      flex: 1,
                      borderRadius: 3,
                      borderColor:
                        activeSide === rightSide ? alpha(ui.accent, 0.45) : ui.border,
                      bgcolor:
                        activeSide === rightSide ? alpha(ui.accent, 0.18) : ui.subtleBg,
                      color: activeSide === rightSide ? ui.activeText : ui.text,
                      fontWeight: 900,
                      fontSize: { xs: 16, md: 18 },
                      ...stableButtonIconSx,
                    }}
                  >
                    Đội bên phải
                  </Button>
                </Stack>
              )}

              {!needsStartAction && cta ? (
                <Box
                  sx={{
                    width: { xs: "100%", md: 170 },
                    minWidth: { md: 170 },
                    flexShrink: 0,
                  }}
                >
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
                <Box
                  sx={{
                    width: { xs: "100%", md: 170 },
                    minWidth: { md: 170 },
                    flexShrink: 0,
                  }}
                />
              )}
            </Stack>
          </Box>

          <Accordion
            expanded={false}
            onChange={() => setToolsOpen(true)}
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
            <AccordionDetails sx={{ display: "none" }} />
          </Accordion>
          </Stack>
        </Box>
      </DialogContent>
      </Dialog>

      <Dialog
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        fullWidth
        maxWidth="md"
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
        <DialogContent sx={{ p: 2.25 }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
              spacing={1.5}
            >
              <Box>
                <Typography sx={{ fontSize: 22, fontWeight: 900, color: ui.text }}>
                  Công cụ trọng tài
                </Typography>
                <Typography sx={{ fontSize: 13, color: ui.muted }}>
                  Gán sân, cập nhật điểm set, takeover, sync và thao tác phụ.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
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
                <IconButton
                  onClick={() => setToolsOpen(false)}
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
            </Stack>

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
                        onClick={() => {
                          const nextServe = {
                            side,
                            server: Number(server),
                            opening:
                              Number(server) === OPENING_DOUBLES_SERVER &&
                              isDouble &&
                              isPreStartOrOpening,
                          };
                          runLiveControlBusy(item, () => {
                            localServeRef.current = nextServe;
                            setLocalServeOverride(nextServe);
                            return api.setServe({
                              side,
                              server: Number(server),
                              opening:
                                Number(server) === OPENING_DOUBLES_SERVER &&
                                isDouble &&
                                isPreStartOrOpening,
                            });
                          });
                        }}
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
                      onClick={() => handleForfeitSide("A")}
                      disabled={!match?._id || Boolean(busy)}
                      sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                    >
                      A bỏ trận
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => handleForfeitSide("B")}
                      disabled={!match?._id || Boolean(busy)}
                      sx={{ minHeight: 42, borderRadius: 999, fontWeight: 800 }}
                    >
                      B bỏ trận
                    </Button>
                  </Stack>
                </Stack>
              </Stack>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={drawDialogOpen}
        onClose={() => !busy && setDrawDialogOpen(false)}
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
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
              <CasinoIcon sx={{ color: ui.accent }} />
              <Typography sx={{ fontSize: 20, fontWeight: 900 }} noWrap>
                Bốc thăm giao trước
              </Typography>
            </Stack>
            <IconButton
              onClick={() => setDrawDialogOpen(false)}
              disabled={Boolean(busy)}
              sx={{ color: ui.text }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers sx={{ borderColor: ui.border }}>
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Box
              sx={{
                width: 84,
                height: 84,
                borderRadius: 4,
                display: "grid",
                placeItems: "center",
                bgcolor: alpha(ui.accent, 0.14),
                color: ui.accent,
                border: "1px solid",
                borderColor: alpha(ui.accent, 0.35),
              }}
            >
              <CasinoIcon sx={{ fontSize: 48 }} />
            </Box>
            <Typography sx={{ color: ui.muted, fontWeight: 700 }}>
              Xem kết quả trước khi áp dụng cho trận.
            </Typography>
            <Stack spacing={1} sx={{ width: "100%" }}>
              <PaperLine
                label="Bên trái"
                value={drawPreview?.nextLayout?.left === "B" ? drawSideLabel("B") : drawSideLabel("A")}
                ui={ui}
              />
              <PaperLine
                label="Giao trước"
                value={drawPreview?.nextSide ? drawSideLabel(drawPreview.nextSide) : "—"}
                ui={ui}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            variant="outlined"
            startIcon={<CasinoIcon />}
            onClick={rerollDrawPreview}
            disabled={Boolean(busy)}
            sx={{ borderRadius: 999, fontWeight: 800 }}
          >
            Bốc lại
          </Button>
          <Button
            variant="contained"
            onClick={confirmRandomDraw}
            disabled={Boolean(busy)}
            sx={{ borderRadius: 999, fontWeight: 900 }}
          >
            Áp dụng
          </Button>
        </DialogActions>
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

              <FormControl size="small" fullWidth disabled={courtsLoading || !selectedClusterId || Boolean(courtRuntimeError)}>
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
                  <MenuItem value="" disabled>
                    {courtsLoading
                      ? "Đang tải sân..."
                      : selectedClusterId
                        ? "Chọn sân rảnh"
                        : "Chưa có cụm sân"}
                  </MenuItem>
                  {courts.map((court) => (
                    <MenuItem
                      key={idOf(court?._id || court?.id)}
                      value={idOf(court?._id || court?.id)}
                    >
                      {courtStationLabel(court)}
                    </MenuItem>
                  ))}
                  {!courtsLoading && selectedClusterId && courts.length === 0 ? (
                    <MenuItem value="" disabled>
                      Không có sân rảnh
                    </MenuItem>
                  ) : null}
                </Select>
              </FormControl>

              {courtRuntimeError ? (
                <Alert severity="warning">
                  Không tải được danh sách sân rảnh. Bấm tải sân để thử lại.
                </Alert>
              ) : null}
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button
                variant="contained"
                onClick={handleAssignCourt}
                disabled={
                  !selectedCourtId ||
                  !normalizedTournamentId ||
                  !normalizedMatchId ||
                  Boolean(busy) ||
                  assigningCourtStation
                }
                sx={{ minHeight: 44, borderRadius: 999, fontWeight: 800, flex: 1 }}
              >
                Gán sân
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={handleUnassignCourt}
                disabled={!currentCourtId || Boolean(busy) || freeingCourtStation}
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
    </ThemeProvider>
  );
}
