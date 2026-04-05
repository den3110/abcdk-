import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
} from "@mui/material";
import StadiumIcon from "@mui/icons-material/Stadium";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PropTypes from "prop-types";
import { toast } from "react-toastify";
import {
  useFreeTournamentCourtStationMutation,
  useGetAdminCourtClusterRuntimeQuery,
  useGetTournamentCourtClusterOptionsQuery,
  useGetTournamentCourtClusterRuntimeQuery,
  useUpdateTournamentAllowedCourtClustersMutation,
  useUpdateTournamentCourtStationAssignmentConfigMutation,
} from "../slices/courtClustersAdminApiSlice";
import { useListTournamentRefereesQuery } from "../slices/refereeScopeApiSlice";
import { useSocket } from "../context/SocketContext";
import { useSocketRoomSet } from "../hook/useSocketRoomSet";
import {
  getTournamentNameDisplayMode,
  getTournamentPairName,
} from "../utils/tournamentName";
import { addBusinessBreadcrumb } from "../utils/sentry";
import ResponsiveModal from "./ResponsiveModal";
import ResponsiveMatchViewer from "../screens/PickleBall/match/ResponsiveMatchViewer";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

const selectorLabel = (match) =>
  [tournamentTitle(match), matchCode(match), teamLine(match)]
    .filter(Boolean)
    .join(" · ");

const stationStatusLabel = (status) =>
  ({
    idle: "Sẵn sàng",
    assigned: "Đã được gán trận",
    live: "Đang live",
    maintenance: "Bảo trì",
  })[String(status || "").toLowerCase()] ||
  status ||
  "—";

const modeLabel = (mode) =>
  String(mode || "").toLowerCase() === "queue"
    ? "Danh sách"
    : "Gán tay";

const normalizeAssignmentMode = (mode) => {
  const normalized = String(mode || "").trim().toLowerCase();
  return normalized === "queue" || normalized === "auto" ? "queue" : "manual";
};

const isLiveMatch = (match) =>
  String(match?.status || "").trim().toLowerCase() === "live";

const isGroupBracket = (match) => {
  const type = String(match?.bracket?.type || "").toLowerCase();
  return type === "group" || type === "round_robin" || type === "gsl";
};

const bracketTitle = (match) => {
  const name = text(match?.bracket?.name);
  if (name) return name;
  if (isGroupBracket(match)) return "Vòng bảng";
  const round = Number(match?.globalRound || match?.sort?.round || 0);
  if (round > 0) return `Vòng ${round}`;
  return "Bracket";
};

const poolLabel = (match) => {
  const raw = text(match?.pool?.name);
  if (raw) return raw.toUpperCase();
  const index = Number(match?.pool?.index || match?.sort?.pool || 0);
  if (index > 0 && index <= 26) return String.fromCharCode(64 + index);
  if (index > 0) return String(index);
  return "";
};

const poolTitle = (match) => {
  const label = poolLabel(match);
  return label ? `Bảng ${label}` : "";
};

const compareSelectorMatches = (a, b) => {
  const aRound = Number(a?.sort?.round || a?.globalRound || 9999);
  const bRound = Number(b?.sort?.round || b?.globalRound || 9999);
  if (aRound !== bRound) return aRound - bRound;

  const aStage = Number(a?.sort?.bracketStage || a?.bracket?.stage || 9999);
  const bStage = Number(b?.sort?.bracketStage || b?.bracket?.stage || 9999);
  if (aStage !== bStage) return aStage - bStage;

  const aBracketOrder = Number(
    a?.sort?.bracketOrder || a?.bracket?.order || 9999,
  );
  const bBracketOrder = Number(
    b?.sort?.bracketOrder || b?.bracket?.order || 9999,
  );
  if (aBracketOrder !== bBracketOrder) return aBracketOrder - bBracketOrder;

  const aPool = Number(a?.sort?.pool || a?.pool?.index || 9999);
  const bPool = Number(b?.sort?.pool || b?.pool?.index || 9999);
  if (aPool !== bPool) return aPool - bPool;

  const aOrder = Number(a?.sort?.order || a?.matchOrder || 9999);
  const bOrder = Number(b?.sort?.order || b?.matchOrder || 9999);
  if (aOrder !== bOrder) return aOrder - bOrder;

  return matchCode(a).localeCompare(matchCode(b), "vi");
};

const getRefId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(
    value._id ||
      value.id ||
      value.userId ||
      value.refId ||
      value.uid ||
      "",
  );
};

const refDisplayName = (referee) => {
  if (!referee || typeof referee !== "object") return "";
  const candidates = [
    referee.nickname,
    referee.nickName,
    referee.displayName,
    referee.fullName,
    referee.name,
    referee.code,
    referee.email,
    referee.phone,
  ];
  for (const value of candidates) {
    if (text(value)) return text(value);
  }
  return getRefId(referee);
};

const getStationDefaultRefereeIds = (station) => {
  if (Array.isArray(station?.defaultRefereeIds)) {
    return station.defaultRefereeIds.map((value) => sid(value)).filter(Boolean);
  }
  if (Array.isArray(station?.defaultReferees)) {
    return station.defaultReferees.map((value) => getRefId(value)).filter(Boolean);
  }
  return [];
};

const buildDraft = (station) => ({
  assignmentMode: normalizeAssignmentMode(station?.assignmentMode),
  queueMatchIds: Array.isArray(station?.queueItems)
    ? station.queueItems
        .map((item) => sid(item?.matchId || item?.match?._id))
        .filter(Boolean)
    : [],
  defaultRefereeIds: getStationDefaultRefereeIds(station),
  pickerMatchIds: [],
  dirty: false,
});

function SortableQueueItem({ id, disabled, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <Box
      ref={setNodeRef}
      sx={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : "auto",
      }}
    >
      {children({ attributes, listeners, isDragging })}
    </Box>
  );
}
SortableQueueItem.propTypes = {
  id: PropTypes.string.isRequired,
  children: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

function StatCard({ label, value, tone = "default" }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{
        px: 1.5,
        py: 0.5,
        borderRadius: 2,
        bgcolor: (theme) => {
          if (theme.palette.mode === "dark") {
            if (tone === "default") return "rgba(255,255,255,0.05)";
            if (tone === "success") return "rgba(76, 175, 80, 0.16)";
            if (tone === "warning") return "rgba(255, 152, 0, 0.16)";
            if (tone === "info") return "rgba(3, 169, 244, 0.16)";
            return "rgba(255,255,255,0.05)";
          } else {
            if (tone === "default") return "grey.100";
            if (tone === "success") return "success.light";
            if (tone === "warning") return "warning.light";
            if (tone === "info") return "info.light";
            return "grey.100";
          }
        },
        color: (theme) => {
          if (theme.palette.mode === "dark") {
            if (tone === "default") return "text.primary";
            if (tone === "success") return "success.light";
            if (tone === "warning") return "warning.light";
            if (tone === "info") return "info.light";
            return "text.primary";
          } else {
            if (tone === "default") return "text.primary";
            return `${tone}.dark`;
          }
        },
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}:
      </Typography>
      <Typography variant="subtitle2" fontWeight={800}>
        {value}
      </Typography>
    </Stack>
  );
}

StatCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  tone: PropTypes.oneOf(["default", "success", "warning", "info"]),
};

