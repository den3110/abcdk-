// src/hooks/useLiveMatch.js
import { useEffect, useMemo, useRef, useState } from "react";
import { useSocket } from "../context/SocketContext";
import {
  extractMatchPayload,
  extractMatchPatchPayload,
  getMatchPayloadId,
  isLightweightMatchPayload,
  isNewerOrEqualMatchPayload,
  mergeMatchPayload,
  normalizeMatchDisplay,
} from "../utils/matchDisplay";
import { useRefereeLiveSyncMatch } from "./useRefereeLiveSyncMatch";

/**
 * Realtime match state over Socket.IO
 * - Uses the singleton socket from SocketContext
 * - Auto join/leave `match:<matchId>`
 * - Accepts `match:snapshot`, `match:update`, `score:updated`
 * - Lightweight payloads only trigger snapshot refresh; they never replace identity
 */
function useStandardLiveMatch(matchId, token, enabled = true) {
  const socket = useSocket();
  const [state, setState] = useState({ loading: true, data: null });
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, data: null });
      return;
    }
    setState({ loading: Boolean(matchId), data: null });
  }, [enabled, matchId]);

  useEffect(() => {
    if (!enabled) return;
    if (!socket) return;
    if (token && !socket.connected && !socket.active) {
      socket.auth = { ...(socket.auth || {}), token };
      socket.connect();
    }
  }, [enabled, socket, token]);

  useEffect(() => {
    if (!enabled) return;
    if (!socket || !matchId) return;
    mountedRef.current = true;

    const requestSnapshot = () =>
      socket.emit?.("match:snapshot:request", { matchId });
    const joinMatchRoom = () => socket.emit?.("match:join", { matchId });

    const isForThisMatch = (payload) => {
      const got = getMatchPayloadId(payload);
      return Boolean(got) && String(got) === String(matchId);
    };

    const applyIncoming = (payload, { allowLightweight = false } = {}) => {
      if (!mountedRef.current) return;
      if (!isForThisMatch(payload)) return;
      const extracted = extractMatchPayload(payload);
      const incoming = normalizeMatchDisplay(extracted);
      if (!incoming) return;
      if (!allowLightweight && isLightweightMatchPayload(payload)) {
        requestSnapshot();
        return;
      }

      setState((prev) => {
        const next = prev.data
          ? mergeMatchPayload(prev.data, incoming, prev.data)
          : incoming;

        if (!next) return prev;
        if (prev.data && !isNewerOrEqualMatchPayload(prev.data, next)) {
          return prev;
        }
        return { loading: false, data: next };
      });
    };

    const reconnectOrRefresh = ({ rejoin = false } = {}) => {
      if (!mountedRef.current) return;
      if (!socket.connected) {
        if (!token && !socket.auth?.token && !socket.active) return;
        try {
          socket.connect?.();
        } catch (error) {
          console.error("[useLiveMatch] reconnect error:", error);
        }
        return;
      }
      if (rejoin) {
        joinMatchRoom();
        return;
      }
      requestSnapshot();
    };

    const onSnapshot = (payload) =>
      applyIncoming(payload, { allowLightweight: true });
    const onUpdate = (payload) => applyIncoming(payload);
    const onScoreUpdated = (payload) => applyIncoming(payload);
    const onPatched = (payload) => {
      if (!mountedRef.current) return;
      if (!isForThisMatch(payload)) return;
      const patch = extractMatchPatchPayload(payload);
      if (!patch) return;

      setState((prev) => {
        const next = prev.data
          ? mergeMatchPayload(prev.data, patch, prev.data)
          : normalizeMatchDisplay(patch);
        if (!next) return prev;
        return { loading: false, data: next };
      });
    };

    const onConnect = () => reconnectOrRefresh({ rejoin: true });
    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        reconnectOrRefresh();
      }
    };
    const onOnline = () => reconnectOrRefresh();
    const onPageShow = () => reconnectOrRefresh();

    joinMatchRoom();
    socket.on("connect", onConnect);
    socket.on("match:snapshot", onSnapshot);
    socket.on("match:update", onUpdate);
    socket.on("score:updated", onScoreUpdated);
    socket.on("score:patched", onPatched);
    socket.on("score:added", onScoreUpdated);
    socket.on("score:undone", onScoreUpdated);
    socket.on("score:reset", onScoreUpdated);
    socket.on("match:patched", onPatched);
    socket.on("match:started", onUpdate);
    socket.on("match:finished", onUpdate);
    socket.on("match:forfeited", onUpdate);
    socket.on("status:updated", onUpdate);
    socket.on("winner:updated", onUpdate);
    socket.on("video:set", onPatched);
    socket.on("stream:updated", onPatched);
    socket.on("match:teamsUpdated", onPatched);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      window.addEventListener("pageshow", onPageShow);
    }

    return () => {
      mountedRef.current = false;
      socket.emit("match:leave", { matchId });
      socket.off("connect", onConnect);
      socket.off("match:snapshot", onSnapshot);
      socket.off("match:update", onUpdate);
      socket.off("score:updated", onScoreUpdated);
      socket.off("score:patched", onPatched);
      socket.off("score:added", onScoreUpdated);
      socket.off("score:undone", onScoreUpdated);
      socket.off("score:reset", onScoreUpdated);
      socket.off("match:patched", onPatched);
      socket.off("match:started", onUpdate);
      socket.off("match:finished", onUpdate);
      socket.off("match:forfeited", onUpdate);
      socket.off("status:updated", onUpdate);
      socket.off("winner:updated", onUpdate);
      socket.off("video:set", onPatched);
      socket.off("stream:updated", onPatched);
      socket.off("match:teamsUpdated", onPatched);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("pageshow", onPageShow);
      }
    };
  }, [enabled, socket, matchId, token]);

  const api = useMemo(
    () => ({
      start: (refereeId) => socket?.emit("match:start", { matchId, refereeId }),
      pointA: (step = 1) =>
        socket?.emit("match:point", { matchId, team: "A", step }),
      pointB: (step = 1) =>
        socket?.emit("match:point", { matchId, team: "B", step }),
      setServe: ({
        side,
        server,
        serverId = null,
        opening = undefined,
        userMatch = false,
      } = {}) =>
        socket?.emit("serve:set", {
          matchId,
          side,
          server,
          serverId,
          opening,
          userMatch,
        }),
      setSlotsBase: ({ base, layout = null, serve = null, userMatch = false } = {}) => {
        socket?.emit("slots:setBase", { matchId, base, layout, userMatch });
        if (serve) {
          socket?.emit("serve:set", {
            matchId,
            side: serve.side,
            server: serve.server,
            serverId: serve.serverId,
            opening: serve.opening,
            userMatch,
          });
        }
      },
      undo: () => socket?.emit("match:undo", { matchId }),
      finish: (winner) => socket?.emit("match:finish", { matchId, winner }),
      forfeit: (winner, reason = "forfeit") =>
        socket?.emit("match:forfeit", { matchId, winner, reason }),
      setRules: (rules) => socket?.emit("match:rules", { matchId, rules }),
      assignCourt: (courtId) =>
        socket?.emit("match:court", { matchId, courtId }),
      scheduleAt: (datetimeISO) =>
        socket?.emit("match:schedule", { matchId, scheduledAt: datetimeISO }),
    }),
    [socket, matchId],
  );

  return { ...state, api };
}

export function useLiveMatch(matchId, token, options = {}) {
  const offlineSync = Boolean(options?.offlineSync);
  const standard = useStandardLiveMatch(matchId, token, !offlineSync);
  const refereeSync = useRefereeLiveSyncMatch(matchId, token, {
    enabled: offlineSync,
    ...options,
  });
  return offlineSync ? refereeSync : standard;
}
