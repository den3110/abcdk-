import SeoNewsSettings from "../models/seoNewsSettingsModel.js";
import SeoNewsLinkCandidate from "../models/seoNewsLinkCandidateModel.js";
import { gemini } from "../lib/geminiClient.js";
import { openai, OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";
import { checkSeoNewsCompetitorPolicy } from "./seoNewsRelevanceService.js";

const OPENAI_DISCOVERY_MODEL =
  process.env.SEO_NEWS_DISCOVERY_MODEL ||
  OPENAI_DEFAULT_MODEL ||
  "gpt-5-codex-mini";

const DISCOVERY_SYSTEM_PROMPT = `
Bạn là hệ thống chọn link tin tức pickleball cho SEO.

Mục tiêu:
- Tìm các bài viết mới, liên quan pickleball, tổ chức giải đấu, website cộng đồng.
- Ưu tiên nguồn uy tín và nội dung hữu ích cho người dùng Việt Nam.
- Không lấy trang danh mục, trang tìm kiếm, trang home, trang spam.

Yêu cầu ngôn ngữ:
- Nếu bài gốc là tiếng Việt, giữ nguyên tiêu đề tiếng Việt có dấu.
- Không tự chuyển tiêu đề tiếng Việt thành dạng không dấu.

Trả về JSON:
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
      "tags": ["string"]
    }
  ]
}

Yêu cầu:
- score 0.0 -> 1.0.
- chỉ giữ các bài có liên quan thật sự.
- không trả text ngoài JSON.
`;

function buildUserPayload(settings) {
  const maxPerRun = Math.max(1, Number(settings?.maxArticlesPerRun) || 8);
  const discoveryMaxResults = Math.min(100, Math.max(20, maxPerRun * 3));

  return {
    brief:
      "Tìm tin pickleball mới và bài liên quan tổ chức giải đấu, vận hành website, SEO, cộng đồng.",
    mainKeywords:
      settings.mainKeywords && settings.mainKeywords.length
        ? settings.mainKeywords
        : ["pickleball", "pickletour", "giải pickleball"],
    extraKeywords: settings.extraKeywords || [],
    timeRangeHours: 36,
    maxResults: discoveryMaxResults,
    allowedDomains: settings.allowedDomains || [],
    blockedDomains: settings.blockedDomains || [],
  };
}

function isLikelyVietnamese(str = "") {
  const s = String(str || "").toLowerCase();
  if (!s) return false;

  if (/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(s)) {
    return true;
  }

  return /viet\s*nam|vietnam|ha\s*noi|ho\s*chi\s*minh|tp\.?\s*hcm|da\s*nang/.test(s);
}

function hasStrongTopicHint(item) {
  const text = [item?.title, item?.reason, ...(Array.isArray(item?.tags) ? item.tags : [])]
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase();

  return /pickleball|pickletour|paddle|dink|giai\s*dau\s*pickleball|clb\s*pickleball/.test(
    text
  );
}

function isAllowedDomain(url, settings) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    if (Array.isArray(settings.blockedDomains)) {
      const blocked = settings.blockedDomains
        .map((d) => String(d || "").toLowerCase().trim())
        .filter(Boolean);
      if (blocked.some((d) => host.endsWith(d))) {
        return false;
      }
    }

    if (Array.isArray(settings.allowedDomains) && settings.allowedDomains.length) {
      const allowed = settings.allowedDomains
        .map((d) => String(d || "").toLowerCase().trim())
        .filter(Boolean);
      return allowed.some((d) => host.endsWith(d));
    }

    if (host.endsWith(".vn")) return true;

    return /usapickleball\.org$|pickleball\.com$|pb\.global$/i.test(host);
  } catch {
    return false;
  }
}

function isFreshEnough(publishedAt, maxHours) {
  if (!publishedAt) return true;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return true;
  const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  return diffHours >= 0 && diffHours <= maxHours;
}

function extractJsonFromOpenAIResponse(response) {
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

function extractJsonFromText(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1] ? fence[1].trim() : text;

  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return null;
  }
}