function TournamentCourtClusterDialog({
  open,
  tournament,
  canOverride = false,
  onClose,
  onUpdated,
}) {
  const socket = useSocket();
  const tournamentId = sid(tournament?._id || tournament?.id);
  const initialAllowedIds = useMemo(
    () =>
      (Array.isArray(tournament?.allowedCourtClusters)
        ? tournament.allowedCourtClusters
        : []
      )
        .map((cluster) => sid(cluster?._id || cluster?.id))
        .filter(Boolean),
    [tournament?.allowedCourtClusters],
  );
  const [selectedAllowedId, setSelectedAllowedId] = useState("");
  const [stationDrafts, setStationDrafts] = useState({});
  const [viewerMatch, setViewerMatch] = useState(null);
  const [sharedTournamentsOpen, setSharedTournamentsOpen] = useState(false);
  const [queuePickerOpenByStation, setQueuePickerOpenByStation] = useState({});
  const openTraceRef = useRef("");
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const { data: optionsData, isFetching: loadingOptions } =
    useGetTournamentCourtClusterOptionsQuery(tournamentId, {
      skip: !open || !tournamentId,
      refetchOnMountOrArgChange: true,
    });

  const initialAllowedId = useMemo(() => {
    const selectedIds = Array.isArray(optionsData?.selectedIds)
      ? optionsData.selectedIds.map((value) => sid(value)).filter(Boolean)
      : [];
    return selectedIds[0] || initialAllowedIds[0] || "";
  }, [initialAllowedIds, optionsData?.selectedIds]);

  const clusterOptions = useMemo(
    () => optionsData?.items || [],
    [optionsData?.items],
  );
  const selectedCluster = useMemo(
    () =>
      clusterOptions.find(
        (cluster) => sid(cluster?._id || cluster?.id) === selectedAllowedId,
      ) || null,
    [clusterOptions, selectedAllowedId],
  );

  const currentSavedCluster = useMemo(
    () =>
      clusterOptions.find(
        (cluster) => sid(cluster?._id || cluster?.id) === initialAllowedId,
      ) || null,
    [clusterOptions, initialAllowedId],
  );
  const isClusterDirty = selectedAllowedId !== initialAllowedId;

  useEffect(() => {
    if (open) setSelectedAllowedId(initialAllowedId);
  }, [initialAllowedId, open]);

  const isPreviewingUnsavedCluster =
    Boolean(selectedAllowedId) && selectedAllowedId !== initialAllowedId;
  const queuePickerOpenRef = useRef(false);
  const pendingRuntimeRefreshRef = useRef(false);

  const {
    data: tournamentRuntime,
    isLoading: isLoadingTournamentRuntime,
    isFetching: isFetchingTournamentRuntime,
    error: tournamentRuntimeError,
    refetch: refetchTournamentRuntime,
  } = useGetTournamentCourtClusterRuntimeQuery(
    { tournamentId, clusterId: selectedAllowedId },
    {
      skip:
        !open ||
        !tournamentId ||
        !selectedAllowedId ||
        isPreviewingUnsavedCluster,
      refetchOnMountOrArgChange: true,
    },
  );

  const {
    data: previewRuntime,
    isLoading: isLoadingPreviewRuntime,
    isFetching: isFetchingPreviewRuntime,
    error: previewRuntimeError,
    refetch: refetchPreviewRuntime,
  } = useGetAdminCourtClusterRuntimeQuery(selectedAllowedId, {
    skip: !open || !selectedAllowedId || !isPreviewingUnsavedCluster,
    refetchOnMountOrArgChange: true,
  });

  const runtime = isPreviewingUnsavedCluster ? previewRuntime : tournamentRuntime;
  const isLoadingRuntime = isPreviewingUnsavedCluster
    ? isLoadingPreviewRuntime
    : isLoadingTournamentRuntime;
  const isFetchingRuntime = isPreviewingUnsavedCluster
    ? isFetchingPreviewRuntime
    : isFetchingTournamentRuntime;
  const runtimeError = isPreviewingUnsavedCluster
    ? previewRuntimeError
    : tournamentRuntimeError;
  const refetchRuntime = isPreviewingUnsavedCluster
    ? refetchPreviewRuntime
    : refetchTournamentRuntime;
  const setQueuePickerOpen = useCallback((stationId, isOpen) => {
    const normalizedStationId = sid(stationId);
    if (!normalizedStationId) return;

    setQueuePickerOpenByStation((current) => {
      const alreadyOpen = Boolean(current[normalizedStationId]);
      if (alreadyOpen === isOpen) return current;

      if (isOpen) {
        return {
          ...current,
          [normalizedStationId]: true,
        };
      }

      const next = { ...current };
      delete next[normalizedStationId];
      return next;
    });
  }, []);

  useEffect(() => {
    const hasOpenQueuePicker =
      Object.keys(queuePickerOpenByStation || {}).length > 0;
    queuePickerOpenRef.current = hasOpenQueuePicker;

    if (!open || hasOpenQueuePicker || !pendingRuntimeRefreshRef.current) {
      return;
    }

    pendingRuntimeRefreshRef.current = false;
    refetchRuntime?.();
  }, [open, queuePickerOpenByStation, refetchRuntime]);

  const requestRuntimeRefresh = useCallback(() => {
    if (queuePickerOpenRef.current) {
      pendingRuntimeRefreshRef.current = true;
      return;
    }
    refetchRuntime?.();
  }, [refetchRuntime]);

  useSocketRoomSet(socket, selectedAllowedId ? [selectedAllowedId] : [], {
    subscribeEvent: "court-cluster:watch",
    unsubscribeEvent: "court-cluster:unwatch",
    payloadKey: "clusterId",
  });

  const stationIdsToWatch = useMemo(() => {
    if (!runtime?.stations) return [];
    return runtime.stations.map((s) => sid(s?._id)).filter(Boolean);
  }, [runtime?.stations]);

  useSocketRoomSet(socket, stationIdsToWatch, {
    subscribeEvent: "court-station:watch",
    unsubscribeEvent: "court-station:unwatch",
    payloadKey: "stationId",
  });

  useEffect(() => {
    if (!socket || !open || !selectedAllowedId) return undefined;

    const handleClusterUpdate = (payload) => {
      const payloadClusterId = sid(payload?.cluster?._id || payload?.clusterId);
      if (payloadClusterId === selectedAllowedId) {
        requestRuntimeRefresh();
      }
    };

    const handleStationUpdate = (payload) => {
      const payloadClusterId = sid(
        payload?.cluster?._id ||
          payload?.clusterId ||
          payload?.station?.clusterId,
      );
      if (payloadClusterId === selectedAllowedId) {
        requestRuntimeRefresh();
      }
    };

    socket.on("court-cluster:update", handleClusterUpdate);
    socket.on("court-station:update", handleStationUpdate);
    return () => {
      socket.off("court-cluster:update", handleClusterUpdate);
      socket.off("court-station:update", handleStationUpdate);
    };
  }, [open, requestRuntimeRefresh, selectedAllowedId, socket]);

  useEffect(() => {
    if (!runtime?.stations) {
      setStationDrafts({});
      return;
    }

    setStationDrafts((current) => {
      const next = {};
      runtime.stations.forEach((station) => {
        const stationId = sid(station?._id);
        next[stationId] = current[stationId]?.dirty
          ? current[stationId]
          : buildDraft(station);
      });
      return next;
    });
  }, [runtime?.stations]);

  useEffect(() => {
    if (!open) {
      setViewerMatch(null);
      openTraceRef.current = "";
      setQueuePickerOpenByStation({});
      queuePickerOpenRef.current = false;
      pendingRuntimeRefreshRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !tournamentId) return;
    if (openTraceRef.current === tournamentId) return;
    openTraceRef.current = tournamentId;

    addBusinessBreadcrumb("court_station.manage_dialog.open", {
      tournamentId,
      tournamentName: tournament?.name,
      clusterId: selectedAllowedId || initialAllowedId || undefined,
    });
  }, [
    initialAllowedId,
    open,
    selectedAllowedId,
    tournament?.name,
    tournamentId,
  ]);

  const [updateAllowed, { isLoading: savingAllowed }] =
    useUpdateTournamentAllowedCourtClustersMutation();
  const [saveConfig, { isLoading: savingConfig }] =
    useUpdateTournamentCourtStationAssignmentConfigMutation();
  const [freeStation, { isLoading: freeing }] =
    useFreeTournamentCourtStationMutation();
  const { data: tournamentRefereesData, isLoading: loadingReferees } =
    useListTournamentRefereesQuery(
      { tid: tournamentId, q: "" },
      { skip: !open || !tournamentId },
    );

  const stations = useMemo(() => runtime?.stations || [], [runtime?.stations]);
  const tournamentReferees = useMemo(() => {
    if (Array.isArray(tournamentRefereesData?.items)) {
      return tournamentRefereesData.items;
    }
    if (Array.isArray(tournamentRefereesData?.data)) {
      return tournamentRefereesData.data;
    }
    if (Array.isArray(tournamentRefereesData)) {
      return tournamentRefereesData;
    }
    return [];
  }, [tournamentRefereesData]);
  const refereeOptions = useMemo(() => {
    const map = new Map();
    tournamentReferees.forEach((referee) => {
      const id = getRefId(referee);
      if (id) map.set(id, referee);
    });
    stations.forEach((station) => {
      (Array.isArray(station?.defaultReferees) ? station.defaultReferees : [])
        .forEach((referee) => {
          const id = getRefId(referee);
          if (id && !map.has(id)) {
            map.set(id, referee);
          }
        });
    });
    return Array.from(map.values()).sort((left, right) =>
      refDisplayName(left).localeCompare(refDisplayName(right), "vi")
    );
  }, [stations, tournamentReferees]);
  const refereeOptionMap = useMemo(
    () =>
      new Map(
        refereeOptions
          .map((referee) => [getRefId(referee), referee])
          .filter(([id]) => Boolean(id)),
      ),
    [refereeOptions],
  );
  const availableMatches = useMemo(
    () => [...(runtime?.availableMatches || [])].sort(compareSelectorMatches),
    [runtime?.availableMatches],
  );
  const reservedByOther = useMemo(() => {
    const next = new Map();
    stations.forEach((station) => {
      const ids = new Set();
      if (station?.currentMatch?._id) {
        ids.add(sid(station.currentMatch._id));
      }
      (Array.isArray(station?.queueItems) ? station.queueItems : []).forEach(
        (item) => {
          const matchId = sid(item?.matchId || item?.match?._id);
          if (matchId) ids.add(matchId);
        },
      );
      next.set(sid(station?._id), ids);
    });
    return next;
  }, [stations]);
  const stats = useMemo(
    () => ({
      total: stations.length,
      live: stations.filter(
        (station) => String(station?.status || "").toLowerCase() === "live",
      ).length,
      occupied: stations.filter((station) => station?.currentMatch).length,
      empty:
        stations.length -
        stations.filter((station) => station?.currentMatch).length,
    }),
    [stations],
  );
  const sharedTournamentCount = Number(runtime?.sharedTournamentCount || 0);
  const sharedTournaments = Array.isArray(runtime?.sharedTournaments)
    ? runtime.sharedTournaments
    : [];
  const clusterInteractionDisabled = isPreviewingUnsavedCluster;

  const setDraft = (stationId, patch, { markDirty = true } = {}) => {
    setStationDrafts((current) => {
      const previous = current[stationId] || buildDraft({});
      const patchObject =
        typeof patch === "function" ? patch(previous) : patch || {};
      const next = {
        ...previous,
        ...patchObject,
      };
      return {
        ...current,
        [stationId]: {
          ...next,
          dirty: Object.prototype.hasOwnProperty.call(patchObject, "dirty")
            ? patchObject.dirty
            : markDirty
              ? true
              : previous.dirty,
        },
      };
    });
  };

  const handleSelectAllowedCluster = (clusterId) => {
    setSelectedAllowedId(clusterId);
    addBusinessBreadcrumb("court_station.cluster.select", {
      tournamentId,
      tournamentName: tournament?.name,
      clusterId,
    });
  };

  const saveAllowedCluster = async () => {
    addBusinessBreadcrumb("court_station.cluster.save.submit", {
      tournamentId,
      tournamentName: tournament?.name,
      clusterId: selectedAllowedId || undefined,
    });
    try {
      await updateAllowed({
        tournamentId,
        allowedCourtClusterIds: selectedAllowedId ? [selectedAllowedId] : [],
      }).unwrap();
      onUpdated?.();
    } catch (error) {
      toast.error(
        error?.data?.message || error?.message || "Cập nhật cụm sân thất bại",
      );
    }
  };

  const addQueueMatches = (stationId) => {
    const draft = stationDrafts[stationId] || buildDraft({});
    addBusinessBreadcrumb("court_station.queue.add.submit", {
      tournamentId,
      tournamentName: tournament?.name,
      courtStationId: stationId,
      addedCount: draft.pickerMatchIds.length,
    });
    setDraft(stationId, (draft) => {
      const additions = draft.pickerMatchIds.filter(
        (matchId) => !draft.queueMatchIds.includes(matchId),
      );
      if (!additions.length) return { ...draft, pickerMatchIds: [] };

      // Map IDs to full match objects to sort them properly
      const matchMap = new Map();
      availableMatches.forEach((match) => {
        if (match?._id) matchMap.set(sid(match._id), match);
      });

      const sortedAdditions = additions
        .map((id) => matchMap.get(id))
        .filter(Boolean)
        .sort(compareSelectorMatches)
        .map((match) => sid(match._id));

      return {
        ...draft,
        queueMatchIds: [...draft.queueMatchIds, ...sortedAdditions],
        pickerMatchIds: [],
        dirty: true,
      };
    });
  };

  const toggleGroupPicker = (stationId, groupMatchIds = []) => {
    addBusinessBreadcrumb("court_station.queue.group_toggle", {
      tournamentId,
      tournamentName: tournament?.name,
      courtStationId: stationId,
      matchCount: groupMatchIds.length,
    });
    setDraft(
      stationId,
      (draft) => {
        const selected = new Set(draft.pickerMatchIds);
        const allSelected =
          groupMatchIds.length > 0 &&
          groupMatchIds.every((matchId) => selected.has(matchId));

        if (allSelected) {
          groupMatchIds.forEach((matchId) => selected.delete(matchId));
        } else {
          groupMatchIds.forEach((matchId) => selected.add(matchId));
        }

        return {
          ...draft,
          pickerMatchIds: Array.from(selected),
        };
      },
      { markDirty: false },
    );
  };

  const removeQueueMatch = (stationId, matchId) => {
    addBusinessBreadcrumb("court_station.queue.remove", {
      tournamentId,
      tournamentName: tournament?.name,
      courtStationId: stationId,
      matchId,
    });
    setDraft(stationId, (draft) => ({
      ...draft,
      queueMatchIds: draft.queueMatchIds.filter((value) => value !== matchId),
      dirty: true,
    }));
  };

  const saveStationConfig = async (station) => {
    const stationId = sid(station?._id);
    const draft = stationDrafts[stationId] || buildDraft(station);
    addBusinessBreadcrumb("court_station.config.save.submit", {
      tournamentId,
      tournamentName: tournament?.name,
      courtStationId: stationId,
      courtStationCode: station?.code,
      assignmentMode: draft.assignmentMode,
      queueCount: draft.queueMatchIds.length,
      refereeCount: draft.defaultRefereeIds.length,
    });
    try {
      const payload = {
        tournamentId,
        stationId,
        assignmentMode: draft.assignmentMode,
        queueMatchIds:
          draft.assignmentMode === "queue" ? draft.queueMatchIds : undefined,
        refereeIds: draft.defaultRefereeIds,
      };
      await saveConfig(payload).unwrap();
      setStationDrafts((current) => ({
        ...current,
        [stationId]: {
          ...draft,
          pickerMatchIds: [],
          dirty: false,
        },
      }));
      await refetchRuntime();
      onUpdated?.();
    } catch (error) {
      toast.error(
        error?.data?.message || error?.message || "Lưu cấu hình sân thất bại",
      );
    }
  };

  const freeCurrent = async (stationId) => {
    addBusinessBreadcrumb("court_station.assignment.clear.submit", {
      tournamentId,
      tournamentName: tournament?.name,
      courtStationId: stationId,
    });
    try {
      await freeStation({ tournamentId, stationId }).unwrap();
      await refetchRuntime();
      onUpdated?.();
    } catch (error) {
      toast.error(
        error?.data?.message || error?.message || "Giải phóng sân thất bại",
      );
    }
  };

  const openViewer = (match) => {
    if (!sid(match?._id)) return;
    setViewerMatch(match);
  };

  return (
    <>
      <ResponsiveModal
        open={open}
        onClose={onClose}
        maxWidth="lg"
        icon={<StadiumIcon fontSize="small" />}
        title={
          <Typography
            variant="h6"
            fontWeight={800}
            display="flex"
            alignItems="center"
            gap={1.5}
          >
            Quản lý sân theo cụm
            {currentSavedCluster && (
              <Chip
                size="small"
                color="primary"
                label={`Đang dùng: ${currentSavedCluster.name}`}
                sx={{ fontWeight: "normal", height: 24, fontSize: "0.75rem" }}
              />
            )}
          </Typography>
        }
        subtitle={
          <Typography variant="body2" color="text.secondary">
            Cấu hình cụm sân mà{" "}
            <strong>{tournament?.name || "giải đấu"}</strong> được phép dùng.
          </Typography>
        }
        contentProps={{ sx: { pt: 2 } }}
      >
        <Box sx={{ display: "none", pb: 1.5 }}>
          <Stack spacing={0.75}>
            <Typography variant="h5" fontWeight={800}>
              Quản lý sân theo cụm
              {currentSavedCluster && (
                <Chip
                  size="small"
                  color="primary"
                  label={`Đang dùng: ${currentSavedCluster.name}`}
                  sx={{ ml: 1.5, verticalAlign: "middle", fontSize: "0.75rem" }}
                />
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Cấu hình cụm sân mà{" "}
              <strong>{tournament?.name || "giải đấu"}</strong> được phép dùng.
            </Typography>
          </Stack>
        </Box>

        <Box sx={{ pt: 2 }}>
          <Stack spacing={2}>
            <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                alignItems={{ xs: "stretch", md: "center" }}
              >
                <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: "nowrap" }}>
                  Cụm sân giải đấu:
                </Typography>
                <Autocomplete
                  componentsProps={{ popper: { style: { zIndex: 1400 } } }}
                  options={clusterOptions}
                  loading={loadingOptions}
                  value={selectedCluster}
                  onChange={(_, value) =>
                    handleSelectAllowedCluster(sid(value?._id || value?.id))
                  }
                  isOptionEqualToValue={(option, value) =>
                    sid(option?._id || option?.id) ===
                    sid(value?._id || value?.id)
                  }
                  getOptionLabel={(option) =>
                    [option?.name, option?.venueName]
                      .filter(Boolean)
                      .join(" · ") ||
                    option?.name ||
                    "Cụm sân"
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      placeholder="Chọn cụm sân..."
                      sx={{ bgcolor: "background.paper", borderRadius: 1 }}
                    />
                  )}
                  sx={{ flex: 1, minWidth: 200 }}
                />
                <Button
                  variant="contained"
                  onClick={saveAllowedCluster}
                  disabled={!tournamentId || savingAllowed || !isClusterDirty}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {savingAllowed
                    ? "Đang lưu..."
                    : !isClusterDirty && selectedAllowedId
                      ? "Đã lưu cụm này"
                      : "Lưu cụm sân"}
                </Button>
              </Stack>
            </Paper>

            {!selectedAllowedId ? (
              <Alert severity="warning">
                Giải này chưa có cụm sân nào được bật.
              </Alert>
            ) : (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Stack spacing={2}>
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", md: "center" }}
                  >
                    <Box>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                        useFlexGap
                      >
                        <Typography variant="subtitle1" fontWeight={800}>
                          {selectedCluster?.name || "Cụm sân"}
                        </Typography>
                        {sharedTournamentCount > 1 && (
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label={`Cụm sân: ${selectedCluster?.name || ""} đang dùng chung ${sharedTournamentCount} giải`}
                            onClick={() => setSharedTournamentsOpen(true)}
                            sx={{
                              alignSelf: "flex-start",
                              cursor: "pointer",
                              fontWeight: 600,
                              color: "#e65100",
                              borderColor: "#e65100",
                              "&:hover": {
                                backgroundColor: "#e65100 !important",
                                color: "white",
                              },
                            }}
                          />
                        )}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {selectedCluster?.venueName || "Chưa có địa điểm"}
                      </Typography>
                    </Box>

                    <Stack
                      direction="row"
                      spacing={1}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <StatCard label="Tổng sân" value={stats.total} />
                      <StatCard
                        label="Sân trống"
                        value={stats.empty}
                        tone="success"
                      />
                      <StatCard
                        label="Đang có trận"
                        value={stats.occupied}
                        tone="warning"
                      />
                      <StatCard
                        label="Đang live"
                        value={stats.live}
                        tone="info"
                      />
                    </Stack>
                  </Stack>

                  <Divider />

                  {isPreviewingUnsavedCluster && (
                    <Alert severity="info">
                      Đang xem trước thông tin của cụm sân này. Bấm{" "}
                      <strong>Lưu cụm sân</strong> để áp dụng cho giải và bật
                      các thao tác gán sân.
                    </Alert>
                  )}

                  {Boolean(runtimeError) && Boolean(runtime) && (
                    <Alert severity="warning">
                      Không thể làm mới runtime lúc này. Đang hiển thị dữ liệu
                      gần nhất.
                    </Alert>
                  )}

                  {!runtime && isLoadingRuntime ? (
                    <Alert severity="info">Đang tải runtime cụm sân...</Alert>
                  ) : !runtime && runtimeError ? (
                    <Alert severity="error">
                      {runtimeError?.data?.message ||
                        runtimeError?.error ||
                        "Không tải được runtime cụm sân."}
                    </Alert>
                  ) : !stations.length ? (
                    <Alert severity="info">
                      Cụm sân này chưa có sân vật lý nào.
                    </Alert>
                  ) : (
                    <Stack spacing={1.25}>
                      {stations.map((station) => {
                        const stationId = sid(station?._id);
                        const draft =
                          stationDrafts[stationId] || buildDraft(station);
                        const assignmentMode = normalizeAssignmentMode(
                          draft.assignmentMode || station?.assignmentMode,
                        );
                        const selectedRefereeId =
                          draft.defaultRefereeIds[0] || "";
                        const selectedReferee =
                          refereeOptionMap.get(selectedRefereeId) ||
                          (Array.isArray(station?.defaultReferees)
                            ? station.defaultReferees.find(
                                (referee) =>
                                  getRefId(referee) === selectedRefereeId,
                              ) || null
                            : null);
                        const selectedRefereeLabel = selectedReferee
                          ? refDisplayName(selectedReferee)
                          : "";
                        const liveCurrentMatch = isLiveMatch(station?.currentMatch)
                          ? station.currentMatch
                          : null;
                        const liveCurrentMatchId = sid(liveCurrentMatch?._id);
                        const occupiedTournamentId = sid(
                          liveCurrentMatch?.tournament?._id ||
                            station?.currentTournament?._id ||
                            station?.currentTournamentId,
                        );
                        const occupiedByAnotherTournament =
                          occupiedTournamentId &&
                          occupiedTournamentId !== tournamentId;

                        const matchMap = new Map();
                        availableMatches.forEach((match) =>
                          matchMap.set(sid(match?._id), match),
                        );
                        if (station?.currentMatch?._id) {
                          matchMap.set(
                            sid(station.currentMatch._id),
                            station.currentMatch,
                          );
                        }
                        (Array.isArray(station?.queueItems)
                          ? station.queueItems
                          : []
                        ).forEach((item) => {
                          const match = item?.match;
                          if (match?._id) {
                            matchMap.set(sid(match._id), match);
                          }
                        });

                        const displayQueueMatchIds = draft.queueMatchIds.filter(
                          (matchId) => matchId && matchId !== liveCurrentMatchId,
                        );

                        const queueMatches = displayQueueMatchIds
                          .map((matchId) => matchMap.get(matchId))
                          .filter(Boolean);

                        const elsewhere = new Set();
                        reservedByOther.forEach((ids, otherStationId) => {
                          if (otherStationId === stationId) return;
                          ids.forEach((matchId) => elsewhere.add(matchId));
                        });

                        const availableForStation = availableMatches
                          .filter((match) => {
                            const matchId = sid(match?._id);
                            return (
                              matchId &&
                              !draft.queueMatchIds.includes(matchId) &&
                              !elsewhere.has(matchId) &&
                              liveCurrentMatchId !== matchId
                            );
                          })
                          .sort(compareSelectorMatches);

                        const selectorOptions = availableForStation.map(
                          (match) => {
                            const group = isGroupBracket(match);
                            const bracketKey =
                              sid(match?.bracket?._id) ||
                              `${text(match?.bracket?.name)}-${text(match?.bracket?.type)}`;
                            const poolKey = group
                              ? poolLabel(match) || "?"
                              : "all";
                            return {
                              ...match,
                              __groupKey: `${bracketKey}::${poolKey}`,
                              __bracketTitle: bracketTitle(match),
                              __poolTitle: group ? poolTitle(match) : "",
                              __poolSelectable: group,
                            };
                          },
                        );

                        const groupMetaByKey = selectorOptions.reduce(
                          (map, match) => {
                            const current = map.get(match.__groupKey) || {
                              key: match.__groupKey,
                              bracketTitle: match.__bracketTitle,
                              poolTitle: match.__poolTitle,
                              poolSelectable: match.__poolSelectable,
                              matchIds: [],
                            };
                            current.matchIds.push(sid(match?._id));
                            map.set(match.__groupKey, current);
                            return map;
                          },
                          new Map(),
                        );

                        const selectedPickerMatches = selectorOptions.filter(
                          (match) =>
                            draft.pickerMatchIds.includes(sid(match?._id)),
                        );

                        return (
                          <Paper
                            key={stationId}
                            variant="outlined"
                            sx={{
                              p: 1.75,
                              borderRadius: 2.5,
                              borderColor: station?.currentMatch
                                ? "warning.light"
                                : "divider",
                            }}
                          >
                            <Stack spacing={1.5}>
                              <Stack spacing={1.25}>
                                <Stack
                                  spacing={1}
                                  sx={{ minWidth: 0, flex: 1 }}
                                >
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    alignItems="center"
                                    flexWrap="wrap"
                                    useFlexGap
                                  >
                                    <StadiumIcon fontSize="small" />
                                    <Typography
                                      variant="subtitle1"
                                      fontWeight={800}
                                    >
                                      {station?.name}
                                    </Typography>
                                    <Chip
                                      size="small"
                                      label={stationStatusLabel(
                                        station?.status,
                                      )}
                                      sx={{
                                        ...(String(
                                          station?.status || "",
                                        ).toLowerCase() === "assigned"
                                          ? {
                                              bgcolor: "#9c27b0",
                                              color: "#fff",
                                            }
                                          : {}),
                                      }}
                                    />
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      label={station?.code || "—"}
                                    />
                                    <Tooltip
                                      title={
                                        assignmentMode === "queue"
                                          ? "Danh sách này là các trận trọng tài của sân có thể chủ động chọn để bắt. Trận hiện tại chỉ hiển thị khi một trận trong danh sách đang live trên sân."
                                          : "Hệ thống sẽ không tự gọi trận. Sân chờ admin bấm nút gán trận thủ công như cách hoạt động hiện tại."
                                      }
                                      placement="top"
                                      arrow
                                  >
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      label={
                                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                            <span>{modeLabel(assignmentMode)}</span>
                                            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                                          </Box>
                                        }
                                        sx={{ cursor: "help" }}
                                      />
                                    </Tooltip>
                                  </Stack>

                                  <Typography
                                    variant="caption"
                                    color={
                                      selectedRefereeLabel
                                        ? "info.main"
                                        : "text.secondary"
                                    }
                                    sx={{
                                      fontWeight: selectedRefereeLabel ? 700 : 500,
                                    }}
                                  >
                                    {selectedRefereeLabel
                                      ? `Trọng tài đứng sân: ${selectedRefereeLabel}`
                                      : "Chưa gán trọng tài đứng sân."}
                                  </Typography>

                                  {liveCurrentMatch ? (
                                    <Paper
                                      variant="outlined"
                                      sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        borderColor: "warning.light",
                                        bgcolor: (theme) =>
                                          theme.palette.mode === "dark"
                                            ? "rgba(255, 152, 0, 0.08)"
                                            : "warning.50",
                                      }}
                                    >
                                      <Stack spacing={1}>
                                        <Stack
                                          direction="row"
                                          spacing={1}
                                          justifyContent="space-between"
                                          alignItems="flex-start"
                                          flexWrap="wrap"
                                          useFlexGap
                                        >
                                          <Box sx={{ minWidth: 0, flex: 1 }}>
                                            <Typography
                                              variant="caption"
                                              color="text.secondary"
                                              sx={{ display: "block", mb: 0.35 }}
                                            >
                                              {liveCurrentMatch?.tournament?.name || "—"}
                                            </Typography>
                                              <Typography variant="h6" fontWeight={800}>
                                                {matchCode(liveCurrentMatch)}
                                              </Typography>
                                          </Box>
                                          <Chip size="small" color="warning" label="Đang live" sx={{ fontWeight: 600 }} />
                                        </Stack>
                                        <Typography variant="body1" color="text.primary" fontWeight={700} sx={{ wordBreak: "break-word" }}>
                                          {teamLine(liveCurrentMatch)}
                                        </Typography>
                                        {occupiedByAnotherTournament && (
                                          <Typography variant="caption" color="error.main" sx={{ mt: 0.25 }}>
                                            Sân này đang thuộc giải khác. Chỉ admin mới được can thiệp.
                                          </Typography>
                                        )}
                                      </Stack>
                                    </Paper>
                                  ) : (
                                    <Paper
                                      variant="outlined"
                                      sx={{
                                        p: 1.25,
                                        borderRadius: 2,
                                        borderStyle: "dashed",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        bgcolor: "action.hover"
                                      }}
                                    >
                                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                                        Chưa có trận nào đang live trên sân.
                                      </Typography>
                                    </Paper>
                                  )}
                                </Stack>

                                <Stack spacing={1}>
                                  <Stack
                                    direction={{ xs: "column", lg: "row" }}
                                    spacing={1}
                                    alignItems="stretch"
                                  >
                                  <TextField
                                    select
                                    size="small"
                                    label="Chế độ sân"
                                    disabled={clusterInteractionDisabled}
                                    SelectProps={{
                                      MenuProps: { sx: { zIndex: 1400 } },
                                    }}
                                    sx={{
                                      bgcolor: "background.paper",
                                      borderRadius: 1,
                                      minWidth: { lg: 280 },
                                      flex: { lg: "0 0 300px" },
                                    }}
                                    value={assignmentMode}
                                    onChange={(event) => {
                                      addBusinessBreadcrumb(
                                        "court_station.mode.change",
                                        {
                                          tournamentId,
                                          tournamentName: tournament?.name,
                                          courtStationId: stationId,
                                          assignmentMode:
                                            event.target.value || "manual",
                                        },
                                      );
                                      setDraft(stationId, {
                                        assignmentMode: event.target.value,
                                      });
                                    }}
                                  >
                                    <MenuItem value="manual">Gán tay</MenuItem>
                                    <MenuItem value="queue">
                                      Danh sách
                                    </MenuItem>
                                  </TextField>

                                  <Autocomplete
                                    componentsProps={{
                                      popper: { style: { zIndex: 1400 } },
                                    }}
                                    options={refereeOptions}
                                    value={selectedReferee}
                                    disabled={
                                      clusterInteractionDisabled ||
                                      loadingReferees
                                    }
                                    onChange={(_, value) =>
                                      setDraft(stationId, {
                                        defaultRefereeIds: value
                                          ? [getRefId(value)]
                                          : [],
                                      })
                                    }
                                    isOptionEqualToValue={(option, value) =>
                                      getRefId(option) === getRefId(value)
                                    }
                                    getOptionLabel={(option) =>
                                      refDisplayName(option)
                                    }
                                    noOptionsText={
                                      loadingReferees
                                        ? "Đang tải trọng tài..."
                                        : "Chưa có trọng tài trong giải"
                                    }
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        size="small"
                                        label="Trọng tài đứng sân"
                                        placeholder="Chọn trọng tài..."
                                        sx={{
                                          bgcolor: "background.paper",
                                          "& .MuiOutlinedInput-root": {
                                            borderRadius: 1,
                                          },
                                        }}
                                      />
                                    )}
                                    sx={{ flex: 1 }}
                                  />
                                  </Stack>

                                  <Stack
                                    direction={{ xs: "column", md: "row" }}
                                    spacing={1}
                                    justifyContent="flex-end"
                                  >
                                    {liveCurrentMatch && (
                                      <Button
                                        variant="outlined"
                                        color="warning"
                                        disabled={
                                          clusterInteractionDisabled ||
                                          freeing ||
                                          (!canOverride &&
                                            occupiedByAnotherTournament)
                                        }
                                        onClick={() => freeCurrent(stationId)}
                                      >
                                        {assignmentMode === "queue"
                                          ? "Bỏ qua trận hiện tại"
                                          : "Giải phóng sân"}
                                      </Button>
                                    )}
                                    <Button
                                      variant="contained"
                                      disabled={
                                        clusterInteractionDisabled ||
                                        savingConfig ||
                                        !draft.dirty
                                      }
                                      onClick={() => saveStationConfig(station)}
                                    >
                                      Lưu cấu hình
                                    </Button>
                                  </Stack>
                                </Stack>
                              </Stack>

                              {assignmentMode === "queue" ? (
                                <Box
                                  sx={{
                                    p: 1.5,
                                    borderRadius: 2,
                                    bgcolor: "action.hover",
                                  }}
                                >
                                  <Stack spacing={1.25}>
                                    <Stack
                                      direction="row"
                                      spacing={1}
                                      flexWrap="wrap"
                                      useFlexGap
                                    >
                                      <Chip
                                        size="small"
                                        color="info"
                                        variant="outlined"
                                        label={`${queueMatches.length} trận trong danh sách`}
                                      />
                                      {isFetchingRuntime && (
                                        <Chip
                                          size="small"
                                          variant="outlined"
                                          label="Đang đồng bộ"
                                        />
                                      )}
                                    </Stack>

                                    <Autocomplete
                                      open={Boolean(
                                        queuePickerOpenByStation[stationId],
                                      )}
                                      componentsProps={{
                                        popper: { style: { zIndex: 1400 } },
                                      }}
                                      multiple
                                      disabled={clusterInteractionDisabled}
                                      disableCloseOnSelect
                                      onOpen={() =>
                                        setQueuePickerOpen(stationId, true)
                                      }
                                      onClose={() =>
                                        setQueuePickerOpen(stationId, false)
                                      }
                                      options={selectorOptions}
                                      value={selectedPickerMatches}
                                      onChange={(_, value) =>
                                        setDraft(
                                          stationId,
                                          {
                                            pickerMatchIds: value
                                              .map((match) => sid(match?._id))
                                              .filter(Boolean),
                                          },
                                          { markDirty: false },
                                        )
                                      }
                                      isOptionEqualToValue={(option, value) =>
                                        sid(option?._id) === sid(value?._id)
                                      }
                                      getOptionLabel={selectorLabel}
                                      groupBy={(option) => option.__groupKey}
                                      noOptionsText="Không còn trận phù hợp để thêm vào danh sách."
                                      renderTags={(value, getTagProps) =>
                                        value.map((option, index) => (
                                          <Chip
                                            {...getTagProps({ index })}
                                            key={sid(option?._id)}
                                            size="small"
                                            label={matchCode(option)}
                                          />
                                        ))
                                      }
                                      renderInput={(params) => (
                                        <TextField
                                          {...params}
                                          size="small"
                                          placeholder="Tìm và thêm trận vào danh sách sân..."
                                          sx={{ bgcolor: "background.paper", "& .MuiOutlinedInput-root": { borderRadius: 1.5 } }}
                                        />
                                      )}
                                      renderOption={(
                                        props,
                                        option,
                                        { selected },
                                      ) => (
                                        <Box component="li" {...props}>
                                          <Checkbox
                                            checked={selected}
                                            sx={{ mr: 1 }}
                                          />
                                          <Box sx={{ minWidth: 0 }}>
                                            <Typography
                                              variant="caption"
                                              color="text.secondary"
                                            >
                                              {tournamentTitle(option)}
                                            </Typography>
                                            <Typography
                                              variant="body2"
                                              fontWeight={700}
                                            >
                                              {matchCode(option)}
                                            </Typography>
                                            <Typography
                                              variant="body2"
                                              color="text.secondary"
                                              sx={{ wordBreak: "break-word" }}
                                            >
                                              {teamLine(option)}
                                            </Typography>
                                          </Box>
                                        </Box>
                                      )}
                                      renderGroup={(params) => {
                                        const groupMeta = groupMetaByKey.get(
                                          params.group,
                                        );
                                        const groupIds =
                                          groupMeta?.matchIds || [];
                                        const selectedIds =
                                          draft.pickerMatchIds || [];
                                        const allSelected =
                                          groupIds.length > 0 &&
                                          groupIds.every((matchId) =>
                                            selectedIds.includes(matchId),
                                          );
                                        const partiallySelected =
                                          !allSelected &&
                                          groupIds.some((matchId) =>
                                            selectedIds.includes(matchId),
                                          );

                                        return (
                                          <li key={params.key}>
                                            <Box
                                              sx={{
                                                px: 1.5,
                                                py: 1,
                                                bgcolor: "background.default",
                                                borderTop: "1px solid",
                                                borderColor: "divider",
                                              }}
                                            >
                                              <Stack spacing={0.5}>
                                                <Stack
                                                  direction="row"
                                                  alignItems="center"
                                                  spacing={1}
                                                >
                                                  <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{
                                                      textTransform:
                                                        "uppercase",
                                                    }}
                                                  >
                                                    {groupMeta?.bracketTitle ||
                                                      "Bracket"}
                                                  </Typography>
                                                  {groupMeta?.bracketTitle && (
                                                    <Button
                                                      size="small"
                                                      onMouseDown={(event) =>
                                                        event.preventDefault()
                                                      }
                                                      onClick={() => {
                                                        const bracketKey =
                                                          params.group.split(
                                                            "::",
                                                          )[0];
                                                        const bracketMatchIds =
                                                          selectorOptions
                                                            .filter((m) =>
                                                              m.__groupKey.startsWith(
                                                                bracketKey +
                                                                  "::",
                                                              ),
                                                            )
                                                            .map((m) =>
                                                              sid(m._id),
                                                            );
                                                        toggleGroupPicker(
                                                          stationId,
                                                          bracketMatchIds,
                                                        );
                                                      }}
                                                      startIcon={
                                                        <Checkbox
                                                          size="small"
                                                          checked={(() => {
                                                            const bracketKey =
                                                              params.group.split(
                                                                "::",
                                                              )[0];
                                                            const bracketMatchIds =
                                                              selectorOptions
                                                                .filter((m) =>
                                                                  m.__groupKey.startsWith(
                                                                    bracketKey +
                                                                      "::",
                                                                  ),
                                                                )
                                                                .map((m) =>
                                                                  sid(m._id),
                                                                );
                                                            return (
                                                              bracketMatchIds.length >
                                                                0 &&
                                                              bracketMatchIds.every(
                                                                (id) =>
                                                                  selectedIds.includes(
                                                                    id,
                                                                  ),
                                                              )
                                                            );
                                                          })()}
                                                          indeterminate={(() => {
                                                            const bracketKey =
                                                              params.group.split(
                                                                "::",
                                                              )[0];
                                                            const bracketMatchIds =
                                                              selectorOptions
                                                                .filter((m) =>
                                                                  m.__groupKey.startsWith(
                                                                    bracketKey +
                                                                      "::",
                                                                  ),
                                                                )
                                                                .map((m) =>
                                                                  sid(m._id),
                                                                );
                                                            const allSel =
                                                              bracketMatchIds.every(
                                                                (id) =>
                                                                  selectedIds.includes(
                                                                    id,
                                                                  ),
                                                              );
                                                            return (
                                                              !allSel &&
                                                              bracketMatchIds.some(
                                                                (id) =>
                                                                  selectedIds.includes(
                                                                    id,
                                                                  ),
                                                              )
                                                            );
                                                          })()}
                                                          sx={{ p: 0 }}
                                                        />
                                                      }
                                                      sx={{
                                                        fontSize: "0.65rem",
                                                        py: 0,
                                                        minHeight: 0,
                                                      }}
                                                    >
                                                      {(() => {
                                                        const bracketKey =
                                                          params.group.split(
                                                            "::",
                                                          )[0];
                                                        const bracketMatchIds =
                                                          selectorOptions
                                                            .filter((m) =>
                                                              m.__groupKey.startsWith(
                                                                bracketKey +
                                                                  "::",
                                                              ),
                                                            )
                                                            .map((m) =>
                                                              sid(m._id),
                                                            );
                                                        const allSel =
                                                          bracketMatchIds.length >
                                                            0 &&
                                                          bracketMatchIds.every(
                                                            (id) =>
                                                              selectedIds.includes(
                                                                id,
                                                              ),
                                                          );
                                                        return allSel
                                                          ? `Bỏ chọn ${groupMeta?.bracketTitle}`
                                                          : `Chọn hết vòng ${groupMeta?.bracketTitle}`;
                                                      })()}
                                                    </Button>
                                                  )}
                                                </Stack>
                                                <Stack
                                                  direction="row"
                                                  spacing={1}
                                                  alignItems="center"
                                                  justifyContent="space-between"
                                                  flexWrap="wrap"
                                                  useFlexGap
                                                >
                                                  <Typography
                                                    variant="body2"
                                                    fontWeight={700}
                                                  >
                                                    {groupMeta?.poolTitle ||
                                                      "Danh sách trận"}
                                                  </Typography>
                                                  {groupMeta?.poolSelectable && (
                                                    <Button
                                                      size="small"
                                                      onMouseDown={(event) =>
                                                        event.preventDefault()
                                                      }
                                                      onClick={() =>
                                                        toggleGroupPicker(
                                                          stationId,
                                                          groupIds,
                                                        )
                                                      }
                                                      startIcon={
                                                        <Checkbox
                                                          size="small"
                                                          checked={allSelected}
                                                          indeterminate={
                                                            partiallySelected
                                                          }
                                                          sx={{ p: 0 }}
                                                        />
                                                      }
                                                    >
                                                      {allSelected
                                                        ? `Bỏ chọn ${groupMeta.poolTitle}`
                                                        : `Chọn hết ${groupMeta.poolTitle}`}
                                                    </Button>
                                                  )}
                                                </Stack>
                                              </Stack>
                                            </Box>
                                            <Box
                                              component="ul"
                                              sx={{ p: 0, m: 0 }}
                                            >
                                              {params.children}
                                            </Box>
                                          </li>
                                        );
                                      }}
                                    />

                                    <Stack
                                      direction="row"
                                      spacing={1}
                                      justifyContent="space-between"
                                      alignItems="center"
                                      flexWrap="wrap"
                                      useFlexGap
                                    >
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                      >
                                        Chọn nhiều trận rồi bấm thêm một lần.
                                        Với vòng bảng, bạn có thể chọn nhanh cả
                                        Bảng A, B, C...
                                      </Typography>
                                      <Button
                                        variant="outlined"
                                        disabled={
                                          clusterInteractionDisabled ||
                                          !draft.pickerMatchIds.length
                                        }
                                        onClick={() =>
                                          addQueueMatches(stationId)
                                        }
                                      >
                                        {draft.pickerMatchIds.length
                                          ? `Thêm ${draft.pickerMatchIds.length} trận`
                                          : "Thêm"}
                                      </Button>
                                    </Stack>

                                    {!queueMatches.length ? (
                                      <Alert severity="info">
                                        Sân này chưa có danh sách trận.
                                      </Alert>
                                    ) : (
                                      <DndContext
                                        sensors={dndSensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={({ active, over }) => {
                                          if (clusterInteractionDisabled) return;
                                          if (
                                            !active?.id ||
                                            !over?.id ||
                                            active.id === over.id
                                          )
                                            return;
                                          addBusinessBreadcrumb(
                                            "court_station.queue.reorder",
                                            {
                                              tournamentId,
                                              tournamentName: tournament?.name,
                                              courtStationId: stationId,
                                              matchId: active.id,
                                              overMatchId: over.id,
                                            },
                                          );
                                          setDraft(
                                            stationId,
                                            (currentDraft) => {
                                              const oldIndex =
                                                currentDraft.queueMatchIds.indexOf(
                                                  active.id,
                                                );
                                              const newIndex =
                                                currentDraft.queueMatchIds.indexOf(
                                                  over.id,
                                                );
                                              if (oldIndex < 0 || newIndex < 0)
                                                return currentDraft;
                                              return {
                                                ...currentDraft,
                                                queueMatchIds: arrayMove(
                                                  currentDraft.queueMatchIds,
                                                  oldIndex,
                                                  newIndex,
                                                ),
                                                dirty: true,
                                              };
                                            },
                                          );
                                        }}
                                      >
                                        <SortableContext
                                          items={displayQueueMatchIds}
                                          strategy={verticalListSortingStrategy}
                                        >
                                          <Stack spacing={1}>
                                            {queueMatches.map(
                                              (match, index) => {
                                                const matchId = sid(match?._id);
                                                const canManageThisMatch =
                                                  !clusterInteractionDisabled &&
                                                  (canOverride ||
                                                    sid(
                                                      match?.tournament?._id ||
                                                        match?.tournamentId,
                                                    ) === tournamentId);
                                                return (
                                                  <SortableQueueItem
                                                    key={matchId}
                                                    id={matchId}
                                                  >
                                                    {({
                                                      attributes,
                                                      listeners,
                                                      isDragging,
                                                    }) => (
                                                      <Paper
                                                        variant="outlined"
                                                        onClick={() =>
                                                          openViewer(match)
                                                        }
                                                        sx={{
                                                          p: 1.25,
                                                          borderRadius: 2,
                                                          cursor: "pointer",
                                                          opacity: isDragging
                                                            ? 0.5
                                                            : 1,
                                                          transition:
                                                            "border-color 0.2s ease, box-shadow 0.2s ease",
                                                          "&:hover": {
                                                            borderColor:
                                                              "primary.main",
                                                            boxShadow: 1,
                                                          },
                                                        }}
                                                      >
                                                        <Stack spacing={0.75}>
                                                          <Stack
                                                            direction={{
                                                              xs: "column",
                                                              md: "row",
                                                            }}
                                                            spacing={1}
                                                            justifyContent="space-between"
                                                            alignItems={{
                                                              xs: "flex-start",
                                                              md: "center",
                                                            }}
                                                          >
                                                            <Stack
                                                              direction="row"
                                                              spacing={1}
                                                              alignItems="center"
                                                            >
                                                              {canManageThisMatch && (
                                                                <Box
                                                                  {...attributes}
                                                                  {...listeners}
                                                                  onClick={(
                                                                    event,
                                                                  ) =>
                                                                    event.stopPropagation()
                                                                  }
                                                                  sx={{
                                                                    display:
                                                                      "inline-flex",
                                                                    alignItems:
                                                                      "center",
                                                                    cursor:
                                                                      "grab",
                                                                    color:
                                                                      "text.secondary",
                                                                    "&:active": {
                                                                      cursor:
                                                                        "grabbing",
                                                                    },
                                                                  }}
                                                                >
                                                                  <DragIndicatorIcon fontSize="small" />
                                                                </Box>
                                                              )}
                                                              <Typography
                                                                variant="body2"
                                                                fontWeight={700}
                                                              >
                                                                <Typography
                                                                  component="span"
                                                                  variant="caption"
                                                                  color="text.secondary"
                                                                  sx={{
                                                                    display:
                                                                      "block",
                                                                  }}
                                                                >
                                                                  {tournamentTitle(
                                                                    match,
                                                                  )}
                                                                </Typography>
                                                                #{index + 1} ·{" "}
                                                                {matchCode(
                                                                  match,
                                                                )}
                                                              </Typography>
                                                            </Stack>
                                                            <Stack
                                                              direction="row"
                                                              spacing={1}
                                                              alignItems="center"
                                                            >
                                                              {canManageThisMatch && (
                                                                <IconButton
                                                                  size="small"
                                                                  color="error"
                                                                  onClick={(
                                                                    event,
                                                                  ) => {
                                                                    event.stopPropagation();
                                                                    removeQueueMatch(
                                                                      stationId,
                                                                      matchId,
                                                                    );
                                                                  }}
                                                                >
                                                                  <DeleteOutlineIcon fontSize="small" />
                                                                </IconButton>
                                                              )}
                                                            </Stack>
                                                          </Stack>
                                                          <Typography
                                                            variant="body2"
                                                            color="text.secondary"
                                                          >
                                                            {teamLine(match)}
                                                          </Typography>
                                                        </Stack>
                                                      </Paper>
                                                    )}
                                                  </SortableQueueItem>
                                                );
                                              },
                                            )}
                                          </Stack>
                                        </SortableContext>
                                      </DndContext>
                                    )}
                                  </Stack>
                                </Box>
                              ) : (
                                <Box
                                  sx={{
                                    p: 1.5,
                                    borderRadius: 2,
                                    bgcolor: "action.hover",
                                  }}
                                >
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label="Sân sẽ chờ người vận hành gán trận như hiện tại"
                                  />
                                </Box>
                              )}
                            </Stack>
                          </Paper>
                        );
                      })}
                    </Stack>
                  )}
                </Stack>
              </Paper>
            )}
          </Stack>
        </Box>

        <Box sx={{ display: "none", px: 3, py: 2 }}>
          <Button onClick={onClose}>Đóng</Button>
        </Box>
      </ResponsiveModal>

      <ResponsiveMatchViewer
        open={Boolean(viewerMatch)}
        matchId={sid(viewerMatch?._id)}
        initialMatch={viewerMatch}
        onClose={() => setViewerMatch(null)}
        zIndex={1400}
      />

      <Dialog
        open={sharedTournamentsOpen}
        onClose={() => setSharedTournamentsOpen(false)}
        maxWidth="sm"
        fullWidth
        sx={{ zIndex: 1400 }}
      >
        <DialogTitle sx={{ pr: 6 }}>
          Các giải dùng chung cụm sân này
          <IconButton
            onClick={() => setSharedTournamentsOpen(false)}
            sx={{ position: "absolute", right: 12, top: 10 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {sharedTournaments.length > 0 ? (
            <Stack spacing={1.5}>
              {sharedTournaments.map((t) => (
                <Paper
                  key={t._id || t.id}
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {t.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t.code ? `Mã: ${t.code}` : "Chưa có mã"}
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    component="a"
                    href={`/tournament/${t._id || t.id}`}
                    target="_blank"
                    sx={{ textTransform: "none", borderRadius: 2 }}
                  >
                    Xem giải
                  </Button>
                </Paper>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">
              Không có dữ liệu giải đấu dùng chung.
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

TournamentCourtClusterDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  tournament: PropTypes.object,
  canOverride: PropTypes.bool,
  onClose: PropTypes.func,
  onUpdated: PropTypes.func,
};

export default memo(TournamentCourtClusterDialog);
