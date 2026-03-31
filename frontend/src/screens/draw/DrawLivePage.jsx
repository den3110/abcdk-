/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  alpha,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import PublicIcon from "@mui/icons-material/Public";
import HistoryIcon from "@mui/icons-material/History";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CampaignIcon from "@mui/icons-material/Campaign";
import { useParams, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import {
  useStopTournamentDrawMutation,
  useTakeoverTournamentDrawMutation,
} from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";
import SEOHead from "../../components/SEOHead";

const VIEW_MODES = ["stage", "board", "history"];

const normalizeViewMode = (value) =>
  VIEW_MODES.includes(String(value || "").trim()) ? String(value).trim() : "stage";

const toText = (value) => String(value ?? "").trim();

const formatDateTime = (value) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const summarizeReveal = (reveal) => {
  if (!reveal) return "Chờ lượt bốc thăm kế tiếp.";
  const source = reveal?.payload || reveal?.reveal || reveal;
  const groupCode = toText(source?.groupCode || source?.groupKey);
  const slotIndex = Number(source?.slotIndex);
  const side = toText(source?.side).toUpperCase();
  const pairIndex = Number(source?.pairIndex);
  const name = toText(
    source?.name ||
      source?.teamName ||
      source?.displayName ||
      source?.label ||
      source?.regLabel,
  );

  if (groupCode) {
    return `${name || "Một đội vừa được bốc"} vào bảng ${groupCode}${
      Number.isFinite(slotIndex) ? ` - vị trí ${slotIndex + 1}` : ""
    }`;
  }
  if (Number.isFinite(pairIndex)) {
    return `${name || "Một đội vừa được bốc"} vào cặp ${pairIndex + 1}${
      side ? ` - nhánh ${side}` : ""
    }`;
  }
  return name || "Đã có lượt bốc thăm mới.";
};

const getBoardView = (snapshot) => snapshot?.activeSession?.boardView || null;

const getBoardGroups = (snapshot) =>
  Array.isArray(getBoardView(snapshot)?.groups) ? getBoardView(snapshot).groups : [];

const getBoardPairs = (snapshot) =>
  Array.isArray(getBoardView(snapshot)?.pairs) ? getBoardView(snapshot).pairs : [];

const normalizeGroupCode = (value, index = 0) => {
  const raw = String(value || "").trim();
  return raw || String.fromCharCode(65 + index);
};

const getSessionReveals = (snapshot) =>
  Array.isArray(snapshot?.activeSession?.reveals) ? snapshot.activeSession.reveals : [];

const buildFallbackGroupsFromSnapshot = (snapshot) => {
  const activeSession = snapshot?.activeSession;
  const groupsMeta = Array.isArray(activeSession?.groupsMeta) ? activeSession.groupsMeta : [];
  const reveals = getSessionReveals(snapshot);

  if (!groupsMeta.length) return [];

  const groups = groupsMeta.map((group, groupIndex) => {
    const regIds = Array.isArray(group?.regIds) ? group.regIds : [];
    const rawSize = Number(group?.size || 0);
    const size = rawSize > 0 ? rawSize : regIds.length;
    return {
      code: normalizeGroupCode(group?.code, groupIndex),
      slots: Array.from({ length: size || 0 }, (_unused, slotIndex) => ({
        slotIndex,
        regId: null,
        label: "",
      })),
    };
  });

  const groupMap = new Map(
    groups.map((group) => [String(group.code).trim().toUpperCase(), group]),
  );

  reveals.forEach((reveal) => {
    const groupCode = String(
      reveal?.groupCode || reveal?.groupKey || reveal?.group || "",
    )
      .trim()
      .toUpperCase();
    if (!groupCode) return;
    const group = groupMap.get(groupCode);
    if (!group) return;

    const label = toText(
      reveal?.label || reveal?.teamName || reveal?.name || reveal?.displayName,
    );
    const regId = toText(reveal?.regId || reveal?.registrationId) || null;
    const explicitIndex = Number(reveal?.slotIndex);
    const targetSlot =
      Number.isFinite(explicitIndex) && group.slots[explicitIndex]
        ? group.slots[explicitIndex]
        : group.slots.find((slot) => !toText(slot.label));

    if (!targetSlot) return;
    targetSlot.regId = regId || targetSlot.regId || null;
    targetSlot.label = label || targetSlot.label || "";
  });

  return groups;
};

const buildFallbackPairsFromSnapshot = (snapshot) => {
  const reveals = getSessionReveals(snapshot).filter((reveal) =>
    Number.isFinite(Number(reveal?.pairIndex)),
  );
  if (!reveals.length) return [];

  const pairMap = new Map();
  reveals.forEach((reveal) => {
    const pairIndex = Number(reveal.pairIndex);
    if (!pairMap.has(pairIndex)) {
      pairMap.set(pairIndex, {
        pairIndex,
        title: `Cặp ${pairIndex + 1}`,
        a: { regId: null, label: "" },
        b: { regId: null, label: "" },
      });
    }
    const pair = pairMap.get(pairIndex);
    const side = String(reveal?.side || "").trim().toUpperCase();
    const target = side === "B" ? pair.b : pair.a;
    const label = toText(
      reveal?.label || reveal?.teamName || reveal?.name || reveal?.displayName,
    );
    const regId = toText(reveal?.regId || reveal?.registrationId) || null;
    target.regId = regId || target.regId || null;
    target.label = label || target.label || "";
  });

  return [...pairMap.values()].sort((a, b) => a.pairIndex - b.pairIndex);
};

const getRenderableGroups = (snapshot) => {
  const boardGroups = getBoardGroups(snapshot);
  const hasNamedBoardSlots = boardGroups.some((group) =>
    (group?.slots || []).some((slot) => Boolean(toText(slot?.label))),
  );
  return hasNamedBoardSlots ? boardGroups : buildFallbackGroupsFromSnapshot(snapshot);
};

const getRenderablePairs = (snapshot) => {
  const boardPairs = getBoardPairs(snapshot);
  const hasNamedPairs = boardPairs.some((pair) =>
    Boolean(toText(pair?.a?.label || pair?.b?.label)),
  );
  return hasNamedPairs ? boardPairs : buildFallbackPairsFromSnapshot(snapshot);
};

const patchBoardViewWithReveal = (snapshot, payload) => {
  if (!snapshot?.activeSession) return snapshot;
  const source = payload?.reveal || payload || {};
  const name = toText(
    source?.name ||
      source?.teamName ||
      source?.displayName ||
      source?.label ||
      source?.regLabel,
  );
  const regId = toText(source?.regId || source?.registrationId) || null;
  if (!name && !regId) return snapshot;

  const nextReveal = payload?.reveal || payload || null;
  const revealKey = [
    toText(source?.groupCode || source?.groupKey || source?.group),
    Number.isFinite(Number(source?.slotIndex)) ? Number(source.slotIndex) : "",
    Number.isFinite(Number(source?.pairIndex)) ? Number(source.pairIndex) : "",
    toText(source?.side).toUpperCase(),
    regId || name,
  ].join(":");

  const currentReveals = getSessionReveals(snapshot);
  const nextReveals = [...currentReveals];
  const existingIndex = nextReveals.findIndex((item) => {
    const itemKey = [
      toText(item?.groupCode || item?.groupKey || item?.group),
      Number.isFinite(Number(item?.slotIndex)) ? Number(item.slotIndex) : "",
      Number.isFinite(Number(item?.pairIndex)) ? Number(item.pairIndex) : "",
      toText(item?.side).toUpperCase(),
      toText(item?.regId || item?.registrationId) || toText(item?.label || item?.teamName),
    ].join(":");
    return itemKey === revealKey;
  });

  if (existingIndex >= 0) {
    nextReveals[existingIndex] = {
      ...nextReveals[existingIndex],
      ...nextReveal,
    };
  } else if (nextReveal) {
    nextReveals.push(nextReveal);
  }

  if (!snapshot.activeSession.boardView) {
    return {
      ...snapshot,
      activeSession: {
        ...snapshot.activeSession,
        reveals: nextReveals,
        latestReveal: nextReveal,
      },
    };
  }

  const nextBoardView = {
    groups: getBoardGroups(snapshot).map((group) => ({
      ...group,
      slots: Array.isArray(group?.slots)
        ? group.slots.map((slot) => ({ ...slot }))
        : [],
    })),
    pairs: getBoardPairs(snapshot).map((pair) => ({
      ...pair,
      a: pair?.a ? { ...pair.a } : { regId: null, label: "" },
      b: pair?.b ? { ...pair.b } : { regId: null, label: "" },
    })),
  };

  const groupCode = toText(source?.groupCode || source?.groupKey);
  const slotIndex = Number(source?.slotIndex);
  if (groupCode && Number.isFinite(slotIndex)) {
    const group = nextBoardView.groups.find(
      (item) => String(item?.code || "").trim() === groupCode,
    );
    const slot = group?.slots?.find((item) => Number(item?.slotIndex) === slotIndex);
    if (slot) {
      slot.regId = regId || slot.regId || null;
      slot.label = name || slot.label || "";
    }
  }

  const pairIndex = Number(source?.pairIndex);
  const side = toText(source?.side).toUpperCase();
  if (Number.isFinite(pairIndex) && (side === "A" || side === "B")) {
    const pair = nextBoardView.pairs.find(
      (item) => Number(item?.pairIndex) === pairIndex,
    );
    if (pair) {
      const target = side === "A" ? pair.a : pair.b;
      target.regId = regId || target.regId || null;
      target.label = name || target.label || "";
    }
  }

  return {
    ...snapshot,
    activeSession: {
      ...snapshot.activeSession,
      boardView: nextBoardView,
      reveals: nextReveals,
      latestReveal: nextReveal,
    },
  };
};

function StageView({ snapshot, tournamentName }) {
  const activeSession = snapshot?.activeSession || null;
  const latestReveal = activeSession?.latestReveal || null;
  const latestText = summarizeReveal(latestReveal);
  const bracketName = activeSession?.bracketName || "Phiên bốc thăm";

  return (
    <Stack spacing={3}>
      <Paper
        sx={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 5,
          p: { xs: 3, md: 5 },
          minHeight: 320,
          color: "white",
          background:
            "radial-gradient(circle at top, rgba(59,130,246,0.24), transparent 32%), linear-gradient(140deg, #081225 0%, #101935 45%, #1d4ed8 100%)",
          boxShadow: "0 28px 80px rgba(8,18,37,0.32)",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 48%, transparent 100%)",
            transform: "skewY(-7deg) scale(1.3)",
          }}
        />
        <Stack spacing={2.5} sx={{ position: "relative", zIndex: 1 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.25}
            alignItems={{ md: "center" }}
          >
            <Chip
              icon={<PublicIcon />}
              label="Sân khấu bốc thăm trực tiếp"
              sx={{
                bgcolor: alpha("#ffffff", 0.14),
                color: "white",
                fontWeight: 700,
              }}
            />
            {latestReveal ? (
              <Chip
                icon={<AutoAwesomeIcon />}
                label="Đang có lượt bốc mới"
                sx={{
                  bgcolor: alpha("#f59e0b", 0.24),
                  color: "#fff5d6",
                  fontWeight: 700,
                }}
              />
            ) : null}
          </Stack>

          <Typography
            variant="h2"
            fontWeight={900}
            sx={{
              letterSpacing: "-0.05em",
              maxWidth: 940,
              lineHeight: 1,
            }}
          >
            {bracketName}
          </Typography>

          <Typography
            variant="h5"
            sx={{
              maxWidth: 900,
              color: "rgba(255,255,255,0.9)",
              fontWeight: 600,
            }}
          >
            {latestText}
          </Typography>

          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
            <Chip
              label={tournamentName || "PickleTour"}
              sx={{
                bgcolor: alpha("#ffffff", 0.1),
                color: "white",
                fontWeight: 600,
              }}
            />
            {latestReveal?.at ? (
              <Chip
                icon={<CampaignIcon />}
                label={`Cập nhật lúc ${formatDateTime(latestReveal.at)}`}
                sx={{
                  bgcolor: alpha("#ffffff", 0.1),
                  color: "white",
                  fontWeight: 600,
                }}
              />
            ) : null}
          </Stack>
        </Stack>
      </Paper>

      {!activeSession ? (
        <Alert severity="info" sx={{ borderRadius: 3 }}>
          Chưa có buổi bốc thăm đang diễn ra. Trang này sẽ tự cập nhật ngay khi controller bắt đầu.
        </Alert>
      ) : null}
    </Stack>
  );
}

