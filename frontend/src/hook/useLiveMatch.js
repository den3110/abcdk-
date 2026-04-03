// src/hooks/useLiveMatch.js
import { useEffect, useMemo, useRef, useState } from "react";
import { useSocket } from "../context/SocketContext";

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getPayloadMatchId = (payload = {}) =>
  String(
    payload?.data?._id ??
      payload?.data?.id ??
      payload?.data?.matchId ??
      payload?.snapshot?._id ??
      payload?.snapshot?.id ??
      payload?.snapshot?.matchId ??
      payload?.match?._id ??
      payload?.match?.id ??
      payload?.match?.matchId ??
      payload?.payload?.matchId ??
      payload?._id ??
      payload?.id ??
      payload?.matchId ??
      payload?.match?._id ??
      payload?.match?.id ??
      "",
  );

const normalizeMatchPayload = (payload = {}) =>
  payload?.data ?? payload?.snapshot ?? payload?.match ?? payload ?? null;

const extractMatchPatch = (payload = {}) => {
  const source =
    payload?.payload ??
    payload?.data ??
    payload?.snapshot ??
    payload?.match ??
    payload ??
    {};

  if (!isPlainObject(source)) return {};

  const patch = {};

  if (typeof source.status === "string" && source.status.trim()) {
    patch.status = source.status.trim();
  }
  if ("winner" in source) {
    patch.winner = source.winner ?? "";
  }
  if (Array.isArray(source.gameScores)) {
    patch.gameScores = source.gameScores;
  } else if (Array.isArray(source.scores)) {
    patch.gameScores = source.scores;
  }
  if ("currentGame" in source) {
    patch.currentGame = source.currentGame;
  }
  if (isPlainObject(source.serve)) {
    patch.serve = source.serve;
  }
  if (isPlainObject(source.rules)) {
    patch.rules = source.rules;
  }
  if (source.pairA) {
    patch.pairA = source.pairA;
  }
  if (source.pairB) {
    patch.pairB = source.pairB;
  }
  if ("startedAt" in source) {
    patch.startedAt = source.startedAt ?? null;
  }
  if ("finishedAt" in source) {
    patch.finishedAt = source.finishedAt ?? null;
  }
  if ("assignedAt" in source) {
    patch.assignedAt = source.assignedAt ?? null;
  }
  if ("liveVersion" in source) {
    patch.liveVersion = source.liveVersion;
  }
  if ("version" in source) {
    patch.version = source.version;
  }
  if ("isBreak" in source) {
    patch.isBreak = source.isBreak;
  }
  if (Array.isArray(source.streams)) {
    patch.streams = source.streams;
  }
  if (typeof source.video === "string" && source.video.trim()) {
    patch.video = source.video.trim();
  }
  if (typeof source.videoUrl === "string" && source.videoUrl.trim()) {
    patch.videoUrl = source.videoUrl.trim();
  }
  if (
    typeof source.defaultStreamKey === "string" &&
    source.defaultStreamKey.trim()
  ) {
    patch.defaultStreamKey = source.defaultStreamKey.trim();
  }

  return patch;
};

const mergeMatchState = (current, payload = {}, fallbackMatchId = "") => {
  const incoming = normalizeMatchPayload(payload);
  const patch = extractMatchPatch(payload);
  const hasPatch = Object.keys(patch).length > 0;
  const incomingLooksLikeMatch =
    isPlainObject(incoming) &&
    ("_id" in incoming ||
      "id" in incoming ||
      "status" in incoming ||
      "gameScores" in incoming ||
      "pairA" in incoming ||
      "pairB" in incoming ||
      "rules" in incoming);

  if (!current) {
    if (incomingLooksLikeMatch) return incoming;
    if (!hasPatch) return null;
    return {
      _id: getPayloadMatchId(payload) || fallbackMatchId || undefined,
      ...patch,
    };
  }

  const prevVersion = Number(current?.liveVersion ?? current?.version ?? -1);
  const incomingVersion = Number(
    incoming?.liveVersion ??
      incoming?.version ??
      patch?.liveVersion ??
      patch?.version ??
      -1,
  );

  let next = current;
  if (
    incomingLooksLikeMatch &&
    !(
      incomingVersion >= 0 &&
      prevVersion >= 0 &&
      incomingVersion < prevVersion &&
      !hasPatch
    )
  ) {
    next = { ...current, ...incoming };
  }

  if (!hasPatch) return next;

  next = {
    ...next,
    ...patch,
    ...(isPlainObject(patch.rules)
      ? {
          rules: {
            ...(isPlainObject(next.rules) ? next.rules : {}),
            ...patch.rules,
          },
        }
      : {}),
    ...(isPlainObject(patch.serve)
      ? {
          serve: {
            ...(isPlainObject(next.serve) ? next.serve : {}),
            ...patch.serve,
          },
        }
      : {}),
  };

  return next;
};

