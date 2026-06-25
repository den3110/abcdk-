// src/controllers/newsPublicController.js
import NewsArticle from "../models/newsArticlesModel.js";
import { CACHE_GROUP_IDS } from "../services/cacheGroups.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";
import {
  cacheAndSendJson,
  sendCachedJson,
} from "../utils/httpResponseCache.js";

const NEWS_LIST_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.NEWS_LIST_CACHE_TTL_MS || 86_400_000)
);
const NEWS_DETAIL_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.NEWS_DETAIL_CACHE_TTL_MS || 86_400_000)
);
const newsListCache = createShortTtlCache(NEWS_LIST_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.newsList,
  label: "News list",
  category: "public",
  scope: "public",
});
const newsDetailCache = createShortTtlCache(NEWS_DETAIL_CACHE_TTL_MS, {
  id: CACHE_GROUP_IDS.newsDetail,
  label: "News detail",
  category: "public",
  scope: "public",
});

/** ===== Helpers: chuẩn hoá URL ảnh uploads bắt đầu bằng ../ ===== */

/** Lấy base từ sourceName (ưu tiên) hoặc origin của sourceUrl */
function buildBase(article) {
  const name = (article?.sourceName || "").trim();
  if (name) {
    // Nếu lỡ lưu kèm http/https thì chuẩn hoá lại
    const cleaned = name.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
    return `https://${cleaned}`;
  }
  try {
    const origin = new URL(article?.sourceUrl).origin;
    return origin?.replace(/\/+$/g, "") || "";
  } catch {
    return "";
  }
}

/** Cho các field đơn lẻ (heroImageUrl, thumbImageUrl, …) */
function absolutizeUploadsUrl(u, base) {
  if (!u || !base) return u;
  // Bỏ qua URL đã tuyệt đối hoặc data URI
  if (/^(?:https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u;
  // Chỉ xử lý khi là ../uploads...
  if (!/^(\.\.\/)+uploads\//i.test(u)) return u;
  return `${base}/${u.replace(/^(\.\.\/)+/i, "")}`;
}

/** Xử lý trong HTML: src, href, style url(...), poster, data-* … */
function absolutizeUploadsInHtml(html, base) {
  if (!html || !base) return html;
  let out = String(html);

  // 1) Thay trong thuộc tính có dấu nháy hoặc url(...)
  //   Khớp:  " ../uploads/..."  |  ' ../uploads/...'  |  (../uploads/...)
  out = out.replace(
    /(["'(])(?:\.\.\/)+(uploads\/[^"'()>\s]+)/gi,
    (_m, pre, path) => `${pre}${base}/${path}`
  );

  // 2) Thay trường hợp hiếm: giá trị đứng trần (không nháy) sau dấu = hoặc trong srcset
  //   Ví dụ: src=../uploads/a.jpg  hoặc  srcset="../uploads/a.jpg 1x, ../uploads/a@2x.jpg 2x"
  //   Với srcset, cách tiếp cận an toàn là thay MỌI token ../uploads/... trong chuỗi.
  out = out.replace(
    /(?:^|[\s=,])((?:\.\.\/)+(uploads\/[^\s"'(),>]+))/gim,
    (_m, rel) => _m.replace(rel, `${base}/${rel.replace(/^(\.\.\/)+/i, "")}`)
  );

  return out;
}

/** Chuẩn hoá toàn bộ bài viết khi trả về client */
function normalizeArticleForResponse(article) {
  if (!article) return article;

  const base = buildBase(article);
  if (!base) return article;

  // Copy để tránh đụng tới object bị freeze trong một số môi trường
  const a = { ...article };

  a.heroImageUrl = absolutizeUploadsUrl(a.heroImageUrl, base);
  a.thumbImageUrl = absolutizeUploadsUrl(a.thumbImageUrl, base);
  a.contentHtml = absolutizeUploadsInHtml(a.contentHtml, base);

  return a;
}

/**
 * GET /api/news
 * Lấy danh sách bài viết đã publish
 */
export const getNewsList = async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const cacheKey = `news:list:${limit}`;
  if (sendCachedJson(res, newsListCache, cacheKey, NEWS_LIST_CACHE_TTL_MS)) return;

  const items = await NewsArticle.find({ status: "published" })
    .sort({ originalPublishedAt: -1, createdAt: -1 })
    .limit(limit)
    .select(
      "slug title summary heroImageUrl thumbImageUrl sourceName originalPublishedAt createdAt tags sourceUrl"
    )
    .lean();

  const normalized = items.map((it) => normalizeArticleForResponse(it));

  cacheAndSendJson(res, newsListCache, cacheKey, normalized, NEWS_LIST_CACHE_TTL_MS);
};

/**
 * GET /api/news/:slug
 * Lấy chi tiết 1 bài viết theo slug
 */
export const getNewsDetail = async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  const cacheKey = `news:detail:${slug}`;
  if (sendCachedJson(res, newsDetailCache, cacheKey, NEWS_DETAIL_CACHE_TTL_MS)) return;

  const article = await NewsArticle.findOne({
    slug,
    status: "published",
  }).lean();

  if (!article) {
    return res.status(404).json({ message: "Không tìm thấy bài viết" });
  }

  const normalized = normalizeArticleForResponse(article);
  cacheAndSendJson(
    res,
    newsDetailCache,
    cacheKey,
    normalized,
    NEWS_DETAIL_CACHE_TTL_MS,
  );
};
