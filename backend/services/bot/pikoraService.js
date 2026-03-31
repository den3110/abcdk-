import fetch from "node-fetch";
import OpenAI from "openai";
import { TOOL_EXECUTORS } from "./tools/index.js";
import { getRecentMessages } from "./memoryService.js";
import { maybeLearn } from "./learningService.js";
import { resolvePikoraRolloutDecision } from "./pikoraRolloutService.js";
import {
  buildToolPreview as sharedBuildToolPreview,
  compactList as sharedCompactList,
  extractEntityName as sharedExtractEntityName,
  extractPairNames as sharedExtractPairNames,
  fetchUserProfile as sharedFetchUserProfile,
  normalizeText as sharedNormalizeText,
  TOOL_LABELS as SHARED_TOOL_LABELS,
} from "./runtimeShared.js";

const CHAT_MODEL = String(
  process.env.PIKORA_MODEL || process.env.BOT_MODEL || "deepseek-chat",
).trim();
const REASONER_MODEL = String(
  process.env.PIKORA_REASONER_MODEL ||
    process.env.BOT_REASONER_MODEL ||
    "deepseek-reasoner",
).trim();
const PROXY_BASE_URL = String(
  process.env.PIKORA_BASE_URL || process.env.CLIPROXY_BASE_URL || "",
).replace(/\/+$/, "");
const PROXY_API_KEY = String(
  process.env.PIKORA_API_KEY ||
    process.env.CLIPROXY_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "",
).trim();
const CHAT_COMPLETIONS_URL = PROXY_BASE_URL
  ? `${PROXY_BASE_URL}/chat/completions`
  : "";
const PROXY_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(
    120_000,
    Number(
      process.env.PIKORA_PROXY_TIMEOUT_MS ||
        process.env.BOT_PROXY_TIMEOUT_MS ||
        45_000,
    ),
  ),
);
const LIVE_RETRIEVAL_MODEL = String(
  process.env.PIKORA_LIVE_RETRIEVAL_MODEL ||
    process.env.OPENAI_DEFAULT_MODEL ||
    "gpt-5-nano",
).trim();
const LIVE_RETRIEVAL_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(
    90_000,
    Number(process.env.PIKORA_LIVE_RETRIEVAL_TIMEOUT_MS || 25_000),
  ),
);
const LIVE_RETRIEVAL_MAX_RESULTS = Math.max(
  1,
  Math.min(4, Number(process.env.PIKORA_LIVE_RETRIEVAL_MAX_RESULTS || 3)),
);
const LIVE_RETRIEVAL_CLIENT = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: LIVE_RETRIEVAL_TIMEOUT_MS,
    })
  : null;
const MEMORY_LIMIT = Math.max(
  0,
  Math.min(6, Number(process.env.BOT_MEMORY_LIMIT || 4)),
);
const MAX_TOOL_BATCH = 3;
const MAX_TOOL_CONTEXT_CHARS = 7000;
const MAX_ACTIONS = 4;
const MAX_SOURCES = 6;
const MAX_ANSWER_CARDS = 3;
const ROUTE_CACHE_TTL_MS = Math.max(
  10_000,
  Number(process.env.BOT_ROUTE_CACHE_TTL_MS || 30_000),
);
const TOOL_CACHE_TTL_MS = Math.max(
  10_000,
  Number(process.env.BOT_TOOL_CACHE_TTL_MS || 30_000),
);
const KNOWLEDGE_CACHE_TTL_MS = Math.max(
  30_000,
  Number(process.env.BOT_KNOWLEDGE_CACHE_TTL_MS || 300_000),
);
const FIRST_TOURNAMENT_ID = "__FIRST_TOURNAMENT_ID__";
const FIRST_CLUB_ID = "__FIRST_CLUB_ID__";
const ROUTE_CACHE_VERSION = "2026-03-31-tournament-status-v3";
const routeDecisionCache = new Map();
const toolExecutionCache = new Map();

export const BOT_IDENTITY = {
  name: "Pikora",
  nameVi: "Pikora - Trá»£ lÃ½ PickleTour",
  version: "7.0",
  engine: "deepseek-proxy-orchestrator-v7",
  personality: ["Nhanh", "ThÃ¢n thiá»‡n", "ChÃ­nh xÃ¡c", "Ngáº¯n gá»n"],
};

const EXTRA_NAVIGATION_SCREENS = {
  tournament_manage: {
    screen: "TournamentManage",
    deepLink: "pickletour://tournament/{tournamentId}/manage",
    webPath: "/tournament/{tournamentId}/manage",
    description: "Quáº£n lÃ½ giáº£i Ä‘áº¥u",
  },
  tournament_checkin: {
    screen: "TournamentCheckin",
    deepLink: "pickletour://tournament/{tournamentId}/checkin",
    webPath: "/tournament/{tournamentId}/checkin",
    description: "Check-in giáº£i Ä‘áº¥u",
  },
  admin_users: {
    screen: "AdminUsers",
    deepLink: "pickletour://admin/users",
    webPath: "/admin/users",
    description: "Quáº£n lÃ½ ngÆ°á»i dÃ¹ng",
  },
  admin_news: {
    screen: "AdminNews",
    deepLink: "pickletour://admin/news",
    webPath: "/admin/news",
    description: "Quáº£n lÃ½ tin tá»©c",
  },
  admin_avatar_optimization: {
    screen: "AdminAvatarOptimization",
    deepLink: "pickletour://admin/avatar-optimization",
    webPath: "/admin/avatar-optimization",
    description: "Tá»‘i Æ°u avatar",
  },
};

function getChatCapabilitiesLegacy() {
  const retrievalMode = "internal";
  let explanation = "";
  if (retrievalMode === "hybrid_live") {
    explanation = `${explanation} Có bổ sung kiểm chứng live retrieval theo rollout V7.`;
  }

  return {
    backend: "deepseek-proxy-chat-completions",
    provider: PROXY_BASE_URL ? "CLIProxyAPI" : "OpenAI",
    baseURL: PROXY_BASE_URL || "",
    models: sharedCompactList([CHAT_MODEL, REASONER_MODEL]),
    defaultModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    streaming: true,
    reasoning: true,
    actions: true,
    pageStateContext: true,
    personalization: true,
    hybridRetrieval: {
      supported: Boolean(LIVE_RETRIEVAL_CLIENT),
      defaultMode: "internal",
      liveModel: LIVE_RETRIEVAL_MODEL,
    },
    rolloutManaged: true,
  };
}

export function getChatCapabilities() {
  return normalizeUserFacingData({
    backend: "deepseek-proxy-chat-completions",
    provider: PROXY_BASE_URL ? "CLIProxyAPI" : "OpenAI",
    baseURL: PROXY_BASE_URL || "",
    models: sharedCompactList([CHAT_MODEL, REASONER_MODEL]),
    defaultModel: CHAT_MODEL,
    reasonerModel: REASONER_MODEL,
    streaming: true,
    reasoning: true,
    actions: true,
    pageStateContext: true,
    personalization: true,
    hybridRetrieval: {
      supported: Boolean(LIVE_RETRIEVAL_CLIENT),
      defaultMode: "internal",
      liveModel: LIVE_RETRIEVAL_MODEL,
    },
    rolloutManaged: true,
  });
}

function resolveRetrievalMode(context = {}, hybridRetrieval = null) {
  if (
    hybridRetrieval?.retrievalMode === "hybrid_live" &&
    Array.isArray(hybridRetrieval?.items) &&
    hybridRetrieval.items.length > 0
  ) {
    return "hybrid_live";
  }

  return "internal";
}

function normalizeKnowledgeMode(value) {
  const next = String(value || "").trim().toLowerCase();
  if (next === "internal") return "internal";
  if (next === "hybrid_live") return "hybrid_live";
  return "auto";
}

function collectUserRoles(user) {
  const roles = new Set();
  if (user?.role) roles.add(String(user.role).trim().toLowerCase());
  if (Array.isArray(user?.roles)) {
    user.roles.forEach((item) => {
      const role = String(item || "").trim().toLowerCase();
      if (role) roles.add(role);
    });
  }
  if (user?.isAdmin) roles.add("admin");
  if (user?.isSuperAdmin || user?.isSuperUser) roles.add("super_admin");
  return [...roles];
}

function trimText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function decodePossibleMojibake(value) {
  if (typeof value !== "string" || !value) return value;

  let next = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!/[ÃÂÄÆá»â€]/.test(next)) break;
    try {
      const decoded = Buffer.from(next, "latin1").toString("utf8");
      if (!decoded || decoded === next) break;
      next = decoded;
    } catch {
      break;
    }
  }

  return next;
}

function normalizeUserFacingData(value) {
  if (typeof value === "string") {
    return decodePossibleMojibake(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUserFacingData(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeUserFacingData(item)]),
    );
  }
  return value;
}

function dedupeByKey(list, getKey) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCacheEntry(cache, key, value, ttlMs) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  if (cache.size > 200) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  return value;
}

function getPageContextSignature(context = {}) {
  return JSON.stringify({
    tournamentId: context?.tournamentId || "",
    matchId: context?.matchId || "",
    bracketId: context?.bracketId || "",
    courtId: context?.courtId || "",
    clubId: context?.clubId || "",
    newsSlug: context?.newsSlug || "",
    profileUserId: context?.profileUserId || "",
    pageType: context?.pageType || "",
    pageSection: context?.pageSection || "",
    pageView: context?.pageView || "",
    capabilityKeys: context?.capabilityKeys || [],
    snapshot: context?.pageSnapshot || null,
  });
}

function getRouteCacheKey(message, context = {}, userId) {
  return JSON.stringify({
    version: ROUTE_CACHE_VERSION,
    message: sharedNormalizeText(message),
    pageType: context?.pageType || "",
    pageSection: context?.pageSection || "",
    pageView: context?.pageView || "",
    pageSnapshot: context?.pageSnapshot || null,
    userScope: userId ? "auth" : "guest",
    capabilityKeys: context?.capabilityKeys || [],
    tournamentId: context?.tournamentId || "",
    clubId: context?.clubId || "",
    newsSlug: context?.newsSlug || "",
    matchId: context?.matchId || "",
  });
}

function getToolCacheTtlMs(route) {
  return route?.kind === "knowledge" ? KNOWLEDGE_CACHE_TTL_MS : TOOL_CACHE_TTL_MS;
}

function getToolCacheKey(route, context = {}) {
  const toolPlan = Array.isArray(route?.toolPlan)
    ? route.toolPlan.map((step) => ({
        name: step?.name || "",
        args: step?.args || {},
        captureNavigation: Boolean(step?.captureNavigation),
      }))
    : [];
  return JSON.stringify({
    kind: route?.kind || "",
    toolPlan,
    page: getPageContextSignature(context),
  });
}

function inferIntent(message, route, context = {}, execution = {}) {
  const normalized = sharedNormalizeText(message);
  if (route?.kind === "direct") {
    if (hasAny(normalized, ["xin chao", "hello", "hi", "hey"])) {
      return "greeting";
    }
    return "direct_help";
  }
  if (route?.kind === "knowledge") return "knowledge_lookup";
  if (route?.kind === "personal") return "personal_lookup";
  if (route?.kind === "navigate") return "navigation";
  if (route?.kind === "club") return "club_lookup";
  if (route?.kind === "news") return "news_lookup";
  if (route?.kind === "live") return "live_lookup";
  if (route?.kind === "tournament") return "tournament_lookup";
  if (route?.kind === "player") return "player_lookup";
  if (route?.kind === "general") return "general_chat";
  if (execution?.toolSummary?.length > 1) return "multi_step_lookup";
  if (
    hasAny(normalized, ["vi sao", "tai sao", "phan tich", "so sanh", "ke hoach", "toi uu"])
  ) {
    return "analysis";
  }
  return route?.kind || "general";
}

function resolveRouteLane(message, route, context = {}, execution = {}) {
  const normalized = sharedNormalizeText(message);
  const toolsUsed = Array.isArray(execution?.toolsUsed) ? execution.toolsUsed : [];
  const actions = Array.isArray(execution?.actions) ? execution.actions : [];

  if (route?.kind === "tournament") {
    if (looksLikeTournamentAvailabilityQuestion(message, normalized)) {
      return "tournament_status";
    }
    if (
      hasAny(normalized, [
        "con bao nhieu tran",
        "bao nhieu tran",
        "tien do",
        "progress",
        "da xong bao nhieu",
        "con lai bao nhieu",
      ]) ||
      toolsUsed.some((tool) =>
        [
          "get_tournament_progress",
          "get_tournament_schedule",
          "get_tournament_match_tree",
        ].includes(tool),
      )
    ) {
      return "tournament_progress";
    }
    if (
      hasAny(normalized, [
        "mo ",
        "vao ",
        "manage",
        "quan ly",
        "dang ky",
        "lich thi dau",
        "bracket",
        "so do",
        "draw",
        "boc tham",
      ]) ||
      (context?.tournamentId &&
        actions.some((action) =>
          ["set_page_state", "prefill_text", "focus_element"].includes(
            action?.type,
          ),
        ))
    ) {
      return "tournament_navigation";
    }
    return "tournament_status";
  }

  if (route?.kind === "news") return "news_summary";
  if (route?.kind === "club") return "club_updates";
  if (route?.kind === "live") return "live_status";
  if (route?.kind === "personal" || route?.kind === "player") {
    return "profile_personal";
  }
  if (route?.kind === "navigate") return "safe_operator";
  if (
    route?.kind === "knowledge" ||
    route?.kind === "general" ||
    route?.kind === "direct"
  ) {
    return "knowledge_help";
  }
  return "safe_operator";
}

function resolveGroundingStatus({
  grounded = false,
  needsDisclaimer = false,
  toolCount = 0,
  cardCount = 0,
}) {
  if (grounded) return "grounded";
  if (needsDisclaimer || toolCount > 0 || cardCount > 0) return "partial";
  return "unsupported";
}

function resolveOperatorStatus(actions = []) {
  const list = Array.isArray(actions) ? actions : [];
  if (
    list.some((action) =>
      [
        "set_page_state",
        "set_query_param",
        "open_dialog",
        "focus_element",
        "scroll_to_section",
        "prefill_text",
      ].includes(action?.type),
    )
  ) {
    return "page_action";
  }
  if (
    list.some((action) =>
      [
        "navigate",
        "open_new_tab",
        "copy_link",
        "copy_current_url",
        "copy_text",
      ].includes(action?.type),
    )
  ) {
    return "navigate_fallback";
  }
  return "unsupported";
}

function buildCapabilityKeys(route, context = {}, result = {}) {
  const keys = compactList([
    ...(Array.isArray(context?.capabilityKeys) ? context.capabilityKeys : []),
    "streaming",
    "reasoner",
    "safe_operator",
    context?.pageSnapshot ? "page_snapshot" : "",
    result?.answerCards?.length ? "answer_cards" : "",
    result?.sources?.length ? "source_grounding" : "",
    Array.isArray(result?.actions) && result.actions.some((item) => item?.type === "navigate")
      ? "navigate"
      : "",
    Array.isArray(result?.actions) && result.actions.some((item) => item?.type === "open_new_tab")
      ? "open_new_tab"
      : "",
    Array.isArray(result?.actions) &&
    result.actions.some((item) =>
      ["copy_link", "copy_current_url", "copy_text"].includes(item?.type),
    )
      ? "copy"
      : "",
    Array.isArray(result?.actions) &&
    result.actions.some((item) =>
      ["set_query_param", "set_page_state", "prefill_text"].includes(item?.type),
    )
      ? "page_operator"
      : "",
    result?.trustMeta?.grounded ? "source_grounding_strong" : "",
    result?.trustMeta?.needsDisclaimer ? "grounding_limited" : "",
    result?.trustMeta?.groundingStatus === "grounded" ? "grounded" : "",
    result?.trustMeta?.groundingStatus === "partial" ? "grounding_partial" : "",
    result?.trustMeta?.operatorStatus === "page_action" ? "page_action" : "",
    result?.trustMeta?.operatorStatus === "navigate_fallback"
      ? "navigate_fallback"
      : "",
    route?.kind || "",
  ]).filter(Boolean);

  return keys;
}

function buildActionExecutionSummary(actions = []) {
  const safeActions = Array.isArray(actions) ? actions : [];
  return {
    safeOnly: true,
    availableCount: safeActions.length,
    confirmRequiredCount: safeActions.filter((item) => item?.requiresConfirm).length,
    actionTypes: compactList(safeActions.map((item) => item?.type).filter(Boolean)),
    executed: [],
    unsupported: [],
    degraded: [],
  };
}

