// rtmpRelayFinal.js — ADAPTIVE QUALITY + STABLE AUDIO + PREBUFFER SPAWN
// Drop-in thay thế bản cũ
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

  // Prebuffer & spawn
  PREBUFFER_MAX_MS: 3000, // tối đa đợi 3s kể từ khi thấy gói đầu
  PREBUFFER_MAX_VIDEO_CHUNKS: 180, // ~ 3s @60 chunk/s (tuỳ encoder chunk)
  PREBUFFER_MAX_AUDIO_CHUNKS: 90, // MediaRecorder 100ms/chunk → ~9 chunk trong 900ms
  REQUIRE_BOTH_BEFORE_SPAWN: true, // bắt buộc có cả audio & video trước khi spawn

  // ✅ Quality-based buffer sizes (RTMP buffer)
  BUFFER_SIZES: {
    low: 10_000_000, // 10MB for 360p
    medium: 15_000_000, // 15MB for 480p
    high: 20_000_000, // 20MB for 720p
    ultra: 30_000_000, // 30MB for 1080p
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

// --- helpers ---
const detectQualityLevel = (h) =>
  h <= 360 ? "low" : h <= 480 ? "medium" : h <= 720 ? "high" : "ultra";
const getBufferSize = (q) => CONFIG.BUFFER_SIZES[q] || CONFIG.BUFFER_SIZES.high;
const normalizeKey = (k) =>
  /rtmps?:\/\//i.test(k) ? (k.split("/rtmp/")[1] || k).trim() : k.trim();

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

  log.info(`✅ ADAPTIVE RTMP Relay initialized: ${options.path || "/ws/rtmp"}`);
  log.info(
    `📊 Config: MAX=${CONFIG.MAX_CONCURRENT_STREAMS}, ADAPTIVE BUFFERS + PREBUFFER`
  );

  const activeStreams = new Map(); // id -> stream
  const activeKeys = new Map(); // streamKey -> streamId (chặn trùng key)
  const queuedStreams = [];
  let streamCounter = 0;

  // ===== Stats tick =====
  const statsInterval = setInterval(() => {
    const uptimeMin = ((Date.now() - metrics.startTime) / 60000).toFixed(1);
    const avgFps =
      activeStreams.size > 0
        ? (
            metrics.totalFramesProcessed /
            Math.max(1, activeStreams.size) /
            parseFloat(uptimeMin)
          ).toFixed(0)
        : 0;

    log.info(
      `📊 STATS: Active=${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, ` +
        `Queue=${queuedStreams.length}, Peak=${metrics.peakConcurrent}, ` +
        `Started=${metrics.totalStreamsStarted}, Failed=${metrics.totalStreamsFailed}, ` +
        `Reconnects=${metrics.totalReconnects}, Uptime=${uptimeMin}m, AvgFPS=${avgFps}`
    );
    log.info(
      `📊 Quality: Low=${metrics.qualityDistribution.low}, ` +
        `Med=${metrics.qualityDistribution.medium}, ` +
        `High=${metrics.qualityDistribution.high}, ` +
        `Ultra=${metrics.qualityDistribution.ultra}`
    );
  }, CONFIG.STATS_INTERVAL);

  // ===== Healthcheck =====
  const healthCheck = setInterval(() => {
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
            `⚠️ Stream #${id} [${stream.qualityLevel}] STALLED: ${(
              elapsed / 1000
            ).toFixed(0)}s (${fps} fps)`
          );
          try {
            stream.ws.send(
              JSON.stringify({
                type: "warning",
                message: `Stream stalled. Reconnecting...`,
                stats: {
                  fps,
                  frames: stream.stats.videoFrames,
                  quality: stream.qualityLevel,
                },
              })
            );
          } catch {}
          if (!stream.isReconnecting) reconnectStream(stream);
        }
      } catch (err) {
        log.error(`❌ Health check error for stream #${id}:`, err.message);
      }
    });
  }, CONFIG.HEALTH_CHECK_INTERVAL);

  // ===== WS heartbeat =====
  const wsHeartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      try {
        if (ws.isAlive === false) return ws.terminate();
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
    activeStreams.forEach((s) => {
      try {
        cleanupStream(s, true);
      } catch (e) {
        log.error(`❌ Shutdown cleanup:`, e.message);
      }
    });
    log.info(`✅ Shutdown complete`);
  };
  wss.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ===== Core helpers =====
  const qualityFromHeight = (h) => detectQualityLevel(h);
  const writeChunk = (dst, buf) =>
    new Promise((res, rej) => {
      if (!dst?.writable || !buf?.length) return res();
      if (dst.write(buf) === false) {
        dst.once("drain", res);
      } else res();
    });

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
          stream.ffmpeg.stdin?.end();
        } catch {}
        try {
          stream.ffmpeg.stdio?.[3]?.end?.();
        } catch {}
        try {
          stream.ffmpeg.kill("SIGTERM");
        } catch {}
        const killTimer = setTimeout(() => {
          try {
            stream.ffmpeg?.kill("SIGKILL");
          } catch {}
        }, 3000);
        stream.ffmpeg.once?.("close", () => clearTimeout(killTimer));
        stream.ffmpeg = null;
      }

      // free key
      if (stream?.config?.streamKey) activeKeys.delete(stream.config.streamKey);

      if (stream.qualityLevel)
        metrics.qualityDistribution[stream.qualityLevel]--;
      stream.config = null;
      activeStreams.delete(id);

      const elapsed = ((Date.now() - stream.stats.startTime) / 1000).toFixed(1);
      const fps =
        elapsed > 0 ? (stream.stats.videoFrames / elapsed).toFixed(1) : 0;
      log.stream(
        id,
        `✅ Cleanup complete [${stream.qualityLevel}] frames=${stream.stats.videoFrames}, fps=${fps}, elapsed=${elapsed}s`
      );
      log.info(
        `📊 Active: ${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, Queue: ${queuedStreams.length}`
      );
      processQueue();
    } catch (err) {
      log.error(`❌ Cleanup error for stream #${stream?.id}:`, err.message);
    }
  };

  const reconnectStream = (stream) => {
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
      } catch {}
      cleanupStream(stream, true);
      return;
    }
    stream.reconnectAttempts++;
    stream.isReconnecting = true;
    metrics.totalReconnects++;
    const backoff = Math.min(
      CONFIG.RECONNECT_DELAY * Math.pow(2, stream.reconnectAttempts - 1),
      30000
    );
    log.stream(
      stream.id,
      `🔄 Reconnecting [${stream.qualityLevel}] in ${backoff}ms (${stream.reconnectAttempts}/${CONFIG.RECONNECT_ATTEMPTS})`
    );
    try {
      stream.ws.send(
        JSON.stringify({
          type: "reconnecting",
          attempt: stream.reconnectAttempts,
          maxAttempts: CONFIG.RECONNECT_ATTEMPTS,
          delay: backoff,
          quality: stream.qualityLevel,
        })
      );
    } catch {}
    setTimeout(() => {
      try {
        if (stream.config) startFFmpeg(stream, /*isReconnect*/ true);
      } catch (err) {
        log.error(`❌ Reconnect error #${stream.id}:`, err.message);
        cleanupStream(stream, true);
      }
    }, backoff);
  };

  const processQueue = () => {
    while (
      queuedStreams.length > 0 &&
      activeStreams.size < CONFIG.MAX_CONCURRENT_STREAMS
    ) {
      const stream = queuedStreams.shift();
      log.info(
        `📥 Processing queued stream #${stream.id} [${stream.qualityLevel}] (queue: ${queuedStreams.length})`
      );
      try {
        stream.ws.send(
          JSON.stringify({
            type: "dequeued",
            message: "Starting your stream now",
            position: 0,
            quality: stream.qualityLevel,
          })
        );
      } catch {}
      startFFmpeg(stream);
    }
  };

  // ===== PREBUFFER + SPAWN =====
  const readyToSpawn = (s) => {
    const elapsed = Date.now() - (s.prebuffer.firstSeenAt || Date.now());
    const audioOK = s.prebuffer.gotAudio && s.prebuffer.audioChunks.length > 0;
    const videoOK = s.prebuffer.gotVideo && s.prebuffer.videoChunks.length > 0;
    if (CONFIG.REQUIRE_BOTH_BEFORE_SPAWN) return audioOK && videoOK;
    return videoOK || audioOK || elapsed >= CONFIG.PREBUFFER_MAX_MS;
  };

  const flushPrebuffer = async (stream) => {
    // xả lần lượt để giữ thứ tự thời gian tương đối (video & audio độc lập pipe)
    // video
    for (const b of stream.prebuffer.videoChunks) {
      try {
        await writeChunk(stream.ffmpeg.stdin, b);
      } catch (e) {
        log.error(`⚠️ Prebuffer video flush error #${stream.id}:`, e.message);
        break;
      }
    }
    // audio
    for (const a of stream.prebuffer.audioChunks) {
      try {
        await writeChunk(stream.ffmpeg.stdio?.[3], a);
      } catch (e) {
        log.error(`⚠️ Prebuffer audio flush error #${stream.id}:`, e.message);
        break;
      }
    }
    // clear
    stream.prebuffer.videoChunks.length = 0;
    stream.prebuffer.audioChunks.length = 0;
  };

  const startFFmpeg = (stream, isReconnect = false) => {
    try {
      const id = stream.id;
      // capacity
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

      // spawn
      const qualityLevel = detectQualityLevel(height);
      const bufferSize = getBufferSize(qualityLevel);
      stream.qualityLevel = qualityLevel;
      if (!isReconnect) metrics.qualityDistribution[qualityLevel]++;

      const DEBUG_SAVE_FILE = process.env.DEBUG_SAVE_FILE === "true";
      const outputTarget = DEBUG_SAVE_FILE
        ? `/tmp/stream_${id}_${qualityLevel}_${Date.now()}.mp4`
        : `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;

      const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

      const args = [
        "-hide_banner",
        "-loglevel",
        "error",

        // VIDEO pipe:0 (annexB H264 từ client)
        "-thread_queue_size",
        "2048",
        "-f",
        "h264",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-i",
        "pipe:0",

        // AUDIO pipe:3 (webm opus từ MediaRecorder)
        "-thread_queue_size",
        "1024",
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

        // giữ PTS + flush nhanh
        "-fflags",
        "+genpts+nobuffer+flush_packets+igndts",
        "-flush_packets",
        "1",
        "-max_delay",
        qualityLevel === "ultra" ? "1000000" : "500000",

        // RTMP
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

      log.stream(
        id,
        `🎬 Spawning FFmpeg [${qualityLevel.toUpperCase()}]: ${width}x${height}@${fps}fps, ${videoBitrate}, RTMPbuf=${(
          bufferSize / 1e6
        ).toFixed(0)}MB`
      );
      stream.ffmpeg = spawn(ffmpegPath, args, {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        detached: false,
      });

      if (!stream.ffmpeg.pid) throw new Error("FFmpeg spawn failed - no PID");

      // init stats
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

      log.stream(id, `✅ FFmpeg PID=${stream.ffmpeg.pid}`);
      log.info(
        `📊 Active: ${activeStreams.size}/${CONFIG.MAX_CONCURRENT_STREAMS}, Peak: ${metrics.peakConcurrent}`
      );

      stream.ffmpeg.stdin.on("error", (e) => {
        if (e.code !== "EPIPE") log.error(`❌ stdin error #${id}:`, e.message);
      });
      stream.ffmpeg.stdio?.[3]?.on?.("error", (e) => {
        if (e.code !== "EPIPE")
          log.error(`❌ audio pipe error #${id}:`, e.message);
      });

      stream.ffmpeg.stderr.on("data", (d) => {
        const msg = (d.toString() || "").trim();
        if (!msg) return;
        log.error(`📺 FFmpeg #${id} [${qualityLevel}]:`, msg);
        if (msg.includes("Input/output error") || msg.includes("ECONNRESET")) {
          log.error(`❌ Stream #${id} connection lost - triggering reconnect`);
          if (!stream.isReconnecting) reconnectStream(stream);
        }
      });

      stream.ffmpeg.on("close", (code, signal) => {
        const elapsed = ((Date.now() - stream.stats.startTime) / 1000).toFixed(
          1
        );
        const fps =
          elapsed > 0 ? (stream.stats.videoFrames / elapsed).toFixed(1) : 0;
        log.stream(
          id,
          `🛑 FFmpeg closed [${qualityLevel}]: code=${code} signal=${signal} | frames=${stream.stats.videoFrames}, fps=${fps}, dur=${elapsed}s`
        );
        if (
          code !== 0 &&
          code !== null &&
          signal !== "SIGTERM" &&
          signal !== "SIGKILL" &&
          !stream.isReconnecting
        ) {
          log.warn(`⚠️ Abnormal exit, auto-reconnecting...`);
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
                  quality: qualityLevel,
                },
              })
            );
          } catch {}
        }
      });

      stream.ffmpeg.on("error", (err) => {
        log.error(`❌ Process error #${id}:`, err.message);
        try {
          stream.ws.send(
            JSON.stringify({
              type: "error",
              message: `FFmpeg error: ${err.message}`,
            })
          );
        } catch {}
        cleanupStream(stream, true);
      });

      // 🔁 Flush prebuffer ngay khi spawn
      flushPrebuffer(stream).then(() => {
        // ok → thông báo started
        try {
          stream.ws.send(
            JSON.stringify({
              type: "started",
              streamId: id,
              message: `Stream #${id} live! [${qualityLevel.toUpperCase()}]`,
              stats: {
                active: activeStreams.size,
                max: CONFIG.MAX_CONCURRENT_STREAMS,
                queued: queuedStreams.length,
                bufferSize: `${(bufferSize / 1e6).toFixed(0)}MB`,
                quality: qualityLevel,
              },
            })
          );
        } catch {}
        // cho phép pass-through
        stream.prebuffer.started = true;
      });

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

  // ====== WS handling (per-stream) ======
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
        prebuffer: {
          firstSeenAt: 0,
          gotVideo: false,
          gotAudio: false,
          started: false, // bật khi đã spawn
          videoChunks: [],
          audioChunks: [],
        },
      };

      // binary frames
      ws.on("message", async (data, isBinary) => {
        try {
          if (isBinary) {
            if (!stream.config) return; // chưa nhận start

            const u8 = new Uint8Array(data);
            const isAudio = u8[0] === 0x01;
            stream.stats.lastFrameTime = Date.now();
            metrics.totalFramesProcessed++;

            // Nếu đã spawn → pass-through
            if (stream.prebuffer.started && stream.ffmpeg) {
              if (isAudio) {
                const payload = u8.subarray(1);
                if (payload.byteLength && stream.ffmpeg.stdio?.[3]?.writable) {
                  await writeChunk(stream.ffmpeg.stdio[3], payload);
                  stream.stats.audioFrames++;
                }
              } else {
                if (stream.ffmpeg.stdin?.writable) {
                  await writeChunk(stream.ffmpeg.stdin, u8);
                  stream.stats.videoFrames++;
                }
              }
              return;
            }

            // --- Prebuffer logic ---
            if (!stream.prebuffer.firstSeenAt)
              stream.prebuffer.firstSeenAt = Date.now();

            if (isAudio) {
              stream.prebuffer.gotAudio = true;
              const payload = u8.subarray(1);
              if (payload.byteLength) {
                stream.prebuffer.audioChunks.push(payload);
                // cắt bớt nếu quá dài
                if (
                  stream.prebuffer.audioChunks.length >
                  CONFIG.PREBUFFER_MAX_AUDIO_CHUNKS
                ) {
                  stream.prebuffer.audioChunks.shift();
                }
              }
            } else {
              stream.prebuffer.gotVideo = true;
              stream.prebuffer.videoChunks.push(u8);
              if (
                stream.prebuffer.videoChunks.length >
                CONFIG.PREBUFFER_MAX_VIDEO_CHUNKS
              ) {
                stream.prebuffer.videoChunks.shift();
              }
            }

            // Điều kiện spawn
            const elapsed = Date.now() - stream.prebuffer.firstSeenAt;
            const canSpawn =
              readyToSpawn(stream) || elapsed >= CONFIG.PREBUFFER_MAX_MS;

            if (canSpawn && !stream.ffmpeg) {
              // đảm bảo đã set quality theo height đã khai báo lúc start
              if (!stream.qualityLevel && stream.config?.height) {
                stream.qualityLevel = qualityFromHeight(stream.config.height);
              }
              startFFmpeg(stream);
            }

            return;
          }

          // text frames
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

            const cfg = {
              streamKey: normalizeKey(msg.streamKey),
              width: msg.width || 1280,
              height: msg.height || 720,
              fps: msg.fps || 30,
              videoBitrate: msg.videoBitrate || "2500k",
              audioBitrate: msg.audioBitrate || "128k",
            };
            if (!cfg.streamKey) {
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

            // chặn trùng key
            const inUseId = activeKeys.get(cfg.streamKey);
            if (inUseId && activeStreams.has(inUseId)) {
              try {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Stream key đang dùng ở thiết bị khác.",
                  })
                );
              } catch {}
              return;
            }
            activeKeys.set(cfg.streamKey, stream.id);

            stream.config = cfg;
            const quality = detectQualityLevel(cfg.height);
            stream.qualityLevel = quality;
            log.stream(
              stream.id,
              `📥 Start request [${quality}]: ${cfg.width}x${cfg.height}@${cfg.fps}fps`
            );

            // gửi ACK sớm cho client encode ngay (audio/video sẽ tới server để prebuffer)
            try {
              ws.send(
                JSON.stringify({ type: "accepted", message: "Prebuffering..." })
              );
            } catch {}
            // Không spawn ngay — đợi prebuffer (logic ở trên)
          } else if (msg.type === "stop") {
            log.stream(
              stream.id,
              `🛑 Stop requested by user [${stream.qualityLevel}]`
            );
            cleanupStream(stream, true);
            try {
              stream.ws.send(
                JSON.stringify({
                  type: "stopped",
                  message: "Stopped by user",
                  stats: stream.stats,
                  quality: stream.qualityLevel,
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
          log.info(
            `📴 Client #${stream.id} [${stream.qualityLevel}] disconnected`
          );
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
  log.info(
    `🚀 RTMP Relay ADAPTIVE ready - Dynamic buffers, stable audio, prebuffer spawn!`
  );
  return wss;
}
