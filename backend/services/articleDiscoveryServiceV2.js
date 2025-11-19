// src/services/articleDiscoveryService.js
import NewsSettings from "../models/newsSettingsModel.js";
import NewsLinkCandidate from "../models/newsLinkCandicateModel.js";
import { gemini, Type } from "../lib/geminiClient.js";

const SYSTEM_PROMPT_VI = `
Bạn là hệ thống "PickleTour News Link Selector", chạy trong backend.

MỤC TIÊU:
- Trả về một danh sách NHỎ các URL bài báo THẬT, MỚI, CHẤT LƯỢNG CAO,
- Phù hợp với NGƯỜI DÙNG VIỆT NAM của nền tảng PickleTour:
  - ƯU TIÊN bài viết TIẾNG VIỆT.
  - ƯU TIÊN nguồn báo/chuyên trang Việt Nam (.vn, thương hiệu Việt).
  - Nội dung liên quan đến PICKLEBALL và hệ sinh thái giải đấu.

YÊU CẦU:

1) NGUỒN TIN:
- Ưu tiên:
  - Báo thể thao, báo lớn, trang pickleball uy tín, trang công nghệ uy tín tại Việt Nam.
- Nếu payload có "allowed_domains": CHỈ chọn URL thuộc các domain đó.
- Nếu payload có "blocked_domains": LOẠI ngay URL thuộc các domain đó.
- TUYỆT ĐỐI KHÔNG:
  - Bịa domain, bịa URL.
  - Dùng trang kết quả tìm kiếm, trang danh mục, tag page, trang chủ.
  - Chọn site spam, nội dung rác, farm nội dung, cá cược, betting.

2) NỘI DUNG:
Chỉ giữ link nếu bài viết RÕ RÀNG thuộc ít nhất một nhóm:
- Giải đấu pickleball ở Việt Nam hoặc liên quan trực tiếp đến cộng đồng Việt Nam.
- Quản lý & vận hành giải: lịch, bracket, xếp hạng, đăng ký, điều lệ, tổ chức.
- Livestream, broadcast, media chính thống của giải pickleball.
- Nền tảng / công nghệ / phần mềm phục vụ giải pickleball
  (bao gồm hoặc tương tự hệ thống như PickleTour).
- Hợp tác, tài trợ, thông báo chính thức trong hệ sinh thái pickleball.

LOẠI NGAY:
- Bài chỉ lướt qua "pickleball" nhưng không liên quan giải đấu / vận hành / công nghệ.
- Nội dung cá cược, betting, link lậu, vi phạm bản quyền.
- Bài không phải tiếng Việt, trừ khi cực kỳ liên quan và có giá trị rõ ràng cho người dùng Việt Nam (nhưng ưu tiên vẫn là tiếng Việt).

3) THỜI GIAN:
- Dùng "time_range_hours" từ payload để ưu tiên bài trong 24 giờ gần nhất.
- Có thể MỞ RỘNG tối đa ~72 giờ nếu là bài THỰC SỰ quan trọng.
- Hạn chế tối đa việc chọn bài quá cũ.

4) ĐIỂM SỐ (score: 0.0–1.0):
- 0.90–1.00: Rất phù hợp (VN + pickleball/giải đấu) → ưu tiên.
- 0.75–0.89: Phù hợp → nên giữ.
- 0.50–0.74: Giáp ranh → chỉ giữ nếu rõ ràng liên quan VN và thiếu bài tốt hơn.
- < 0.50: KHÔNG đưa vào.
- Nếu nhiều link cùng câu chuyện → chỉ chọn bản tốt nhất.

5) NGÔN NGỮ:
- ƯU TIÊN bài viết TIẾNG VIỆT.
- Trường "language" trong output phải phản ánh đúng ("vi", "en", ...).
- Nếu bài không phải tiếng Việt và không phục vụ rõ ràng người dùng Việt Nam → KHÔNG đưa vào.

6) ĐẦU RA:
CHỈ trả JSON đúng mẫu:
{
  "items": [
    {
      "url": "string",
      "title": "string",
      "sourceName": "string",
      "publishedAt": "string | null",
      "score": number,
      "reason": "string",
      "language": "string",
      "tags": ["string", ...]
    }
  ]
}
- Không được thêm bất kỳ text nào ngoài JSON.
- Nếu không có bài phù hợp → trả { "items": [] }.
`;

