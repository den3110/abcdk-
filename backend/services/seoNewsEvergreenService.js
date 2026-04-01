import crypto from "crypto";
import slugify from "slugify";

import SeoNewsArticle from "../models/seoNewsArticleModel.js";
import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import {
  sanitizeSeoNewsHtml,
  stripSeoNewsHtmlToText,
} from "./seoNewsSanitizerService.js";
import {
  getSeoNewsArticleGenerationRuntime,
} from "./seoNewsArticleGenerationGateway.js";
import {
  reviewSeoNewsArticle,
  SEO_NEWS_REVIEW_PASS_SCORE,
} from "./seoNewsReviewService.js";
import { resolveSeoNewsImages } from "./seoNewsImageService.js";
import { evaluateSeoNewsRelevance } from "./seoNewsRelevanceService.js";

const EVERGREEN_TOPICS = [
  "Hướng dẫn người mới bắt đầu với pickleball",
  "Cách xây dựng lịch thi đấu pickleball hiệu quả",
  "Kinh nghiệm tổ chức giải pickleball cho CLB",
  "Cách quản lý bracket và kết quả trận đấu",
  "Vai trò của xếp hạng và điểm trình trong phong trào",
  "Giải pháp livestream cho giải pickleball",
  "Kinh nghiệm truyền thông sự kiện pickleball",
  "Tối ưu đăng ký giải đấu trên website",
  "Best practices SEO cho website pickleball",
  "Cách tăng tương tác cộng đồng pickleball online",
];

const GENERATION_PROMPT = `
Bạn là content agent cho website PickleTour.

Nhiệm vụ:
- Viết bài evergreen tiếng Việt để tăng SEO về pickleball và website.
- Nội dung phải hữu ích, không spam keyword, không đưa thông tin không có căn cứ.
- Không copy nguyên văn từ nguồn báo bên ngoài.
- Tôn trọng policy và bản quyền.

Yêu cầu ngôn ngữ bắt buộc:
- BẮT BUỘC viết tiếng Việt có dấu đầy đủ, đúng chính tả.
- Tuyệt đối không dùng kiểu không dấu (ví dụ: "khong dau", "viet bai", "nguoi choi").

Trả về đúng JSON:
{
  "title": "string",
  "summary": "string",
  "contentHtml": "string",
  "tags": ["string"],
  "heroImageUrl": "string | null",
  "thumbImageUrl": "string | null"
}

Ràng buộc:
- title 45-75 ký tự.
- summary 1-3 câu, rõ ràng.
- contentHtml dùng các tag: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>.
- contentHtml tối thiểu 3 đoạn văn và có giá trị thực tế.
`;

function pickTopic(seed) {
  const idx = Math.abs(seed) % EVERGREEN_TOPICS.length;
  return EVERGREEN_TOPICS[idx];
}

