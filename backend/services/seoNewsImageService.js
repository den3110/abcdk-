import fs from "fs/promises";
import path from "path";
import axios from "axios";
import crypto from "crypto";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import sharp from "sharp";
import slugify from "slugify";

import SeoNewsArticle from "../models/seoNewsArticleModel.js";
import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import { openai } from "../lib/openaiClient.js";

const OPENVERSE_ENDPOINT =
  process.env.SEO_NEWS_IMAGE_OPENVERSE_ENDPOINT ||
  "https://api.openverse.engineering/v1/images/";
const OPENVERSE_TIMEOUT_MS = Math.max(
  1500,
  Number(process.env.SEO_NEWS_IMAGE_TIMEOUT_MS) || 5000
);
const ENABLE_OPENVERSE_SEARCH =
  String(process.env.SEO_NEWS_IMAGE_SEARCH_DISABLED || "false").toLowerCase() !==
  "true";
const GATEWAY_IMAGE_MODEL =
  process.env.SEO_NEWS_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
const GATEWAY_IMAGE_SIZE = process.env.SEO_NEWS_IMAGE_SIZE || "1792x1024";
const GATEWAY_IMAGE_QUALITY = process.env.SEO_NEWS_IMAGE_QUALITY || "hd";
const GATEWAY_IMAGE_STYLE = process.env.SEO_NEWS_IMAGE_STYLE || "natural";
const GATEWAY_IMAGE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.SEO_NEWS_IMAGE_GENERATION_TIMEOUT_MS) || 180_000
);
const SEO_NEWS_IMAGE_GATEWAY_BASE_URL = String(
  process.env.SEO_NEWS_IMAGE_GATEWAY_BASE_URL || ""
).trim();
const SEO_NEWS_IMAGE_GATEWAY_API_KEY =
  process.env.SEO_NEWS_IMAGE_GATEWAY_API_KEY ||
  process.env.CATGPT_GATEWAY_API_KEY ||
  "";
const LOCAL_GATEWAY_FALLBACK_BASE_URL =
  process.env.SEO_NEWS_IMAGE_LOCAL_GATEWAY_BASE_URL || "http://localhost:8000/v1";
const LOCAL_GATEWAY_FALLBACK_API_KEY =
  process.env.SEO_NEWS_IMAGE_LOCAL_GATEWAY_API_KEY ||
  process.env.CATGPT_GATEWAY_API_KEY ||
  "dummy123";
const GENERATED_IMAGE_OUTPUT_DIR = path.resolve("uploads/public/seo-news");
const GENERATED_IMAGE_URL_PREFIX = "/uploads/public/seo-news";
const BACKGROUND_IMAGE_BATCH_SIZE = Math.max(
  1,
  Number(process.env.SEO_NEWS_BACKGROUND_IMAGE_BATCH_SIZE) || 2
);
const SOURCE_IMAGE_CLEANUP_ENABLED =
  String(process.env.SEO_NEWS_GATEWAY_SOURCE_IMAGE_CLEANUP_ENABLED || "true").toLowerCase() !==
  "false";
const GATEWAY_SOURCE_IMAGE_ROOTS = [
  process.env.SEO_NEWS_GATEWAY_SOURCE_IMAGE_DIR,
  process.env.CATGPT_GATEWAY_IMAGES_DIR,
  process.env.CATGPT_GATEWAY_PROJECT_DIR
    ? path.join(process.env.CATGPT_GATEWAY_PROJECT_DIR, "downloads", "images")
    : null,
].filter(Boolean);

const backgroundBackfillQueue = new Set();
let backgroundBackfillRunning = false;

function safeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeSearchText(value) {
  return safeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function isDataImageUrl(value) {
  return /^data:image\//i.test(String(value || "").trim());
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function normalizeMaybeImageUrl(value, baseUrl) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (isDataImageUrl(raw)) {
    return null;
  }

  if (raw.startsWith("/uploads/")) {
    return raw;
  }

  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (!baseUrl) return null;

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchSourceOgImageUrl(pageUrl) {
  const target = safeText(pageUrl);
  if (!target || !/^https?:\/\//i.test(target)) return null;

  try {
    const response = await axios.get(target, {
      timeout: OPENVERSE_TIMEOUT_MS,
      maxRedirects: 4,
      headers: {
        "User-Agent": "PickleTourSeoNewsBot/1.0 (+https://pickletour.vn)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const html = String(response?.data || "");
    if (!html) return null;

    const $ = cheerio.load(html);
    const og =
      $("meta[property='og:image:secure_url']").attr("content") ||
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      null;

    return normalizeMaybeImageUrl(og, target);
  } catch {
    return null;
  }
}

function buildSearchQuery({ title, summary, tags }) {
  const ordered = [];
  const seen = new Set();

  const pushToken = (token) => {
    if (!token) return;
    const normalized = token.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(token);
  };

  pushToken("pickleball");
  pushToken("sports");

  const allTokens = [
    ...tokenize(title).slice(0, 10),
    ...tokenize(summary).slice(0, 10),
    ...(Array.isArray(tags) ? tags : [])
      .flatMap((tag) => tokenize(tag))
      .slice(0, 8),
  ];

  allTokens.forEach(pushToken);

  return ordered.slice(0, 8).join(" ").trim();
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTitleLines(title) {
  const words = safeText(title).split(" ").filter(Boolean);
  if (!words.length) return ["PickleTour News"];

  const lines = [];
  let current = "";

  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (trial.length <= 34) {
      current = trial;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= 2) break;
  }

  if (current && lines.length < 2) lines.push(current);
  if (!lines.length) lines.push("PickleTour News");

  return lines.slice(0, 2);
}

function buildThemeFromTitle(title) {
  const hash = crypto.createHash("md5").update(safeText(title)).digest("hex");
  const base = parseInt(hash.slice(0, 2), 16);
  const accent = parseInt(hash.slice(2, 4), 16);

  const hueA = Math.round((base / 255) * 360);
  const hueB = Math.round((accent / 255) * 360);

  return {
    bgA: `hsl(${hueA}, 72%, 36%)`,
    bgB: `hsl(${hueB}, 82%, 48%)`,
    glow: `hsla(${hueB}, 95%, 58%, 0.34)`,
  };
}

export function buildGeneratedSeoNewsImageDataUrl({
  title,
  summary,
  tags,
  origin,
} = {}) {
  const lines = buildTitleLines(title);
  const chips = (Array.isArray(tags) ? tags : [])
    .map((tag) => safeText(tag))
    .filter(Boolean)
    .slice(0, 3)
    .join("  |  ");
  const subtitle = safeText(summary).slice(0, 120);
  const tone = String(origin || "generated") === "generated" ? "AI" : "Digest";
  const theme = buildThemeFromTitle(title);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="PickleTour News cover">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${theme.bgA}" />
      <stop offset="100%" stop-color="${theme.bgB}" />
    </linearGradient>
    <filter id="blur">
      <feGaussianBlur stdDeviation="42" />
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <circle cx="1030" cy="110" r="180" fill="${theme.glow}" filter="url(#blur)" />
  <circle cx="180" cy="560" r="220" fill="rgba(255,255,255,0.09)" filter="url(#blur)" />

  <rect x="78" y="60" width="220" height="42" rx="21" fill="rgba(255,255,255,0.18)" />
  <text x="188" y="88" text-anchor="middle" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="19" font-weight="700">PickleTour ${escapeXml(
    tone
  )}</text>

  <text x="80" y="222" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="58" font-weight="800">
    ${escapeXml(lines[0] || "PickleTour News")}
  </text>
  <text x="80" y="292" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="58" font-weight="800">
    ${escapeXml(lines[1] || "")}
  </text>

  <text x="80" y="362" fill="rgba(255,255,255,0.95)" font-family="Inter, Arial, sans-serif" font-size="29" font-weight="500">
    ${escapeXml(subtitle || "Tin tuc pickleball duoc tong hop tu dong")}
  </text>

  <line x1="80" y1="408" x2="1120" y2="408" stroke="rgba(255,255,255,0.34)" stroke-width="2" />

  <text x="80" y="462" fill="rgba(255,255,255,0.98)" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600">
    ${escapeXml(chips || "pickleball  |  pickletour  |  news")}
  </text>

  <text x="80" y="578" fill="rgba(255,255,255,0.85)" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="600">
    pickletour.vn/news
  </text>
</svg>
`.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildGatewayImageScene({ title, tags }) {
  const haystack = normalizeSearchText(
    `${safeText(title)} ${(Array.isArray(tags) ? tags.join(" ") : "").trim()}`
  );

  if (
    /(website|seo|dang ky|register|registration|livestream|stream|bracket|schedule|result|ranking|xep hang|quan ly|management|content|media|truyen thong)/.test(
      haystack
    )
  ) {
    return "A premium pickleball tournament operations scene with organizers reviewing a registration dashboard on a laptop and tablet beside a court, polished sports-tech atmosphere, subtle human action in the background.";
  }

  if (
    /(huong dan|beginner|newbie|tips|practice|drill|chien thuat|strategy|kinh nghiem|coach|coaching|luat|rule)/.test(
      haystack
    )
  ) {
    return "A premium editorial pickleball coaching scene with players practicing dinks and volleys on a bright modern court, realistic movement, crisp details, magazine-quality lighting.";
  }

  return "A premium editorial pickleball action scene with confident athletes, dynamic movement, clean modern composition, and tournament atmosphere.";
}

function buildGatewayImagePrompt({ title, summary, tags, origin }) {
  const scene = buildGatewayImageScene({ title, tags });
  const chips = (Array.isArray(tags) ? tags : [])
    .map((tag) => safeText(tag))
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");
  const articleTone =
    String(origin || "generated") === "generated"
      ? "This image is for an AI-authored evergreen news article."
      : "This image is for a short editorial digest article.";

  return [
    "Create a high-end website hero image for a Vietnamese pickleball news article.",
    articleTone,
    `Headline theme: ${safeText(title) || "Pickleball news"}`,
    summary ? `Context: ${safeText(summary).slice(0, 260)}` : null,
    chips ? `Keywords: ${chips}` : null,
    `Scene direction: ${scene}`,
    "Style: realistic editorial photography with premium color grading, modern sports magazine aesthetic, clean depth, sharp subject focus.",
    "Composition: wide landscape hero image, dramatic but believable, suitable for a homepage news card and article header.",
    "Do not include any text, letters, logos, watermarks, trophies with text, UI screenshots, split panels, or collage layout.",
  ]
    .filter(Boolean)
    .join("\n");
}

function makeGeneratedImageBaseName(title, articleKey) {
  const safeSlug =
    slugify(safeText(articleKey || title || "seo-news"), {
      lower: true,
      strict: true,
      locale: "vi",
    }).slice(0, 72) || "seo-news";

  return safeSlug;
}

async function saveGatewayImageToPublicDir({ imageBase64, title, articleKey }) {
  const rawBuffer = Buffer.from(String(imageBase64 || ""), "base64");
  if (!rawBuffer.length) return null;

  await fs.mkdir(GENERATED_IMAGE_OUTPUT_DIR, { recursive: true });

  const fileStem = makeGeneratedImageBaseName(title, articleKey);
  const hash = crypto.createHash("sha256").update(rawBuffer).digest("hex").slice(0, 12);
  const jpgFileName = `${fileStem}-${hash}.jpg`;
  const jpgFilePath = path.join(GENERATED_IMAGE_OUTPUT_DIR, jpgFileName);

  try {
    await fs.access(jpgFilePath);
    return `${GENERATED_IMAGE_URL_PREFIX}/${jpgFileName}`;
  } catch {
    // Continue and write the file.
  }

  try {
    const outputBuffer = await sharp(rawBuffer)
      .rotate()
      .resize(1200, 630, {
        fit: "cover",
        position: "attention",
      })
      .jpeg({
        quality: 86,
        mozjpeg: true,
      })
      .toBuffer();

    await fs.writeFile(jpgFilePath, outputBuffer);
    return `${GENERATED_IMAGE_URL_PREFIX}/${jpgFileName}`;
  } catch (error) {
    const pngFileName = `${fileStem}-${hash}.png`;
    const pngFilePath = path.join(GENERATED_IMAGE_OUTPUT_DIR, pngFileName);
    await fs.writeFile(pngFilePath, rawBuffer);
    console.warn(
      "[SeoNewsImage] sharp normalize failed, saved raw image:",
      error?.message || error
    );
    return `${GENERATED_IMAGE_URL_PREFIX}/${pngFileName}`;
  }
}

function isLocalGatewayBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return false;

  try {
    const parsed = new URL(raw);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return /localhost|127\.0\.0\.1/i.test(raw);
  }
}

function getPrimaryGatewayBaseUrl() {
  return SEO_NEWS_IMAGE_GATEWAY_BASE_URL || String(process.env.CLIPROXY_BASE_URL || "").trim();
}

function getPrimaryGatewayApiKey() {
  return (
    SEO_NEWS_IMAGE_GATEWAY_API_KEY ||
    process.env.CLIPROXY_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function getPrimaryGatewayClient() {
  if (SEO_NEWS_IMAGE_GATEWAY_BASE_URL) {
    const apiKey = getPrimaryGatewayApiKey();
    if (!apiKey) return null;

    return new OpenAI({
      apiKey,
      baseURL: SEO_NEWS_IMAGE_GATEWAY_BASE_URL,
      timeout: GATEWAY_IMAGE_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  return openai;
}

function buildGatewayCleanupEndpoint(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!isHttpUrl(raw)) return null;

  try {
    const parsed = new URL(raw);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = `${normalizedPath}/images/cleanup`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return `${raw.replace(/\/+$/, "")}/images/cleanup`;
  }
}

function isManagedGatewayLocalPath(filePath) {
  const raw = String(filePath || "").trim();
  if (!raw || isHttpUrl(raw) || isDataImageUrl(raw)) return false;

  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    return false;
  }

  const normalized = resolved.toLowerCase();
  const configuredRoots = GATEWAY_SOURCE_IMAGE_ROOTS.map((item) =>
    path.resolve(item).toLowerCase()
  );

  if (configuredRoots.some((root) => normalized.startsWith(root + path.sep) || normalized === root)) {
    return true;
  }

  return (
    normalized.includes(`${path.sep}downloads${path.sep}images${path.sep}`) ||
    normalized.endsWith(`${path.sep}downloads${path.sep}images`)
  );
}

async function readGatewayGeneratedImageBytes(sourceUrl) {
  const raw = String(sourceUrl || "").trim();
  if (!raw) return null;

  if (!isHttpUrl(raw) && isManagedGatewayLocalPath(raw)) {
    const bytes = await fs.readFile(path.resolve(raw));
    return {
      bytes,
      sourceLocalPath: path.resolve(raw),
    };
  }

  if (isHttpUrl(raw)) {
    const response = await axios.get(raw, {
      responseType: "arraybuffer",
      timeout: GATEWAY_IMAGE_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return {
      bytes: Buffer.from(response.data),
      sourceLocalPath: null,
    };
  }

  return null;
}

async function cleanupGatewaySourceImage(sourceLocalPath) {
  if (!SOURCE_IMAGE_CLEANUP_ENABLED) return false;

  const target = String(sourceLocalPath || "").trim();
  if (!isManagedGatewayLocalPath(target)) return false;

  try {
    await fs.unlink(path.resolve(target));
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(
        "[SeoNewsImage] failed to cleanup gateway source image:",
        error?.message || error
      );
    }
    return false;
  }
}

function shouldGenerateGatewayCover({ origin, settings }) {
  const fallbackEnabled = settings?.imageFallbackEnabled !== false;
  return fallbackEnabled && String(origin || "generated") === "generated";
}

async function generateGatewaySeoNewsImage({
  title,
  summary,
  tags,
  origin,
  articleKey,
  settings,
} = {}) {
  if (!shouldGenerateGatewayCover({ origin, settings })) {
    return null;
  }

  const primaryClient = getPrimaryGatewayClient();
  const primaryBaseUrl = getPrimaryGatewayBaseUrl();
  const hasApiKey = !!getPrimaryGatewayApiKey();

  if (!hasApiKey || typeof primaryClient?.images?.generate !== "function") {
    return null;
  }

  const requestBody = {
    model: GATEWAY_IMAGE_MODEL,
    prompt: buildGatewayImagePrompt({ title, summary, tags, origin }),
    n: 1,
    size: settings?.imageGenerationSize || GATEWAY_IMAGE_SIZE,
    quality: settings?.imageGenerationQuality || GATEWAY_IMAGE_QUALITY,
    style: settings?.imageGenerationStyle || GATEWAY_IMAGE_STYLE,
  };

  const tryGenerate = async (client, { responseFormat = "b64_json" } = {}) => {
    const response = await client
      .withOptions({
        timeout: GATEWAY_IMAGE_TIMEOUT_MS,
        maxRetries: 1,
      })
      .images.generate({
        ...requestBody,
        response_format: responseFormat,
      });

    const imageData = Array.isArray(response?.data) ? response.data[0] : null;
    let imageBytes = null;
    let sourceLocalPath = null;

    if (responseFormat === "url") {
      const loaded = await readGatewayGeneratedImageBytes(imageData?.url);
      imageBytes = loaded?.bytes || null;
      sourceLocalPath = loaded?.sourceLocalPath || null;
    } else {
      const imageBase64 = String(imageData?.b64_json || "").trim();
      if (imageBase64) {
        imageBytes = Buffer.from(imageBase64, "base64");
      }
    }

    if (!imageBytes?.length) {
      return null;
    }

    const publicUrl = await saveGatewayImageToPublicDir({
      imageBase64: imageBytes.toString("base64"),
      title,
      articleKey,
    });
    if (!publicUrl) {
      return null;
    }

    if (sourceLocalPath) {
      await cleanupGatewaySourceImage(sourceLocalPath);
    }

    return {
      heroImageUrl: publicUrl,
      thumbImageUrl: publicUrl,
      imageOrigin: "generated-gateway",
      revisedPrompt: imageData?.revised_prompt || requestBody.prompt,
    };
  };

  try {
    const primaryResult = await tryGenerate(primaryClient, {
      responseFormat: isLocalGatewayBaseUrl(primaryBaseUrl) ? "url" : "b64_json",
    });
    if (primaryResult) {
      return primaryResult;
    }
  } catch (error) {
    const currentBaseUrl = String(primaryBaseUrl || "").trim();
    const shouldTryLocalFallback =
      /connection error/i.test(String(error?.message || "")) &&
      LOCAL_GATEWAY_FALLBACK_BASE_URL &&
      currentBaseUrl !== LOCAL_GATEWAY_FALLBACK_BASE_URL;

    if (!shouldTryLocalFallback) {
      console.warn(
        "[SeoNewsImage] gateway generation failed:",
        error?.message || error
      );
      return null;
    }

    const fallbackClient = new OpenAI({
      apiKey: LOCAL_GATEWAY_FALLBACK_API_KEY,
      baseURL: LOCAL_GATEWAY_FALLBACK_BASE_URL,
      timeout: GATEWAY_IMAGE_TIMEOUT_MS,
      maxRetries: 1,
    });

    try {
      const fallbackResult = await tryGenerate(fallbackClient, {
        responseFormat: "url",
      });
      if (fallbackResult) {
        return fallbackResult;
      }
    } catch (fallbackError) {
      console.warn(
        "[SeoNewsImage] gateway generation failed:",
        fallbackError?.message || fallbackError
      );
      return null;
    }
  }

  return null;
}

async function searchOpenverseImageUrl(query, { searchEnabled = true } = {}) {
  if (!ENABLE_OPENVERSE_SEARCH || searchEnabled === false) return null;
  const q = safeText(query);
  if (!q) return null;

  try {
    const response = await axios.get(OPENVERSE_ENDPOINT, {
      params: {
        q,
        page_size: 10,
      },
      timeout: OPENVERSE_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const results = Array.isArray(response?.data?.results)
      ? response.data.results
      : [];

    for (const item of results) {
      const candidate =
        normalizeMaybeImageUrl(item?.url) ||
        normalizeMaybeImageUrl(item?.thumbnail);
      if (!candidate) continue;

      const lower = candidate.toLowerCase();
      if (
        lower.endsWith(".svg") ||
        lower.includes("/icon") ||
        lower.includes("logo")
      ) {
        continue;
      }

      return candidate;
    }
  } catch {
    // Ignore search failures and fallback to other image sources.
  }

  return null;
}

export async function resolveSeoNewsImages({
  title,
  summary,
  tags,
  sourceUrl,
  origin,
  preferredImageUrl,
  settings,
  articleKey,
} = {}) {
  const preferred =
    normalizeMaybeImageUrl(preferredImageUrl, sourceUrl) || null;
  if (preferred) {
    return {
      heroImageUrl: preferred,
      thumbImageUrl: preferred,
      imageOrigin: "preferred",
    };
  }

  if (sourceUrl) {
    const ogImage = await fetchSourceOgImageUrl(sourceUrl);
    if (ogImage) {
      return {
        heroImageUrl: ogImage,
        thumbImageUrl: ogImage,
        imageOrigin: "source-og",
      };
    }
  }

  const gatewayImage = await generateGatewaySeoNewsImage({
    title,
    summary,
    tags,
    origin,
    articleKey,
    settings,
  });
  if (gatewayImage?.heroImageUrl || gatewayImage?.thumbImageUrl) {
    return gatewayImage;
  }

  const imageSearchEnabled = settings?.imageSearchEnabled !== false;
  const query = buildSearchQuery({ title, summary, tags });
  const searchedImage = normalizeMaybeImageUrl(
    await searchOpenverseImageUrl(query, { searchEnabled: imageSearchEnabled })
  );
  if (searchedImage) {
    return {
      heroImageUrl: searchedImage,
      thumbImageUrl: searchedImage,
      imageOrigin: "openverse",
    };
  }

  return {
    heroImageUrl: null,
    thumbImageUrl: null,
    imageOrigin: "none",
  };
}

function hasRenderableImageUrl(value) {
  const raw = String(value || "").trim();
  return !!raw && !isDataImageUrl(raw);
}

export function hasPendingSeoNewsImage(article = {}) {
  return (
    String(article?.origin || "") === "generated" &&
    !hasRenderableImageUrl(article?.heroImageUrl) &&
    !hasRenderableImageUrl(article?.thumbImageUrl)
  );
}

function needsArticleImageBackfill(article = {}, force = false) {
  if (force) return true;

  const heroOk = hasRenderableImageUrl(article.heroImageUrl);
  const thumbOk = hasRenderableImageUrl(article.thumbImageUrl);

  return !(heroOk && thumbOk);
}

export async function backfillSeoNewsArticleImages({
  origin = "generated",
  limit = 12,
  force = false,
  statuses = ["published", "draft"],
  slugs = [],
  settings,
} = {}) {
  const activeSettings =
    settings ||
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }));

  const query = {
    origin,
    status: { $in: statuses },
  };

  const targetSlugs = Array.isArray(slugs)
    ? slugs.map((slug) => safeText(slug)).filter(Boolean)
    : [];
  if (targetSlugs.length) {
    query.slug = { $in: targetSlugs };
  }

  if (!force) {
    query.$or = [
      { heroImageUrl: { $exists: false } },
      { heroImageUrl: null },
      { heroImageUrl: "" },
      { heroImageUrl: /^data:image\//i },
      { thumbImageUrl: { $exists: false } },
      { thumbImageUrl: null },
      { thumbImageUrl: "" },
      { thumbImageUrl: /^data:image\//i },
    ];
  }

  const articles = await SeoNewsArticle.find(query)
    .sort({ createdAt: -1 })
    .limit(
      Math.max(
        1,
        targetSlugs.length || Number(limit) || 12
      )
    );

  const stats = {
    checked: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };

  for (const article of articles) {
    stats.checked += 1;

    if (!needsArticleImageBackfill(article, force)) {
      stats.skipped += 1;
      stats.items.push({
        slug: article.slug,
        status: "skip",
        reason: "already_has_image",
      });
      continue;
    }

    try {
      const imageAsset = await resolveSeoNewsImages({
        title: article.title,
        summary: article.summary,
        tags: article.tags,
        sourceUrl: article.sourceUrl,
        origin: article.origin,
        preferredImageUrl: article.heroImageUrl || article.thumbImageUrl,
        settings: activeSettings,
        articleKey: article.slug || String(article._id),
      });

      const heroImageUrl = imageAsset.heroImageUrl || imageAsset.thumbImageUrl || null;
      const thumbImageUrl = imageAsset.thumbImageUrl || imageAsset.heroImageUrl || null;

      if (!heroImageUrl || isDataImageUrl(heroImageUrl)) {
        stats.skipped += 1;
        stats.items.push({
          slug: article.slug,
          status: "skip",
          reason: imageAsset.imageOrigin || "no_image_generated",
        });
        continue;
      }

      article.heroImageUrl = heroImageUrl;
      article.thumbImageUrl = thumbImageUrl;
      await article.save();

      stats.updated += 1;
      stats.items.push({
        slug: article.slug,
        status: "updated",
        imageOrigin: imageAsset.imageOrigin,
      });
    } catch (error) {
      stats.failed += 1;
      stats.items.push({
        slug: article.slug,
        status: "failed",
        reason: String(error?.message || error),
      });
    }
  }

  return stats;
}

export async function cleanupSeoNewsGatewaySourceImages({
  olderThanMinutes = 0,
  limit = 100,
  dryRun = false,
} = {}) {
  const primaryBaseUrl = getPrimaryGatewayBaseUrl();
  if (primaryBaseUrl && !isLocalGatewayBaseUrl(primaryBaseUrl)) {
    const endpoint = buildGatewayCleanupEndpoint(primaryBaseUrl);
    const apiKey = getPrimaryGatewayApiKey();
    const response = await axios.post(
      endpoint,
      {
        older_than_minutes: Math.max(0, Number(olderThanMinutes) || 0),
        limit: Math.max(1, Math.min(Number(limit) || 100, 1000)),
        dry_run: !!dryRun,
      },
      {
        timeout: GATEWAY_IMAGE_TIMEOUT_MS,
        headers: apiKey
          ? {
              Authorization: `Bearer ${apiKey}`,
            }
          : undefined,
        validateStatus: (status) => status >= 200 && status < 300,
      }
    );

    return {
      roots: response?.data?.root ? [response.data.root] : [],
      scanned: Number(response?.data?.scanned) || 0,
      deleted: Number(response?.data?.deleted) || 0,
      skipped: Number(response?.data?.skipped) || 0,
      failed: Number(response?.data?.failed) || 0,
      items: Array.isArray(response?.data?.items) ? response.data.items : [],
      remote: true,
      endpoint,
    };
  }

  const roots = GATEWAY_SOURCE_IMAGE_ROOTS.length
    ? GATEWAY_SOURCE_IMAGE_ROOTS
    : [];

  const uniqueRoots = Array.from(
    new Set(
      roots
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .map((item) => path.resolve(item))
    )
  );

  const thresholdMs =
    Number(olderThanMinutes) > 0 ? Number(olderThanMinutes) * 60 * 1000 : 0;
  const now = Date.now();
  const maxItems = Math.max(1, Math.min(Number(limit) || 100, 1000));

  const stats = {
    roots: uniqueRoots,
    scanned: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };

  for (const root of uniqueRoots) {
    let entries = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      stats.failed += 1;
      stats.items.push({
        path: root,
        status: "failed",
        reason: error?.message || String(error),
      });
      continue;
    }

    for (const entry of entries) {
      if (stats.scanned >= maxItems) {
        return stats;
      }

      if (!entry.isFile()) continue;

      const filePath = path.join(root, entry.name);
      stats.scanned += 1;

      try {
        const fileStat = await fs.stat(filePath);
        const fileAgeMs = Math.max(0, now - fileStat.mtimeMs);
        if (thresholdMs > 0 && fileAgeMs < thresholdMs) {
          stats.skipped += 1;
          stats.items.push({
            path: filePath,
            status: "skipped",
            reason: "too_new",
          });
          continue;
        }

        if (!dryRun) {
          await fs.unlink(filePath);
        }

        stats.deleted += 1;
        stats.items.push({
          path: filePath,
          status: dryRun ? "would_delete" : "deleted",
        });
      } catch (error) {
        stats.failed += 1;
        stats.items.push({
          path: filePath,
          status: "failed",
          reason: error?.message || String(error),
        });
      }
    }
  }

  return stats;
}

async function processQueuedSeoNewsImageBackfill(settings) {
  if (backgroundBackfillRunning) return;
  backgroundBackfillRunning = true;

  try {
    while (backgroundBackfillQueue.size) {
      const batch = Array.from(backgroundBackfillQueue).slice(
        0,
        BACKGROUND_IMAGE_BATCH_SIZE
      );
      batch.forEach((slug) => backgroundBackfillQueue.delete(slug));

      try {
        await backfillSeoNewsArticleImages({
          origin: "generated",
          statuses: ["published", "draft"],
          slugs: batch,
          limit: batch.length,
          settings,
        });
      } catch (error) {
        console.warn(
          "[SeoNewsImage] background backfill failed:",
          error?.message || error
        );
      }
    }
  } finally {
    backgroundBackfillRunning = false;

    if (backgroundBackfillQueue.size) {
      setTimeout(() => {
        void processQueuedSeoNewsImageBackfill(settings);
      }, 1000);
    }
  }
}

export function scheduleSeoNewsImageBackfill({ articles = [], settings } = {}) {
  const candidates = Array.isArray(articles) ? articles : [];

  for (const article of candidates) {
    if (!hasPendingSeoNewsImage(article)) continue;
    const slug = safeText(article?.slug);
    if (!slug) continue;
    backgroundBackfillQueue.add(slug);
  }

  if (!backgroundBackfillQueue.size || backgroundBackfillRunning) {
    return backgroundBackfillQueue.size;
  }

  setTimeout(() => {
    void processQueuedSeoNewsImageBackfill(settings);
  }, 0);

  return backgroundBackfillQueue.size;
}