// JSON schema cho Gemini structured output
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING },
          title: { type: Type.STRING },
          sourceName: { type: Type.STRING },
          publishedAt: { type: Type.STRING },
          score: { type: Type.NUMBER },
          reason: { type: Type.STRING },
          language: { type: Type.STRING },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["url", "title", "score"],
      },
    },
  },
  required: ["items"],
};

function buildUserPayload(settings) {
  return {
    mo_ta:
      "Chọn các bài báo tiếng Việt, nguồn uy tín, về pickleball & hệ sinh thái giải đấu liên quan Việt Nam, phục vụ người dùng PickleTour.",
    main_keywords:
      settings.mainKeywords && settings.mainKeywords.length
        ? settings.mainKeywords
        : [
            "pickleball Việt Nam",
            "giải pickleball",
            "giải đấu pickleball",
            "PickleTour",
          ],
    extra_keywords: settings.extraKeywords || [],
    time_range_hours: 24,
    max_results: settings.maxArticlesPerRun || 20,
    allowed_domains: settings.allowedDomains || [],
    blocked_domains: settings.blockedDomains || [],
  };
}

// Heuristic tiếng Việt
function isLikelyVietnamese(str = "") {
  const s = (str || "").toLowerCase();
  if (
    /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/.test(
      s
    )
  )
    return true;
  if (
    /việt nam|viet nam|hà nội|ha noi|tp\.hcm|tphcm|hồ chí minh|ho chi minh|đà nẵng|da nang/.test(
      s
    )
  )
    return true;
  return false;
}

// Domain filter: ưu tiên VN, trừ khi admin cấu hình allowed_domains
function isAllowedDomain(url, settings) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    if (settings.blockedDomains?.some((d) => host.endsWith(d.toLowerCase()))) {
      return false;
    }

    if (settings.allowedDomains?.length) {
      return settings.allowedDomains.some((d) =>
        host.endsWith(d.toLowerCase())
      );
    }

    // mặc định: domain Việt Nam + một số báo lớn
    if (host.endsWith(".vn")) return true;

    if (
      /vnexpress\.net$|tuoitre\.vn$|thanhnien\.vn$|thanhnien\.com\.vn$|vietnamnet\.vn$|zingnews\.vn$|nld\.com\.vn$|laodong\.vn$|dantri\.com\.vn$|vtv\.vn$/i.test(
        host
      )
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// Thời gian: nếu có publishedAt thì check trong maxHours; nếu không có thì cho qua
function isFreshEnough(publishedAt, maxHours) {
  if (!publishedAt) return true;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return true;
  const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  return diffHours >= 0 && diffHours <= maxHours;
}

// Helper: bóc JSON từ Gemini (@google/genai)
function extractJsonFromResponse(response) {
  if (!response) return null;

  const getJsonString = (raw) => {
    if (!raw || typeof raw !== "string") return null;
    const text = raw.trim();

    // Bắt JSON trong code block ```json ... ```
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      return fenceMatch[1].trim();
    }

    // Nếu không có code block → cắt từ { ... } ngoài cùng
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1).trim();
    }

    return null;
  };

  const tryParseJson = (s) => {
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  // 1) Ưu tiên response.text
  if (typeof response.text === "string" && response.text.trim()) {
    const jsonStr = getJsonString(response.text);
    const parsed = tryParseJson(jsonStr);
    if (parsed) return parsed;
  }

  // 2) Fallback: candidates[0].content.parts[0].text
  const candidates = response.candidates || response.response?.candidates;
  if (Array.isArray(candidates) && candidates.length) {
    const parts = candidates[0]?.content?.parts;
    if (Array.isArray(parts) && parts.length) {
      const first = parts[0];
      const raw =
        typeof first === "string"
          ? first
          : typeof first.text === "string"
          ? first.text
          : null;

      const jsonStr = getJsonString(raw);
      const parsed = tryParseJson(jsonStr);
      if (parsed) return parsed;
    }
  }

  return null;
}

