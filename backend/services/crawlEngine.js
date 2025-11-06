// src/services/crawlEngine.js
import axios from "axios";
import * as cheerio from "cheerio";
import crypto from "crypto";
import slugify from "slugify";

import NewsSettings from "../models/newsSettingsModel.js";
import NewsLinkCandidate from "../models/newsLinkCandicateModel.js";
import NewsArticle from "../models/newsArticlesModel.js";
import { normalizeArticleWithAI } from "./normalizeService.js";

async function safeFetch(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      "User-Agent": "PickleTourNewsBot/1.0 (+https://pickletour.com/bot-info)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  return res.data;
}

function extractMain(html) {
  const $ = cheerio.load(html);

  const candidates = [
    "article",
    "main",
    "[role=main]",
    ".post-content",
    ".entry-content",
    ".article-body",
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
  if (!$node) $node = $("body");

  $node
    .find(
      "script,noscript,style,iframe,form,nav,header,footer,aside,.ads,[class*='advert']"
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

export async function runCrawlEngine() {
  const settings =
    (await NewsSettings.findOne({ key: "default" })) ||
    (await NewsSettings.create({}));

  const pending = await NewsLinkCandidate.find({ status: "pending" })
    .sort({ score: -1, createdAt: 1 })
    .limit(settings.maxArticlesPerRun);

  if (!pending.length) return;

  for (const cand of pending) {
    try {
      const html = await safeFetch(cand.url);
      const { text, contentHtml, heroImageUrl, rawTitle } =
        extractMain(html);

      if (!text || text.length < 300) {
        cand.status = "skipped";
        cand.lastError = "Nội dung quá ngắn / không hợp lệ";
        await cand.save();
        continue;
      }

      const hash = crypto
        .createHash("sha256")
        .update(text.slice(0, 8000))
        .digest("hex");

      const dup = await NewsArticle.findOne({ contentHash: hash });
      if (dup) {
        cand.status = "skipped";
        cand.lastError = "Trùng nội dung";
        await cand.save();
        continue;
      }

      // Tiêu đề ban đầu
      const baseTitle = cand.title || rawTitle || "Tin pickleball";

      let final = {
        title: baseTitle,
        summary: text.slice(0, 220),
        contentHtml,
        language: "vi",
        tags: cand.tags || [],
      };

      // Tuỳ chọn: dùng AI refine nội dung cho sạch, thống nhất format
      if (settings.useAiNormalize) {
        try {
          const normalized = await normalizeArticleWithAI({
            url: cand.url,
            sourceName: cand.sourceName,
            baseTitle,
            text,
            contentHtml,
            tags: cand.tags || [],
          });
          if (normalized && normalized.contentHtml) {
            final = normalized;
          }
        } catch (e) {
          console.warn(
            "[NewsCrawl] AI normalize lỗi, dùng raw content:",
            e.message
          );
        }
      }

      const slug =
        slugify(final.title, { lower: true, strict: true }) +
        "-" +
        Math.random().toString(36).slice(2, 6);

      const article = await NewsArticle.create({
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
        thumbImageUrl: final.thumbImageUrl || heroImageUrl,
        relevanceScore: cand.score || 0,
        status: settings.autoPublish ? "published" : "draft",
        contentHash: hash,
      });

      cand.status = "crawled";
      cand.lastError = null;
      await cand.save();

      console.log(
        `[NewsCrawl] Saved ${article.slug} from ${cand.url}`
      );
    } catch (err) {
      cand.status = "failed";
      cand.lastError = err.message?.slice(0, 300);
      await cand.save();
      console.error("[NewsCrawl] Error:", cand.url, err.message);
    }
  }
}