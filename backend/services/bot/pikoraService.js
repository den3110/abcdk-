import fetch from "node-fetch";
import { TOOL_EXECUTORS } from "./tools/index.js";
import { getRecentMessages } from "./memoryService.js";
import { maybeLearn } from "./learningService.js";
import {
  buildToolPreview as sharedBuildToolPreview,
  compactList as sharedCompactList,
  extractEntityName as sharedExtractEntityName,
  extractPairNames as sharedExtractPairNames,
  fetchUserProfile as sharedFetchUserProfile,
  normalizeText as sharedNormalizeText,
  TOOL_LABELS as SHARED_TOOL_LABELS,
} from "./runtimeShared.js";

const CHAT_MODEL = String(process.env.BOT_MODEL || "deepseek-chat").trim();
const REASONER_MODEL = String(
  process.env.BOT_REASONER_MODEL || "deepseek-reasoner",
).trim();
const PROXY_BASE_URL = String(process.env.CLIPROXY_BASE_URL || "").replace(
  /\/+$/,
  "",
);
const PROXY_API_KEY = String(
  process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY || "",
).trim();
const CHAT_COMPLETIONS_URL = PROXY_BASE_URL
  ? `${PROXY_BASE_URL}/chat/completions`
  : "";
const PROXY_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(120_000, Number(process.env.BOT_PROXY_TIMEOUT_MS || 45_000)),
);
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
const routeDecisionCache = new Map();
const toolExecutionCache = new Map();

export const BOT_IDENTITY = {
  name: "Pikora",
  nameVi: "Pikora - Trợ lý PickleTour",
  version: "4.1",
  engine: "deepseek-proxy-orchestrator-v3",
  personality: ["Nhanh", "Thân thiện", "Chính xác", "Ngắn gọn"],
};

const EXTRA_NAVIGATION_SCREENS = {
  tournament_manage: {
    screen: "TournamentManage",
    deepLink: "pickletour://tournament/{tournamentId}/manage",
    webPath: "/tournament/{tournamentId}/manage",
    description: "Quản lý giải đấu",
  },
  tournament_checkin: {
    screen: "TournamentCheckin",
    deepLink: "pickletour://tournament/{tournamentId}/checkin",
    webPath: "/tournament/{tournamentId}/checkin",
    description: "Check-in giải đấu",
  },
  admin_users: {
    screen: "AdminUsers",
    deepLink: "pickletour://admin/users",
    webPath: "/admin/users",
    description: "Quản lý người dùng",
  },
  admin_news: {
    screen: "AdminNews",
    deepLink: "pickletour://admin/news",
    webPath: "/admin/news",
    description: "Quản lý tin tức",
  },
  admin_avatar_optimization: {
    screen: "AdminAvatarOptimization",
    deepLink: "pickletour://admin/avatar-optimization",
    webPath: "/admin/avatar-optimization",
    description: "Tối ưu avatar",
  },
};

export function getChatCapabilities() {
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
  };
}

function trimText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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
  };
}

function compactText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
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
    interests.push("giải đấu");
  }
  if (hasAny(joinedMemory, ["news", "tin tuc", "chien thuat", "luat"])) {
    interests.push("nội dung kiến thức");
  }
  if (hasAny(joinedMemory, ["club", "clb", "cau lac bo"])) {
    interests.push("câu lạc bộ");
  }
  if (hasAny(joinedMemory, ["rating", "xep hang", "vdv", "nguoi choi"])) {
    interests.push("phân tích VĐV");
  }
  if (context?.pageType?.startsWith("tournament_")) {
    interests.push("điều hướng theo giải hiện tại");
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
  if (snapshot.entityTitle) parts.push(`Tiêu đề chính: ${snapshot.entityTitle}.`);
  if (snapshot.sectionTitle) parts.push(`Mục đang mở: ${snapshot.sectionTitle}.`);
  if (snapshot.pageSummary) parts.push(`Mô tả ngắn: ${snapshot.pageSummary}`);
  if (snapshot.activeLabels?.length) {
    parts.push(`Tab hoặc trạng thái nổi bật: ${snapshot.activeLabels.join(", ")}.`);
  }
  if (snapshot.visibleActions?.length) {
    parts.push(`Các thao tác đang thấy trên màn: ${snapshot.visibleActions.join(", ")}.`);
  }
  if (snapshot.highlights?.length) {
    parts.push(`Dấu hiệu nổi bật trên trang: ${snapshot.highlights.join(", ")}.`);
  }
  if (snapshot.metrics?.length) {
    parts.push(`Chỉ số đang hiển thị: ${snapshot.metrics.join(", ")}.`);
  }
  return parts.join("\n");
}

