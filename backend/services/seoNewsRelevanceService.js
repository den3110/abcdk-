const RELEVANCE_MIN_SCORE =
  Number(process.env.SEO_NEWS_RELEVANCE_MIN_SCORE) || 0.58;

const PRIMARY_TERMS = [
  "pickleball",
  "pickletour",
  "paddle",
  "dink",
  "serve",
  "third shot",
  "bracket",
  "single",
  "double",
  "dupr",
  "ppr",
  "giai dau",
  "tran dau",
  "san pickleball",
  "vot pickleball",
  "clb pickleball",
  "club pickleball",
  "xep hang pickleball",
  "ranking pickleball",
  "luat pickleball",
  "chien thuat pickleball",
];

const NEGATIVE_TERMS = [
  "xe khach",
  "xe buyt",
  "oto",
  "o to",
  "bo chay",
  "chay no",
  "hoa hoan",
  "tai nan",
  "thoi su",
  "hinh su",
  "gia vang",
  "chung khoan",
  "bong da",
  "kinh doanh",
  "showbiz",
  "thoi tiet",
];

const DEFAULT_COMPETITOR_DOMAINS = [
  "alobo.vn",
  "www.alobo.vn",
  "vpickleball.com",
  "www.vpickleball.com",
  "pickleballvietnam.vn",
  "www.pickleballvietnam.vn",
  "picklematch.vn",
  "www.picklematch.vn",
];

const DEFAULT_COMPETITOR_TERMS = [
  "alobo",
  "vpickleball",
  "pickleball vietnam",
  "picklematch",
  "phan mem dat lich san pickleball",
  "nen tang dat san pickleball",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*/, "");
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function countPhrase(text, phrase) {
  if (!text || !phrase) return 0;

  let count = 0;
  let offset = 0;
  while (offset >= 0) {
    const idx = text.indexOf(phrase, offset);
    if (idx === -1) break;
    count += 1;
    offset = idx + phrase.length;
  }

  return count;
}

function countMatches(text, terms) {
  const normalized = normalizeText(text);
  if (!normalized) return { total: 0, matchedTerms: [] };

  let total = 0;
  const matchedTerms = [];

  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) continue;

    const c = countPhrase(normalized, normalizedTerm);
    if (c > 0) {
      total += c;
      matchedTerms.push(normalizedTerm);
    }
  }

  return { total, matchedTerms };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function checkSeoNewsCompetitorPolicy({
  title,
  summary,
  contentText,
  tags,
  sourceName,
  sourceUrl,
  settings,
} = {}) {
  const competitorDomains = [
    ...new Set(
      [...DEFAULT_COMPETITOR_DOMAINS, ...toArray(settings?.competitorDomains)]
        .map(normalizeDomain)
        .filter(Boolean)
    ),
  ];

  const competitorTerms = [
    ...new Set(
      [...DEFAULT_COMPETITOR_TERMS, ...toArray(settings?.competitorKeywords)]
        .map(normalizeText)
        .filter(Boolean)
    ),
  ];

  const host = (() => {
    try {
      return normalizeDomain(new URL(String(sourceUrl || "")).hostname || "");
    } catch {
      return normalizeDomain(sourceUrl);
    }
  })();

  const matchedDomains = [
    ...new Set(
      competitorDomains.filter((d) => host && (host === d || host.endsWith(`.${d}`)))
    ),
  ];

  const joined = [title, summary, contentText, sourceName, ...(Array.isArray(tags) ? tags : [])]
    .map((x) => String(x || ""))
    .join(" ");
  const normalizedJoined = normalizeText(joined);

  const matchedTerms = [
    ...new Set(
      competitorTerms.filter((term) => normalizedJoined.includes(term))
    ),
  ];

  const isCompetitor = matchedDomains.length > 0 || matchedTerms.length > 0;

  const reasons = [];
  if (matchedDomains.length) {
    reasons.push(`Blocked competitor domain: ${matchedDomains.join(", ")}`);
  }
  if (matchedTerms.length) {
    reasons.push(`Blocked competitor keyword: ${matchedTerms.join(", ")}`);
  }

  return {
    isCompetitor,
    matchedDomains,
    matchedTerms,
    reasons,
  };
}

