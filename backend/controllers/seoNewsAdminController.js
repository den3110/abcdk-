import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import SeoNewsLinkCandidate from "../models/seoNewsLinkCandidateModel.js";
import SeoNewsArticle from "../models/seoNewsArticleModel.js";
import { runSeoNewsPipeline } from "../services/seoNewsPipelineService.js";
import { runSeoNewsCrawl } from "../services/seoNewsCrawlService.js";
import { cleanupSeoNewsGatewaySourceImages } from "../services/seoNewsImageService.js";
import {
  checkSeoNewsArticleGenerationHealth,
  invalidateSeoNewsArticleGenerationHealthCache,
} from "../services/seoNewsArticleGenerationGateway.js";
import { generateSeoNewsEvergreenArticles } from "../services/seoNewsEvergreenService.js";
import {
  enqueueSeoNewsImageRegenerationJob,
  getSeoNewsImageRegenerationMonitor,
  invalidateSeoNewsImageRegenerationHealthCache,
} from "../services/seoNewsImageQueue.service.js";
import {
  enqueueSeoNewsPipelineJob,
  getSeoNewsPipelineMonitor,
} from "../services/seoNewsPipelineQueue.service.js";
import {
  checkSeoNewsCompetitorPolicy,
  evaluateSeoNewsRelevance,
} from "../services/seoNewsRelevanceService.js";

const VIETNAMESE_DIACRITICS_REGEX = /[\u00C0-\u024F\u1E00-\u1EFF]/i;
const MOJIBAKE_REGEX = /(?:\u00C3.|\u00E1\u00BB|\u00E2\u20AC|\u00C2\s|\uFFFD)/;

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean);
  }

  return [];
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function cleanPage(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function emptyCrawlStats() {
  return {
    crawled: 0,
    skipped: 0,
    failed: 0,
    externalGenerated: 0,
    reviewPassed: 0,
    reviewFailed: 0,
    published: 0,
    draft: 0,
    errorsByType: {},
    failedSamples: [],
  };
}

function toPublicStatsFromCrawl(crawl = {}) {
  return {
    externalGenerated: crawl.externalGenerated || 0,
    evergreenGenerated: 0,
    reviewPassed: crawl.reviewPassed || 0,
    reviewFailed: crawl.reviewFailed || 0,
    published: crawl.published || 0,
    draft: crawl.draft || 0,
  };
}

function evaluateSeoNewsTextQuality(article = {}) {
  const combinedText = [article?.title, article?.summary, article?.contentText]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  const shouldRequireDiacritics = article?.language === "vi";

  const reasons = [];
  if (MOJIBAKE_REGEX.test(combinedText)) {
    reasons.push("mojibake_detected");
  }

  if (
    shouldRequireDiacritics &&
    !VIETNAMESE_DIACRITICS_REGEX.test(combinedText)
  ) {
    reasons.push("missing_vietnamese_diacritics");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function evaluateArticlePublishEligibility(article, settings) {
  const relevance = evaluateSeoNewsRelevance({
    title: article?.title,
    summary: article?.summary,
    contentText: article?.contentText || article?.summary || "",
    tags: article?.tags,
    sourceName: article?.sourceName,
    sourceUrl: article?.sourceUrl,
    settings,
  });

  const textQuality = evaluateSeoNewsTextQuality(article);

  return {
    ok: relevance.isRelevant && textQuality.ok,
    reasons: [...relevance.reasons, ...textQuality.reasons],
    relevanceScore: relevance.score,
  };
}

export const getSeoNewsSettings = async (_req, res) => {
  const rawSettings =
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }));

  const settings =
    typeof rawSettings?.toObject === "function"
      ? rawSettings.toObject()
      : rawSettings;

  const [
    pendingCandidatesCount,
    todayArticlesCount,
    draftArticlesCount,
    articleGenerationGateway,
  ] = await Promise.all([
    SeoNewsLinkCandidate.countDocuments({ status: "pending" }),
    SeoNewsArticle.countDocuments({ createdAt: { $gte: getStartOfToday() } }),
    SeoNewsArticle.countDocuments({ status: "draft" }),
    checkSeoNewsArticleGenerationHealth({
      selectedModel: settings?.articleGenerationModel,
    }),
  ]);

  const targetMinPerDay = Math.max(
    1,
    Number(settings?.targetArticlesPerDay) || 6
  );
  const maxArticlesPerDay = Math.max(
    1,
    Number(settings?.maxArticlesPerDay) || 8
  );

  return res.json({
    ...settings,
    pendingCandidatesCount,
    todayArticlesCount,
    draftArticlesCount,
    missingToTarget: Math.max(0, targetMinPerDay - todayArticlesCount),
    remainingDailyCapacity: Math.max(0, maxArticlesPerDay - todayArticlesCount),
    articleGenerationGateway,
  });
};

