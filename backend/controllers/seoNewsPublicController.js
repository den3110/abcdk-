import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";
import SeoNewsArticle from "../models/seoNewsArticleModel.js";
import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import { sanitizeSeoNewsHtml } from "../services/seoNewsSanitizerService.js";
import {
  hasPendingSeoNewsImage,
  scheduleSeoNewsImageBackfill,
} from "../services/seoNewsImageService.js";
import { evaluateSeoNewsRelevance } from "../services/seoNewsRelevanceService.js";

const SITE_URL = process.env.PUBLIC_SITE_URL || "https://pickletour.vn";
const IMAGE_PROXY_PATH = "/api/api/seo-news/image-proxy";
const IMAGE_PROXY_TIMEOUT_MS = Math.max(
  4000,
  Number(process.env.SEO_NEWS_IMAGE_PROXY_TIMEOUT_MS) || 12000
);
const IMAGE_PROXY_MAX_REDIRECTS = Math.max(
  0,
  Math.min(5, Number(process.env.SEO_NEWS_IMAGE_PROXY_MAX_REDIRECTS) || 3)
);
const VIETNAMESE_DIACRITICS_REGEX = /[\u00C0-\u024F\u1E00-\u1EFF]/i;
const MOJIBAKE_REGEX = /(?:\u00C3.|\u00E1\u00BB|\u00E2\u20AC|\u00C2\s|\uFFFD)/;

function cleanPage(value, fallback = 1) {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return fallback;
  return Math.floor(page);
}

function stripInlineDataImages(article) {
  if (!article) return article;

  return {
    ...article,
    heroImageUrl: /^data:image\//i.test(String(article.heroImageUrl || "").trim())
      ? null
      : article.heroImageUrl,
    thumbImageUrl: /^data:image\//i.test(String(article.thumbImageUrl || "").trim())
      ? null
      : article.thumbImageUrl,
  };
}

function withImagePendingStatus(article) {
  if (!article) return article;
  return {
    ...article,
    imagePending: hasPendingSeoNewsImage(article),
  };
}

function hasVietnameseDiacritics(value = "") {
  return VIETNAMESE_DIACRITICS_REGEX.test(String(value || ""));
}

function hasMojibakeText(value = "") {
  return MOJIBAKE_REGEX.test(String(value || ""));
}

function evaluateSeoNewsTextQuality(article = {}) {
  const combinedText = [article?.title, article?.summary, article?.contentText]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  const shouldRequireDiacritics = article?.language === "vi";

  const reasons = [];
  if (hasMojibakeText(combinedText)) {
    reasons.push("mojibake_detected");
  }

  if (shouldRequireDiacritics && !hasVietnameseDiacritics(combinedText)) {
    reasons.push("missing_vietnamese_diacritics");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

function isPrivateIPv4(address) {
  const parts = String(address || "")
    .split(".")
    .map((x) => Number(x));

  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) {
    return true;
  }

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateIPv6(address) {
  const lower = String(address || "").toLowerCase();
  if (!lower) return true;
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  if (lower.startsWith("2001:db8")) return true;

  if (lower.startsWith("::ffff:")) {
    const ipv4Part = lower.replace("::ffff:", "");
    return isPrivateIPv4(ipv4Part);
  }

  return false;
}

function isPrivateAddress(address) {
  const ipVersion = net.isIP(String(address || ""));
  if (!ipVersion) return true;
  if (ipVersion === 4) return isPrivateIPv4(address);
  if (ipVersion === 6) return isPrivateIPv6(address);
  return true;
}

function isBlockedHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return true;

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion) {
    return isPrivateAddress(host);
  }

  return false;
}

async function assertSafeImageTarget(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    throw new Error("Missing url");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid url");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https image url is allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Image url auth is not allowed");
  }

  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
    ? 443
    : 80;

  if (![80, 443].includes(port)) {
    throw new Error("Image url port is not allowed");
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("Image hostname is blocked");
  }

  if (!net.isIP(parsed.hostname)) {
    let records = [];
    try {
      records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("Cannot resolve image hostname");
    }

    if (!Array.isArray(records) || !records.length) {
      throw new Error("Cannot resolve image hostname");
    }

    const hasPrivate = records.some((record) =>
      isPrivateAddress(String(record?.address || ""))
    );

    if (hasPrivate) {
      throw new Error("Image hostname resolves to private IP");
    }
  }

  return parsed.toString();
}

