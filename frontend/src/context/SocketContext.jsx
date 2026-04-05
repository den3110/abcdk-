/* eslint-disable react/prop-types */
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useSelector } from "react-redux";
import { socket } from "../lib/socket";
import { getDeviceIdentity } from "../utils/deviceIdentity";

const SocketContext = createContext(socket);

function detectClientType() {
  try {
    if (typeof window === "undefined") return "web";
    const pathname = String(window.location.pathname || "").toLowerCase();
    if (pathname.startsWith("/admin")) return "admin";
    if (pathname.includes("/referee") || pathname.includes("/tf")) {
      return "referee";
    }
    return "web";
  } catch {
    return "web";
  }
}

function isAnonymousDrawLivePath() {
  try {
    if (typeof window === "undefined") return false;
    return /^\/tournament\/[^/]+\/draw\/live\/?$/i.test(
      window.location.pathname || "",
    );
  } catch {
    return false;
  }
}

export function SocketProvider({ children }) {
  const { userInfo } = useSelector((state) => state.auth || {});
  const token = userInfo?.token;
  const clientType = useMemo(detectClientType, []);
  const allowAnonymousConnect = useMemo(isAnonymousDrawLivePath, []);
  const heartbeatRef = useRef(null);

  useEffect(() => {
    try {
      const { deviceId, deviceName } = getDeviceIdentity();
      const nextAuth = { ...(socket.auth || {}) };
      if (token) nextAuth.token = token;
      else delete nextAuth.token;
      if (deviceId) nextAuth.deviceId = deviceId;
      else delete nextAuth.deviceId;
      if (deviceName) nextAuth.deviceName = deviceName;
      else delete nextAuth.deviceName;
      socket.auth = nextAuth;
      socket.io.opts.query = {
        ...(socket.io.opts.query || {}),
        client: clientType,
      };
    } catch (error) {
      console.error("[SocketProvider] set opts error:", error);
    }

    if (!token && !allowAnonymousConnect) {
      return;
    }

    try {
      if (!socket.connected) socket.connect();
    } catch (error) {
      console.error("[SocketProvider] connect error:", error);
    }

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [token, clientType, allowAnonymousConnect]);

  useEffect(() => {
    const onConnect = () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        try {
          socket.emit("presence:ping");
        } catch (error) {
          console.log(error);
        }
      }, 10000);
    };

    const onDisconnect = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };

    const onConnectError = (error) =>
      console.error("[socket] connect_error:", error?.message || error);
    const onError = (error) =>
      console.error("[socket] error:", error?.message || error);

    try {
      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("error", onError);
      socket.io.on("connect_error", onConnectError);
      socket.io.on("reconnect_error", onError);
    } catch (error) {
      console.error("[SocketProvider] bind listeners error:", error);
    }

    return () => {
      try {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("error", onError);
        socket.io.off("connect_error", onConnectError);
        socket.io.off("reconnect_error", onError);
      } catch (error) {
        console.log(error);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const reconnectIfNeeded = () => {
      if (!token && !allowAnonymousConnect) return;
      if (socket.connected) return;
      try {
        socket.connect();
      } catch (error) {
        console.error("[SocketProvider] reconnect error:", error);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconnectIfNeeded();
      }
    };

    const onOnline = () => reconnectIfNeeded();
    const onPageShow = () => reconnectIfNeeded();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [token, allowAnonymousConnect]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (context && typeof context.emit !== "function" && context?.socket) {
    return context.socket;
  }
  return context || socket;
};
