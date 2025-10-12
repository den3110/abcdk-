// rtmpRelay.server.js
import http from "http";
import dotenv from "dotenv";
import { attachRtmpRelay } from "./services/rtmpRelay.js";

dotenv.config();

const PORT = process.env.RTMP_PORT || 5002;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("RTMP Relay WS server. Use WebSocket at /ws/rtmp\n");
});

// Gắn WebSocket thuần cho relay
attachRtmpRelay(server, { path: "/ws/rtmp" });

server.listen(PORT, () => {
  console.log(`✅ RTMP Relay listening on :${PORT} (ws path /ws/rtmp)`);
});