export function evaluateSeoNewsRelevance({
  title,
  summary,
  contentText,
  tags,
  sourceName,
  sourceUrl,
  settings,
} = {}) {
  const titleText = normalizeText(title);
  const summaryText = normalizeText(summary);
  const bodyText = normalizeText(contentText);
  const tagsText = normalizeText(Array.isArray(tags) ? tags.join(" ") : "");

  const titleMatch = countMatches(titleText, PRIMARY_TERMS);
  const summaryMatch = countMatches(summaryText, PRIMARY_TERMS);
  const bodyMatch = countMatches(bodyText, PRIMARY_TERMS);
  const tagMatch = countMatches(tagsText, PRIMARY_TERMS);

  const negativeMatch = countMatches(
    `${summaryText} ${bodyText}`,
    NEGATIVE_TERMS
  );

  const competitor = checkSeoNewsCompetitorPolicy({
    title,
    summary,
    contentText,
    tags,
    sourceName,
    sourceUrl,
    settings,
  });

  const hasPrimarySignal =
    titleMatch.total > 0 ||
    summaryMatch.total > 0 ||
    bodyMatch.total > 0 ||
    tagMatch.total > 0;

  const hasBodySignal = bodyMatch.total > 0 || summaryMatch.total > 0;

  const bodyWords = bodyText ? bodyText.split(" ").filter(Boolean).length : 0;
  const density =
    bodyWords > 0
      ? (bodyMatch.total + summaryMatch.total) / Math.max(1, bodyWords / 120)
      : 0;

  let score = 0;

  if (titleMatch.total > 0) score += 0.28;
  if (summaryMatch.total > 0) score += 0.16;
  if (bodyMatch.total > 0) score += 0.24;
  if (tagMatch.total > 0) score += 0.12;

  score += Math.min(0.18, density * 0.08);

  if (titleText.includes("pickletour") || bodyText.includes("pickletour")) {
    score += 0.08;
  }

  if (!hasBodySignal) score -= 0.5;
  if (negativeMatch.total > 0 && bodyMatch.total < 2) {
    score -= Math.min(0.28, negativeMatch.total * 0.14);
  }

  if (competitor.isCompetitor) {
    score -= 0.75;
  }

  score = clamp01(score);

  const reasons = [];
  if (!hasPrimarySignal) {
    reasons.push("No pickleball/PickleTour signal found");
  }
  if (!hasBodySignal) {
    reasons.push("Title mentions topic but body does not support it");
  }
  if (negativeMatch.total > 0 && bodyMatch.total < 2) {
    reasons.push("Body appears off-topic vs sports pickleball context");
  }
  if (competitor.isCompetitor) {
    reasons.push(...competitor.reasons);
  }

  const isRelevant =
    !competitor.isCompetitor &&
    hasPrimarySignal &&
    hasBodySignal &&
    score >= RELEVANCE_MIN_SCORE;

  return {
    isRelevant,
    score,
    reasons,
    competitor,
    details: {
      titleMatches: titleMatch.total,
      summaryMatches: summaryMatch.total,
      bodyMatches: bodyMatch.total,
      tagMatches: tagMatch.total,
      negativeMatches: negativeMatch.total,
      matchedTerms: [
        ...new Set([
          ...titleMatch.matchedTerms,
          ...summaryMatch.matchedTerms,
          ...bodyMatch.matchedTerms,
          ...tagMatch.matchedTerms,
        ]),
      ],
    },
  };
}

export const SEO_NEWS_RELEVANCE_MIN_SCORE = RELEVANCE_MIN_SCORE;
export { DEFAULT_COMPETITOR_DOMAINS, DEFAULT_COMPETITOR_TERMS };