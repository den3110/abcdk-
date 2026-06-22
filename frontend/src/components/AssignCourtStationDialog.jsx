import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import StadiumIcon from "@mui/icons-material/Stadium";
import QueuePlayNextIcon from "@mui/icons-material/QueuePlayNext";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import TouchAppOutlinedIcon from "@mui/icons-material/TouchAppOutlined";
import PropTypes from "prop-types";
import { toast } from "react-toastify";
import {
  useAppendTournamentCourtStationQueueItemMutation,
  useRemoveTournamentCourtStationQueueItemMutation,
  useAssignTournamentMatchToCourtStationMutation,
  useFreeTournamentCourtStationMutation,
  useGetTournamentCourtClusterOptionsQuery,
  useGetTournamentCourtClusterRuntimeQuery,
} from "../slices/courtClustersAdminApiSlice";
import { useSocket } from "../context/SocketContext";
import { useSocketRoomSet } from "../hook/useSocketRoomSet";
import {
  getTournamentNameDisplayMode,
  getTournamentPairName,
} from "../utils/tournamentName";
import { addBusinessBreadcrumb } from "../utils/sentry";
import ResponsiveModal from "./ResponsiveModal";
import ResponsiveMatchViewer from "../screens/PickleBall/match/ResponsiveMatchViewer";

const sid = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const text = (value) => String(value || "").trim();

const matchCode = (match) =>
  text(match?.displayCode) ||
  text(match?.code) ||
  text(match?.globalCode) ||
  text(match?.labelKey) ||
  "—";

const matchEventType = (match) =>
  String(
    match?.tournament?.eventType || match?.eventType || "",
  ).toLowerCase() === "single"
    ? "single"
    : "double";

const matchDisplayMode = (match) => getTournamentNameDisplayMode(match);

const teamSlotLabel = (match, team, slot) =>
  text(
    getTournamentPairName(
      team,
      matchEventType(match),
      matchDisplayMode(match),
      {
        separator: " / ",
        fallback: "",
      },
    ),
  ) ||
  text(team?.name) ||
  `Chưa có đội ${slot}`;

const teamLine = (match) =>
  `${teamSlotLabel(match, match?.pairA, "A")} vs ${teamSlotLabel(
    match,
    match?.pairB,
    "B",
  )}`;

const tournamentTitle = (match) =>
  text(match?.tournament?.name) || "Giải không xác định";

const stationStatusLabel = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "idle":
      return "Sẵn sàng";
    case "live":
      return "Đang live";
    case "maintenance":
      return "Bảo trì";
    default:
      return "";
  }
};

const assignmentModeLabel = (mode) =>
  String(mode || "").toLowerCase() === "queue"
    ? "Danh sách"
    : "Gán tay";

