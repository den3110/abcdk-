import { useEffect, useMemo, useRef } from "react";

const normalizeIds = (ids = []) =>
  Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  ).sort();

export function useSocketRoomSet(
  socket,
  ids,
  { subscribeEvent, unsubscribeEvent, payloadKey, onResync, resyncDebounceMs = 250 },
) {
  const desiredRef = useRef(new Set());
  const joinedRef = useRef(new Set());
  const onResyncRef = useRef(onResync);
  const resyncTimerRef = useRef(null);
  const pendingReasonRef = useRef("connect");
  const normalizedIds = useMemo(() => normalizeIds(ids), [ids]);
  const idsKey = useMemo(() => normalizedIds.join("|"), [normalizedIds]);

  useEffect(() => {
    onResyncRef.current = onResync;
  }, [onResync]);

  const scheduleResync = (reason) => {
    if (typeof onResyncRef.current !== "function") return;
    pendingReasonRef.current = reason;
    if (resyncTimerRef.current) return;
    resyncTimerRef.current = setTimeout(() => {
      resyncTimerRef.current = null;
      const currentIds = [...desiredRef.current];
      if (!currentIds.length) return;
      onResyncRef.current?.({
        reason: pendingReasonRef.current,
        ids: currentIds,
      });
    }, Math.max(0, Number(resyncDebounceMs) || 0));
  };

  useEffect(() => {
    if (!socket || !subscribeEvent || !unsubscribeEvent || !payloadKey) return;

    const emitAll = (eventName, setLike) => {
      setLike.forEach((id) => socket.emit(eventName, { [payloadKey]: id }));
    };

    const syncRooms = (reason = "connect") => {
      emitAll(subscribeEvent, desiredRef.current);
      joinedRef.current = new Set(desiredRef.current);
      if (reason !== "initial") {
        scheduleResync(reason);
      }
    };
    const onDisconnect = () => {
      joinedRef.current = new Set();
    };
    const onConnect = () => syncRooms("connect");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) syncRooms("initial");

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      if (socket.connected) {
        emitAll(unsubscribeEvent, joinedRef.current);
      }
      if (resyncTimerRef.current) {
        clearTimeout(resyncTimerRef.current);
        resyncTimerRef.current = null;
      }
      desiredRef.current = new Set();
      joinedRef.current = new Set();
    };
  }, [socket, subscribeEvent, unsubscribeEvent, payloadKey]);

  useEffect(() => {
    if (!socket || !subscribeEvent || !unsubscribeEvent || !payloadKey) return;

    const desired = new Set(idsKey ? idsKey.split("|") : []);
    desiredRef.current = desired;

    if (!socket.connected) {
      return;
    }

    const current = joinedRef.current;

    desired.forEach((id) => {
      if (!current.has(id)) {
        socket.emit(subscribeEvent, { [payloadKey]: id });
      }
    });
    current.forEach((id) => {
      if (!desired.has(id)) {
        socket.emit(unsubscribeEvent, { [payloadKey]: id });
      }
    });

    joinedRef.current = new Set(desired);
  }, [socket, idsKey, subscribeEvent, unsubscribeEvent, payloadKey]);

  useEffect(() => {
    if (
      !socket ||
      !subscribeEvent ||
      !unsubscribeEvent ||
      !payloadKey ||
      typeof window === "undefined"
    ) {
      return;
    }

    const reconnectOrResync = (reason) => {
      if (!desiredRef.current.size) return;
      if (socket.connected) {
        scheduleResync(reason);
        return;
      }
      if (!socket.auth?.token && !socket.active) return;
      try {
        socket.connect?.();
      } catch (error) {
        console.error("[useSocketRoomSet] reconnect error:", error);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconnectOrResync("visibility");
      }
    };
    const onOnline = () => reconnectOrResync("online");
    const onPageShow = () => reconnectOrResync("pageshow");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [socket, subscribeEvent, unsubscribeEvent, payloadKey]);

  return desiredRef;
}

export default useSocketRoomSet;
