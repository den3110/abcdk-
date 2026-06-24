module.exports = {
  apps: [
    {
      name: "abcdk-api", // tên app trong PM2
      cwd: "/abcdk-/backend", // thư mục chạy trên VPS (đúng theo bạn)
      script: "./dist/server.js", // đổi nếu entry khác: ví dụ ./server.js hoặc ./build/index.js
      instances: 2,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        LIVE_RECORDING_EXPORT_WINDOW_ENABLED: "true",
        LIVE_RECORDING_EXPORT_WINDOW_START: "02:00",
        LIVE_RECORDING_EXPORT_WINDOW_END: "06:00",
        LIVE_RECORDING_FFMPEG_THREADS: "1",
        BACKGROUND_JOBS_WINDOW_ENABLED: "true",
        BACKGROUND_JOBS_WINDOW_START: "02:00",
        BACKGROUND_JOBS_WINDOW_END: "06:00",
        BACKGROUND_JOBS_LEADER_ONLY: "true",
        USER_AVATAR_OPTIMIZE_CRON: "40 2 * * *",
        OPTIMIZED_IMAGE_CLEANUP_CRON: "25 2 * * *",
        NEWS_DISCOVERY_CRON: "10 2 * * *",
        OBSERVER_NIGHTLY_SYNC_START_HOUR: "2",
        OBSERVER_NIGHTLY_SYNC_END_HOUR: "6",
        OBSERVER_AI_ADVISOR_ENABLED: "false",
      },
    },
  ],
};