export const updateSeoNewsSettings = async (req, res) => {
  const body = req.body || {};
  const updates = {};

  if ("enabled" in body) {
    const enabled = toBoolean(body.enabled);
    if (typeof enabled === "boolean") updates.enabled = enabled;
  }

  if ("intervalMinutes" in body) {
    const intervalMinutes = toNumber(body.intervalMinutes);
    if (intervalMinutes !== undefined) {
      updates.intervalMinutes = Math.max(5, Math.floor(intervalMinutes));
    }
  }

  if ("allowedDomains" in body) {
    updates.allowedDomains = toStringArray(body.allowedDomains);
  }

  if ("blockedDomains" in body) {
    updates.blockedDomains = toStringArray(body.blockedDomains);
  }

  if ("competitorDomains" in body) {
    updates.competitorDomains = toStringArray(body.competitorDomains);
  }

  if ("competitorKeywords" in body) {
    updates.competitorKeywords = toStringArray(body.competitorKeywords);
  }

  if ("mainKeywords" in body) {
    updates.mainKeywords = toStringArray(body.mainKeywords);
  }

  if ("extraKeywords" in body) {
    updates.extraKeywords = toStringArray(body.extraKeywords);
  }

  if ("minAiScore" in body) {
    const minAiScore = toNumber(body.minAiScore);
    if (minAiScore !== undefined) {
      updates.minAiScore = Math.max(0, Math.min(1, minAiScore));
    }
  }

  if ("reviewPassScore" in body) {
    const reviewPassScore = toNumber(body.reviewPassScore);
    if (reviewPassScore !== undefined) {
      updates.reviewPassScore = Math.max(0, Math.min(1, reviewPassScore));
    }
  }

  if ("autoPublish" in body) {
    const autoPublish = toBoolean(body.autoPublish);
    if (typeof autoPublish === "boolean") updates.autoPublish = autoPublish;
  }

  if ("maxArticlesPerRun" in body) {
    const maxArticlesPerRun = toNumber(body.maxArticlesPerRun);
    if (maxArticlesPerRun !== undefined) {
      updates.maxArticlesPerRun = Math.max(1, Math.floor(maxArticlesPerRun));
    }
  }

  if ("maxArticlesPerDay" in body) {
    const maxArticlesPerDay = toNumber(body.maxArticlesPerDay);
    if (maxArticlesPerDay !== undefined) {
      updates.maxArticlesPerDay = Math.max(1, Math.floor(maxArticlesPerDay));
    }
  }

  if ("targetArticlesPerDay" in body) {
    const targetArticlesPerDay = toNumber(body.targetArticlesPerDay);
    if (targetArticlesPerDay !== undefined) {
      updates.targetArticlesPerDay = Math.max(
        1,
        Math.floor(targetArticlesPerDay)
      );
    }
  }

  if ("discoveryProvider" in body) {
    const provider = String(body.discoveryProvider || "")
      .trim()
      .toLowerCase();
    if (["auto", "gemini", "openai"].includes(provider)) {
      updates.discoveryProvider = provider;
    }
  }

  if ("imageSearchEnabled" in body) {
    const imageSearchEnabled = toBoolean(body.imageSearchEnabled);
    if (typeof imageSearchEnabled === "boolean") {
      updates.imageSearchEnabled = imageSearchEnabled;
    }
  }

  if ("imageFallbackEnabled" in body) {
    const imageFallbackEnabled = toBoolean(body.imageFallbackEnabled);
    if (typeof imageFallbackEnabled === "boolean") {
      updates.imageFallbackEnabled = imageFallbackEnabled;
    }
  }

  if ("imageGenerationModel" in body) {
    updates.imageGenerationModel = String(
      body.imageGenerationModel || ""
    ).trim();
  }

  if ("articleGenerationModel" in body) {
    updates.articleGenerationModel = String(
      body.articleGenerationModel || ""
    ).trim();
  }

  if ("imageGenerationDelaySeconds" in body) {
    const imageGenerationDelaySeconds = toNumber(
      body.imageGenerationDelaySeconds
    );
    if (imageGenerationDelaySeconds !== undefined) {
      updates.imageGenerationDelaySeconds = Math.max(
        5,
        Math.floor(imageGenerationDelaySeconds)
      );
    }
  }

  if ("imageRegenerationPaused" in body) {
    const imageRegenerationPaused = toBoolean(body.imageRegenerationPaused);
    if (typeof imageRegenerationPaused === "boolean") {
      updates.imageRegenerationPaused = imageRegenerationPaused;
    }
  }

  const settings = await SeoNewsSettings.findOneAndUpdate(
    { key: "default" },
    { $set: updates },
    { new: true, upsert: true }
  ).lean();

  if ("imageGenerationModel" in updates) {
    invalidateSeoNewsImageRegenerationHealthCache();
  }

  if ("articleGenerationModel" in updates) {
    invalidateSeoNewsArticleGenerationHealthCache();
  }

  return res.json(settings);
};