function compactText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}â€¦` : text;
}

function compactTexts(values, limit = 8, maxLength = 96) {
  return sharedCompactList(
    (Array.isArray(values) ? values : [])
      .map((item) => compactText(item, maxLength))
      .filter(Boolean),
  ).slice(0, limit);
}

function getPageSnapshotSignals(context = {}) {
  const snapshot = context?.pageSnapshot;
  if (!snapshot) return [];
  return compactTexts(
    [
      snapshot.pageType,
      snapshot.entityTitle,
      snapshot.sectionTitle,
      ...(snapshot.activeLabels || []),
      ...(snapshot.visibleActions || []),
      ...(snapshot.highlights || []),
      ...(snapshot.metrics || []),
    ],
    16,
    80,
  );
}

function inferPersonalization(memory, userProfile, context) {
  const joinedMemory = sharedNormalizeText(
    (memory || []).map((item) => item?.content || "").join(" "),
  );
  const interests = [];
  if (hasAny(joinedMemory, ["giai", "tournament", "schedule", "bracket"])) {
    interests.push("giáº£i Ä‘áº¥u");
  }
  if (hasAny(joinedMemory, ["news", "tin tuc", "chien thuat", "luat"])) {
    interests.push("ná»™i dung kiáº¿n thá»©c");
  }
  if (hasAny(joinedMemory, ["club", "clb", "cau lac bo"])) {
    interests.push("cÃ¢u láº¡c bá»™");
  }
  if (hasAny(joinedMemory, ["rating", "xep hang", "vdv", "nguoi choi"])) {
    interests.push("phÃ¢n tÃ­ch VÄV");
  }
  if (context?.pageType?.startsWith("tournament_")) {
    interests.push("Ä‘iá»u hÆ°á»›ng theo giáº£i hiá»‡n táº¡i");
  }

  const likelyRole = userProfile?.role || (context?.adminSection ? "admin" : "member");
  const preferredAnswerDensity = hasAny(joinedMemory, [
    "mo",
    "navigate",
    "tab",
    "loc",
    "filter",
    "tim",
  ])
    ? "compact_operator"
    : "balanced";
  const preferredPages = compactTexts(
    [context?.pageType, context?.pageSection, context?.pageSnapshot?.sectionTitle],
    4,
    48,
  );

  return {
    province: userProfile?.province || "",
    rating: userProfile?.rating || null,
    interests: compactTexts(interests, 4, 40),
    likelyRole,
    preferredAnswerDensity,
    preferredPages,
  };
}

function buildPageSnapshotSummary(context = {}) {
  const snapshot = context?.pageSnapshot;
  if (!snapshot) return "";
  const parts = [];
  if (snapshot.entityTitle) parts.push(`TiÃªu Ä‘á» chÃ­nh: ${snapshot.entityTitle}.`);
  if (snapshot.sectionTitle) parts.push(`Má»¥c Ä‘ang má»Ÿ: ${snapshot.sectionTitle}.`);
  if (snapshot.pageSummary) parts.push(`MÃ´ táº£ ngáº¯n: ${snapshot.pageSummary}`);
  if (snapshot.activeLabels?.length) {
    parts.push(`Tab hoáº·c tráº¡ng thÃ¡i ná»•i báº­t: ${snapshot.activeLabels.join(", ")}.`);
  }
  if (snapshot.visibleActions?.length) {
    parts.push(`CÃ¡c thao tÃ¡c Ä‘ang tháº¥y trÃªn mÃ n: ${snapshot.visibleActions.join(", ")}.`);
  }
  if (snapshot.highlights?.length) {
    parts.push(`Dáº¥u hiá»‡u ná»•i báº­t trÃªn trang: ${snapshot.highlights.join(", ")}.`);
  }
  if (snapshot.metrics?.length) {
    parts.push(`Chá»‰ sá»‘ Ä‘ang hiá»ƒn thá»‹: ${snapshot.metrics.join(", ")}.`);
  }
  return parts.join("\n");
}

function buildPersonalizationSummary(personalization) {
  if (!personalization) return "";
  const parts = [];
  if (personalization.province) {
    parts.push(`Khu vá»±c ngÆ°á»i dÃ¹ng quan tÃ¢m nhiá»u: ${personalization.province}.`);
  }
  if (personalization.rating) {
    parts.push(`Rating Ä‘Ã´i hiá»‡n táº¡i cá»§a ngÆ°á»i dÃ¹ng khoáº£ng ${personalization.rating}.`);
  }
  if (personalization.interests?.length) {
    parts.push(`CÃ¡c nhÃ³m chá»§ Ä‘á» ngÆ°á»i dÃ¹ng hay há»i: ${personalization.interests.join(", ")}.`);
  }
  return parts.join("\n");
}

function buildTrustMeta({
  route,
  execution = {},
  sources = [],
  answerCards = [],
  actions = [],
  reasoningAvailable = false,
  guardApplied = false,
  retrievalMode = "internal",
}) {
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const cardCount = Array.isArray(answerCards) ? answerCards.length : 0;
  const actionCount = Array.isArray(actions) ? actions.length : 0;
  const toolCount = Array.isArray(execution?.toolsUsed)
    ? execution.toolsUsed.length
    : 0;
  const grounded = sourceCount > 0;
  const reasoned = Boolean(reasoningAvailable);
  const actionable = actionCount > 0;
  const needsDisclaimer = needsTrustDisclaimer(
    route,
    execution,
    sources,
    answerCards,
  );
  const groundingStatus = resolveGroundingStatus({
    grounded,
    needsDisclaimer,
    toolCount,
    cardCount,
  });
  const operatorStatus = resolveOperatorStatus(actions);

  let confidenceLevel = "fast";
  let confidenceLabel = "Pháº£n há»“i nhanh";
  let explanation =
    "CÃ¢u tráº£ lá»i nÃ y thiÃªn vá» Ä‘iá»u hÆ°á»›ng hoáº·c gá»£i Ã½ thao tÃ¡c nhanh.";

  if (grounded) {
    confidenceLevel = toolCount > 1 ? "strong" : "grounded";
    confidenceLabel =
      toolCount > 1 ? "ÄÃ£ Ä‘á»‘i chiáº¿u nguá»“n tháº­t" : "CÃ³ nguá»“n dá»¯ liá»‡u tháº­t";
    explanation =
      sourceCount > 1
        ? `MÃ¬nh Ä‘ang bÃ¡m ${sourceCount} nguá»“n dá»¯ liá»‡u tháº­t tá»« há»‡ thá»‘ng hoáº·c ná»™i dung Ä‘Ã£ tra cá»©u.`
        : "MÃ¬nh Ä‘ang bÃ¡m má»™t nguá»“n dá»¯ liá»‡u tháº­t tá»« há»‡ thá»‘ng hoáº·c ná»™i dung Ä‘Ã£ tra cá»©u.";
  } else if (needsDisclaimer) {
    confidenceLevel = "limited";
    confidenceLabel = "Cáº§n kiá»ƒm tra thÃªm";
    explanation =
      "CÃ¢u tráº£ lá»i nÃ y cÃ³ dÃ¹ng tool nhÆ°ng chÆ°a Ä‘á»§ nguá»“n grounded Ä‘á»ƒ kháº³ng Ä‘á»‹nh máº¡nh nhÆ° fact.";
  } else if (toolCount > 0 || cardCount > 0) {
    confidenceLevel = "assisted";
    confidenceLabel = "CÃ³ dá»¯ liá»‡u há»— trá»£";
    explanation =
      "CÃ¢u tráº£ lá»i nÃ y cÃ³ tham chiáº¿u dá»¯ liá»‡u há»— trá»£, nhÆ°ng chÆ°a Ä‘á»§ máº¡nh Ä‘á»ƒ xem nhÆ° Ä‘á»‘i chiáº¿u nguá»“n Ä‘áº§y Ä‘á»§.";
  }

  if (reasoned && grounded) {
    explanation = `${explanation} Pikora cÃ³ dÃ¹ng suy luáº­n Ä‘á»ƒ tá»•ng há»£p cÃ¡c nguá»“n nÃ y.`;
  } else if (reasoned) {
    explanation = `${explanation} Pikora cÅ©ng Ä‘Ã£ dÃ¹ng suy luáº­n Ä‘á»ƒ ná»‘i cÃ¡c tÃ­n hiá»‡u liÃªn quan.`;
  }

  return {
    grounded,
    reasoned,
    actionable,
    sourceCount,
    cardCount,
    actionCount,
    needsDisclaimer,
    groundingStatus,
    operatorStatus,
    retrievalMode,
    guardApplied: Boolean(guardApplied),
    confidenceLevel,
    confidenceLabel,
    explanation,
  };
}

function buildContextInsight(context, route, personalization, execution) {
  const parts = [];
  if (context?.pageType) {
    parts.push(`MÃ¬nh Ä‘ang bÃ¡m theo ngá»¯ cáº£nh ${context.pageType.replaceAll("_", " ")}.`);
  }
  if (context?.pageSnapshot?.sectionTitle) {
    parts.push(`Pháº§n Ä‘ang má»Ÿ lÃ  "${context.pageSnapshot.sectionTitle}".`);
  } else if (context?.pageSnapshot?.activeLabels?.length) {
    parts.push(`MÃ n hiá»‡n táº¡i Ä‘ang ná»•i báº­t: ${context.pageSnapshot.activeLabels.slice(0, 2).join(", ")}.`);
  }
  if (execution?.toolSummary?.length > 0) {
    parts.push(`MÃ¬nh Ä‘Ã£ dÃ¹ng ${execution.toolSummary.length} bÆ°á»›c tra cá»©u Ä‘á»ƒ tráº£ lá»i chÃ­nh xÃ¡c hÆ¡n.`);
  }
  if (personalization?.province) {
    parts.push(`MÃ¬nh cÅ©ng Æ°u tiÃªn ngá»¯ cáº£nh theo khu vá»±c ${personalization.province}.`);
  }
  if (personalization?.interests?.length) {
    parts.push(`MÃ¬nh Ä‘ang Æ°u tiÃªn cÃ¡c chá»§ Ä‘á» báº¡n hay há»i nhÆ° ${personalization.interests.join(", ")}.`);
  }
  if (!parts.length && route?.kind) {
    parts.push(`MÃ¬nh Ä‘ang xá»­ lÃ½ theo loáº¡i yÃªu cáº§u: ${route.kind}.`);
  }
  return parts.join(" ");
}

function createAction(type, payload = {}) {
  return {
    type,
    payload: payload.payload || {},
    label: payload.label || "",
    description: payload.description || "",
    requiresConfirm: Boolean(payload.requiresConfirm),
    confirmTitle: payload.confirmTitle || "",
    confirmBody: payload.confirmBody || "",
    successMessage: payload.successMessage || "",
    ...payload,
  };
}

export async function runAgent(message, context = {}, userId = null, options = {}) {
  return runPikora(message, context, userId, null, options);
}

export async function runAgentStream(
  message,
  context = {},
  userId = null,
  emit,
  options = {},
) {
  return runPikora(message, context, userId, emit, options);
}

async function runPikora(message, context, userId, emit, options = {}) {
  const startTime = Date.now();
  const safeEmit = createSafeEmitter(emit);
  const routeThinking = (step) =>
    safeEmit("thinking", { step: normalizeUserFacingData(step) });
  const state = createStreamState();
  const initialInsight = buildContextInsight(context, null, null, null);

  routeThinking("Äang hiá»ƒu yÃªu cáº§u...");
  if (context?.pageSnapshot || context?.pageType) {
    routeThinking("Äang Ä‘á»c ngá»¯ cáº£nh trang hiá»‡n táº¡i...");
  }
  const routeCacheKey = getRouteCacheKey(message, context, userId);
  const route =
    getCacheEntry(routeDecisionCache, routeCacheKey) ||
    setCacheEntry(
      routeDecisionCache,
      routeCacheKey,
      classifyRoute(message, context, userId),
      ROUTE_CACHE_TTL_MS,
    );
  const rolloutDecision = await resolvePikoraRolloutDecision({
    surface: context?.surface || "web",
    userId,
    roles: collectUserRoles(context?.currentUser),
    cohortId: context?.cohortId || "",
  });

  if (route.directResponse) {
    return finalizeDirectResponse({
      safeEmit,
      route,
      context,
      contextInsight: initialInsight,
      startTime,
    });
  }

  routeThinking("Äang táº£i ngá»¯ cáº£nh há»™i thoáº¡i...");
  const memoryPromise = userId
    ? getRecentMessages(userId, MEMORY_LIMIT)
    : Promise.resolve([]);
  const userProfilePromise = userId
    ? sharedFetchUserProfile(userId)
    : Promise.resolve(null);

  const toolCacheKey = getToolCacheKey(route, context);
  const cachedExecution = getCacheEntry(toolExecutionCache, toolCacheKey);
  const execution = cachedExecution
    ? {
        ...cachedExecution,
        toolSummary: (cachedExecution.toolSummary || []).map((item) => ({
          ...item,
          cached: true,
        })),
      }
    : await executeToolPlan({
        route,
        context,
        safeEmit,
      });
  if (!cachedExecution && execution.toolsUsed?.length) {
    setCacheEntry(
      toolExecutionCache,
      toolCacheKey,
      execution,
      getToolCacheTtlMs(route),
    );
  }
  const routeLane = resolveRouteLane(message, route, context, execution);

  const groundedTournamentStatusResponse =
    buildGroundedTournamentStatusResponse(message, route, context, execution);
  if (groundedTournamentStatusResponse) {
    return finalizeGroundedToolResponse({
      safeEmit,
      message,
      route,
      context,
      execution,
      direct: groundedTournamentStatusResponse,
      contextInsight: buildContextInsight(context, route, null, execution),
      startTime,
    });
  }

  const [memory, userProfile] = await Promise.all([
    memoryPromise,
    userProfilePromise,
  ]);
  const personalization = inferPersonalization(memory, userProfile, context);
  const contextInsight = buildContextInsight(
    context,
    route,
    personalization,
    execution,
  );
  const hybridRetrieval = await maybeRunHybridLiveRetrieval({
    message,
    route,
    routeLane,
    context,
    execution,
    rolloutDecision,
    safeEmit,
  });
  if (hybridRetrieval?.attempted) {
    execution.hybridRetrieval = hybridRetrieval;
    execution.toolSummary = [
      ...(execution.toolSummary || []),
      {
        tool: "hybrid_live_retrieval",
        label: "Hybrid live retrieval",
        resultPreview:
          hybridRetrieval.items?.length > 0
            ? `${hybridRetrieval.items.length} nguồn live web`
            : hybridRetrieval.error || "KhÃ´ng cÃ³ nguồn live web phÃ¹ há»£p",
        durationMs: Number(hybridRetrieval.durationMs || 0),
        error: Boolean(hybridRetrieval.error),
      },
    ];
    execution.toolsUsed = [
      ...(execution.toolsUsed || []),
      "hybrid_live_retrieval",
    ];
  }
  const retrievalMode = resolveRetrievalMode(context, hybridRetrieval);

  const preferredModel =
    context?.reasoningMode === "force_reasoner" ||
    shouldUseReasoner(message, route, execution)
      ? REASONER_MODEL
      : CHAT_MODEL;
  const synthesisMessages = buildSynthesisMessages({
    message,
    route,
    context,
    memory,
    userProfile,
    personalization,
    execution,
  });

  routeThinking(
    preferredModel === REASONER_MODEL
      ? "Äang suy luáº­n Ä‘á»ƒ soáº¡n cÃ¢u tráº£ lá»i..."
      : "Äang soáº¡n cÃ¢u tráº£ lá»i...",
  );

  const modelsToTry =
    preferredModel === REASONER_MODEL
      ? [REASONER_MODEL, CHAT_MODEL]
      : [CHAT_MODEL];

  let result = null;
  let lastError = null;

  for (let index = 0; index < modelsToTry.length; index += 1) {
    const model = modelsToTry[index];
    try {
      result = await streamDeepSeekSynthesis({
        model,
        messages: synthesisMessages,
        safeEmit,
        startTime,
        signal: options.signal,
        state,
      });
      break;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      if (
        model === REASONER_MODEL &&
        index === 0 &&
        !error.partialOutput &&
        modelsToTry[index + 1]
      ) {
        routeThinking("Reasoner Ä‘ang cháº­m, chuyá»ƒn sang tráº£ lá»i nhanh...");
        continue;
      }
      throw error;
    }
  }

  if (!result) {
    throw lastError || new Error("KhÃ´ng nháº­n Ä‘Æ°á»£c pháº£n há»“i tá»« AI");
  }

  const processingTime = Date.now() - startTime;
  const sources = buildSourcesFromToolResults(
    execution.toolResults,
    context,
    hybridRetrieval,
  );
  const answerCards = buildAnswerCardsFromToolResults(
    execution.toolResults,
    context,
    hybridRetrieval,
  );
  const trustGuard = applyTrustGuard(
    result.reply ||
      "Xin lá»—i, mÃ¬nh chÆ°a tá»•ng há»£p Ä‘Æ°á»£c cÃ¢u tráº£ lá»i rÃµ rÃ ng. Báº¡n thá»­ há»i láº¡i ngáº¯n hÆ¡n nhÃ©.",
    route,
    execution,
    sources,
    answerCards,
  );
  const finalResult = {
    reply: trustGuard.reply,
    intent: inferIntent(message, route, context, execution),
    routeKind: route.kind || "direct",
    routeLane,
    toolsPlanned: Array.isArray(route.toolPlan)
      ? route.toolPlan.map((step) => step?.name).filter(Boolean)
      : [],
    toolsUsed: execution.toolsUsed,
    toolSummary: execution.toolSummary,
    navigation: execution.navigation || null,
    actions: buildSuggestedActions(route, context, execution),
    answerCards,
    sources,
    contextInsight,
    personalization,
    suggestions: generateSuggestions(
      route,
      context,
      execution,
      userId,
      personalization,
    ),
    surface: context?.surface || "web",
    model: result.model,
    mode: result.mode,
    rawThinking: result.rawThinking,
    reasoningAvailable: Boolean(result.rawThinking),
    firstTokenLatencyMs:
      result.firstTokenLatencyMs != null ? result.firstTokenLatencyMs : 0,
    processingTime,
    processingTimeMs: processingTime,
    capabilityKeys: [],
    actionExecutionSummary: null,
    trustMeta: null,
  };
  Object.assign(finalResult, normalizeUserFacingData(finalResult));
  finalResult.capabilityKeys = buildCapabilityKeys(route, context, finalResult);
  finalResult.actionExecutionSummary = buildActionExecutionSummary(
    finalResult.actions,
  );
  finalResult.trustMeta = buildTrustMeta({
    route,
    execution,
    sources: finalResult.sources,
    answerCards: finalResult.answerCards,
    actions: finalResult.actions,
    reasoningAvailable: finalResult.reasoningAvailable,
    guardApplied: trustGuard.guardApplied,
    retrievalMode,
  });
  finalResult.capabilityKeys = buildCapabilityKeys(route, context, finalResult);

  safeEmit("message_done", {
    text: finalResult.reply,
    intent: finalResult.intent,
    routeKind: finalResult.routeKind,
    routeLane: finalResult.routeLane,
    toolsUsed: finalResult.toolsUsed,
    model: finalResult.model,
    mode: finalResult.mode,
    reasoningAvailable: finalResult.reasoningAvailable,
    navigation: finalResult.navigation,
    actions: finalResult.actions,
    answerCards: finalResult.answerCards,
    sources: finalResult.sources,
    capabilityKeys: finalResult.capabilityKeys,
    actionExecutionSummary: finalResult.actionExecutionSummary,
    contextInsight: finalResult.contextInsight,
    personalization: finalResult.personalization,
    trustMeta: finalResult.trustMeta,
    surface: finalResult.surface,
    firstTokenLatencyMs: finalResult.firstTokenLatencyMs,
    processingTimeMs: finalResult.processingTimeMs,
    toolSummary: finalResult.toolSummary,
  });
  safeEmit("reply", {
    text: finalResult.reply,
    intent: finalResult.intent,
    routeKind: finalResult.routeKind,
    routeLane: finalResult.routeLane,
    toolsUsed: finalResult.toolsUsed,
    processingTime: finalResult.processingTime,
    processingTimeMs: finalResult.processingTimeMs,
    model: finalResult.model,
    mode: finalResult.mode,
    reasoningAvailable: finalResult.reasoningAvailable,
    navigation: finalResult.navigation,
    actions: finalResult.actions,
    answerCards: finalResult.answerCards,
    sources: finalResult.sources,
    capabilityKeys: finalResult.capabilityKeys,
    actionExecutionSummary: finalResult.actionExecutionSummary,
    contextInsight: finalResult.contextInsight,
    personalization: finalResult.personalization,
    trustMeta: finalResult.trustMeta,
    surface: finalResult.surface,
    toolSummary: finalResult.toolSummary,
  });

  if (finalResult.suggestions.length > 0) {
    safeEmit("suggestions", { suggestions: finalResult.suggestions });
  }

  safeEmit("done", {});

  maybeLearn(message, finalResult.reply, finalResult.toolsUsed).catch((error) =>
    console.error("[Pikora] Learning error:", error.message),
  );

  return finalResult;
}

function finalizeDirectResponse({ safeEmit, route, context, contextInsight, startTime }) {
  const processingTime = Date.now() - startTime;
  const result = {
    reply: route.directResponse.reply,
    intent: "direct_help",
    routeKind: route.kind || "direct",
    routeLane: resolveRouteLane("", route, context, {
      actions: route?.directResponse?.actions || [],
    }),
    toolsPlanned: [],
    toolsUsed: [],
    toolSummary: [],
    navigation: route.directResponse.navigation || null,
    actions:
      route.directResponse.actions ||
      buildSuggestedActions(route, context, {
        navigation: route.directResponse.navigation || null,
        toolResults: {},
        toolSummary: [],
      }),
    answerCards: [],
    sources: [],
    contextInsight: route.directResponse.contextInsight || contextInsight || "",
    personalization: null,
    suggestions: route.directResponse.suggestions || [],
    surface: context?.surface || "web",
    model: "local-direct",
    mode: "direct",
    rawThinking: "",
    reasoningAvailable: false,
    firstTokenLatencyMs: 0,
    processingTime,
    processingTimeMs: processingTime,
    capabilityKeys: [],
    actionExecutionSummary: null,
    trustMeta: null,
  };
  result.capabilityKeys = buildCapabilityKeys(route, context, result);
  result.actionExecutionSummary = buildActionExecutionSummary(result.actions);
  result.trustMeta = buildTrustMeta({
    route,
    execution: { toolsUsed: [], toolSummary: [] },
    sources: result.sources,
    answerCards: result.answerCards,
    actions: result.actions,
    reasoningAvailable: false,
    guardApplied: false,
  });
  Object.assign(result, normalizeUserFacingData(result));
  result.capabilityKeys = buildCapabilityKeys(route, context, result);

  safeEmit("message_start", {
    model: result.model,
    mode: result.mode,
  });
  if (result.reply) {
    safeEmit("message_delta", { delta: result.reply });
  }
  safeEmit("message_done", {
    text: result.reply,
    intent: result.intent,
    routeKind: result.routeKind,
    routeLane: result.routeLane,
    toolsUsed: [],
    model: result.model,
    mode: result.mode,
    reasoningAvailable: false,
    navigation: result.navigation,
    actions: result.actions,
    answerCards: result.answerCards,
    sources: result.sources,
    capabilityKeys: result.capabilityKeys,
    actionExecutionSummary: result.actionExecutionSummary,
    contextInsight: result.contextInsight,
    personalization: result.personalization,
    trustMeta: result.trustMeta,
    surface: result.surface,
    firstTokenLatencyMs: 0,
    processingTimeMs: result.processingTimeMs,
    toolSummary: [],
  });
  safeEmit("reply", {
    text: result.reply,
    intent: result.intent,
    routeKind: result.routeKind,
    routeLane: result.routeLane,
    toolsUsed: [],
    processingTime: result.processingTime,
    processingTimeMs: result.processingTimeMs,
    model: result.model,
    mode: result.mode,
    reasoningAvailable: false,
    navigation: result.navigation,
    actions: result.actions,
    answerCards: result.answerCards,
    sources: result.sources,
    capabilityKeys: result.capabilityKeys,
    actionExecutionSummary: result.actionExecutionSummary,
    contextInsight: result.contextInsight,
    personalization: result.personalization,
    trustMeta: result.trustMeta,
    surface: result.surface,
    toolSummary: [],
  });
  if (result.suggestions.length > 0) {
    safeEmit("suggestions", { suggestions: result.suggestions });
  }
  safeEmit("done", {});

  return result;
}

function buildGroundedTournamentStatusResponse(message, route, context, execution) {
  if (
    !Array.isArray(route?.toolPlan) ||
    route.toolPlan.length !== 1 ||
    route.toolPlan[0]?.name !== "search_tournaments"
  ) {
    return null;
  }

  const normalized = sharedNormalizeText(message);
  if (!looksLikeTournamentAvailabilityQuestion(message, normalized)) {
    return null;
  }

  if (
    hasAny(normalized, [
      "lich thi dau",
      "schedule",
      "luat",
      "rules",
      "dang ky",
      "bao nhieu doi",
      "nhanh dau",
      "bracket",
      "so do",
      "san",
      "court",
      "manager",
      "btc",
      "trong tai",
      "progress",
      "tien do",
      "boc tham",
      "draw",
    ])
  ) {
    return null;
  }

  const result = execution?.toolResults?.search_tournaments;
  if (!result || !Array.isArray(result.tournaments)) return null;

  const requestedStatus =
    pickTournamentStatusFromMessage(message, normalized) ||
    route?.toolPlan?.[0]?.args?.status ||
    "";
  const statusLabel = formatTournamentStatusLabel(requestedStatus);
  const tournaments = result.tournaments
    .map((item) => ({
      id: String(item?._id || ""),
      name: trimText(item?.name || "", 120),
      location: trimText(item?.location || "", 80),
      startDate: item?.startDate || "",
      endDate: item?.endDate || "",
    }))
    .filter((item) => item.name);
  const count = Number(result.count) || tournaments.length;
  const sampleNames = tournaments.slice(0, 3).map((item) => item.name);
  const firstTournament = tournaments[0] || null;
  const matchedBy = result.statusMatchedBy === "derived_dates";

  let reply = "";
  if (count > 0) {
    reply = `Hiá»‡n cÃ³ ${count} giáº£i ${statusLabel}.`;
    if (sampleNames.length) {
      reply += ` VÃ­ dá»¥: ${sampleNames.join(", ")}.`;
    }
    if (firstTournament?.location) {
      reply += ` Giáº£i gáº§n nháº¥t mÃ¬nh tháº¥y Ä‘ang á»Ÿ ${firstTournament.location}.`;
    }
    if (matchedBy) {
      reply += " MÃ¬nh xÃ¡c nháº­n theo thá»i gian diá»…n ra thá»±c táº¿ cá»§a giáº£i, khÃ´ng chá»‰ dá»±a vÃ o tráº¡ng thÃ¡i lÆ°u sáºµn.";
    }
  } else {
    reply = `Hiá»‡n táº¡i mÃ¬nh chÆ°a tháº¥y giáº£i ${statusLabel} trong dá»¯ liá»‡u há»‡ thá»‘ng.`;
    if (matchedBy) {
      reply += " MÃ¬nh Ä‘Ã£ kiá»ƒm tra thÃªm theo má»‘c thá»i gian thá»±c táº¿ cá»§a giáº£i nhÆ°ng váº«n chÆ°a tháº¥y káº¿t quáº£ phÃ¹ há»£p.";
    }
  }

  const suggestions = [
    requestedStatus === "ongoing" ? "Tiáº¿n Ä‘á»™ giáº£i nÃ y tháº¿ nÃ o?" : "Giáº£i nÃ o Ä‘ang diá»…n ra?",
    requestedStatus === "upcoming" ? "Má»Ÿ tab sáº¯p diá»…n ra" : "Giáº£i nÃ o sáº¯p diá»…n ra?",
    "Má»Ÿ danh sÃ¡ch giáº£i Ä‘áº¥u",
  ]
    .filter(Boolean)
    .slice(0, 3);

  return {
    reply,
    suggestions,
  };
}

function finalizeGroundedToolResponse({
  safeEmit,
  message,
  route,
  context,
  execution,
  direct,
  contextInsight,
  startTime,
}) {
  const processingTime = Date.now() - startTime;
  const sources = buildSourcesFromToolResults(execution.toolResults, context);
  const answerCards = buildAnswerCardsFromToolResults(execution.toolResults, context);
  const result = {
    reply: direct.reply,
    intent: inferIntent(message, route, context, execution),
    routeKind: route.kind || "lookup",
    routeLane: resolveRouteLane(message, route, context, execution),
    toolsPlanned: Array.isArray(route.toolPlan)
      ? route.toolPlan.map((step) => step?.name).filter(Boolean)
      : [],
    toolsUsed: execution.toolsUsed,
    toolSummary: execution.toolSummary,
    navigation: execution.navigation || null,
    actions: buildSuggestedActions(route, context, execution),
    answerCards,
    sources,
    contextInsight: direct.contextInsight || contextInsight || "",
    personalization: null,
    suggestions: direct.suggestions || [],
    surface: context?.surface || "web",
    model: "local-grounded",
    mode: "grounded_direct",
    rawThinking: "",
    reasoningAvailable: false,
    firstTokenLatencyMs: 0,
    processingTime,
    processingTimeMs: processingTime,
    capabilityKeys: [],
    actionExecutionSummary: null,
    trustMeta: null,
  };

  result.capabilityKeys = buildCapabilityKeys(route, context, result);
  result.actionExecutionSummary = buildActionExecutionSummary(result.actions);
  result.trustMeta = buildTrustMeta({
    route,
    execution,
    sources: result.sources,
    answerCards: result.answerCards,
    actions: result.actions,
    reasoningAvailable: false,
    guardApplied: false,
  });
  Object.assign(result, normalizeUserFacingData(result));

  safeEmit("message_start", {
    model: result.model,
    mode: result.mode,
  });
  if (result.reply) {
    safeEmit("message_delta", { delta: result.reply });
  }
  safeEmit("message_done", {
    text: result.reply,
    intent: result.intent,
    routeKind: result.routeKind,
    routeLane: result.routeLane,
    toolsUsed: result.toolsUsed,
    model: result.model,
    mode: result.mode,
    reasoningAvailable: false,
    navigation: result.navigation,
    actions: result.actions,
    answerCards: result.answerCards,
    sources: result.sources,
    capabilityKeys: result.capabilityKeys,
    actionExecutionSummary: result.actionExecutionSummary,
    contextInsight: result.contextInsight,
    personalization: result.personalization,
    trustMeta: result.trustMeta,
    surface: result.surface,
    firstTokenLatencyMs: 0,
    processingTimeMs: result.processingTimeMs,
    toolSummary: result.toolSummary,
  });
  safeEmit("reply", {
    text: result.reply,
    intent: result.intent,
    routeKind: result.routeKind,
    routeLane: result.routeLane,
    toolsUsed: result.toolsUsed,
    processingTime: result.processingTime,
    processingTimeMs: result.processingTimeMs,
    model: result.model,
    mode: result.mode,
    reasoningAvailable: false,
    navigation: result.navigation,
    actions: result.actions,
    answerCards: result.answerCards,
    sources: result.sources,
    capabilityKeys: result.capabilityKeys,
    actionExecutionSummary: result.actionExecutionSummary,
    contextInsight: result.contextInsight,
    personalization: result.personalization,
    trustMeta: result.trustMeta,
    surface: result.surface,
    toolSummary: result.toolSummary,
  });
  if (result.suggestions.length > 0) {
    safeEmit("suggestions", { suggestions: result.suggestions });
  }
  safeEmit("done", {});

  return result;
}

function createStreamState() {
  return {
    firstTokenLatencyMs: null,
    reasoningStarted: false,
    reasoningDone: false,
  };
}

function createSafeEmitter(emit) {
  return (event, payload) => {
    if (typeof emit !== "function") return;
    emit(event, payload);
  };
}

function removeDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normalizeText(value) {
  return removeDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(normalized, keywords = []) {
  const haystack = sharedNormalizeText(normalized);
  const paddedHaystack = ` ${haystack} `;
  return keywords.some((keyword) => {
    const needle = sharedNormalizeText(keyword);
    if (!needle) return false;
    if (needle.includes(" ")) {
      return haystack.includes(needle);
    }
    return paddedHaystack.includes(` ${needle} `);
  });
}

function hasRawPattern(message, pattern) {
  return pattern.test(String(message || ""));
}

function normalizeAsciiText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeGreetingMessage(message) {
  return hasRawPattern(
    message,
    /(^|\s)(xin chÃ o|xin chao|chÃ o pikora|chao pikora|hello|hi|hey)(\s|[!?.,]|$)/iu,
  );
}

function looksLikeThanksMessage(message) {
  return hasRawPattern(
    message,
    /(^|\s)(cáº£m Æ¡n|cam on|thanks|thank you)(\s|[!?.,]|$)/iu,
  );
}

function looksLikeNavigationRequest(message) {
  return hasRawPattern(
    message,
    /(^|\s)(má»Ÿ|mo|vÃ o|vao|Ä‘i tá»›i|di toi|Ä‘áº¿n|den|go to|open|truy cáº­p|truy cap|show page)(\s|[!?.,]|$)/iu,
  );
}

function looksLikeGenericKnowledgeQuestion(
  message,
  normalized = sharedNormalizeText(message),
) {
  if (!String(message || "").trim()) return false;
  if (looksLikeNavigationRequest(message)) return false;
  if (isCurrentContextReference(normalized)) return false;
  const asciiMessage = normalizeAsciiText(message);

  const referencesSpecificContext =
    [
      "giai nay",
      "trang nay",
      "muc nay",
      "tab nay",
      "view nay",
      "bai nay",
      "tin nay",
      "clb nay",
      "club nay",
      "news nay",
      "live nay",
      "tran nay",
      "san nay",
      "nhanh nay",
      "bang nay",
      "cua toi",
    ].some((token) => asciiMessage.includes(token)) ||
    /\b(toi|minh|my)\b/.test(asciiMessage);

  if (referencesSpecificContext) return false;

  return (
    asciiMessage.includes(" la gi") ||
    asciiMessage.startsWith("la gi ") ||
    asciiMessage.endsWith(" la gi") ||
    asciiMessage.includes(" la sao") ||
    asciiMessage.includes("what is") ||
    asciiMessage.includes("cach ") ||
    asciiMessage.startsWith("cach") ||
    asciiMessage.includes("how to") ||
    asciiMessage.includes("huong dan") ||
    asciiMessage.includes("luat") ||
    asciiMessage.includes("vi sao") ||
    asciiMessage.includes("tai sao") ||
    asciiMessage.includes("giai thich") ||
    asciiMessage.includes("faq")
  );
}

export function pickTournamentStatusFromMessage(
  message,
  normalized = sharedNormalizeText(message),
) {
  if (
    hasAny(normalized, ["sáº¯p tá»›i", "sáº¯p diá»…n ra", "upcoming", "má»Ÿ Ä‘Äƒng kÃ½"]) ||
    hasRawPattern(
      message,
      /(sáº¯p tá»›i|sáº¯p diá»…n ra|sap toi|sap dien ra|upcoming|má»Ÿ Ä‘Äƒng kÃ½|mo dang ky)/iu,
    )
  ) {
    return "upcoming";
  }
  if (
    hasAny(normalized, ["Ä‘ang diá»…n ra", "ongoing", "live"]) ||
    hasRawPattern(
      message,
      /(Ä‘ang diá»…n ra|dang dien ra|ongoing|\blive\b)/iu,
    )
  ) {
    return "ongoing";
  }
  if (
    hasAny(normalized, ["Ä‘Ã£ káº¿t thÃºc", "finished"]) ||
    hasRawPattern(message, /(Ä‘Ã£ káº¿t thÃºc|da ket thuc|finished)/iu)
  ) {
    return "finished";
  }
  return "";
}

export function looksLikeTournamentAvailabilityQuestion(
  message,
  normalized = sharedNormalizeText(message),
) {
  const mentionsTournament =
    hasAny(normalized, ["giai", "tournament"]) ||
    hasRawPattern(message, /(giáº£i|giai|tournament)/iu);
  if (!mentionsTournament) return false;

  const asksAvailability =
    hasAny(normalized, [
      "co giai nao",
      "giai nao",
      "bao nhieu giai",
      "co bao nhieu giai",
      "co khong",
    ]) ||
    hasRawPattern(
      message,
      /(cÃ³ giáº£i nÃ o|co giai nao|giáº£i nÃ o|giai nao|bao nhiÃªu giáº£i|bao nhieu giai)/iu,
    );

  return Boolean(pickTournamentStatusFromMessage(message, normalized)) || asksAvailability;
}

function isQuestionLike(normalized) {
  return hasAny(normalized, [
    "gÃ¬",
    "lÃ  gÃ¬",
    "khÃ´ng",
    "bao nhiÃªu",
    "tháº¿ nÃ o",
    "sao",
    "táº¡i sao",
    "vÃ¬ sao",
    "nÃ o",
  ]);
}

function compactList(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function pageTypeStartsWith(context, value) {
  return String(context?.pageType || "").startsWith(value);
}

function isCurrentContextReference(normalized) {
  return hasAny(normalized, [
    "trang nÃ y",
    "má»¥c nÃ y",
    "tab nÃ y",
    "view nÃ y",
    "mÃ n nÃ y",
    "á»Ÿ Ä‘Ã¢y",
    "hiá»‡n táº¡i",
    "bÃ i nÃ y",
    "tin nÃ y",
    "giáº£i nÃ y",
    "clb nÃ y",
    "tráº­n nÃ y",
    "sÃ¢n nÃ y",
    "nhÃ¡nh nÃ y",
    "báº£ng nÃ y",
    "club nÃ y",
    "news nÃ y",
    "live nÃ y",
  ]);
}

function allowsLooseContextBoost(context = {}) {
  if (
    context?.tournamentId ||
    context?.clubId ||
    context?.newsSlug ||
    context?.matchId ||
    context?.profileUserId
  ) {
    return true;
  }

  return [
    "tournament_registration",
    "tournament_checkin",
    "tournament_schedule",
    "tournament_bracket",
    "tournament_admin_draw",
    "tournament_draw_live",
    "tournament_draw_manage",
    "tournament_manage",
    "tournament_overview",
    "club_detail",
    "news_detail",
    "live_studio",
    "court_streaming",
    "court_live_studio",
    "profile",
    "public_profile",
    "my_tournaments",
  ].includes(String(context?.pageType || ""));
}

function addContextualKeywords(message, normalized, context) {
  if (looksLikeGenericKnowledgeQuestion(message, normalized)) {
    return normalized;
  }

  const shouldBoost =
    isCurrentContextReference(normalized) ||
    (String(normalized || "").split(/\s+/).filter(Boolean).length <= 6 &&
      allowsLooseContextBoost(context));
  if (!shouldBoost) return normalized;

  const hints = [];

  if (context?.tournamentId || pageTypeStartsWith(context, "tournament_")) {
    hints.push("giáº£i", "tournament");
    if (pageTypeStartsWith(context, "tournament_registration")) {
      hints.push("Ä‘Äƒng kÃ½");
    }
    if (pageTypeStartsWith(context, "tournament_schedule")) {
      hints.push("lá»‹ch thi Ä‘áº¥u", "schedule");
    }
    if (pageTypeStartsWith(context, "tournament_bracket")) {
      hints.push("nhÃ¡nh Ä‘áº¥u", "bracket");
    }
    if (
      pageTypeStartsWith(context, "tournament_draw_live") ||
      pageTypeStartsWith(context, "tournament_draw_manage") ||
      pageTypeStartsWith(context, "tournament_admin_draw")
    ) {
      hints.push("bá»‘c thÄƒm", "draw");
    }
    if (pageTypeStartsWith(context, "tournament_manage")) {
      hints.push("quáº£n lÃ½", "manage");
    }
    if (pageTypeStartsWith(context, "tournament_checkin")) {
      hints.push("checkin");
    }
  }

  if (pageTypeStartsWith(context, "club_") || context?.clubId) {
    hints.push("clb", "cÃ¢u láº¡c bá»™", "club");
    if (context?.clubTab === "events" || context?.pageSection === "events") {
      hints.push("sá»± kiá»‡n", "events");
    }
    if (context?.clubTab === "polls" || context?.pageSection === "polls") {
      hints.push("bÃ¬nh chá»n", "polls");
    }
    if (context?.clubTab === "news" || context?.pageSection === "news") {
      hints.push("tin tá»©c", "thÃ´ng bÃ¡o");
    }
  }

  if (pageTypeStartsWith(context, "news_") || context?.newsSlug) {
    hints.push("tin tá»©c", "news", "bÃ i viáº¿t");
  }

  if (
    pageTypeStartsWith(context, "live_") ||
    pageTypeStartsWith(context, "court_") ||
    context?.matchId ||
    context?.courtId
  ) {
    hints.push("live", "trá»±c tiáº¿p", "tráº­n", "sÃ¢n", "streaming");
  }

  if (pageTypeStartsWith(context, "admin_") || context?.adminSection) {
    hints.push("admin", "quáº£n lÃ½");
    if (context?.adminSection === "news") hints.push("tin tá»©c", "news");
    if (context?.adminSection === "users") {
      hints.push("ngÆ°á»i dÃ¹ng", "user");
    }
  }

  if (
    context?.pageType === "profile" ||
    context?.pageType === "public_profile" ||
    context?.profileUserId
  ) {
    hints.push("há»“ sÆ¡", "player", "ngÆ°á»i chÆ¡i");
  }

  hints.push(...getPageSnapshotSignals(context));

  return sharedNormalizeText(`${normalized} ${hints.join(" ")}`);
}

function sanitizePageTitle(value) {
  return String(value || "")
    .replace(/\s*[\-|â€“|â€”]\s*PickleTour.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNewsKeywordFromContext(context) {
  const entityTitle = compactText(context?.pageSnapshot?.entityTitle, 120);
  if (entityTitle) return entityTitle;
  const cleanTitle = sanitizePageTitle(context?.pageTitle);
  if (cleanTitle) return cleanTitle;
  if (context?.newsSlug) return String(context.newsSlug).replace(/-/g, " ");
  return "";
}

function formatTournamentStatusLabel(status) {
  switch (String(status || "")) {
    case "upcoming":
      return "sáº¯p diá»…n ra";
    case "ongoing":
      return "Ä‘ang diá»…n ra";
    case "finished":
      return "Ä‘Ã£ káº¿t thÃºc";
    default:
      return "hiá»‡n táº¡i";
  }
}

function inferTournamentListStatusFromSnapshot(snapshot = {}) {
  const joined = sharedNormalizeText(
    [snapshot?.sectionTitle, ...(snapshot?.activeLabels || [])].join(" "),
  );
  if (hasAny(joined, ["sap dien ra", "upcoming"])) return "upcoming";
  if (hasAny(joined, ["dang dien ra", "ongoing"])) return "ongoing";
  if (hasAny(joined, ["da ket thuc", "finished"])) return "finished";
  return "";
}

function getTournamentListPageState(context = {}) {
  if (String(context?.pageType || "") !== "tournament_list") return null;

  const snapshot = context?.pageSnapshot || {};
  const rawStats = snapshot?.stats || {};
  const currentTab = ["upcoming", "ongoing", "finished"].includes(
    String(rawStats.currentTab || ""),
  )
    ? String(rawStats.currentTab)
    : inferTournamentListStatusFromSnapshot(snapshot);
  const visibleTournaments = Array.isArray(snapshot?.visibleTournaments)
    ? snapshot.visibleTournaments
        .map((item) => ({
          id: String(item?.id || ""),
          name: trimText(item?.name || "", 120),
          status: String(item?.status || ""),
          location: trimText(item?.location || "", 80),
        }))
        .filter((item) => item.name)
        .slice(0, 4)
    : compactTexts(snapshot?.highlights || [], 4, 120).map((name) => ({
        id: "",
        name,
        status: currentTab,
        location: "",
      }));

  return {
    currentTab,
    stats: {
      total: Number(rawStats.total) || 0,
      upcoming: Number(rawStats.upcoming) || 0,
      ongoing: Number(rawStats.ongoing) || 0,
      finished: Number(rawStats.finished) || 0,
      visible: Number(rawStats.visible) || visibleTournaments.length || 0,
    },
    visibleTournaments,
    keyword: trimText(rawStats.keyword || "", 80),
  };
}

function createTournamentListTabAction(status) {
  return createAction("set_page_state", {
    label: `Chuyá»ƒn sang tab ${formatTournamentStatusLabel(status)}`,
    description: `Äá»•i danh sÃ¡ch giáº£i Ä‘áº¥u sang tráº¡ng thÃ¡i ${formatTournamentStatusLabel(status)}.`,
    payload: {
      key: "tab",
      handlerKey: "tab",
      value: status,
    },
  });
}

function buildTournamentListDirectRoute(message, normalized, context = {}) {
  const pageState = getTournamentListPageState(context);
  if (!pageState) return null;

  const asksAboutTournamentList =
    hasAny(normalized, [
      "giai",
      "tournament",
      "bao nhieu giai",
      "co bao nhieu giai",
      "co giai nao",
      "giai nao",
      "sap dien ra",
      "dang dien ra",
      "da ket thuc",
      "khong co",
      "khong lay",
      "khong thay",
      "sao lai",
    ]) ||
    (isCurrentContextReference(normalized) &&
      hasAny(normalized, ["bao nhieu", "co khong", "co gi"]));

  if (!asksAboutTournamentList) return null;

  const requestedStatus =
    pickTournamentStatusFromMessage(message, normalized) || pageState.currentTab;
  if (!requestedStatus) return null;

  const currentStatus = pageState.currentTab || requestedStatus;
  const requestedLabel = formatTournamentStatusLabel(requestedStatus);
  const currentLabel = formatTournamentStatusLabel(currentStatus);
  const requestedCount =
    Number(pageState.stats?.[requestedStatus]) ||
    (requestedStatus === currentStatus ? pageState.stats.visible : 0);
  const visibleNames = pageState.visibleTournaments
    .map((item) => item.name)
    .filter(Boolean);

  let reply = "";
  if (requestedCount > 0) {
    if (requestedStatus === currentStatus) {
      reply = `Ngay trÃªn tab "${currentLabel}", mÃ¬nh Ä‘ang tháº¥y ${requestedCount} giáº£i ${requestedLabel}.`;
      if (visibleNames.length) {
        reply += ` VÃ­ dá»¥ Ä‘ang hiá»‡n ${visibleNames.slice(0, 3).join(", ")}.`;
      }
    } else {
      reply = `Theo dá»¯ liá»‡u Ä‘ang hiá»ƒn thá»‹ trÃªn trang nÃ y, hiá»‡n cÃ³ ${requestedCount} giáº£i ${requestedLabel}. Tab báº¡n Ä‘ang má»Ÿ lÃ  "${currentLabel}".`;
    }
  } else if (requestedStatus === currentStatus && visibleNames.length) {
    reply = `Ngay trÃªn tab "${currentLabel}", mÃ¬nh váº«n Ä‘ang tháº¥y ${visibleNames.length} giáº£i hiá»‡n trÃªn mÃ n hÃ¬nh, gá»“m ${visibleNames.slice(0, 3).join(", ")}.`;
  } else {
    reply = `Theo bá»™ lá»c hiá»‡n táº¡i trÃªn trang nÃ y, mÃ¬nh chÆ°a tháº¥y giáº£i ${requestedLabel}. Tab Ä‘ang má»Ÿ lÃ  "${currentLabel}".`;
  }

  if (pageState.keyword) {
    reply += ` LÆ°u Ã½ lÃ  danh sÃ¡ch Ä‘ang cÃ³ bá»™ lá»c tÃ¬m kiáº¿m "${pageState.keyword}".`;
  }

  const actions = [];
  if (requestedStatus !== currentStatus) {
    actions.push(createTournamentListTabAction(requestedStatus));
  }
  actions.push(...buildContextActions(context).slice(0, 3));

  return {
    kind: "direct",
    directResponse: {
      reply,
      actions: actions.filter(Boolean),
      suggestions: [
        requestedStatus === "ongoing" ? "Tiáº¿n Ä‘á»™ giáº£i nÃ y tháº¿ nÃ o?" : "",
        requestedStatus === "ongoing" ? "Má»Ÿ lá»‹ch thi Ä‘áº¥u" : "",
        requestedStatus !== "ongoing" ? "Chuyá»ƒn sang tab Ä‘ang diá»…n ra" : "",
        "Focus Ã´ tÃ¬m kiáº¿m",
      ].filter(Boolean),
    },
  };
}

function classifyRoute(message, context, userId) {
  const normalized = sharedNormalizeText(message);
  const genericKnowledgeQuestion = looksLikeGenericKnowledgeQuestion(
    message,
    normalized,
  );
  const boostedNormalized = addContextualKeywords(message, normalized, context);
  const entityName = sharedExtractEntityName(message);
  const tournamentListDirectRoute = buildTournamentListDirectRoute(
    message,
    boostedNormalized,
    context,
  );

  if (tournamentListDirectRoute) {
    return tournamentListDirectRoute;
  }

  if (looksLikeTournamentAvailabilityQuestion(message, normalized)) {
    return {
      kind: "tournament",
      entityName,
      toolPlan: buildTournamentToolPlan(
        message,
        boostedNormalized,
        entityName,
        context,
      ),
    };
  }

  if (looksLikeGreetingMessage(message)) {
    return {
      kind: "direct",
      directResponse: {
        reply:
          "Xin chÃ o ðŸ‘‹ MÃ¬nh lÃ  Pikora. Báº¡n cá»© há»i vá» giáº£i Ä‘áº¥u, VÄV, CLB, luáº­t chÆ¡i hoáº·c báº£o mÃ¬nh má»Ÿ Ä‘Ãºng trang trong app nhÃ©.",
        suggestions: [
          "Giáº£i nÃ o sáº¯p diá»…n ra?",
          "Rating cá»§a tÃ´i lÃ  bao nhiÃªu?",
          "Má»Ÿ báº£ng xáº¿p háº¡ng",
        ],
      },
    };
  }

  if (looksLikeThanksMessage(message)) {
    return {
      kind: "direct",
      directResponse: {
        reply: "KhÃ´ng cÃ³ gÃ¬ ðŸ˜„ Náº¿u cáº§n mÃ¬nh tra tiáº¿p hoáº·c má»Ÿ Ä‘Ãºng trang cho báº¡n luÃ´n nhÃ©.",
        suggestions: [
          "Giáº£i cá»§a tÃ´i",
          "Lá»‹ch thi Ä‘áº¥u giáº£i nÃ y",
          "Tin má»›i nháº¥t",
        ],
      },
    };
  }

  if (genericKnowledgeQuestion) {
    return {
      kind: "knowledge",
      entityName,
      toolPlan: [
        {
          name: "search_knowledge",
          args: { query: message, limit: 3 },
        },
      ],
    };
  }

  const navigationRoute = detectNavigationRoute(
    message,
    boostedNormalized,
    context,
  );
  if (navigationRoute) {
    return navigationRoute;
  }

  const wantsOwnInfo =
    hasAny(boostedNormalized, ["cá»§a tÃ´i", "tÃ´i", "mÃ¬nh", "my "]) &&
    hasAny(boostedNormalized, [
      "rating",
      "há»“ sÆ¡",
      "thÃ´ng tin",
      "giáº£i cá»§a tÃ´i",
      "Ä‘Äƒng kÃ½",
      "tráº­n sáº¯p tá»›i",
      "lá»‹ch sá»­ Ä‘Äƒng nháº­p",
      "thiáº¿t bá»‹",
      "biáº¿n Ä‘á»™ng",
    ]);

  if (wantsOwnInfo) {
    if (!userId) {
      return {
        kind: "direct",
        directResponse: {
          reply:
            "Báº¡n cáº§n Ä‘Äƒng nháº­p trÆ°á»›c Ä‘á»ƒ mÃ¬nh tra thÃ´ng tin cÃ¡ nhÃ¢n chÃ­nh xÃ¡c. MÃ¬nh Ä‘Ã£ chuáº©n bá»‹ nÃºt má»Ÿ trang Ä‘Äƒng nháº­p cho báº¡n.",
          navigation: buildNavigation("login", context),
          suggestions: [
            "CÃ¡ch Ä‘Äƒng kÃ½ tÃ i khoáº£n",
            "QuÃªn máº­t kháº©u thÃ¬ lÃ m sao?",
            "Giáº£i nÃ o sáº¯p diá»…n ra?",
          ],
        },
      };
    }
    return {
      kind: "personal",
      entityName,
      toolPlan: buildPersonalToolPlan(boostedNormalized, context),
    };
  }

  if (
    hasAny(normalized, [
      "luáº­t",
      "hÆ°á»›ng dáº«n",
      "cÃ¡ch ",
      "faq",
      "giáº£i thÃ­ch",
      "pickleball lÃ  gÃ¬",
      "Ä‘Äƒng kÃ½ tÃ i khoáº£n",
      "quÃªn máº­t kháº©u",
    ])
  ) {
    return {
      kind: "knowledge",
      entityName,
      toolPlan: [
        {
          name: "search_knowledge",
          args: { query: message, limit: 3 },
        },
      ],
    };
  }

  if (hasAny(boostedNormalized, ["tin tá»©c", "news", "bÃ i viáº¿t"])) {
    return {
      kind: "news",
      entityName,
      toolPlan: buildNewsToolPlan(message, boostedNormalized, entityName, context),
    };
  }

  if (hasAny(boostedNormalized, ["clb", "cÃ¢u láº¡c bá»™", "club"])) {
    return {
      kind: "club",
      entityName,
      toolPlan: buildClubToolPlan(boostedNormalized, entityName, context),
    };
  }

  if (
    hasAny(boostedNormalized, [
      "v dv",
      "vdv",
      "ngÆ°á»i chÆ¡i",
      "player",
      "rating",
      "xáº¿p háº¡ng",
      "so sÃ¡nh",
      "há»“ sÆ¡",
    ])
  ) {
    return {
      kind: "player",
      entityName,
      toolPlan: buildPlayerToolPlan(
        message,
        boostedNormalized,
        entityName,
        context,
      ),
    };
  }

  if (
    hasAny(boostedNormalized, ["live", "trá»±c tiáº¿p", "streaming"]) &&
    (pageTypeStartsWith(context, "live_") ||
      pageTypeStartsWith(context, "court_") ||
      context.matchId ||
      context.courtId)
  ) {
    return {
      kind: "live",
      entityName,
      toolPlan: buildLiveToolPlan(boostedNormalized, context),
    };
  }

  if (
    hasAny(boostedNormalized, [
      "giai",
      "tournament",
      "nhÃ¡nh Ä‘áº¥u",
      "bracket",
      "lá»‹ch thi Ä‘áº¥u",
      "Ä‘Äƒng kÃ½",
      "bá»‘c thÄƒm",
      "sÃ¢n",
      "giáº£i nÃ y",
    ]) ||
    context.tournamentId
  ) {
    return {
      kind: "tournament",
      entityName,
      toolPlan: buildTournamentToolPlan(
        message,
        boostedNormalized,
        entityName,
        context,
      ),
    };
  }

  return {
    kind: isQuestionLike(boostedNormalized) ? "knowledge" : "general",
    entityName,
    toolPlan: isQuestionLike(boostedNormalized)
      ? [{ name: "search_knowledge", args: { query: message, limit: 2 } }]
      : [],
  };
}

export function classifyRouteForTest(message, context = {}, userId = null) {
  return classifyRoute(message, context, userId);
}

function detectNavigationRoute(message, normalized, context) {
  const wantsNavigation = hasAny(normalized, [
    "má»Ÿ ",
    "vÃ o ",
    "Ä‘i tá»›i",
    "Ä‘áº¿n ",
    "go to",
    "open ",
    "truy cáº­p",
    "show page",
  ]);

  if (!wantsNavigation) return null;

  const navConfig = buildNavigationIntent(message, normalized, context);
  if (!navConfig) return null;

  if (navConfig.needsTournamentLookup) {
    return {
      kind: "navigate",
      entityName: navConfig.tournamentName,
      toolPlan: [
        {
          name: "search_tournaments",
          args: {
            name: navConfig.tournamentName,
            limit: 3,
          },
        },
        {
          name: "navigate",
          args: {
            screen: navConfig.screen,
            tournamentId: FIRST_TOURNAMENT_ID,
          },
          captureNavigation: true,
        },
      ],
    };
  }

  return {
    kind: "navigate",
      directResponse: {
        reply: navConfig.reply,
        navigation: buildNavigation(navConfig.screen, {
          ...context,
          tournamentId: navConfig.tournamentId || context.tournamentId,
          clubId: navConfig.clubId || context.clubId,
          newsSlug: navConfig.newsSlug || context.newsSlug,
        }),
        suggestions: navConfig.suggestions || [],
      },
  };
}

function buildNavigationIntent(message, normalized, context) {
  const tournamentSpecificScreen = hasAny(normalized, ["nhÃ¡nh Ä‘áº¥u", "bracket", "sÆ¡ Ä‘á»“"])
    ? "bracket"
    : hasAny(normalized, ["lá»‹ch thi Ä‘áº¥u", "lá»‹ch giáº£i"])
      ? "schedule"
      : hasAny(normalized, ["Ä‘Äƒng kÃ½ giáº£i"])
        ? "registration"
        : hasAny(normalized, ["quáº£n lÃ½ giáº£i", "manage"])
          ? "tournament_manage"
          : hasAny(normalized, ["check in", "checkin"])
            ? "tournament_checkin"
            : hasAny(normalized, [
                "sÃ¢n kháº¥u bá»‘c thÄƒm",
                "draw live",
                "bá»‘c thÄƒm live",
              ])
              ? "draw_live"
              : hasAny(normalized, ["lá»‹ch sá»­ bá»‘c thÄƒm", "draw history"])
                ? "draw_live_history"
                : hasAny(normalized, ["báº£ng bá»‘c thÄƒm", "draw board"])
                  ? "draw_live_board"
        : hasAny(normalized, ["tá»•ng quan"])
          ? "tournament_overview"
          : hasAny(normalized, ["bá»‘c thÄƒm", "draw"])
            ? "draw"
            : hasAny(normalized, [
                "chi tiáº¿t giáº£i",
                "giáº£i nÃ y",
                "giáº£i hiá»‡n táº¡i",
              ])
              ? "tournament_detail"
              : "";

  if (tournamentSpecificScreen) {
    if (context.tournamentId) {
      return {
        screen: tournamentSpecificScreen,
        tournamentId: context.tournamentId,
        reply: "MÃ¬nh Ä‘Ã£ chuáº©n bá»‹ nÃºt má»Ÿ Ä‘Ãºng trang cá»§a giáº£i hiá»‡n táº¡i cho báº¡n.",
        suggestions: [
          "Luáº­t cá»§a giáº£i nÃ y",
          "CÃ³ bao nhiÃªu Ä‘á»™i Ä‘Äƒng kÃ½?",
          "Lá»‹ch thi Ä‘áº¥u giáº£i nÃ y",
        ],
      };
    }

    const tournamentName = sharedExtractEntityName(message);
    if (tournamentName) {
      return {
        screen: tournamentSpecificScreen,
        tournamentName,
        needsTournamentLookup: true,
      };
    }
  }

  const screen = hasAny(normalized, ["Ä‘Äƒng nháº­p", "login"])
    ? "login"
    : hasAny(normalized, ["Ä‘Äƒng kÃ½ tÃ i khoáº£n", "register"])
      ? "register"
      : hasAny(normalized, ["quÃªn máº­t kháº©u", "forgot password"])
        ? "forgot_password"
        : hasAny(normalized, ["há»“ sÆ¡ cá»§a tÃ´i", "trang cÃ¡ nhÃ¢n", "profile"])
          ? "profile"
          : hasAny(normalized, ["báº£ng xáº¿p háº¡ng", "bxh", "ranking"])
          ? "leaderboard"
            : hasAny(normalized, ["giáº£i cá»§a tÃ´i", "my tournaments"])
              ? "my_tournaments"
              : hasAny(normalized, ["admin news", "quáº£n lÃ½ tin tá»©c"])
                ? "admin_news"
                : hasAny(normalized, ["admin users", "quáº£n lÃ½ ngÆ°á»i dÃ¹ng"])
                  ? "admin_users"
                    : hasAny(normalized, ["admin avatar", "avatar optimization"])
                      ? "admin_avatar_optimization"
                    : hasAny(normalized, ["tin tá»©c", "news"])
                      ? "news_list"
                : hasAny(normalized, ["danh sÃ¡ch giáº£i", "cÃ¡c giáº£i", "tournaments"])
                  ? "tournament_list"
                  : hasAny(normalized, ["cÃ¢u láº¡c bá»™", "clb", "clubs"])
                    ? "clubs"
                  : hasAny(normalized, ["live", "trá»±c tiáº¿p"])
                    ? "live_matches"
                    : hasAny(normalized, ["trang chá»§", "home"])
                      ? "home"
                      : hasAny(normalized, ["xÃ¡c minh", "kyc"])
                        ? "kyc"
                      : hasAny(normalized, ["Ä‘iá»ƒm trÃ¬nh", "level point"])
                          ? "level_point"
                          : "";

  if (!screen && context.clubId && hasAny(normalized, ["clb nÃ y", "club nÃ y"])) {
    return {
      screen: "club_detail",
      clubId: context.clubId,
      reply: "MÃ¬nh Ä‘Ã£ chuáº©n bá»‹ nÃºt má»Ÿ Ä‘Ãºng CLB hiá»‡n táº¡i cho báº¡n.",
      suggestions: ["ThÃ nh viÃªn CLB nÃ y", "Sá»± kiá»‡n CLB nÃ y", "ThÃ´ng bÃ¡o CLB nÃ y"],
    };
  }

  if (
    !screen &&
    context.newsSlug &&
    hasAny(normalized, ["bÃ i nÃ y", "tin nÃ y", "news nÃ y"])
  ) {
    return {
      screen: "news_detail",
      newsSlug: context.newsSlug,
      reply: "MÃ¬nh Ä‘Ã£ chuáº©n bá»‹ nÃºt má»Ÿ láº¡i Ä‘Ãºng bÃ i viáº¿t hiá»‡n táº¡i cho báº¡n.",
      suggestions: ["TÃ³m táº¯t bÃ i nÃ y", "Tin má»›i nháº¥t", "BÃ i nÃ y tá»« nguá»“n nÃ o?"],
    };
  }

  if (!screen) return null;

  return {
    screen,
    reply: "MÃ¬nh Ä‘Ã£ chuáº©n bá»‹ nÃºt má»Ÿ Ä‘Ãºng trang cho báº¡n.",
    suggestions: [
      "Giáº£i nÃ o sáº¯p diá»…n ra?",
      "Tin má»›i nháº¥t",
      "CÃ¡ch Ä‘Äƒng kÃ½ tÃ i khoáº£n",
    ],
  };
}

function buildPersonalToolPlan(normalized, context) {
  if (hasAny(normalized, ["giáº£i cá»§a tÃ´i", "giáº£i Ä‘Ã£ Ä‘Äƒng kÃ½", "Ä‘Äƒng kÃ½ giáº£i"])) {
    return [{ name: "get_my_registrations", args: { limit: 6 } }];
  }
  if (hasAny(normalized, ["biáº¿n Ä‘á»™ng", "lá»‹ch sá»­ rating", "rating changes"])) {
    return [{ name: "get_my_rating_changes", args: { limit: 8 } }];
  }
  if (hasAny(normalized, ["tráº­n sáº¯p tá»›i", "upcoming"])) {
    return [
      {
        name: "get_upcoming_matches",
        args: {
          tournamentId: context.tournamentId || undefined,
          limit: 6,
        },
      },
    ];
  }
  if (hasAny(normalized, ["lá»‹ch sá»­ Ä‘Äƒng nháº­p", "login"])) {
    return [{ name: "get_login_history", args: { limit: 10 } }];
  }
  if (hasAny(normalized, ["thiáº¿t bá»‹", "device"])) {
    return [{ name: "get_my_devices", args: {} }];
  }
  return [{ name: "get_my_info", args: {} }];
}

function buildNewsToolPlan(message, normalized, entityName, context) {
  const keywordFromContext = buildNewsKeywordFromContext(context);
  const preferContextKeyword =
    isCurrentContextReference(normalized) || pageTypeStartsWith(context, "news_");
  return [
    {
      name: "search_news",
      args: {
        keyword: preferContextKeyword
          ? keywordFromContext || entityName || message
          : entityName || keywordFromContext || message,
        limit: pageTypeStartsWith(context, "news_detail") ? 3 : 5,
      },
    },
  ];
}

function buildClubToolPlan(normalized, entityName, context = {}) {
  const useCurrentClub =
    Boolean(context.clubId) &&
    (!entityName ||
      isCurrentContextReference(normalized) ||
      pageTypeStartsWith(context, "club_"));

  if (useCurrentClub) {
    if (
      hasAny(normalized, ["thÃ nh viÃªn", "members", "admin", "quáº£n lÃ½"]) ||
      context.pageSection === "members"
    ) {
      return [{ name: "get_club_members", args: { clubId: context.clubId, limit: 20 } }];
    }
    if (
      hasAny(normalized, ["sá»± kiá»‡n", "event", "lá»‹ch clb"]) ||
      context.pageSection === "events"
    ) {
      return [{ name: "get_club_events", args: { clubId: context.clubId, upcoming: true, limit: 8 } }];
    }
    if (
      hasAny(normalized, ["bÃ¬nh chá»n", "poll", "vote"]) ||
      context.pageSection === "polls"
    ) {
      return [{ name: "get_club_polls", args: { clubId: context.clubId, limit: 5 } }];
    }
    if (
      hasAny(normalized, ["tin", "news", "thÃ´ng bÃ¡o", "announcements"]) ||
      context.pageSection === "news"
    ) {
      return [
        {
          name: "get_club_announcements",
          args: { clubId: context.clubId, limit: 8 },
        },
      ];
    }
    return [{ name: "get_club_details", args: { clubId: context.clubId } }];
  }

  const plan = [
    {
      name: "search_clubs",
      args: {
        name: entityName || "",
        limit: 5,
      },
    },
  ];

  if (entityName && hasAny(normalized, ["chi tiáº¿t", "má»Ÿ CLB", "xem CLB"])) {
    plan.push({
      name: "get_club_details",
      args: { clubId: FIRST_CLUB_ID },
    });
  }

  return plan;
}

function buildLiveToolPlan(normalized, context = {}) {
  if (context.matchId) {
    if (hasAny(normalized, ["tá»‰ sá»‘", "Ä‘iá»ƒm", "score", "set", "vÃ¡n"])) {
      return [{ name: "get_match_score_detail", args: { matchId: context.matchId } }];
    }
    if (hasAny(normalized, ["diá»…n biáº¿n", "log", "nháº­t kÃ½"])) {
      return [{ name: "get_match_live_log", args: { matchId: context.matchId, limit: 20 } }];
    }
    if (hasAny(normalized, ["video", "xem lai", "record", "stream"])) {
      return [{ name: "get_match_video", args: { matchId: context.matchId } }];
    }
    return [{ name: "get_match_info", args: { matchId: context.matchId } }];
  }

  if (context.tournamentId) {
    return [{ name: "get_live_matches", args: { tournamentId: context.tournamentId, limit: 10 } }];
  }

  return [{ name: "get_live_streams", args: { status: "LIVE" } }];
}

function buildPlayerToolPlan(message, normalized, entityName, context = {}) {
  if (
    context.profileUserId &&
    (isCurrentContextReference(normalized) ||
      context.pageType === "public_profile")
  ) {
    if (hasAny(normalized, ["lá»‹ch sá»­ giáº£i", "tournament history"])) {
      return [
        {
          name: "get_player_tournament_history",
          args: { userId: context.profileUserId },
        },
      ];
    }
    if (hasAny(normalized, ["xáº¿p háº¡ng", "ranking"])) {
      return [
        {
          name: "get_player_ranking",
          args: { userId: context.profileUserId },
        },
      ];
    }
    return [
      {
        name: "get_user_profile_detail",
        args: { userId: context.profileUserId },
      },
    ];
  }

  if (hasAny(normalized, ["so sÃ¡nh", "compare"])) {
    const [firstName, secondName] = sharedExtractPairNames(message);
    const plan = [];
    if (firstName) {
      plan.push({
        name: "get_user_stats",
        args: { name: firstName },
      });
    }
    if (secondName) {
      plan.push({
        name: "get_user_stats",
        args: { name: secondName },
      });
    }
    return plan.length
      ? plan
      : [{ name: "search_users", args: { name: entityName || message, limit: 5 } }];
  }

  if (hasAny(normalized, ["xáº¿p háº¡ng", "bxh", "ranking"])) {
    return [{ name: "get_leaderboard", args: { limit: 10 } }];
  }

  if (entityName && hasAny(normalized, ["rating", "thá»‘ng kÃª", "há»“ sÆ¡"])) {
    return [{ name: "get_user_stats", args: { name: entityName } }];
  }

  return [{ name: "search_users", args: { name: entityName || message, limit: 5 } }];
}

function buildTournamentToolPlan(message, normalized, entityName, context) {
  const hasContextTournament =
    Boolean(context.tournamentId) &&
    (!entityName ||
      hasAny(normalized, [
        "giáº£i nÃ y",
        "giáº£i hiá»‡n táº¡i",
        "trang nÃ y",
        "giai nay",
        "giai hien tai",
        "trang nay",
      ]));

  if (hasContextTournament) {
    if (context.matchId) {
      if (hasAny(normalized, ["tá»‰ sá»‘", "Ä‘iá»ƒm", "score", "set", "vÃ¡n"])) {
        return [
          {
            name: "get_match_score_detail",
            args: { matchId: context.matchId },
          },
        ];
      }
      if (hasAny(normalized, ["diá»…n biáº¿n", "log", "nháº­t kÃ½"])) {
        return [
          {
            name: "get_match_live_log",
            args: { matchId: context.matchId, limit: 20 },
          },
        ];
      }
      if (hasAny(normalized, ["video", "xem láº¡i", "record", "stream"])) {
        return [
          {
            name: "get_match_video",
            args: { matchId: context.matchId },
          },
        ];
      }
    }
    if (context.bracketId) {
      if (hasAny(normalized, ["xáº¿p háº¡ng báº£ng", "standings", "báº£ng nÃ y"])) {
        return [
          {
            name: "get_bracket_standings",
            args: { bracketId: context.bracketId },
          },
        ];
      }
      if (hasAny(normalized, ["nhÃ³m", "group", "báº£ng Ä‘áº¥u"])) {
        return [
          {
            name: "get_bracket_groups",
            args: { bracketId: context.bracketId },
          },
        ];
      }
      if (hasAny(normalized, ["cÃ¢y nhÃ¡nh", "match tree", "tree"])) {
        return [
          {
            name: "get_bracket_match_tree",
            args: { bracketId: context.bracketId },
          },
        ];
      }
    }
    if (
      hasAny(normalized, [
        "bao nhiÃªu tráº­n",
        "cÃ²n bao nhiÃªu tráº­n",
        "tráº­n chÆ°a xong",
        "tráº­n Ä‘Ã£ xong",
        "tá»•ng tráº­n",
        "bao nhieu tran",
        "con bao nhieu tran",
        "tran chua xong",
        "tran da xong",
        "tong tran",
        "match count",
      ])
    ) {
      return [
        {
          name: "get_tournament_progress",
          args: { tournamentId: context.tournamentId },
        },
        {
          name: "get_tournament_summary",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["lá»‹ch thi Ä‘áº¥u", "schedule"])) {
      return [
        {
          name: "get_tournament_schedule",
          args: { tournamentId: context.tournamentId, limit: 10 },
        },
      ];
    }
    if (
      hasAny(normalized, [
        "bao nhiÃªu tráº­n",
        "cÃ²n bao nhiÃªu tráº­n",
        "tráº­n chÆ°a xong",
        "tráº­n Ä‘Ã£ xong",
        "tá»•ng tráº­n",
        "bao nhieu tran",
        "con bao nhieu tran",
        "tran chua xong",
        "tran da xong",
        "tong tran",
        "match count",
      ])
    ) {
      return [
        {
          name: "get_tournament_progress",
          args: { tournamentId: context.tournamentId },
        },
        {
          name: "get_tournament_summary",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["luáº­t", "rules"])) {
      return [
        {
          name: "get_tournament_rules",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["nhÃ¡nh Ä‘áº¥u", "bracket", "sÆ¡ Ä‘á»“"])) {
      return [
        {
          name: "get_tournament_brackets",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["Ä‘Äƒng kÃ½", "bao nhiÃªu Ä‘á»™i", "Ä‘á»™i"])) {
      return [
        {
          name: "get_tournament_registrations",
          args: { tournamentId: context.tournamentId, limit: 10 },
        },
      ];
    }
    if (hasAny(normalized, ["lá»‡ phÃ­", "thanh toÃ¡n", "payment"])) {
      return [
        {
          name: "get_tournament_payment_info",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["tiáº¿n Ä‘á»™", "progress", "tien do"])) {
      return [
        {
          name: "get_tournament_progress",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["quáº£n lÃ½", "manager", "btc"])) {
      return [
        {
          name: "get_tournament_managers",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["trá»ng tÃ i", "referee"])) {
      return [
        {
          name: "get_tournament_referees",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["sÃ¢n", "court"])) {
      return [
        {
          name: "get_tournament_courts",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["bá»‘c thÄƒm", "draw"])) {
      return [
        {
          name: "get_draw_results",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["live", "trá»±c tiáº¿p", "streaming"])) {
      return [
        {
          name: "get_live_matches",
          args: { tournamentId: context.tournamentId, limit: 10 },
        },
      ];
    }
    return [
      {
        name: "get_tournament_summary",
        args: { tournamentId: context.tournamentId },
      },
    ];
  }

  const status = pickTournamentStatusFromMessage(message, normalized);
  const extractedName = shouldIgnoreTournamentNameFilter(normalized, entityName)
    ? ""
    : entityName || "";
  const plan = [
    {
      name: "search_tournaments",
      args: {
        name: extractedName || undefined,
        status: status || undefined,
        limit: 5,
      },
    },
  ];

  const needsSpecificTournament =
    Boolean(extractedName) &&
    hasAny(normalized, [
      "chi tiáº¿t",
      "tá»•ng quan",
      "lá»‹ch thi Ä‘áº¥u",
      "luáº­t",
      "nhÃ¡nh Ä‘áº¥u",
      "Ä‘Äƒng kÃ½",
      "sÃ¢n",
      "bá»‘c thÄƒm",
    ]);

  if (!needsSpecificTournament) {
    return plan;
  }

  if (hasAny(normalized, ["lá»‹ch thi Ä‘áº¥u", "schedule"])) {
    plan.push({
      name: "get_tournament_schedule",
      args: { tournamentId: FIRST_TOURNAMENT_ID, limit: 10 },
    });
    return plan;
  }
  if (
    hasAny(normalized, [
      "bao nhiÃªu tráº­n",
      "cÃ²n bao nhiÃªu tráº­n",
      "tráº­n chÆ°a xong",
      "tráº­n Ä‘Ã£ xong",
      "tá»•ng tráº­n",
      "match count",
    ])
  ) {
    plan.push({
      name: "get_tournament_progress",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    plan.push({
      name: "get_tournament_summary",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }
  if (hasAny(normalized, ["luáº­t", "rules"])) {
    plan.push({
      name: "get_tournament_rules",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }
  if (hasAny(normalized, ["nhÃ¡nh Ä‘áº¥u", "bracket", "sÆ¡ Ä‘á»“"])) {
    plan.push({
      name: "get_tournament_brackets",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }
  if (hasAny(normalized, ["Ä‘Äƒng kÃ½", "bao nhiÃªu Ä‘á»™i", "Ä‘á»™i"])) {
    plan.push({
      name: "get_tournament_registrations",
      args: { tournamentId: FIRST_TOURNAMENT_ID, limit: 10 },
    });
    return plan;
  }
  if (hasAny(normalized, ["sÃ¢n", "court"])) {
    plan.push({
      name: "get_tournament_courts",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }
  if (hasAny(normalized, ["bá»‘c thÄƒm", "draw"])) {
    plan.push({
      name: "get_draw_results",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }

  plan.push({
    name: "get_tournament_summary",
    args: { tournamentId: FIRST_TOURNAMENT_ID },
  });
  return plan;
}

function pickTournamentStatus(normalized) {
  return pickTournamentStatusFromMessage("", normalized);
}

function shouldIgnoreTournamentNameFilter(normalized, entityName) {
  const normalizedEntity = sharedNormalizeText(entityName);
  if (!normalizedEntity) return true;

  if (
    hasAny(normalized, [
      "co giai nao",
      "giai nao",
      "bao nhieu giai",
      "co bao nhieu giai",
    ])
  ) {
    return true;
  }

  return hasAny(normalizedEntity, [
    "co",
    "nao",
    "dang dien ra",
    "sap dien ra",
    "da ket thuc",
    "sap toi",
    "bao nhieu",
  ]);
}

function extractEntityName(message) {
  const cleaned = String(message || "")
    .replace(/[?!.]/g, " ")
    .replace(
      /\b(xin|cho|toi|mÃ¬nh|minh|giup|hÃ£y|hay|lam on|vui long|mo|vao|xem|tim|tra cuu|cho toi biet|co the|giup toi)\b/gi,
      " ",
    )
    .replace(
      /\b(giáº£i|giai|tournament|cÃ¢u láº¡c bá»™|cau lac bo|clb|club|tin tá»©c|tin tuc|news|vÄ‘v|vdv|ngÆ°á»i chÆ¡i|nguoi choi|player|báº£ng xáº¿p háº¡ng|bxh|rating|há»“ sÆ¡|ho so|lá»‹ch thi Ä‘áº¥u|lich thi dau|nhÃ¡nh Ä‘áº¥u|nhanh dau|bracket|trang|page)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= 2 ? cleaned : "";
}

function extractPairNames(message) {
  const raw = String(message || "");
  const splitters = [" vá»›i ", " va ", " vs ", " vÃ  "];
  for (const splitter of splitters) {
    const parts = raw.split(new RegExp(splitter, "i"));
    if (parts.length >= 2) {
      return [extractEntityName(parts[0]), extractEntityName(parts[1])];
    }
  }
  return ["", ""];
}

function buildNavigation(screen, context) {
  const cfg = { ...NAVIGATION_SCREENS, ...EXTRA_NAVIGATION_SCREENS }[screen];
  if (!cfg) return null;
  const params = {
    tournamentId: context?.tournamentId || "",
    bracketId: context?.bracketId || "",
    courtCode: context?.courtCode || "",
    courtId: context?.courtId || "",
    clubId: context?.clubId || "",
    newsSlug: context?.newsSlug || "",
    profileUserId: context?.profileUserId || "",
  };
  const replace = (value) =>
    value.replace(/\{(\w+)\}/g, (_full, key) => params[key] || "");
  return {
    screen: cfg.screen,
    deepLink: replace(cfg.deepLink),
    webPath: replace(cfg.webPath),
    description: cfg.description,
  };
}

function buildActionNavigation(path, label, description = "") {
  return createAction("navigate", {
    path,
    label,
    description,
  });
}

function buildOpenNewTabAction(path, label) {
  return createAction("open_new_tab", {
    path,
    label,
  });
}

function createSource(kind, label, path, extra = {}) {
  return {
    kind,
    label: trimText(label, 140),
    path: path || "",
    entityType: extra.entityType || "",
    entityId: extra.entityId || "",
    freshness: extra.freshness || "",
    tool: extra.tool || "",
    url: extra.url || "",
    tier: extra.tier || "app_data",
  };
}

function createAnswerCard(kind, card = {}) {
  return {
    kind,
    title: trimText(card.title, 140),
    subtitle: trimText(card.subtitle, 180),
    badges: compactTexts(card.badges || [], 5, 48),
    metrics: compactTexts(card.metrics || [], 6, 72),
    description: trimText(card.description, 220),
    path: card.path || "",
    actions: Array.isArray(card.actions) ? card.actions.slice(0, 3) : [],
  };
}

function extractJsonFromOpenAIResponse(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    try {
      return JSON.parse(response.output_text);
    } catch {
      return null;
    }
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_json" && part.json) {
        return part.json;
      }
      if (part?.type === "output_text") {
        const text =
          typeof part?.text?.value === "string"
            ? part.text.value
            : typeof part?.text === "string"
              ? part.text
              : "";
        if (!text) continue;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function normalizeHybridRetrievalItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      title: trimText(item?.title || "", 160),
      url: String(item?.url || "").trim(),
      sourceName: trimText(item?.sourceName || item?.source || "", 80),
      publishedAt: trimText(item?.publishedAt || "", 48),
      summary: trimText(item?.summary || item?.reason || "", 220),
    }))
    .filter((item) => item.title && item.url)
    .slice(0, LIVE_RETRIEVAL_MAX_RESULTS);
}

function shouldEscalateKnowledgeHelpToHybrid(message, route, execution = {}) {
  const requestedKinds = new Set(["knowledge", "general"]);
  if (!requestedKinds.has(String(route?.kind || ""))) return false;

  const normalized = sharedNormalizeText(message);
  if (
    hasAny(normalized, [
      "moi nhat",
      "hom nay",
      "gan day",
      "trend",
      "cap nhat",
      "news",
      "latest",
      "today",
      "recent",
    ])
  ) {
    return true;
  }

  const knowledgeCount =
    Number(execution?.toolResults?.search_knowledge?.count) ||
    Number(execution?.toolResults?.search_knowledge?.results?.length || 0);

  return knowledgeCount <= 0;
}

async function maybeRunHybridLiveRetrieval({
  message,
  route,
  routeLane,
  context,
  execution,
  rolloutDecision,
  safeEmit,
}) {
  if (!LIVE_RETRIEVAL_CLIENT || !rolloutDecision?.allowLiveRetrieval) return null;
  if (routeLane !== "knowledge_help") return null;

  const knowledgeMode = normalizeKnowledgeMode(context?.knowledgeMode);
  const shouldTry =
    knowledgeMode === "hybrid_live" ||
    (knowledgeMode === "auto" &&
      shouldEscalateKnowledgeHelpToHybrid(message, route, execution));

  if (!shouldTry) return null;

  safeEmit("thinking", { step: "Äang bá»• sung kiá»ƒm chá»©ng ngoÃ i há»‡ thá»‘ng..." });

  try {
    const response = await LIVE_RETRIEVAL_CLIENT.responses.create({
      model: LIVE_RETRIEVAL_MODEL,
      input: [
        {
          role: "system",
          content:
            "Báº¡n lÃ  bá»™ truy xuáº¥t live web cho Pikora. Chá»‰ tráº£ JSON. Æ¯u tiÃªn nguá»“n cháº¥t lÆ°á»£ng cao, ngáº¯n gá»n, Ä‘Ãºng vá»›i cÃ¢u há»i.",
        },
        {
          role: "user",
          content: JSON.stringify({
            query: message,
            pageType: context?.pageType || "",
            pageTitle: context?.pageTitle || "",
            currentPath: context?.currentPath || "",
            maxResults: LIVE_RETRIEVAL_MAX_RESULTS,
          }),
        },
      ],
      tools: [{ type: "web_search" }],
      text: {
        format: {
          type: "json_schema",
          name: "pikora_live_retrieval",
          strict: true,
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" },
                    sourceName: { type: "string" },
                    publishedAt: { type: "string" },
                    summary: { type: "string" },
                  },
                  required: ["title", "url"],
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
    const items = normalizeHybridRetrievalItems(parsed?.items);
    return {
      attempted: true,
      retrievalMode: "hybrid_live",
      items,
    };
  } catch (error) {
    return {
      attempted: true,
      retrievalMode: "internal",
      items: [],
      error: error?.message || "Hybrid retrieval failed",
    };
  }
}

function buildSourcesFromToolResults(
  toolResults = {},
  context = {},
  hybridRetrieval = null,
) {
  const sources = [];

  (toolResults.search_tournaments?.tournaments || []).slice(0, 2).forEach((item) => {
    if (!item?._id) return;
    sources.push(
      createSource("entity", item.name || "Giáº£i Ä‘áº¥u", `/tournament/${item._id}`, {
        entityType: "tournament",
        entityId: String(item._id),
        freshness: item.status || "db",
        tool: "search_tournaments",
        tier: "app_data",
      }),
    );
  });

  if (toolResults.get_tournament_summary?.tournament?.name && context?.tournamentId) {
    sources.push(
      createSource(
        "entity",
        toolResults.get_tournament_summary.tournament.name,
        `/tournament/${context.tournamentId}`,
        {
          entityType: "tournament",
          entityId: context.tournamentId,
          freshness: toolResults.get_tournament_summary.tournament.status || "db",
          tool: "get_tournament_summary",
          tier: "app_data",
        },
      ),
    );
  }

  if (toolResults.get_tournament_progress?.overview && context?.tournamentId) {
    sources.push(
      createSource(
        "entity",
        context?.pageSnapshot?.entityTitle || "Tiáº¿n Ä‘á»™ giáº£i Ä‘áº¥u",
        `/tournament/${context.tournamentId}/schedule`,
        {
          entityType: "tournament_progress",
          entityId: context.tournamentId,
          freshness:
            toolResults.get_tournament_progress?.overview?.progressPercent || "db",
          tool: "get_tournament_progress",
          tier: "app_data",
        },
      ),
    );
  }

  (toolResults.search_news?.articles || []).slice(0, 2).forEach((article) => {
    sources.push(
      createSource("article", article.title || "BÃ i viáº¿t", article.slug ? `/news/${article.slug}` : "", {
        entityType: "news",
        entityId: article.slug || "",
        freshness: article.publishedAt || "",
        tool: "search_news",
        tier: "app_data",
      }),
    );
  });

  (toolResults.search_clubs?.clubs || []).slice(0, 2).forEach((club) => {
    if (!club?._id) return;
    sources.push(
      createSource("entity", club.name || "CLB", `/clubs/${club._id}`, {
        entityType: "club",
        entityId: String(club._id),
        freshness: "db",
        tool: "search_clubs",
        tier: "app_data",
      }),
    );
  });

  if (toolResults.get_club_details?.name) {
    const clubId = toolResults.get_club_details?._id || context?.clubId || "";
    sources.push(
      createSource(
        "entity",
        toolResults.get_club_details.name,
        clubId ? `/clubs/${clubId}` : "",
        {
          entityType: "club",
          entityId: String(clubId || ""),
          freshness: "db",
          tool: "get_club_details",
          tier: "app_data",
        },
      ),
    );
  }

  (toolResults.search_users?.users || []).slice(0, 2).forEach((user) => {
    if (!user?._id) return;
    sources.push(
      createSource("entity", user.name || user.nickname || "VÄV", `/user/${user._id}`, {
        entityType: "player",
        entityId: String(user._id),
        freshness: "db",
        tool: "search_users",
        tier: "app_data",
      }),
    );
  });

  if (toolResults.get_match_info?.code && context?.matchId) {
    sources.push(
      createSource("match", `Tráº­n ${toolResults.get_match_info.code}`, context.currentPath || "", {
        entityType: "match",
        entityId: context.matchId,
        freshness: toolResults.get_match_info.status || "db",
        tool: "get_match_info",
        tier: "app_data",
      }),
    );
  }

  if (toolResults.get_match_score_detail?.code && context?.matchId) {
    sources.push(
      createSource(
        "match",
        `Chi tiáº¿t ${toolResults.get_match_score_detail.code}`,
        context.currentPath || "",
        {
          entityType: "match",
          entityId: context.matchId,
          freshness: toolResults.get_match_score_detail.status || "db",
          tool: "get_match_score_detail",
          tier: "app_data",
        },
      ),
    );
  }

  (toolResults.get_live_streams?.streams || []).slice(0, 2).forEach((stream) => {
    sources.push(
      createSource(
        "live",
        stream.match?.code ? `Live ${stream.match.code}` : stream.provider || "Live stream",
        "",
        {
          entityType: "live_stream",
          entityId: stream.link || "",
          freshness: stream.status || "live",
          tool: "get_live_streams",
          url: stream.link || "",
          tier: "app_data",
        },
      ),
    );
  });

  (toolResults.search_knowledge?.results || []).slice(0, 2).forEach((item) => {
    sources.push(
      createSource("knowledge", item.title || item.category || "Kiáº¿n thá»©c", "", {
        entityType: "knowledge",
        entityId: item.title || "",
        freshness: item.category || "knowledge",
        tool: "search_knowledge",
        tier: "curated_knowledge",
      }),
    );
  });

  (hybridRetrieval?.items || []).slice(0, 2).forEach((item) => {
    sources.push(
      createSource("web", item.title || "Live web result", "", {
        entityType: "knowledge",
        entityId: item.url || item.title || "",
        freshness: item.publishedAt || "live_web",
        tool: "hybrid_live_retrieval",
        url: item.url || "",
        tier: "live_web",
      }),
    );
  });

  return dedupeByKey(sources, (item) => `${item.tool}:${item.entityId || item.path || item.label}`)
    .slice(0, MAX_SOURCES);
}

function buildAnswerCardsFromToolResults(
  toolResults = {},
  context = {},
  hybridRetrieval = null,
) {
  const cards = [];

  const summaryTournament = toolResults.get_tournament_summary?.tournament;
  if (summaryTournament && context?.tournamentId) {
    const stats = toolResults.get_tournament_summary?.stats || {};
    cards.push(
      createAnswerCard("tournament", {
        title: summaryTournament.name,
        subtitle: summaryTournament.location || summaryTournament.code || "Giáº£i Ä‘áº¥u",
        badges: [summaryTournament.status, summaryTournament.eventType],
        metrics: [
          `ÄÄƒng kÃ½: ${stats.totalRegistrations || 0}`,
          `Tráº­n: ${stats.totalMatches || 0}`,
          `SÃ¢n: ${stats.totalCourts || 0}`,
          `Tiáº¿n Ä‘á»™: ${stats.progress || "0%"}`,
        ],
        description: `Tá»•ng quan nhanh cá»§a giáº£i ${summaryTournament.name}.`,
        path: `/tournament/${context.tournamentId}`,
        actions: [
          buildActionNavigation(`/tournament/${context.tournamentId}`, "Má»Ÿ giáº£i"),
          buildActionNavigation(
            `/tournament/${context.tournamentId}/schedule`,
            "Má»Ÿ lá»‹ch thi Ä‘áº¥u",
          ),
        ],
      }),
    );
  } else {
    const tournament = toolResults.search_tournaments?.tournaments?.[0];
    if (tournament?._id) {
      cards.push(
        createAnswerCard("tournament", {
          title: tournament.name,
          subtitle: tournament.location || tournament.eventType || "Giáº£i Ä‘áº¥u",
          badges: [tournament.status, tournament.eventType],
          metrics: [
            tournament.startDate ? `Báº¯t Ä‘áº§u: ${tournament.startDate}` : "",
            tournament.registrationDeadline
              ? `Háº¡n Ä‘Äƒng kÃ½: ${tournament.registrationDeadline}`
              : "",
          ],
          description: tournament.description || "",
          path: `/tournament/${tournament._id}`,
          actions: [
            buildActionNavigation(`/tournament/${tournament._id}`, "Má»Ÿ giáº£i"),
            buildOpenNewTabAction(`/tournament/${tournament._id}/schedule`, "Má»Ÿ lá»‹ch á»Ÿ tab má»›i"),
          ],
        }),
      );
    }
  }

  const progress = toolResults.get_tournament_progress;
  if (progress?.overview && context?.tournamentId) {
    cards.push(
      createAnswerCard("status_metric", {
        title: context?.pageSnapshot?.entityTitle || "Tiáº¿n Ä‘á»™ giáº£i hiá»‡n táº¡i",
        subtitle: "Tiáº¿n Ä‘á»™ thi Ä‘áº¥u",
        badges: [progress.overview.progressPercent, context?.pageType || ""],
        metrics: [
          `Tá»•ng tráº­n: ${progress.overview.total || 0}`,
          `ÄÃ£ xong: ${progress.overview.finished || 0}`,
          `Äang live: ${progress.overview.live || 0}`,
          `Chá» thi Ä‘áº¥u: ${progress.overview.pending || 0}`,
        ],
        description:
          "TÃ³m táº¯t tiáº¿n Ä‘á»™ hiá»‡n táº¡i cá»§a giáº£i, phÃ¹ há»£p cho cÃ¡c cÃ¢u há»i vá» sá»‘ tráº­n cÃ²n láº¡i hoáº·c Ä‘Ã£ hoÃ n táº¥t.",
        path: `/tournament/${context.tournamentId}/schedule`,
        actions: [
          buildActionNavigation(
            `/tournament/${context.tournamentId}/schedule`,
            "Má»Ÿ lá»‹ch thi Ä‘áº¥u",
          ),
        ],
      }),
    );
  }

  const userStats = toolResults.get_user_stats;
  if (userStats?.name) {
    cards.push(
      createAnswerCard("player", {
        title: userStats.name,
        subtitle: userStats.nickname || userStats.province || "NgÆ°á»i chÆ¡i",
        badges: [userStats.gender, userStats.province],
        metrics: [
          `ÄÃ´i: ${userStats.ratingDoubles || 0}`,
          `ÄÆ¡n: ${userStats.ratingSingles || 0}`,
          `Win rate: ${userStats.winRate || "0%"}`,
          `Giáº£i: ${userStats.totalTournaments || 0}`,
        ],
        description: `Tá»•ng ${userStats.totalMatches || 0} tráº­n, tháº¯ng ${userStats.wonMatches || 0}.`,
        path: context?.profileUserId ? `/user/${context.profileUserId}` : "",
      }),
    );
  } else {
    const user = toolResults.search_users?.users?.[0];
    if (user?._id) {
      cards.push(
        createAnswerCard("player", {
          title: user.name || user.nickname || "NgÆ°á»i chÆ¡i",
          subtitle: user.nickname || user.province || "",
          badges: [user.gender, user.province],
          metrics: [
            user.double ? `ÄÃ´i: ${user.double}` : "",
            user.single ? `ÄÆ¡n: ${user.single}` : "",
          ],
          description: user.bio || "",
          path: `/user/${user._id}`,
          actions: [buildActionNavigation(`/user/${user._id}`, "Má»Ÿ há»“ sÆ¡")],
        }),
      );
    }
  }

  const clubDetails = toolResults.get_club_details;
  if (clubDetails?.name) {
    const clubPath = clubDetails?._id || context?.clubId ? `/clubs/${clubDetails?._id || context?.clubId}` : "";
    cards.push(
      createAnswerCard("club", {
        title: clubDetails.name,
        subtitle: clubDetails.city || clubDetails.province || "CÃ¢u láº¡c bá»™",
        badges: [clubDetails.visibility, clubDetails.joinPolicy, clubDetails.isVerified ? "ÄÃ£ xÃ¡c minh" : ""],
        metrics: [
          `ThÃ nh viÃªn: ${clubDetails.memberCount || 0}`,
          `Admin: ${clubDetails.adminCount || 0}`,
          `Danh hiá»‡u: ${clubDetails.tournamentWins || 0}`,
        ],
        description: clubDetails.description || "",
        path: clubPath,
      }),
    );
  } else {
    const club = toolResults.search_clubs?.clubs?.[0];
    if (club?._id) {
      cards.push(
        createAnswerCard("club", {
          title: club.name,
          subtitle: [club.city, club.province].filter(Boolean).join(", "),
          badges: [club.joinPolicy, club.isVerified ? "ÄÃ£ xÃ¡c minh" : ""],
          metrics: [`ThÃ nh viÃªn: ${club.memberCount || 0}`],
          description: club.description || "",
          path: `/clubs/${club._id}`,
          actions: [buildActionNavigation(`/clubs/${club._id}`, "Má»Ÿ CLB")],
        }),
      );
    }
  }

  const article = toolResults.search_news?.articles?.[0];
  if (article?.slug) {
    cards.push(
      createAnswerCard("news", {
        title: article.title,
        subtitle: article.source || article.publishedAt || "Tin tá»©c",
        badges: article.tags || [],
        metrics: [article.publishedAt ? `Xuáº¥t báº£n: ${article.publishedAt}` : ""],
        description: article.summary || "",
        path: `/news/${article.slug}`,
        actions: [buildActionNavigation(`/news/${article.slug}`, "Má»Ÿ bÃ i viáº¿t")],
      }),
    );
  }

  if (!article?.slug && Array.isArray(hybridRetrieval?.items)) {
    hybridRetrieval.items.slice(0, 2).forEach((item) => {
      cards.push(
        createAnswerCard("news", {
          title: item.title,
          subtitle: item.sourceName || item.publishedAt || "Nguá»“n live",
          badges: ["live web"],
          metrics: [item.publishedAt ? `Cáº­p nháº­t: ${item.publishedAt}` : ""],
          description: item.summary || "",
          path: "",
          actions: item.url
            ? [
                createAction("open_new_tab", {
                  path: item.url,
                  label: "Má»Ÿ nguá»“n live",
                }),
              ]
            : [],
        }),
      );
    });
  }

  const liveStream = toolResults.get_live_streams?.streams?.[0];
  if (liveStream) {
    cards.push(
      createAnswerCard("live_stream", {
        title: liveStream.match?.code
          ? `Live ${liveStream.match.code}`
          : liveStream.provider || "Live stream",
        subtitle: liveStream.match?.tournament || liveStream.provider || "Trá»±c tiáº¿p",
        badges: [liveStream.status, liveStream.match?.court],
        metrics: [liveStream.startedAt ? `Báº¯t Ä‘áº§u: ${liveStream.startedAt}` : ""],
        description: liveStream.link || "",
        path: "",
        actions: liveStream.link
          ? [createAction("open_new_tab", { path: liveStream.link, label: "Má»Ÿ luá»“ng live" })]
          : [],
      }),
    );
  }

  const schedule = toolResults.get_tournament_schedule;
  if (schedule?.total) {
    cards.push(
      createAnswerCard("schedule", {
        title: "Lá»‹ch thi Ä‘áº¥u",
        subtitle: context?.pageSnapshot?.entityTitle || "Giáº£i hiá»‡n táº¡i",
        badges: [context?.pageType || "", context?.pageSection || ""],
        metrics: [
          `Tá»•ng tráº­n: ${schedule.total || 0}`,
          ...Object.entries(schedule.courtSummary || {})
            .slice(0, 2)
            .map(([court, count]) => `${court}: ${count}`),
        ],
        description: "Lá»‹ch thi Ä‘áº¥u hiá»‡n táº¡i cá»§a giáº£i hoáº·c bá»™ lá»c Ä‘ang má»Ÿ.",
        path: context?.tournamentId ? `/tournament/${context.tournamentId}/schedule` : "",
      }),
    );
  }

  const matchScore = toolResults.get_match_score_detail || toolResults.get_match_info;
  if (matchScore?.code) {
    cards.push(
      createAnswerCard("match", {
        title: `Tráº­n ${matchScore.code}`,
        subtitle: matchScore.round ? `VÃ²ng ${matchScore.round}` : matchScore.status || "Tráº­n Ä‘áº¥u",
        badges: [matchScore.status, matchScore.court || matchScore.courtLabel, matchScore.format],
        metrics: [
          matchScore.teamA ? `A: ${matchScore.teamA}` : "",
          matchScore.teamB ? `B: ${matchScore.teamB}` : "",
          Array.isArray(matchScore.games) ? `VÃ¡n: ${matchScore.games.length}` : "",
        ],
        description: Array.isArray(matchScore.games)
          ? matchScore.games
              .slice(0, 2)
              .map((game) => `VÃ¡n ${game.game}: ${game.scoreA}-${game.scoreB}`)
              .join(" â€¢ ")
          : "",
        path: context?.currentPath || "",
      }),
    );
  }

  return dedupeByKey(cards, (item) => `${item.kind}:${item.path || item.title}`)
    .filter((item) => item.title)
    .slice(0, MAX_ANSWER_CARDS);
}

function getActionsFromToolResults(toolResults = {}, context = {}) {
  const actions = [];

  const tournament = toolResults.search_tournaments?.tournaments?.[0];
  if (tournament?._id) {
    actions.push(
      buildActionNavigation(
        `/tournament/${tournament._id}`,
        `Má»Ÿ giáº£i ${tournament.name || ""}`.trim(),
      ),
    );
    actions.push(
      buildOpenNewTabAction(
        `/tournament/${tournament._id}/schedule`,
        "Má»Ÿ lá»‹ch giáº£i á»Ÿ tab má»›i",
      ),
    );
  }

  const article = toolResults.search_news?.articles?.[0];
  if (article?.slug) {
    actions.push(
      buildActionNavigation(`/news/${article.slug}`, article.title || "Má»Ÿ bÃ i viáº¿t"),
    );
  }

  const club = toolResults.search_clubs?.clubs?.[0];
  if (club?._id) {
    actions.push(
      buildActionNavigation(`/clubs/${club._id}`, club.name || "Má»Ÿ CLB"),
    );
  }

  const user = toolResults.search_users?.users?.[0];
  if (user?._id) {
    actions.push(
      buildActionNavigation(`/user/${user._id}`, user.name || "Má»Ÿ há»“ sÆ¡ VÄV"),
    );
  }

  if (String(context?.pageType || "") === "tournament_draw_live") {
    actions.push(
      createAction("set_query_param", {
        label: "Äá»•i sang sÃ¢n kháº¥u",
        description: "Chuyá»ƒn view bá»‘c thÄƒm sang sÃ¢n kháº¥u.",
        payload: { key: "view", value: "stage" },
      }),
      createAction("set_query_param", {
        label: "Äá»•i sang báº£ng",
        description: "Chuyá»ƒn view bá»‘c thÄƒm sang báº£ng.",
        payload: { key: "view", value: "board" },
      }),
      createAction("set_query_param", {
        label: "Äá»•i sang lá»‹ch sá»­",
        description: "Chuyá»ƒn view bá»‘c thÄƒm sang lá»‹ch sá»­.",
        payload: { key: "view", value: "history" },
      }),
    );
  }

  if (String(context?.pageType || "") === "my_tournaments") {
    actions.push(
      createAction("set_page_state", {
        label: "Chuyá»ƒn sang dáº¡ng tháº»",
        description: "Äá»•i trang Giáº£i cá»§a tÃ´i sang giao diá»‡n tháº».",
        payload: { key: "viewMode", value: "card" },
      }),
      createAction("set_page_state", {
        label: "Chuyá»ƒn sang dáº¡ng danh sÃ¡ch",
        description: "Äá»•i trang Giáº£i cá»§a tÃ´i sang giao diá»‡n danh sÃ¡ch.",
        payload: { key: "viewMode", value: "list" },
      }),
      createAction("prefill_text", {
        label: "Äiá»n nhanh Ã´ tÃ¬m giáº£i",
        description: "Äiá»n sáºµn tá»« khÃ³a vÃ o Ã´ tÃ¬m giáº£i.",
        payload: {
          handlerKey: "search",
          selector:
            'input[placeholder*=\"giáº£i\"], input[placeholder*=\"TÃ¬m\"], input[name=\"search\"]',
        },
      }),
    );
  }

  return actions;
}

function clientSupportsAction(context = {}, action = {}) {
  const keys = new Set(
    Array.isArray(context?.capabilityKeys)
      ? context.capabilityKeys.map((item) => String(item || "").toLowerCase())
      : [],
  );
  if (!keys.size) return true;

  switch (action?.type) {
    case "set_page_state":
      return keys.has("set_page_state");
    case "set_query_param":
      return keys.has("set_query_param");
    case "prefill_text":
      return keys.has("prefill_text") || keys.has("set_page_state");
    case "open_dialog":
      return keys.has("open_dialog");
    case "focus_element":
      return keys.has("focus_element");
    case "scroll_to_section":
      return keys.has("scroll_to_section") || keys.has("focus_element");
    case "copy_current_url":
    case "copy_link":
      return keys.has("copy_link") || keys.has("copy");
    case "copy_text":
      return keys.has("copy_text") || keys.has("copy");
    case "open_new_tab":
      return keys.has("open_new_tab") || keys.has("navigate");
    case "navigate":
      return keys.has("navigate") || keys.has("open_new_tab");
    default:
      return true;
  }
}

function prioritizeSuggestedActions(actions = [], context = {}) {
  const pageActions = [];
  const navigationActions = [];
  const utilityActions = [];

  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action?.type || !clientSupportsAction(context, action)) continue;

    if (["set_page_state", "set_query_param", "prefill_text", "open_dialog"].includes(action.type)) {
      pageActions.push(action);
      continue;
    }
    if (["navigate", "open_new_tab"].includes(action.type)) {
      navigationActions.push(action);
      continue;
    }
    utilityActions.push(action);
  }

  return [...pageActions, ...utilityActions, ...navigationActions];
}

function buildContextActions(context = {}) {
  const actions = [];

  if (context?.currentUrl) {
    actions.push(
      createAction("copy_current_url", {
        label: "Sao chÃ©p link trang nÃ y",
        value: context.currentUrl,
      }),
    );
    actions.push(
      buildOpenNewTabAction(context.currentPath || context.currentUrl, "Má»Ÿ trang nÃ y á»Ÿ tab má»›i"),
    );
  }

  actions.push(
    createAction("focus_element", {
      label: "Focus Ã´ tÃ¬m kiáº¿m",
      description: "ÄÆ°a con trá» tá»›i Ã´ tÃ¬m kiáº¿m gáº§n nháº¥t trÃªn trang.",
      payload: {
        selector:
          'input[type=\"search\"], input[placeholder*=\"TÃ¬m\"], input[placeholder*=\"Search\"], input[name=\"search\"]',
      },
    }),
  );

  if (context?.tournamentId) {
    actions.push(
      buildActionNavigation(
        `/tournament/${context.tournamentId}/schedule`,
        "Má»Ÿ lá»‹ch thi Ä‘áº¥u",
      ),
      buildActionNavigation(
        `/tournament/${context.tournamentId}/bracket`,
        "Má»Ÿ nhÃ¡nh Ä‘áº¥u",
      ),
    );

    if (String(context.pageType || "").startsWith("tournament_draw_live")) {
      actions.push(
        buildActionNavigation(
          `/tournament/${context.tournamentId}/draw/live?view=stage`,
          "Má»Ÿ sÃ¢n kháº¥u bá»‘c thÄƒm",
        ),
        buildActionNavigation(
          `/tournament/${context.tournamentId}/draw/live?view=board`,
          "Má»Ÿ báº£ng bá»‘c thÄƒm",
        ),
        buildActionNavigation(
          `/tournament/${context.tournamentId}/draw/live?view=history`,
          "Má»Ÿ lá»‹ch sá»­ bá»‘c thÄƒm",
        ),
      );
    }
  }

  if (String(context?.pageType || "") === "tournament_schedule") {
    actions.push(
      createAction("scroll_to_section", {
        label: "Cuá»™n tá»›i lá»‹ch thi Ä‘áº¥u",
        description: "Cuá»™n tá»›i khu vá»±c lá»‹ch thi Ä‘áº¥u Ä‘ang hiá»ƒn thá»‹.",
        payload: {
          selector:
            '[data-chatbot-section=\"schedule\"], [data-chatbot-page-title], main',
        },
      }),
    );
  }

  if (String(context?.pageType || "") === "club_list") {
    actions.push(
      createAction("set_page_state", {
        label: "Xem táº¥t cáº£ CLB",
        description: "Chuyá»ƒn danh sÃ¡ch CLB sang tab táº¥t cáº£.",
        payload: { key: "tab", value: "all" },
      }),
      createAction("set_page_state", {
        label: "Xem CLB cá»§a tÃ´i",
        description: "Chuyá»ƒn danh sÃ¡ch CLB sang tab CLB cá»§a tÃ´i.",
        payload: { key: "tab", value: "mine" },
      }),
      createAction("prefill_text", {
        label: "Äiá»n Ã´ tÃ¬m CLB",
        description: "Äiá»n sáºµn tá»« khÃ³a vÃ o Ã´ tÃ¬m cÃ¢u láº¡c bá»™.",
        payload: {
          handlerKey: "search",
          selector:
            'input[placeholder*=\"CLB\"], input[placeholder*=\"TÃ¬m\"], input[name=\"search\"]',
        },
      }),
      createAction("open_dialog", {
        label: "Má»Ÿ form táº¡o CLB",
        description: "Má»Ÿ nhanh há»™p thoáº¡i táº¡o cÃ¢u láº¡c bá»™ má»›i trÃªn trang nÃ y.",
        payload: {
          handlerKey: "openDialog",
          value: "createClub",
        },
      }),
    );
  }

  if (context?.clubId) {
    actions.push(
      buildActionNavigation(`/clubs/${context.clubId}`, "Má»Ÿ CLB hiá»‡n táº¡i"),
      buildActionNavigation(`/clubs/${context.clubId}?tab=events`, "Má»Ÿ sá»± kiá»‡n CLB"),
    );
  }

  if (context?.newsSlug) {
    actions.push(
      buildActionNavigation(`/news/${context.newsSlug}`, "Má»Ÿ bÃ i viáº¿t hiá»‡n táº¡i"),
      buildActionNavigation("/news", "Má»Ÿ danh sÃ¡ch tin tá»©c"),
    );
  }

  return actions;
}

function buildSuggestedActions(route, context, execution = {}) {
  const actionPool = [
    ...(execution?.navigation?.webPath
      ? [
          buildActionNavigation(
            execution.navigation.webPath,
            execution.navigation.description || "Má»Ÿ trang liÃªn quan",
          ),
        ]
      : []),
    ...getActionsFromToolResults(execution?.toolResults, context),
    ...buildContextActions(context),
  ];

  return prioritizeSuggestedActions(
    actionPool
    .filter((action) => action?.type)
    .filter((action, index, list) => {
      const key = `${action.type}:${action.path || action.value || action.label || ""}`;
      return list.findIndex(
        (candidate) =>
          `${candidate.type}:${candidate.path || candidate.value || candidate.label || ""}` ===
          key,
      ) === index;
    })
    .slice(0, MAX_ACTIONS),
    context,
  );
}

function needsTrustDisclaimer(route, execution = {}, sources = [], answerCards = []) {
  if (!route?.kind) return false;
  if (["direct", "general", "navigate"].includes(route.kind)) return false;
  if (!Array.isArray(execution.toolsUsed) || execution.toolsUsed.length === 0) {
    return false;
  }
  return (!Array.isArray(sources) || sources.length === 0) &&
    (!Array.isArray(answerCards) || answerCards.length === 0);
}

function hasNegativeAvailabilityClaim(normalizedReply) {
  return (
    normalizedReply.includes("khong co") ||
    normalizedReply.includes("chua co") ||
    normalizedReply.includes("chua thay")
  );
}

function hasPositiveAvailabilityClaim(normalizedReply) {
  return (
    normalizedReply.includes("hien co") ||
    normalizedReply.includes("dang co") ||
    normalizedReply.includes("tim thay")
  );
}

function getPrimaryGroundedCountDescriptor(route, execution = {}) {
  if (route?.kind === "tournament") {
    const result = execution?.toolResults?.search_tournaments;
    if (result && Array.isArray(result.tournaments)) {
      const status = String(route?.toolPlan?.[0]?.args?.status || "");
      return {
        count: Number(result.count) || result.tournaments.length || 0,
        label: `giáº£i ${formatTournamentStatusLabel(status)}`,
        samples: result.tournaments
          .map((item) => trimText(item?.name || "", 120))
          .filter(Boolean)
          .slice(0, 3),
      };
    }
  }

  if (route?.kind === "club") {
    const result = execution?.toolResults?.search_clubs;
    if (result && Array.isArray(result.clubs)) {
      return {
        count: Number(result.count) || result.clubs.length || 0,
        label: "cÃ¢u láº¡c bá»™ phÃ¹ há»£p",
        samples: result.clubs
          .map((item) => trimText(item?.name || "", 120))
          .filter(Boolean)
          .slice(0, 3),
      };
    }
  }

  if (route?.kind === "news") {
    const result = execution?.toolResults?.search_news;
    if (result && Array.isArray(result.articles)) {
      return {
        count: Number(result.total) || result.articles.length || 0,
        label: "bÃ i viáº¿t phÃ¹ há»£p",
        samples: result.articles
          .map((item) => trimText(item?.title || "", 120))
          .filter(Boolean)
          .slice(0, 3),
      };
    }
  }

  if (route?.kind === "player") {
    const result = execution?.toolResults?.search_users;
    if (result && Array.isArray(result.users)) {
      return {
        count: Number(result.count) || result.users.length || 0,
        label: "ngÆ°á»i chÆ¡i phÃ¹ há»£p",
        samples: result.users
          .map((item) => trimText(item?.name || item?.nickname || "", 120))
          .filter(Boolean)
          .slice(0, 3),
      };
    }
  }

  if (route?.kind === "live") {
    const result = execution?.toolResults?.get_live_matches;
    if (result && Array.isArray(result.matches)) {
      return {
        count: Number(result.total) || result.matches.length || 0,
        label: "tráº­n Ä‘ang live",
        samples: result.matches
          .map((item) => trimText(item?.title || item?.matchName || "", 120))
          .filter(Boolean)
          .slice(0, 3),
      };
    }
  }

  return null;
}

function applyGroundedCountConsistency(reply, route, execution = {}) {
  const descriptor = getPrimaryGroundedCountDescriptor(route, execution);
  if (!descriptor) {
    return {
      reply: String(reply || "").trim(),
      guardApplied: false,
    };
  }

  const text = String(reply || "").trim();
  const normalizedReply = sharedNormalizeText(text);
  const count = Number(descriptor.count || 0);

  if (count > 0 && hasNegativeAvailabilityClaim(normalizedReply)) {
    let nextReply = `Hiá»‡n cÃ³ ${count} ${descriptor.label}.`;
    if (descriptor.samples?.length) {
      nextReply += ` VÃ­ dá»¥: ${descriptor.samples.join(", ")}.`;
    }
    return {
      reply: nextReply,
      guardApplied: nextReply !== text,
    };
  }

  if (count === 0 && hasPositiveAvailabilityClaim(normalizedReply)) {
    const nextReply = `Hiá»‡n táº¡i mÃ¬nh chÆ°a tháº¥y ${descriptor.label} trong dá»¯ liá»‡u há»‡ thá»‘ng.`;
    return {
      reply: nextReply,
      guardApplied: nextReply !== text,
    };
  }

  return {
    reply: text,
    guardApplied: false,
  };
}

function applyTrustGuard(reply, route, execution = {}, sources = [], answerCards = []) {
  const consistency = applyGroundedCountConsistency(reply, route, execution);
  const text = String(consistency.reply || "").trim();
  if (!text) {
    return {
      reply: text,
      guardApplied: Boolean(consistency.guardApplied),
    };
  }
  if (!needsTrustDisclaimer(route, execution, sources, answerCards)) {
    return {
      reply: text,
      guardApplied: Boolean(consistency.guardApplied),
    };
  }
  if (sharedNormalizeText(text).includes("khong du du lieu")) {
    return {
      reply: text,
      guardApplied: Boolean(consistency.guardApplied),
    };
  }
  return {
    reply: `${text}\n\nLÆ°u Ã½: MÃ¬nh chÆ°a cÃ³ Ä‘á»§ dá»¯ liá»‡u xÃ¡c minh tá»« há»‡ thá»‘ng Ä‘á»ƒ kháº³ng Ä‘á»‹nh chi tiáº¿t hÆ¡n. Náº¿u báº¡n muá»‘n, mÃ¬nh cÃ³ thá»ƒ má»Ÿ Ä‘Ãºng trang liÃªn quan hoáº·c thá»­ truy váº¥n láº¡i cá»¥ thá»ƒ hÆ¡n.`,
    guardApplied: true,
  };
}

async function executeToolPlan({ route, context, safeEmit }) {
  const toolPlan = Array.isArray(route.toolPlan)
    ? route.toolPlan.slice(0, MAX_TOOL_BATCH)
    : [];
  const toolResults = {};
  const toolSummary = [];
  let navigation = null;

  for (const step of toolPlan) {
    const executor = TOOL_EXECUTORS[step.name];
    if (typeof executor !== "function") continue;

    const resolvedArgs = resolvePlanArgs(step.args || {}, toolResults, context);
    if (hasMissingPlaceholder(step.args || {}, resolvedArgs)) {
      continue;
    }

    const label = SHARED_TOOL_LABELS[step.name] || step.name;
    const startedAt = Date.now();
    safeEmit("tool_start", {
      tool: step.name,
      label,
      args: resolvedArgs,
    });

    try {
      const result = await executor(resolvedArgs, context);
      toolResults[step.name] = result;
      const preview = sharedBuildToolPreview(step.name, result);
      const summary = {
        tool: step.name,
        label,
        resultPreview: preview,
        durationMs: Date.now() - startedAt,
        error: Boolean(result?.error),
      };
      toolSummary.push(summary);
      safeEmit("tool_done", {
        tool: step.name,
        label,
        resultPreview: preview,
        durationMs: summary.durationMs,
        error: summary.error,
      });

      if (step.captureNavigation && result?.webPath) {
        navigation = result;
      }
    } catch (error) {
      const summary = {
        tool: step.name,
        label,
        resultPreview: `Lá»—i: ${error.message}`,
        durationMs: Date.now() - startedAt,
        error: true,
      };
      toolSummary.push(summary);
      safeEmit("tool_done", {
        tool: step.name,
        label,
        resultPreview: "Lá»—i khi xá»­ lÃ½",
        durationMs: summary.durationMs,
        error: true,
      });
      toolResults[step.name] = { error: error.message };
    }
  }

  return {
    toolResults,
    toolSummary,
    toolsUsed: toolSummary.map((item) => item.tool),
    navigation,
  };
}

function resolvePlanArgs(args, toolResults, context) {
  const resolved = {};
  for (const [key, value] of Object.entries(args || {})) {
    const nextValue = resolvePlaceholder(value, toolResults, context);
    if (nextValue !== undefined && nextValue !== "") {
      resolved[key] = nextValue;
    }
  }
  return resolved;
}

function resolvePlaceholder(value, toolResults, context) {
  if (value === FIRST_TOURNAMENT_ID) {
    return (
      toolResults.search_tournaments?.tournaments?.[0]?._id ||
      context?.tournamentId ||
      undefined
    );
  }
  if (value === FIRST_CLUB_ID) {
    return toolResults.search_clubs?.clubs?.[0]?._id || undefined;
  }
  return value;
}

function hasMissingPlaceholder(originalArgs, resolvedArgs) {
  for (const value of Object.values(originalArgs || {})) {
    if (value === FIRST_TOURNAMENT_ID && !resolvedArgs.tournamentId) return true;
    if (value === FIRST_CLUB_ID && !resolvedArgs.clubId) return true;
  }
  return false;
}

function buildToolPreview(tool, result) {
  if (!result) return "KhÃ´ng cÃ³ káº¿t quáº£";
  if (result.error) return `Lá»—i: ${result.error}`;

  switch (tool) {
    case "search_knowledge":
      return result.count
        ? `TÃ¬m tháº¥y ${result.count} má»¥c kiáº¿n thá»©c`
        : "KhÃ´ng tÃ¬m tháº¥y thÃ´ng tin";
    case "search_tournaments":
      return result.count
        ? `TÃ¬m tháº¥y ${result.count} giáº£i Ä‘áº¥u`
        : "KhÃ´ng tÃ¬m tháº¥y giáº£i nÃ o";
    case "get_tournament_summary":
      return result.tournament?.name
        ? `${result.tournament.name} â€¢ ${result.stats?.totalRegistrations || 0} Ä‘á»™i`
        : "ÄÃ£ láº¥y tá»•ng quan giáº£i";
    case "get_tournament_schedule":
      return result.total
        ? `${result.total} tráº­n trong lá»‹ch`
        : "KhÃ´ng cÃ³ lá»‹ch thi Ä‘áº¥u";
    case "get_tournament_rules":
      return result.total
        ? `${result.total} báº£ng cÃ³ luáº­t thi Ä‘áº¥u`
        : "ÄÃ£ láº¥y luáº­t";
    case "get_tournament_brackets":
      return result.total != null ? `${result.total} báº£ng Ä‘áº¥u` : "ÄÃ£ láº¥y báº£ng Ä‘áº¥u";
    case "get_tournament_registrations":
      return result.totalRegistrations != null
        ? `${result.totalRegistrations} Ä‘á»™i Ä‘Äƒng kÃ½`
        : "ÄÃ£ láº¥y Ä‘á»™i Ä‘Äƒng kÃ½";
    case "get_tournament_courts":
      return result.total != null ? `${result.total} sÃ¢n Ä‘áº¥u` : "ÄÃ£ láº¥y sÃ¢n Ä‘áº¥u";
    case "get_draw_results":
      return result.total
        ? `${result.total} káº¿t quáº£ bá»‘c thÄƒm`
        : "ChÆ°a cÃ³ káº¿t quáº£ bá»‘c thÄƒm";
    case "search_users":
      return result.count ? `TÃ¬m tháº¥y ${result.count} VÄV` : "KhÃ´ng tÃ¬m tháº¥y VÄV";
    case "get_user_stats":
      return result.name
        ? `${result.name} â€¢ ${result.winRate || "0%"} win rate`
        : "ÄÃ£ láº¥y thá»‘ng kÃª VÄV";
    case "get_my_info":
      return result.name
        ? `ÄÃ£ láº¥y há»“ sÆ¡ cá»§a ${result.name}`
        : "ÄÃ£ láº¥y thÃ´ng tin cÃ¡ nhÃ¢n";
    case "get_my_registrations":
      return result.count != null ? `${result.count} Ä‘Äƒng kÃ½` : "ÄÃ£ láº¥y Ä‘Äƒng kÃ½ cá»§a báº¡n";
    case "get_my_rating_changes":
      return result.count != null
        ? `${result.count} biáº¿n Ä‘á»™ng rating`
        : "ÄÃ£ láº¥y lá»‹ch sá»­ rating";
    case "get_upcoming_matches":
      return result.total != null ? `${result.total} tráº­n sáº¯p tá»›i` : "ÄÃ£ láº¥y lá»‹ch thi Ä‘áº¥u";
    case "get_login_history":
      return result.lastLogin ? `Láº§n Ä‘Äƒng nháº­p cuá»‘i ${result.lastLogin}` : "ÄÃ£ láº¥y lá»‹ch sá»­ Ä‘Äƒng nháº­p";
    case "get_my_devices":
      return result.total != null ? `${result.total} thiáº¿t bá»‹` : "ÄÃ£ láº¥y thiáº¿t bá»‹";
    case "search_clubs":
      return result.count ? `TÃ¬m tháº¥y ${result.count} CLB` : "KhÃ´ng tÃ¬m tháº¥y CLB";
    case "get_club_details":
      return result.name
        ? `${result.name} â€¢ ${result.memberCount || 0} thÃ nh viÃªn`
        : "ÄÃ£ láº¥y chi tiáº¿t CLB";
    case "search_news":
      return result.total ? `${result.total} bÃ i viáº¿t` : "KhÃ´ng tÃ¬m tháº¥y bÃ i viáº¿t";
    case "navigate":
      return result.description || "ÄÃ£ chuáº©n bá»‹ Ä‘iá»u hÆ°á»›ng";
    case "get_leaderboard":
      return result.players?.length
        ? `${result.players.length} VÄV trÃªn BXH`
        : "ÄÃ£ láº¥y báº£ng xáº¿p háº¡ng";
    default:
      return "HoÃ n táº¥t";
  }
}

function shouldUseReasoner(message, route, execution) {
  const normalized = sharedNormalizeText(message);
  if (
    hasAny(normalized, [
      "táº¡i sao",
      "vÃ¬ sao",
      "so sÃ¡nh",
      "khÃ¡c nhau",
      "phÃ¢n tÃ­ch",
      "giáº£i thÃ­ch",
      "káº¿ hoáº¡ch",
      "nÃªn ",
      "Ä‘Ã¡nh giÃ¡",
      "strategy",
      "chiáº¿n thuáº­t",
      "tá»‘i Æ°u",
      "plan",
    ])
  ) {
    return true;
  }

  if (route.kind === "general" && message.length > 120) return true;
  if (execution.toolSummary.length >= 2) return true;
  if (route.kind === "player" && hasAny(normalized, ["so sÃ¡nh", "compare"])) {
    return true;
  }
  return false;
}

function buildSynthesisMessages({
  message,
  route,
  context,
  memory,
  userProfile,
  personalization,
  execution,
}) {
  const genericKnowledgeQuestion = looksLikeGenericKnowledgeQuestion(message);
  const densityInstruction =
    personalization?.preferredAnswerDensity === "compact_operator"
      ? "Æ¯u tiÃªn cÃ¢u tráº£ lá»i ngáº¯n, thao tÃ¡c trÆ°á»›c, giáº£i thÃ­ch sau. Náº¿u cÃ³ bÆ°á»›c tiáº¿p theo rÃµ rÃ ng thÃ¬ nÃªu trong 1-2 bullet Ä‘áº§u tiÃªn."
      : "Giá»¯ cÃ¢u tráº£ lá»i cÃ¢n báº±ng: ngáº¯n gá»n nhÆ°ng váº«n Ä‘á»§ Ã½ Ä‘á»ƒ ngÆ°á»i dÃ¹ng hiá»ƒu nhanh.";
  const pageAwareInstruction =
    context?.pageType?.startsWith("tournament_") ||
    context?.pageType?.startsWith("admin_") ||
    context?.pageType?.startsWith("live_")
      ? "Náº¿u Ä‘ang á»Ÿ má»™t mÃ n thao tÃ¡c cá»¥ thá»ƒ, Æ°u tiÃªn nÃ³i Ä‘Ãºng theo mÃ n hiá»‡n táº¡i vÃ  gá»£i Ã½ bÆ°á»›c káº¿ tiáº¿p cÃ³ thá»ƒ báº¥m ngay."
      : "";
  const systemPrompt = [
    "Báº¡n lÃ  Pikora, trá»£ lÃ½ PickleTour.",
    "Tráº£ lá»i gá»n, chÃ­nh xÃ¡c, tá»± nhiÃªn.",
    "Náº¿u ngÆ°á»i dÃ¹ng dÃ¹ng tiáº¿ng Anh thÃ¬ tráº£ lá»i tiáº¿ng Anh, cÃ²n láº¡i dÃ¹ng tiáº¿ng Viá»‡t.",
    "Chá»‰ dÃ¹ng dá»¯ liá»‡u Ä‘Ã£ xÃ¡c minh trong pháº§n káº¿t quáº£ cÃ´ng cá»¥ khi cÃ¢u há»i cáº§n dá»¯ liá»‡u cá»¥ thá»ƒ.",
    "Náº¿u dá»¯ liá»‡u thiáº¿u hoáº·c khÃ´ng tháº¥y, nÃ³i rÃµ vÃ  gá»£i Ã½ bÆ°á»›c tiáº¿p theo.",
    "Náº¿u cÃ³ sá»‘ liá»‡u hoáº·c thá»±c thá»ƒ cá»¥ thá»ƒ mÃ  khÃ´ng cÃ³ dá»¯ liá»‡u xÃ¡c minh Ä‘á»§ cháº¯c, pháº£i nÃ³i rÃµ lÃ  chÆ°a Ä‘á»§ dá»¯ liá»‡u xÃ¡c minh thay vÃ¬ kháº³ng Ä‘á»‹nh nhÆ° fact.",
    "KhÃ´ng nháº¯c tá»›i JSON, model, proxy hay ná»™i bá»™ há»‡ thá»‘ng.",
    "KhÃ´ng in raw <think> trong cÃ¢u tráº£ lá»i cuá»‘i.",
    "Náº¿u cÃ³ navigation, cÃ³ thá»ƒ nÃ³i ráº±ng Ä‘Ã£ chuáº©n bá»‹ nÃºt má»Ÿ Ä‘Ãºng trang.",
    genericKnowledgeQuestion
      ? "Vá»›i cÃ¢u há»i kiáº¿n thá»©c chung, hÃ£y tráº£ lá»i trá»±c tiáº¿p ná»™i dung cáº§n biáº¿t. KhÃ´ng chuyá»ƒn sang Ä‘iá»u hÆ°á»›ng theo trang hiá»‡n táº¡i trá»« khi ngÆ°á»i dÃ¹ng yÃªu cáº§u rÃµ."
      : "",
    "DÃ¹ng markdown nháº¹: bullet hoáº·c báº£ng khi cÃ³ Ã­ch, trÃ¡nh dÃ i dÃ²ng.",
    densityInstruction,
    pageAwareInstruction,
  ].join("\n");

  const contextSummary = buildContextSummary(context, userProfile);
  const pageSnapshotSummary = buildPageSnapshotSummary(context);
  const personalizationSummary = buildPersonalizationSummary(personalization);
  const toolContext = buildToolContext(
    execution.toolResults,
    execution.hybridRetrieval,
  );

  return [
    { role: "system", content: systemPrompt },
    ...trimMemory(memory),
    {
      role: "user",
      content: [
        `CÃ¢u há»i hiá»‡n táº¡i: ${message}`,
        contextSummary ? `Ngá»¯ cáº£nh hiá»‡n táº¡i:\n${contextSummary}` : "",
        pageSnapshotSummary ? `áº¢nh chá»¥p giao diá»‡n hiá»‡n táº¡i:\n${pageSnapshotSummary}` : "",
        personalizationSummary
          ? `TÃ­n hiá»‡u cÃ¡ nhÃ¢n hÃ³a:\n${personalizationSummary}`
          : "",
        `Loáº¡i yÃªu cáº§u: ${route.kind}`,
        toolContext
          ? `Dá»¯ liá»‡u Ä‘Ã£ xÃ¡c minh:\n${toolContext}`
          : "Dá»¯ liá»‡u Ä‘Ã£ xÃ¡c minh: KhÃ´ng cÃ³ tool nÃ o Ä‘Æ°á»£c dÃ¹ng.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

function legacyBuildContextSummary(context, userProfile) {
  const parts = [];
  if (userProfile) {
    parts.push(
      `NgÆ°á»i dÃ¹ng: ${userProfile.name}${userProfile.nickname ? ` (${userProfile.nickname})` : ""}, rating ${userProfile.rating}, khu vá»±c ${userProfile.province || "N/A"}.`,
    );
  }
  if (context.currentPath) parts.push(`ÄÆ°á»ng dáº«n hiá»‡n táº¡i: ${context.currentPath}`);
  if (context.tournamentId) parts.push(`ID giáº£i hiá»‡n táº¡i: ${context.tournamentId}`);
  if (context.matchId) parts.push(`ID tráº­n hiá»‡n táº¡i: ${context.matchId}`);
  if (context.bracketId) parts.push(`ID nhÃ¡nh hiá»‡n táº¡i: ${context.bracketId}`);
  if (context.courtCode) parts.push(`SÃ¢n hiá»‡n táº¡i: ${context.courtCode}`);
  return parts.join("\n");
}

function trimMemory(memory) {
  return (memory || []).slice(-MEMORY_LIMIT).map((item) => ({
    role: item.role,
    content: String(item.content || "")
      .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
      .slice(0, 500),
  }));
}

function buildContextSummary(context, userProfile) {
  const parts = [];
  const PAGE_LABELS = {
    home: "trang chá»§",
    tournament_list: "danh sÃ¡ch giáº£i Ä‘áº¥u",
    tournament_registration: "trang Ä‘Äƒng kÃ½ giáº£i hiá»‡n táº¡i",
    tournament_checkin: "trang check-in giáº£i hiá»‡n táº¡i",
    tournament_bracket: "trang nhÃ¡nh Ä‘áº¥u cá»§a giáº£i hiá»‡n táº¡i",
    tournament_schedule: "trang lá»‹ch thi Ä‘áº¥u cá»§a giáº£i hiá»‡n táº¡i",
    tournament_admin_draw: "trang admin bá»‘c thÄƒm cá»§a bracket hiá»‡n táº¡i",
    tournament_draw_live: "trang bá»‘c thÄƒm trá»±c tiáº¿p",
    tournament_draw_manage: "khÃ´ng gian lÃ m viá»‡c bá»‘c thÄƒm cá»§a giáº£i hiá»‡n táº¡i",
    tournament_manage: "khÃ´ng gian quáº£n lÃ½ giáº£i hiá»‡n táº¡i",
    tournament_overview: "trang tá»•ng quan giáº£i hiá»‡n táº¡i",
    news_list: "trang tin tá»©c",
    news_detail: "trang bÃ i viáº¿t hiá»‡n táº¡i",
    club_list: "trang danh sÃ¡ch cÃ¢u láº¡c bá»™",
    club_detail: "trang cÃ¢u láº¡c bá»™ hiá»‡n táº¡i",
    live_clusters: "trang live tá»•ng",
    live_studio: "trang studio trá»±c tiáº¿p",
    court_streaming: "trang phÃ¡t trá»±c tiáº¿p sÃ¢n",
    court_live_studio: "trang studio sÃ¢n Ä‘áº¥u hiá»‡n táº¡i",
    admin_users: "trang admin quáº£n lÃ½ ngÆ°á»i dÃ¹ng",
    admin_news: "trang admin quáº£n lÃ½ tin tá»©c",
    admin_avatar_optimization: "trang admin tá»‘i Æ°u avatar",
    profile: "trang há»“ sÆ¡ cá»§a báº¡n",
    public_profile: "trang há»“ sÆ¡ cÃ´ng khai",
    my_tournaments: "trang giáº£i cá»§a tÃ´i",
    leaderboard: "trang báº£ng xáº¿p háº¡ng",
    contact: "trang liÃªn há»‡",
    status: "trang tráº¡ng thÃ¡i há»‡ thá»‘ng",
  };

  if (userProfile) {
    parts.push(
      `NgÆ°á»i dÃ¹ng: ${userProfile.name}${userProfile.nickname ? ` (${userProfile.nickname})` : ""}, rating ${userProfile.rating}, khu vá»±c ${userProfile.province || "N/A"}.`,
    );
  }
  if (context.pageType) {
    parts.push(
      `Äang á»Ÿ ${PAGE_LABELS[context.pageType] || `trang ${context.pageType}`}.`,
    );
  }
  if (context.pageTitle) {
    parts.push(`TiÃªu Ä‘á» trang: ${sanitizePageTitle(context.pageTitle)}.`);
  }
  if (context.pageSection) parts.push(`Khu vá»±c hiá»‡n táº¡i: ${context.pageSection}.`);
  if (context.pageView) parts.push(`Cháº¿ Ä‘á»™ xem hiá»‡n táº¡i: ${context.pageView}.`);
  if (context.adminSection) {
    parts.push(`Má»¥c admin hiá»‡n táº¡i: ${context.adminSection}.`);
  }
  if (context.currentPath) parts.push(`ÄÆ°á»ng dáº«n hiá»‡n táº¡i: ${context.currentPath}`);
  if (context.tournamentId) {
    parts.push(`ID giáº£i hiá»‡n táº¡i: ${context.tournamentId}`);
  }
  if (context.matchId) parts.push(`ID tráº­n hiá»‡n táº¡i: ${context.matchId}`);
  if (context.bracketId) parts.push(`ID nhÃ¡nh hiá»‡n táº¡i: ${context.bracketId}`);
  if (context.clubId) parts.push(`ID CLB hiá»‡n táº¡i: ${context.clubId}`);
  if (context.newsSlug) parts.push(`Slug bÃ i viáº¿t hiá»‡n táº¡i: ${context.newsSlug}`);
  if (context.profileUserId) {
    parts.push(`ID há»“ sÆ¡ hiá»‡n táº¡i: ${context.profileUserId}`);
  }
  if (context.courtCode) parts.push(`SÃ¢n hiá»‡n táº¡i: ${context.courtCode}`);
  if (context.courtId) parts.push(`ID sÃ¢n hiá»‡n táº¡i: ${context.courtId}`);
  return parts.join("\n");
}

function buildToolContext(toolResults, hybridRetrieval = null) {
  const sections = [];
  for (const [toolName, result] of Object.entries(toolResults || {})) {
    if (!result) continue;
    sections.push(`### ${toolName}\n${safeSerialize(result)}`);
  }
  if (Array.isArray(hybridRetrieval?.items) && hybridRetrieval.items.length) {
    sections.push(
      `### hybrid_live_retrieval\n${safeSerialize({
        retrievalMode: hybridRetrieval.retrievalMode || "hybrid_live",
        items: hybridRetrieval.items,
      })}`,
    );
  }
  return truncate(sections.join("\n\n"), MAX_TOOL_CONTEXT_CHARS);
}

