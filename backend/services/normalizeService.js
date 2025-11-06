// src/services/normalizeService.js
import { openai } from "../lib/openaiClient.js";

const NORMALIZE_PROMPT_VI = `
Bạn là biên tập viên cho mục Tin tức PickleTour.

ĐẦU VÀO: nội dung đã crawl từ một bài báo về pickleball / giải đấu liên quan.

YÊU CẦU:
- KHÔNG bịa, chỉ dùng thông tin từ input.
- Ưu tiên tiếng Việt cho title và summary.
- Nếu bài gốc không phải tiếng Việt:
  - summary: viết tiếng Việt.
  - contentHtml: có thể giữ ngôn ngữ gốc nhưng làm sạch.
- Chuẩn hóa:

1) title:
  - Rõ ràng, đúng nội dung, không giật tít quá đà.

2) summary:
  - 1–3 câu tóm tắt, tiếng Việt.

3) contentHtml:
  - HTML sạch, chỉ dùng: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>.
  - Không: script, style, iframe, form, quảng cáo, widget, comment, share button.
  - Giữ: thời gian, địa điểm, kết quả, nhân vật, thông tin chính.

4) heroImageUrl / thumbImageUrl:
  - Nếu input có ảnh hợp lý, có thể giữ.
  - Nếu không chắc chắn, để null.

5) tags:
  - 3–8 tag ngắn gọn: ["pickleball", "tournament", "Việt Nam", "PickleTour", ...].

ĐẦU RA:
CHỈ JSON:
{
  "title": "string",
  "summary": "string",
  "contentHtml": "string",
  "heroImageUrl": "string | null",
  "thumbImageUrl": "string | null",
  "language": "string",
  "tags": ["string", ...]
}
Không thêm text ngoài JSON.
`;

const NORMALIZE_MODEL = process.env.OPENAI_NORMALIZE_MODEL || "gpt-4.1";

export async function normalizeArticleWithAI(input) {
  const { url, sourceName, baseTitle, text, contentHtml, tags } = input;

  const payload = {
    url,
    sourceName,
    baseTitle,
    textSnippet: (text || "").slice(0, 8000),
    rawHtmlSnippet: (contentHtml || "").slice(0, 8000),
    existingTags: tags || [],
  };

  try {
    const response = await openai.responses.create({
      model: NORMALIZE_MODEL,
      instructions: NORMALIZE_PROMPT_VI,
      input: [
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "normalized_article",
          strict: false,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              contentHtml: { type: "string" },
              heroImageUrl: { type: "string" },
              thumbImageUrl: { type: "string" },
              language: { type: "string" },
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["title", "contentHtml"],
            additionalProperties: false,
          },
        },
      },
    });

    const jsonText =
      response.output_text ||
      (response.output && response.output[0]?.content?.[0]?.text) ||
      "";

    let data = {};
    try {
      if (jsonText) {
        data = JSON.parse(jsonText);
      }
    } catch (e) {
      console.warn("[Normalize] Parse JSON fail, fallback raw:", e.message);
      data = {};
    }

    return {
      title: data.title || baseTitle || "Tin pickleball",
      summary: data.summary || (text ? text.slice(0, 220) : "") || "",
      contentHtml: data.contentHtml || contentHtml || "",
      heroImageUrl: data.heroImageUrl || null,
      thumbImageUrl: data.thumbImageUrl || data.heroImageUrl || null,
      language: data.language || "vi",
      tags:
        (Array.isArray(data.tags) && data.tags.length ? data.tags : tags) || [],
    };
  } catch (err) {
    console.error("[Normalize] OpenAI error, dùng raw:", err.message);

    return {
      title: baseTitle || "Tin pickleball",
      summary: (text && text.slice(0, 220)) || baseTitle || "",
      contentHtml: contentHtml || "",
      heroImageUrl: null,
      thumbImageUrl: null,
      language: "vi",
      tags: tags || [],
    };
  }
}
