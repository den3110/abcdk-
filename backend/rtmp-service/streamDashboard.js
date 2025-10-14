// streamDashboard.js - Real-time monitoring dashboard
// Thêm vào Express server của bạn

export function setupStreamDashboard(app, wss) {
  // 📊 GET /api/streams/stats - Overview stats
  app.get("/api/streams/stats", (req, res) => {
    try {
      const activeStreams = Array.from(wss.clients)
        .filter((ws) => ws.streamId && ws.ffmpegPid)
        .map((ws) => {
          const elapsed = (Date.now() - ws.startTime) / 1000;
          const fps = elapsed > 0 ? (ws.videoFrames / elapsed).toFixed(1) : 0;

          return {
            id: ws.streamId,
            pid: ws.ffmpegPid,
            uptime: elapsed.toFixed(0),
            videoFrames: ws.videoFrames || 0,
            audioFrames: ws.audioFrames || 0,
            fps: parseFloat(fps),
            reconnects: ws.reconnectAttempts || 0,
            status: ws.isReconnecting ? "reconnecting" : "active",
            resolution: `${ws.width}x${ws.height}`,
            lastFrame: ws.lastFrameTime
              ? Math.floor((Date.now() - ws.lastFrameTime) / 1000)
              : 0,
          };
        });

      const stats = {
        timestamp: new Date().toISOString(),
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
        },
        streams: {
          active: activeStreams.length,
          max: 60,
          utilization: ((activeStreams.length / 60) * 100).toFixed(1) + "%",
          list: activeStreams,
        },
        metrics: {
          totalFrames: activeStreams.reduce((sum, s) => sum + s.videoFrames, 0),
          avgFps:
            activeStreams.length > 0
              ? (
                  activeStreams.reduce((sum, s) => sum + s.fps, 0) /
                  activeStreams.length
                ).toFixed(1)
              : 0,
          totalReconnects: activeStreams.reduce(
            (sum, s) => sum + s.reconnects,
            0
          ),
        },
      };

      res.json(stats);
    } catch (err) {
      console.error("❌ Stats endpoint error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 📊 GET /api/streams/:id - Individual stream details
  app.get("/api/streams/:id", (req, res) => {
    try {
      const streamId = parseInt(req.params.id);
      const ws = Array.from(wss.clients).find((w) => w.streamId === streamId);

      if (!ws) {
        return res.status(404).json({ error: "Stream not found" });
      }

      const elapsed = (Date.now() - ws.startTime) / 1000;
      const fps = elapsed > 0 ? (ws.videoFrames / elapsed).toFixed(1) : 0;

      res.json({
        id: streamId,
        pid: ws.ffmpegPid,
        uptime: elapsed.toFixed(0),
        videoFrames: ws.videoFrames || 0,
        audioFrames: ws.audioFrames || 0,
        fps: parseFloat(fps),
        reconnects: ws.reconnectAttempts || 0,
        status: ws.isReconnecting ? "reconnecting" : "active",
        config: {
          width: ws.width,
          height: ws.height,
          fps: ws.targetFps,
          bitrate: ws.videoBitrate,
        },
        lastFrameAgo: ws.lastFrameTime
          ? Math.floor((Date.now() - ws.lastFrameTime) / 1000)
          : null,
      });
    } catch (err) {
      console.error("❌ Stream detail error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 🛑 POST /api/streams/:id/stop - Force stop stream
  app.post("/api/streams/:id/stop", (req, res) => {
    try {
      const streamId = parseInt(req.params.id);
      const ws = Array.from(wss.clients).find((w) => w.streamId === streamId);

      if (!ws) {
        return res.status(404).json({ error: "Stream not found" });
      }

      console.log(`🛑 Force stopping stream #${streamId} via API`);
      ws.close();

      res.json({
        success: true,
        message: `Stream ${streamId} stopped`,
      });
    } catch (err) {
      console.error("❌ Force stop error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 🔥 POST /api/streams/stop-all - Emergency stop all
  app.post("/api/streams/stop-all", (req, res) => {
    try {
      console.log(`🔥 EMERGENCY: Stopping all streams via API`);
      let count = 0;

      wss.clients.forEach((ws) => {
        try {
          ws.close();
          count++;
        } catch (err) {
          console.error("Failed to close stream:", err);
        }
      });

      res.json({
        success: true,
        stopped: count,
        message: `Stopped ${count} streams`,
      });
    } catch (err) {
      console.error("❌ Stop all error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // 📊 GET /api/health - Server health check
  app.get("/api/health", (req, res) => {
    const uptime = process.uptime();
    const mem = process.memoryUsage();

    res.json({
      status: "ok",
      uptime: uptime.toFixed(0),
      memory: {
        used: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
        total: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
        external: Math.round(mem.external / 1024 / 1024) + "MB",
      },
      streams: {
        active: wss.clients.size,
        max: 60,
      },
      timestamp: new Date().toISOString(),
    });
  });

  console.log("✅ Stream dashboard endpoints registered:");
  console.log("   GET  /api/streams/stats");
  console.log("   GET  /api/streams/:id");
  console.log("   POST /api/streams/:id/stop");
  console.log("   POST /api/streams/stop-all");
  console.log("   GET  /api/health");
}
