module.exports = {
  apps: [
    {
      name: "pickletour-api",
      script: "./backend/server.js",
      cwd: process.cwd(),
      exec_mode: "cluster",
      instances: 2,
      max_memory_restart: "900M",
      env: {
        NODE_ENV: "production",
        LIVE_RECORDING_FFMPEG_THREADS: "1",
      },
    },
    {
      name: "pickletour-rtmp",
      script: "./backend/rtmpRelay.server.js",
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "pickletour-recording-worker",
      script: "./backend/worker/liveRecordingExport.worker.js",
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: "production",
        LIVE_RECORDING_FFMPEG_THREADS: "1",
      },
    },
  ],
};