export const getSeoNewsCandidates = async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const status = String(req.query.status || "").trim();

  const settings =
    (await SeoNewsSettings.findOne({ key: "default" }).lean()) ||
    (await SeoNewsSettings.create({ key: "default" }));

  const query = status ? { status } : { status: { $ne: "skipped" } };

  const rawItems = await SeoNewsLinkCandidate.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const competitorIds = [];
  const items = [];

  for (const item of rawItems) {
    const competitor = checkSeoNewsCompetitorPolicy({
      title: item.title,
      summary: item.reason,
      contentText: item.reason,
      tags: item.tags,
      sourceName: item.sourceName,
      sourceUrl: item.url,
      settings,
    });

    if (competitor.isCompetitor) {
      if (item.status !== "skipped" && item._id) {
        competitorIds.push(item._id);
      }
      continue;
    }

    items.push(item);
  }

  if (competitorIds.length) {
    await SeoNewsLinkCandidate.updateMany(
      { _id: { $in: competitorIds } },
      {
        $set: {
          status: "skipped",
          lastErrorCode: "COMPETITOR_BLOCKED",
          lastError: "COMPETITOR_BLOCKED: blocked competitor source",
        },
      }
    );
  }

  return res.json(items);
};

export const getSeoNewsArticles = async (req, res) => {
  const page = cleanPage(req.query.page, 1);
  const limit = Math.min(cleanPage(req.query.limit, 30), 200);
  const skip = (page - 1) * limit;

  const status = String(req.query.status || "")
    .trim()
    .toLowerCase();
  const origin = String(req.query.origin || "")
    .trim()
    .toLowerCase();
  const keyword = String(req.query.keyword || "").trim();

  const query = {};
  if (["draft", "published", "hidden"].includes(status)) {
    query.status = status;
  }
  if (["external", "generated"].includes(origin)) {
    query.origin = origin;
  }
  if (keyword) {
    query.$or = [
      { title: { $regex: keyword, $options: "i" } },
      { summary: { $regex: keyword, $options: "i" } },
      { sourceUrl: { $regex: keyword, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    SeoNewsArticle.find(query)
      .sort({ originalPublishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "_id slug title summary sourceName sourceUrl originalPublishedAt createdAt tags origin status review relevanceScore heroImageUrl thumbImageUrl workflow"
      )
      .lean(),
    SeoNewsArticle.countDocuments(query),
  ]);

  return res.json({
    items,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
};

export const pushSeoNewsDraftsToPublished = async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(toNumber(req.body?.limit ?? req.query?.limit) || 20, 1),
      200
    );

    const origin = String(req.body?.origin || req.query?.origin || "external")
      .trim()
      .toLowerCase();

    const onlyCrawledRaw = req.body?.onlyCrawled ?? req.query?.onlyCrawled;
    const onlyCrawled =
      typeof onlyCrawledRaw === "undefined"
        ? origin !== "generated"
        : !(onlyCrawledRaw === false || String(onlyCrawledRaw) === "false");
    const forcePublish =
      req.body?.forcePublish === true || req.query?.forcePublish === "true";

    const settings =
      (await SeoNewsSettings.findOne({ key: "default" }).lean()) ||
      (await SeoNewsSettings.create({ key: "default" }));

    const query = {
      status: "draft",
    };

    if (["external", "generated"].includes(origin)) {
      query.origin = origin;
    }

    if (onlyCrawled) {
      query["workflow.generatorModel"] = "external-digest";
    }

    const draftItems = await SeoNewsArticle.find(query)
      .sort({ originalPublishedAt: -1, createdAt: -1 })
      .limit(limit)
      .select(
        "_id slug title summary contentText tags sourceName sourceUrl language status origin createdAt"
      )
      .lean();

    if (!draftItems.length) {
      return res.json({
        ok: true,
        pushed: 0,
        skipped: 0,
        message: "No draft articles to push",
        items: [],
        skippedItems: [],
      });
    }

    const publishableItems = [];
    const skippedItems = [];

    for (const item of draftItems) {
      if (forcePublish) {
        publishableItems.push(item);
        continue;
      }

      const eligibility = evaluateArticlePublishEligibility(item, settings);
      if (eligibility.ok) {
        publishableItems.push(item);
        continue;
      }

      skippedItems.push({
        _id: item._id,
        slug: item.slug,
        title: item.title,
        reasons: eligibility.reasons,
        relevanceScore: eligibility.relevanceScore,
      });
    }

    const ids = publishableItems.map((x) => x._id);

    if (!ids.length) {
      return res.json({
        ok: true,
        pushed: 0,
        skipped: skippedItems.length,
        forcePublish,
        message: "No draft articles passed publish filters",
        items: [],
        skippedItems,
      });
    }

    await SeoNewsArticle.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: "published",
        },
      }
    );

    return res.json({
      ok: true,
      pushed: ids.length,
      skipped: skippedItems.length,
      forcePublish,
      message: `Pushed ${ids.length} draft article(s) to published`,
      items: publishableItems,
      skippedItems,
    });
  } catch (error) {
    console.error("[SeoNewsAdmin] push drafts failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Push draft articles failed",
      error: error?.message || "internal_error",
    });
  }
};

