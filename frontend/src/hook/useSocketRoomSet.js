import { useEffect, useMemo, useRef } from "react";

const normalizeIds = (ids = []) =>
  Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  ).sort();

export function useSocketRoomSet(
  socket,
  ids,
  { subscribeEvent, unsubscribeEvent, payloadKey }
) {
  const subscribedRef = useRef(new Set());
  const normalizedIds = useMemo(() => normalizeIds(ids), [ids]);
  const idsKey = useMemo(() => normalizedIds.join("|"), [normalizedIds]);

  useEffect(() => {
    if (!socket || !subscribeEvent || !unsubscribeEvent || !payloadKey) return;

    const emitAll = (eventName, setLike) => {
      setLike.forEach((id) => socket.emit(eventName, { [payloadKey]: id }));
    };

    const onConnect = () => emitAll(subscribeEvent, subscribedRef.current);
    socket.on("connect", onConnect);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      emitAll(unsubscribeEvent, subscribedRef.current);
      subscribedRef.current = new Set();
    };
  }, [socket, subscribeEvent, unsubscribeEvent, payloadKey]);

  useEffect(() => {
    if (!socket || !subscribeEvent || !unsubscribeEvent || !payloadKey) return;

    const current = subscribedRef.current;
    const next = new Set(idsKey ? idsKey.split("|") : []);

    next.forEach((id) => {
      if (!current.has(id)) {
        socket.emit(subscribeEvent, { [payloadKey]: id });
      }
    });
    current.forEach((id) => {
      if (!next.has(id)) {
        socket.emit(unsubscribeEvent, { [payloadKey]: id });
      }
    });

    subscribedRef.current = next;
  }, [socket, idsKey, subscribeEvent, unsubscribeEvent, payloadKey]);

  return subscribedRef;
}

export default useSocketRoomSet;
