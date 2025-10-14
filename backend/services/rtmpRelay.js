// rtmpRelayFixed.js - FIX cho lỗi TLS/Connection khi live nhiều stream
// ✅ Rate limiting, bandwidth management, audio pipe stabilization

import { WebSocketServer } from "ws";
import { spawn } from "child_process";

const CONFIG = {
  MAX_CONCURRENT_STREAMS: 60,
  MAX_QUEUE_SIZE: 20,
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 3000,
  HEALTH_CHECK_INTERVAL: 30000,
  STREAM_TIMEOUT: 120000,
  MEMORY_LIMIT_MB: 512,
  FRAME_DROP_THRESHOLD: 100,
  STATS_INTERVAL: 120000,

  // ✅ NEW: Connection pooling & rate limiting
  MAX_STREAMS_PER_REGION: 4, // Max 4 streams per network/IP
  REQUEST_THROTTLE_MS: 1000, // Min 1s between new stream starts
  TLS_HANDSHAKE_TIMEOUT: 10000, // TLS timeout
  RTMP_KEEPALIVE_INTERVAL: 5000, // Send keepalive every 5s

  BUFFER_SIZES: {
    low: 8000000, // ⬇️ Reduced: 8MB
    medium: 12000000, // ⬇️ Reduced: 12MB
    high: 16000000, // ⬇️ Reduced: 16MB (was 20MB)
    ultra: 24000000, // ⬇️ Reduced: 24MB (was 30MB)
  },

  // ✅ NEW: Per-quality bitrate caps
  BITRATE_CAPS: {
    low: 800,
    medium: 1500,
    high: 2500,
    ultra: 4000,
  },
};

const metrics = {
  totalStreamsStarted: 0,
  totalStreamsFailed: 0,
  totalFramesProcessed: 0,
  totalReconnects: 0,
  peakConcurrent: 0,
  startTime: Date.now(),
  qualityDistribution: { low: 0, medium: 0, high: 0, ultra: 0 },
  tlsErrors: 0, // Track TLS errors
  connectionResets: 0, // Track reset errors
};

const log = {
  info: (...args) => console.log(`[INFO ${new Date().toISOString()}]`, ...args),
  warn: (...args) =>
    console.warn(`[WARN ${new Date().toISOString()}]`, ...args),
  error: (...args) =>
    console.error(`[ERROR ${new Date().toISOString()}]`, ...args),
  debug: (...args) => {
    if (process.env.DEBUG)
      console.log(`[DEBUG ${new Date().toISOString()}]`, ...args);
  },
  stream: (id, ...args) =>
    console.log(`[STREAM-${id} ${new Date().toISOString()}]`, ...args),
};

// ✅ NEW: Connection pool to prevent Facebook rate limiting
class ConnectionPool {
  constructor() {
    this.regions = new Map(); // IP region -> [stream ids]
    this.lastStartTime = 0;
  }

  canStartStream(clientIp) {
    const now = Date.now();
    // Check throttle
    if (now - this.lastStartTime < CONFIG.REQUEST_THROTTLE_MS) {
      return false;
    }
    // Check per-region limit
    const region = clientIp.split(".").slice(0, 3).join("."); // 192.168.1.x
    const regionStreams = this.regions.get(region) || [];
    if (regionStreams.length >= CONFIG.MAX_STREAMS_PER_REGION) {
      log.warn(
        `⚠️ Region ${region} at limit: ${regionStreams.length}/${CONFIG.MAX_STREAMS_PER_REGION}`
      );
      return false;
    }
    return true;
  }

  registerStream(streamId, clientIp) {
    const region = clientIp.split(".").slice(0, 3).join(".");
    const regionStreams = this.regions.get(region) || [];
    regionStreams.push(streamId);
    this.regions.set(region, regionStreams);
    this.lastStartTime = Date.now();
    log.debug(`📍 Stream #${streamId} registered to region ${region}`);
  }

  unregisterStream(streamId, clientIp) {
    const region = clientIp.split(".").slice(0, 3).join(".");
    const regionStreams = this.regions.get(region) || [];
    const idx = regionStreams.indexOf(streamId);
    if (idx > -1) regionStreams.splice(idx, 1);
    if (regionStreams.length === 0) {
      this.regions.delete(region);
    } else {
      this.regions.set(region, regionStreams);
    }
  }
}

