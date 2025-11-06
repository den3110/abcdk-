// src/controllers/newsAdminController.js
import NewsSettings from "../models/newsSettingsModel.js";
import NewsLinkCandidate from "../models/newsLinkCandicateModel.js";
import { discoverFeaturedArticles } from "../services/articleDiscoveryService.js";
import { runCrawlEngine } from "../services/crawlEngine.js";

/**
 * GET /api/admin/news/settings
 * Lấy config hệ thống tin tức
 */
export const getNewsSettings = async (req, res) => {
  const settings =
    (await NewsSettings.findOne({ key: "default" }).lean()) ||
    (await NewsSettings.create({}));
  res.json(settings);
};

/**
 * PUT /api/admin/news/settings
 * Cập nhật config hệ thống tin tức
 */
export const updateNewsSettings = async (req, res) => {
  const body = req.body || {};

  const settings = await NewsSettings.findOneAndUpdate(
    { key: "default" },
    {
      $set: {
        enabled: body.enabled,
        intervalMinutes: body.intervalMinutes,
        allowedDomains: body.allowedDomains,
        blockedDomains: body.blockedDomains,
        mainKeywords: body.mainKeywords,
        extraKeywords: body.extraKeywords,
        minAiScore: body.minAiScore,
        autoPublish: body.autoPublish,
        maxArticlesPerRun: body.maxArticlesPerRun,
        maxArticlesPerDay: body.maxArticlesPerDay,
        useAiNormalize: body.useAiNormalize,
      },
    },
    { new: true, upsert: true }
  ).lean();

  res.json(settings);
};

/**
 * GET /api/admin/news/candidates
 * Danh sách link candidate để monitor (kèm status, lastError, lastErrorCode)
 */
export const getNewsCandidates = async (req, res) => {
  const items = await NewsLinkCandidate.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  res.json(items);
};

/**
 * POST /api/admin/news/run
 * Chạy discovery + crawl thủ công, trả full kết quả cho FE
 */
export const runNewsSyncNow = async (req, res) => {
  try {
    const discovery = await discoverFeaturedArticles();
    const crawl = await runCrawlEngine();

    // crawl đã bao gồm:
    // { crawled, skipped, failed, errorsByType, failedSamples }
    return res.json({
      ok: true,
      message: "Đã chạy đồng bộ tin tức thủ công.",
      discovery,
      crawl,
    });
  } catch (e) {
    console.error("[NewsSyncNow] Error:", e);
    return res.status(500).json({
      ok: false,
      message: "Chạy đồng bộ tin tức thất bại.",
      error: e.message,
    });
  }
};