/**
 * Realtime match state over Socket.IO
 * - Kết nối dùng singleton từ SocketContext (không tạo socket mới)
 * - Tự join/leave phòng `match:<matchId>`
 * - Nhận `match:snapshot` (full) và `match:update` (diff hoặc full)
 * - So sánh version để tránh ghi đè state cũ lên mới
 */
export function useLiveMatch(matchId, token) {
  const socket = useSocket();
  const [state, setState] = useState({ loading: true, data: null });
  const mountedRef = useRef(false);

  // reset khi đổi trận
  useEffect(() => {
    setState({ loading: Boolean(matchId), data: null });
  }, [matchId]);

  // Nếu có token truyền vào và socket chưa connect, gán vào auth rồi connect (optional)
  useEffect(() => {
    if (!socket) return;
    if (token && !socket.connected && !socket.active) {
      // cập nhật token cho lần connect kế tiếp
      socket.auth = { ...(socket.auth || {}), token };
      socket.connect();
    }
  }, [socket, token]);

  useEffect(() => {
    if (!socket || !matchId) return;
    mountedRef.current = true;

    const isForThisMatch = (payload) => {
      const incomingId = getPayloadMatchId(payload);
      return Boolean(incomingId) && incomingId === String(matchId);
    };

    const onLiveEvent = (payload) => {
      if (!mountedRef.current || !isForThisMatch(payload)) return;
      setState((prev) => ({
        loading: false,
        data: mergeMatchState(prev.data, payload, String(matchId)),
      }));
    };

    // Join phòng và lắng nghe sự kiện
    socket.emit("match:join", { matchId });
    [
      "match:snapshot",
      "match:update",
      "score:updated",
      "score:patched",
      "score:added",
      "score:undone",
      "score:reset",
      "match:patched",
      "match:started",
      "match:finished",
      "match:forfeited",
      "status:updated",
      "winner:updated",
      "video:set",
      "stream:updated",
      "match:teamsUpdated",
    ].forEach((eventName) => socket.on(eventName, onLiveEvent));

    // Optionally xin snapshot ngay (nếu server hỗ trợ)

    return () => {
      mountedRef.current = false;
      socket.emit("match:leave", { matchId });
      [
        "match:snapshot",
        "match:update",
        "score:updated",
        "score:patched",
        "score:added",
        "score:undone",
        "score:reset",
        "match:patched",
        "match:started",
        "match:finished",
        "match:forfeited",
        "status:updated",
        "winner:updated",
        "video:set",
        "stream:updated",
        "match:teamsUpdated",
      ].forEach((eventName) => socket.off(eventName, onLiveEvent));
    };
  }, [socket, matchId]);

  // API điều khiển cho trọng tài (emit các event)
  const api = useMemo(() => {
    return {
      start: (refereeId) => socket?.emit("match:start", { matchId, refereeId }),
      pointA: (step = 1) =>
        socket?.emit("match:point", { matchId, team: "A", step }),
      pointB: (step = 1) =>
        socket?.emit("match:point", { matchId, team: "B", step }),
      undo: () => socket?.emit("match:undo", { matchId }),
      finish: (winner) => socket?.emit("match:finish", { matchId, winner }),
      forfeit: (winner, reason = "forfeit") =>
        socket?.emit("match:forfeit", { matchId, winner, reason }),
      // tuỳ chọn: đổi luật giữa chừng
      setRules: (rules) => socket?.emit("match:rules", { matchId, rules }),
      // tuỳ chọn: set court / scheduledAt
      assignCourt: (courtId) =>
        socket?.emit("match:court", { matchId, courtId }),
      scheduleAt: (datetimeISO) =>
        socket?.emit("match:schedule", { matchId, scheduledAt: datetimeISO }),
    };
  }, [socket, matchId]);

  return { ...state, api };
}