function buildPersonalizationSummary(personalization) {
  if (!personalization) return "";
  const parts = [];
  if (personalization.province) {
    parts.push(`Khu vực người dùng quan tâm nhiều: ${personalization.province}.`);
  }
  if (personalization.rating) {
    parts.push(`Rating đôi hiện tại của người dùng khoảng ${personalization.rating}.`);
  }
  if (personalization.interests?.length) {
    parts.push(`Các nhóm chủ đề người dùng hay hỏi: ${personalization.interests.join(", ")}.`);
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

  let confidenceLevel = "fast";
  let confidenceLabel = "Phản hồi nhanh";
  let explanation =
    "Câu trả lời này thiên về điều hướng hoặc gợi ý thao tác nhanh.";

  if (grounded) {
    confidenceLevel = toolCount > 1 ? "strong" : "grounded";
    confidenceLabel =
      toolCount > 1 ? "Đã đối chiếu nguồn thật" : "Có nguồn dữ liệu thật";
    explanation =
      sourceCount > 1
        ? `Mình đang bám ${sourceCount} nguồn dữ liệu thật từ hệ thống hoặc nội dung đã tra cứu.`
        : "Mình đang bám một nguồn dữ liệu thật từ hệ thống hoặc nội dung đã tra cứu.";
  } else if (needsDisclaimer) {
    confidenceLevel = "limited";
    confidenceLabel = "Cần kiểm tra thêm";
    explanation =
      "Câu trả lời này có dùng tool nhưng chưa đủ nguồn grounded để khẳng định mạnh như fact.";
  } else if (toolCount > 0 || cardCount > 0) {
    confidenceLevel = "assisted";
    confidenceLabel = "Có dữ liệu hỗ trợ";
    explanation =
      "Câu trả lời này có tham chiếu dữ liệu hỗ trợ, nhưng chưa đủ mạnh để xem như đối chiếu nguồn đầy đủ.";
  }

  if (reasoned && grounded) {
    explanation = `${explanation} Pikora có dùng suy luận để tổng hợp các nguồn này.`;
  } else if (reasoned) {
    explanation = `${explanation} Pikora cũng đã dùng suy luận để nối các tín hiệu liên quan.`;
  }

  return {
    grounded,
    reasoned,
    actionable,
    sourceCount,
    cardCount,
    actionCount,
    needsDisclaimer,
    confidenceLevel,
    confidenceLabel,
    explanation,
  };
}

function buildContextInsight(context, route, personalization, execution) {
  const parts = [];
  if (context?.pageType) {
    parts.push(`Mình đang bám theo ngữ cảnh ${context.pageType.replaceAll("_", " ")}.`);
  }
  if (context?.pageSnapshot?.sectionTitle) {
    parts.push(`Phần đang mở là "${context.pageSnapshot.sectionTitle}".`);
  } else if (context?.pageSnapshot?.activeLabels?.length) {
    parts.push(`Màn hiện tại đang nổi bật: ${context.pageSnapshot.activeLabels.slice(0, 2).join(", ")}.`);
  }
  if (execution?.toolSummary?.length > 0) {
    parts.push(`Mình đã dùng ${execution.toolSummary.length} bước tra cứu để trả lời chính xác hơn.`);
  }
  if (personalization?.province) {
    parts.push(`Mình cũng ưu tiên ngữ cảnh theo khu vực ${personalization.province}.`);
  }
  if (personalization?.interests?.length) {
    parts.push(`Mình đang ưu tiên các chủ đề bạn hay hỏi như ${personalization.interests.join(", ")}.`);
  }
  if (!parts.length && route?.kind) {
    parts.push(`Mình đang xử lý theo loại yêu cầu: ${route.kind}.`);
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
  const routeThinking = (step) => safeEmit("thinking", { step });
  const state = createStreamState();
  const initialInsight = buildContextInsight(context, null, null, null);

  routeThinking("Đang hiểu yêu cầu...");
  if (context?.pageSnapshot || context?.pageType) {
    routeThinking("Đang đọc ngữ cảnh trang hiện tại...");
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

  if (route.directResponse) {
    return finalizeDirectResponse({
      safeEmit,
      route,
      context,
      contextInsight: initialInsight,
      startTime,
    });
  }

  routeThinking("Đang tải ngữ cảnh hội thoại...");
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
      ? "Đang suy luận để soạn câu trả lời..."
      : "Đang soạn câu trả lời...",
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
        routeThinking("Reasoner đang chậm, chuyển sang trả lời nhanh...");
        continue;
      }
      throw error;
    }
  }

  if (!result) {
    throw lastError || new Error("Không nhận được phản hồi từ AI");
  }

  const processingTime = Date.now() - startTime;
  const sources = buildSourcesFromToolResults(execution.toolResults, context);
  const answerCards = buildAnswerCardsFromToolResults(execution.toolResults, context);
  const finalReply = applyTrustGuard(
    result.reply ||
      "Xin lỗi, mình chưa tổng hợp được câu trả lời rõ ràng. Bạn thử hỏi lại ngắn hơn nhé.",
    route,
    execution,
    sources,
    answerCards,
  );
  const finalResult = {
    reply: finalReply,
    intent: inferIntent(message, route, context, execution),
    routeKind: route.kind || "direct",
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
  });
  finalResult.capabilityKeys = buildCapabilityKeys(route, context, finalResult);

  safeEmit("message_done", {
    text: finalResult.reply,
    intent: finalResult.intent,
    routeKind: finalResult.routeKind,
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
    firstTokenLatencyMs: finalResult.firstTokenLatencyMs,
    processingTimeMs: finalResult.processingTimeMs,
    toolSummary: finalResult.toolSummary,
  });
  safeEmit("reply", {
    text: finalResult.reply,
    intent: finalResult.intent,
    routeKind: finalResult.routeKind,
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
  });
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
    firstTokenLatencyMs: 0,
    processingTimeMs: result.processingTimeMs,
    toolSummary: [],
  });
  safeEmit("reply", {
    text: result.reply,
    intent: result.intent,
    routeKind: result.routeKind,
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
    toolSummary: [],
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
  return keywords.some((keyword) =>
    normalized.includes(sharedNormalizeText(keyword)),
  );
}

function isQuestionLike(normalized) {
  return hasAny(normalized, [
    "gì",
    "là gì",
    "không",
    "bao nhiêu",
    "thế nào",
    "sao",
    "tại sao",
    "vì sao",
    "nào",
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
    "trang này",
    "mục này",
    "tab này",
    "view này",
    "màn này",
    "ở đây",
    "hiện tại",
    "bài này",
    "tin này",
    "giải này",
    "clb này",
    "trận này",
    "sân này",
    "nhánh này",
    "bảng này",
    "club này",
    "news này",
    "live này",
  ]);
}

function addContextualKeywords(normalized, context) {
  const shouldBoost =
    isCurrentContextReference(normalized) ||
    (String(normalized || "").split(/\s+/).filter(Boolean).length <= 6 &&
      Boolean(
        context?.tournamentId ||
          context?.clubId ||
          context?.newsSlug ||
          context?.matchId ||
          context?.profileUserId ||
          context?.pageSnapshot,
      ));
  if (!shouldBoost) return normalized;

  const hints = [];

  if (context?.tournamentId || pageTypeStartsWith(context, "tournament_")) {
    hints.push("giải", "tournament");
    if (pageTypeStartsWith(context, "tournament_registration")) {
      hints.push("đăng ký");
    }
    if (pageTypeStartsWith(context, "tournament_schedule")) {
      hints.push("lịch thi đấu", "schedule");
    }
    if (pageTypeStartsWith(context, "tournament_bracket")) {
      hints.push("nhánh đấu", "bracket");
    }
    if (
      pageTypeStartsWith(context, "tournament_draw_live") ||
      pageTypeStartsWith(context, "tournament_draw_manage") ||
      pageTypeStartsWith(context, "tournament_admin_draw")
    ) {
      hints.push("bốc thăm", "draw");
    }
    if (pageTypeStartsWith(context, "tournament_manage")) {
      hints.push("quản lý", "manage");
    }
    if (pageTypeStartsWith(context, "tournament_checkin")) {
      hints.push("checkin");
    }
  }

  if (pageTypeStartsWith(context, "club_") || context?.clubId) {
    hints.push("clb", "câu lạc bộ", "club");
    if (context?.clubTab === "events" || context?.pageSection === "events") {
      hints.push("sự kiện", "events");
    }
    if (context?.clubTab === "polls" || context?.pageSection === "polls") {
      hints.push("bình chọn", "polls");
    }
    if (context?.clubTab === "news" || context?.pageSection === "news") {
      hints.push("tin tức", "thông báo");
    }
  }

  if (pageTypeStartsWith(context, "news_") || context?.newsSlug) {
    hints.push("tin tức", "news", "bài viết");
  }

  if (
    pageTypeStartsWith(context, "live_") ||
    pageTypeStartsWith(context, "court_") ||
    context?.matchId ||
    context?.courtId
  ) {
    hints.push("live", "trực tiếp", "trận", "sân", "streaming");
  }

  if (pageTypeStartsWith(context, "admin_") || context?.adminSection) {
    hints.push("admin", "quản lý");
    if (context?.adminSection === "news") hints.push("tin tức", "news");
    if (context?.adminSection === "users") {
      hints.push("người dùng", "user");
    }
  }

  if (
    context?.pageType === "profile" ||
    context?.pageType === "public_profile" ||
    context?.profileUserId
  ) {
    hints.push("hồ sơ", "player", "người chơi");
  }

  hints.push(...getPageSnapshotSignals(context));

  return sharedNormalizeText(`${normalized} ${hints.join(" ")}`);
}

function sanitizePageTitle(value) {
  return String(value || "")
    .replace(/\s*[\-|–|—]\s*PickleTour.*$/i, "")
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
      return "sắp diễn ra";
    case "ongoing":
      return "đang diễn ra";
    case "finished":
      return "đã kết thúc";
    default:
      return "hiện tại";
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
    label: `Chuyển sang tab ${formatTournamentStatusLabel(status)}`,
    description: `Đổi danh sách giải đấu sang trạng thái ${formatTournamentStatusLabel(status)}.`,
    payload: {
      key: "tab",
      handlerKey: "tab",
      value: status,
    },
  });
}

function buildTournamentListDirectRoute(normalized, context = {}) {
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

  const requestedStatus = pickTournamentStatus(normalized) || pageState.currentTab;
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
      reply = `Ngay trên tab "${currentLabel}", mình đang thấy ${requestedCount} giải ${requestedLabel}.`;
      if (visibleNames.length) {
        reply += ` Ví dụ đang hiện ${visibleNames.slice(0, 3).join(", ")}.`;
      }
    } else {
      reply = `Theo dữ liệu đang hiển thị trên trang này, hiện có ${requestedCount} giải ${requestedLabel}. Tab bạn đang mở là "${currentLabel}".`;
    }
  } else if (requestedStatus === currentStatus && visibleNames.length) {
    reply = `Ngay trên tab "${currentLabel}", mình vẫn đang thấy ${visibleNames.length} giải hiện trên màn hình, gồm ${visibleNames.slice(0, 3).join(", ")}.`;
  } else {
    reply = `Theo bộ lọc hiện tại trên trang này, mình chưa thấy giải ${requestedLabel}. Tab đang mở là "${currentLabel}".`;
  }

  if (pageState.keyword) {
    reply += ` Lưu ý là danh sách đang có bộ lọc tìm kiếm "${pageState.keyword}".`;
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
        requestedStatus === "ongoing" ? "Tiến độ giải này thế nào?" : "",
        requestedStatus === "ongoing" ? "Mở lịch thi đấu" : "",
        requestedStatus !== "ongoing" ? "Chuyển sang tab đang diễn ra" : "",
        "Focus ô tìm kiếm",
      ].filter(Boolean),
    },
  };
}

