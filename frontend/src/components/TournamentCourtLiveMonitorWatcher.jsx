// components/TournamentCourtLiveMonitorWatcher.jsx
// Watcher headless (không render UI) chạy nền trong TournamentManagePage.
// Đảm nhiệm nhiệm vụ: poll endpoint monitor + subscribe socket + emit toast
// mỗi khi 1 máy live crash — không cần user mở modal "Quản lý live sân" mới thấy.
//
// Dialog TournamentCourtLiveMonitorDialog vẫn dùng riêng query của mình để hiển
// thị chi tiết + refresh nhanh hơn (10s). RTK Query dedupe theo (endpoint, args)
// nên khi cả 2 cùng chạy chỉ có 1 request thật.
import { useCallback, useEffect, useMemo, useRef } from "react";
import PropTypes from "prop-types";

import { useSocket } from "../context/SocketContext";
import { useSocketRoomSet } from "../hook/useSocketRoomSet";
import { useCourtLiveCrashToasts } from "../hook/useCourtLiveCrashToasts";
import { useGetTournamentCourtLiveMonitorQuery } from "../slices/courtClustersAdminApiSlice";

const REFRESH_DEBOUNCE_MS = 250;
const BACKGROUND_POLL_MS = 20_000;

const sid = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

export default function TournamentCourtLiveMonitorWatcher({
  tournamentId,
  enabled = true,
}) {
  const socket = useSocket();
  const refreshTimerRef = useRef(null);

  const { data, refetch } = useGetTournamentCourtLiveMonitorQuery(
    { tournamentId },
    {
      skip: !enabled || !tournamentId,
      pollingInterval: enabled ? BACKGROUND_POLL_MS : 0,
      refetchOnReconnect: true,
    },
  );

  const stations = useMemo(
    () => (Array.isArray(data?.stations) ? data.stations : []),
    [data?.stations],
  );

  const stationIds = useMemo(
    () => stations.map((s) => sid(s?._id)).filter(Boolean),
    [stations],
  );
  const stationIdSet = useMemo(() => new Set(stationIds), [stationIds]);
  const clusterIdSet = useMemo(
    () =>
      new Set(
        stations
          .map((s) => sid(s?.clusterId || s?.cluster?._id))
          .filter(Boolean),
      ),
    [stations],
  );

  const requestRefresh = useCallback(() => {
    if (!enabled || typeof refetch !== "function") return;
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      refetch();
    }, REFRESH_DEBOUNCE_MS);
  }, [enabled, refetch]);

  useSocketRoomSet(socket, enabled ? stationIds : [], {
    subscribeEvent: "court-station:watch",
    unsubscribeEvent: "court-station:unwatch",
    payloadKey: "stationId",
    onResync: requestRefresh,
  });

  useEffect(() => {
    if (!socket || !enabled) return undefined;
    const handleStation = (payload) => {
      const id = sid(payload?._id || payload?.station?._id || payload?.courtStationId);
      if (!id || stationIdSet.has(id)) requestRefresh();
    };
    const handleCluster = (payload) => {
      const id = sid(payload?.cluster?._id || payload?.clusterId);
      if (!id || clusterIdSet.has(id)) requestRefresh();
    };
    socket.on("court-station:update", handleStation);
    socket.on("court-cluster:update", handleCluster);
    return () => {
      socket.off("court-station:update", handleStation);
      socket.off("court-cluster:update", handleCluster);
    };
  }, [clusterIdSet, enabled, requestRefresh, socket, stationIdSet]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useCourtLiveCrashToasts({
    stations,
    enabled,
    toastIdPrefix: "court-live-lost",
  });

  return null;
}

TournamentCourtLiveMonitorWatcher.propTypes = {
  tournamentId: PropTypes.string.isRequired,
  enabled: PropTypes.bool,
};
