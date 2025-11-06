// src/services/articleDiscoveryService.js (một phần)


// src/services/articleDiscoveryService.js
import NewsSettings from "../models/newsSettingsModel.js";
import NewsLinkCandidate from "../models/newsLinkCandicateModel.js";
import { openai } from "../lib/openaiClient.js";

const SYSTEM_PROMPT_VI = `
Bạn là hệ thống "PickleTour News Link Selector", chạy trong backend.

NHIỆM VỤ:
- Trả về một danh sách NHỎ các URL bài báo THẬT, MỚI, CHẤT LƯỢNG CAO,
  liên quan đến pickleball và có giá trị với người dùng nền tảng PickleTour.

YÊU CẦU:

1) NGUỒN TIN:
- Ưu tiên: báo thể thao, báo lớn, trang pickleball uy tín, trang công nghệ uy tín.
- Nếu có "allowed_domains": CHỈ chọn URL thuộc các domain này.
- Nếu có "blocked_domains": LOẠI ngay URL thuộc các domain đó.
- KHÔNG:
  - Bịa domain, bịa URL.
  - Dùng trang kết quả tìm kiếm, trang danh mục, tag page, trang chủ.
  - Chọn site spam, nội dung rác, farm nội dung.

2) NỘI DUNG:
Chỉ giữ link nếu bài viết RÕ RÀNG thuộc ít nhất một nhóm:
- Giải đấu pickleball (quy mô khu vực, quốc gia, quốc tế, giải đáng chú ý).
- Quản lý & vận hành giải: lịch, bracket, xếp hạng, đăng ký, tổ chức.
- Livestream, broadcast, sản xuất hình ảnh giải pickleball.
- Nền tảng/công nghệ/phần mềm phục vụ giải pickleball
  (bao gồm hoặc tương tự hệ thống như PickleTour).
- Hợp tác, tài trợ, thông báo chính thức trong hệ sinh thái pickleball.

LOẠI:
- Bài chỉ nhắc sơ "pickleball" nhưng nội dung chính không liên quan giải đấu / vận hành / công nghệ.
- Nội dung cá cược, betting, link lậu, trái phép.

3) THỜI GIAN:
- Dùng "time_range_hours" từ payload để ưu tiên bài mới.
- Nếu thiếu bài, có thể mở rộng tối đa thêm 72 giờ, nhưng chỉ với bài thật sự có giá trị.

4) ĐIỂM SỐ:
- Cho mỗi bài một "score" từ 0.0 đến 1.0:
  - 0.90–1.00: Rất phù hợp, tin lớn, đề xuất mạnh.
  - 0.70–0.89: Phù hợp, nên giữ.
  - 0.50–0.69: Giáp ranh, chỉ giữ nếu thiếu bài.
  - <0.50: KHÔNG đưa vào.
- Tránh trùng: nếu nhiều link cùng câu chuyện, chọn bản tốt nhất.

5) ĐẦU RA:
- CHỈ trả JSON đúng mẫu:
{
  "items": [
    {
      "url": "string",
      "title": "string",
      "sourceName": "string",
      "publishedAt": "string | null",
      "score": number,
      "reason": "string",
      "tags": ["string", ...]
    }
  ]
}
- Không được thêm text ngoài JSON.
- Nếu không có bài phù hợp: trả { "items": [] }.
`;

function buildUserPayload(settings) {
  return {
    mo_ta:
      "Hãy chọn các bài báo theo đúng quy tắc trong system prompt, dành cho người dùng Việt Nam quan tâm pickleball & PickleTour.",
    main_keywords: settings.mainKeywords || ["PickleTour", "pickleball"],
    extra_keywords: settings.extraKeywords || [],
    time_range_hours: 24,
    max_results: settings.maxArticlesPerRun || 20,
    allowed_domains: settings.allowedDomains || [],
    blocked_domains: settings.blockedDomains || [],
  };
}

function isAllowedDomain(url, settings) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      settings.blockedDomains?.some((d) => host.endsWith(d.toLowerCase()))
    )
      return false;
    if (settings.allowedDomains?.length) {
      return settings.allowedDomains.some((d) =>
        host.endsWith(d.toLowerCase())
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function discoverFeaturedArticles() {
  const settings =
    (await NewsSettings.findOne({ key: "default" })) ||
    (await NewsSettings.create({}));

  if (!settings.enabled) return;

  const completion = await openai.chat.completions.create({
    model: "gpt-5",
    tools: [{ type: "web_search" }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "featured_news_links",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  sourceName: { type: "string" },
                  publishedAt: { type: "string" },
                  score: { type: "number" },
                  reason: { type: "string" },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["url", "title", "score"],
              },
            },
          },
          required: ["items"],
        },
        strict: true,
      },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT_VI },
      {
        role: "user",
        content: JSON.stringify(buildUserPayload(settings)),
      },
    ],
  });

  const data = JSON.parse(completion.choices[0].message.content || "{}");
  const items = data.items || [];

  let inserted = 0;
  for (const it of items) {
    if (typeof it.score !== "number") continue;
    if (it.score < settings.minAiScore) continue;
    if (!isAllowedDomain(it.url, settings)) continue;

    try {
      await NewsLinkCandidate.updateOne(
        { url: it.url },
        {
          $setOnInsert: { url: it.url },
          $set: {
            title: it.title,
            sourceName: it.sourceName,
            publishedAt: it.publishedAt ? new Date(it.publishedAt) : null,
            score: it.score,
            reason: it.reason,
            tags: it.tags || [],
          },
        },
        { upsert: true }
      );
      inserted++;
    } catch {
      // trùng URL -> bỏ qua
    }
  }

  console.log(`[NewsDiscovery] Thêm mới ${inserted} link ứng viên.`);
}