export const queueSeoNewsPipelineJobNow = async (req, res) => {
  try {
    const rawType = String(req.body?.type || req.query?.type || "pipeline")
      .trim()
      .toLowerCase();

    const type = [
      "pipeline",
      "pending_candidates",
      "create_ready_articles",
    ].includes(rawType)
      ? rawType
      : "pipeline";

    const request = {
      discoveryMode: req.body?.discoveryMode || req.query?.discoveryMode || "",
      rounds: req.body?.rounds ?? req.query?.rounds,
      count: req.body?.count ?? req.query?.count,
      limit: req.body?.limit ?? req.query?.limit,
      forcePublish:
        req.body?.forcePublish ??
        req.query?.forcePublish ??
        req.body?.publish ??
        req.query?.publish,
    };

    const result = await enqueueSeoNewsPipelineJob({
      type,
      request,
      requestedBy: {
        userId: req.user?._id || null,
        name:
          req.user?.name || req.user?.fullName || req.user?.email || "admin",
        email: req.user?.email || "",
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Da tao job worker SEO news",
      ...result,
    });
  } catch (error) {
    console.error("[SeoNewsAdmin] queue pipeline job failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Tao job worker SEO news that bai",
      error: error?.message || "internal_error",
    });
  }
};

export const getSeoNewsPipelineMonitorNow = async (_req, res) => {
  try {
    const monitor = await getSeoNewsPipelineMonitor();
    return res.json(monitor);
  } catch (error) {
    console.error("[SeoNewsAdmin] get pipeline monitor failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Lay monitor worker SEO news that bai",
      error: error?.message || "internal_error",
    });
  }
};

export const runSeoNewsSyncNow = async (req, res) => {
  try {
    const discoveryMode = String(
      req.body?.discoveryMode || req.query?.discoveryMode || ""
    )
      .trim()
      .toLowerCase();

    const validMode = ["auto", "gemini", "openai"].includes(discoveryMode)
      ? discoveryMode
      : undefined;

    const result = await runSeoNewsPipeline({
      discoveryMode: validMode,
      runId: `manual_${Date.now().toString(36)}`,
    });

    return res.json({
      ok: true,
      message: "Da chay pipeline SEO news",
      ...result,
    });
  } catch (error) {
    console.error("[SeoNewsAdmin] run failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Chay pipeline SEO news that bai",
      error: error?.message || "internal_error",
    });
  }
};

