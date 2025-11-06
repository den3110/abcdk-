// src/jobs/newsCron.js
import cron from "node-cron";
import { discoverFeaturedArticles } from "../services/articleDiscoveryService.js";
import { runCrawlEngine } from "../services/crawlEngine.js";
import NewsSettings from "../models/newsSettingsModel.js";

export function initNewsCron() {
  // Chạy mỗi ngày lúc 00:00 theo giờ Asia/Bangkok (GMT+7)
  cron.schedule(
    "0 0 * * *",
    async () => {
      const settings =
        (await NewsSettings.findOne({ key: "default" })) ||
        (await NewsSettings.create({}));

      if (!settings.enabled) return;

      try {
        console.log("[NewsCron] Start discovery + crawl (daily 00:00 GMT+7)");
        await discoverFeaturedArticles();
        await runCrawlEngine();
        console.log("[NewsCron] Done");
      } catch (e) {
        console.error("[NewsCron] Error:", e);
      }
    },
    {
      timezone: "Asia/Bangkok",
    }
  );
}
