import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
  Videocam as VideocamIcon,
} from "@mui/icons-material";
import { skipToken } from "@reduxjs/toolkit/query";
import { useSelector } from "react-redux";
import {
  Link as RouterLink,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useSocket } from "../../context/SocketContext";
import { useSocketRoomSet } from "../../hook/useSocketRoomSet";
import {
  useGetTournamentQuery,
  useListRefereeMatchesByTournamentQuery,
  useListTournamentBracketsQuery,
  useVerifyRefereeQuery,
} from "../../slices/tournamentsApiSlice";
import RefereeScoreDialog from "../../components/referee/RefereeScoreDialog";
import {
  getMatchCourtStationName,
  getMatchDisplayCode,
  getPairDisplayName,
  getPlayerDisplayName,
  normalizeMatchDisplay,
} from "../../utils/matchDisplay";

const TAB_ALL = "__all_matches__";
const TAB_STATION_PREFIX = "__station__:";

const textOf = (value) => (value && String(value).trim()) || "";
const normalizeId = (value) => textOf(value?._id || value?.id || value);

const hasPlayerIdentity = (player) =>
  Boolean(
    normalizeId(player?._id || player?.id || player?.uid || player?.user?._id || player?.user) ||
      textOf(
        player?.displayName ||
          player?.nickname ||
          player?.nickName ||
          player?.nick ||
          player?.fullName ||
          player?.name ||
          player?.shortName,
      ),
  );

const playerName = (player, source) => getPlayerDisplayName(player, source) || "";
const pairLabel = (pair, source) => getPairDisplayName(pair, source) || "TBD";

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
  "";

const sidePairOf = (match, side) => {
  if (side === "A") {
    return match?.pairA || match?.teams?.A || match?.teamA || match?.sideA || null;
  }
  return match?.pairB || match?.teams?.B || match?.teamB || match?.sideB || null;
};

const pairHasCompetitor = (pair) => {
  if (!pair || typeof pair !== "object") return false;

  const players = [
    pair?.player1,
    pair?.player2,
    ...(Array.isArray(pair?.players) ? pair.players : []),
  ].filter(Boolean);

  if (players.some(hasPlayerIdentity)) return true;

  return Boolean(
    normalizeId(pair?._id || pair?.id) ||
      textOf(pair?.displayName || pair?.teamName || pair?.name || pair?.label || pair?.title),
  );
};

const isRenderableRefereeMatch = (match) => {
  const matchId = normalizeId(match?._id || match?.matchId);
  if (!matchId) return false;

  const sideA = sidePairOf(match, "A");
  const sideB = sidePairOf(match, "B");
  return pairHasCompetitor(sideA) || pairHasCompetitor(sideB);
};

const getStatusMeta = (status) => {
  const key = textOf(status).toLowerCase();
  if (key === "live") return { color: "warning", label: "Đang thi đấu" };
  if (key === "assigned") return { color: "secondary", label: "Đã gán sân" };
  if (key === "queued") return { color: "info", label: "Trong hàng chờ" };
  if (key === "finished") return { color: "success", label: "Đã kết thúc" };
  return { color: "default", label: "Chưa xếp" };
};

const statusChipSx = (status) => {
  const key = textOf(status).toLowerCase();
  if (key === "live") {
    return {
      bgcolor: "rgba(245, 124, 0, 0.16)",
      color: "#ffb74d",
      borderColor: "rgba(245, 124, 0, 0.38)",
    };
  }
  if (key === "assigned") {
    return {
      bgcolor: "rgba(124, 77, 255, 0.14)",
      color: "#c4b5fd",
      borderColor: "rgba(124, 77, 255, 0.32)",
    };
  }
  if (key === "queued") {
    return {
      bgcolor: "rgba(2, 132, 199, 0.14)",
      color: "#7dd3fc",
      borderColor: "rgba(2, 132, 199, 0.32)",
    };
  }
  if (key === "finished") {
    return {
      bgcolor: "rgba(34, 197, 94, 0.14)",
      color: "#86efac",
      borderColor: "rgba(34, 197, 94, 0.32)",
    };
  }
  return {
    bgcolor: "rgba(148, 163, 184, 0.12)",
    color: "#cbd5e1",
    borderColor: "rgba(148, 163, 184, 0.24)",
  };
};

