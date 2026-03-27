import axios from "axios";
import OpenAI from "openai";

import { OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 120000;
const HEALTH_CACHE_TTL_MS = 30000;
const FALLBACK_GENERATOR_MODEL =
  OPENAI_DEFAULT_MODEL || "gpt-5-codex-mini";

let cachedHealth = null;
let clientCache = null;

function normalizeSelectedModel(value = "") {
  const valueText = String(value || "").trim();
  return valueText || null;
}

function getConfiguredGeneratorModel(selectedModel) {
  const value = normalizeSelectedModel(selectedModel);
  return value || null;
}

function cleanBaseUrl(value = "") {
  let next = String(value || "").trim();
  if (!next) return "";

  next = next.replace(/\/+$/, "");
  next = next.replace(/\/responses$/i, "");
  next = next.replace(/\/models$/i, "");
  return next;
}

function buildGatewayUrls(baseUrl = "") {
  const normalizedBaseUrl = cleanBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return {
      baseUrl: "",
      responsesUrl: "",
      modelsUrl: "",
    };
  }

  return {
    baseUrl: normalizedBaseUrl,
    responsesUrl: `${normalizedBaseUrl}/responses`,
    modelsUrl: `${normalizedBaseUrl}/models`,
  };
}

function resolveGatewaySource() {
  const dedicatedBaseUrl = cleanBaseUrl(
    process.env.SEO_NEWS_ARTICLE_GENERATION_BASE_URL
  );
  const dedicatedApiKey = String(
    process.env.SEO_NEWS_ARTICLE_GENERATION_API_KEY || ""
  ).trim();

  if (dedicatedBaseUrl && dedicatedApiKey) {
    return {
      source: "dedicated",
      apiKey: dedicatedApiKey,
      timeoutMs:
        Number(process.env.SEO_NEWS_ARTICLE_GENERATION_TIMEOUT_MS) ||
        DEFAULT_TIMEOUT_MS,
      ...buildGatewayUrls(dedicatedBaseUrl),
    };
  }

  const sharedBaseUrl = cleanBaseUrl(process.env.CLIPROXY_BASE_URL);
  const sharedApiKey = String(
    process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY || ""
  ).trim();

  if (sharedBaseUrl && sharedApiKey) {
    return {
      source: "shared_proxy",
      apiKey: sharedApiKey,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...buildGatewayUrls(sharedBaseUrl),
    };
  }

  const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (openAiApiKey) {
    return {
      source: "openai_default",
      apiKey: openAiApiKey,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...buildGatewayUrls(DEFAULT_OPENAI_BASE_URL),
    };
  }

  return {
    source: "missing",
    apiKey: "",
    timeoutMs:
      Number(process.env.SEO_NEWS_ARTICLE_GENERATION_TIMEOUT_MS) ||
      DEFAULT_TIMEOUT_MS,
    ...buildGatewayUrls(process.env.SEO_NEWS_ARTICLE_GENERATION_BASE_URL),
  };
}

function extractModelIds(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data
    .map((item) => String(item?.id || "").trim())
    .filter(Boolean);
}

function chooseEffectiveModel({ selectedModel, availableModels = [] }) {
  if (selectedModel) return selectedModel;
  if (availableModels.length) return availableModels[0];
  return FALLBACK_GENERATOR_MODEL;
}

export function getSeoNewsArticleGenerationGatewayConfig({
  selectedModel,
} = {}) {
  const resolved = resolveGatewaySource();
  const apiKeyConfigured = Boolean(resolved.apiKey);

  return {
    source: resolved.source,
    apiKey: resolved.apiKey,
    apiKeyConfigured,
    baseUrl: resolved.baseUrl,
    responsesUrl: resolved.responsesUrl,
    modelsUrl: resolved.modelsUrl,
    timeoutMs: resolved.timeoutMs,
    selectedModel: getConfiguredGeneratorModel(selectedModel),
    fallbackModel: FALLBACK_GENERATOR_MODEL,
  };
}

export function getSeoNewsArticleGenerationClient({ selectedModel } = {}) {
  const config = getSeoNewsArticleGenerationGatewayConfig({ selectedModel });
  if (!config.apiKeyConfigured) {
    return null;
  }

  const cacheKey = [config.baseUrl, config.apiKey, config.timeoutMs].join("|");
  if (clientCache?.key === cacheKey && clientCache?.client) {
    return clientCache.client;
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    timeout: config.timeoutMs,
  });

  clientCache = { key: cacheKey, client };
  return client;
}

export function invalidateSeoNewsArticleGenerationHealthCache() {
  cachedHealth = null;
}

function buildMessage({
  status,
  source,
  modelCount,
  selectedModel,
  selectedModelAvailable,
  effectiveModel,
  responsesUrl,
  error,
}) {
  const prefix =
    source === "dedicated"
      ? "SEO news article generation gateway"
      : source === "shared_proxy"
      ? "SEO news article generation dang dung shared proxy"
      : source === "openai_default"
      ? "SEO news article generation dang dung OpenAI mac dinh"
      : "SEO news article generation";

  if (status === "not_configured") {
    return "SEO news article generation chua cau hinh URL/API key rieng hay shared gateway.";
  }

  if (status === "auth_error") {
    return `${prefix} bi tu choi xac thuc - ${responsesUrl || "-"}`;
  }

  if (status === "misconfigured") {
    return `${prefix} dang tro sai endpoint - ${responsesUrl || "-"}`;
  }

  if (
    status === "degraded" &&
    selectedModel &&
    selectedModelAvailable === false
  ) {
    return `${prefix} online nhung model ${selectedModel} khong co trong danh sach /models.`;
  }

  if (status === "degraded" && error) {
    return `${prefix} gap van de: ${error}`;
  }

  if (status === "online") {
    return `${prefix} online. Loaded ${modelCount} model(s). Dang dung ${effectiveModel || "-"} - ${responsesUrl || "-"}`;
  }

  return `${prefix} dang khoi tao.`;
}

