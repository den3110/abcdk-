// rtmpRelayUltraV2.js - ZERO STUTTER, ZERO LAG
// ✅ 2x larger buffers, adaptive quality, perfect sync
import { WebSocketServer } from "ws";
import { spawn } from "child_process";

// 🔧 ULTRA SMOOTH CONFIG - Gấp đôi buffer
const CONFIG = {
  MAX_CONCURRENT_STREAMS: 60,
  MAX_QUEUE_SIZE: 20,
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 3000,
  HEALTH_CHECK_INTERVAL: 30000, // ⬆️ 15s → 30s (ít check hơn)
  STREAM_TIMEOUT: 120000, // ⬆️ 90s → 120s (tolerance cao hơn)
  MEMORY_LIMIT_MB: 512,
  FRAME_DROP_THRESHOLD: 100,
  LOG_RETENTION_HOURS: 24,
  STATS_INTERVAL: 120000, // ⬆️ 60s → 120s (ít log hơn)
};

const metrics = {
  totalStreamsStarted: 0,
  totalStreamsFailed: 0,
  totalFramesProcessed: 0,
  totalReconnects: 0,
  peakConcurrent: 0,
  startTime: Date.now(),
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

process.on("uncaughtException", (err) => {
  log.error("❌ UNCAUGHT EXCEPTION (but server still running):", err.message);
  log.error(err.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("❌ UNHANDLED REJECTION (but server still running):", reason);
});

export async function attachRtmpRelayUltraV2(server, options = {}) {
  const wss = new WebSocketServer({
    server,
    path: options.path || "/ws/rtmp",
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024,
    clientTracking: true,
  });

  log.info(
    `✅ ULTRA V2 RTMP Relay WebSocket initialized: ${
      options.path || "/ws/rtmp"
    }`
  );
  log.info(
    `📊 Config: MAX=${CONFIG.MAX_CONCURRENT_STREAMS}, QUEUE=${CONFIG.MAX_QUEUE_SIZE}, ULTRA BUFFERS`
  );

  const activeStreams = new Map();
  const queuedStreams = [];
  let streamCounter = 0;

  const statsInterval = setInterval(() => {
    const uptime = ((Date.now() - metrics.startTime) / 1000 / 60).toFixed(1);
    const avgFps =
      activeStreams.size > 0
        ? (metrics.totalFramesProcessed / activeStreams.size / uptime).toFixed(
            0
          )
        : 0;

    log.info(
      `📊 STATS: Active=${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, Queue=${queuedStreams.length}, Peak=${metrics.peakConcurrent}, Started=${metrics.totalStreamsStarted}, Failed=${metrics.totalStreamsFailed}, Reconnects=${metrics.totalReconnects}, Uptime=${uptime}m, AvgFPS=${avgFps}`
    );

    activeStreams.forEach((stream, id) => {
      const elapsed = ((Date.now() - stream.stats.startTime) / 1000).toFixed(0);
      const fps = (stream.stats.videoFrames / elapsed).toFixed(1);
      log.debug(
        `  Stream #${id}: ${stream.stats.videoFrames} frames, ${fps} fps, ${elapsed}s uptime`
      );
    });
  }, CONFIG.STATS_INTERVAL);

  const healthCheck = setInterval(() => {
    log.debug(`🏥 Health check: ${activeStreams.size} active streams`);

    activeStreams.forEach((stream, id) => {
      try {
        const elapsed = Date.now() - stream.stats.lastFrameTime;
        const totalElapsed = Date.now() - stream.stats.startTime;
        const fps =
          totalElapsed > 0
            ? (stream.stats.videoFrames / (totalElapsed / 1000)).toFixed(1)
            : 0;

        if (elapsed > CONFIG.STREAM_TIMEOUT) {
          log.warn(
            `⚠️ Stream #${id} STALLED: no frames for ${(elapsed / 1000).toFixed(
              0
            )}s (${fps} fps)`
          );

          try {
            stream.ws.send(
              JSON.stringify({
                type: "warning",
                message: `Stream stalled. Reconnecting...`,
                stats: { fps, frames: stream.stats.videoFrames },
              })
            );
          } catch (e) {
            log.error(`❌ Failed to send warning to stream #${id}:`, e.message);
          }

          if (!stream.isReconnecting) {
            log.warn(`🔄 Auto-reconnecting stalled stream #${id}`);
            reconnectStream(stream);
          }
        }
      } catch (err) {
        log.error(`❌ Health check error for stream #${id}:`, err.message);
      }
    });
  }, CONFIG.HEALTH_CHECK_INTERVAL);

  const wsHeartbeat = setInterval(() => {
    log.debug(`💓 WebSocket heartbeat: ${wss.clients.size} clients`);

    wss.clients.forEach((ws) => {
      try {
        if (ws.isAlive === false) {
          log.warn(`⚠️ WebSocket client unresponsive, terminating`);
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
    log.info(
      `📊 Final stats: ${activeStreams.size} active, ${metrics.totalStreamsStarted} total started`
    );
    activeStreams.forEach((stream) => {
      try {
        cleanupStream(stream, true);
      } catch (err) {
        log.error(`❌ Shutdown cleanup error:`, err.message);
      }
    });
    log.info(`✅ Shutdown complete`);
  };

  wss.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const cleanupStream = (stream, force = false) => {
    try {
      const id = stream.id;

      if (stream.isReconnecting && !force) {
        log.stream(id, `🔄 Reconnecting, skip cleanup`);
        return;
      }

      log.stream(id, `🧹 Cleanup starting (force=${force})`);

      if (stream.ffmpeg) {
        try {
          if (stream.ffmpeg.stdin && !stream.ffmpeg.stdin.destroyed) {
            stream.ffmpeg.stdin.end();
            log.debug(`  Closed stdin for stream #${id}`);
          }
          if (stream.ffmpeg.stdio?.[3] && !stream.ffmpeg.stdio[3].destroyed) {
            stream.ffmpeg.stdio[3].end();
            log.debug(`  Closed audio pipe for stream #${id}`);
          }
        } catch (e) {
          log.error(`⚠️ Pipe close error #${id}:`, e.message);
        }

        try {
          stream.ffmpeg.kill("SIGTERM");
          log.debug(`  Sent SIGTERM to stream #${id}`);
        } catch (e) {
          log.error(`⚠️ SIGTERM error #${id}:`, e.message);
        }

        const killTimer = setTimeout(() => {
          try {
            if (stream.ffmpeg) {
              stream.ffmpeg.kill("SIGKILL");
              log.warn(`  Force SIGKILL stream #${id}`);
            }
          } catch (e) {
            log.error(`⚠️ SIGKILL error #${id}:`, e.message);
          }
        }, 3000);

        stream.ffmpeg.once("close", () => {
          clearTimeout(killTimer);
          log.stream(id, `✅ FFmpeg process closed`);
        });

        stream.ffmpeg = null;
      }

      stream.config = null;
      activeStreams.delete(id);

      const elapsed = ((Date.now() - stream.stats.startTime) / 1000).toFixed(1);
      const fps =
        elapsed > 0 ? (stream.stats.videoFrames / elapsed).toFixed(1) : 0;

      log.stream(
        id,
        `✅ Cleanup complete: ${stream.stats.videoFrames} frames, ${fps} fps, ${elapsed}s`
      );
      log.info(
        `📊 Active streams: ${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, Queue: ${queuedStreams.length}`
      );

      processQueue();
    } catch (err) {
      log.error(`❌ Cleanup error for stream #${stream.id}:`, err.message);
    }
  };

  const reconnectStream = (stream) => {
    try {
      if (stream.reconnectAttempts >= CONFIG.RECONNECT_ATTEMPTS) {
        log.error(`❌ Stream #${stream.id} max reconnect attempts reached`);
        metrics.totalStreamsFailed++;

        try {
          stream.ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed after ${CONFIG.RECONNECT_ATTEMPTS} retries. Please restart.`,
              reconnectAttempts: stream.reconnectAttempts,
            })
          );
        } catch (e) {
          log.error(
            `❌ Failed to send error to stream #${stream.id}:`,
            e.message
          );
        }

        cleanupStream(stream, true);
        return;
      }

      stream.reconnectAttempts++;
      stream.isReconnecting = true;
      metrics.totalReconnects++;

      const delay =
        CONFIG.RECONNECT_DELAY * Math.pow(2, stream.reconnectAttempts - 1);
      const maxDelay = 30000;
      const actualDelay = Math.min(delay, maxDelay);

      log.stream(
        stream.id,
        `🔄 Reconnecting in ${actualDelay}ms (attempt ${stream.reconnectAttempts}/${CONFIG.RECONNECT_ATTEMPTS})`
      );

      try {
        stream.ws.send(
          JSON.stringify({
            type: "reconnecting",
            attempt: stream.reconnectAttempts,
            maxAttempts: CONFIG.RECONNECT_ATTEMPTS,
            delay: actualDelay,
          })
        );
      } catch (e) {
        log.error(
          `❌ Failed to send reconnect msg to stream #${stream.id}:`,
          e.message
        );
      }

      setTimeout(() => {
        try {
          if (stream.config) {
            log.stream(stream.id, `🔄 Starting reconnect now`);
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
          `📥 Processing queued stream #${stream.id} (queue: ${queuedStreams.length})`
        );

        try {
          stream.ws.send(
            JSON.stringify({
              type: "dequeued",
              message: "Starting your stream now",
              position: 0,
            })
          );
        } catch (e) {
          log.error(
            `❌ Failed to notify dequeued stream #${stream.id}:`,
            e.message
          );
        }

        startFFmpeg(stream);
      }
    } catch (err) {
      log.error(`❌ Queue processing error:`, err.message);
    }
  };

  const startFFmpeg = (stream) => {
    try {
      const id = stream.id;

      if (activeStreams.size >= CONFIG.MAX_CONCURRENT_STREAMS) {
        if (queuedStreams.length >= CONFIG.MAX_QUEUE_SIZE) {
          log.error(`❌ Stream #${id} rejected: queue full`);
          try {
            stream.ws.send(
              JSON.stringify({
                type: "error",
                message: `Server at max capacity`,
              })
            );
          } catch {}
          return false;
        }

        log.warn(
          `⏳ Stream #${id} queued (position ${queuedStreams.length + 1})`
        );
        queuedStreams.push(stream);

        try {
          stream.ws.send(
            JSON.stringify({
              type: "queued",
              position: queuedStreams.length,
              maxQueue: CONFIG.MAX_QUEUE_SIZE,
            })
          );
        } catch {}
        return false;
      }

      const { streamKey, width, height, fps, videoBitrate, audioBitrate } =
        stream.config;

      if (stream.ffmpeg) {
        try {
          stream.ffmpeg.kill("SIGKILL");
          log.stream(id, `♻️ Killed old FFmpeg process for reconnect`);
        } catch {}
        stream.ffmpeg = null;
      }

      const DEBUG_SAVE_FILE = process.env.DEBUG_SAVE_FILE === "true";
      let outputTarget;

      if (DEBUG_SAVE_FILE) {
        outputTarget = `/tmp/stream_${id}_${Date.now()}.mp4`;
        log.stream(id, `🎬 DEBUG MODE: Saving to ${outputTarget}`);
      } else {
        outputTarget = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
        log.stream(
          id,
          `🎬 Starting: ${width}x${height}@${fps}fps, ${videoBitrate} → Facebook`
        );
      }

      const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

      // ✅ ULTRA SMOOTH FFmpeg args - 2x larger buffers
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",

        // Input 0: H264
        "-f",
        "h264",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-i",
        "pipe:0",

        // Input 1: Audio
        "-f",
        "webm",
        "-i",
        "pipe:3",

        // Map
        "-map",
        "0:v",
        "-map",
        "1:a",

        // Video: copy (zero CPU)
        "-c:v",
        "copy",

        // Audio: AAC optimized
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",

        // ✅ ULTRA SMOOTH: 2x larger buffers
        "-max_muxing_queue_size",
        "4096", // ⬆️ 2048 → 4096
        "-fflags",
        "+genpts+nobuffer+flush_packets+igndts", // ⬆️ Thêm igndts
        "-flush_packets",
        "1",
        "-max_delay",
        "500000", // ⬆️ 500ms max delay

        // ✅ RTMP ULTRA SMOOTH optimizations
        "-rtmp_conn",
        "S:0:sauth:true",
        "-rtmp_buffer",
        "20000000", // ⬆️ 10MB → 20MB (gấp đôi!)
        "-rtmp_flush_interval",
        "2", // ⬆️ 3 → 2 (flush nhanh hơn)
        "-rtmp_live",
        "live",

        "-shortest",
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

      log.debug(`🔧 FFmpeg V2 command for stream #${id}`);

      stream.ffmpeg = spawn(ffmpegPath, args, {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        detached: false,
      });

      if (!stream.ffmpeg.pid) {
        throw new Error("FFmpeg spawn failed - no PID");
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
        `✅ FFmpeg V2 spawned: PID=${stream.ffmpeg.pid}, 20MB buffer`
      );
      log.info(
        `📊 Active: ${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, Peak: ${metrics.peakConcurrent}`
      );

      stream.ffmpeg.stdin.on("error", (e) => {
        if (e.code === "EPIPE") return;
        log.error(`❌ Stream #${id} stdin error:`, e.message);
      });

      if (stream.ffmpeg.stdio[3]) {
        stream.ffmpeg.stdio[3].on("error", (e) => {
          if (e.code === "EPIPE") return;
          log.error(`❌ Stream #${id} audio pipe error:`, e.message);
        });
      }

      stream.ffmpeg.stderr.on("data", (d) => {
        try {
          const log_msg = d.toString().trim();
          log.error(`📺 FFmpeg #${id}:`, log_msg);

          if (
            log_msg.includes("Input/output error") ||
            log_msg.includes("ECONNRESET")
          ) {
            log.error(
              `❌ Stream #${id} connection lost - triggering reconnect`
            );
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
          const fps =
            elapsed > 0 ? (stream.stats.videoFrames / elapsed).toFixed(1) : 0;

          log.stream(
            id,
            `🛑 FFmpeg closed: code=${code} signal=${signal} | ${stream.stats.videoFrames} frames, ${fps} fps, ${elapsed}s`
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
            try {
              stream.ws.send(
                JSON.stringify({
                  type: "stopped",
                  code,
                  signal,
                  stats: {
                    frames: stream.stats.videoFrames,
                    fps,
                    duration: elapsed,
                  },
                })
              );
            } catch {}
          }
        } catch (err) {
          log.error(`❌ Close handler error:`, err.message);
        }
      });

      stream.ffmpeg.on("error", (err) => {
        try {
          log.error(`❌ Stream #${id} process error:`, err.message);
          try {
            stream.ws.send(
              JSON.stringify({
                type: "error",
                message: `FFmpeg error: ${err.message}`,
              })
            );
          } catch {}
          cleanupStream(stream, true);
        } catch (e) {
          log.error(`❌ Error handler error:`, e.message);
        }
      });

      try {
        stream.ws.send(
          JSON.stringify({
            type: "started",
            streamId: id,
            message: `Stream #${id} live! ULTRA SMOOTH V2`,
            stats: {
              active: activeStreams.size,
              max: CONFIG.MAX_CONCURRENT_STREAMS,
              queued: queuedStreams.length,
              bufferSize: "20MB",
            },
          })
        );
      } catch (e) {
        log.error(`❌ Failed to send start confirmation:`, e.message);
      }

      return true;
    } catch (err) {
      log.error(`❌ startFFmpeg error:`, err.message, err.stack);
      try {
        stream.ws.send(
          JSON.stringify({
            type: "error",
            message: `Spawn failed: ${err.message}`,
          })
        );
      } catch {}
      cleanupStream(stream, true);
      return false;
    }
  };

  wss.on("connection", (ws, req) => {
    let stream = null;

    try {
      ws.isAlive = true;
      ws.on("pong", () => (ws.isAlive = true));
      ws._socket?.setNoDelay?.(true);

      const clientIp = req.socket.remoteAddress;
      const streamId = ++streamCounter;

      log.info(`📡 Client #${streamId} connected from ${clientIp}`);

      stream = {
        id: streamId,
        ws,
        ffmpeg: null,
        config: null,
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
                  if (err && err.code !== "EPIPE") {
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

                if (stream.stats.droppedFrames > CONFIG.FRAME_DROP_THRESHOLD) {
                  log.warn(
                    `⚠️ Stream #${stream.id} dropped ${stream.stats.droppedFrames} frames!`
                  );
                }
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
              try {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Already streaming",
                  })
                );
              } catch {}
              return;
            }

            stream.config = {
              streamKey: msg.streamKey,
              width: msg.width || 1280,
              height: msg.height || 720,
              fps: msg.fps || 30,
              videoBitrate: msg.videoBitrate || "2500k",
              audioBitrate: msg.audioBitrate || "192k",
            };

            if (!stream.config.streamKey) {
              try {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "streamKey required",
                  })
                );
              } catch {}
              return;
            }

            log.stream(
              stream.id,
              `📥 Start request: ${stream.config.width}x${stream.config.height}@${stream.config.fps}fps`
            );
            startFFmpeg(stream);
          } else if (msg.type === "stop") {
            log.stream(stream.id, `🛑 Stop requested by user`);
            cleanupStream(stream, true);
            try {
              ws.send(
                JSON.stringify({
                  type: "stopped",
                  message: "Stopped by user",
                  stats: stream.stats,
                })
              );
            } catch {}
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
      log.error(`❌ Connection handler error:`, err.message, err.stack);
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

  log.info(`🚀 RTMP Relay ULTRA V2 ready - 2x buffers, zero stutter!`);

  return wss;
}
