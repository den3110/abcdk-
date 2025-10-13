import { sweepRefreshAll } from "../services/fbTokenService.js";

/** Cron: chạy ngay khi boot và mỗi 6 giờ (có thể đổi) */
export function startFbRefreshCron() {
  const run = async () => {
    try {
      await sweepRefreshAll();
    } catch {
      /* noop */
    }
  };
  run();
  setInterval(run, 6 * 3600 * 1000);
}
