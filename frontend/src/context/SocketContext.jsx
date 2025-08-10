import { createContext, useContext, useEffect } from "react";
import { socket } from "../lib/socket";

const SocketContext = createContext(socket);

export function SocketProvider({ children }) {
  useEffect(() => {
    if (!socket.connected) socket.connect();
    return () => {
      // Nếu muốn giữ kết nối xuyên app, có thể KHÔNG disconnect ở đây
      // socket.disconnect();
    };
  }, []);
  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