const extractSets = (match) => {
  const scores = Array.isArray(match?.gameScores)
    ? match.gameScores
    : Array.isArray(match?.scores)
      ? match.scores
      : [];
  return scores
    .map((item) =>
      typeof item === "object" && item
        ? `${Number(item?.a || 0)}-${Number(item?.b || 0)}`
        : null,
    )
    .filter(Boolean);
};

const normalizeRefereeIds = (match) =>
  Array.from(
    new Set(
      [
        ...(Array.isArray(match?.referee) ? match.referee : [match?.referee]),
        ...(Array.isArray(match?.referees) ? match.referees : []),
        ...(Array.isArray(match?.courtStationReferees)
          ? match.courtStationReferees
          : []),
      ]
        .map(normalizeId)
        .filter(Boolean),
    ),
  );

const isUserRefereeOfMatch = (match, user) => {
  const userId = normalizeId(user?._id || user?.id);
  if (!userId) return false;
  return normalizeRefereeIds(match).includes(userId);
};

export default function TournamentRefereePage() {
  const { id } = useParams();
  const socket = useSocket();
  const theme = useTheme();
  const { userInfo } = useSelector((state) => state.auth || {});
  const roleStr = textOf(userInfo?.role).toLowerCase();
  const roles = new Set(
    [...(userInfo?.roles || []), ...(userInfo?.permissions || [])]
      .filter(Boolean)
      .map((value) => textOf(value).toLowerCase()),
  );
  const isAdmin = Boolean(
    userInfo?.isAdmin ||
      roleStr === "admin" ||
      roles.has("admin") ||
      roles.has("superadmin"),
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(TAB_ALL);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("time");
  const [sortDir, setSortDir] = useState("asc");
  const refetchTimerRef = useRef(null);

  const ui = useMemo(
    () => ({
      pageBg:
        theme.palette.mode === "dark"
          ? "linear-gradient(180deg, #101113 0%, #090a0c 100%)"
          : "linear-gradient(180deg, #f7f9fc 0%, #eef2f8 100%)",
      panelBg:
        theme.palette.mode === "dark"
          ? "rgba(24, 25, 28, 0.92)"
          : "rgba(255, 255, 255, 0.96)",
      cardBg: theme.palette.mode === "dark" ? "#15171a" : "#ffffff",
      softBg: theme.palette.mode === "dark" ? "#111318" : "#f8fafc",
      border:
        theme.palette.mode === "dark"
          ? "rgba(255,255,255,0.09)"
          : "rgba(15,23,42,0.08)",
      textMuted:
        theme.palette.mode === "dark"
          ? "rgba(226,232,240,0.72)"
          : "rgba(51,65,85,0.72)",
      accent: theme.palette.mode === "dark" ? "#60a5fa" : "#2563eb",
      accentSoft:
        theme.palette.mode === "dark"
          ? "rgba(96,165,250,0.16)"
          : "rgba(37,99,235,0.10)",
    }),
    [theme],
  );

  const { data: tournament } = useGetTournamentQuery(id || skipToken);
  const { data: verifyRes, isLoading: verifying } = useVerifyRefereeQuery(
    id || skipToken,
  );
  const { data: brackets = [] } = useListTournamentBracketsQuery(id || skipToken);
  const {
    data: matchesResp,
    isLoading,
    error,
    refetch,
  } = useListRefereeMatchesByTournamentQuery(
    id ? { tid: id, page: 1, pageSize: 1000 } : skipToken,
    { refetchOnFocus: true, refetchOnReconnect: true },
  );

  const allMatches = useMemo(() => {
    const items = (Array.isArray(matchesResp?.items) ? matchesResp.items : [])
      .map((match) => normalizeMatchDisplay(match, tournament || match))
      .filter(isRenderableRefereeMatch);
    if (isAdmin) return items;
    return items.filter((match) => isUserRefereeOfMatch(match, userInfo));
  }, [isAdmin, matchesResp?.items, tournament, userInfo]);

  const stationTabs = useMemo(
    () => (Array.isArray(matchesResp?.stationTabs) ? matchesResp.stationTabs : []),
    [matchesResp?.stationTabs],
  );

  const selectedMatchId = textOf(searchParams.get("matchId"));
  const selectedMatch = useMemo(
    () => allMatches.find((match) => normalizeId(match?._id) === selectedMatchId) || null,
    [allMatches, selectedMatchId],
  );

  const displayTabs = useMemo(() => {
    const bracketTabs = brackets.map((bracket) => ({
      type: normalizeId(bracket?._id),
      label: textOf(bracket?.name) || "Bracket",
    }));
    return [
      ...stationTabs.map((station) => ({
        type: `${TAB_STATION_PREFIX}${station.stationId}`,
        label: textOf(station?.label) || "Sân",
      })),
      { type: TAB_ALL, label: "Tất cả trận" },
      ...bracketTabs,
    ];
  }, [brackets, stationTabs]);

  useEffect(() => {
    if (!displayTabs.some((item) => item.type === tab)) {
      setTab(TAB_ALL);
    }
  }, [displayTabs, tab]);

  const watchedStationIds = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...stationTabs.map((station) => textOf(station?.stationId)),
            ...allMatches.map((match) => textOf(match?.courtStationId)),
          ].filter(Boolean),
        ),
      ),
    [allMatches, stationTabs],
  );

  useSocketRoomSet(socket, id ? [String(id)] : [], {
    subscribeEvent: "tournament:subscribe",
    unsubscribeEvent: "tournament:unsubscribe",
    payloadKey: "tournamentId",
  });
  useSocketRoomSet(socket, watchedStationIds, {
    subscribeEvent: "court-station:watch",
    unsubscribeEvent: "court-station:unwatch",
    payloadKey: "stationId",
  });

  const queueRefetch = useCallback(() => {
    if (refetchTimerRef.current) return;
    refetchTimerRef.current = window.setTimeout(() => {
      refetch?.();
      refetchTimerRef.current = null;
    }, 500);
  }, [refetch]);

  useEffect(() => {
    if (!socket) return undefined;
    const onUpdate = () => queueRefetch();
    socket.on("tournament:match:update", onUpdate);
    socket.on("match:deleted", onUpdate);
    socket.on("court-station:update", onUpdate);
    return () => {
      socket.off("tournament:match:update", onUpdate);
      socket.off("match:deleted", onUpdate);
      socket.off("court-station:update", onUpdate);
      if (refetchTimerRef.current) {
        window.clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [queueRefetch, socket]);

  const filteredMatches = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const keyword = textOf(q).toLowerCase();
    let list = [...allMatches];

    if (tab === TAB_ALL) {
      list = list.filter((match) => textOf(match?.status).toLowerCase() !== "finished");
    } else if (tab.startsWith(TAB_STATION_PREFIX)) {
      const stationId = tab.slice(TAB_STATION_PREFIX.length);
      const stationTab = stationTabs.find((item) => textOf(item?.stationId) === stationId);
      const allowedMatchIds = new Set(
        Array.isArray(stationTab?.matchIds) ? stationTab.matchIds.map(normalizeId) : [],
      );
      list = list.filter((match) => {
        const matchId = normalizeId(match?._id);
        return allowedMatchIds.has(matchId) || textOf(match?.courtStationId) === stationId;
      });
    } else {
      list = list.filter(
        (match) =>
          normalizeId(match?.bracket) === tab || normalizeId(match?.bracket?._id) === tab,
      );
    }

    if (keyword) {
      list = list.filter((match) =>
        [
          matchCode(match),
          pairLabel(sidePairOf(match, "A"), match),
          pairLabel(sidePairOf(match, "B"), match),
          playerName(sidePairOf(match, "A")?.player1, match),
          playerName(sidePairOf(match, "A")?.player2, match),
          playerName(sidePairOf(match, "B")?.player1, match),
          playerName(sidePairOf(match, "B")?.player2, match),
          textOf(match?.video),
          textOf(match?.status),
          courtLabelOf(match),
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword),
      );
    }

    return list.sort((a, b) => {
      if (sortKey === "round") return ((a?.round ?? 0) - (b?.round ?? 0)) * dir;
      if (sortKey === "order") return ((a?.order ?? 0) - (b?.order ?? 0)) * dir;
      const timeA = new Date(a?.scheduledAt || a?.createdAt || 0).getTime();
      const timeB = new Date(b?.scheduledAt || b?.createdAt || 0).getTime();
      return (timeA - timeB) * dir;
    });
  }, [allMatches, q, sortDir, sortKey, stationTabs, tab]);

  const openMatch = (match) => {
    const next = new URLSearchParams(searchParams);
    next.set("matchId", normalizeId(match?._id));
    setSearchParams(next, { replace: false });
  };

  const closeMatch = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("matchId");
    setSearchParams(next, { replace: true });
  };

  if (!verifying && !isAdmin && verifyRes && !verifyRes.isReferee) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">
          Bạn không có quyền truy cập màn trọng tài của giải này.
        </Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", background: ui.pageBg, py: { xs: 2, md: 3.5 } }}>
      <Container maxWidth="lg">
        <Stack spacing={1.75}>
          <Paper
            sx={{
              p: { xs: 2, md: 2.5 },
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              background: `linear-gradient(135deg, ${ui.panelBg} 0%, ${ui.softBg} 100%)`,
              boxShadow: "none",
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              gap={2}
            >
              <Box>
                <Button
                  size="small"
                  startIcon={<ArrowBackIcon />}
                  component={RouterLink}
                  to={`/tournament/${id}/overview`}
                  sx={{ mb: 1, color: ui.accent }}
                >
                  Quay lại giải
                </Button>
                <Typography
                  variant="overline"
                  sx={{ color: ui.accent, fontWeight: 700, letterSpacing: 0.8 }}
                >
                  Trọng tài
                </Typography>
                <Typography
                  variant="h4"
                  fontWeight={900}
                  sx={{ mt: 0.5, fontSize: { xs: "2rem", md: "2.5rem" } }}
                >
                  {textOf(tournament?.name) || "Trung tâm trọng tài"}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ mt: 0.75, color: ui.textMuted, maxWidth: 720 }}
                >
                  Danh sách trận chấm điểm realtime, bố cục theo app và tối ưu
                  cho thao tác bắt trận nhanh trên web.
                </Typography>
              </Box>
              <Stack
                direction="row"
                spacing={1}
                alignItems="flex-start"
                flexWrap="wrap"
              >
                <Button
                  component={RouterLink}
                  to={`/tournament/${id}/schedule`}
                  variant="outlined"
                  sx={{ borderRadius: 3 }}
                >
                  Lịch thi đấu
                </Button>
                <Button
                  component={RouterLink}
                  to={`/tournament/${id}/manage`}
                  variant="contained"
                  sx={{ borderRadius: 3 }}
                >
                  Quản lý giải
                </Button>
              </Stack>
            </Stack>
          </Paper>

          <Paper
            sx={{
              p: 1.25,
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              bgcolor: ui.panelBg,
              boxShadow: "none",
            }}
          >
            <Tabs
              value={tab}
              onChange={(_event, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 44,
                "& .MuiTabs-indicator": { display: "none" },
                "& .MuiTabs-flexContainer": { gap: 1 },
                "& .MuiTab-root": {
                  minHeight: 40,
                  minWidth: "unset",
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 999,
                  border: "1px solid",
                  borderColor: "transparent",
                  color: ui.textMuted,
                  fontWeight: 700,
                },
                "& .MuiTab-root.Mui-selected": {
                  color: ui.accent,
                  bgcolor: ui.accentSoft,
                  borderColor: ui.accent,
                },
              }}
            >
              {displayTabs.map((item) => (
                <Tab key={item.type} value={item.type} label={item.label} />
              ))}
            </Tabs>
          </Paper>

          <Paper
            sx={{
              p: { xs: 1.25, md: 1.5 },
              borderRadius: 4,
              border: "1px solid",
              borderColor: ui.border,
              bgcolor: ui.panelBg,
              boxShadow: "none",
            }}
          >
            <Stack spacing={1.25}>
              <TextField
                fullWidth
                size="small"
                placeholder="Tìm trận, cặp đấu, sân, video..."
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  select
                  size="small"
                  label="Sắp xếp"
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="time">Thời gian</MenuItem>
                  <MenuItem value="round">Vòng</MenuItem>
                  <MenuItem value="order">Thứ tự</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Chiều"
                  value={sortDir}
                  onChange={(event) => setSortDir(event.target.value)}
                  sx={{ minWidth: 150 }}
                >
                  <MenuItem value="asc">Tăng</MenuItem>
                  <MenuItem value="desc">Giảm</MenuItem>
                </TextField>
              </Stack>
            </Stack>
          </Paper>

          {error ? (
            <Alert severity="error" sx={{ borderRadius: 3 }}>
              Không tải được danh sách trận trọng tài.
            </Alert>
          ) : null}
          {isLoading ? (
            <Alert severity="info" sx={{ borderRadius: 3 }}>
              Đang tải danh sách trận...
            </Alert>
          ) : null}
          {!isLoading && filteredMatches.length === 0 ? (
            <Alert severity="info" sx={{ borderRadius: 3 }}>
              Chưa có trận nào phù hợp bộ lọc hiện tại.
            </Alert>
          ) : null}

          <Stack spacing={1.25}>
            {filteredMatches.map((match) => {
              const status = getStatusMeta(match?.status);
              const sets = extractSets(match);
              const courtLabel = courtLabelOf(match);
              const orderLabel = Number.isFinite(match?.order)
                ? `T${match.order + 1}`
                : "T—";
              const setsLine = sets
                .map((setText, index) => `G${index + 1}: ${setText}`)
                .join(", ");
              return (
                <Paper
                  key={normalizeId(match?._id)}
                  sx={{
                    p: { xs: 1.5, md: 1.75 },
                    borderRadius: 4,
                    border: "1px solid",
                    borderColor: ui.border,
                    bgcolor: ui.cardBg,
                    boxShadow: "none",
                  }}
                >
                  <Stack spacing={1.25}>
                    <Stack
                      direction="row"
                      spacing={1}
                      flexWrap="wrap"
                      useFlexGap
                      alignItems="center"
                    >
                      <Button
                        variant="contained"
                        size="small"
                        disabled={textOf(match?.status).toLowerCase() === "finished"}
                        onClick={() => openMatch(match)}
                        sx={{
                          borderRadius: 999,
                          px: 1.75,
                          fontWeight: 700,
                          minHeight: 32,
                        }}
                      >
                        Bắt trận
                      </Button>
                      {match?.video ? (
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<OpenInNewIcon />}
                          onClick={() =>
                            window.open(match.video, "_blank", "noopener,noreferrer")
                          }
                          sx={{
                            borderRadius: 999,
                            px: 1.5,
                            fontWeight: 700,
                            minHeight: 32,
                          }}
                        >
                          Mở
                        </Button>
                      ) : null}
                    </Stack>

                    <Box>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.5 }}>
                        {matchCode(match)}
                      </Typography>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.35 }}>
                        {pairLabel(sidePairOf(match, "A"), match)}
                      </Typography>
                      <Typography
                        variant="subtitle1"
                        sx={{ color: ui.textMuted, lineHeight: 1.35 }}
                      >
                        {pairLabel(sidePairOf(match, "B"), match)}
                      </Typography>
                    </Box>

                    {sets.length ? (
                      <Typography variant="caption" sx={{ color: ui.textMuted }}>
                        {setsLine}
                      </Typography>
                    ) : null}

                    <Stack
                      direction="row"
                      spacing={0.75}
                      flexWrap="wrap"
                      useFlexGap
                      alignItems="center"
                    >
                      <Chip
                        size="small"
                        label={status.label}
                        sx={{
                          ...statusChipSx(match?.status),
                          border: "1px solid",
                          fontWeight: 700,
                        }}
                      />
                      <Typography variant="caption" sx={{ color: ui.textMuted }}>
                        {`Vòng ${match?.round ?? "—"} • Thứ tự ${orderLabel}`}
                      </Typography>
                      {courtLabel ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={courtLabel}
                          sx={{ borderColor: ui.border, color: ui.textMuted }}
                        />
                      ) : null}
                      <Chip
                        size="small"
                        icon={<VideocamIcon />}
                        label="Video"
                        sx={{
                          bgcolor: match?.video
                            ? "rgba(34, 197, 94, 0.12)"
                            : "rgba(148, 163, 184, 0.12)",
                          color: match?.video ? "#86efac" : ui.textMuted,
                          border: "1px solid",
                          borderColor: match?.video
                            ? "rgba(34, 197, 94, 0.28)"
                            : ui.border,
                        }}
                      />
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Stack>
      </Container>

      <RefereeScoreDialog
        open={Boolean(selectedMatchId && selectedMatch)}
        matchId={selectedMatchId}
        initialMatch={selectedMatch}
        onClose={closeMatch}
      />
    </Box>
  );
}
