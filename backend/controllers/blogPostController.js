import slugify from "slugify";

import BlogPost from "../models/blogPostModel.js";
import {
  sanitizeSeoNewsHtml,
  stripSeoNewsHtmlToText,
} from "../services/seoNewsSanitizerService.js";

function cleanPage(value, fallback = 1) {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return fallback;
  return Math.floor(page);
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toStringValue(value, fallback = "") {
  if (typeof value === "undefined" || value === null) return fallback;
  return String(value).trim();
}

function toNullableDate(value, fallback = null) {
  if (typeof value === "undefined") return fallback;
  if (value === null || value === "") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function cleanSlug(value) {
  return slugify(String(value || ""), {
    lower: true,
    strict: true,
    locale: "vi",
  }).slice(0, 120);
}

async function makeUniqueSlug(seed, currentId = null) {
  const base = cleanSlug(seed) || `blog-${Date.now()}`;
  const shortBase = base.slice(0, 100);

  for (let index = 0; index < 50; index += 1) {
    const slug = index === 0 ? shortBase : `${shortBase}-${index + 1}`;
    const query = { slug };

    if (currentId) {
      query._id = { $ne: currentId };
    }

    const exists = await BlogPost.exists(query);
    if (!exists) return slug;
  }

  return `${shortBase}-${Date.now()}`;
}

function normalizeBlogPostPayload(body = {}, existing = {}) {
  const title = toStringValue(body.title, existing.title || "");
  const summary = toStringValue(body.summary, existing.summary || "");
  const contentSource =
    typeof body.contentHtml === "undefined"
      ? existing.contentHtml || ""
      : body.contentHtml;
  const contentHtml = sanitizeSeoNewsHtml(contentSource || "");
  const contentText = stripSeoNewsHtmlToText(contentHtml);

  if (!title) {
    const error = new Error("Vui lòng nhập tiêu đề bài viết.");
    error.statusCode = 400;
    throw error;
  }

  if (!contentText) {
    const error = new Error("Vui lòng nhập nội dung bài viết.");
    error.statusCode = 400;
    throw error;
  }

  const statusValue = toStringValue(body.status, existing.status || "draft")
    .toLowerCase();
  const status = ["draft", "published", "hidden"].includes(statusValue)
    ? statusValue
    : "draft";

  const existingBanner = existing.homepageBanner || {};
  const bodyBanner = body.homepageBanner || {};
  const enabledRaw = toBoolean(bodyBanner.enabled);
  const bannerEnabled =
    typeof enabledRaw === "boolean" ? enabledRaw : !!existingBanner.enabled;
  const startsAt = toNullableDate(bodyBanner.startsAt, existingBanner.startsAt || null);
  const endsAt = toNullableDate(bodyBanner.endsAt, existingBanner.endsAt || null);

  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
    const error = new Error("Thời gian kết thúc banner phải sau thời gian bắt đầu.");
    error.statusCode = 400;
    throw error;
  }

  const priority = toNumber(bodyBanner.priority);
  const publishedAt = toNullableDate(body.publishedAt, existing.publishedAt || null);

  return {
    title,
    summary,
    contentHtml,
    contentText,
    tags:
      typeof body.tags === "undefined"
        ? existing.tags || []
        : toStringArray(body.tags),
    status,
    heroImageUrl: toStringValue(body.heroImageUrl, existing.heroImageUrl || ""),
    authorName: toStringValue(body.authorName, existing.authorName || "PickleTour"),
    publishedAt:
      publishedAt ||
      existing.publishedAt ||
      (status === "published" ? new Date() : null),
    homepageBanner: {
      enabled: bannerEnabled,
      text: toStringValue(bodyBanner.text, existingBanner.text || "") || title,
      startsAt,
      endsAt,
      priority: Number.isFinite(priority)
        ? Math.floor(priority)
        : Number(existingBanner.priority || 0),
    },
  };
}

export const listAdminBlogPosts = async (req, res) => {
  const page = cleanPage(req.query.page, 1);
  const limit = Math.min(cleanPage(req.query.limit, 50), 200);
  const skip = (page - 1) * limit;
  const status = String(req.query.status || "").trim().toLowerCase();
  const keyword = String(req.query.keyword || "").trim();

  const query = {};
  if (["draft", "published", "hidden"].includes(status)) {
    query.status = status;
  }
  if (keyword) {
    query.$or = [
      { title: { $regex: keyword, $options: "i" } },
      { summary: { $regex: keyword, $options: "i" } },
      { slug: { $regex: keyword, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    BlogPost.find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "_id slug title summary tags status heroImageUrl publishedAt authorName homepageBanner createdAt updatedAt",
      )
      .lean(),
    BlogPost.countDocuments(query),
  ]);

  return res.json({
    items,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
};

export const createAdminBlogPost = async (req, res) => {
  try {
    const payload = normalizeBlogPostPayload(req.body || {});
    const slug = await makeUniqueSlug(req.body?.slug || payload.title);
    const post = await BlogPost.create({ ...payload, slug });

    return res.status(201).json(post);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      message: error?.message || "Không tạo được bài blog.",
    });
  }
};

export const getAdminBlogPostById = async (req, res) => {
  const post = await BlogPost.findById(req.params.id).lean();

  if (!post) {
    return res.status(404).json({ message: "Không tìm thấy bài viết." });
  }

  return res.json(post);
};

export const updateAdminBlogPost = async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: "Không tìm thấy bài viết." });
    }

    const payload = normalizeBlogPostPayload(req.body || {}, post);
    const rawSlug = toStringValue(req.body?.slug, post.slug);
    const nextSlug =
      rawSlug && rawSlug !== post.slug
        ? await makeUniqueSlug(rawSlug, post._id)
        : post.slug;

    post.set({ ...payload, slug: nextSlug });
    const saved = await post.save();

    return res.json(saved);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
      message: error?.message || "Không lưu được bài blog.",
    });
  }
};

