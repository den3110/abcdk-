// src/hooks/useLiveMatch.js
import { useEffect, useMemo, useRef, useState } from "react";
import { useSocket } from "../context/SocketContext";

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

    const onSnapshot = (payload) => {
      if (!mountedRef.current) return;
      setState({ loading: false, data: payload });
    };

    const onUpdate = (evt) => {
      if (!mountedRef.current) return;
      setState((prev) => {
        // evt có thể là { data, patch } tuỳ server. Ở đây ưu tiên evt.data + version
        const incoming = evt?.data ?? evt;
        if (!prev.data) return { loading: false, data: incoming };
        const vIn = incoming?.version ?? 0;
        const vCur = prev.data?.version ?? 0;
        // chỉ nhận khi version mới hơn hoặc bằng (bằng để đồng bộ khi refetch server phát lại)
        if (vIn >= vCur) return { loading: false, data: incoming };
        return prev;
      });
    };

    // Join phòng và lắng nghe sự kiện
    socket.emit("match:join", { matchId });
    socket.on("match:snapshot", onSnapshot);
    socket.on("match:update", onUpdate);

    // Optionally xin snapshot ngay (nếu server hỗ trợ)
    socket.emit?.("match:snapshot:request", { matchId });

    return () => {
      mountedRef.current = false;
      socket.emit("match:leave", { matchId });
      socket.off("match:snapshot", onSnapshot);
      socket.off("match:update", onUpdate);
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
