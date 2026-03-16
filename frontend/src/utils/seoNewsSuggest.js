const STORAGE_KEY = "pickletour_seo_news_profile_v1";
const COOKIE_KEY = "pickletour_seo_news_pref_v1";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 45;

const LIMITS = {
  tags: 60,
  sources: 40,
  articles: 320,
  exposure: 400,
  history: 120,
};

function createDefaultProfile() {
  return {
    version: 1,
    updatedAt: 0,
    visits: { list: 0, detail: 0 },
    tags: {},
    origins: { generated: 0, external: 0 },
    sources: {},
    articles: {},
    exposure: {},
    history: [],
  };
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function normalizeTag(value) {
  return normalizeText(value).slice(0, 60);
}

function normalizeSlug(value) {
  return normalizeText(value).replace(/^\/+|\/+$/g, "").slice(0, 160);
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sortMapEntries(mapObj = {}) {
  return Object.entries(mapObj).sort((a, b) => toNumber(b[1]) - toNumber(a[1]));
}

function toTopMap(mapObj = {}, limit = 50) {
  const next = {};
  sortMapEntries(mapObj)
    .slice(0, limit)
    .forEach(([key, value]) => {
      const n = toNumber(value);
      if (n > 0) next[key] = Number(n.toFixed(4));
    });
  return next;
}

function getCookieValue(name) {
  if (!isBrowser()) return "";
  const target = `${name}=`;
  const rows = String(document.cookie || "").split(";");
  for (const row of rows) {
    const item = row.trim();
    if (item.startsWith(target)) {
      return decodeURIComponent(item.slice(target.length));
    }
  }
  return "";
}

function writeCookieValue(name, value) {
  if (!isBrowser()) return;
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

function extractSource(article = {}) {
  const sourceName = normalizeText(article.sourceName);
  if (sourceName) return sourceName;

  const rawUrl = String(article.sourceUrl || "").trim();
  if (!rawUrl) return "";

  try {
    const url = new URL(rawUrl);
    return normalizeText(url.hostname.replace(/^www\./, ""));
  } catch {
    return normalizeText(rawUrl);
  }
}

function extractTags(article = {}) {
  const tags = Array.isArray(article.tags) ? article.tags : [];
  const set = new Set();

  tags.forEach((tag) => {
    const normalized = normalizeTag(tag);
    if (normalized) set.add(normalized);
  });

  return Array.from(set);
}

function getPublishedMs(article = {}) {
  const raw =
    article.originalPublishedAt || article.createdAt || article.updatedAt || null;
  if (!raw) return null;

  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mergeProfile(raw = {}) {
  const profile = createDefaultProfile();

  profile.version = 1;
  profile.updatedAt = toNumber(raw.updatedAt, 0);

  profile.visits.list = toNumber(raw?.visits?.list, 0);
  profile.visits.detail = toNumber(raw?.visits?.detail, 0);

  profile.tags = toTopMap(raw.tags, LIMITS.tags);

  profile.origins.generated = toNumber(raw?.origins?.generated, 0);
  profile.origins.external = toNumber(raw?.origins?.external, 0);

  profile.sources = toTopMap(raw.sources, LIMITS.sources);

  const rawArticles = raw.articles || {};
  const articleRows = Object.entries(rawArticles)
    .filter(([slug]) => normalizeSlug(slug))
    .map(([slug, stats]) => {
      const normalizedSlug = normalizeSlug(slug);
      const nextStats = {
        views: toNumber(stats?.views, 0),
        clicks: toNumber(stats?.clicks, 0),
        dwellSeconds: toNumber(stats?.dwellSeconds, 0),
        lastViewedAt: toNumber(stats?.lastViewedAt, 0),
        lastClickedAt: toNumber(stats?.lastClickedAt, 0),
        lastSeenAt: toNumber(stats?.lastSeenAt, 0),
      };
      const rank =
        nextStats.clicks * 3 +
        nextStats.views * 1.2 +
        nextStats.dwellSeconds / 30 +
        nextStats.lastViewedAt / 1e12;
      return { slug: normalizedSlug, stats: nextStats, rank };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, LIMITS.articles);

  profile.articles = {};
  articleRows.forEach(({ slug, stats }) => {
    profile.articles[slug] = stats;
  });

  profile.exposure = toTopMap(raw.exposure, LIMITS.exposure);

  const history = Array.isArray(raw.history) ? raw.history : [];
  profile.history = history
    .map((item) => ({
      slug: normalizeSlug(item?.slug),
      action: normalizeText(item?.action),
      at: toNumber(item?.at, 0),
    }))
    .filter((item) => item.slug && item.action && item.at > 0)
    .slice(-LIMITS.history);

  return profile;
}

function hydrateFromCookie(profile) {
  const compact = safeJsonParse(getCookieValue(COOKIE_KEY));
  if (!compact) return profile;

  if (Object.keys(profile.tags).length === 0 && Array.isArray(compact.topTags)) {
    compact.topTags.forEach((tag) => {
      const normalized = normalizeTag(tag);
      if (normalized) {
        profile.tags[normalized] = toNumber(profile.tags[normalized], 0) + 0.45;
      }
    });
  }

  const topOrigin = normalizeText(compact.topOrigin);
  if (topOrigin === "generated" || topOrigin === "external") {
    profile.origins[topOrigin] = toNumber(profile.origins[topOrigin], 0) + 0.35;
  }

  const topSource = normalizeText(compact.topSource);
  if (topSource && Object.keys(profile.sources).length < 5) {
    profile.sources[topSource] = toNumber(profile.sources[topSource], 0) + 0.35;
  }

  return profile;
}

function loadProfile() {
  if (!isBrowser()) return createDefaultProfile();

  let raw = null;
  try {
    raw = safeJsonParse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    raw = null;
  }

  const merged = mergeProfile(raw || {});
  return hydrateFromCookie(merged);
}

function saveProfile(profile) {
  if (!isBrowser()) return;

  const next = mergeProfile({
    ...profile,
    updatedAt: Date.now(),
  });

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write failures in restricted browsing contexts.
  }

  const topTags = sortMapEntries(next.tags)
    .slice(0, 6)
    .map(([key]) => key);
  const topOrigin = sortMapEntries(next.origins)
    .find(([, value]) => toNumber(value) > 0)?.[0];
  const topSource = sortMapEntries(next.sources)
    .find(([, value]) => toNumber(value) > 0)?.[0];

  writeCookieValue(
    COOKIE_KEY,
    JSON.stringify({
      topTags,
      topOrigin: topOrigin || "",
      topSource: topSource || "",
      updatedAt: next.updatedAt,
    })
  );
}

function addMapWeight(mapObj, key, delta) {
  const normalized = normalizeText(key);
  if (!normalized || !Number.isFinite(delta)) return;
  mapObj[normalized] = Math.max(0, toNumber(mapObj[normalized], 0) + delta);
}

function ensureArticleStats(profile, slug) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return null;

  if (!profile.articles[normalizedSlug]) {
    profile.articles[normalizedSlug] = {
      views: 0,
      clicks: 0,
      dwellSeconds: 0,
      lastViewedAt: 0,
      lastClickedAt: 0,
      lastSeenAt: 0,
    };
  }

  return profile.articles[normalizedSlug];
}

function appendHistory(profile, slug, action) {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedAction = normalizeText(action);
  if (!normalizedSlug || !normalizedAction) return;

  profile.history.push({
    slug: normalizedSlug,
    action: normalizedAction,
    at: Date.now(),
  });

  if (profile.history.length > LIMITS.history) {
    profile.history = profile.history.slice(-LIMITS.history);
  }
}

function applyAffinity(profile, article, strength = 1) {
  if (!article || !Number.isFinite(strength) || strength <= 0) return;

  extractTags(article).forEach((tag) => {
    addMapWeight(profile.tags, tag, 0.9 * strength);
  });

  const origin = normalizeText(article.origin);
  if (origin === "generated" || origin === "external") {
    addMapWeight(profile.origins, origin, 0.75 * strength);
  }

  const source = extractSource(article);
  if (source) {
    addMapWeight(profile.sources, source, 0.65 * strength);
  }
}

export function trackSeoNewsListImpression(items = [], options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  const profile = loadProfile();
  profile.visits.list = toNumber(profile.visits.list, 0) + 1;

  const now = Date.now();
  list.forEach((item) => {
    const slug = normalizeSlug(item?.slug);
    if (!slug) return;

    const stats = ensureArticleStats(profile, slug);
    if (!stats) return;

    stats.lastSeenAt = now;
    profile.exposure[slug] = toNumber(profile.exposure[slug], 0) + 1;
  });

  const surface = normalizeText(options.surface || "list");
  if (surface) appendHistory(profile, `surface:${surface}`, "impression");

  saveProfile(profile);
}

export function trackSeoNewsClick(article, options = {}) {
  const slug = normalizeSlug(article?.slug);
  if (!slug) return;

  const profile = loadProfile();
  const stats = ensureArticleStats(profile, slug);
  if (!stats) return;

  stats.clicks = toNumber(stats.clicks, 0) + 1;
  stats.lastClickedAt = Date.now();

  applyAffinity(profile, article, 1.35);

  const surface = normalizeText(options.surface || "list");
  appendHistory(profile, slug, `click:${surface || "list"}`);

  saveProfile(profile);
}

export function startSeoNewsReadingSession(article, options = {}) {
  const slug = normalizeSlug(article?.slug);
  if (!slug) {
    return () => {};
  }

  const profile = loadProfile();
  const stats = ensureArticleStats(profile, slug);
  if (stats) {
    stats.views = toNumber(stats.views, 0) + 1;
    stats.lastViewedAt = Date.now();
  }

  profile.visits.detail = toNumber(profile.visits.detail, 0) + 1;
  applyAffinity(profile, article, 1.1);

  const surface = normalizeText(options.surface || "detail");
  appendHistory(profile, slug, `open:${surface || "detail"}`);

  saveProfile(profile);

  const startedAt = Date.now();

  return () => {
    const durationSec = Math.floor((Date.now() - startedAt) / 1000);
    if (durationSec < 5) return;

    const latest = loadProfile();
    const latestStats = ensureArticleStats(latest, slug);
    if (!latestStats) return;

    latestStats.dwellSeconds = toNumber(latestStats.dwellSeconds, 0) + Math.min(1800, durationSec);

    const dwellBoost = Math.min(3.2, Math.log1p(durationSec / 12));
    applyAffinity(latest, article, dwellBoost);
    appendHistory(latest, slug, "dwell");
    saveProfile(latest);
  };
}

function stableNoise(input) {
  const text = String(input || "seed");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  const value = Math.abs(hash % 1000);
  return value / 1000;
}

function calcArticleScore(article, profile, contextArticle = null) {
  const slug = normalizeSlug(article?.slug);
  const stats = profile.articles[slug] || {};

  const views = toNumber(stats.views, 0);
  const clicks = toNumber(stats.clicks, 0);
  const dwellSeconds = toNumber(stats.dwellSeconds, 0);
  const exposure = toNumber(profile.exposure[slug], 0);

  const tags = extractTags(article);
  const matchedTags = tags.filter((tag) => toNumber(profile.tags[tag], 0) > 0);

  const tagAffinityRaw = matchedTags.reduce(
    (acc, tag) => acc + toNumber(profile.tags[tag], 0),
    0
  );
  const tagAffinity = Math.min(8, tagAffinityRaw * 0.75);

  const origin = normalizeText(article?.origin);
  const originAffinity = Math.min(3, toNumber(profile.origins[origin], 0) * 0.65);

  const source = extractSource(article);
  const sourceAffinity = Math.min(2.8, toNumber(profile.sources[source], 0) * 0.6);

  const qualityBoost = Math.max(0, Math.min(1, toNumber(article?.review?.score, 0))) * 1.5;

  const publishedMs = getPublishedMs(article);
  const ageHours = publishedMs ? Math.max(0, (Date.now() - publishedMs) / 3600000) : 9999;
  const recencyBoost = Math.max(0.15, 2.25 * Math.exp(-ageHours / 200));

  const localPopularity = Math.min(
    3.8,
    Math.log1p(clicks * 1.5 + views * 0.7 + dwellSeconds / 40)
  );

  const ctrBoost = exposure > 0 ? Math.min(1.9, (clicks / exposure) * 4.5) : 0;
  const seenPenalty = views > 0 ? Math.min(2.8, views * 0.45) : 0;

  let contextBoost = 0;
  let contextOverlap = 0;
  if (contextArticle) {
    const contextTags = extractTags(contextArticle);
    contextOverlap = tags.filter((tag) => contextTags.includes(tag)).length;
    contextBoost += Math.min(3.4, contextOverlap * 1.15);

    if (origin && origin === normalizeText(contextArticle.origin)) {
      contextBoost += 0.35;
    }

    if (source && source === extractSource(contextArticle)) {
      contextBoost += 0.7;
    }
  }

  const daySeed = new Date().toISOString().slice(0, 10);
  const explorationBoost = stableNoise(`${slug}_${daySeed}`) * 0.75;

  const score =
    tagAffinity +
    originAffinity +
    sourceAffinity +
    qualityBoost +
    recencyBoost +
    localPopularity +
    ctrBoost +
    contextBoost +
    explorationBoost -
    seenPenalty;

  return {
    score,
    matchedTags,
    contextOverlap,
    recencyBoost,
    localPopularity,
  };
}

function reasonFromSignals(signals, language = "en") {
  const isEnglish = String(language || "").toLowerCase() === "en";
  const topTags = signals.matchedTags.slice(0, 2);

  if (signals.contextOverlap > 0 && topTags.length > 0) {
    return isEnglish
      ? `Related + matches ${topTags.join(", ")}`
      : `Liên quan + hợp gu ${topTags.join(", ")}`;
  }

  if (signals.contextOverlap > 0) {
    return isEnglish
      ? "Related to what you are reading"
      : "Liên quan đến bài bạn đang đọc";
  }

  if (topTags.length > 0) {
    return isEnglish
      ? `Matches your interests: ${topTags.join(", ")}`
      : `Hợp với mối quan tâm của bạn: ${topTags.join(", ")}`;
  }

  if (signals.recencyBoost >= 1.25) {
    return isEnglish ? "Fresh article" : "Bài viết mới";
  }

  if (signals.localPopularity >= 1.15) {
    return isEnglish
      ? "You often read similar posts"
      : "Bạn thường đọc các bài tương tự";
  }

  return isEnglish ? "Recommended to explore" : "Đề xuất để khám phá";
}

function selectDiversified(scored, limit) {
  const selected = [];
  const selectedSlugs = new Set();
  const byOrigin = {};
  const bySource = {};

  const originCap = Math.max(2, Math.ceil(limit * 0.7));

  for (const item of scored) {
    if (selected.length >= limit) break;

    const slug = normalizeSlug(item?.article?.slug);
    if (!slug || selectedSlugs.has(slug)) continue;

    const origin = normalizeText(item?.article?.origin) || "unknown";
    const source = extractSource(item?.article) || "unknown";

    const tooManyOrigin = toNumber(byOrigin[origin], 0) >= originCap;
    const tooManySource =
      source !== "unknown" && toNumber(bySource[source], 0) >= 2;

    if (selected.length < Math.max(2, limit - 2) && (tooManyOrigin || tooManySource)) {
      continue;
    }

    selected.push(item);
    selectedSlugs.add(slug);
    byOrigin[origin] = toNumber(byOrigin[origin], 0) + 1;
    bySource[source] = toNumber(bySource[source], 0) + 1;
  }

  if (selected.length < limit) {
    for (const item of scored) {
      if (selected.length >= limit) break;
      const slug = normalizeSlug(item?.article?.slug);
      if (!slug || selectedSlugs.has(slug)) continue;
      selected.push(item);
      selectedSlugs.add(slug);
    }
  }

  return selected;
}

export function getSuggestedSeoNews(articles = [], options = {}) {
  const list = Array.isArray(articles) ? articles : [];
  if (!list.length) return [];

  const profile = loadProfile();

  const limit = Math.max(1, Math.min(12, toNumber(options.limit, 6)));
  const contextArticle = options.contextArticle || null;
  const language = String(options.language || "en").toLowerCase();

  const exclude = new Set();
  const currentSlug = normalizeSlug(options.currentSlug);
  if (currentSlug) exclude.add(currentSlug);

  if (Array.isArray(options.excludeSlugs)) {
    options.excludeSlugs.forEach((slug) => {
      const normalized = normalizeSlug(slug);
      if (normalized) exclude.add(normalized);
    });
  }

  const poolMap = new Map();
  list.forEach((item) => {
    const slug = normalizeSlug(item?.slug);
    if (!slug || exclude.has(slug)) return;
    if (!poolMap.has(slug)) {
      poolMap.set(slug, item);
    }
  });

  const scored = Array.from(poolMap.values())
    .map((article) => {
      const signals = calcArticleScore(article, profile, contextArticle);
      return {
        article,
        score: signals.score,
        reason: reasonFromSignals(signals, language),
      };
    })
    .sort((a, b) => b.score - a.score);

  const selected = selectDiversified(scored, limit);

  return selected.map((item) => ({
    ...item.article,
    __suggestScore: Number(item.score.toFixed(4)),
    __suggestReason: item.reason,
  }));
}

export function clearSeoNewsSuggestProfile() {
  if (!isBrowser()) return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failure.
  }

  writeCookieValue(COOKIE_KEY, JSON.stringify({}));
}
