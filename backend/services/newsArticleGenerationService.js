import crypto from "crypto";
import OpenAI from "openai";
import slugify from "slugify";

import NewsArticle from "../models/newsArticlesModel.js";
import {
  sanitizeSeoNewsHtml,
  stripSeoNewsHtmlToText,
} from "./seoNewsSanitizerService.js";

const DEFAULT_TOPICS = [
  "Kinh nghiệm tập luyện pickleball cho người mới",
  "Cách chuẩn bị trước khi tham gia giải pickleball",
  "Chiến thuật đánh đôi pickleball cơ bản",
  "Cách tổ chức một giải pickleball phong trào",
  "Vai trò của điểm trình trong cộng đồng pickleball",
  "Cách theo dõi lịch thi đấu và kết quả giải pickleball",
];

const GENERATION_SYSTEM_PROMPT = `
Bạn là biên tập viên cho mục Tin tức PickleTour.

Yêu cầu bắt buộc:
- Viết bài tiếng Việt có dấu đầy đủ, đúng chính tả.
- Không dùng tiếng Việt không dấu.
- Không bịa thông tin thời sự, tên giải, tên người hoặc số liệu cụ thể nếu không được cung cấp.
- Nội dung là bài evergreen/hướng dẫn liên quan pickleball, giải đấu và hệ sinh thái PickleTour.
- Không copy bài báo bên ngoài.

Trả về duy nhất JSON:
{
  "title": "string",
  "summary": "string",
  "contentHtml": "string",
  "tags": ["string"]
}

Ràng buộc:
- title 45-90 ký tự.
- summary 1-3 câu.
- contentHtml dùng các tag: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>.
- contentHtml tối thiểu 4 đoạn có giá trị thực tế.
`;

function normalizeOpenAiBaseUrl(value) {
  const base = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return "http://127.0.0.1:8317/v1";
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function getClient() {
  return new OpenAI({
    apiKey:
      process.env.NEWS_AI_GENERATION_API_KEY ||
      process.env.OPENAI_POSTER_API_KEY ||
      process.env.OPENAI_CCCD_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.CLIPROXY_API_KEY ||
      "local-news",
    baseURL: normalizeOpenAiBaseUrl(
      process.env.NEWS_AI_GENERATION_BASE_URL ||
        process.env.OPENAI_POSTER_BASE_URL ||
        process.env.OPENAI_CCCD_BASE_URL ||
        "http://127.0.0.1:8317",
    ),
    timeout: Number(process.env.NEWS_AI_GENERATION_TIMEOUT_MS) || 120000,
  });
}

function pickTopic(topic, index) {
  const custom = String(topic || "").trim();
  if (custom) return custom;
  return DEFAULT_TOPICS[Math.abs(Date.now() + index) % DEFAULT_TOPICS.length];
}

function extractMessageText(messageContent) {
  if (typeof messageContent === "string") return messageContent;
  if (!Array.isArray(messageContent)) return "";
  return messageContent
    .map((part) => part?.text || part?.content || "")
    .filter(Boolean)
    .join("\n");
}

function parseJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const withoutFence = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const match = withoutFence.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function hasVietnameseDiacritics(value = "") {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(
    String(value || ""),
  );
}

function fallbackArticle(topic) {
  return {
    title: `${topic}: hướng dẫn thực tế cho người chơi pickleball`,
    summary:
      "Bài viết tổng hợp các lưu ý thực tế giúp người chơi và ban tổ chức chuẩn bị tốt hơn cho hoạt động pickleball.",
    contentHtml: `
      <p>Pickleball đang phát triển nhanh tại Việt Nam, kéo theo nhu cầu tập luyện, thi đấu và tổ chức giải bài bản hơn.</p>
      <h2>Xác định mục tiêu trước khi bắt đầu</h2>
      <p>Người chơi nên chọn mục tiêu rõ ràng như cải thiện kỹ thuật, tăng thể lực hoặc chuẩn bị cho giải đấu sắp tới.</p>
      <h2>Chuẩn bị lịch tập và lịch thi đấu</h2>
      <ul>
        <li>Duy trì lịch tập đều đặn thay vì tập quá dày trong thời gian ngắn.</li>
        <li>Theo dõi lịch thi đấu, điều lệ và điểm trình trước khi đăng ký giải.</li>
        <li>Ghi nhận kết quả sau mỗi trận để điều chỉnh chiến thuật.</li>
      </ul>
      <p>Với ban tổ chức, thông tin rõ ràng về lịch, bảng đấu và kết quả giúp người chơi có trải nghiệm ổn định hơn.</p>
    `,
    tags: ["pickleball", "PickleTour", "giải đấu"],
  };
}

function normalizeGeneratedArticle(raw, topic) {
  const fallback = fallbackArticle(topic);
  const title = String(raw?.title || "").trim() || fallback.title;
  const summary = String(raw?.summary || "").trim() || fallback.summary;
  const contentHtml =
    String(raw?.contentHtml || "").trim() || fallback.contentHtml;
  const combined = `${title} ${summary} ${contentHtml}`;

  const next = hasVietnameseDiacritics(combined)
    ? {
        title,
        summary,
        contentHtml,
        tags: Array.isArray(raw?.tags)
          ? raw.tags
              .map((tag) => String(tag || "").trim())
              .filter(Boolean)
              .slice(0, 8)
          : fallback.tags,
      }
    : fallback;

  const cleanHtml = sanitizeSeoNewsHtml(next.contentHtml);
  const contentText = stripSeoNewsHtmlToText(cleanHtml);

  return {
    ...next,
    contentHtml: cleanHtml,
    contentText,
    tags: next.tags?.length ? next.tags : fallback.tags,
  };
}

async function generateWithAi({ topic, index }) {
  const client = getClient();
  const model =
    process.env.NEWS_AI_GENERATION_MODEL ||
    process.env.OPENAI_POSTER_MODEL ||
    process.env.OPENAI_CCCD_MODEL ||
    "gpt-5";

  const messages = [
    { role: "system", content: GENERATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        topic,
        index,
        audience: "Người chơi pickleball và ban tổ chức giải tại Việt Nam",
      }),
    },
  ];

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: "json_object" },
    });
  } catch (error) {
    if (!String(error?.message || "").includes("response_format")) {
      throw error;
    }

    response = await client.chat.completions.create({
      model,
      messages,
    });
  }

  const text = extractMessageText(response?.choices?.[0]?.message?.content);
  return {
    model,
    raw: parseJson(text),
  };
}