export async function discoverFeaturedArticlesV2() {
  const settings =
    (await NewsSettings.findOne({ key: "default" })) ||
    (await NewsSettings.create({}));

  if (!settings.enabled) {
    console.log("[NewsDiscovery] Disabled in settings.");
    return { inserted: 0, total: 0 };
  }

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.error(
      "[NewsDiscovery] Thiếu GEMINI_API_KEY / GOOGLE_API_KEY. Bỏ qua discovery."
    );
    return { inserted: 0, total: 0 };
  }

  const payload = buildUserPayload(settings);
  const MAX_HOURS = 72;
  const minScore = settings.minAiScore ?? 0.75;

  // 🔄 GỌI GEMINI – KHÔNG DÙNG responseMimeType / responseSchema NỮA
  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash",
    // gửi payload cho nó hiểu mình muốn tìm gì
    contents: JSON.stringify(payload),
    config: {
      // prompt hệ thống (rule lọc domain/việt nam/... vẫn dùng như cũ)
      systemInstruction: SYSTEM_PROMPT_VI,
      // bật Google Search tool
      tools: [
        {
          googleSearch: {},
        },
      ],
      // tắt chain-of-thought để rẻ/nhanh
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0.7,
      // KHÔNG có responseMimeType, KHÔNG có responseSchema ở đây nữa
    },
  });

  const data = extractJsonFromResponse(response);

  if (!data || !Array.isArray(data.items)) {
    console.error(
      "[NewsDiscovery] Không đọc được JSON hợp lệ từ Gemini.",
      JSON.stringify(
        {
          text: response?.text,
          hasCandidates: !!response?.candidates?.length,
        },
        null,
        2
      )
    );
    return { inserted: 0, total: 0 };
  }

  const items = data.items;
  let inserted = 0;
  let considered = 0;

  for (const it of items) {
    if (!it?.url || !it?.title) continue;
    considered++;

    // 1) domain hợp lệ
    if (!isAllowedDomain(it.url, settings)) continue;

    // 2) tiếng Việt
    const lang = (it.language || "").toLowerCase();
    const isVNLang =
      lang === "vi" ||
      isLikelyVietnamese(it.title) ||
      isLikelyVietnamese(it.reason || "");
    if (!isVNLang) continue;

    // 3) mới (nếu có ngày)
    if (!isFreshEnough(it.publishedAt, MAX_HOURS)) continue;

    // 4) score đủ
    if (typeof it.score !== "number") continue;
    if (it.score < minScore) continue;

    try {
      const now = new Date();
      const publishedDate = it.publishedAt ? new Date(it.publishedAt) : null;

      await NewsLinkCandidate.updateOne(
        { url: it.url },
        {
          $setOnInsert: {
            url: it.url,
            createdAt: now,
          },
          $set: {
            title: it.title,
            sourceName: it.sourceName || "",
            publishedAt: publishedDate,
            score: it.score,
            reason: it.reason || "",
            language: "vi",
            tags: Array.isArray(it.tags) ? it.tags : [],
            updatedAt: now,
            status: "pending",
          },
        },
        { upsert: true }
      );

      inserted++;
    } catch (err) {
      console.warn(
        "[NewsDiscovery] Upsert candidate error:",
        it.url,
        err.message
      );
    }
  }

  console.log(
    `[NewsDiscovery][gemini-2.5-flash+googleSearch][VN only] model_items=${items.length}, passed_filter=${considered}, inserted=${inserted}`
  );

  return {
    inserted,
    total: items.length,
  };
}