export const runSeoNewsPendingCandidates = async (req, res) => {
  try {
    const settings =
      (await SeoNewsSettings.findOne({ key: "default" })) ||
      (await SeoNewsSettings.create({ key: "default" }));

    const pendingCount = await SeoNewsLinkCandidate.countDocuments({
      status: "pending",
    });

    const requestedLimit = toNumber(req.body?.limit ?? req.query?.limit);
    const maxLimit =
      requestedLimit !== undefined
        ? Math.max(1, Math.floor(requestedLimit))
        : pendingCount;

    const runLimit = Math.min(maxLimit, pendingCount);

    if (!runLimit) {
      const crawl = emptyCrawlStats();
      return res.json({
        ok: true,
        message: "Khong co pending candidates de chay",
        pendingBefore: pendingCount,
        processedLimit: 0,
        crawl,
        stats: toPublicStatsFromCrawl(crawl),
      });
    }

    const crawl = await runSeoNewsCrawl({
      limit: runLimit,
      settings,
      runId: `manual_pending_${Date.now().toString(36)}`,
    });

    return res.json({
      ok: true,
      message: "Da chay pending candidates",
      pendingBefore: pendingCount,
      processedLimit: runLimit,
      crawl,
      stats: toPublicStatsFromCrawl(crawl),
    });
  } catch (error) {
    console.error("[SeoNewsAdmin] run pending candidates failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Chay pending candidates that bai",
      error: error?.message || "internal_error",
    });
  }
};

export const createSeoNewsReadyArticlesNow = async (req, res) => {
  try {
    const settings =
      (await SeoNewsSettings.findOne({ key: "default" })) ||
      (await SeoNewsSettings.create({ key: "default" }));

    const count = Math.max(
      1,
      Math.min(toNumber(req.body?.count ?? req.query?.count) || 3, 10)
    );
    const forcePublish =
      req.body?.forcePublish === true ||
      req.query?.forcePublish === "true" ||
      req.body?.publish === true ||
      req.query?.publish === "true";

    const result = await generateSeoNewsEvergreenArticles({
      count,
      settings,
      runId: `manual_ready_${Date.now().toString(36)}`,
      forcePublish,
    });

    return res.json({
      ok: true,
      message: "Da tao san bai AI",
      ...result,
    });
  } catch (error) {
    console.error("[SeoNewsAdmin] create ready articles failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Tao san bai AI that bai",
      error: error?.message || "internal_error",
    });
  }
};