function classifyRoute(message, context, userId) {
  const normalized = sharedNormalizeText(message);
  const boostedNormalized = addContextualKeywords(normalized, context);
  const entityName = sharedExtractEntityName(message);
  const tournamentListDirectRoute = buildTournamentListDirectRoute(
    boostedNormalized,
    context,
  );

  if (tournamentListDirectRoute) {
    return tournamentListDirectRoute;
  }

  if (
    hasAny(normalized, ["xin chao", "hello", "hi ", "hey", "chao pikora"])
  ) {
    return {
      kind: "direct",
      directResponse: {
        reply:
          "Xin chào 👋 Mình là Pikora. Bạn cứ hỏi về giải đấu, VĐV, CLB, luật chơi hoặc bảo mình mở đúng trang trong app nhé.",
        suggestions: [
          "Giải nào sắp diễn ra?",
          "Rating của tôi là bao nhiêu?",
          "Mở bảng xếp hạng",
        ],
      },
    };
  }

  if (hasAny(normalized, ["cảm ơn", "thanks", "thank you"])) {
    return {
      kind: "direct",
      directResponse: {
        reply: "Không có gì 😄 Nếu cần mình tra tiếp hoặc mở đúng trang cho bạn luôn nhé.",
        suggestions: [
          "Giải của tôi",
          "Lịch thi đấu giải này",
          "Tin mới nhất",
        ],
      },
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
    hasAny(boostedNormalized, ["của tôi", "tôi", "mình", "my "]) &&
    hasAny(boostedNormalized, [
      "rating",
      "hồ sơ",
      "thông tin",
      "giải của tôi",
      "đăng ký",
      "trận sắp tới",
      "lịch sử đăng nhập",
      "thiết bị",
      "biến động",
    ]);

  if (wantsOwnInfo) {
    if (!userId) {
      return {
        kind: "direct",
        directResponse: {
          reply:
            "Bạn cần đăng nhập trước để mình tra thông tin cá nhân chính xác. Mình đã chuẩn bị nút mở trang đăng nhập cho bạn.",
          navigation: buildNavigation("login", context),
          suggestions: [
            "Cách đăng ký tài khoản",
            "Quên mật khẩu thì làm sao?",
            "Giải nào sắp diễn ra?",
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
    hasAny(boostedNormalized, [
      "luật",
      "hướng dẫn",
      "cách ",
      "faq",
      "giải thích",
      "pickleball là gì",
      "đăng ký tài khoản",
      "quên mật khẩu",
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

  if (hasAny(boostedNormalized, ["tin tức", "news", "bài viết"])) {
    return {
      kind: "news",
      entityName,
      toolPlan: buildNewsToolPlan(message, boostedNormalized, entityName, context),
    };
  }

  if (hasAny(boostedNormalized, ["clb", "câu lạc bộ", "club"])) {
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
      "người chơi",
      "player",
      "rating",
      "xếp hạng",
      "so sánh",
      "hồ sơ",
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
    hasAny(boostedNormalized, ["live", "trực tiếp", "streaming"]) &&
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
      "nhánh đấu",
      "bracket",
      "lịch thi đấu",
      "đăng ký",
      "bốc thăm",
      "sân",
      "giải này",
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

function detectNavigationRoute(message, normalized, context) {
  const wantsNavigation = hasAny(normalized, [
    "mở ",
    "vào ",
    "đi tới",
    "đến ",
    "go to",
    "open ",
    "truy cập",
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
  const tournamentSpecificScreen = hasAny(normalized, ["nhánh đấu", "bracket", "sơ đồ"])
    ? "bracket"
    : hasAny(normalized, ["lịch thi đấu", "lịch giải"])
      ? "schedule"
      : hasAny(normalized, ["đăng ký giải"])
        ? "registration"
        : hasAny(normalized, ["quản lý giải", "manage"])
          ? "tournament_manage"
          : hasAny(normalized, ["check in", "checkin"])
            ? "tournament_checkin"
            : hasAny(normalized, [
                "sân khấu bốc thăm",
                "draw live",
                "bốc thăm live",
              ])
              ? "draw_live"
              : hasAny(normalized, ["lịch sử bốc thăm", "draw history"])
                ? "draw_live_history"
                : hasAny(normalized, ["bảng bốc thăm", "draw board"])
                  ? "draw_live_board"
        : hasAny(normalized, ["tổng quan"])
          ? "tournament_overview"
          : hasAny(normalized, ["bốc thăm", "draw"])
            ? "draw"
            : hasAny(normalized, [
                "chi tiết giải",
                "giải này",
                "giải hiện tại",
              ])
              ? "tournament_detail"
              : "";

  if (tournamentSpecificScreen) {
    if (context.tournamentId) {
      return {
        screen: tournamentSpecificScreen,
        tournamentId: context.tournamentId,
        reply: "Mình đã chuẩn bị nút mở đúng trang của giải hiện tại cho bạn.",
        suggestions: [
          "Luật của giải này",
          "Có bao nhiêu đội đăng ký?",
          "Lịch thi đấu giải này",
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

  const screen = hasAny(normalized, ["đăng nhập", "login"])
    ? "login"
    : hasAny(normalized, ["đăng ký tài khoản", "register"])
      ? "register"
      : hasAny(normalized, ["quên mật khẩu", "forgot password"])
        ? "forgot_password"
        : hasAny(normalized, ["hồ sơ của tôi", "trang cá nhân", "profile"])
          ? "profile"
          : hasAny(normalized, ["bảng xếp hạng", "bxh", "ranking"])
          ? "leaderboard"
            : hasAny(normalized, ["giải của tôi", "my tournaments"])
              ? "my_tournaments"
              : hasAny(normalized, ["admin news", "quản lý tin tức"])
                ? "admin_news"
                : hasAny(normalized, ["admin users", "quản lý người dùng"])
                  ? "admin_users"
                    : hasAny(normalized, ["admin avatar", "avatar optimization"])
                      ? "admin_avatar_optimization"
                    : hasAny(normalized, ["tin tức", "news"])
                      ? "news_list"
                : hasAny(normalized, ["danh sách giải", "các giải", "tournaments"])
                  ? "tournament_list"
                  : hasAny(normalized, ["câu lạc bộ", "clb", "clubs"])
                    ? "clubs"
                  : hasAny(normalized, ["live", "trực tiếp"])
                    ? "live_matches"
                    : hasAny(normalized, ["trang chủ", "home"])
                      ? "home"
                      : hasAny(normalized, ["xác minh", "kyc"])
                        ? "kyc"
                      : hasAny(normalized, ["điểm trình", "level point"])
                          ? "level_point"
                          : "";

  if (!screen && context.clubId && hasAny(normalized, ["clb này", "club này"])) {
    return {
      screen: "club_detail",
      clubId: context.clubId,
      reply: "Mình đã chuẩn bị nút mở đúng CLB hiện tại cho bạn.",
      suggestions: ["Thành viên CLB này", "Sự kiện CLB này", "Thông báo CLB này"],
    };
  }

  if (
    !screen &&
    context.newsSlug &&
    hasAny(normalized, ["bài này", "tin này", "news này"])
  ) {
    return {
      screen: "news_detail",
      newsSlug: context.newsSlug,
      reply: "Mình đã chuẩn bị nút mở lại đúng bài viết hiện tại cho bạn.",
      suggestions: ["Tóm tắt bài này", "Tin mới nhất", "Bài này từ nguồn nào?"],
    };
  }

  if (!screen) return null;

  return {
    screen,
    reply: "Mình đã chuẩn bị nút mở đúng trang cho bạn.",
    suggestions: [
      "Giải nào sắp diễn ra?",
      "Tin mới nhất",
      "Cách đăng ký tài khoản",
    ],
  };
}

function buildPersonalToolPlan(normalized, context) {
  if (hasAny(normalized, ["giải của tôi", "giải đã đăng ký", "đăng ký giải"])) {
    return [{ name: "get_my_registrations", args: { limit: 6 } }];
  }
  if (hasAny(normalized, ["biến động", "lịch sử rating", "rating changes"])) {
    return [{ name: "get_my_rating_changes", args: { limit: 8 } }];
  }
  if (hasAny(normalized, ["trận sắp tới", "upcoming"])) {
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
  if (hasAny(normalized, ["lịch sử đăng nhập", "login"])) {
    return [{ name: "get_login_history", args: { limit: 10 } }];
  }
  if (hasAny(normalized, ["thiết bị", "device"])) {
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
      hasAny(normalized, ["thành viên", "members", "admin", "quản lý"]) ||
      context.pageSection === "members"
    ) {
      return [{ name: "get_club_members", args: { clubId: context.clubId, limit: 20 } }];
    }
    if (
      hasAny(normalized, ["sự kiện", "event", "lịch clb"]) ||
      context.pageSection === "events"
    ) {
      return [{ name: "get_club_events", args: { clubId: context.clubId, upcoming: true, limit: 8 } }];
    }
    if (
      hasAny(normalized, ["bình chọn", "poll", "vote"]) ||
      context.pageSection === "polls"
    ) {
      return [{ name: "get_club_polls", args: { clubId: context.clubId, limit: 5 } }];
    }
    if (
      hasAny(normalized, ["tin", "news", "thông báo", "announcements"]) ||
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

  if (entityName && hasAny(normalized, ["chi tiết", "mở CLB", "xem CLB"])) {
    plan.push({
      name: "get_club_details",
      args: { clubId: FIRST_CLUB_ID },
    });
  }

  return plan;
}

function buildLiveToolPlan(normalized, context = {}) {
  if (context.matchId) {
    if (hasAny(normalized, ["tỉ số", "điểm", "score", "set", "ván"])) {
      return [{ name: "get_match_score_detail", args: { matchId: context.matchId } }];
    }
    if (hasAny(normalized, ["diễn biến", "log", "nhật ký"])) {
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
    if (hasAny(normalized, ["lịch sử giải", "tournament history"])) {
      return [
        {
          name: "get_player_tournament_history",
          args: { userId: context.profileUserId },
        },
      ];
    }
    if (hasAny(normalized, ["xếp hạng", "ranking"])) {
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

  if (hasAny(normalized, ["so sánh", "compare"])) {
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

  if (hasAny(normalized, ["xếp hạng", "bxh", "ranking"])) {
    return [{ name: "get_leaderboard", args: { limit: 10 } }];
  }

  if (entityName && hasAny(normalized, ["rating", "thống kê", "hồ sơ"])) {
    return [{ name: "get_user_stats", args: { name: entityName } }];
  }

  return [{ name: "search_users", args: { name: entityName || message, limit: 5 } }];
}

function buildTournamentToolPlan(message, normalized, entityName, context) {
  const hasContextTournament =
    Boolean(context.tournamentId) &&
    (!entityName ||
    hasAny(normalized, ["giải này", "giải hiện tại", "trang này"]));

  if (hasContextTournament) {
    if (context.matchId) {
      if (hasAny(normalized, ["tỉ số", "điểm", "score", "set", "ván"])) {
        return [
          {
            name: "get_match_score_detail",
            args: { matchId: context.matchId },
          },
        ];
      }
      if (hasAny(normalized, ["diễn biến", "log", "nhật ký"])) {
        return [
          {
            name: "get_match_live_log",
            args: { matchId: context.matchId, limit: 20 },
          },
        ];
      }
      if (hasAny(normalized, ["video", "xem lại", "record", "stream"])) {
        return [
          {
            name: "get_match_video",
            args: { matchId: context.matchId },
          },
        ];
      }
    }
    if (context.bracketId) {
      if (hasAny(normalized, ["xếp hạng bảng", "standings", "bảng này"])) {
        return [
          {
            name: "get_bracket_standings",
            args: { bracketId: context.bracketId },
          },
        ];
      }
      if (hasAny(normalized, ["nhóm", "group", "bảng đấu"])) {
        return [
          {
            name: "get_bracket_groups",
            args: { bracketId: context.bracketId },
          },
        ];
      }
      if (hasAny(normalized, ["cây nhánh", "match tree", "tree"])) {
        return [
          {
            name: "get_bracket_match_tree",
            args: { bracketId: context.bracketId },
          },
        ];
      }
    }
    if (hasAny(normalized, ["lịch thi đấu", "schedule"])) {
      return [
        {
          name: "get_tournament_schedule",
          args: { tournamentId: context.tournamentId, limit: 10 },
        },
      ];
    }
    if (
      hasAny(normalized, [
        "bao nhiêu trận",
        "còn bao nhiêu trận",
        "trận chưa xong",
        "trận đã xong",
        "tổng trận",
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
    if (hasAny(normalized, ["luật", "rules"])) {
      return [
        {
          name: "get_tournament_rules",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["nhánh đấu", "bracket", "sơ đồ"])) {
      return [
        {
          name: "get_tournament_brackets",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["đăng ký", "bao nhiêu đội", "đội"])) {
      return [
        {
          name: "get_tournament_registrations",
          args: { tournamentId: context.tournamentId, limit: 10 },
        },
      ];
    }
    if (hasAny(normalized, ["lệ phí", "thanh toán", "payment"])) {
      return [
        {
          name: "get_tournament_payment_info",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["tiến độ", "progress"])) {
      return [
        {
          name: "get_tournament_progress",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["quản lý", "manager", "btc"])) {
      return [
        {
          name: "get_tournament_managers",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["trọng tài", "referee"])) {
      return [
        {
          name: "get_tournament_referees",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["sân", "court"])) {
      return [
        {
          name: "get_tournament_courts",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["bốc thăm", "draw"])) {
      return [
        {
          name: "get_draw_results",
          args: { tournamentId: context.tournamentId },
        },
      ];
    }
    if (hasAny(normalized, ["live", "trực tiếp", "streaming"])) {
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

  const status = pickTournamentStatus(normalized);
  const extractedName = entityName || "";
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
      "chi tiết",
      "tổng quan",
      "lịch thi đấu",
      "luật",
      "nhánh đấu",
      "đăng ký",
      "sân",
      "bốc thăm",
    ]);

  if (!needsSpecificTournament) {
    return plan;
  }

  if (hasAny(normalized, ["lịch thi đấu", "schedule"])) {
    plan.push({
      name: "get_tournament_schedule",
      args: { tournamentId: FIRST_TOURNAMENT_ID, limit: 10 },
    });
    return plan;
  }
  if (
    hasAny(normalized, [
      "bao nhiêu trận",
      "còn bao nhiêu trận",
      "trận chưa xong",
      "trận đã xong",
      "tổng trận",
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
  if (hasAny(normalized, ["luật", "rules"])) {
    plan.push({
      name: "get_tournament_rules",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }
  if (hasAny(normalized, ["nhánh đấu", "bracket", "sơ đồ"])) {
    plan.push({
      name: "get_tournament_brackets",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }
  if (hasAny(normalized, ["đăng ký", "bao nhiêu đội", "đội"])) {
    plan.push({
      name: "get_tournament_registrations",
      args: { tournamentId: FIRST_TOURNAMENT_ID, limit: 10 },
    });
    return plan;
  }
  if (hasAny(normalized, ["sân", "court"])) {
    plan.push({
      name: "get_tournament_courts",
      args: { tournamentId: FIRST_TOURNAMENT_ID },
    });
    return plan;
  }
  if (hasAny(normalized, ["bốc thăm", "draw"])) {
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
  if (hasAny(normalized, ["sắp tới", "upcoming", "mở đăng ký"])) return "upcoming";
  if (hasAny(normalized, ["đang diễn ra", "ongoing", "live"])) return "ongoing";
  if (hasAny(normalized, ["đã kết thúc", "finished"])) return "finished";
  return "";
}

function extractEntityName(message) {
  const cleaned = String(message || "")
    .replace(/[?!.]/g, " ")
    .replace(
      /\b(xin|cho|toi|mình|minh|giup|hãy|hay|lam on|vui long|mo|vao|xem|tim|tra cuu|cho toi biet|co the|giup toi)\b/gi,
      " ",
    )
    .replace(
      /\b(giải|giai|tournament|câu lạc bộ|cau lac bo|clb|club|tin tức|tin tuc|news|vđv|vdv|người chơi|nguoi choi|player|bảng xếp hạng|bxh|rating|hồ sơ|ho so|lịch thi đấu|lich thi dau|nhánh đấu|nhanh dau|bracket|trang|page)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= 2 ? cleaned : "";
}

function extractPairNames(message) {
  const raw = String(message || "");
  const splitters = [" với ", " va ", " vs ", " và "];
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

function buildSourcesFromToolResults(toolResults = {}, context = {}) {
  const sources = [];

  (toolResults.search_tournaments?.tournaments || []).slice(0, 2).forEach((item) => {
    if (!item?._id) return;
    sources.push(
      createSource("entity", item.name || "Giải đấu", `/tournament/${item._id}`, {
        entityType: "tournament",
        entityId: String(item._id),
        freshness: item.status || "db",
        tool: "search_tournaments",
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
        },
      ),
    );
  }

  if (toolResults.get_tournament_progress?.overview && context?.tournamentId) {
    sources.push(
      createSource(
        "entity",
        context?.pageSnapshot?.entityTitle || "Tiến độ giải đấu",
        `/tournament/${context.tournamentId}/schedule`,
        {
          entityType: "tournament_progress",
          entityId: context.tournamentId,
          freshness:
            toolResults.get_tournament_progress?.overview?.progressPercent || "db",
          tool: "get_tournament_progress",
        },
      ),
    );
  }

  (toolResults.search_news?.articles || []).slice(0, 2).forEach((article) => {
    sources.push(
      createSource("article", article.title || "Bài viết", article.slug ? `/news/${article.slug}` : "", {
        entityType: "news",
        entityId: article.slug || "",
        freshness: article.publishedAt || "",
        tool: "search_news",
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
        },
      ),
    );
  }

  (toolResults.search_users?.users || []).slice(0, 2).forEach((user) => {
    if (!user?._id) return;
    sources.push(
      createSource("entity", user.name || user.nickname || "VĐV", `/user/${user._id}`, {
        entityType: "player",
        entityId: String(user._id),
        freshness: "db",
        tool: "search_users",
      }),
    );
  });

  if (toolResults.get_match_info?.code && context?.matchId) {
    sources.push(
      createSource("match", `Trận ${toolResults.get_match_info.code}`, context.currentPath || "", {
        entityType: "match",
        entityId: context.matchId,
        freshness: toolResults.get_match_info.status || "db",
        tool: "get_match_info",
      }),
    );
  }

  if (toolResults.get_match_score_detail?.code && context?.matchId) {
    sources.push(
      createSource(
        "match",
        `Chi tiết ${toolResults.get_match_score_detail.code}`,
        context.currentPath || "",
        {
          entityType: "match",
          entityId: context.matchId,
          freshness: toolResults.get_match_score_detail.status || "db",
          tool: "get_match_score_detail",
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
        },
      ),
    );
  });

  (toolResults.search_knowledge?.results || []).slice(0, 2).forEach((item) => {
    sources.push(
      createSource("knowledge", item.title || item.category || "Kiến thức", "", {
        entityType: "knowledge",
        entityId: item.title || "",
        freshness: item.category || "knowledge",
        tool: "search_knowledge",
      }),
    );
  });

  return dedupeByKey(sources, (item) => `${item.tool}:${item.entityId || item.path || item.label}`)
    .slice(0, MAX_SOURCES);
}

function buildAnswerCardsFromToolResults(toolResults = {}, context = {}) {
  const cards = [];

  const summaryTournament = toolResults.get_tournament_summary?.tournament;
  if (summaryTournament && context?.tournamentId) {
    const stats = toolResults.get_tournament_summary?.stats || {};
    cards.push(
      createAnswerCard("tournament", {
        title: summaryTournament.name,
        subtitle: summaryTournament.location || summaryTournament.code || "Giải đấu",
        badges: [summaryTournament.status, summaryTournament.eventType],
        metrics: [
          `Đăng ký: ${stats.totalRegistrations || 0}`,
          `Trận: ${stats.totalMatches || 0}`,
          `Sân: ${stats.totalCourts || 0}`,
          `Tiến độ: ${stats.progress || "0%"}`,
        ],
        description: `Tổng quan nhanh của giải ${summaryTournament.name}.`,
        path: `/tournament/${context.tournamentId}`,
        actions: [
          buildActionNavigation(`/tournament/${context.tournamentId}`, "Mở giải"),
          buildActionNavigation(
            `/tournament/${context.tournamentId}/schedule`,
            "Mở lịch thi đấu",
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
          subtitle: tournament.location || tournament.eventType || "Giải đấu",
          badges: [tournament.status, tournament.eventType],
          metrics: [
            tournament.startDate ? `Bắt đầu: ${tournament.startDate}` : "",
            tournament.registrationDeadline
              ? `Hạn đăng ký: ${tournament.registrationDeadline}`
              : "",
          ],
          description: tournament.description || "",
          path: `/tournament/${tournament._id}`,
          actions: [
            buildActionNavigation(`/tournament/${tournament._id}`, "Mở giải"),
            buildOpenNewTabAction(`/tournament/${tournament._id}/schedule`, "Mở lịch ở tab mới"),
          ],
        }),
      );
    }
  }

  const progress = toolResults.get_tournament_progress;
  if (progress?.overview && context?.tournamentId) {
    cards.push(
      createAnswerCard("status_metric", {
        title: context?.pageSnapshot?.entityTitle || "Tiến độ giải hiện tại",
        subtitle: "Tiến độ thi đấu",
        badges: [progress.overview.progressPercent, context?.pageType || ""],
        metrics: [
          `Tổng trận: ${progress.overview.total || 0}`,
          `Đã xong: ${progress.overview.finished || 0}`,
          `Đang live: ${progress.overview.live || 0}`,
          `Chờ thi đấu: ${progress.overview.pending || 0}`,
        ],
        description:
          "Tóm tắt tiến độ hiện tại của giải, phù hợp cho các câu hỏi về số trận còn lại hoặc đã hoàn tất.",
        path: `/tournament/${context.tournamentId}/schedule`,
        actions: [
          buildActionNavigation(
            `/tournament/${context.tournamentId}/schedule`,
            "Mở lịch thi đấu",
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
        subtitle: userStats.nickname || userStats.province || "Người chơi",
        badges: [userStats.gender, userStats.province],
        metrics: [
          `Đôi: ${userStats.ratingDoubles || 0}`,
          `Đơn: ${userStats.ratingSingles || 0}`,
          `Win rate: ${userStats.winRate || "0%"}`,
          `Giải: ${userStats.totalTournaments || 0}`,
        ],
        description: `Tổng ${userStats.totalMatches || 0} trận, thắng ${userStats.wonMatches || 0}.`,
        path: context?.profileUserId ? `/user/${context.profileUserId}` : "",
      }),
    );
  } else {
    const user = toolResults.search_users?.users?.[0];
    if (user?._id) {
      cards.push(
        createAnswerCard("player", {
          title: user.name || user.nickname || "Người chơi",
          subtitle: user.nickname || user.province || "",
          badges: [user.gender, user.province],
          metrics: [
            user.double ? `Đôi: ${user.double}` : "",
            user.single ? `Đơn: ${user.single}` : "",
          ],
          description: user.bio || "",
          path: `/user/${user._id}`,
          actions: [buildActionNavigation(`/user/${user._id}`, "Mở hồ sơ")],
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
        subtitle: clubDetails.city || clubDetails.province || "Câu lạc bộ",
        badges: [clubDetails.visibility, clubDetails.joinPolicy, clubDetails.isVerified ? "Đã xác minh" : ""],
        metrics: [
          `Thành viên: ${clubDetails.memberCount || 0}`,
          `Admin: ${clubDetails.adminCount || 0}`,
          `Danh hiệu: ${clubDetails.tournamentWins || 0}`,
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
          badges: [club.joinPolicy, club.isVerified ? "Đã xác minh" : ""],
          metrics: [`Thành viên: ${club.memberCount || 0}`],
          description: club.description || "",
          path: `/clubs/${club._id}`,
          actions: [buildActionNavigation(`/clubs/${club._id}`, "Mở CLB")],
        }),
      );
    }
  }

  const article = toolResults.search_news?.articles?.[0];
  if (article?.slug) {
    cards.push(
      createAnswerCard("news", {
        title: article.title,
        subtitle: article.source || article.publishedAt || "Tin tức",
        badges: article.tags || [],
        metrics: [article.publishedAt ? `Xuất bản: ${article.publishedAt}` : ""],
        description: article.summary || "",
        path: `/news/${article.slug}`,
        actions: [buildActionNavigation(`/news/${article.slug}`, "Mở bài viết")],
      }),
    );
  }

  const liveStream = toolResults.get_live_streams?.streams?.[0];
  if (liveStream) {
    cards.push(
      createAnswerCard("live_stream", {
        title: liveStream.match?.code
          ? `Live ${liveStream.match.code}`
          : liveStream.provider || "Live stream",
        subtitle: liveStream.match?.tournament || liveStream.provider || "Trực tiếp",
        badges: [liveStream.status, liveStream.match?.court],
        metrics: [liveStream.startedAt ? `Bắt đầu: ${liveStream.startedAt}` : ""],
        description: liveStream.link || "",
        path: "",
        actions: liveStream.link
          ? [createAction("open_new_tab", { path: liveStream.link, label: "Mở luồng live" })]
          : [],
      }),
    );
  }

  const schedule = toolResults.get_tournament_schedule;
  if (schedule?.total) {
    cards.push(
      createAnswerCard("schedule", {
        title: "Lịch thi đấu",
        subtitle: context?.pageSnapshot?.entityTitle || "Giải hiện tại",
        badges: [context?.pageType || "", context?.pageSection || ""],
        metrics: [
          `Tổng trận: ${schedule.total || 0}`,
          ...Object.entries(schedule.courtSummary || {})
            .slice(0, 2)
            .map(([court, count]) => `${court}: ${count}`),
        ],
        description: "Lịch thi đấu hiện tại của giải hoặc bộ lọc đang mở.",
        path: context?.tournamentId ? `/tournament/${context.tournamentId}/schedule` : "",
      }),
    );
  }

  const matchScore = toolResults.get_match_score_detail || toolResults.get_match_info;
  if (matchScore?.code) {
    cards.push(
      createAnswerCard("match", {
        title: `Trận ${matchScore.code}`,
        subtitle: matchScore.round ? `Vòng ${matchScore.round}` : matchScore.status || "Trận đấu",
        badges: [matchScore.status, matchScore.court || matchScore.courtLabel, matchScore.format],
        metrics: [
          matchScore.teamA ? `A: ${matchScore.teamA}` : "",
          matchScore.teamB ? `B: ${matchScore.teamB}` : "",
          Array.isArray(matchScore.games) ? `Ván: ${matchScore.games.length}` : "",
        ],
        description: Array.isArray(matchScore.games)
          ? matchScore.games
              .slice(0, 2)
              .map((game) => `Ván ${game.game}: ${game.scoreA}-${game.scoreB}`)
              .join(" • ")
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
        `Mở giải ${tournament.name || ""}`.trim(),
      ),
    );
    actions.push(
      buildOpenNewTabAction(
        `/tournament/${tournament._id}/schedule`,
        "Mở lịch giải ở tab mới",
      ),
    );
  }

  const article = toolResults.search_news?.articles?.[0];
  if (article?.slug) {
    actions.push(
      buildActionNavigation(`/news/${article.slug}`, article.title || "Mở bài viết"),
    );
  }

  const club = toolResults.search_clubs?.clubs?.[0];
  if (club?._id) {
    actions.push(
      buildActionNavigation(`/clubs/${club._id}`, club.name || "Mở CLB"),
    );
  }

  const user = toolResults.search_users?.users?.[0];
  if (user?._id) {
    actions.push(
      buildActionNavigation(`/user/${user._id}`, user.name || "Mở hồ sơ VĐV"),
    );
  }

  if (String(context?.pageType || "") === "tournament_draw_live") {
    actions.push(
      createAction("set_query_param", {
        label: "Đổi sang sân khấu",
        description: "Chuyển view bốc thăm sang sân khấu.",
        payload: { key: "view", value: "stage" },
      }),
      createAction("set_query_param", {
        label: "Đổi sang bảng",
        description: "Chuyển view bốc thăm sang bảng.",
        payload: { key: "view", value: "board" },
      }),
      createAction("set_query_param", {
        label: "Đổi sang lịch sử",
        description: "Chuyển view bốc thăm sang lịch sử.",
        payload: { key: "view", value: "history" },
      }),
    );
  }

  if (String(context?.pageType || "") === "my_tournaments") {
    actions.push(
      createAction("set_page_state", {
        label: "Chuyển sang dạng thẻ",
        description: "Đổi trang Giải của tôi sang giao diện thẻ.",
        payload: { key: "viewMode", value: "card" },
      }),
      createAction("set_page_state", {
        label: "Chuyển sang dạng danh sách",
        description: "Đổi trang Giải của tôi sang giao diện danh sách.",
        payload: { key: "viewMode", value: "list" },
      }),
      createAction("prefill_text", {
        label: "Điền nhanh ô tìm giải",
        description: "Điền sẵn từ khóa vào ô tìm giải.",
        payload: {
          handlerKey: "search",
          selector:
            'input[placeholder*=\"giải\"], input[placeholder*=\"Tìm\"], input[name=\"search\"]',
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
        label: "Sao chép link trang này",
        value: context.currentUrl,
      }),
    );
    actions.push(
      buildOpenNewTabAction(context.currentPath || context.currentUrl, "Mở trang này ở tab mới"),
    );
  }

  actions.push(
    createAction("focus_element", {
      label: "Focus ô tìm kiếm",
      description: "Đưa con trỏ tới ô tìm kiếm gần nhất trên trang.",
      payload: {
        selector:
          'input[type=\"search\"], input[placeholder*=\"Tìm\"], input[placeholder*=\"Search\"], input[name=\"search\"]',
      },
    }),
  );

  if (context?.tournamentId) {
    actions.push(
      buildActionNavigation(
        `/tournament/${context.tournamentId}/schedule`,
        "Mở lịch thi đấu",
      ),
      buildActionNavigation(
        `/tournament/${context.tournamentId}/bracket`,
        "Mở nhánh đấu",
      ),
    );

    if (String(context.pageType || "").startsWith("tournament_draw_live")) {
      actions.push(
        buildActionNavigation(
          `/tournament/${context.tournamentId}/draw/live?view=stage`,
          "Mở sân khấu bốc thăm",
        ),
        buildActionNavigation(
          `/tournament/${context.tournamentId}/draw/live?view=board`,
          "Mở bảng bốc thăm",
        ),
        buildActionNavigation(
          `/tournament/${context.tournamentId}/draw/live?view=history`,
          "Mở lịch sử bốc thăm",
        ),
      );
    }
  }

  if (String(context?.pageType || "") === "tournament_schedule") {
    actions.push(
      createAction("scroll_to_section", {
        label: "Cuộn tới lịch thi đấu",
        description: "Cuộn tới khu vực lịch thi đấu đang hiển thị.",
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
        label: "Xem tất cả CLB",
        description: "Chuyển danh sách CLB sang tab tất cả.",
        payload: { key: "tab", value: "all" },
      }),
      createAction("set_page_state", {
        label: "Xem CLB của tôi",
        description: "Chuyển danh sách CLB sang tab CLB của tôi.",
        payload: { key: "tab", value: "mine" },
      }),
      createAction("prefill_text", {
        label: "Điền ô tìm CLB",
        description: "Điền sẵn từ khóa vào ô tìm câu lạc bộ.",
        payload: {
          handlerKey: "search",
          selector:
            'input[placeholder*=\"CLB\"], input[placeholder*=\"Tìm\"], input[name=\"search\"]',
        },
      }),
      createAction("open_dialog", {
        label: "Mở form tạo CLB",
        description: "Mở nhanh hộp thoại tạo câu lạc bộ mới trên trang này.",
        payload: {
          handlerKey: "openDialog",
          value: "createClub",
        },
      }),
    );
  }

  if (context?.clubId) {
    actions.push(
      buildActionNavigation(`/clubs/${context.clubId}`, "Mở CLB hiện tại"),
      buildActionNavigation(`/clubs/${context.clubId}?tab=events`, "Mở sự kiện CLB"),
    );
  }

  if (context?.newsSlug) {
    actions.push(
      buildActionNavigation(`/news/${context.newsSlug}`, "Mở bài viết hiện tại"),
      buildActionNavigation("/news", "Mở danh sách tin tức"),
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
            execution.navigation.description || "Mở trang liên quan",
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

function applyTrustGuard(reply, route, execution = {}, sources = [], answerCards = []) {
  const text = String(reply || "").trim();
  if (!text) return text;
  if (!needsTrustDisclaimer(route, execution, sources, answerCards)) {
    return text;
  }
  if (sharedNormalizeText(text).includes("khong du du lieu")) {
    return text;
  }
  return `${text}\n\nLưu ý: Mình chưa có đủ dữ liệu xác minh từ hệ thống để khẳng định chi tiết hơn. Nếu bạn muốn, mình có thể mở đúng trang liên quan hoặc thử truy vấn lại cụ thể hơn.`;
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
        resultPreview: `Lỗi: ${error.message}`,
        durationMs: Date.now() - startedAt,
        error: true,
      };
      toolSummary.push(summary);
      safeEmit("tool_done", {
        tool: step.name,
        label,
        resultPreview: "Lỗi khi xử lý",
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
  if (!result) return "Không có kết quả";
  if (result.error) return `Lỗi: ${result.error}`;

  switch (tool) {
    case "search_knowledge":
      return result.count
        ? `Tìm thấy ${result.count} mục kiến thức`
        : "Không tìm thấy thông tin";
    case "search_tournaments":
      return result.count
        ? `Tìm thấy ${result.count} giải đấu`
        : "Không tìm thấy giải nào";
    case "get_tournament_summary":
      return result.tournament?.name
        ? `${result.tournament.name} • ${result.stats?.totalRegistrations || 0} đội`
        : "Đã lấy tổng quan giải";
    case "get_tournament_schedule":
      return result.total
        ? `${result.total} trận trong lịch`
        : "Không có lịch thi đấu";
    case "get_tournament_rules":
      return result.total
        ? `${result.total} bảng có luật thi đấu`
        : "Đã lấy luật";
    case "get_tournament_brackets":
      return result.total != null ? `${result.total} bảng đấu` : "Đã lấy bảng đấu";
    case "get_tournament_registrations":
      return result.totalRegistrations != null
        ? `${result.totalRegistrations} đội đăng ký`
        : "Đã lấy đội đăng ký";
    case "get_tournament_courts":
      return result.total != null ? `${result.total} sân đấu` : "Đã lấy sân đấu";
    case "get_draw_results":
      return result.total
        ? `${result.total} kết quả bốc thăm`
        : "Chưa có kết quả bốc thăm";
    case "search_users":
      return result.count ? `Tìm thấy ${result.count} VĐV` : "Không tìm thấy VĐV";
    case "get_user_stats":
      return result.name
        ? `${result.name} • ${result.winRate || "0%"} win rate`
        : "Đã lấy thống kê VĐV";
    case "get_my_info":
      return result.name
        ? `Đã lấy hồ sơ của ${result.name}`
        : "Đã lấy thông tin cá nhân";
    case "get_my_registrations":
      return result.count != null ? `${result.count} đăng ký` : "Đã lấy đăng ký của bạn";
    case "get_my_rating_changes":
      return result.count != null
        ? `${result.count} biến động rating`
        : "Đã lấy lịch sử rating";
    case "get_upcoming_matches":
      return result.total != null ? `${result.total} trận sắp tới` : "Đã lấy lịch thi đấu";
    case "get_login_history":
      return result.lastLogin ? `Lần đăng nhập cuối ${result.lastLogin}` : "Đã lấy lịch sử đăng nhập";
    case "get_my_devices":
      return result.total != null ? `${result.total} thiết bị` : "Đã lấy thiết bị";
    case "search_clubs":
      return result.count ? `Tìm thấy ${result.count} CLB` : "Không tìm thấy CLB";
    case "get_club_details":
      return result.name
        ? `${result.name} • ${result.memberCount || 0} thành viên`
        : "Đã lấy chi tiết CLB";
    case "search_news":
      return result.total ? `${result.total} bài viết` : "Không tìm thấy bài viết";
    case "navigate":
      return result.description || "Đã chuẩn bị điều hướng";
    case "get_leaderboard":
      return result.players?.length
        ? `${result.players.length} VĐV trên BXH`
        : "Đã lấy bảng xếp hạng";
    default:
      return "Hoàn tất";
  }
}

function shouldUseReasoner(message, route, execution) {
  const normalized = sharedNormalizeText(message);
  if (
    hasAny(normalized, [
      "tại sao",
      "vì sao",
      "so sánh",
      "khác nhau",
      "phân tích",
      "giải thích",
      "kế hoạch",
      "nên ",
      "đánh giá",
      "strategy",
      "chiến thuật",
      "tối ưu",
      "plan",
    ])
  ) {
    return true;
  }

  if (route.kind === "general" && message.length > 120) return true;
  if (execution.toolSummary.length >= 2) return true;
  if (route.kind === "player" && hasAny(normalized, ["so sánh", "compare"])) {
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
  const densityInstruction =
    personalization?.preferredAnswerDensity === "compact_operator"
      ? "Ưu tiên câu trả lời ngắn, thao tác trước, giải thích sau. Nếu có bước tiếp theo rõ ràng thì nêu trong 1-2 bullet đầu tiên."
      : "Giữ câu trả lời cân bằng: ngắn gọn nhưng vẫn đủ ý để người dùng hiểu nhanh.";
  const pageAwareInstruction =
    context?.pageType?.startsWith("tournament_") ||
    context?.pageType?.startsWith("admin_") ||
    context?.pageType?.startsWith("live_")
      ? "Nếu đang ở một màn thao tác cụ thể, ưu tiên nói đúng theo màn hiện tại và gợi ý bước kế tiếp có thể bấm ngay."
      : "";
  const systemPrompt = [
    "Bạn là Pikora, trợ lý PickleTour.",
    "Trả lời gọn, chính xác, tự nhiên.",
    "Nếu người dùng dùng tiếng Anh thì trả lời tiếng Anh, còn lại dùng tiếng Việt.",
    "Chỉ dùng dữ liệu đã xác minh trong phần kết quả công cụ khi câu hỏi cần dữ liệu cụ thể.",
    "Nếu dữ liệu thiếu hoặc không thấy, nói rõ và gợi ý bước tiếp theo.",
    "Nếu có số liệu hoặc thực thể cụ thể mà không có dữ liệu xác minh đủ chắc, phải nói rõ là chưa đủ dữ liệu xác minh thay vì khẳng định như fact.",
    "Không nhắc tới JSON, model, proxy hay nội bộ hệ thống.",
    "Không in raw <think> trong câu trả lời cuối.",
    "Nếu có navigation, có thể nói rằng đã chuẩn bị nút mở đúng trang.",
    "Dùng markdown nhẹ: bullet hoặc bảng khi có ích, tránh dài dòng.",
    densityInstruction,
    pageAwareInstruction,
  ].join("\n");

  const contextSummary = buildContextSummary(context, userProfile);
  const pageSnapshotSummary = buildPageSnapshotSummary(context);
  const personalizationSummary = buildPersonalizationSummary(personalization);
  const toolContext = buildToolContext(execution.toolResults);

  return [
    { role: "system", content: systemPrompt },
    ...trimMemory(memory),
    {
      role: "user",
      content: [
        `Câu hỏi hiện tại: ${message}`,
        contextSummary ? `Ngữ cảnh hiện tại:\n${contextSummary}` : "",
        pageSnapshotSummary ? `Ảnh chụp giao diện hiện tại:\n${pageSnapshotSummary}` : "",
        personalizationSummary
          ? `Tín hiệu cá nhân hóa:\n${personalizationSummary}`
          : "",
        `Loại yêu cầu: ${route.kind}`,
        toolContext
          ? `Dữ liệu đã xác minh:\n${toolContext}`
          : "Dữ liệu đã xác minh: Không có tool nào được dùng.",
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
      `Người dùng: ${userProfile.name}${userProfile.nickname ? ` (${userProfile.nickname})` : ""}, rating ${userProfile.rating}, khu vực ${userProfile.province || "N/A"}.`,
    );
  }
  if (context.currentPath) parts.push(`Đường dẫn hiện tại: ${context.currentPath}`);
  if (context.tournamentId) parts.push(`ID giải hiện tại: ${context.tournamentId}`);
  if (context.matchId) parts.push(`ID trận hiện tại: ${context.matchId}`);
  if (context.bracketId) parts.push(`ID nhánh hiện tại: ${context.bracketId}`);
  if (context.courtCode) parts.push(`Sân hiện tại: ${context.courtCode}`);
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
    home: "trang chủ",
    tournament_list: "danh sách giải đấu",
    tournament_registration: "trang đăng ký giải hiện tại",
    tournament_checkin: "trang check-in giải hiện tại",
    tournament_bracket: "trang nhánh đấu của giải hiện tại",
    tournament_schedule: "trang lịch thi đấu của giải hiện tại",
    tournament_admin_draw: "trang admin bốc thăm của bracket hiện tại",
    tournament_draw_live: "trang bốc thăm trực tiếp",
    tournament_draw_manage: "không gian làm việc bốc thăm của giải hiện tại",
    tournament_manage: "không gian quản lý giải hiện tại",
    tournament_overview: "trang tổng quan giải hiện tại",
    news_list: "trang tin tức",
    news_detail: "trang bài viết hiện tại",
    club_list: "trang danh sách câu lạc bộ",
    club_detail: "trang câu lạc bộ hiện tại",
    live_clusters: "trang live tổng",
    live_studio: "trang studio trực tiếp",
    court_streaming: "trang phát trực tiếp sân",
    court_live_studio: "trang studio sân đấu hiện tại",
    admin_users: "trang admin quản lý người dùng",
    admin_news: "trang admin quản lý tin tức",
    admin_avatar_optimization: "trang admin tối ưu avatar",
    profile: "trang hồ sơ của bạn",
    public_profile: "trang hồ sơ công khai",
    my_tournaments: "trang giải của tôi",
    leaderboard: "trang bảng xếp hạng",
    contact: "trang liên hệ",
    status: "trang trạng thái hệ thống",
  };

  if (userProfile) {
    parts.push(
      `Người dùng: ${userProfile.name}${userProfile.nickname ? ` (${userProfile.nickname})` : ""}, rating ${userProfile.rating}, khu vực ${userProfile.province || "N/A"}.`,
    );
  }
  if (context.pageType) {
    parts.push(
      `Đang ở ${PAGE_LABELS[context.pageType] || `trang ${context.pageType}`}.`,
    );
  }
  if (context.pageTitle) {
    parts.push(`Tiêu đề trang: ${sanitizePageTitle(context.pageTitle)}.`);
  }
  if (context.pageSection) parts.push(`Khu vực hiện tại: ${context.pageSection}.`);
  if (context.pageView) parts.push(`Chế độ xem hiện tại: ${context.pageView}.`);
  if (context.adminSection) {
    parts.push(`Mục admin hiện tại: ${context.adminSection}.`);
  }
  if (context.currentPath) parts.push(`Đường dẫn hiện tại: ${context.currentPath}`);
  if (context.tournamentId) {
    parts.push(`ID giải hiện tại: ${context.tournamentId}`);
  }
  if (context.matchId) parts.push(`ID trận hiện tại: ${context.matchId}`);
  if (context.bracketId) parts.push(`ID nhánh hiện tại: ${context.bracketId}`);
  if (context.clubId) parts.push(`ID CLB hiện tại: ${context.clubId}`);
  if (context.newsSlug) parts.push(`Slug bài viết hiện tại: ${context.newsSlug}`);
  if (context.profileUserId) {
    parts.push(`ID hồ sơ hiện tại: ${context.profileUserId}`);
  }
  if (context.courtCode) parts.push(`Sân hiện tại: ${context.courtCode}`);
  if (context.courtId) parts.push(`ID sân hiện tại: ${context.courtId}`);
  return parts.join("\n");
}

function buildToolContext(toolResults) {
  const sections = [];
  for (const [toolName, result] of Object.entries(toolResults || {})) {
    if (!result) continue;
    sections.push(`### ${toolName}\n${safeSerialize(result)}`);
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
    throw new Error("Thiếu CLIPROXY_BASE_URL cho Pikora");
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
      "Giải này còn bao nhiêu trận?",
      "Có bao nhiêu đội đã thanh toán?",
      "Focus ô tìm kiếm VĐV",
    );
  } else if (pageType === "tournament_schedule") {
    suggestions.push(
      "Giải này còn bao nhiêu trận?",
      "Lọc các trận live",
      "Mở nhánh đấu",
    );
  } else if (pageType === "tournament_manage") {
    suggestions.push(
      "Tiến độ giải này",
      "Ai đang quản lý giải này?",
      "Mở lịch thi đấu",
    );
  } else if (pageType === "news_detail") {
    suggestions.push(
      "Bài này nói gì?",
      "Nguồn của bài này là gì?",
      "Tóm tắt bài này",
    );
  } else if (pageType === "admin_users") {
    suggestions.push("Tìm user theo tên", "Lọc theo role", "Focus ô tìm user");
  } else if (pageType === "admin_news") {
    suggestions.push(
      "Tìm bài viết theo tiêu đề",
      "Lọc bài chưa xuất bản",
      "Tạo bài viết mới",
    );
  } else if (pageTypeStartsWith(context, "tournament_draw_live")) {
    suggestions.push(
      "Xem bảng bốc thăm",
      "Xem lịch sử bốc thăm",
      "Tóm tắt lượt bốc gần nhất",
    );
  }

  if (context?.clubId) {
    suggestions.push("Thành viên CLB này", "Sự kiện CLB này", "Thông báo CLB này");
  }

  if (personalization?.preferredAnswerDensity === "compact_operator") {
    suggestions.push("Mở đúng trang này", "Copy link trang này");
  }
  if (personalization?.likelyRole === "admin") {
    suggestions.push("Mở admin users", "Mở admin news");
  }
  if (personalization?.interests?.includes("giải đấu") && !context?.tournamentId) {
    suggestions.push("Tìm giải ở Hà Nội", "Giải nào sắp diễn ra?", "Mở giải của tôi");
  }
  if (personalization?.interests?.includes("phân tích VĐV")) {
    suggestions.push(
      "So sánh 2 VĐV",
      "Bảng xếp hạng hiện tại",
      userId ? "Rating của tôi là bao nhiêu?" : "Hồ sơ người chơi này",
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
      ? ["API nào đang chậm?", "Worker nào đang lỗi?", "Storage có ổn không?"]
      : pageTypeStartsWith(context, "tournament_draw_live")
        ? ["Xem bảng bốc thăm", "Xem lịch sử bốc thăm", "Tóm tắt lượt bốc gần nhất"]
        : context?.clubId
          ? ["Thành viên CLB này", "Sự kiện CLB này", "Thông báo CLB này"]
          : [];

  const personalized =
    personalization?.interests?.includes("giải đấu") && !context?.tournamentId
      ? ["Tìm giải ở Hà Nội", "Giải nào sắp diễn ra?", "Mở giải của tôi"]
      : personalization?.interests?.includes("phân tích VĐV")
        ? ["So sánh 2 VĐV", "Bảng xếp hạng hiện tại", "Hồ sơ người chơi này"]
        : [];

  switch (route.kind) {
    case "personal":
      return sharedCompactList([
        "Rating của tôi là bao nhiêu?",
        "Trận sắp tới của tôi",
        "Giải của tôi",
        ...pageAwareSuggestions,
      ]);
    case "tournament":
      return sharedCompactList([
        context.tournamentId ? "Lịch thi đấu giải này" : "Giải nào sắp diễn ra?",
        context.tournamentId ? "Luật của giải này" : "Tìm giải ở Hà Nội",
        context.tournamentId ? "Có bao nhiêu đội đăng ký?" : "Nhánh đấu của giải này",
        ...pageAwareSuggestions,
      ]);
    case "club":
      return sharedCompactList([
        "CLB này có bao nhiêu thành viên?",
        "Có sự kiện CLB nào sắp tới?",
        "Cách tham gia CLB này",
        ...pageAwareSuggestions,
      ]);
    case "player":
      return sharedCompactList([
        "Bảng xếp hạng hiện tại",
        "So sánh 2 VĐV",
        userId ? "Rating của tôi là bao nhiêu?" : "Tìm VĐV ở Hà Nội",
        ...pageAwareSuggestions,
      ]);
    case "news":
      return sharedCompactList([
        "Tin mới nhất về pickleball",
        "Có bài nào về chiến thuật không?",
        "Giải nào đang hot?",
        ...pageAwareSuggestions,
      ]);
    case "live":
      return sharedCompactList([
        context.matchId ? "Tỷ số trận này ra sao?" : "Có những trận nào đang live?",
        context.matchId ? "Diễn biến trận này" : "Luồng live nào đang hoạt động?",
        context.tournamentId ? "Tiến độ giải này" : "Live studio đang mở ở đâu?",
        ...pageAwareSuggestions,
      ]);
    case "knowledge":
      return sharedCompactList([
        "Luật giao bóng pickleball là gì?",
        "Cách tính điểm như thế nào?",
        "Hướng dẫn đăng ký giải",
        ...pageAwareSuggestions,
      ]);
    case "navigate":
      return sharedCompactList([
        "Mở bảng xếp hạng",
        "Mở giải của tôi",
        "Tin mới nhất",
        ...pageAwareSuggestions,
      ]);
    default:
      return sharedCompactList([
        "Giải nào sắp diễn ra?",
        userId ? "Rating của tôi là bao nhiêu?" : "Cách đăng ký tài khoản",
        "Tin mới nhất",
        ...pageAwareSuggestions,
        ...personalized,
      ]);
  }
}

const TOOL_LABELS = {
  search_knowledge: "Tra cứu kiến thức",
  search_tournaments: "Tìm giải",
  get_tournament_summary: "Tổng quan giải",
  get_tournament_schedule: "Lịch thi đấu",
  get_tournament_rules: "Luật thi đấu",
  get_tournament_brackets: "Nhánh đấu",
  get_tournament_registrations: "Đăng ký giải",
  get_tournament_courts: "Sân đấu",
  get_draw_results: "Bốc thăm",
  search_users: "Tìm VĐV",
  get_user_stats: "Thống kê VĐV",
  get_my_info: "Thông tin của tôi",
  get_my_registrations: "Giải của tôi",
  get_my_rating_changes: "Biến động rating",
  get_upcoming_matches: "Trận sắp tới",
  get_login_history: "Lịch sử đăng nhập",
  get_my_devices: "Thiết bị của tôi",
  search_clubs: "Tìm CLB",
  get_club_details: "Chi tiết CLB",
  search_news: "Tin tức",
  navigate: "Điều hướng",
  get_leaderboard: "Bảng xếp hạng",
};

const NAVIGATION_SCREENS = {
  login: {
    screen: "Login",
    deepLink: "pickletour://login",
    webPath: "/login",
    description: "Đăng nhập",
  },
  register: {
    screen: "Register",
    deepLink: "pickletour://register",
    webPath: "/register",
    description: "Đăng ký tài khoản",
  },
  forgot_password: {
    screen: "ForgotPassword",
    deepLink: "pickletour://forgot-password",
    webPath: "/forgot-password",
    description: "Quên mật khẩu",
  },
  profile: {
    screen: "Profile",
    deepLink: "pickletour://profile",
    webPath: "/profile",
    description: "Trang cá nhân",
  },
  leaderboard: {
    screen: "Leaderboard",
    deepLink: "pickletour://rankings",
    webPath: "/pickle-ball/rankings",
    description: "Bảng xếp hạng",
  },
  my_tournaments: {
    screen: "MyTournaments",
    deepLink: "pickletour://my-tournaments",
    webPath: "/my-tournaments",
    description: "Giải của tôi",
  },
  tournament_list: {
    screen: "TournamentList",
    deepLink: "pickletour://tournaments",
    webPath: "/pickle-ball/tournaments",
    description: "Danh sách giải đấu",
  },
  clubs: {
    screen: "Clubs",
    deepLink: "pickletour://clubs",
    webPath: "/clubs",
    description: "Danh sách câu lạc bộ",
  },
  club_detail: {
    screen: "ClubDetail",
    deepLink: "pickletour://clubs/{clubId}",
    webPath: "/clubs/{clubId}",
    description: "Chi tiết câu lạc bộ",
  },
  live_matches: {
    screen: "LiveMatches",
    deepLink: "pickletour://live",
    webPath: "/live",
    description: "Trận đấu đang live",
  },
  home: {
    screen: "Home",
    deepLink: "pickletour://home",
    webPath: "/",
    description: "Trang chủ",
  },
  kyc: {
    screen: "KYC",
    deepLink: "pickletour://kyc",
    webPath: "/kyc",
    description: "Xác thực danh tính",
  },
  level_point: {
    screen: "LevelPoint",
    deepLink: "pickletour://levelpoint",
    webPath: "/levelpoint",
    description: "Điểm trình độ",
  },
  news_list: {
    screen: "NewsList",
    deepLink: "pickletour://news",
    webPath: "/news",
    description: "Tin tức PickleTour",
  },
  news_detail: {
    screen: "NewsDetail",
    deepLink: "pickletour://news/{newsSlug}",
    webPath: "/news/{newsSlug}",
    description: "Chi tiết bài viết",
  },
  bracket: {
    screen: "Bracket",
    deepLink: "pickletour://bracket/{tournamentId}",
    webPath: "/tournament/{tournamentId}/bracket",
    description: "Sơ đồ nhánh đấu",
  },
  schedule: {
    screen: "Schedule",
    deepLink: "pickletour://schedule/{tournamentId}",
    webPath: "/tournament/{tournamentId}/schedule",
    description: "Lịch thi đấu",
  },
  registration: {
    screen: "Registration",
    deepLink: "pickletour://register/{tournamentId}",
    webPath: "/tournament/{tournamentId}/register",
    description: "Đăng ký giải đấu",
  },
  tournament_overview: {
    screen: "TournamentOverview",
    deepLink: "pickletour://tournament/{tournamentId}/overview",
    webPath: "/tournament/{tournamentId}/overview",
    description: "Tổng quan giải đấu",
  },
  draw: {
    screen: "Draw",
    deepLink: "pickletour://tournament/{tournamentId}/draw",
    webPath: "/tournament/{tournamentId}/draw",
    description: "Bốc thăm",
  },
  draw_live: {
    screen: "DrawLive",
    deepLink: "pickletour://tournament/{tournamentId}/draw/live",
    webPath: "/tournament/{tournamentId}/draw/live",
    description: "Sân khấu bốc thăm trực tiếp",
  },
  draw_live_board: {
    screen: "DrawLiveBoard",
    deepLink: "pickletour://tournament/{tournamentId}/draw/live?view=board",
    webPath: "/tournament/{tournamentId}/draw/live?view=board",
    description: "Bảng bốc thăm trực tiếp",
  },
  draw_live_history: {
    screen: "DrawLiveHistory",
    deepLink: "pickletour://tournament/{tournamentId}/draw/live?view=history",
    webPath: "/tournament/{tournamentId}/draw/live?view=history",
    description: "Lịch sử bốc thăm trực tiếp",
  },
  tournament_detail: {
    screen: "TournamentDetail",
    deepLink: "pickletour://tournament/{tournamentId}",
    webPath: "/tournament/{tournamentId}",
    description: "Chi tiết giải đấu",
  },
};
