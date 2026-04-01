import axios from "axios";
import * as cheerio from "cheerio";
import crypto from "crypto";
import slugify from "slugify";

import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import SeoNewsLinkCandidate from "../models/seoNewsLinkCandidateModel.js";
import SeoNewsArticle from "../models/seoNewsArticleModel.js";
import {
  sanitizeSeoNewsHtml,
  stripSeoNewsHtmlToText,
} from "./seoNewsSanitizerService.js";
import {
  reviewSeoNewsArticle,
  SEO_NEWS_REVIEW_PASS_SCORE,
  SEO_NEWS_REVIEW_MODEL,
} from "./seoNewsReviewService.js";
import { resolveSeoNewsImages } from "./seoNewsImageService.js";
import { evaluateSeoNewsRelevance } from "./seoNewsRelevanceService.js";

const MOJIBAKE_REGEX = /(?:\u00fd.|\u1ecd|\u00e2\u20ac|\u00c2\s|\uFFFD)/u;

async function safeFetch(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      "User-Agent": "PickleTourSeoNewsBot/1.0 (+https://pickletour.vn)",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });

  return response.data;
}

function absolutizeMaybeUrl(value, baseUrl) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function extractMain(html, pageUrl) {
  const $ = cheerio.load(html);

  const selectors = [
    "article",
    "main",
    "[role=main]",
    ".post-content",
    ".entry-content",
    ".article-body",
    ".content",
  ];

  let node = null;
  for (const selector of selectors) {
    const current = $(selector);
    if (current.length && current.text().trim().length > 350) {
      node = current.first();
      break;
    }
  }

  if (!node) {
    node = $("body");
  }

  node
    .find(
      "script,noscript,style,iframe,form,nav,header,footer,aside," +
        ".ads,[class*='advert'],.social-share,.breadcrumb,.related,.tag-list"
    )
    .remove();

  const text = node.text().replace(/\s+/g, " ").trim();

  const rawHero =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    node.find("img").first().attr("src") ||
    null;

  const heroImageUrl = absolutizeMaybeUrl(rawHero, pageUrl);

  const rawTitle =
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text().trim() ||
    null;

  return { text, rawTitle, heroImageUrl };
}

function classifyCrawlError(err) {
  const status = err?.response?.status;
  const msg = String(err?.message || "").toLowerCase();

  if (status === 404) return "HTTP_404";
  if (status === 401) return "HTTP_401";
  if (status === 403) return "HTTP_403";
  if (status >= 500 && status < 600) return "HTTP_5XX";
  if (msg.includes("timeout")) return "TIMEOUT";
  if (msg.includes("network") || msg.includes("socket")) return "NETWORK";
  if (
    msg.includes("captcha") ||
    msg.includes("human verification") ||
    msg.includes("cloudflare")
  ) {
    return "HUMAN_VERIFICATION";
  }
  if (msg.includes("ssl") || msg.includes("certificate")) return "SSL";
  return "OTHER";
}

function splitSentences(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks = clean
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (chunks.length) {
    return chunks;
  }

  return clean
    .split(". ")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.endsWith(".") ? x : `${x}.`));
}

function hasVietnameseDiacritics(value = "") {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(
    String(value || "")
  );
}

function hasMojibakeText(value = "") {
  return MOJIBAKE_REGEX.test(String(value || ""));
}

function pickBestArticleTitle(candidateTitle, rawTitle) {
  const fromCandidate = String(candidateTitle || "").trim();
  const fromPage = String(rawTitle || "").trim();

  if (!fromPage) return fromCandidate || "Tin pickleball";
  if (!fromCandidate) return fromPage;

  const candidateHasDiacritics = hasVietnameseDiacritics(fromCandidate);
  const pageHasDiacritics = hasVietnameseDiacritics(fromPage);

  if (pageHasDiacritics && !candidateHasDiacritics) {
    return fromPage;
  }

  if (fromPage.length > fromCandidate.length + 12) {
    return fromPage;
  }

  return fromCandidate;
}