export const cleanupSeoNewsGatewaySourceImagesNow = async (req, res) => {
  try {
    const olderThanMinutes = Math.max(
      0,
      Number(req.body?.olderThanMinutes ?? req.query?.olderThanMinutes) || 0
    );
    const limit = Math.max(
      1,
      Math.min(Number(req.body?.limit ?? req.query?.limit) || 100, 1000)
    );
    const dryRunRaw = req.body?.dryRun ?? req.query?.dryRun;
    const dryRun =
      dryRunRaw === true ||
      String(dryRunRaw || "")
        .trim()
        .toLowerCase() === "true";

    const result = await cleanupSeoNewsGatewaySourceImages({
      olderThanMinutes,
      limit,
      dryRun,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("[SeoNewsAdmin] cleanup source images failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Don source images that bai",
      error: error?.message || "internal_error",
    });
  }
};

export const getSeoNewsImageStats = async (req, res) => {
  try {
    const page = cleanPage(req.query.page, 1);
    const limit = Math.min(cleanPage(req.query.limit, 30), 200);
    const skip = (page - 1) * limit;

    const imageFilter = String(req.query.imageFilter || "")
      .trim()
      .toLowerCase();
    const origin = String(req.query.origin || "")
      .trim()
      .toLowerCase();
    const keyword = String(req.query.keyword || "").trim();
    const forceHealthRefresh =
      req.query.refreshHealth === "true" ||
      (req.query.refreshHealth &&
        req.query.refreshHealth !== "0" &&
        req.query.refreshHealth !== "false");

    // --- aggregate counts ---
    const [
      totalCount,
      hasImageCount,
      pendingImageCount,
      originBreakdown,
      regenerationMonitor,
    ] = await Promise.all([
      SeoNewsArticle.countDocuments({
        status: { $in: ["published", "draft"] },
      }),
      SeoNewsArticle.countDocuments({
        status: { $in: ["published", "draft"] },
        heroImageUrl: {
          $exists: true,
          $ne: null,
          $ne: "",
          $not: /^data:image\//i,
        },
      }),
      SeoNewsArticle.countDocuments({
        status: { $in: ["published", "draft"] },
        $or: [
          { heroImageUrl: { $exists: false } },
          { heroImageUrl: null },
          { heroImageUrl: "" },
          { heroImageUrl: /^data:image\//i },
        ],
      }),
      SeoNewsArticle.aggregate([
        { $match: { status: { $in: ["published", "draft"] } } },
        {
          $project: {
            imageOrigin: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ["$heroImageUrl", null] },
                    { $ne: ["$heroImageUrl", ""] },
                    {
                      $not: {
                        $regexMatch: {
                          input: { $ifNull: ["$heroImageUrl", ""] },
                          regex: /^data:image\//i,
                        },
                      },
                    },
                  ],
                },
                then: {
                  $cond: {
                    if: {
                      $regexMatch: {
                        input: { $ifNull: ["$heroImageUrl", ""] },
                        regex: /^\/uploads\/public\/seo-news\//,
                      },
                    },
                    then: "generated-gateway",
                    else: {
                      $cond: {
                        if: {
                          $regexMatch: {
                            input: { $ifNull: ["$heroImageUrl", ""] },
                            regex: /^https?:\/\//i,
                          },
                        },
                        then: "external",
                        else: "other",
                      },
                    },
                  },
                },
                else: "none",
              },
            },
          },
        },
        { $group: { _id: "$imageOrigin", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      getSeoNewsImageRegenerationMonitor({ forceHealthRefresh }),
    ]);

    // --- build article query with filters ---
    const query = { status: { $in: ["published", "draft"] } };

    if (["external", "generated"].includes(origin)) {
      query.origin = origin;
    }

    if (keyword) {
      query.$or = [
        { title: { $regex: keyword, $options: "i" } },
        { slug: { $regex: keyword, $options: "i" } },
      ];
    }

    if (imageFilter === "pending") {
      const pendingCond = [
        { heroImageUrl: { $exists: false } },
        { heroImageUrl: null },
        { heroImageUrl: "" },
        { heroImageUrl: /^data:image\//i },
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: pendingCond }];
        delete query.$or;
      } else {
        query.$or = pendingCond;
      }
    } else if (imageFilter === "has-image") {
      query.heroImageUrl = {
        $exists: true,
        $ne: null,
        $ne: "",
        $not: /^data:image\//i,
      };
    } else if (imageFilter === "ai-generated") {
      query.heroImageUrl = {
        $regex: /^\/uploads\/public\/seo-news\//,
        $ne: null,
      };
    }

    const [items, filteredTotal] = await Promise.all([
      SeoNewsArticle.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          "_id slug title origin status heroImageUrl thumbImageUrl createdAt tags"
        )
        .lean(),
      SeoNewsArticle.countDocuments(query),
    ]);

    const originMap = {};
    for (const bucket of originBreakdown) {
      originMap[bucket._id || "none"] = bucket.count;
    }

    return res.json({
      summary: {
        total: totalCount,
        hasImage: hasImageCount,
        pendingImage: pendingImageCount,
        byOrigin: originMap,
      },
      regeneration: regenerationMonitor,
      items,
      page,
      limit,
      total: filteredTotal,
      pages: Math.max(1, Math.ceil(filteredTotal / limit)),
    });
  } catch (error) {
    console.error("[SeoNewsAdmin] get image stats failed:", error);
    return res.status(500).json({
      ok: false,
      message: "Lay thong ke anh that bai",
      error: error?.message || "internal_error",
    });
  }
};

export const queueSeoNewsImageRegenerationNow = async (req, res) => {
  try {
    const result = await enqueueSeoNewsImageRegenerationJob({
      filters: {
        imageFilter: req.body?.imageFilter,
        origin: req.body?.origin,
        keyword: req.body?.keyword,
        limit: req.body?.limit,
      },
      requestedBy: {
        userId: req.user?._id || null,
        name:
          req.user?.name || req.user?.fullName || req.user?.email || "admin",
        email: req.user?.email || "",
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Da tao job gen lai anh AI",
      ...result,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    console.error("[SeoNewsAdmin] queue image regeneration failed:", error);
    return res.status(statusCode).json({
      ok: false,
      message: error?.message || "Tao hang cho gen lai anh that bai",
      error: error?.message || "internal_error",
    });
  }
};
