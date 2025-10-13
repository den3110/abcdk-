import {
  bootstrapFromEnvIfNeeded,
  sweepRefreshAll,
} from "../services/fbTokenService.js";

export function startFbRefreshCron() {
  const run = async () => {
    try {
      await bootstrapFromEnvIfNeeded(); // chạy 1 lần: nếu DB trống sẽ tự seed bằng LONG user token
      await sweepRefreshAll(); // sau đó luôn kiểm tra & refresh nếu cần
    } catch (e) {
      console.error("FB Cron error:", e.message);
    }
  };

  run(); // chạy ngay lúc server khởi động
  setInterval(run, 6 * 3600 * 1000); // lặp mỗi 6 giờ
}