function extractJsonFromResponse(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    try {
      return JSON.parse(response.output_text);
    } catch {
      // ignore
    }
  }

  const out = response?.output;
  if (!Array.isArray(out)) return null;

  for (const item of out) {
    const parts = item?.content;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (part?.type === "output_json" && part?.json) {
        return part.json;
      }

      const maybe =
        part?.text?.value ||
        (typeof part?.text === "string" ? part.text : "") ||
        "";
      if (!maybe) continue;
      try {
        return JSON.parse(maybe);
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function fallbackArticle(topic, keywords = []) {
  const kw = keywords.slice(0, 3).join(", ");
  const title = `${topic}: hướng dẫn thực chiến cho người chơi và ban tổ chức`;
  const summary =
    "Bài viết tổng hợp các bước thực tế để cải thiện chất lượng giải đấu pickleball và tối ưu hiện diện website.";

  const html = `
    <p>Pickleball đang tăng trưởng nhanh tại Việt Nam và cần cách vận hành bài bản hơn để duy trì trải nghiệm cho người chơi.</p>
    <h2>Lập kế hoạch nội dung và sự kiện</h2>
    <p>Ban tổ chức nên xác định mục tiêu sự kiện, đối tượng tham gia và thông điệp truyền thông ngay từ đầu để tối ưu hiệu quả.</p>
    <h2>Tối ưu vận hành trên website</h2>
    <ul>
      <li>Công bố lịch thi đấu và kết quả rõ ràng.</li>
      <li>Cập nhật thông báo nhanh để giảm nhầm lẫn.</li>
      <li>Chuẩn hóa bài viết SEO theo nhu cầu tìm kiếm của người dùng.</li>
    </ul>
    <p>Tập trung vào giá trị thật cho cộng đồng thay vì nhồi keyword. ${
      kw ? `Từ khóa tham chiếu: ${kw}.` : ""
    }</p>
  `;

  return {
    title,
    summary,
    contentHtml: html,
    tags: ["pickleball", "seo", "website"],
    heroImageUrl: null,
    thumbImageUrl: null,
  };
}

function toSlug(title) {
  return `${slugify(String(title || "seo-news"), {
    lower: true,
    strict: true,
  })}-${Math.random().toString(36).slice(2, 6)}`;
}

function hasVietnameseDiacritics(value = "") {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(
    String(value || "")
  );
}

async function generateOneEvergreen({ topic, keywords, settings }) {
  const payload = {
    topic,
    keywords,
    audience: "Người chơi pickleball và ban tổ chức giải tại Việt Nam",
    goals: ["SEO", "giá trị hữu ích", "thực dụng"],
  };

  try {
    const articleGenerationRuntime = await getSeoNewsArticleGenerationRuntime({
      selectedModel: settings?.articleGenerationModel,
    });
    if (
      !articleGenerationRuntime.client ||
      !articleGenerationRuntime.effectiveModel
    ) {
      throw new Error("seo_news_article_generation_not_configured");
    }

    const response = await articleGenerationRuntime.client.responses.create({
      model: articleGenerationRuntime.effectiveModel,
      instructions: GENERATION_PROMPT,
      input: [{ role: "user", content: JSON.stringify(payload) }],
      text: {
        format: {
          type: "json_schema",
          name: "seo_news_evergreen",
          strict: false,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              contentHtml: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              heroImageUrl: { type: "string" },
              thumbImageUrl: { type: "string" },
            },
            required: ["title", "summary", "contentHtml"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = extractJsonFromResponse(response);
    if (!parsed || !parsed.contentHtml) {
      return fallbackArticle(topic, keywords);
    }

    const fallback = fallbackArticle(topic, keywords);
    const generatedText = `${parsed.title || ""} ${parsed.summary || ""} ${
      parsed.contentHtml || ""
    }`;

    if (!hasVietnameseDiacritics(generatedText)) {
      return fallback;
    }

    return {
      title: String(parsed.title || "").trim() || fallback.title,
      summary: String(parsed.summary || "").trim() || fallback.summary,
      contentHtml: String(parsed.contentHtml || "").trim() || fallback.contentHtml,
      generatorModel: articleGenerationRuntime.effectiveModel,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .map((tag) => String(tag || "").trim())
            .filter(Boolean)
            .slice(0, 8)
        : fallback.tags,
      heroImageUrl: parsed.heroImageUrl || null,
      thumbImageUrl: parsed.thumbImageUrl || parsed.heroImageUrl || null,
    };
  } catch (err) {
    console.warn("[SeoNewsEvergreen] generation failed, use fallback:", err?.message || err);
    return fallbackArticle(topic, keywords);
  }
}

export async function generateSeoNewsEvergreenArticles({
  count = 0,
  settings,
  runId,
  forcePublish = false,
} = {}) {
  const activeSettings =
    settings ||
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }));
  const wanted = Math.max(0, Number(count) || 0);
  const keywords = [
    ...(activeSettings?.mainKeywords || []),
    ...(activeSettings?.extraKeywords || []),
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 12);

  const passScore =
    Number(activeSettings?.reviewPassScore) || SEO_NEWS_REVIEW_PASS_SCORE;

  const stats = {
    requested: wanted,
    generated: 0,
    reviewPassed: 0,
    reviewFailed: 0,
    published: 0,
    draft: 0,
    failed: 0,
    items: [],
  };

  for (let i = 0; i < wanted; i += 1) {
    try {
      const topic = pickTopic(Date.now() + i);
      const generated = await generateOneEvergreen({
        topic,
        keywords,
        settings: activeSettings,
      });
      const cleanHtml = sanitizeSeoNewsHtml(generated.contentHtml || "");
      const contentText = stripSeoNewsHtmlToText(cleanHtml);
      const slug = toSlug(generated.title);

      const relevance = evaluateSeoNewsRelevance({
        title: generated.title,
        summary: generated.summary,
        contentText,
        tags: generated.tags,
        sourceName: "PickleTour AI Agent",
        sourceUrl: null,
        settings: activeSettings,
      });

      let review = await reviewSeoNewsArticle({
        title: generated.title,
        summary: generated.summary,
        contentHtml: cleanHtml,
        origin: "generated",
        sourceName: "PickleTour AI Agent",
        sourceUrl: null,
        tags: generated.tags,
      });

      if (!relevance.isRelevant) {
        review = {
          ...review,
          status: "fail",
          score: Math.min(Number(review.score) || 0, relevance.score),
          reasons: [
            ...(Array.isArray(review.reasons) ? review.reasons : []),
            ...(Array.isArray(relevance.reasons) ? relevance.reasons : []),
          ],
          criticalFlags: [
            ...(Array.isArray(review.criticalFlags) ? review.criticalFlags : []),
            "off_topic_content",
          ],
        };
      }

      const reviewPass =
        relevance.isRelevant &&
        review.status === "pass" &&
        Number(review.score) >= passScore &&
        (!Array.isArray(review.criticalFlags) || review.criticalFlags.length === 0);

      const status =
        reviewPass && (forcePublish || activeSettings?.autoPublish !== false)
          ? "published"
          : "draft";

      const imageAsset = await resolveSeoNewsImages({
        title: generated.title,
        summary: generated.summary,
        tags: generated.tags,
        sourceUrl: null,
        origin: "generated",
        preferredImageUrl: generated.heroImageUrl || generated.thumbImageUrl,
        settings: activeSettings,
        articleKey: slug,
      });

      await SeoNewsArticle.create({
        slug,
        title: generated.title,
        summary: generated.summary,
        contentHtml: cleanHtml,
        contentText,
        sourceName: "PickleTour AI Agent",
        sourceUrl: null,
        originalPublishedAt: null,
        fetchedAt: new Date(),
        tags: generated.tags,
        language: "vi",
        heroImageUrl: imageAsset.heroImageUrl || generated.heroImageUrl || null,
        thumbImageUrl:
          imageAsset.thumbImageUrl ||
          imageAsset.heroImageUrl ||
          generated.thumbImageUrl ||
          generated.heroImageUrl ||
          null,
        relevanceScore: relevance.score,
        origin: "generated",
        status,
        contentHash: crypto
          .createHash("sha256")
          .update(`${generated.title}\n${contentText}`.slice(0, 8000))
          .digest("hex"),
        review,
        workflow: {
          generatorModel: generated.generatorModel || null,
          reviewerModel: review.checkerModel,
          runId: String(runId || "manual"),
        },
      });

      stats.generated += 1;
      if (reviewPass) stats.reviewPassed += 1;
      else stats.reviewFailed += 1;
      if (status === "published") stats.published += 1;
      else stats.draft += 1;
      stats.items.push({ slug, topic, status, score: review.score, relevanceScore: relevance.score, imageOrigin: imageAsset.imageOrigin });
    } catch (err) {
      stats.failed += 1;
      console.warn("[SeoNewsEvergreen] save failed:", err?.message || err);
    }
  }

  return stats;
}






