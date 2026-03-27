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
  { subscribeEvent, unsubscribeEvent, payloadKey },
) {
  const desiredRef = useRef(new Set());
  const joinedRef = useRef(new Set());
  const normalizedIds = useMemo(() => normalizeIds(ids), [ids]);
  const idsKey = useMemo(() => normalizedIds.join("|"), [normalizedIds]);

  useEffect(() => {
    if (!socket || !subscribeEvent || !unsubscribeEvent || !payloadKey) return;

    const emitAll = (eventName, setLike) => {
      setLike.forEach((id) => socket.emit(eventName, { [payloadKey]: id }));
    };

    const onConnect = () => {
      emitAll(subscribeEvent, desiredRef.current);
      joinedRef.current = new Set(desiredRef.current);
    };
    const onDisconnect = () => {
      joinedRef.current = new Set();
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      if (socket.connected) {
        emitAll(unsubscribeEvent, joinedRef.current);
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

  return desiredRef;
}

export default useSocketRoomSet;
