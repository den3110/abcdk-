import SeoNewsArticle from "../models/seoNewsArticleModel.js";
import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import { discoverSeoNewsCandidates } from "./seoNewsDiscoveryService.js";
import { runSeoNewsCrawl } from "./seoNewsCrawlService.js";
import { generateSeoNewsEvergreenArticles } from "./seoNewsEvergreenService.js";

const DEFAULT_TARGET_MIN_PER_DAY = 6;
const DEFAULT_MAX_PER_DAY = 8;
const DEFAULT_DISCOVERY_ROUNDS_PER_RUN = 3;
const DEFAULT_GENERATION_RETRY_ROUNDS = 2;

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function countTodayArticles() {
  return SeoNewsArticle.countDocuments({
    createdAt: { $gte: getStartOfToday() },
  });
}

function emptyDiscoveryStats() {
  return {
    provider: "none",
    total: 0,
    inserted: 0,
    updated: 0,
  };
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

function emptyGenerationStats() {
  return {
    requested: 0,
    generated: 0,
    reviewPassed: 0,
    reviewFailed: 0,
    published: 0,
    draft: 0,
    failed: 0,
    items: [],
  };
}

function mergeDiscoveryStats(base, round) {
  return {
    provider: round?.provider || base.provider || "none",
    total: (base.total || 0) + (round?.total || 0),
    inserted: (base.inserted || 0) + (round?.inserted || 0),
    updated: (base.updated || 0) + (round?.updated || 0),
  };
}

function mergeCrawlStats(base, round) {
  const mergedErrors = { ...(base.errorsByType || {}) };
  for (const [key, value] of Object.entries(round?.errorsByType || {})) {
    mergedErrors[key] = (mergedErrors[key] || 0) + (Number(value) || 0);
  }

  const failedSamples = [
    ...(Array.isArray(base.failedSamples) ? base.failedSamples : []),
    ...(Array.isArray(round?.failedSamples) ? round.failedSamples : []),
  ].slice(0, 10);

  return {
    crawled: (base.crawled || 0) + (round?.crawled || 0),
    skipped: (base.skipped || 0) + (round?.skipped || 0),
    failed: (base.failed || 0) + (round?.failed || 0),
    externalGenerated:
      (base.externalGenerated || 0) + (round?.externalGenerated || 0),
    reviewPassed: (base.reviewPassed || 0) + (round?.reviewPassed || 0),
    reviewFailed: (base.reviewFailed || 0) + (round?.reviewFailed || 0),
    published: (base.published || 0) + (round?.published || 0),
    draft: (base.draft || 0) + (round?.draft || 0),
    errorsByType: mergedErrors,
    failedSamples,
  };
}

function mergeGenerationStats(base, round) {
  return {
    requested: (base.requested || 0) + (round?.requested || 0),
    generated: (base.generated || 0) + (round?.generated || 0),
    reviewPassed: (base.reviewPassed || 0) + (round?.reviewPassed || 0),
    reviewFailed: (base.reviewFailed || 0) + (round?.reviewFailed || 0),
    published: (base.published || 0) + (round?.published || 0),
    draft: (base.draft || 0) + (round?.draft || 0),
    failed: (base.failed || 0) + (round?.failed || 0),
    items: [
      ...(Array.isArray(base.items) ? base.items : []),
      ...(Array.isArray(round?.items) ? round.items : []),
    ],
  };
}

export async function runSeoNewsPipeline({ discoveryMode, runId } = {}) {
  const settings =
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }));

  const beforeWhenDisabled = await countTodayArticles();

  if (!settings.enabled) {
    return {
      ok: true,
      runId: runId || `seo_${Date.now().toString(36)}`,
      message: "SEO news pipeline disabled in settings",
      discovery: emptyDiscoveryStats(),
      crawl: emptyCrawlStats(),
      generation: emptyGenerationStats(),
      stats: {
        externalGenerated: 0,
        evergreenGenerated: 0,
        reviewPassed: 0,
        reviewFailed: 0,
        published: 0,
        draft: 0,
        todayBefore: beforeWhenDisabled,
        todayAfter: beforeWhenDisabled,
        maxArticlesPerDay: Number(settings.maxArticlesPerDay) || DEFAULT_MAX_PER_DAY,
        targetMinPerDay:
          Number(settings.targetArticlesPerDay) || DEFAULT_TARGET_MIN_PER_DAY,
      },
    };
  }

  const currentRunId = runId || `seo_${Date.now().toString(36)}`;
  const maxPerDay = Math.max(
    1,
    Number(settings.maxArticlesPerDay) || DEFAULT_MAX_PER_DAY
  );
  const targetMinPerDay = Math.min(
    maxPerDay,
    Math.max(1, Number(settings.targetArticlesPerDay) || DEFAULT_TARGET_MIN_PER_DAY)
  );

  const todayBefore = await countTodayArticles();

  let discovery = emptyDiscoveryStats();
  let crawl = emptyCrawlStats();

  const remainingBeforeRun = Math.max(0, maxPerDay - todayBefore);
  if (remainingBeforeRun > 0) {
    const maxArticlesPerRound = Math.max(
      1,
      Number(settings.maxArticlesPerRun) || 8
    );
    const maxDiscoveryRounds = Math.max(
      1,
      Math.min(
        5,
        Number(settings.discoveryRoundsPerRun) || DEFAULT_DISCOVERY_ROUNDS_PER_RUN
      )
    );

    let remainingExternal = remainingBeforeRun;

    for (let roundIndex = 0; roundIndex < maxDiscoveryRounds; roundIndex += 1) {
      if (remainingExternal <= 0) break;

      const discoveryRound = await discoverSeoNewsCandidates({
        settings,
        provider: discoveryMode,
      });
      discovery = mergeDiscoveryStats(discovery, discoveryRound);

      const crawlLimit = Math.max(
        1,
        Math.min(maxArticlesPerRound, remainingExternal)
      );
      const crawlRound = await runSeoNewsCrawl({
        limit: crawlLimit,
        settings,
        runId: `${currentRunId}_ext_${roundIndex + 1}`,
      });
      crawl = mergeCrawlStats(crawl, crawlRound);

      const producedExternal = Number(crawlRound?.externalGenerated) || 0;
      remainingExternal = Math.max(0, remainingExternal - producedExternal);

      const noProgress =
        producedExternal <= 0 && (Number(discoveryRound?.inserted) || 0) <= 0;
      if (noProgress) break;
    }
  }

  const todayAfterExternal = await countTodayArticles();
  const remainingForDay = Math.max(0, maxPerDay - todayAfterExternal);
  const missingToTarget = Math.max(0, targetMinPerDay - todayAfterExternal);
  const toGenerate = Math.min(remainingForDay, missingToTarget);

  let generation = emptyGenerationStats();
  if (toGenerate > 0) {
    let remainingGenerate = toGenerate;

    for (
      let attempt = 0;
      attempt < DEFAULT_GENERATION_RETRY_ROUNDS && remainingGenerate > 0;
      attempt += 1
    ) {
      const generationRound = await generateSeoNewsEvergreenArticles({
        count: remainingGenerate,
        settings,
        runId: `${currentRunId}_gen_${attempt + 1}`,
      });
      generation = mergeGenerationStats(generation, generationRound);

      const generatedInRound = Number(generationRound?.generated) || 0;
      remainingGenerate = Math.max(0, remainingGenerate - generatedInRound);

      if (generatedInRound <= 0) break;
    }
  }

  const todayAfter = await countTodayArticles();

  return {
    ok: true,
    runId: currentRunId,
    discoveryMode: discoveryMode || settings.discoveryProvider || "auto",
    discovery,
    crawl,
    generation,
    stats: {
      externalGenerated: crawl.externalGenerated || 0,
      evergreenGenerated: generation.generated || 0,
      reviewPassed: (crawl.reviewPassed || 0) + (generation.reviewPassed || 0),
      reviewFailed: (crawl.reviewFailed || 0) + (generation.reviewFailed || 0),
      published: (crawl.published || 0) + (generation.published || 0),
      draft: (crawl.draft || 0) + (generation.draft || 0),
      todayBefore,
      todayAfter,
      maxArticlesPerDay: maxPerDay,
      targetMinPerDay,
    },
  };
}
