// src/jobs/newsCron.js
import cron from "node-cron";
import { runCrawlEngine } from "../services/crawlEngine.js";
import NewsSettings from "../models/newsSettingsModel.js";
import { discoverFeaturedArticlesV2 } from "../services/articleDiscoveryServiceV2.js";

export function initNewsCron() {
  // Chạy mỗi ngày lúc 00:00 theo giờ Asia/Bangkok (GMT+7)
  cron.schedule(
    "0 0 * * *",
    async () => {
      const settings =
        (await NewsSettings.findOne({ key: "default" })) ||
        (await NewsSettings.create({}));

      if (!settings.enabled) return;

      console.log("[NewsCron] Start discovery + crawl (daily 00:00 GMT+7)");

      const MAX_ATTEMPTS = 3;
      const RETRY_DELAY_MS = 10 * 60 * 1000; // 10 phút
      let attempt = 0;
      let discoveryOk = false;
      let lastError = null;
      let lastResult = null;

      // 🔁 Chỉ khi discovery ok mới chạy crawl, nếu lỗi → retry tối đa 3 lần, cách nhau 10 phút
      while (attempt < MAX_ATTEMPTS && !discoveryOk) {
        attempt += 1;
        try {
          console.log(
            `[NewsCron] Discovery attempt ${attempt}/${MAX_ATTEMPTS}...`
          );

          const res = await discoverFeaturedArticlesV2();
          lastResult = res;

          const isTransient = res && (res.transientError || res.ok === false);

          if (isTransient) {
            lastError = new Error(
              `Transient error from discoverFeaturedArticlesV2 (attempt ${attempt})`
            );
            console.warn(
              "[NewsCron] Discovery transientError, sẽ retry...",
              res
            );
          } else {
            discoveryOk = true;
            console.log(
              `[NewsCron] Discovery completed on attempt ${attempt}.`,
              res
            );
          }
        } catch (e) {
          lastError = e;
          console.error(
            `[NewsCron] Discovery attempt ${attempt}/${MAX_ATTEMPTS} error:`,
            e
          );
        }

        // Nếu chưa ok và còn lượt retry → chờ 10 phút rồi thử lại
        if (!discoveryOk && attempt < MAX_ATTEMPTS) {
          console.log(
            `[NewsCron] Discovery not successful, sẽ thử lại sau 10 phút (attempt ${
              attempt + 1
            }/${MAX_ATTEMPTS})`
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }

      // Sau tối đa 3 lần mà vẫn không thành công → bỏ qua crawl lần này
      if (!discoveryOk) {
        console.error(
          "[NewsCron] Discovery FAILED after max attempts, skip crawl for this run.",
          lastError || lastResult
        );
        return;
      }

      // ✅ Discovery ok rồi mới chạy crawl
      try {
        await runCrawlEngine();
        console.log("[NewsCron] Done");
      } catch (e) {
        console.error("[NewsCron] Error in crawl engine:", e);
      }
    },
    {
      timezone: "Asia/Bangkok",
    }
  );
}
