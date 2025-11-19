// src/services/crawlEngine.js
import axios from "axios";
import * as cheerio from "cheerio";
import crypto from "crypto";
import slugify from "slugify";

import NewsSettings from "../models/newsSettingsModel.js";
import NewsLinkCandidate from "../models/newsLinkCandicateModel.js";
import NewsArticle from "../models/newsArticlesModel.js";
import { normalizeArticleWithAI } from "./normalizeService.js";
import { normalizeArticleWithAIV2 } from "./normalizeServiceV2.js";

/**
 * Fetch HTML an toàn, với headers đàng hoàng.
 */
async function safeFetch(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      "User-Agent": "PickleTourNewsBot/1.0 (+https://pickletour.com/bot-info)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
    // Cho phép 2xx và 3xx (axios sẽ tự follow redirect)
    validateStatus: (status) => status >= 200 && status < 400,
  });

  return res.data;
}

/**
 * Tách phần nội dung chính từ HTML.
 */
function extractMain(html) {
  const $ = cheerio.load(html);

  const candidates = [
    "article",
    "main",
    "[role=main]",
    ".post-content",
    ".entry-content",
    ".article-body",
    ".left-col",
    ".col-content",
    ".content-detail",
    ".content",
  ];

  let $node = null;

  for (const sel of candidates) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 300) {
      $node = el.first();
      break;
    }
  }

  if (!$node) {
    $node = $("body");
  }

  // Loại bỏ rác
  $node
    .find(
      "script,noscript,style,iframe,form,nav,header,footer,aside," +
        ".ads,[class*='advert'],.social-share,.breadcrumb," +
        ".related-news,.tag-list"
    )
    .remove();

  const text = $node.text().replace(/\s+/g, " ").trim();
  const contentHtml = ($node.html() || "").trim();

  const heroImageUrl =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $node.find("img").first().attr("src") ||
    null;

  const rawTitle =
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text().trim() ||
    null;

  return { text, contentHtml, heroImageUrl, rawTitle };
}

/**
 * Phân loại lỗi crawl để dễ debug & hiển thị.
 */
function classifyCrawlError(err) {
  const status = err?.response?.status;
  const msg = (err?.message || "").toLowerCase();

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

/**
 * Engine crawl: đọc các candidate pending, crawl, chuẩn hoá, lưu NewsArticle.
 * Trả về thống kê để show ở Admin.
 */
export async function runCrawlEngine() {
  const settings =
    (await NewsSettings.findOne({ key: "default" })) ||
    (await NewsSettings.create({}));

  const limit = settings.maxArticlesPerRun || 20;

  const pending = await NewsLinkCandidate.find({
    status: "pending",
  })
    .sort({ score: -1, createdAt: 1 })
    .limit(limit);

  if (!pending.length) {
    console.log("[NewsCrawl] Không có candidate pending.");
    return {
      crawled: 0,
      skipped: 0,
      failed: 0,
      errorsByType: {},
      failedSamples: [],
    };
  }

  let crawled = 0;
  let skipped = 0;
  let failed = 0;
  const errorsByType = {};
  const failedSamples = [];

  for (const cand of pending) {
    try {
      const html = await safeFetch(cand.url);
      const { text, contentHtml, heroImageUrl, rawTitle } = extractMain(html);

      // 1) Nội dung quá ngắn / không ổn -> skip
      if (!text || text.length < 300) {
        cand.status = "skipped";
        cand.lastError = "PARSE_TOO_SHORT: Nội dung quá ngắn / không hợp lệ";
        cand.lastErrorCode = "PARSE_TOO_SHORT";
        await cand.save();
        skipped++;
        continue;
      }

      // 2) Check duplicate theo contentHash
      const hash = crypto
        .createHash("sha256")
        .update(text.slice(0, 8000))
        .digest("hex");

      const dup = await NewsArticle.findOne({ contentHash: hash });
      if (dup) {
        cand.status = "skipped";
        cand.lastError = "DUPLICATE_CONTENT: Trùng với bài đã có";
        cand.lastErrorCode = "DUPLICATE_CONTENT";
        await cand.save();
        skipped++;
        continue;
      }

      // 3) Chuẩn hoá nội dung
      const baseTitle = cand.title || rawTitle || "Tin pickleball";

      let final = {
        title: baseTitle,
        summary: text.slice(0, 220),
        contentHtml,
        language: "vi",
        tags: cand.tags || [],
        heroImageUrl,
        thumbImageUrl: heroImageUrl,
      };

      if (settings.useAiNormalize) {
        try {
          const normalized = await normalizeArticleWithAIV2({
            url: cand.url,
            sourceName: cand.sourceName,
            baseTitle,
            text,
            contentHtml,
            tags: cand.tags || [],
          });

          if (normalized && normalized.contentHtml) {
            final = {
              ...final,
              ...normalized,
            };
          }
        } catch (e) {
          console.warn(
            "[NewsCrawl] AI normalize lỗi, dùng raw content:",
            e.message
          );
        }
      }

      // 4) Tạo slug unique
      const slug =
        slugify(final.title, { lower: true, strict: true }) +
        "-" +
        Math.random().toString(36).slice(2, 6);

      await NewsArticle.create({
        slug,
        title: final.title,
        summary: final.summary || text.slice(0, 220),
        contentHtml: final.contentHtml,
        contentText: text,
        sourceName: cand.sourceName,
        sourceUrl: cand.url,
        originalPublishedAt: cand.publishedAt,
        fetchedAt: new Date(),
        tags: final.tags || cand.tags || [],
        language: final.language || "vi",
        heroImageUrl: final.heroImageUrl || heroImageUrl,
        thumbImageUrl:
          final.thumbImageUrl || final.heroImageUrl || heroImageUrl,
        relevanceScore: cand.score || 0,
        status: settings.autoPublish ? "published" : "draft",
        contentHash: hash,
      });

      cand.status = "crawled";
      cand.lastError = null;
      cand.lastErrorCode = null;
      await cand.save();

      crawled++;
      console.log(`[NewsCrawl] Saved ${slug} from ${cand.url}`);
    } catch (err) {
      const code = classifyCrawlError(err);
      const shortMsg = (err?.message || "").slice(0, 200);

      cand.status = "failed";
      cand.lastError = `${code}: ${shortMsg}`;
      cand.lastErrorCode = code;
      await cand.save();

      failed++;
      errorsByType[code] = (errorsByType[code] || 0) + 1;

      if (failedSamples.length < 10) {
        failedSamples.push({
          url: cand.url,
          code,
          message: shortMsg,
        });
      }

      console.error("[NewsCrawl] Error", code, cand.url, err?.message);
    }
  }

  console.log(
    `[NewsCrawl] Result -> crawled=${crawled}, skipped=${skipped}, failed=${failed}`
  );

  return {
    crawled,
    skipped,
    failed,
    errorsByType,
    failedSamples,
  };
}
