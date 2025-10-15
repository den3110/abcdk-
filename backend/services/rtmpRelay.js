// rtmpRelayConcurrentFix.js - FIXED CONCURRENT STREAMS
// ✅ Spawn queue + delays + better resource management
import { WebSocketServer } from "ws";
import { spawn } from "child_process";

const CONFIG = {
  MAX_CONCURRENT_STREAMS: 60,
  MAX_QUEUE_SIZE: 20,
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 3000,
  HEALTH_CHECK_INTERVAL: 30000,
  STREAM_TIMEOUT: 120000,
  FRAME_DROP_THRESHOLD: 100,
  STATS_INTERVAL: 120000,

  // ✅ Spawn control
  SPAWN_DELAY_MS: 1000, // Delay 1s giữa các lần spawn
  MAX_SPAWN_RETRIES: 3,
  SPAWN_TIMEOUT_MS: 10000,

  BUFFER_SIZES: {
    low: 10000000,
    medium: 15000000,
    high: 20000000,
    ultra: 30000000,
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

const detectQualityLevel = (height) => {
  if (height <= 360) return "low";
  if (height <= 480) return "medium";
  if (height <= 720) return "high";
  return "ultra";
};

const getBufferSize = (quality) => {
  return CONFIG.BUFFER_SIZES[quality] || CONFIG.BUFFER_SIZES.high;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

process.on("uncaughtException", (err) => {
  log.error("❌ UNCAUGHT EXCEPTION:", err.message);
  log.error(err.stack);
});

process.on("unhandledRejection", (reason) => {
  log.error("❌ UNHANDLED REJECTION:", reason);
});

export async function attachRtmpRelayFinal(server, options = {}) {
  const wss = new WebSocketServer({
    server,
    path: options.path || "/ws/rtmp",
    perMessageDeflate: false,
    maxPayload: 50 * 1024 * 1024,
    clientTracking: true,
  });

  log.info(`✅ RTMP Relay with CONCURRENT FIX initialized`);
  log.info(`📊 Spawn delay: ${CONFIG.SPAWN_DELAY_MS}ms between processes`);

  const activeStreams = new Map();
  const queuedStreams = [];
  let streamCounter = 0;

  // ✅ Spawn queue variables
  const spawnQueue = [];
  let isSpawning = false;
  let lastSpawnTime = 0;

  // ✅ ĐỊNH NGHĨA spawnFFmpegProcess TRƯỚC (hoisted function)
  const spawnFFmpegProcess = async (stream) => {
    try {
      const id = stream.id;
      const { streamKey, width, height, fps, videoBitrate, audioBitrate } =
        stream.config;
      const qualityLevel = stream.qualityLevel;
      const bufferSize = getBufferSize(qualityLevel);

      const DEBUG_SAVE_FILE = process.env.DEBUG_SAVE_FILE === "true";
      const outputTarget = DEBUG_SAVE_FILE
        ? `/tmp/stream_${id}_${qualityLevel}_${Date.now()}.mp4`
        : `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;

      const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
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
        audioBitrate || "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-max_muxing_queue_size",
        qualityLevel === "ultra"
          ? "8192"
          : qualityLevel === "high"
          ? "4096"
          : "2048",
        "-fflags",
        "+genpts+nobuffer+flush_packets+igndts",
        "-flush_packets",
        "1",
        "-max_delay",
        qualityLevel === "ultra" ? "1000000" : "500000",
        "-rtmp_conn",
        "S:0:sauth:true",
        "-rtmp_buffer",
        bufferSize.toString(),
        "-rtmp_flush_interval",
        qualityLevel === "low" ? "3" : "2",
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

      log.stream(id, `🚀 Spawning FFmpeg [${qualityLevel}] now...`);

      const spawnPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Spawn timeout"));
        }, CONFIG.SPAWN_TIMEOUT_MS);

        try {
          stream.ffmpeg = spawn(ffmpegPath, args, {
            stdio: ["pipe", "pipe", "pipe", "pipe"],
            detached: false,
          });

          if (!stream.ffmpeg.pid) {
            clearTimeout(timeout);
            reject(new Error("FFmpeg spawn failed - no PID"));
            return;
          }

          clearTimeout(timeout);
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      await spawnPromise;

      stream.stats = {
        videoFrames: 0,
        audioFrames: 0,
        startTime: Date.now(),
        lastFrameTime: Date.now(),
        droppedFrames: 0,
      };
      stream.isReconnecting = false;
      activeStreams.set(id, stream);

      if (stream.reconnectAttempts === 0) {
        metrics.totalStreamsStarted++;
      }

      metrics.peakConcurrent = Math.max(
        metrics.peakConcurrent,
        activeStreams.size
      );

      log.stream(
        id,
        `✅ FFmpeg SPAWNED [${qualityLevel}]: PID=${
          stream.ffmpeg.pid
        }, Buffer=${(bufferSize / 1000000).toFixed(0)}MB`
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
          log.error(`📺 FFmpeg #${id} [${qualityLevel}]:`, log_msg);
          if (
            log_msg.includes("Input/output error") ||
            log_msg.includes("ECONNRESET") ||
            log_msg.includes("TLS fatal alert")
          ) {
            log.error(`❌ Stream #${id} connection lost`);
            if (!stream.isReconnecting) {
              reconnectStream(stream);
            }
          }
        } catch {}
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
            `🛑 FFmpeg closed [${qualityLevel}]: code=${code} signal=${signal} | ${stream.stats.videoFrames} frames, ${fps} fps`
          );

          if (
            code !== 0 &&
            code !== null &&
            signal !== "SIGTERM" &&
            signal !== "SIGKILL" &&
            !stream.isReconnecting
          ) {
            reconnectStream(stream);
          } else {
            cleanupStream(stream, true);
            try {
              stream.ws.send(
                JSON.stringify({
                  type: "stopped",
                  stats: {
                    frames: stream.stats.videoFrames,
                    fps,
                    quality: qualityLevel,
                  },
                })
              );
            } catch {}
          }
        } catch {}
      });

      stream.ffmpeg.on("error", (err) => {
        try {
          log.error(`❌ Stream #${id} process error:`, err.message);
          cleanupStream(stream, true);
        } catch {}
      });

      try {
        stream.ws.send(
          JSON.stringify({
            type: "started",
            streamId: id,
            message: `Stream #${id} live! [${qualityLevel.toUpperCase()}]`,
            stats: {
              active: activeStreams.size,
              bufferSize: `${(bufferSize / 1000000).toFixed(0)}MB`,
              quality: qualityLevel,
            },
          })
        );
      } catch {}

      return true;
    } catch (err) {
      log.error(
        `❌ spawnFFmpegProcess error for stream #${stream.id}:`,
        err.message
      );
      return false;
    }
  };

  // ✅ Process spawn queue - SAU khi định nghĩa spawnFFmpegProcess
  const processSpawnQueue = async () => {
    if (isSpawning || spawnQueue.length === 0) return;

    isSpawning = true;

    while (spawnQueue.length > 0) {
      const { stream, resolve, reject } = spawnQueue.shift();

      try {
        const timeSinceLastSpawn = Date.now() - lastSpawnTime;
        if (timeSinceLastSpawn < CONFIG.SPAWN_DELAY_MS) {
          const waitTime = CONFIG.SPAWN_DELAY_MS - timeSinceLastSpawn;
          log.stream(
            stream.id,
            `⏳ Waiting ${waitTime}ms before spawn (queue: ${spawnQueue.length})`
          );
          await sleep(waitTime);
        }

        const success = await spawnFFmpegProcess(stream);
        lastSpawnTime = Date.now();

        resolve(success);
      } catch (err) {
        log.error(
          `❌ Spawn queue error for stream #${stream.id}:`,
          err.message
        );
        reject(err);
      }
    }

    isSpawning = false;
  };

  const queueFFmpegSpawn = (stream) => {
    return new Promise((resolve, reject) => {
      spawnQueue.push({ stream, resolve, reject });
      log.stream(
        stream.id,
        `📝 Added to spawn queue (position: ${spawnQueue.length})`
      );
      processSpawnQueue();
    });
  };

  const statsInterval = setInterval(() => {
    const uptime = ((Date.now() - metrics.startTime) / 1000 / 60).toFixed(1);
    log.info(
      `📊 STATS: Active=${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, ` +
        `Queue=${queuedStreams.length}, SpawnQueue=${spawnQueue.length}, ` +
        `Started=${metrics.totalStreamsStarted}, Failed=${metrics.totalStreamsFailed}`
    );
  }, CONFIG.STATS_INTERVAL);

  const healthCheck = setInterval(() => {
    activeStreams.forEach((stream, id) => {
      try {
        const elapsed = Date.now() - stream.stats.lastFrameTime;
        if (elapsed > CONFIG.STREAM_TIMEOUT) {
          log.warn(
            `⚠️ Stream #${id} [${stream.qualityLevel}] STALLED: ${(
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
            stream.ffmpeg.stdin.removeAllListeners();
            stream.ffmpeg.stdin.end();
          }
          if (stream.ffmpeg.stdio?.[3] && !stream.ffmpeg.stdio[3].destroyed) {
            stream.ffmpeg.stdio[3].removeAllListeners();
            stream.ffmpeg.stdio[3].end();
          }
        } catch (e) {
          log.error(`⚠️ Pipe close error #${id}:`, e.message);
        }

        try {
          stream.ffmpeg.removeAllListeners();
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

      if (stream.qualityLevel) {
        metrics.qualityDistribution[stream.qualityLevel]--;
      }

      stream.config = null;
      activeStreams.delete(id);

      const elapsed = ((Date.now() - stream.stats.startTime) / 1000).toFixed(1);
      const fps =
        elapsed > 0 ? (stream.stats.videoFrames / elapsed).toFixed(1) : 0;
      log.stream(
        id,
        `✅ Cleanup complete [${stream.qualityLevel}]: ${stream.stats.videoFrames} frames, ${fps} fps, ${elapsed}s`
      );

      log.info(
        `📊 Active: ${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, Queue: ${queuedStreams.length}`
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
            })
          );
        } catch {}
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
        `🔄 Reconnecting in ${actualDelay}ms (${stream.reconnectAttempts}/${CONFIG.RECONNECT_ATTEMPTS})`
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
      } catch {}

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
        } catch {}
        startFFmpeg(stream);
      }
    } catch (err) {
      log.error(`❌ Queue processing error:`, err.message);
    }
  };

  const startFFmpeg = async (stream) => {
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

      const qualityLevel = detectQualityLevel(height);
      const bufferSize = getBufferSize(qualityLevel);
      stream.qualityLevel = qualityLevel;

      if (!stream.ffmpeg) {
        metrics.qualityDistribution[qualityLevel]++;
      }

      if (stream.ffmpeg) {
        try {
          stream.ffmpeg.kill("SIGKILL");
          log.stream(id, `♻️ Killed old FFmpeg for reconnect`);
          await sleep(500);
        } catch {}
        stream.ffmpeg = null;
      }

      log.stream(
        id,
        `🎬 Queueing spawn [${qualityLevel.toUpperCase()}]: ${width}x${height}@${fps}fps`
      );

      const success = await queueFFmpegSpawn(stream);

      if (!success) {
        throw new Error("FFmpeg spawn failed");
      }

      return true;
    } catch (err) {
      log.error(`❌ startFFmpeg error:`, err.message);
      try {
        stream.ws.send(
          JSON.stringify({
            type: "error",
            message: `Start failed: ${err.message}`,
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
                    `⚠️ Stream #${stream.id} [${stream.qualityLevel}] dropped ${stream.stats.droppedFrames} frames!`
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
              audioBitrate: msg.audioBitrate || "128k",
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

            const quality = detectQualityLevel(stream.config.height);
            stream.qualityLevel = quality;
            log.stream(
              stream.id,
              `📥 Start request [${quality}]: ${stream.config.width}x${stream.config.height}@${stream.config.fps}fps`
            );

            startFFmpeg(stream);
          } else if (msg.type === "stop") {
            log.stream(stream.id, `🛑 Stop requested`);
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
        } catch {}
      });

      ws.on("error", (err) => {
        try {
          log.error(`❌ Stream #${stream.id} WS error:`, err.message);
          cleanupStream(stream, true);
        } catch {}
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

  log.info(`🚀 RTMP Relay ready with CONCURRENT FIX!`);
  log.info(
    `⚡ Features: Spawn queue, ${CONFIG.SPAWN_DELAY_MS}ms delays, better cleanup`
  );

  return wss;
}