function extractJsonFromGeminiResponse(response) {
  if (typeof response?.text === "string") {
    const parsed = extractJsonFromText(response.text);
    if (parsed) return parsed;
  }

  const candidates = response?.candidates || response?.response?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts) || !parts.length) return null;

  for (const part of parts) {
    const raw =
      typeof part === "string"
        ? part
        : typeof part?.text === "string"
        ? part.text
        : "";
    const parsed = extractJsonFromText(raw);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;

  const url = String(raw.url || "").trim();
  const title = String(raw.title || "").trim();
  if (!url || !title) return null;

  let score = Number(raw.score);
  if (!Number.isFinite(score)) score = 0;
  if (score < 0) score = 0;
  if (score > 1) score = 1;

  return {
    url,
    title,
    sourceName: String(raw.sourceName || "").trim(),
    publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : null,
    score,
    reason: String(raw.reason || "").trim(),
    language: String(raw.language || "").trim().toLowerCase(),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

async function discoverWithGemini(payload) {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return { provider: "gemini", items: [], error: "missing_gemini_key" };
  }

  try {
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: JSON.stringify(payload),
      config: {
        systemInstruction: DISCOVERY_SYSTEM_PROMPT,
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.4,
      },
    });

    const parsed = extractJsonFromGeminiResponse(response);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return { provider: "gemini", items };
  } catch (error) {
    return {
      provider: "gemini",
      items: [],
      error: error?.message || "gemini_discovery_error",
    };
  }
}

async function discoverWithOpenAI(payload) {
  if (!process.env.OPENAI_API_KEY && !process.env.CLIPROXY_API_KEY) {
    return { provider: "openai", items: [], error: "missing_openai_key" };
  }

  try {
    const response = await openai.responses.create({
      model: OPENAI_DISCOVERY_MODEL,
      instructions: DISCOVERY_SYSTEM_PROMPT,
      input: [{ role: "user", content: JSON.stringify(payload) }],
      tools: [{ type: "web_search" }],
      text: {
        format: {
          type: "json_schema",
          name: "seo_news_candidates",
          strict: false,
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
                    language: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                  },
                  required: ["url", "title", "score"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = extractJsonFromOpenAIResponse(response);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return { provider: "openai", items };
  } catch (error) {
    return {
      provider: "openai",
      items: [],
      error: error?.message || "openai_discovery_error",
    };
  }
}

export async function discoverSeoNewsCandidates({ settings, provider } = {}) {
  const newsSettings =
    settings ||
    (await SeoNewsSettings.findOne({ key: "default" })) ||
    (await SeoNewsSettings.create({ key: "default" }));

  const payload = buildUserPayload(newsSettings);
  const minScore = Number(newsSettings.minAiScore) || 0.75;
  const maxHours = 72;

  const selected = provider || newsSettings.discoveryProvider || "auto";

  let discoveryResult;
  if (selected === "gemini") {
    discoveryResult = await discoverWithGemini(payload);
  } else if (selected === "openai") {
    discoveryResult = await discoverWithOpenAI(payload);
  } else {
    discoveryResult = await discoverWithGemini(payload);
    if (!discoveryResult.items.length) {
      const fallback = await discoverWithOpenAI(payload);
      if (fallback.items.length) {
        discoveryResult = fallback;
      } else if (discoveryResult.error && !fallback.error) {
        discoveryResult = fallback;
      }
    }
  }

  const rawItems = Array.isArray(discoveryResult?.items) ? discoveryResult.items : [];

  let considered = 0;
  let inserted = 0;
  let updated = 0;
  let blockedCompetitor = 0;

  for (const raw of rawItems) {
    const item = normalizeItem(raw);
    if (!item) continue;

    considered += 1;

    if (!isAllowedDomain(item.url, newsSettings)) continue;

    const isVN =
      item.language === "vi" ||
      isLikelyVietnamese(item.title) ||
      isLikelyVietnamese(item.reason);
    if (!isVN) continue;

    if (!hasStrongTopicHint(item)) continue;

    if (!isFreshEnough(item.publishedAt, maxHours)) continue;
    if (item.score < minScore) continue;

    const competitor = checkSeoNewsCompetitorPolicy({
      title: item.title,
      summary: item.reason,
      contentText: item.reason,
      tags: item.tags,
      sourceName: item.sourceName,
      sourceUrl: item.url,
      settings: newsSettings,
    });
    if (competitor.isCompetitor) {
      blockedCompetitor += 1;
      continue;
    }

    try {
      const result = await SeoNewsLinkCandidate.updateOne(
        { url: item.url },
        {
          $setOnInsert: {
            url: item.url,
          },
          $set: {
            title: item.title,
            sourceName: item.sourceName,
            publishedAt: item.publishedAt,
            score: item.score,
            reason: item.reason,
            language: item.language || "vi",
            tags: item.tags,
            status: "pending",
            lastError: null,
            lastErrorCode: null,
          },
        },
        { upsert: true }
      );

      inserted += Number(result?.upsertedCount || 0);
      updated += Number(result?.modifiedCount || 0);
    } catch (err) {
      console.warn("[SeoNewsDiscovery] candidate upsert failed:", item.url, err?.message || err);
    }
  }

  return {
    provider: discoveryResult?.provider || selected,
    total: rawItems.length,
    considered,
    inserted,
    updated,
    blockedCompetitor,
    error: discoveryResult?.error || null,
  };
}