export default function AssignCourtStationDialog({
  open,
  match,
  tournamentId,
  allowedClusters = [],
  canOverride = false,
  onClose,
  onAssigned,
}) {
  const socket = useSocket();
  const normalizedTournamentId = sid(tournamentId);
  const [selectedClusterId, setSelectedClusterId] = useState("");
  const [viewerMatch, setViewerMatch] = useState(null);
  const [queueDetailStationId, setQueueDetailStationId] = useState("");
  const [confirmQueueStationId, setConfirmQueueStationId] = useState("");
  const [confirmRemoveType, setConfirmRemoveType] = useState(null);
  const openTraceRef = useRef("");

  const {
    data: clusterOptionsData,
    isLoading: isLoadingClusterOptions,
    isFetching: isFetchingClusterOptions,
  } = useGetTournamentCourtClusterOptionsQuery(normalizedTournamentId, {
    skip: !open || !normalizedTournamentId,
    refetchOnMountOrArgChange: true,
  });

  const allowedClusterOptions = useMemo(() => {
    const selectedIds = Array.isArray(clusterOptionsData?.selectedIds)
      ? clusterOptionsData.selectedIds
          .map((value) => sid(value))
          .filter(Boolean)
      : [];
    const items = Array.isArray(clusterOptionsData?.items)
      ? clusterOptionsData.items
      : [];
    const selectedItems = items.filter((cluster) =>
      selectedIds.includes(sid(cluster?._id || cluster?.id)),
    );
    if (selectedItems.length) return selectedItems;
    return (Array.isArray(allowedClusters) ? allowedClusters : []).filter(
      Boolean,
    );
  }, [
    allowedClusters,
    clusterOptionsData?.items,
    clusterOptionsData?.selectedIds,
  ]);

  useEffect(() => {
    if (!open) return;
    const currentClusterId = sid(match?.courtClusterId);
    const allowedIds = allowedClusterOptions
      .map((cluster) => sid(cluster?._id || cluster?.id))
      .filter(Boolean);
    if (currentClusterId && allowedIds.includes(currentClusterId)) {
      setSelectedClusterId(currentClusterId);
      return;
    }
    setSelectedClusterId(allowedIds[0] || "");
  }, [allowedClusterOptions, match?.courtClusterId, open]);

  const {
    data: runtime,
    isLoading: isLoadingRuntime,
    error: runtimeError,
    refetch,
  } = useGetTournamentCourtClusterRuntimeQuery(
    {
      tournamentId: normalizedTournamentId,
      clusterId: selectedClusterId,
    },
    {
      skip: !open || !selectedClusterId || !normalizedTournamentId,
      refetchOnMountOrArgChange: true,
    },
  );

  useSocketRoomSet(socket, open && selectedClusterId ? [selectedClusterId] : [], {
    subscribeEvent: "court-cluster:watch",
    unsubscribeEvent: "court-cluster:unwatch",
    payloadKey: "clusterId",
    onResync: () => {
      refetch?.();
    },
  });

  useEffect(() => {
    if (!socket || !open || !selectedClusterId) return undefined;

    const handleClusterUpdate = (payload) => {
      const payloadClusterId = sid(payload?.cluster?._id || payload?.clusterId);
      if (payloadClusterId !== selectedClusterId) return;
      refetch();
    };

    const handleStationUpdate = (payload) => {
      const payloadClusterId = sid(
        payload?.cluster?._id ||
          payload?.clusterId ||
          payload?.station?.clusterId,
      );
      if (payloadClusterId !== selectedClusterId) return;
      refetch();
    };

    socket.on("court-cluster:update", handleClusterUpdate);
    socket.on("court-station:update", handleStationUpdate);
    return () => {
      socket.off("court-cluster:update", handleClusterUpdate);
      socket.off("court-station:update", handleStationUpdate);
    };
  }, [open, refetch, selectedClusterId, socket]);

  const [assignMatchToCourtStation, { isLoading: assigning }] =
    useAssignTournamentMatchToCourtStationMutation();
  const [appendQueueItem, { isLoading: appendingQueue }] =
    useAppendTournamentCourtStationQueueItemMutation();
  const [removeQueueItem, { isLoading: removingQueue }] =
    useRemoveTournamentCourtStationQueueItemMutation();
  const [freeCourtStation, { isLoading: clearing }] =
    useFreeTournamentCourtStationMutation();

  const stations = useMemo(() => runtime?.stations || [], [runtime?.stations]);
  const currentStation = useMemo(() => {
    const matchId = sid(match?._id);
    const direct = sid(match?.courtStationId || match?.courtStation?._id);
    if (direct) {
      const directStation =
        stations.find((station) => sid(station?._id) === direct) || null;
      const directMode = String(
        directStation?.assignmentMode || "manual",
      ).toLowerCase();
      const directStatus = String(directStation?.status || "").toLowerCase();
      const directCurrentMatchId = sid(
        directStation?.currentMatch?._id || directStation?.currentMatch,
      );
      const queueContainsMatch = Array.isArray(directStation?.queueItems)
        ? directStation.queueItems.some(
            (item) => sid(item?.matchId || item?.match?._id) === matchId,
          )
        : false;

      if (directCurrentMatchId === matchId) {
        return directStation;
      }

      if (
        directMode !== "queue" &&
        !queueContainsMatch &&
        ["assigned", "live"].includes(directStatus)
      ) {
        return directStation;
      }
    }
    return (
      stations.find(
        (station) =>
          sid(station?.currentMatch?._id || station?.currentMatch) === matchId,
      ) || null
    );
  }, [match?._id, match?.courtStation?._id, match?.courtStationId, stations]);

  const queuedInfo = useMemo(() => {
    for (const station of stations) {
      if (Array.isArray(station?.queueItems)) {
        const idx = station.queueItems.findIndex(
          (item) => sid(item?.matchId || item?.match?._id) === sid(match?._id),
        );
        if (idx !== -1) {
          return { station, index: idx };
        }
      }
    }
    return null;
  }, [match?._id, stations]);

  const queuedStation = queuedInfo?.station || null;

  const currentStationId = sid(currentStation?._id);
  const queuedStationId = sid(queuedStation?._id);
  const matchId = sid(match?._id);
  const queueDetailStation = useMemo(
    () =>
      stations.find((station) => sid(station?._id) === queueDetailStationId) ||
      null,
    [queueDetailStationId, stations],
  );
  const queueDetailMatches = useMemo(
    () =>
      (Array.isArray(queueDetailStation?.queueItems)
        ? queueDetailStation.queueItems
        : []
      )
        .map((item) => item?.match || item?.matchId)
        .filter(Boolean),
    [queueDetailStation?.queueItems],
  );

  useEffect(() => {
    if (!open) {
      setViewerMatch(null);
      setQueueDetailStationId("");
      setConfirmRemoveType(null);
      openTraceRef.current = "";
    }
  }, [open]);

  useEffect(() => {
    if (!queueDetailStationId) return;
    const exists = stations.some(
      (station) => sid(station?._id) === queueDetailStationId,
    );
    if (!exists) {
      setQueueDetailStationId("");
    }
  }, [queueDetailStationId, stations]);

  useEffect(() => {
    if (queueDetailStationId && matchId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`queued-match-${matchId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [queueDetailStationId, matchId]);

  useEffect(() => {
    if (!open || !matchId) return;
    const traceKey = `${normalizedTournamentId}:${matchId}`;
    if (openTraceRef.current === traceKey) return;
    openTraceRef.current = traceKey;

    addBusinessBreadcrumb("court_station.assign_dialog.open", {
      tournamentId: normalizedTournamentId,
      matchId,
      matchCode: matchCode(match),
      courtStationId: currentStationId || undefined,
      queueStationId: queuedStationId || undefined,
    });
  }, [
    currentStationId,
    match,
    matchId,
    normalizedTournamentId,
    open,
    queuedStationId,
  ]);

  const handleOpenQueueDetail = (stationId) => {
    setQueueDetailStationId(stationId);
    addBusinessBreadcrumb("court_station.queue.detail.open", {
      tournamentId: normalizedTournamentId,
      matchId,
      courtStationId: stationId,
    });
  };

  const handleAction = async (station) => {
    const stationId = sid(station?._id);
    if (!stationId || !matchId) return;
    const assignmentMode = String(
      station?.assignmentMode || "manual",
    ).toLowerCase();
    addBusinessBreadcrumb("court_station.assignment.submit", {
      tournamentId: normalizedTournamentId,
      matchId,
      matchCode: matchCode(match),
      courtStationId: stationId,
      courtStationCode: station?.code,
      assignmentMode,
    });
    try {
      if (assignmentMode === "queue") {
        await appendQueueItem({
          tournamentId: normalizedTournamentId,
          stationId,
          matchId,
        }).unwrap();
      } else {
        await assignMatchToCourtStation({
          tournamentId: normalizedTournamentId,
          stationId,
          matchId,
        }).unwrap();
      }
      onAssigned?.();
      onClose?.();
    } catch (error) {
      toast.error(
        error?.data?.message || error?.message || "Cập nhật sân thất bại",
      );
    }
  };

  const handleQueueConfirmCheck = (station) => {
    if (String(station?.assignmentMode || "").toLowerCase() === "queue") {
      setConfirmQueueStationId(sid(station?._id));
      addBusinessBreadcrumb("court_station.queue.confirm_open", {
        tournamentId: normalizedTournamentId,
        matchId,
        courtStationId: sid(station?._id),
      });
    } else {
      handleAction(station);
    }
  };

  const handleRemoveQueue = async () => {
    if (!queuedStationId || !matchId) return;
    addBusinessBreadcrumb("court_station.queue.remove.submit", {
      tournamentId: normalizedTournamentId,
      matchId,
      courtStationId: queuedStationId,
    });
    try {
      await removeQueueItem({
        tournamentId: normalizedTournamentId,
        stationId: queuedStationId,
        matchId,
      }).unwrap();
      await refetch();
      onAssigned?.();
    } catch (error) {
      toast.error(
        error?.data?.message || error?.message || "Bỏ gán sân thất bại",
      );
    }
  };

  const handleClear = async () => {
    if (!currentStationId) return;
    addBusinessBreadcrumb("court_station.assignment.clear.submit", {
      tournamentId: normalizedTournamentId,
      matchId,
      courtStationId: currentStationId,
    });
    try {
      await freeCourtStation({
        tournamentId: normalizedTournamentId,
        stationId: currentStationId,
      }).unwrap();
      await refetch();
      onAssigned?.();
    } catch (error) {
      toast.error(
        error?.data?.message || error?.message || "Bỏ gán sân thất bại",
      );
    }
  };

  const showInitialRuntimeLoading =
    !runtime && (isLoadingRuntime || isLoadingClusterOptions);
  const showRuntimeError = Boolean(runtimeError) && !runtime;
  const showRuntimeStaleWarning = Boolean(runtimeError) && Boolean(runtime);
  const openViewer = (queuedMatch) => {
    if (!sid(queuedMatch?._id)) return;
    setViewerMatch(queuedMatch);
  };

  return (
    <>
      <ResponsiveModal
        open={open}
        onClose={onClose}
        maxWidth="md"
        icon={<StadiumIcon fontSize="small" />}
        title={`Gán sân — ${matchCode(match)}`}
        subtitle={teamLine(match)}
      >
        <Stack spacing={2.5}>
          {!allowedClusterOptions.length && !isFetchingClusterOptions ? (
            <Alert severity="warning">
              Giải này chưa có cụm sân được phép dùng trong cấu hình giải.
            </Alert>
          ) : !normalizedTournamentId ? (
            <Alert severity="warning">
              Thiếu tournamentId, chưa thể gán sân theo cụm.
            </Alert>
          ) : (
            <>
              {(currentStationId || queuedStationId) && (
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    spacing={1.5}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                  >
                    <Box>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {currentStationId
                          ? `Đang gán tại ${currentStation?.name}`
                          : `Đã có trong danh sách sân ${queuedStation?.name}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {(currentStation || queuedStation)?.code || "—"}
                      </Typography>
                    </Box>
                    {currentStationId ? (
                      <Button
                        variant="contained"
                        color="warning"
                        onClick={() => setConfirmRemoveType("current")}
                        disabled={clearing}
                      >
                        Bỏ gán sân
                      </Button>
                    ) : queuedStationId ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip
                          size="small"
                          color="info"
                          variant="outlined"
                          label={`Có trong danh sách ${queuedStation?.name || ""}`.trim()}
                          onClick={() => handleOpenQueueDetail(queuedStationId)}
                          sx={{ cursor: "pointer" }}
                        />
                        <Button
                          variant="contained"
                          color="warning"
                          onClick={() => setConfirmRemoveType("queued")}
                          disabled={removingQueue}
                        >
                          Bỏ gán sân
                        </Button>
                      </Stack>
                    ) : null}
                  </Stack>
                </Paper>
              )}

              {showRuntimeStaleWarning && (
                <Alert severity="warning">
                  Không thể làm mới dữ liệu lúc này. Đang hiển thị dữ liệu gần
                  nhất.
                </Alert>
              )}

              {showInitialRuntimeLoading ? (
                <Alert severity="info">Đang tải runtime cụm sân...</Alert>
              ) : showRuntimeError ? (
                <Alert severity="error">
                  {runtimeError?.data?.message ||
                    runtimeError?.error ||
                    "Không tải được runtime cụm sân."}
                </Alert>
              ) : (
                <Stack spacing={1.5}>
                  {stations.map((station) => {
                    const stationId = sid(station?._id);
                    const isCurrent = currentStationId === stationId;
                    const isQueued = queuedStationId === stationId;
                    const assignmentMode = String(
                      station?.assignmentMode || "manual",
                    ).toLowerCase();
                    const occupiedTournamentId = sid(
                      station?.currentMatch?.tournament?._id ||
                        station?.currentTournament?._id ||
                        station?.currentTournamentId,
                    );
                    const occupiedByAnotherTournament =
                      occupiedTournamentId &&
                      occupiedTournamentId !== normalizedTournamentId;
                    const queueContainsMatch = Array.isArray(
                      station?.queueItems,
                    )
                      ? station.queueItems.some(
                          (item) =>
                            sid(item?.matchId || item?.match?._id) === matchId,
                        )
                      : false;
                    const disabled =
                      assigning ||
                      appendingQueue ||
                      (!canOverride &&
                        occupiedByAnotherTournament &&
                        !isCurrent &&
                        !isQueued) ||
                      (assignmentMode === "queue" && queueContainsMatch) ||
                      (assignmentMode === "manual" && isCurrent);

                    return (
                      <Paper
                        key={stationId}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          borderColor:
                            isCurrent || isQueued ? "primary.main" : "divider",
                        }}
                      >
                        <Stack spacing={1.25}>
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            justifyContent="space-between"
                            spacing={1}
                            alignItems={{ xs: "flex-start", sm: "center" }}
                          >
                            <Box>
                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                              >
                                <StadiumIcon fontSize="small" />
                                <Typography
                                  variant="subtitle1"
                                  fontWeight={700}
                                >
                                  {station?.name}
                                </Typography>
                              </Stack>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {station?.code || "—"}
                              </Typography>
                            </Box>

                            <Stack
                              direction="row"
                              spacing={1}
                              flexWrap="wrap"
                              useFlexGap
                            >
                              {stationStatusLabel(station?.status) ? (
                                <Chip
                                  size="small"
                                  label={stationStatusLabel(station?.status)}
                                />
                              ) : null}
                              <Chip
                                size="small"
                                variant="outlined"
                                icon={
                                  assignmentMode === "queue" ? (
                                    <SmartToyOutlinedIcon />
                                  ) : (
                                    <TouchAppOutlinedIcon />
                                  )
                                }
                                label={assignmentModeLabel(assignmentMode)}
                              />
                              {station?.queueCount > 0 && (
                                <Chip
                                  size="small"
                                  color="info"
                                  variant="outlined"
                                  icon={<QueuePlayNextIcon />}
                                  label={`${station.queueCount} trận trong danh sách`}
                                  onClick={() =>
                                    handleOpenQueueDetail(stationId)
                                  }
                                />
                              )}
                            </Stack>
                          </Stack>

                          {station?.currentMatch ? (
                            <Box>
                              <Typography variant="body2" fontWeight={700}>
                                {teamLine(station.currentMatch)}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {station?.currentMatch?.tournament?.name || "—"}{" "}
                                · {matchCode(station.currentMatch)}
                              </Typography>
                            </Box>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Chưa có trận nào đang live trên sân.
                            </Typography>
                          )}

                          {occupiedByAnotherTournament && (
                            <Typography variant="caption" color="warning.main">
                              {station?.currentMatch?.tournament?.name ||
                                "Giải khác"}{" "}
                              đang sử dụng sân này.
                            </Typography>
                          )}

                          <Stack direction="row" justifyContent="flex-end" spacing={1}>
                            {assignmentMode === "queue" && isQueued && (
                              <Button
                                variant="contained"
                                color="info"
                                onClick={() => handleOpenQueueDetail(stationId)}
                              >
                                Xem danh sách
                              </Button>
                            )}
                            <Button
                              variant={
                                isCurrent || isQueued ? "outlined" : "contained"
                              }
                              onClick={() => handleQueueConfirmCheck(station)}
                              disabled={disabled}
                            >
                              {assignmentMode === "queue"
                                ? isQueued
                                  ? "Đã có trong danh sách"
                                  : "Thêm vào danh sách sân"
                                : isCurrent
                                  ? "Đang gán"
                                  : "Gán vào sân này"}
                            </Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    );
                  })}
                  {!stations.length && selectedClusterId && (
                    <Alert severity="info">
                      Cụm sân này chưa có sân vật lý nào.
                    </Alert>
                  )}
                </Stack>
              )}
            </>
          )}
        </Stack>
      </ResponsiveModal>

      <Dialog
        open={Boolean(confirmRemoveType)}
        onClose={() => setConfirmRemoveType(null)}
        maxWidth="xs"
        fullWidth
        sx={{ zIndex: (theme) => Math.max(theme.zIndex.modal, 1300) + 50 }}
      >
        <DialogTitle>Xác nhận bỏ gán sân</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Bạn có chắc chắn muốn bỏ gán trận này khỏi {confirmRemoveType === "queued" ? "hàng đợi của " : ""}
            <strong>{confirmRemoveType === "queued" ? queuedStation?.name : currentStation?.name}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemoveType(null)}>Hủy</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (confirmRemoveType === "queued") handleRemoveQueue();
              else if (confirmRemoveType === "current") handleClear();
              setConfirmRemoveType(null);
            }}
          >
            Chắc chắn
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(confirmQueueStationId)}
        onClose={() => setConfirmQueueStationId("")}
        maxWidth="xs"
        fullWidth
        sx={{ zIndex: (theme) => Math.max(theme.zIndex.modal, 1300) + 50 }}
      >
        <DialogTitle>Xác nhận thêm vào danh sách sân</DialogTitle>
        <DialogContent dividers>
          <Typography>
            Nếu thêm vào sân này, trận đấu sẽ được thêm vào danh sách của sân.
            Bạn có chắc chắn muốn thêm?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmQueueStationId("")}>Hủy</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              const st = stations.find(
                (s) => sid(s._id) === confirmQueueStationId,
              );
              if (st) handleAction(st);
              setConfirmQueueStationId("");
            }}
          >
            Chắc chắn
          </Button>
        </DialogActions>
      </Dialog>

      <ResponsiveModal
        open={Boolean(queueDetailStation)}
        onClose={() => setQueueDetailStationId("")}
        maxWidth="sm"
        icon={<QueuePlayNextIcon fontSize="small" />}
        title={`Danh sách trận — ${queueDetailStation?.name || "Sân"}`}
        subtitle={
          selectedClusterId ? "Các trận đang nằm trong danh sách của sân này." : ""
        }
      >
        <Stack spacing={1.25} sx={{ pb: 2 }}>
          {!queueDetailMatches.length ? (
            <Alert severity="info">Sân này hiện chưa có trận nào trong danh sách.</Alert>
          ) : (
            queueDetailMatches.map((queuedMatch, index) => {
              const queuedMatchId = sid(queuedMatch?._id);
              return (
                <Paper
                  id={`queued-match-${queuedMatchId}`}
                  key={queuedMatchId || `queue-${index}`}
                  variant="outlined"
                  onClick={() => openViewer(queuedMatch)}
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    cursor: "pointer",
                    borderWidth: queuedMatchId === matchId ? 2 : 1,
                    borderColor:
                      queuedMatchId === matchId ? "primary.main" : "divider",
                    transition: "box-shadow 0.2s ease",
                    "&:hover": {
                      boxShadow: 1,
                    },
                  }}
                >
                  <Stack spacing={0.35}>
                    <Typography variant="caption" color="text.secondary">
                      {tournamentTitle(queuedMatch)}
                    </Typography>
                    <Typography variant="body2" fontWeight={700}>
                      #{index + 1} · {matchCode(queuedMatch)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {teamLine(queuedMatch)}
                    </Typography>
                  </Stack>
                </Paper>
              );
            })
          )}
        </Stack>
      </ResponsiveModal>

      <ResponsiveMatchViewer
        open={Boolean(viewerMatch)}
        matchId={sid(viewerMatch?._id)}
        initialMatch={viewerMatch}
        onClose={() => setViewerMatch(null)}
        zIndex={1400}
      />
    </>
  );
}

AssignCourtStationDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  match: PropTypes.object,
  tournamentId: PropTypes.string,
  allowedClusters: PropTypes.array,
  canOverride: PropTypes.bool,
  onClose: PropTypes.func,
  onAssigned: PropTypes.func,
};