function makeSlug(title) {
  const base = slugify(String(title || "tin-pickleball"), {
    lower: true,
    strict: true,
  });
  return `${base || "tin-pickleball"}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function generateNewsArticles({
  count = 1,
  topic = "",
  publish = true,
} = {}) {
  const wanted = Math.max(1, Math.min(Number(count) || 1, 5));
  const stats = {
    requested: wanted,
    generated: 0,
    failed: 0,
    items: [],
  };

  for (let i = 0; i < wanted; i += 1) {
    const selectedTopic = pickTopic(topic, i);
    try {
      let aiResult = null;
      try {
        aiResult = await generateWithAi({ topic: selectedTopic, index: i + 1 });
      } catch (error) {
        console.warn(
          "[NewsGenerate] AI failed, using fallback:",
          error?.message || error,
        );
      }

      const article = normalizeGeneratedArticle(aiResult?.raw, selectedTopic);
      const slug = makeSlug(article.title);
      const sourceUrl = `generated://pickletour-news/${slug}`;
      const contentHash = crypto
        .createHash("sha256")
        .update(`${article.title}\n${article.contentText}`.slice(0, 8000))
        .digest("hex");

      const saved = await NewsArticle.create({
        slug,
        title: article.title,
        summary: article.summary,
        contentHtml: article.contentHtml,
        contentText: article.contentText,
        sourceName: "PickleTour AI",
        sourceUrl,
        originalPublishedAt: new Date(),
        fetchedAt: new Date(),
        tags: article.tags,
        language: "vi",
        heroImageUrl: null,
        thumbImageUrl: null,
        relevanceScore: 1,
        status: publish ? "published" : "draft",
        contentHash,
      });

      stats.generated += 1;
      stats.items.push({
        slug: saved.slug,
        title: saved.title,
        status: saved.status,
        model: aiResult?.model || "fallback",
      });
    } catch (error) {
      stats.failed += 1;
      console.warn("[NewsGenerate] save failed:", error?.message || error);
    }
  }

  return stats;
}
