import { io } from "socket.io-client";

// URL API của bạn (ví dụ từ .env)
const API_URL = import.meta.env.VITE_API_URL_SOCKET;

export const socket = io(API_URL, {
  path: "/socket.io", // khớp app.js
  withCredentials: true, // vì CORS dùng credentials
  autoConnect: false, // tự điều khiển connect
  transports: ["websocket"], // ưu tiên ws
  reconnection: true,
});
