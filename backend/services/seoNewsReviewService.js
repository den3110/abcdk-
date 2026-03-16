import { openai, OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";

const REVIEW_MODEL =
  process.env.SEO_NEWS_REVIEW_MODEL ||
  OPENAI_DEFAULT_MODEL ||
  "gpt-5-codex-mini";

const PASS_SCORE = Number(process.env.SEO_NEWS_REVIEW_PASS_SCORE) || 0.78;

const REVIEW_PROMPT = `
Ban la he thong kiem duyet chat luong bai viet SEO pickleball.

Muc tieu:
- Cham bai theo thang diem 0.0 -> 1.0.
- Danh gia factuality, readability, SEO, policy safety, copyright risk.
- Neu co dau hieu sao chep qua dai tu nguon ben ngoai hoac noi dung nhay cam, danh co critical flag.

Tra ve dung JSON:
{
  "score": number,
  "status": "pass" | "fail",
  "reasons": ["string"],
  "criticalFlags": ["string"]
}

Quy tac:
- status pass chi khi score >= ${PASS_SCORE} va khong co criticalFlags.
- reasons ngan gon, toi da 6 y.
- Tuyet doi khong tra ve text ngoai JSON.
`;

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 100) / 100;
}

function safeArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 10);
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

function fallbackReview({ title, summary, contentHtml, origin, sourceUrl }) {
  const reasons = [];
  const criticalFlags = [];

  const titleLen = String(title || "").trim().length;
  const summaryLen = String(summary || "").trim().length;
  const contentLen = String(contentHtml || "").trim().length;

  let score = 0.45;

  if (titleLen >= 20) score += 0.14;
  else reasons.push("Tieu de qua ngan");

  if (summaryLen >= 80) score += 0.14;
  else reasons.push("Summary chua du noi dung");

  if (contentLen >= 260) score += 0.14;
  else reasons.push("Noi dung qua ngan");

  if (origin === "external" && sourceUrl) score += 0.12;
  if (origin === "generated") score += 0.05;

  const lowerText = `${title || ""} ${summary || ""} ${contentHtml || ""}`.toLowerCase();
  const blocked = ["casino", "bet", "ca cuoc", "adult", "porn"];
  for (const token of blocked) {
    if (lowerText.includes(token)) {
      criticalFlags.push(`blocked_keyword:${token}`);
    }
  }

  if (criticalFlags.length) {
    score = Math.min(score, 0.2);
    reasons.push("Noi dung co dau hieu vi pham policy");
  }

  score = clampScore(score);
  const status =
    score >= PASS_SCORE && criticalFlags.length === 0 ? "pass" : "fail";

  if (!reasons.length) {
    reasons.push(
      status === "pass"
        ? "Noi dung dat nguong chat luong"
        : "Noi dung chua dat nguong chat luong"
    );
  }

  return {
    status,
    score,
    reasons,
    criticalFlags,
    checkedAt: new Date(),
    checkerModel: "rule-fallback",
  };
}

export async function reviewSeoNewsArticle(input) {
  const {
    title = "",
    summary = "",
    contentHtml = "",
    sourceName = "",
    sourceUrl = "",
    origin = "external",
    tags = [],
  } = input || {};

  const payload = {
    origin,
    title,
    summary,
    sourceName,
    sourceUrl,
    tags: Array.isArray(tags) ? tags.slice(0, 8) : [],
    contentHtmlSnippet: String(contentHtml || "").slice(0, 8000),
  };

  try {
    const response = await openai.responses.create({
      model: REVIEW_MODEL,
      instructions: REVIEW_PROMPT,
      input: [{ role: "user", content: JSON.stringify(payload) }],
      text: {
        format: {
          type: "json_schema",
          name: "seo_news_review",
          strict: false,
          schema: {
            type: "object",
            properties: {
              score: { type: "number" },
              status: { type: "string", enum: ["pass", "fail"] },
              reasons: { type: "array", items: { type: "string" } },
              criticalFlags: { type: "array", items: { type: "string" } },
            },
            required: ["score"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = extractJsonFromResponse(response) || {};
    const score = clampScore(parsed.score);
    const reasons = safeArray(parsed.reasons);
    const criticalFlags = safeArray(parsed.criticalFlags);
    const hasCriticalFlags = criticalFlags.length > 0;
    const status =
      score >= PASS_SCORE && !hasCriticalFlags && parsed.status !== "fail"
        ? "pass"
        : "fail";

    return {
      status,
      score,
      reasons: reasons.length
        ? reasons
        : [status === "pass" ? "Dat nguong" : "Khong dat nguong"],
      criticalFlags,
      checkedAt: new Date(),
      checkerModel: REVIEW_MODEL,
    };
  } catch (err) {
    console.warn("[SeoNewsReview] AI review failed, fallback to rules:", err?.message || err);
    return fallbackReview({ title, summary, contentHtml, origin, sourceUrl });
  }
}

export {
  PASS_SCORE as SEO_NEWS_REVIEW_PASS_SCORE,
  REVIEW_MODEL as SEO_NEWS_REVIEW_MODEL,
};