export async function checkSeoNewsArticleGenerationHealth({
  forceRefresh = false,
  selectedModel,
} = {}) {
  const now = Date.now();
  const normalizedSelectedModel = normalizeSelectedModel(selectedModel);
  if (
    !forceRefresh &&
    cachedHealth?.value &&
    cachedHealth.expiresAt > now &&
    cachedHealth.selectedModel === normalizedSelectedModel
  ) {
    return cachedHealth.value;
  }

  const config = getSeoNewsArticleGenerationGatewayConfig({
    selectedModel: normalizedSelectedModel,
  });

  if (!config.apiKeyConfigured) {
    const value = {
      status: "not_configured",
      checkedAt: new Date().toISOString(),
      source: config.source,
      apiKeyConfigured: false,
      baseUrl: config.baseUrl,
      responsesUrl: config.responsesUrl,
      modelsUrl: config.modelsUrl,
      availableModels: [],
      modelCount: 0,
      selectedModel: config.selectedModel,
      effectiveModel: config.selectedModel || config.fallbackModel,
      selectedModelAvailable: null,
      message: buildMessage({
        status: "not_configured",
        source: config.source,
      }),
    };
    cachedHealth = {
      value,
      selectedModel: normalizedSelectedModel,
      expiresAt: now + HEALTH_CACHE_TTL_MS,
    };
    return value;
  }

  try {
    const response = await axios.get(config.modelsUrl, {
      timeout: Math.max(10000, config.timeoutMs),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      validateStatus: () => true,
    });

    const statusCode = Number(response.status) || 0;
    const availableModels = extractModelIds(response.data);

    let status = "online";
    let error = "";

    if (statusCode === 401 || statusCode === 403) {
      status = "auth_error";
      error = `HTTP ${statusCode}`;
    } else if (statusCode === 404 || statusCode === 405) {
      status = "misconfigured";
      error = `HTTP ${statusCode}`;
    } else if (statusCode < 200 || statusCode >= 300) {
      status = "degraded";
      error = `HTTP ${statusCode}`;
    } else if (!availableModels.length) {
      status = "degraded";
      error = "gateway did not return any model id";
    }

    const selectedModelAvailable =
      config.selectedModel && availableModels.length
        ? availableModels.includes(config.selectedModel)
        : null;
    const effectiveModel = chooseEffectiveModel({
      selectedModel: config.selectedModel,
      availableModels,
    });

    if (
      status === "online" &&
      config.selectedModel &&
      selectedModelAvailable === false
    ) {
      status = "degraded";
    }

    const value = {
      status,
      checkedAt: new Date().toISOString(),
      source: config.source,
      apiKeyConfigured: true,
      baseUrl: config.baseUrl,
      responsesUrl: config.responsesUrl,
      modelsUrl: config.modelsUrl,
      availableModels,
      modelCount: availableModels.length,
      selectedModel: config.selectedModel,
      effectiveModel,
      selectedModelAvailable,
      error,
      message: buildMessage({
        status,
        source: config.source,
        modelCount: availableModels.length,
        selectedModel: config.selectedModel,
        selectedModelAvailable,
        effectiveModel,
        responsesUrl: config.responsesUrl,
        error,
      }),
    };

    cachedHealth = {
      value,
      selectedModel: normalizedSelectedModel,
      expiresAt: now + HEALTH_CACHE_TTL_MS,
    };
    return value;
  } catch (error) {
    const effectiveModel = chooseEffectiveModel({
      selectedModel: config.selectedModel,
      availableModels: [],
    });
    const value = {
      status: "degraded",
      checkedAt: new Date().toISOString(),
      source: config.source,
      apiKeyConfigured: true,
      baseUrl: config.baseUrl,
      responsesUrl: config.responsesUrl,
      modelsUrl: config.modelsUrl,
      availableModels: [],
      modelCount: 0,
      selectedModel: config.selectedModel,
      effectiveModel,
      selectedModelAvailable: null,
      error: error?.message || "models_request_failed",
      message: buildMessage({
        status: "degraded",
        source: config.source,
        effectiveModel,
        responsesUrl: config.responsesUrl,
        error: error?.message || "models_request_failed",
      }),
    };
    cachedHealth = {
      value,
      selectedModel: normalizedSelectedModel,
      expiresAt: now + HEALTH_CACHE_TTL_MS,
    };
    return value;
  }
}

export async function getSeoNewsArticleGenerationRuntime({
  forceHealthRefresh = false,
  selectedModel,
} = {}) {
  const diagnostics = await checkSeoNewsArticleGenerationHealth({
    forceRefresh: forceHealthRefresh,
    selectedModel,
  });

  return {
    ...diagnostics,
    client: diagnostics.apiKeyConfigured
      ? getSeoNewsArticleGenerationClient({
          selectedModel: diagnostics.selectedModel,
        })
      : null,
    model: diagnostics.effectiveModel,
  };
}