function GroupCard({ title, slots }) {
  return (
    <Paper
      sx={{
        p: 2.4,
        borderRadius: 5,
        minWidth: 260,
        flex: "1 1 260px",
        color: "white",
        bgcolor: "#0b1328",
        border: "1px solid rgba(96,165,250,0.18)",
        boxShadow: "0 24px 60px rgba(8,18,37,0.3)",
      }}
    >
      <Stack spacing={1.35}>
        <Typography variant="h5" fontWeight={900} sx={{ letterSpacing: "-0.03em" }}>
          {title}
        </Typography>
        {slots.map((slot) => {
          const hasLabel = Boolean(toText(slot?.label));
          return (
            <Box
              key={`${title}-${slot.slotIndex}`}
              sx={{
                px: 1.8,
                py: 1.5,
                borderRadius: 3,
                border: `1px solid ${
                  hasLabel ? "rgba(52,211,153,0.28)" : "rgba(148,163,184,0.14)"
                }`,
                bgcolor: hasLabel ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.04)",
                boxShadow: hasLabel ? "0 0 0 1px rgba(52,211,153,0.08), 0 18px 40px rgba(16,185,129,0.08)" : "none",
              }}
            >
              <Typography variant="body2" sx={{ color: "rgba(226,232,240,0.7)" }}>
                Vị trí {Number(slot?.slotIndex || 0) + 1}
              </Typography>
              <Typography variant="h6" fontWeight={800} sx={{ color: hasLabel ? "#ecfdf5" : "rgba(255,255,255,0.82)" }}>
                {hasLabel ? slot.label : "Chưa bốc"}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

function PairCard({ pair }) {
  const sides = [
    { key: "A", title: "Nhánh A", value: pair?.a?.label || "" },
    { key: "B", title: "Nhánh B", value: pair?.b?.label || "" },
  ];
  return (
    <Paper
      sx={{
        p: 2.4,
        borderRadius: 5,
        minWidth: 280,
        flex: "1 1 280px",
        color: "white",
        bgcolor: "#0b1328",
        border: "1px solid rgba(96,165,250,0.18)",
        boxShadow: "0 24px 60px rgba(8,18,37,0.3)",
      }}
    >
      <Stack spacing={1.35}>
        <Typography variant="h5" fontWeight={900} sx={{ letterSpacing: "-0.03em" }}>
          {pair?.title || "Cặp"}
        </Typography>
        {sides.map((side) => (
          <Box
            key={`${pair?.pairIndex}-${side.key}`}
            sx={{
              px: 1.8,
              py: 1.5,
              borderRadius: 3,
              border: `1px solid ${
                side.value ? "rgba(96,165,250,0.24)" : "rgba(148,163,184,0.14)"
              }`,
              bgcolor: side.value ? "rgba(37,99,235,0.15)" : "rgba(255,255,255,0.04)",
              boxShadow: side.value ? "0 18px 40px rgba(37,99,235,0.12)" : "none",
            }}
          >
            <Typography variant="body2" sx={{ color: "rgba(226,232,240,0.7)" }}>
              {side.title}
            </Typography>
            <Typography variant="h6" fontWeight={800} sx={{ color: side.value ? "#dbeafe" : "rgba(255,255,255,0.82)" }}>
              {side.value || "Chưa bốc"}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

function BoardView({ snapshot }) {
  const activeSession = snapshot?.activeSession || null;
  const groups = useMemo(() => getRenderableGroups(snapshot), [snapshot]);
  const pairs = useMemo(() => getRenderablePairs(snapshot), [snapshot]);

  if (!activeSession) {
    return (
      <Alert severity="info" sx={{ borderRadius: 3 }}>
        Chưa có dữ liệu bảng bốc thăm để hiển thị.
      </Alert>
    );
  }

  const hasGroups = groups.length > 0;
  const hasPairs = pairs.length > 0;

  if (!hasGroups && !hasPairs) {
    return (
      <Alert severity="info" sx={{ borderRadius: 3 }}>
        Session đang hoạt động nhưng chưa có cấu trúc bảng để hiển thị.
      </Alert>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Stack spacing={0.5}>
        <Typography variant="h4" fontWeight={900} sx={{ letterSpacing: "-0.04em" }}>
          Bảng bốc thăm trực tiếp
        </Typography>
        <Typography color="text.secondary">
          Giao diện khán giả chỉ hiển thị kết quả bốc và diễn biến quan trọng của phiên hiện tại.
        </Typography>
      </Stack>
      {hasGroups ? (
        <Stack direction="row" flexWrap="wrap" gap={2}>
          {groups.map((group) => (
            <GroupCard
              key={group.code}
              title={`Bảng ${group.code}`}
              slots={Array.isArray(group?.slots) ? group.slots : []}
            />
          ))}
        </Stack>
      ) : null}

      {hasPairs ? (
        <Stack direction="row" flexWrap="wrap" gap={2}>
          {pairs.map((pair) => (
            <PairCard key={`pair-${pair.pairIndex}`} pair={pair} />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function HistoryView({ snapshot }) {
  const history = Array.isArray(snapshot?.activeSession?.history)
    ? [...snapshot.activeSession.history].reverse()
    : [];

  if (history.length === 0) {
    return (
      <Alert severity="info" sx={{ borderRadius: 3 }}>
        Chưa có lịch sử bốc thăm nào để hiển thị.
      </Alert>
    );
  }

  return (
    <Stack spacing={1.5}>
      {history.map((entry, index) => {
        const key = `${entry?.at || "no-time"}-${index}`;
        const payload = entry?.payload || {};
        return (
          <Paper
            key={key}
            sx={{
              p: 2,
              borderRadius: 3,
              border: "1px solid rgba(148,163,184,0.14)",
            }}
          >
            <Stack spacing={0.75}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" icon={<HistoryIcon />} label={entry?.action || "update"} />
                {entry?.at ? (
                  <Typography variant="body2" color="text.secondary">
                    {formatDateTime(entry.at)}
                  </Typography>
                ) : null}
              </Stack>
              <Typography fontWeight={800}>{summarizeReveal(payload)}</Typography>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}

export default function DrawLivePage() {
  const { id: tournamentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const socket = useSocket();
  const { userInfo } = useSelector((state) => state.auth || {});
  const { data: tournament } = useGetTournamentQuery(tournamentId, {
    skip: !tournamentId,
  });
  const [takeoverTournamentDraw, { isLoading: takingOver }] =
    useTakeoverTournamentDrawMutation();
  const [stopTournamentDraw, { isLoading: stopping }] =
    useStopTournamentDrawMutation();

  const [snapshot, setSnapshot] = useState(null);
  const requestedViewMode = useMemo(
    () => normalizeViewMode(searchParams.get("view")),
    [searchParams],
  );
  const [viewMode, setViewMode] = useState(requestedViewMode);
  const applyViewMode = useCallback(
    (nextValue, replace = true) => {
      const nextMode = normalizeViewMode(nextValue);
      setViewMode(nextMode);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextMode === "stage") {
            next.delete("view");
          } else {
            next.set("view", nextMode);
          }
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const isSuperAdmin = Boolean(userInfo?.isSuperUser || userInfo?.isSuperAdmin);
  const canTakeover = Boolean(isSuperAdmin && snapshot?.viewer?.canTakeover);
  const canStop = Boolean(isSuperAdmin && snapshot?.viewer?.canStop);
  const revealCount = Array.isArray(snapshot?.activeSession?.reveals)
    ? snapshot.activeSession.reveals.length
    : 0;
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "tournament_draw_live",
      entityTitle: tournament?.name
        ? `Bốc thăm trực tiếp - ${tournament.name}`
        : "Bốc thăm trực tiếp",
      sectionTitle:
        viewMode === "board"
          ? "Bảng bốc thăm"
          : viewMode === "history"
            ? "Lịch sử bốc thăm"
            : "Sân khấu bốc thăm",
      pageSummary: summarizeReveal(snapshot?.activeSession?.latestReveal),
      activeLabels: [viewMode, snapshot?.activeSession?.bracketName],
      visibleActions: [
        canTakeover ? "Take over & kick" : "",
        canStop ? "Ngừng bốc thăm" : "",
      ],
      highlights: [
        snapshot?.activeSession?.status,
        snapshot?.activeSession?.latestReveal?.name,
        snapshot?.activeSession?.latestReveal?.groupCode,
      ],
      metrics: [
        `Reveal: ${revealCount}`,
        `View: ${viewMode}`,
        snapshot?.activeSession?.bracketName || "",
      ],
    }),
    [
      tournament?.name,
      viewMode,
      snapshot?.activeSession?.latestReveal,
      snapshot?.activeSession?.bracketName,
      snapshot?.activeSession?.status,
      canTakeover,
      canStop,
      revealCount,
    ],
  );

  const chatBotActionHandlers = useMemo(
    () => ({
      viewMode: (nextValue) => {
        applyViewMode(nextValue);
      },
    }),
    [applyViewMode],
  );

  useRegisterChatBotPageContext({
    snapshot: chatBotSnapshot,
    capabilityKeys: ["navigate", "set_query_param", "set_page_state", "copy_link"],
    actionHandlers: chatBotActionHandlers,
  });

  useEffect(() => {
    setViewMode((current) => (current === requestedViewMode ? current : requestedViewMode));
  }, [requestedViewMode]);

  useEffect(() => {
    if (!socket || !tournamentId) return undefined;

    const joinRoom = () => {
      socket.emit("draw-live:join", { tournamentId }, (ack) => {
        if (ack?.tournamentId) setSnapshot(ack);
      });
    };

    const handleSnapshot = (nextSnapshot) => {
      if (String(nextSnapshot?.tournamentId || "") !== String(tournamentId)) return;
      setSnapshot(nextSnapshot);
    };

    const handleReveal = (payload) => {
      if (String(payload?.tournamentId || "") !== String(tournamentId)) return;
      setSnapshot((current) => patchBoardViewWithReveal(current, payload));
    };

    joinRoom();
    socket.on("connect", joinRoom);
    socket.on("draw-live:snapshot", handleSnapshot);
    socket.on("draw-live:reveal", handleReveal);

    return () => {
      socket.off("connect", joinRoom);
      socket.off("draw-live:snapshot", handleSnapshot);
      socket.off("draw-live:reveal", handleReveal);
      socket.emit("draw-live:leave", { tournamentId });
    };
  }, [socket, tournamentId]);

  const handleTakeover = async () => {
    try {
      const response = await takeoverTournamentDraw({
        tournamentId,
        socketId: socket?.id || "",
      }).unwrap();
      if (response?.snapshot) setSnapshot(response.snapshot);
      toast.success("Đã takeover quyền điều khiển bốc thăm.");
    } catch (error) {
      toast.error(error?.data?.message || error?.error || "Không takeover được.");
    }
  };

  const handleStop = async () => {
    try {
      const response = await stopTournamentDraw({ tournamentId }).unwrap();
      if (response?.snapshot) setSnapshot(response.snapshot);
      toast.success("Đã ngừng phiên bốc thăm.");
    } catch (error) {
      toast.error(error?.data?.message || error?.error || "Không dừng được phiên bốc thăm.");
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 5 } }}>
      <SEOHead
        title={`Bốc thăm trực tiếp${tournament?.name ? ` - ${tournament.name}` : ""}`}
        description="Theo dõi bốc thăm realtime trực tiếp trên PickleTour."
        path={`/tournament/${tournamentId}/draw/live`}
      />

      <Stack spacing={3}>
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: "2.6rem", md: "4.25rem" },
            lineHeight: 0.98,
            letterSpacing: "-0.06em",
            fontWeight: 900,
          }}
        >
          {`Bốc thăm trực tiếp${tournament?.name ? ` - ${tournament.name}` : ""}`}
        </Typography>

        {isSuperAdmin && (canTakeover || canStop) ? (
          <Paper
            sx={{
              p: 2.25,
              borderRadius: 4,
              bgcolor: alpha("#0f172a", 0.025),
              border: "1px solid rgba(148,163,184,0.14)",
            }}
          >
            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1.25}
              alignItems={{ lg: "center" }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <AdminPanelSettingsIcon color="primary" />
                <Typography fontWeight={800}>Điều khiển nâng cao</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                Chỉ dùng khi cần giành lại quyền điều khiển hoặc dừng toàn bộ phiên bốc thăm hiện tại.
              </Typography>
              {canTakeover ? (
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<SwapHorizIcon />}
                  disabled={takingOver}
                  onClick={handleTakeover}
                  sx={{ color: "white !important" }}
                >
                  Take over & kick
                </Button>
              ) : null}
              {canStop ? (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<StopCircleIcon />}
                  disabled={stopping}
                  onClick={handleStop}
                >
                  Ngừng bốc thăm
                </Button>
              ) : null}
            </Stack>
          </Paper>
        ) : null}

        <Paper
          sx={{
            borderRadius: 5,
            overflow: "hidden",
            boxShadow: "0 18px 44px rgba(15,23,42,0.08)",
          }}
        >
          <Box sx={{ px: 2.5, pt: 2 }}>
            <Tabs
              value={viewMode}
              onChange={(_event, nextValue) => {
                if (!VIEW_MODES.includes(nextValue)) return;
                applyViewMode(nextValue);
              }}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab value="stage" label="Sân khấu" />
              <Tab value="board" label="Bảng" />
              <Tab value="history" label="Lịch sử" />
            </Tabs>
          </Box>
          <Divider />
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            {viewMode === "stage" ? (
              <StageView snapshot={snapshot} tournamentName={tournament?.name} />
            ) : null}
            {viewMode === "board" ? <BoardView snapshot={snapshot} /> : null}
            {viewMode === "history" ? <HistoryView snapshot={snapshot} /> : null}
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
}
