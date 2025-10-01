import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useSelector } from "react-redux";
import { socket } from "../lib/socket";

// ⚠️ GIỮ BACK-COMPAT: context chứa trực tiếp instance socket
const SocketContext = createContext(socket);

/** Suy luận loại client (admin/referee/web) */
function detectClientType() {
  try {
    if (typeof window === "undefined") return "web";
    const p = window.location.pathname.toLowerCase();
    if (p.startsWith("/admin")) return "admin";
    if (p.includes("/referee") || p.includes("/tf")) return "referee";
    return "web";
  } catch {
    return "web";
  }
}

export function SocketProvider({ children }) {
  const { userInfo } = useSelector((s) => s.auth || {});
  const token = userInfo?.token;
  const clientType = useMemo(detectClientType, []);
  const heartbeatRef = useRef(null);

  // Kết nối khi có token (tránh Unauthorized)
  useEffect(() => {
    // inject opts TRƯỚC khi connect
    try {
      socket.auth = { ...(socket.auth || {}), token };
      socket.io.opts.query = {
        ...(socket.io.opts.query || {}),
        client: clientType,
      };

      // Cho phép polling + websocket để an toàn qua proxy
      // Nếu muốn ép websocket: socket.io.opts.transports = ["websocket"];
    } catch (e) {
      console.error("[SocketProvider] set opts error:", e);
    }

    if (!token) {
      // Không connect nếu chưa có token (server đang yêu cầu JWT)
      return;
    }

    try {
      if (!socket.connected) socket.connect();
    } catch (e) {
      console.error("[SocketProvider] connect error:", e);
    }

    return () => {
      // Giữ kết nối xuyên app: không disconnect ở đây
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [token, clientType]);

  // Heartbeat + listeners
  useEffect(() => {
    const onConnect = () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        try {
          socket.emit("presence:ping");
        } catch (e) {
          console.log(e);
        }
      }, 10000);
    };
    const onDisconnect = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
    const onConnectError = (err) =>
      console.error("[socket] connect_error:", err?.message || err);
    const onError = (err) =>
      console.error("[socket] error:", err?.message || err);

    try {
      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("error", onError);
      socket.io.on("connect_error", onConnectError);
      socket.io.on("reconnect_error", onError);
    } catch (e) {
      console.error("[SocketProvider] bind listeners error:", e);
    }

    return () => {
      try {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("error", onError);
        socket.io.off("connect_error", onConnectError);
        socket.io.off("reconnect_error", onError);
      } catch (e) {
        console.log(e);
      }
    };
  }, []);

  // GIỮ NGUYÊN value = socket để code cũ vẫn dùng được
  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

/** BACK-COMPAT: trả trực tiếp instance socket (giống code cũ) */
export const useSocket = () => {
  const ctx = useContext(SocketContext);
  // nếu ai đó đã lỡ cung cấp {socket} thì vẫn cố gắng lấy ra
  if (ctx && typeof ctx.emit !== "function" && ctx?.socket) return ctx.socket;
  return ctx || socket;
};
