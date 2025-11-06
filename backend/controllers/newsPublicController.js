// src/controllers/newsPublicController.js
import NewsArticle from "../models/newsArticlesModel.js";

/**
 * GET /api/news
 * Lấy danh sách bài viết đã publish
 */
export const getNewsList = async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const items = await NewsArticle.find({ status: "published" })
    .sort({ originalPublishedAt: -1, createdAt: -1 })
    .limit(limit)
    .select(
      "slug title summary heroImageUrl thumbImageUrl sourceName originalPublishedAt createdAt tags"
    )
    .lean();

  res.json(items);
};

/**
 * GET /api/news/:slug
 * Lấy chi tiết 1 bài viết theo slug
 */
export const getNewsDetail = async (req, res) => {
  const article = await NewsArticle.findOne({
    slug: req.params.slug,
    status: "published",
  }).lean();

  if (!article) {
    return res.status(404).json({ message: "Không tìm thấy bài viết" });
  }

  res.json(article);
};