function safeSerialize(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...`;
}

async function fetchUserProfile(userId) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId)
      .select("name nickname localRatings province")
      .lean();
    if (!user) return null;
    return {
      name: user.name,
      nickname: user.nickname,
      rating: user.localRatings?.doubles || 2.5,
      province: user.province,
    };
  } catch {
    return null;
  }
}

async function streamDeepSeekSynthesis({
  model,
  messages,
  safeEmit,
  startTime,
  signal,
  state,
}) {
  if (!CHAT_COMPLETIONS_URL) {
    throw new Error(
      "Thiáº¿u PIKORA_BASE_URL cho Pikora (hoáº·c fallback CLIPROXY_BASE_URL)",
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  let userAborted = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PROXY_TIMEOUT_MS);

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      const error = new Error("Request aborted");
      error.name = "AbortError";
      throw error;
    }
    signal.addEventListener(
      "abort",
      () => {
        userAborted = true;
        controller.abort();
      },
      { once: true },
    );
  }

  const responseText = {
    reply: "",
    rawThinking: "",
    hadOutput: false,
  };

  safeEmit("message_start", {
    model,
    mode: model === REASONER_MODEL ? "reasoner" : "chat",
  });

  const thinkParser = createThinkParser({
    onReasoningStart: () => {
      if (!state.reasoningStarted) {
        state.reasoningStarted = true;
        safeEmit("reasoning_start", { model });
      }
    },
    onReasoningDelta: (delta) => {
      if (!delta) return;
      responseText.hadOutput = true;
      responseText.rawThinking += delta;
      if (state.firstTokenLatencyMs == null) {
        state.firstTokenLatencyMs = Date.now() - startTime;
      }
      safeEmit("reasoning_delta", { delta });
    },
    onReasoningDone: () => {
      if (!state.reasoningDone) {
        state.reasoningDone = true;
        safeEmit("reasoning_done", {});
      }
    },
    onMessageDelta: (delta) => {
      if (!delta) return;
      responseText.hadOutput = true;
      responseText.reply += delta;
      if (state.firstTokenLatencyMs == null) {
        state.firstTokenLatencyMs = Date.now() - startTime;
      }
      safeEmit("message_delta", { delta });
    },
  });

  try {
    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(PROXY_API_KEY ? { Authorization: `Bearer ${PROXY_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(body || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const dataLine = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s*/, ""))
          .join("\n")
          .trim();

        if (!dataLine) continue;
        if (dataLine === "[DONE]") {
          thinkParser.flush();
          return {
            reply: responseText.reply.trim(),
            rawThinking: responseText.rawThinking.trim(),
            firstTokenLatencyMs: state.firstTokenLatencyMs,
            model,
            mode: model === REASONER_MODEL ? "reasoner" : "chat",
          };
        }

        let parsed;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }

        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          thinkParser.feed(delta);
        }
      }
    }

    thinkParser.flush();

    return {
      reply: responseText.reply.trim(),
      rawThinking: responseText.rawThinking.trim(),
      firstTokenLatencyMs: state.firstTokenLatencyMs,
      model,
      mode: model === REASONER_MODEL ? "reasoner" : "chat",
    };
  } catch (error) {
    error.partialOutput = responseText.hadOutput;
    if (userAborted || isAbortError(error)) {
      const abortError = new Error(userAborted ? "Request aborted by user" : "Request aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    if (timedOut) {
      error.message = `Timeout sau ${Math.round(PROXY_TIMEOUT_MS / 1000)}s`;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createThinkParser({
  onReasoningStart,
  onReasoningDelta,
  onReasoningDone,
  onMessageDelta,
}) {
  let mode = "message";
  let carry = "";

  const process = (incoming) => {
    let text = carry + String(incoming || "");
    carry = "";

    while (text.length > 0) {
      if (mode === "message") {
        const openIndex = text.indexOf("<think>");
        if (openIndex === -1) {
          if (looksLikePartialTag(text)) {
            carry = text;
          } else {
            onMessageDelta(text);
          }
          break;
        }

        if (openIndex > 0) {
          onMessageDelta(text.slice(0, openIndex));
        }
        text = text.slice(openIndex + "<think>".length);
        if (text.startsWith("\n")) text = text.slice(1);
        mode = "reasoning";
        onReasoningStart();
        continue;
      }

      const closeIndex = text.indexOf("</think>");
      if (closeIndex === -1) {
        if (looksLikePartialTag(text, true)) {
          carry = text;
        } else {
          onReasoningDelta(text);
        }
        break;
      }

      if (closeIndex > 0) {
        onReasoningDelta(text.slice(0, closeIndex));
      }
      text = text.slice(closeIndex + "</think>".length);
      if (text.startsWith("\n\n")) text = text.slice(2);
      else if (text.startsWith("\n")) text = text.slice(1);
      mode = "message";
      onReasoningDone();
    }
  };

  return {
    feed: process,
    flush() {
      if (!carry) return;
      if (mode === "reasoning") onReasoningDelta(carry);
      else onMessageDelta(carry);
      carry = "";
      if (mode === "reasoning") {
        mode = "message";
        onReasoningDone();
      }
    },
  };
}

function looksLikePartialTag(text, closing = false) {
  const tag = closing ? "</think>" : "<think>";
  for (let index = 1; index < tag.length; index += 1) {
    if (tag.startsWith(text.slice(-index))) {
      return true;
    }
  }
  return false;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function buildEnhancedSuggestions(route, context, userId, personalization) {
  const pageType = context?.pageType || "";
  const suggestions = [];

  if (pageType === "tournament_registration") {
    suggestions.push(
      "Giáº£i nÃ y cÃ²n bao nhiÃªu tráº­n?",
      "CÃ³ bao nhiÃªu Ä‘á»™i Ä‘Ã£ thanh toÃ¡n?",
      "Focus Ã´ tÃ¬m kiáº¿m VÄV",
    );
  } else if (pageType === "tournament_schedule") {
    suggestions.push(
      "Giáº£i nÃ y cÃ²n bao nhiÃªu tráº­n?",
      "Lá»c cÃ¡c tráº­n live",
      "Má»Ÿ nhÃ¡nh Ä‘áº¥u",
    );
  } else if (pageType === "tournament_manage") {
    suggestions.push(
      "Tiáº¿n Ä‘á»™ giáº£i nÃ y",
      "Ai Ä‘ang quáº£n lÃ½ giáº£i nÃ y?",
      "Má»Ÿ lá»‹ch thi Ä‘áº¥u",
    );
  } else if (pageType === "news_detail") {
    suggestions.push(
      "BÃ i nÃ y nÃ³i gÃ¬?",
      "Nguá»“n cá»§a bÃ i nÃ y lÃ  gÃ¬?",
      "TÃ³m táº¯t bÃ i nÃ y",
    );
  } else if (pageType === "admin_users") {
    suggestions.push("TÃ¬m user theo tÃªn", "Lá»c theo role", "Focus Ã´ tÃ¬m user");
  } else if (pageType === "admin_news") {
    suggestions.push(
      "TÃ¬m bÃ i viáº¿t theo tiÃªu Ä‘á»",
      "Lá»c bÃ i chÆ°a xuáº¥t báº£n",
      "Táº¡o bÃ i viáº¿t má»›i",
    );
  } else if (pageTypeStartsWith(context, "tournament_draw_live")) {
    suggestions.push(
      "Xem báº£ng bá»‘c thÄƒm",
      "Xem lá»‹ch sá»­ bá»‘c thÄƒm",
      "TÃ³m táº¯t lÆ°á»£t bá»‘c gáº§n nháº¥t",
    );
  }

  if (context?.clubId) {
    suggestions.push("ThÃ nh viÃªn CLB nÃ y", "Sá»± kiá»‡n CLB nÃ y", "ThÃ´ng bÃ¡o CLB nÃ y");
  }

  if (personalization?.preferredAnswerDensity === "compact_operator") {
    suggestions.push("Má»Ÿ Ä‘Ãºng trang nÃ y", "Copy link trang nÃ y");
  }
  if (personalization?.likelyRole === "admin") {
    suggestions.push("Má»Ÿ admin users", "Má»Ÿ admin news");
  }
  if (personalization?.interests?.includes("giáº£i Ä‘áº¥u") && !context?.tournamentId) {
    suggestions.push("TÃ¬m giáº£i á»Ÿ HÃ  Ná»™i", "Giáº£i nÃ o sáº¯p diá»…n ra?", "Má»Ÿ giáº£i cá»§a tÃ´i");
  }
  if (personalization?.interests?.includes("phÃ¢n tÃ­ch VÄV")) {
    suggestions.push(
      "So sÃ¡nh 2 VÄV",
      "Báº£ng xáº¿p háº¡ng hiá»‡n táº¡i",
      userId ? "Rating cá»§a tÃ´i lÃ  bao nhiÃªu?" : "Há»“ sÆ¡ ngÆ°á»i chÆ¡i nÃ y",
    );
  }

  return sharedCompactList(suggestions);
}

function generateSuggestions(route, context, execution, userId, personalization) {
  const enhancedSuggestions = buildEnhancedSuggestions(
    route,
    context,
    userId,
    personalization,
  );
  if (enhancedSuggestions.length >= 3) {
    return enhancedSuggestions;
  }
  const pageAwareSuggestions =
    context?.pageType === "status"
      ? ["API nÃ o Ä‘ang cháº­m?", "Worker nÃ o Ä‘ang lá»—i?", "Storage cÃ³ á»•n khÃ´ng?"]
      : pageTypeStartsWith(context, "tournament_draw_live")
        ? ["Xem báº£ng bá»‘c thÄƒm", "Xem lá»‹ch sá»­ bá»‘c thÄƒm", "TÃ³m táº¯t lÆ°á»£t bá»‘c gáº§n nháº¥t"]
        : context?.clubId
          ? ["ThÃ nh viÃªn CLB nÃ y", "Sá»± kiá»‡n CLB nÃ y", "ThÃ´ng bÃ¡o CLB nÃ y"]
          : [];

  const personalized =
    personalization?.interests?.includes("giáº£i Ä‘áº¥u") && !context?.tournamentId
      ? ["TÃ¬m giáº£i á»Ÿ HÃ  Ná»™i", "Giáº£i nÃ o sáº¯p diá»…n ra?", "Má»Ÿ giáº£i cá»§a tÃ´i"]
      : personalization?.interests?.includes("phÃ¢n tÃ­ch VÄV")
        ? ["So sÃ¡nh 2 VÄV", "Báº£ng xáº¿p háº¡ng hiá»‡n táº¡i", "Há»“ sÆ¡ ngÆ°á»i chÆ¡i nÃ y"]
        : [];

  switch (route.kind) {
    case "personal":
      return sharedCompactList([
        "Rating cá»§a tÃ´i lÃ  bao nhiÃªu?",
        "Tráº­n sáº¯p tá»›i cá»§a tÃ´i",
        "Giáº£i cá»§a tÃ´i",
        ...pageAwareSuggestions,
      ]);
    case "tournament":
      return sharedCompactList([
        context.tournamentId ? "Lá»‹ch thi Ä‘áº¥u giáº£i nÃ y" : "Giáº£i nÃ o sáº¯p diá»…n ra?",
        context.tournamentId ? "Luáº­t cá»§a giáº£i nÃ y" : "TÃ¬m giáº£i á»Ÿ HÃ  Ná»™i",
        context.tournamentId ? "CÃ³ bao nhiÃªu Ä‘á»™i Ä‘Äƒng kÃ½?" : "NhÃ¡nh Ä‘áº¥u cá»§a giáº£i nÃ y",
        ...pageAwareSuggestions,
      ]);
    case "club":
      return sharedCompactList([
        "CLB nÃ y cÃ³ bao nhiÃªu thÃ nh viÃªn?",
        "CÃ³ sá»± kiá»‡n CLB nÃ o sáº¯p tá»›i?",
        "CÃ¡ch tham gia CLB nÃ y",
        ...pageAwareSuggestions,
      ]);
    case "player":
      return sharedCompactList([
        "Báº£ng xáº¿p háº¡ng hiá»‡n táº¡i",
        "So sÃ¡nh 2 VÄV",
        userId ? "Rating cá»§a tÃ´i lÃ  bao nhiÃªu?" : "TÃ¬m VÄV á»Ÿ HÃ  Ná»™i",
        ...pageAwareSuggestions,
      ]);
    case "news":
      return sharedCompactList([
        "Tin má»›i nháº¥t vá» pickleball",
        "CÃ³ bÃ i nÃ o vá» chiáº¿n thuáº­t khÃ´ng?",
        "Giáº£i nÃ o Ä‘ang hot?",
        ...pageAwareSuggestions,
      ]);
    case "live":
      return sharedCompactList([
        context.matchId ? "Tá»· sá»‘ tráº­n nÃ y ra sao?" : "CÃ³ nhá»¯ng tráº­n nÃ o Ä‘ang live?",
        context.matchId ? "Diá»…n biáº¿n tráº­n nÃ y" : "Luá»“ng live nÃ o Ä‘ang hoáº¡t Ä‘á»™ng?",
        context.tournamentId ? "Tiáº¿n Ä‘á»™ giáº£i nÃ y" : "Live studio Ä‘ang má»Ÿ á»Ÿ Ä‘Ã¢u?",
        ...pageAwareSuggestions,
      ]);
    case "knowledge":
      return sharedCompactList([
        "Luáº­t giao bÃ³ng pickleball lÃ  gÃ¬?",
        "CÃ¡ch tÃ­nh Ä‘iá»ƒm nhÆ° tháº¿ nÃ o?",
        "HÆ°á»›ng dáº«n Ä‘Äƒng kÃ½ giáº£i",
        ...pageAwareSuggestions,
      ]);
    case "navigate":
      return sharedCompactList([
        "Má»Ÿ báº£ng xáº¿p háº¡ng",
        "Má»Ÿ giáº£i cá»§a tÃ´i",
        "Tin má»›i nháº¥t",
        ...pageAwareSuggestions,
      ]);
    default:
      return sharedCompactList([
        "Giáº£i nÃ o sáº¯p diá»…n ra?",
        userId ? "Rating cá»§a tÃ´i lÃ  bao nhiÃªu?" : "CÃ¡ch Ä‘Äƒng kÃ½ tÃ i khoáº£n",
        "Tin má»›i nháº¥t",
        ...pageAwareSuggestions,
        ...personalized,
      ]);
  }
}

const TOOL_LABELS = {
  search_knowledge: "Tra cá»©u kiáº¿n thá»©c",
  search_tournaments: "TÃ¬m giáº£i",
  get_tournament_summary: "Tá»•ng quan giáº£i",
  get_tournament_schedule: "Lá»‹ch thi Ä‘áº¥u",
  get_tournament_rules: "Luáº­t thi Ä‘áº¥u",
  get_tournament_brackets: "NhÃ¡nh Ä‘áº¥u",
  get_tournament_registrations: "ÄÄƒng kÃ½ giáº£i",
  get_tournament_courts: "SÃ¢n Ä‘áº¥u",
  get_draw_results: "Bá»‘c thÄƒm",
  search_users: "TÃ¬m VÄV",
  get_user_stats: "Thá»‘ng kÃª VÄV",
  get_my_info: "ThÃ´ng tin cá»§a tÃ´i",
  get_my_registrations: "Giáº£i cá»§a tÃ´i",
  get_my_rating_changes: "Biáº¿n Ä‘á»™ng rating",
  get_upcoming_matches: "Tráº­n sáº¯p tá»›i",
  get_login_history: "Lá»‹ch sá»­ Ä‘Äƒng nháº­p",
  get_my_devices: "Thiáº¿t bá»‹ cá»§a tÃ´i",
  search_clubs: "TÃ¬m CLB",
  get_club_details: "Chi tiáº¿t CLB",
  search_news: "Tin tá»©c",
  navigate: "Äiá»u hÆ°á»›ng",
  get_leaderboard: "Báº£ng xáº¿p háº¡ng",
};

const NAVIGATION_SCREENS = {
  login: {
    screen: "Login",
    deepLink: "pickletour://login",
    webPath: "/login",
    description: "ÄÄƒng nháº­p",
  },
  register: {
    screen: "Register",
    deepLink: "pickletour://register",
    webPath: "/register",
    description: "ÄÄƒng kÃ½ tÃ i khoáº£n",
  },
  forgot_password: {
    screen: "ForgotPassword",
    deepLink: "pickletour://forgot-password",
    webPath: "/forgot-password",
    description: "QuÃªn máº­t kháº©u",
  },
  profile: {
    screen: "Profile",
    deepLink: "pickletour://profile",
    webPath: "/profile",
    description: "Trang cÃ¡ nhÃ¢n",
  },
  leaderboard: {
    screen: "Leaderboard",
    deepLink: "pickletour://rankings",
    webPath: "/pickle-ball/rankings",
    description: "Báº£ng xáº¿p háº¡ng",
  },
  my_tournaments: {
    screen: "MyTournaments",
    deepLink: "pickletour://my-tournaments",
    webPath: "/my-tournaments",
    description: "Giáº£i cá»§a tÃ´i",
  },
  tournament_list: {
    screen: "TournamentList",
    deepLink: "pickletour://tournaments",
    webPath: "/pickle-ball/tournaments",
    description: "Danh sÃ¡ch giáº£i Ä‘áº¥u",
  },
  clubs: {
    screen: "Clubs",
    deepLink: "pickletour://clubs",
    webPath: "/clubs",
    description: "Danh sÃ¡ch cÃ¢u láº¡c bá»™",
  },
  club_detail: {
    screen: "ClubDetail",
    deepLink: "pickletour://clubs/{clubId}",
    webPath: "/clubs/{clubId}",
    description: "Chi tiáº¿t cÃ¢u láº¡c bá»™",
  },
  live_matches: {
    screen: "LiveMatches",
    deepLink: "pickletour://live",
    webPath: "/live",
    description: "Tráº­n Ä‘áº¥u Ä‘ang live",
  },
  home: {
    screen: "Home",
    deepLink: "pickletour://home",
    webPath: "/",
    description: "Trang chá»§",
  },
  kyc: {
    screen: "KYC",
    deepLink: "pickletour://kyc",
    webPath: "/kyc",
    description: "XÃ¡c thá»±c danh tÃ­nh",
  },
  level_point: {
    screen: "LevelPoint",
    deepLink: "pickletour://levelpoint",
    webPath: "/levelpoint",
    description: "Äiá»ƒm trÃ¬nh Ä‘á»™",
  },
  news_list: {
    screen: "NewsList",
    deepLink: "pickletour://news",
    webPath: "/news",
    description: "Tin tá»©c PickleTour",
  },
  news_detail: {
    screen: "NewsDetail",
    deepLink: "pickletour://news/{newsSlug}",
    webPath: "/news/{newsSlug}",
    description: "Chi tiáº¿t bÃ i viáº¿t",
  },
  bracket: {
    screen: "Bracket",
    deepLink: "pickletour://bracket/{tournamentId}",
    webPath: "/tournament/{tournamentId}/bracket",
    description: "SÆ¡ Ä‘á»“ nhÃ¡nh Ä‘áº¥u",
  },
  schedule: {
    screen: "Schedule",
    deepLink: "pickletour://schedule/{tournamentId}",
    webPath: "/tournament/{tournamentId}/schedule",
    description: "Lá»‹ch thi Ä‘áº¥u",
  },
  registration: {
    screen: "Registration",
    deepLink: "pickletour://register/{tournamentId}",
    webPath: "/tournament/{tournamentId}/register",
    description: "ÄÄƒng kÃ½ giáº£i Ä‘áº¥u",
  },
  tournament_overview: {
    screen: "TournamentOverview",
    deepLink: "pickletour://tournament/{tournamentId}/overview",
    webPath: "/tournament/{tournamentId}/overview",
    description: "Tá»•ng quan giáº£i Ä‘áº¥u",
  },
  draw: {
    screen: "Draw",
    deepLink: "pickletour://tournament/{tournamentId}/draw",
    webPath: "/tournament/{tournamentId}/draw",
    description: "Bá»‘c thÄƒm",
  },
  draw_live: {
    screen: "DrawLive",
    deepLink: "pickletour://tournament/{tournamentId}/draw/live",
    webPath: "/tournament/{tournamentId}/draw/live",
    description: "SÃ¢n kháº¥u bá»‘c thÄƒm trá»±c tiáº¿p",
  },
  draw_live_board: {
    screen: "DrawLiveBoard",
    deepLink: "pickletour://tournament/{tournamentId}/draw/live?view=board",
    webPath: "/tournament/{tournamentId}/draw/live?view=board",
    description: "Báº£ng bá»‘c thÄƒm trá»±c tiáº¿p",
  },
  draw_live_history: {
    screen: "DrawLiveHistory",
    deepLink: "pickletour://tournament/{tournamentId}/draw/live?view=history",
    webPath: "/tournament/{tournamentId}/draw/live?view=history",
    description: "Lá»‹ch sá»­ bá»‘c thÄƒm trá»±c tiáº¿p",
  },
  tournament_detail: {
    screen: "TournamentDetail",
    deepLink: "pickletour://tournament/{tournamentId}",
    webPath: "/tournament/{tournamentId}",
    description: "Chi tiáº¿t giáº£i Ä‘áº¥u",
  },
};

