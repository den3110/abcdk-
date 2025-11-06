// src/services/normalizeService.js
import { openai } from "../lib/openaiClient.js";

const NORMALIZE_PROMPT_VI = `
Bạn là biên tập viên cho mục Tin tức PickleTour.

ĐẦU VÀO: nội dung đã crawl từ một bài báo về pickleball.
NHIỆM VỤ:
- Giữ nguyên fact, KHÔNG bịa.
- Chuẩn hóa:
  - title: rõ ràng, dễ hiểu, ngắn gọn, đúng nội dung.
  - summary: 1-3 câu tiếng Việt tóm tắt, nếu bài gốc không phải tiếng Việt thì tóm tắt tiếng Việt.
  - contentHtml: HTML sạch để render trên web/app:
    - Chỉ dùng thẻ cơ bản: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>.
    - Loại bỏ script, iframe, quảng cáo, widget, link vô nghĩa.
    - Giữ lại các thông tin quan trọng: thời gian, địa điểm, kết quả, nhân vật chính.
  - tags: gợi ý 3-8 tag: ví dụ ["pickleball", "tournament", "livestream", "technology"].
- Ngôn ngữ ưu tiên: tiếng Việt cho summary; content có thể giữ nguyên ngôn ngữ gốc nếu khó dịch đầy đủ.

ĐẦU RA:
- CHỈ trả JSON:
{
  "title": "string",
  "summary": "string",
  "contentHtml": "string",
  "heroImageUrl": "string | null",
  "thumbImageUrl": "string | null",
  "language": "string",       // "vi" | "en" | ...
  "tags": ["string", ...]
}
`;

export async function normalizeArticleWithAI(input) {
  const { url, sourceName, baseTitle, text, contentHtml, tags } = input;

  const completion = await openai.chat.completions.create({
    model: "gpt-5",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "normalized_article",
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
        },
        strict: true,
      },
    },
    messages: [
      { role: "system", content: NORMALIZE_PROMPT_VI },
      {
        role: "user",
        content: JSON.stringify({
          url,
          sourceName,
          baseTitle,
          textSnippet: text.slice(0, 8000),
          rawHtmlSnippet: contentHtml.slice(0, 8000),
          existingTags: tags,
        }),
      },
    ],
  });

  const data = JSON.parse(completion.choices[0].message.content || "{}");
  return {
    title: data.title || baseTitle,
    summary: data.summary || text.slice(0, 220),
    contentHtml: data.contentHtml || contentHtml,
    heroImageUrl: data.heroImageUrl || null,
    thumbImageUrl: data.thumbImageUrl || data.heroImageUrl || null,
    language: data.language || "vi",
    tags: data.tags || tags || [],
  };
}