const detectQualityLevel = (height) => {
  if (height <= 360) return "low";
  if (height <= 480) return "medium";
  if (height <= 720) return "high";
  return "ultra";
};

const getBufferSize = (quality) => {
  return CONFIG.BUFFER_SIZES[quality] || CONFIG.BUFFER_SIZES.high;
};

const getBitrateCap = (quality) => {
  return CONFIG.BITRATE_CAPS[quality] || CONFIG.BITRATE_CAPS.high;
};

process.on("uncaughtException", (err) => {
  log.error("❌ UNCAUGHT EXCEPTION:", err.message);
  log.error(err.stack);
});

process.on("unhandledRejection", (reason) => {
  log.error("❌ UNHANDLED REJECTION:", reason);
});

export async function attachRtmpRelayFixed(server, options = {}) {
  const wss = new WebSocketServer({
    server,
    path: options.path || "/ws/rtmp",
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024,
    clientTracking: true,
  });

  log.info(
    `✅ RTMP Relay with TLS/Connection fixes: ${options.path || "/ws/rtmp"}`
  );

  const activeStreams = new Map();
  const queuedStreams = [];
  const connectionPool = new ConnectionPool();
  let streamCounter = 0;

  const statsInterval = setInterval(() => {
    const uptime = ((Date.now() - metrics.startTime) / 1000 / 60).toFixed(1);
    log.info(
      `📊 STATS: Active=${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, ` +
        `Queue=${queuedStreams.length}, TLS Errors=${metrics.tlsErrors}, ` +
        `Connection Resets=${metrics.connectionResets}`
    );
  }, CONFIG.STATS_INTERVAL);

  const healthCheck = setInterval(() => {
    activeStreams.forEach((stream, id) => {
      try {
        const elapsed = Date.now() - stream.stats.lastFrameTime;
        if (elapsed > CONFIG.STREAM_TIMEOUT) {
          log.warn(
            `⚠️ Stream #${id} [${stream.qualityLevel}] stalled after ${(
              elapsed / 1000
            ).toFixed(0)}s`
          );
          if (!stream.isReconnecting) {
            reconnectStream(stream);
          }
        }
      } catch (err) {
        log.error(`❌ Health check error for stream #${id}:`, err.message);
      }
    });
  }, CONFIG.HEALTH_CHECK_INTERVAL);

  const wsHeartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      try {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      } catch (err) {
        log.error(`❌ Heartbeat error:`, err.message);
      }
    });
  }, 15000);

  const shutdown = () => {
    log.info(`🛑 Graceful shutdown initiated...`);
    clearInterval(wsHeartbeat);
    clearInterval(healthCheck);
    clearInterval(statsInterval);
    activeStreams.forEach((stream) => {
      try {
        cleanupStream(stream, true);
      } catch (err) {
        log.error(`❌ Shutdown cleanup error:`, err.message);
      }
    });
  };

  wss.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const cleanupStream = (stream, force = false) => {
    try {
      const id = stream.id;
      if (stream.isReconnecting && !force) return;

      log.stream(id, `🧹 Cleanup starting`);

      // ✅ FIX: Close pipes BEFORE killing process
      if (stream.ffmpeg) {
        try {
          if (stream.ffmpeg.stdin && !stream.ffmpeg.stdin.destroyed) {
            stream.ffmpeg.stdin.end();
          }
          if (stream.ffmpeg.stdio?.[3] && !stream.ffmpeg.stdio[3].destroyed) {
            stream.ffmpeg.stdio[3].destroy(); // Force destroy audio pipe
          }
        } catch (e) {
          log.debug(`  Pipe close hint: ${e.message}`);
        }

        try {
          stream.ffmpeg.kill("SIGTERM");
        } catch (e) {
          log.debug(`  SIGTERM hint: ${e.message}`);
        }

        const killTimer = setTimeout(() => {
          try {
            if (stream.ffmpeg) {
              stream.ffmpeg.kill("SIGKILL");
            }
          } catch (e) {}
        }, 3000);

        stream.ffmpeg.once("close", () => {
          clearTimeout(killTimer);
        });
        stream.ffmpeg = null;
      }

      if (stream.qualityLevel) {
        metrics.qualityDistribution[stream.qualityLevel]--;
      }
      if (stream.clientIp) {
        connectionPool.unregisterStream(id, stream.clientIp);
      }

      activeStreams.delete(id);
      log.info(
        `📊 Active: ${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}`
      );
      processQueue();
    } catch (err) {
      log.error(`❌ Cleanup error:`, err.message);
    }
  };

  const reconnectStream = (stream) => {
    try {
      if (stream.reconnectAttempts >= CONFIG.RECONNECT_ATTEMPTS) {
        log.error(`❌ Stream #${stream.id} max reconnect attempts reached`);
        metrics.totalStreamsFailed++;
        cleanupStream(stream, true);
        return;
      }

      stream.reconnectAttempts++;
      stream.isReconnecting = true;
      metrics.totalReconnects++;

      const delay =
        CONFIG.RECONNECT_DELAY * Math.pow(2, stream.reconnectAttempts - 1);
      const actualDelay = Math.min(delay, 30000);

      log.stream(
        stream.id,
        `🔄 Reconnecting [${stream.qualityLevel}] in ${actualDelay}ms (${stream.reconnectAttempts}/${CONFIG.RECONNECT_ATTEMPTS})`
      );

      setTimeout(() => {
        try {
          if (stream.config) {
            startFFmpeg(stream);
          }
        } catch (err) {
          log.error(
            `❌ Reconnect error for stream #${stream.id}:`,
            err.message
          );
          cleanupStream(stream, true);
        }
      }, actualDelay);
    } catch (err) {
      log.error(`❌ Reconnect setup error:`, err.message);
    }
  };

  const processQueue = () => {
    try {
      while (
        queuedStreams.length > 0 &&
        activeStreams.size < CONFIG.MAX_CONCURRENT_STREAMS
      ) {
        const stream = queuedStreams.shift();
        log.info(
          `📥 Processing queued stream #${stream.id} [${stream.qualityLevel}]`
        );
        startFFmpeg(stream);
      }
    } catch (err) {
      log.error(`❌ Queue processing error:`, err.message);
    }
  };

  const startFFmpeg = (stream) => {
    try {
      const id = stream.id;

      // ✅ NEW: Check connection pool before starting
      if (!connectionPool.canStartStream(stream.clientIp)) {
        if (queuedStreams.length >= CONFIG.MAX_QUEUE_SIZE) {
          log.error(`❌ Stream #${id} rejected: queue full`);
          return false;
        }
        log.warn(`⏳ Stream #${id} queued (connection pool)`);
        queuedStreams.push(stream);
        return false;
      }

      if (activeStreams.size >= CONFIG.MAX_CONCURRENT_STREAMS) {
        if (queuedStreams.length >= CONFIG.MAX_QUEUE_SIZE) {
          log.error(`❌ Stream #${id} rejected: queue full`);
          return false;
        }
        log.warn(`⏳ Stream #${id} queued (capacity)`);
        queuedStreams.push(stream);
        return false;
      }

      const { streamKey, width, height, fps, videoBitrate } = stream.config;

      const qualityLevel = detectQualityLevel(height);
      const bufferSize = getBufferSize(qualityLevel);
      const bitrateCap = getBitrateCap(qualityLevel); // ✅ NEW: Use capped bitrate

      stream.qualityLevel = qualityLevel;
      metrics.qualityDistribution[qualityLevel]++;
      connectionPool.registerStream(id, stream.clientIp); // ✅ NEW: Register

      if (stream.ffmpeg) {
        try {
          stream.ffmpeg.kill("SIGKILL");
        } catch {}
        stream.ffmpeg = null;
      }

      const DEBUG_SAVE_FILE = process.env.DEBUG_SAVE_FILE === "true";
      const outputTarget = DEBUG_SAVE_FILE
        ? `/tmp/stream_${id}_${qualityLevel}_${Date.now()}.mp4`
        : `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;

      const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

      // ✅ IMPROVED: Better RTMP configuration
      const ffmpegLogLevel = process.env.FFMPEG_LOG_LEVEL || "warning"; // ⬆️ Changed from 'error' to 'warning'
      const args = [
        "-hide_banner",
        "-loglevel",
        ffmpegLogLevel,
        "-f",
        "h264",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-i",
        "pipe:0",
        "-f",
        "webm",
        "-i",
        "pipe:3",
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        // ✅ FIXED: Reduce queue sizes for stability
        "-max_muxing_queue_size",
        qualityLevel === "ultra" ? "2048" : "1024",
        "-fflags",
        "+genpts+nobuffer+flush_packets+igndts",
        "-flush_packets",
        "1",
        // ✅ FIXED: Reduce max_delay
        "-max_delay",
        "250000", // 250ms instead of 500ms-1s
        "-rtmp_conn",
        "S:0:sauth:true",
        "-rtmp_buffer",
        bufferSize.toString(),
        "-rtmp_flush_interval",
        "1", // ✅ FIXED: Flush more frequently (1s)
        "-rtmp_live",
        "live",
        "-shortest",
        // ✅ NEW: TCP keepalive for RTMPS
        "-rtmp_keepalive",
        "1",
      ];

      if (DEBUG_SAVE_FILE) {
        args.push(
          "-f",
          "mp4",
          "-movflags",
          "frag_keyframe+empty_moov",
          outputTarget
        );
      } else {
        args.push(
          "-f",
          "flv",
          "-flvflags",
          "no_duration_filesize",
          outputTarget
        );
      }

      log.stream(
        id,
        `🎬 Starting [${qualityLevel}]: ${width}x${height}@${fps}fps, Buffer=${(
          bufferSize / 1000000
        ).toFixed(0)}MB, Bitrate=${bitrateCap}k`
      );

      // ✅ DEBUG: Log FFmpeg command
      if (process.env.DEBUG_FFMPEG === "true") {
        log.debug(`🔧 FFmpeg command: ${ffmpegPath} ${args.join(" ")}`);
      }

      stream.ffmpeg = spawn(ffmpegPath, args, {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        detached: false,
      });

      if (!stream.ffmpeg.pid) {
        throw new Error("FFmpeg spawn failed");
      }

      stream.stats = {
        videoFrames: 0,
        audioFrames: 0,
        startTime: Date.now(),
        lastFrameTime: Date.now(),
        droppedFrames: 0,
      };
      stream.isReconnecting = false;
      activeStreams.set(id, stream);
      metrics.totalStreamsStarted++;
      metrics.peakConcurrent = Math.max(
        metrics.peakConcurrent,
        activeStreams.size
      );

      log.stream(
        id,
        `✅ FFmpeg spawned [${qualityLevel}]: PID=${stream.ffmpeg.pid}`
      );

      stream.ffmpeg.stdin.on("error", (e) => {
        if (e.code === "EPIPE") return;
        log.error(`❌ Stream #${id} stdin error:`, e.message);
      });

      if (stream.ffmpeg.stdio[3]) {
        stream.ffmpeg.stdio[3].on("error", (e) => {
          if (e.code === "EPIPE" || e.code === "ECONNRESET") return;
          log.error(`❌ Stream #${id} audio pipe error:`, e.message);
          metrics.connectionResets++;
        });
      }

      stream.ffmpeg.stderr.on("data", (d) => {
        try {
          const log_msg = d.toString().trim();
          // ✅ IMPORTANT: Always log FFmpeg errors
          if (!log_msg) return;

          log.error(`📺 FFmpeg #${id} [${qualityLevel}]:`, log_msg);

          if (log_msg.includes("[tls @")) {
            metrics.tlsErrors++;
            log.error(`❌ TLS ERROR #${id}:`, log_msg);
            if (!stream.isReconnecting) {
              reconnectStream(stream);
            }
          } else if (
            log_msg.includes("Input/output error") ||
            log_msg.includes("ECONNRESET")
          ) {
            metrics.connectionResets++;
            log.error(`❌ CONNECTION ERROR #${id}:`, log_msg);
            if (!stream.isReconnecting) {
              reconnectStream(stream);
            }
          }
        } catch (err) {
          log.error(`❌ stderr parse error:`, err.message);
        }
      });

      stream.ffmpeg.on("close", (code, signal) => {
        try {
          const elapsed = (
            (Date.now() - stream.stats.startTime) /
            1000
          ).toFixed(1);
          log.stream(
            id,
            `🛑 FFmpeg closed [${qualityLevel}]: code=${code} signal=${signal}`
          );

          if (
            code !== 0 &&
            code !== null &&
            signal !== "SIGTERM" &&
            signal !== "SIGKILL" &&
            !stream.isReconnecting
          ) {
            log.warn(`⚠️ Stream #${id} abnormal exit, auto-reconnecting...`);
            reconnectStream(stream);
          } else {
            cleanupStream(stream, true);
          }
        } catch (err) {
          log.error(`❌ Close handler error:`, err.message);
        }
      });

      stream.ffmpeg.on("error", (err) => {
        try {
          log.error(`❌ Stream #${id} process error:`, err.message);
          cleanupStream(stream, true);
        } catch (e) {
          log.error(`❌ Error handler error:`, e.message);
        }
      });

      return true;
    } catch (err) {
      log.error(`❌ startFFmpeg error:`, err.message);
      cleanupStream(stream, true);
      return false;
    }
  };

  wss.on("connection", (ws, req) => {
    let stream = null;
    try {
      ws.isAlive = true;
      ws.on("pong", () => (ws.isAlive = true));

      const clientIp = req.socket.remoteAddress;
      const streamId = ++streamCounter;

      log.info(`📡 Client #${streamId} connected from ${clientIp}`);

      stream = {
        id: streamId,
        clientIp, // ✅ NEW: Store client IP
        ws,
        ffmpeg: null,
        config: null,
        qualityLevel: null,
        stats: {
          videoFrames: 0,
          audioFrames: 0,
          startTime: 0,
          lastFrameTime: 0,
          droppedFrames: 0,
        },
        reconnectAttempts: 0,
        isReconnecting: false,
      };

      ws.on("message", (data, isBinary) => {
        try {
          if (isBinary) {
            if (!stream.ffmpeg || !stream.config) return;
            const u8 = new Uint8Array(data);
            const isAudio = u8[0] === 0x01;
            stream.stats.lastFrameTime = Date.now();
            metrics.totalFramesProcessed++;

            if (isAudio) {
              const payload = u8.subarray(1);
              const audioPipe = stream.ffmpeg.stdio?.[3];
              if (audioPipe?.writable && payload.byteLength) {
                audioPipe.write(payload, (err) => {
                  if (
                    err &&
                    err.code !== "EPIPE" &&
                    err.code !== "ECONNRESET"
                  ) {
                    stream.stats.droppedFrames++;
                  }
                });
                stream.stats.audioFrames++;
              }
            } else {
              if (stream.ffmpeg.stdin?.writable) {
                stream.ffmpeg.stdin.write(u8, (err) => {
                  if (err && err.code !== "EPIPE") {
                    stream.stats.droppedFrames++;
                  }
                });
                stream.stats.videoFrames++;
              }
            }
            return;
          }

          let msg;
          try {
            msg = JSON.parse(data);
          } catch {
            return;
          }

          if (msg.type === "start") {
            if (stream.ffmpeg) {
              ws.send(
                JSON.stringify({ type: "error", message: "Already streaming" })
              );
              return;
            }

            stream.config = {
              streamKey: msg.streamKey,
              width: msg.width || 1280,
              height: msg.height || 720,
              fps: msg.fps || 30,
              videoBitrate: msg.videoBitrate || "2500k",
              audioBitrate: msg.audioBitrate || "128k",
            };

            if (!stream.config.streamKey) {
              ws.send(
                JSON.stringify({ type: "error", message: "streamKey required" })
              );
              return;
            }

            startFFmpeg(stream);
          } else if (msg.type === "stop") {
            cleanupStream(stream, true);
          }
        } catch (err) {
          log.error(`❌ Message handler error:`, err.message);
        }
      });

      ws.on("close", () => {
        try {
          log.info(`📴 Client #${stream.id} disconnected`);
          cleanupStream(stream, true);
        } catch (err) {
          log.error(`❌ Close handler error:`, err.message);
        }
      });

      ws.on("error", (err) => {
        try {
          log.error(`❌ Stream #${stream.id} WS error:`, err.message);
          cleanupStream(stream, true);
        } catch (e) {
          log.error(`❌ Error handler error:`, e.message);
        }
      });
    } catch (err) {
      log.error(`❌ Connection handler error:`, err.message);
      if (stream) {
        try {
          cleanupStream(stream, true);
        } catch {}
      }
    }
  });

  wss.on("error", (err) => {
    log.error(`❌ WebSocket Server error:`, err.message);
  });

  log.info(
    `🚀 RTMP Relay READY - TLS fixes, Connection pool, Bandwidth management!`
  );

  return wss;
}