function buildExternalDigestHtml({ text, sourceName, sourceUrl }) {
  const sentences = splitSentences(text).slice(0, 6);
  const selected = [];
  let length = 0;

  for (const sentence of sentences) {
    if (length > 900) break;
    selected.push(sentence);
    length += sentence.length;
  }

  const summaryLines = selected.length
    ? selected
    : [
        "Nội dung được tổng hợp ngắn gọn từ bài gốc để phục vụ mục tiêu cập nhật nhanh.",
      ];

  const summary = summaryLines.join(" ").slice(0, 260);

  const body = summaryLines
    .map((line) => `<p>${line}</p>`)
    .join("");

  const sourceLabel = sourceName || "Nguồn gốc";
  const sourceHtml = sourceUrl
    ? `<p><strong>Nguồn:</strong> <a href="${sourceUrl}">${sourceLabel}</a></p>`
    : "";

  const contentHtml = sanitizeSeoNewsHtml(`${body}${sourceHtml}`);

  return {
    summary,
    contentHtml,
  };
}

function toSlug(title) {
  return `${slugify(String(title || "seo-news"), {
    lower: true,
    strict: true,
  })}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyStats() {
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

export async function runSeoNewsCrawl({ limit, settings, runId } = {}) {
  const activeSettings =
    settings ||
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }));

  const runLimit =
    Number(limit) > 0
      ? Number(limit)
      : Number(activeSettings.maxArticlesPerRun) || 8;

  const pending = await SeoNewsLinkCandidate.find({ status: "pending" })
    .sort({ score: -1, createdAt: -1 })
    .limit(runLimit);

  const stats = emptyStats();

  if (!pending.length) {
    return stats;
  }

  const passScore =
    Number(activeSettings.reviewPassScore) || SEO_NEWS_REVIEW_PASS_SCORE;

  for (const candidate of pending) {
    try {
      const competitor = evaluateSeoNewsRelevance({
        title: candidate.title,
        summary: candidate.reason,
        contentText: candidate.reason,
        tags: candidate.tags || [],
        sourceName: candidate.sourceName,
        sourceUrl: candidate.url,
        settings: activeSettings,
      });

      if (competitor?.competitor?.isCompetitor) {
        candidate.status = "skipped";
        candidate.lastErrorCode = "COMPETITOR_BLOCKED";
        candidate.lastError = `COMPETITOR_BLOCKED: ${
          competitor.competitor.reasons.join("; ") || "blocked competitor"
        }`;
        await candidate.save();
        stats.skipped += 1;
        stats.errorsByType.COMPETITOR_BLOCKED =
          (stats.errorsByType.COMPETITOR_BLOCKED || 0) + 1;
        continue;
      }

      const html = await safeFetch(candidate.url);
      const { text, rawTitle, heroImageUrl } = extractMain(html, candidate.url);

      if (!text || text.length < 220) {
        candidate.status = "skipped";
        candidate.lastErrorCode = "PARSE_TOO_SHORT";
        candidate.lastError = "PARSE_TOO_SHORT: Noi dung qua ngan";
        await candidate.save();
        stats.skipped += 1;
        continue;
      }

      const contentHash = crypto
        .createHash("sha256")
        .update(text.slice(0, 8000))
        .digest("hex");

      const duplicated = await SeoNewsArticle.findOne({ contentHash })
        .select("_id")
        .lean();
      if (duplicated) {
        candidate.status = "skipped";
        candidate.lastErrorCode = "DUPLICATE_CONTENT";
        candidate.lastError = "DUPLICATE_CONTENT: Trung noi dung da ton tai";
        await candidate.save();
        stats.skipped += 1;
        continue;
      }

      const existingUrl = await SeoNewsArticle.findOne({
        origin: "external",
        sourceUrl: candidate.url,
      })
        .select("_id")
        .lean();
      if (existingUrl) {
        candidate.status = "skipped";
        candidate.lastErrorCode = "DUPLICATE_SOURCE_URL";
        candidate.lastError = "DUPLICATE_SOURCE_URL: URL da duoc crawl";
        await candidate.save();
        stats.skipped += 1;
        continue;
      }

      const title = pickBestArticleTitle(candidate.title, rawTitle);
      const digest = buildExternalDigestHtml({
        text,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.url,
      });

      const cleanHtml = sanitizeSeoNewsHtml(digest.contentHtml || "");
      const contentText = stripSeoNewsHtmlToText(cleanHtml);
      const qualityText = `${title} ${digest.summary || ""} ${contentText || ""}`;

      if (hasMojibakeText(qualityText) || !hasVietnameseDiacritics(qualityText)) {
        candidate.status = "skipped";
        candidate.lastErrorCode = "QUALITY_FAIL";
        candidate.lastError = `QUALITY_FAIL: ${
          hasMojibakeText(qualityText)
            ? "mojibake_detected"
            : "missing_vietnamese_diacritics"
        }`;
        await candidate.save();
        stats.skipped += 1;
        stats.errorsByType.QUALITY_FAIL =
          (stats.errorsByType.QUALITY_FAIL || 0) + 1;
        continue;
      }

      const relevance = evaluateSeoNewsRelevance({
        title,
        summary: digest.summary,
        contentText,
        tags: candidate.tags || [],
        sourceName: candidate.sourceName,
        sourceUrl: candidate.url,
        settings: activeSettings,
      });

      if (!relevance.isRelevant) {
        candidate.status = "skipped";
        candidate.lastErrorCode = "RELEVANCE_FAIL";
        candidate.lastError = `RELEVANCE_FAIL: ${
          relevance.reasons.join("; ") || "not pickleball related"
        }`;
        await candidate.save();
        stats.skipped += 1;
        stats.errorsByType.RELEVANCE_FAIL =
          (stats.errorsByType.RELEVANCE_FAIL || 0) + 1;
        continue;
      }

      const review = await reviewSeoNewsArticle({
        title,
        summary: digest.summary,
        contentHtml: cleanHtml,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.url,
        origin: "external",
        tags: candidate.tags || [],
      });

      const reviewPass =
        review.status === "pass" &&
        Number(review.score) >= passScore &&
        (!Array.isArray(review.criticalFlags) || review.criticalFlags.length === 0);

      const status =
        reviewPass && activeSettings.autoPublish !== false
          ? "published"
          : "draft";

      const slug = toSlug(title);

      const imageAsset = await resolveSeoNewsImages({
        title,
        summary: digest.summary,
        tags: Array.isArray(candidate.tags) ? candidate.tags : [],
        sourceUrl: candidate.url,
        origin: "external",
        preferredImageUrl: heroImageUrl,
        settings: activeSettings,
        articleKey: slug,
      });

      await SeoNewsArticle.create({
        slug,
        title,
        summary: digest.summary,
        contentHtml: cleanHtml,
        contentText,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.url,
        originalPublishedAt: candidate.publishedAt || null,
        fetchedAt: new Date(),
        tags: Array.isArray(candidate.tags) ? candidate.tags : [],
        language: "vi",
        heroImageUrl: imageAsset.heroImageUrl || heroImageUrl || null,
        thumbImageUrl:
          imageAsset.thumbImageUrl ||
          imageAsset.heroImageUrl ||
          heroImageUrl ||
          null,
        relevanceScore: relevance.score,
        origin: "external",
        status,
        contentHash,
        review,
        workflow: {
          generatorModel: "external-digest",
          reviewerModel: review.checkerModel || SEO_NEWS_REVIEW_MODEL,
          runId: String(runId || "manual"),
        },
      });

      candidate.status = "crawled";
      candidate.lastError = null;
      candidate.lastErrorCode = null;
      await candidate.save();

      stats.crawled += 1;
      stats.externalGenerated += 1;
      if (reviewPass) stats.reviewPassed += 1;
      else stats.reviewFailed += 1;
      if (status === "published") stats.published += 1;
      else stats.draft += 1;
    } catch (err) {
      const code = classifyCrawlError(err);
      const shortMessage = String(err?.message || "").slice(0, 220);

      candidate.status = "failed";
      candidate.lastErrorCode = code;
      candidate.lastError = `${code}: ${shortMessage}`;
      await candidate.save();

      stats.failed += 1;
      stats.errorsByType[code] = (stats.errorsByType[code] || 0) + 1;

      if (stats.failedSamples.length < 10) {
        stats.failedSamples.push({
          url: candidate.url,
          code,
          message: shortMessage,
        });
      }
    }
  }

  return stats;
}





