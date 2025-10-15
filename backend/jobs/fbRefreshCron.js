// fbRefreshCron.js
import cron from "node-cron";
import {
  bootstrapFromEnvIfNeeded,
  sweepRefreshAll,
} from "../services/fbTokenService.js";

export function startFbRefreshCron({ runOnInit = true } = {}) {
  let running = false;

  const run = async () => {
    if (running) {
      console.warn("[FB Cron] a run is already in progress, skipping.");
      return;
    }
    running = true;
    const t0 = Date.now();
    try {
      console.info("[FB Cron] start");
      await bootstrapFromEnvIfNeeded(); // seed nếu DB trống
      await sweepRefreshAll(); // kiểm tra & refresh nếu cần
      console.info(`[FB Cron] done in ${Date.now() - t0}ms`);
    } catch (e) {
      console.error("[FB Cron] error:", e?.message || e);
    } finally {
      running = false;
    }
  };

  // ✅ Chạy NGAY khi server khởi động (có thể tắt bằng runOnInit: false)
  if (runOnInit) run();

  // ⏰ Lặp mỗi 6 giờ: 00:00, 06:00, 12:00, 18:00 (Asia/Bangkok)
  const task = cron.schedule("0 */6 * * *", run, {
    timezone: "Asia/Bangkok",
  });

  return { task, run }; // nếu muốn chủ động trigger run() ở nơi khác
}