function isHttpImageUrl(value) {
  if (!value) return false;
  const raw = String(value).trim();
  if (!raw || /^data:image\//i.test(raw)) return false;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isAlreadyProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (raw.startsWith(`${IMAGE_PROXY_PATH}?`)) return true;

  try {
    const parsed = new URL(raw);
    return parsed.pathname === IMAGE_PROXY_PATH;
  } catch {
    return false;
  }
}

function toProxyImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (isAlreadyProxyUrl(raw)) return raw;
  if (!isHttpImageUrl(raw)) return raw;
  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(raw)}`;
}

function withProxyImages(article) {
  if (!article) return article;
  return {
    ...article,
    heroImageUrl: toProxyImageUrl(article.heroImageUrl),
    thumbImageUrl: toProxyImageUrl(article.thumbImageUrl),
  };
}

function rewriteContentHtmlImageUrls(html = "") {
  if (!html) return "";
  return String(html).replace(
    /(<img\b[^>]*\bsrc=["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi,
    (_match, prefix, src, suffix) => `${prefix}${toProxyImageUrl(src)}${suffix}`
  );
}

async function fetchImageStreamWithRedirects(startUrl) {
  let currentUrl = startUrl;

  for (let step = 0; step <= IMAGE_PROXY_MAX_REDIRECTS; step += 1) {
    await assertSafeImageTarget(currentUrl);

    const response = await axios.get(currentUrl, {
      responseType: "stream",
      timeout: IMAGE_PROXY_TIMEOUT_MS,
      maxRedirects: 0,
      headers: {
        "User-Agent": "PickleTourSeoNewsImageProxy/1.0 (+https://pickletour.vn)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = String(response.headers?.location || "").trim();
      response.data?.destroy?.();

      if (!location) {
        throw new Error("Image redirect without location");
      }

      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error("Too many redirects");
}

async function getSeoNewsSettingsSafe() {
  try {
    return (
      (await SeoNewsSettings.findOne({ key: "default" }).lean()) ||
      (await SeoNewsSettings.create({ key: "default" }))
    );
  } catch {
    return { imageFallbackEnabled: true };
  }
}

async function filterRelevantPublishedArticles(articles = [], settings = {}) {
  const valid = [];
  const invalidIds = [];

  for (const article of articles) {
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

    if (relevance.isRelevant && textQuality.ok) {
      valid.push({
        ...article,
        relevanceScore: relevance.score,
      });
    } else if (article?._id) {
      invalidIds.push(article._id);
    }
  }

  if (invalidIds.length) {
    await SeoNewsArticle.updateMany(
      {
        _id: { $in: invalidIds },
        status: "published",
      },
      {
        $set: {
          status: "draft",
        },
      }
    );
  }

  return valid;
}

export const getSeoNewsList = async (req, res) => {
  const page = cleanPage(req.query.page, 1);
  const limit = Math.min(cleanPage(req.query.limit, 12), 100);
  const skip = (page - 1) * limit;

  const query = { status: "published" };

  const rawItems = await SeoNewsArticle.find(query)
    .sort({ originalPublishedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select(
      "_id slug title summary contentText heroImageUrl thumbImageUrl sourceName sourceUrl originalPublishedAt createdAt tags origin review language"
    )
    .lean();

  const settings = await getSeoNewsSettingsSafe();

  const relevantItems = await filterRelevantPublishedArticles(rawItems, settings);
  scheduleSeoNewsImageBackfill({
    articles: relevantItems,
    settings,
  });

  const items = relevantItems.map((item) => {
    const proxied = withProxyImages(
      withImagePendingStatus(stripInlineDataImages(item))
    );
    const { _id, contentText, ...publicItem } = proxied;
    return publicItem;
  });

  const total = await SeoNewsArticle.countDocuments(query);

  res.json({
    items,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
};

export const getSeoNewsDetail = async (req, res) => {
  const article = await SeoNewsArticle.findOne({
    slug: req.params.slug,
    status: "published",
  }).lean();

  if (!article) {
    return res.status(404).json({ message: "Không tìm thấy bài viết" });
  }

  article.contentHtml = sanitizeSeoNewsHtml(article.contentHtml || "");

  const settings = await getSeoNewsSettingsSafe();
  scheduleSeoNewsImageBackfill({
    articles: [article],
    settings,
  });

  const relevance = evaluateSeoNewsRelevance({
    title: article.title,
    summary: article.summary,
    contentText: article.contentText || article.summary || "",
    tags: article.tags,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    settings,
  });

  const textQuality = evaluateSeoNewsTextQuality(article);

  if (!relevance.isRelevant || !textQuality.ok) {
    await SeoNewsArticle.updateOne(
      { _id: article._id, status: "published" },
      {
        $set: {
          status: "draft",
          relevanceScore: relevance.score,
        },
      }
    );

    return res.status(404).json({ message: "Không tìm thấy bài viết" });
  }

  const safeArticle = withProxyImages({
    ...withImagePendingStatus(stripInlineDataImages(article)),
    contentHtml: rewriteContentHtmlImageUrls(article.contentHtml || ""),
  });

  return res.json(safeArticle);
};

export const getSeoNewsImageProxy = async (req, res) => {
  const rawUrl = String(req.query.url || "").trim();
  if (!rawUrl) {
    return res.status(400).json({ message: "Thiếu url ảnh" });
  }

  try {
    const response = await fetchImageStreamWithRedirects(rawUrl);
    const contentType = String(response.headers?.["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!contentType.startsWith("image/")) {
      response.data?.destroy?.();
      return res.status(415).json({ message: "Nguồn trả về không phải ảnh" });
    }

    const contentLength = response.headers?.["content-length"];

    res.status(200);
    res.setHeader("Content-Type", contentType);
    if (contentLength) {
      res.setHeader("Content-Length", String(contentLength));
    }
    res.setHeader("Cache-Control", "public, max-age=21600, s-maxage=21600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Robots-Tag", "noindex");

    response.data.on("error", () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    return response.data.pipe(res);
  } catch (error) {
    return res
      .status(400)
      .json({ message: error?.message || "Không thể proxy ảnh" });
  }
};

export const getSeoNewsSitemap = async (_req, res) => {
  const rawArticles = await SeoNewsArticle.find({ status: "published" })
    .sort({ originalPublishedAt: -1, createdAt: -1 })
    .limit(5000)
    .select("_id slug title summary contentText sourceName sourceUrl tags updatedAt createdAt")
    .lean();

  const settings = await getSeoNewsSettingsSafe();
  const articles = await filterRelevantPublishedArticles(rawArticles, settings);

  const urls = [
    `<url><loc>${SITE_URL}/news</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`,
    ...articles.map((article) => {
      const lastmod = new Date(article.updatedAt || article.createdAt)
        .toISOString()
        .slice(0, 10);
      return `<url><loc>${SITE_URL}/news/${article.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`;
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;

  res.header("Content-Type", "application/xml; charset=utf-8");
  return res.send(xml);
};