export const deleteAdminBlogPost = async (req, res) => {
  const post = await BlogPost.findById(req.params.id);

  if (!post) {
    return res.status(404).json({ message: "Không tìm thấy bài viết." });
  }

  await post.deleteOne();
  return res.json({ ok: true });
};

export const getPublicBlogPostBySlug = async (req, res) => {
  const post = await BlogPost.findOne({
    slug: req.params.slug,
    status: "published",
  }).lean();

  if (!post) {
    return res.status(404).json({ message: "Không tìm thấy bài viết." });
  }

  return res.json({
    ...post,
    contentHtml: sanitizeSeoNewsHtml(post.contentHtml || ""),
  });
};

export const getPublicBlogHomepageBanner = async (_req, res) => {
  const now = new Date();
  const post = await BlogPost.findOne({
    status: "published",
    "homepageBanner.enabled": true,
    $and: [
      {
        $or: [
          { "homepageBanner.startsAt": null },
          { "homepageBanner.startsAt": { $exists: false } },
          { "homepageBanner.startsAt": { $lte: now } },
        ],
      },
      {
        $or: [
          { "homepageBanner.endsAt": null },
          { "homepageBanner.endsAt": { $exists: false } },
          { "homepageBanner.endsAt": { $gte: now } },
        ],
      },
    ],
  })
    .sort({
      "homepageBanner.priority": -1,
      updatedAt: -1,
      createdAt: -1,
    })
    .select("slug title summary authorName publishedAt homepageBanner createdAt")
    .lean();

  if (!post) {
    return res.json({ banner: null });
  }

  return res.json({
    banner: {
      text: post.homepageBanner?.text || post.title,
      href: `/blog/${post.slug}`,
      startsAt: post.homepageBanner?.startsAt || null,
      endsAt: post.homepageBanner?.endsAt || null,
      post: {
        slug: post.slug,
        title: post.title,
        summary: post.summary,
        authorName: post.authorName,
        publishedAt: post.publishedAt || post.createdAt,
      },
    },
  });
};
