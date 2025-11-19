// src/services/normalizeService.js
import { gemini, Type } from "../lib/geminiClient.js";

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

// dùng env riêng cho Gemini, nếu không set thì default flash rẻ
const NORMALIZE_MODEL =
  process.env.GEMINI_NORMALIZE_MODEL || "gemini-2.5-flash";

// Schema structured output cho Gemini
const NORMALIZE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    contentHtml: { type: Type.STRING },
    heroImageUrl: { type: Type.STRING },
    thumbImageUrl: { type: Type.STRING },
    language: { type: Type.STRING },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["title", "contentHtml"],
};

// Helper bóc JSON từ response Gemini
function extractJsonFromResponse(response) {
  if (!response) return null;

  // đường chuẩn: response.text (vì đã set responseMimeType = application/json)
  if (typeof response.text === "string" && response.text.trim()) {
    try {
      return JSON.parse(response.text);
    } catch {
      // ignore, fallback phía dưới
    }
  }

  const candidates = response.candidates || response.response?.candidates;
  if (Array.isArray(candidates) && candidates.length) {
    const parts = candidates[0]?.content?.parts;
    if (Array.isArray(parts) && parts.length) {
      const first = parts[0];
      const txt =
        typeof first === "string"
          ? first
          : typeof first.text === "string"
          ? first.text
          : null;
      if (txt) {
        try {
          return JSON.parse(txt);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export async function normalizeArticleWithAIV2(input) {
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
    const response = await gemini.models.generateContent({
      model: NORMALIZE_MODEL,
      contents: JSON.stringify(payload),
      config: {
        systemInstruction: NORMALIZE_PROMPT_VI,
        // JSON mode
        responseMimeType: "application/json",
        responseSchema: NORMALIZE_SCHEMA,
        // không cần suy nghĩ sâu, cho nhanh & rẻ
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    });

    const data = extractJsonFromResponse(response) || {};

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
    console.error("[Normalize] Gemini error, dùng raw:", err.message);

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
