// rtmpRelay.server.js
import http from "http";
import dotenv from "dotenv";
import { attachRtmpRelayPro } from "./services/rtmpRelay.js";
import express from "express";
import { createServer } from "http";
import { setupStreamDashboard } from "./rtmp-service/streamDashboard.js";
dotenv.config();

const PORT = process.env.RTMP_PORT || 5002;

const app = express();
const server = createServer(app);

// ✅ Start RTMP relay
const wss = await attachRtmpRelayPro(server, { path: "/ws/rtmp" });

// ✅ Setup monitoring dashboard
setupStreamDashboard(app, wss);

// ✅ Static dashboard HTML (optional)
app.get("/dashboard", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Stream Dashboard</title>
      <script>
        setInterval(async () => {
          const res = await fetch('/api/streams/stats');
          const data = await res.json();
          document.getElementById('stats').innerText = JSON.stringify(data, null, 2);
        }, 2000);
      </script>
    </head>
    <body>
      <h1>🎥 Live Stream Dashboard</h1>
      <pre id="stats">Loading...</pre>
    </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log("🚀 Server running on port" + PORT);
  console.log("📊 Dashboard: http://localhost:" + PORT +"/dashboard");
});
