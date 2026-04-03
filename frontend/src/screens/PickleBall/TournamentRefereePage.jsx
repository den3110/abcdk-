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
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
  Sports as SportsIcon,
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

const TAB_ALL = "__all_matches__";
const TAB_STATION_PREFIX = "__station__:";

const textOf = (value) => (value && String(value).trim()) || "";

const normalizeId = (value) => textOf(value?._id || value?.id || value);

const playerName = (player) =>
  player?.displayName ||
  player?.nickname ||
  player?.nickName ||
  player?.fullName ||
  player?.name ||
  "";

const pairLabel = (pair) =>
  textOf(pair?.displayName) ||
  textOf(pair?.name) ||
  [pair?.player1, pair?.player2].filter(Boolean).map(playerName).join(" / ") ||
  "TBD";

const matchCode = (match) =>
  textOf(match?.displayCode) ||
  textOf(match?.globalCode) ||
  textOf(match?.code) ||
  `R${match?.round ?? "?"}-${(match?.order ?? 0) + 1}`;

const courtLabelOf = (match) =>
  textOf(match?.courtStationName) ||
  textOf(match?.courtStationLabel) ||
  textOf(match?.courtLabel) ||
  textOf(match?.court?.name) ||
  textOf(match?.court?.label) ||
  "";

const getStatusMeta = (status) => {
  const key = textOf(status).toLowerCase();
  if (key === "live") return { color: "warning", label: "Đang thi đấu" };
  if (key === "assigned") return { color: "secondary", label: "Đã gán sân" };
  if (key === "queued") return { color: "info", label: "Trong hàng chờ" };
  if (key === "finished") return { color: "success", label: "Đã kết thúc" };
  return { color: "default", label: "Chưa xếp" };
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
  const userId = normalizeId(user?._id);
  if (!userId) return false;
  return normalizeRefereeIds(match).includes(userId);
};

export default function TournamentRefereePage() {
  const { id } = useParams();
  const socket = useSocket();
  const { userInfo } = useSelector((state) => state.auth || {});
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(TAB_ALL);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("time");
  const [sortDir, setSortDir] = useState("asc");
  const refetchTimerRef = useRef(null);

  const { data: tournament } = useGetTournamentQuery(id || skipToken);
  const { data: verifyRes, isLoading: verifying } = useVerifyRefereeQuery(id || skipToken);
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

  const allMatches = useMemo(
    () =>
      (Array.isArray(matchesResp?.items) ? matchesResp.items : []).filter((match) =>
        isUserRefereeOfMatch(match, userInfo),
      ),
    [matchesResp?.items, userInfo],
  );
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
      list = list.filter((match) => normalizeId(match?.bracket) === tab || normalizeId(match?.bracket?._id) === tab);
    }

    if (keyword) {
      list = list.filter((match) =>
        [
          matchCode(match),
          pairLabel(match?.pairA),
          pairLabel(match?.pairB),
          playerName(match?.pairA?.player1),
          playerName(match?.pairA?.player2),
          playerName(match?.pairB?.player1),
          playerName(match?.pairB?.player2),
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

  if (!verifying && verifyRes && !verifyRes.isReferee) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">Bạn không có quyền truy cập màn trọng tài của giải này.</Alert>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: 3 }}>
      <Container maxWidth="lg">
        <Stack spacing={2.5}>
          <Paper sx={{ p: 3, borderRadius: 4 }}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={2}>
              <Box>
                <Button
                  size="small"
                  startIcon={<ArrowBackIcon />}
                  component={RouterLink}
                  to={`/tournament/${id}/overview`}
                  sx={{ mb: 1 }}
                >
                  Quay lại giải
                </Button>
                <Typography variant="overline" color="text.secondary">Referee Center</Typography>
                <Typography variant="h4" fontWeight={900}>
                  {textOf(tournament?.name) || "Tournament referee"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Danh sách trận bạn được phân công chấm, đồng bộ realtime cùng app.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Button component={RouterLink} to={`/tournament/${id}/schedule`} variant="outlined">
                  Lịch thi đấu
                </Button>
                <Button component={RouterLink} to={`/tournament/${id}/manage`} variant="contained">
                  Quản lý giải
                </Button>
              </Stack>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2, borderRadius: 4 }}>
            <Stack spacing={2}>
              <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
                {displayTabs.map((item) => (
                  <Tab key={item.type} value={item.type} label={item.label} />
                ))}
              </Tabs>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Tìm trận, cặp đấu, sân, video..."
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                />
                <TextField select size="small" label="Sắp xếp" value={sortKey} onChange={(event) => setSortKey(event.target.value)} sx={{ minWidth: 160 }}>
                  <MenuItem value="time">Thời gian</MenuItem>
                  <MenuItem value="round">Vòng</MenuItem>
                  <MenuItem value="order">Thứ tự</MenuItem>
                </TextField>
                <TextField select size="small" label="Chiều" value={sortDir} onChange={(event) => setSortDir(event.target.value)} sx={{ minWidth: 140 }}>
                  <MenuItem value="asc">Tăng</MenuItem>
                  <MenuItem value="desc">Giảm</MenuItem>
                </TextField>
              </Stack>
            </Stack>
          </Paper>

          {error ? <Alert severity="error">Không tải được danh sách trận trọng tài.</Alert> : null}
          {isLoading ? <Alert severity="info">Đang tải danh sách trận...</Alert> : null}
          {!isLoading && filteredMatches.length === 0 ? (
            <Alert severity="info">Chưa có trận nào phù hợp bộ lọc hiện tại.</Alert>
          ) : null}

          <Stack spacing={1.5}>
            {filteredMatches.map((match) => {
              const status = getStatusMeta(match?.status);
              const sets = extractSets(match);
              return (
                <Paper key={normalizeId(match?._id)} sx={{ p: 2.25, borderRadius: 4 }}>
                  <Stack spacing={1.5}>
                    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={1.5}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Chip size="small" icon={<SportsIcon />} label={matchCode(match)} />
                        <Chip size="small" color={status.color} label={status.label} />
                        {courtLabelOf(match) ? <Chip size="small" variant="outlined" label={courtLabelOf(match)} /> : null}
                        {sets.map((setText) => (
                          <Chip key={`${normalizeId(match?._id)}-${setText}`} size="small" variant="outlined" label={setText} />
                        ))}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {textOf(match?.scheduledAt) ? new Date(match.scheduledAt).toLocaleString("vi-VN") : "Chưa có giờ"}
                      </Typography>
                    </Stack>

                    <Box>
                      <Typography variant="h6" fontWeight={800}>{pairLabel(match?.pairA)}</Typography>
                      <Typography variant="body2" color="text.secondary">{pairLabel(match?.pairB)}</Typography>
                    </Box>

                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button variant="contained" disabled={textOf(match?.status).toLowerCase() === "finished"} onClick={() => openMatch(match)}>
                        Bắt trận
                      </Button>
                      {match?.video ? (
                        <Button
                          variant="outlined"
                          startIcon={<OpenInNewIcon />}
                          onClick={() => window.open(match.video, "_blank", "noopener,noreferrer")}
                        >
                          Mở
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Stack>
      </Container>

      <RefereeScoreDialog
        open={Boolean(selectedMatchId)}
        matchId={selectedMatchId}
        initialMatch={selectedMatch}
        onClose={closeMatch}
      />
    </Box>
  );
}
