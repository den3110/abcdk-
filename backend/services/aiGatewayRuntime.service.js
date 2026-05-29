import OpenAI from "openai";
import fetch from "node-fetch";
import SystemSettings from "../models/systemSettingsModel.js";
import {
  getSystemSettingsRuntime,
  invalidateSystemSettingsRuntimeCache,
} from "./systemSettingsRuntime.service.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_FAILURE_COOLDOWN_MS = 60_000;
const MAX_FAILURE_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_MODELS_REFRESH_TTL_MS = 15 * 60_000;
const AI_GATEWAY_LOG_LIMIT = 300;

const runtimeState = new Map();
const roundRobinCursor = new Map();
const aiGatewayLogs = [];
let aiGatewayLogSeq = 0;

function trim(value) {
  return String(value || "").trim();
}

function cleanLogText(value, max = 500) {
  const text = trim(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function makeRequestId(prefix = "ai") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function endpointLogMeta(endpoint = {}) {
  return {
    endpointId: trim(endpoint.id),
    endpointLabel: trim(endpoint.label),
    endpointSource: trim(endpoint.source),
    baseUrl: trim(endpoint.baseUrl),
  };
}

export function appendAiGatewayLog(entry = {}) {
  const item = {
    id: ++aiGatewayLogSeq,
    timestamp: new Date().toISOString(),
    requestId: cleanLogText(entry.requestId, 80),
    type: cleanLogText(entry.type || "runtime", 60),
    status: cleanLogText(entry.status || "info", 40),
    scope: cleanLogText(entry.scope, 40),
    operation: cleanLogText(entry.operation, 80),
    endpointId: cleanLogText(entry.endpointId, 120),
    endpointLabel: cleanLogText(entry.endpointLabel, 160),
    endpointSource: cleanLogText(entry.endpointSource, 40),
    baseUrl: cleanLogText(entry.baseUrl, 240),
    model: cleanLogText(entry.model, 160),
    strategy: cleanLogText(entry.strategy, 40),
    latencyMs: Number.isFinite(Number(entry.latencyMs))
      ? Math.round(Number(entry.latencyMs))
      : null,
    modelCount: Number.isFinite(Number(entry.modelCount))
      ? Math.round(Number(entry.modelCount))
      : null,
    message: cleanLogText(entry.message, 500),
    error: cleanLogText(entry.error, 500),
  };

  aiGatewayLogs.push(item);
  if (aiGatewayLogs.length > AI_GATEWAY_LOG_LIMIT) {
    aiGatewayLogs.splice(0, aiGatewayLogs.length - AI_GATEWAY_LOG_LIMIT);
  }
  return item;
}

export function getAiGatewayRequestLogs({ limit = 100, afterId = 0 } = {}) {
  const safeLimit = Math.min(300, Math.max(1, Number(limit) || 100));
  const safeAfterId = Math.max(0, Number(afterId) || 0);
  const logs = safeAfterId
    ? aiGatewayLogs.filter((item) => item.id > safeAfterId)
    : aiGatewayLogs.slice(-safeLimit);
  return logs.slice(-safeLimit);
}

function normalizeOpenAiBaseUrl(value) {
  const base = trim(value).replace(/\/+$/, "");
  if (!base) return undefined;
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function endpointModelsUrl(baseUrl) {
  const normalized = normalizeOpenAiBaseUrl(baseUrl);
  return normalized ? `${normalized}/models` : "";
}

function scopeEnvConfig(scope) {
  if (scope === "cccd") {
    return {
      id: "env-cccd",
      label: "ENV CCCD fallback",
      baseUrl: process.env.OPENAI_CCCD_BASE_URL || "http://127.0.0.1:8317",
      apiKey:
        process.env.OPENAI_CCCD_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.CLIPROXY_API_KEY ||
        "local-cccd",
      model:
        process.env.OPENAI_CCCD_MODEL ||
        process.env.OPENAI_CCCD_DIRECT_MODEL ||
        "gpt-5",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      source: "env",
    };
  }

  if (scope === "poster") {
    return {
      id: "env-poster",
      label: "ENV Poster fallback",
      baseUrl:
        process.env.OPENAI_POSTER_BASE_URL ||
        process.env.OPENAI_CCCD_BASE_URL ||
        "http://127.0.0.1:8317",
      apiKey:
        process.env.OPENAI_POSTER_API_KEY ||
        process.env.OPENAI_CCCD_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.CLIPROXY_API_KEY ||
        "local-poster",
      model:
        process.env.OPENAI_POSTER_VISION_MODEL ||
        process.env.OPENAI_POSTER_MODEL ||
        "gpt-5",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      source: "env",
    };
  }

  return {
    id: "env-default",
    label: "ENV default fallback",
    baseUrl: process.env.CLIPROXY_BASE_URL || "",
    apiKey:
      process.env.CLIPROXY_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "missing-openai-key",
    model:
      process.env.BOT_MODEL ||
      process.env.OPENAI_DEFAULT_MODEL ||
      "gpt-5-codex-mini",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    source: "env",
  };
}

function getScopeConfig(settings, scope) {
  return settings?.aiGateway?.scopes?.[scope] || {};
}

function normalizeConfiguredEndpoint(endpoint, scopeConfig, gateway, envConfig) {
  const id = trim(endpoint?.id);
  const baseUrl = normalizeOpenAiBaseUrl(endpoint?.baseUrl);
  if (!id || !baseUrl || endpoint?.enabled === false) return null;
  const modelCache = endpoint?.modelCache || {};
  const health = endpoint?.health || {};

  return {
    id,
    label: trim(endpoint.label) || id,
    baseUrl,
    apiKey: trim(endpoint.apiKey) || envConfig.apiKey,
    model: trim(scopeConfig.model) || trim(endpoint.defaultModel),
    defaultModel: trim(endpoint.defaultModel),
    envModel: trim(envConfig.model),
    timeoutMs:
      Number(endpoint.timeoutMs) ||
      Number(gateway?.timeoutMs) ||
      DEFAULT_TIMEOUT_MS,
    priority: Number(endpoint.priority) || 100,
    models: Array.isArray(modelCache.models)
      ? modelCache.models.map((model) => trim(model)).filter(Boolean)
      : [],
    modelsUpdatedAt: modelCache.updatedAt || null,
    modelCacheError: trim(modelCache.error),
    health,
    source: "settings",
  };
}

function buildEnvEndpoint(scopeConfig, gateway, envConfig) {
  const baseUrl = normalizeOpenAiBaseUrl(envConfig.baseUrl);
  return {
    id: envConfig.id,
    label: envConfig.label,
    baseUrl,
    apiKey: envConfig.apiKey,
    model: trim(scopeConfig.model) || envConfig.model,
    defaultModel: "",
    envModel: envConfig.model,
    timeoutMs: Number(gateway?.timeoutMs) || envConfig.timeoutMs,
    priority: 9999,
    models: [],
    modelsUpdatedAt: null,
    source: "env",
  };
}

function endpointKey(scope, endpoint) {
  return `${scope}:${endpoint.id}:${endpoint.baseUrl || "openai"}`;
}

function isEndpointCooling(scope, endpoint, now = Date.now()) {
  const state = runtimeState.get(endpointKey(scope, endpoint));
  return state?.cooldownUntil && state.cooldownUntil > now;
}

function markEndpointSuccess(scope, endpoint, meta = {}) {
  runtimeState.set(endpointKey(scope, endpoint), {
    failures: 0,
    lastError: "",
    lastFailureAt: null,
    cooldownUntil: 0,
    lastSuccessAt: new Date().toISOString(),
  });
  persistEndpointHealth(endpoint, {
    status: "ok",
    lastCheckedAt: new Date(),
    lastOkAt: new Date(),
    lastError: "",
    latencyMs: Number(meta.latencyMs) || 0,
    selectedModel: endpoint.selectedModel || "",
  });
}

function markEndpointFailure(scope, endpoint, error, gateway) {
  const key = endpointKey(scope, endpoint);
  const previous = runtimeState.get(key) || {};
  const failures = Number(previous.failures || 0) + 1;
  const baseCooldown =
    Number(gateway?.failureCooldownMs) || DEFAULT_FAILURE_COOLDOWN_MS;
  const cooldownMs = Math.min(
    MAX_FAILURE_COOLDOWN_MS,
    Math.max(1000, baseCooldown * failures),
  );

  runtimeState.set(key, {
    failures,
    lastError: String(error?.message || error || "").slice(0, 500),
    lastFailureAt: new Date().toISOString(),
    cooldownUntil: Date.now() + cooldownMs,
    lastSuccessAt: previous.lastSuccessAt || null,
  });
  persistEndpointHealth(endpoint, {
    status: "error",
    lastCheckedAt: new Date(),
    lastError: String(error?.message || error || "").slice(0, 500),
    selectedModel: endpoint.selectedModel || "",
  });
}

function rotateEndpoints(scope, operation, endpoints) {
  if (!endpoints.length) return endpoints;
  const key = `${scope}:${operation}`;
  const cursor = Number(roundRobinCursor.get(key) || 0) % endpoints.length;
  roundRobinCursor.set(key, cursor + 1);
  return [...endpoints.slice(cursor), ...endpoints.slice(0, cursor)];
}

function persistEndpointHealth(endpoint, patch = {}) {
  if (!endpoint || endpoint.source !== "settings" || !endpoint.id) return;
  const update = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    update[`aiGateway.endpoints.$.health.${key}`] = value;
  }
  if (!Object.keys(update).length) return;

  void SystemSettings.updateOne(
    { _id: "system", "aiGateway.endpoints.id": endpoint.id },
    { $set: update },
  )
    .then(() => invalidateSystemSettingsRuntimeCache())
    .catch((error) => {
      console.warn("[ai-gateway] cannot persist endpoint health:", error?.message);
    });
}

function persistEndpointModelCache(endpoint, { models = [], error = "" } = {}) {
  if (!endpoint || endpoint.source !== "settings" || !endpoint.id) return;
  void SystemSettings.updateOne(
    { _id: "system", "aiGateway.endpoints.id": endpoint.id },
    {
      $set: {
        "aiGateway.endpoints.$.modelCache.models": models,
        "aiGateway.endpoints.$.modelCache.updatedAt": new Date(),
        "aiGateway.endpoints.$.modelCache.error": error,
      },
    },
  )
    .then(() => invalidateSystemSettingsRuntimeCache())
    .catch((updateError) => {
      console.warn("[ai-gateway] cannot persist model cache:", updateError?.message);
    });
}

async function getRuntimeEndpoints(scope) {
  const settings = await getSystemSettingsRuntime();
  const gateway = settings?.aiGateway || {};
  const scopeConfig = getScopeConfig(settings, scope);
  const envConfig = scopeEnvConfig(scope);

  const configuredIds = Array.isArray(scopeConfig.endpointIds)
    ? scopeConfig.endpointIds.map((id) => trim(id)).filter(Boolean)
    : [];
  const configuredIdSet = new Set(configuredIds);
  const configured = gateway?.enabled === false || scopeConfig.enabled === false
    ? []
    : (Array.isArray(gateway.endpoints) ? gateway.endpoints : [])
        .filter((endpoint) => {
          if (!configuredIdSet.size) return true;
          return configuredIdSet.has(trim(endpoint?.id));
        })
        .map((endpoint) =>
          normalizeConfiguredEndpoint(endpoint, scopeConfig, gateway, envConfig),
        )
        .filter(Boolean)
        .sort((a, b) => a.priority - b.priority);

  if (scopeConfig.fallbackToEnv === false && configured.length) {
    return { settings, gateway, scopeConfig, endpoints: configured };
  }

  const envEndpoint = buildEnvEndpoint(scopeConfig, gateway, envConfig);
  const hasSameBase = configured.some(
    (endpoint) => endpoint.baseUrl === envEndpoint.baseUrl,
  );

  const endpoints =
    configured.length && hasSameBase
      ? configured
      : [...configured, envEndpoint].filter(
          (endpoint) => endpoint.baseUrl || endpoint.source === "env",
        );

  return { settings, gateway, scopeConfig, endpoints };
}

function createOpenAiClient(endpoint) {
  return new OpenAI({
    apiKey: endpoint.apiKey || "missing-openai-key",
    baseURL: endpoint.baseUrl || undefined,
    timeout: endpoint.timeoutMs || DEFAULT_TIMEOUT_MS,
  });
}

function modelExists(models, model) {
  if (!trim(model)) return false;
  return models.some((item) => item === model);
}

export function choosePreferredAiGatewayModel(scope, operation, models = []) {
  const list = models.map((model) => trim(model)).filter(Boolean);
  if (!list.length) return "";

  const embeddingRules = [
    /^text-embedding-3-large$/i,
    /^text-embedding-3-small$/i,
    /embedding/i,
  ];
  const visionRules = [
    /^gpt-5/i,
    /^gpt-4\.1/i,
    /^gpt-4o/i,
    /vision/i,
    /gemini.*flash/i,
    /flash/i,
    /sonnet/i,
  ];
  const defaultRules = [
    /^gpt-5/i,
    /^gpt-4\.1/i,
    /^gpt-4o/i,
    /gemini.*flash/i,
    /flash/i,
    /sonnet/i,
    /mini/i,
  ];

  const rules =
    operation === "embeddings.create"
      ? embeddingRules
      : scope === "cccd" || scope === "poster"
        ? visionRules
        : defaultRules;

  for (const rule of rules) {
    const found = list.find((model) => rule.test(model));
    if (found) return found;
  }

  return list[0] || "";
}

function resolveSmartModel({ scope, operation, payload, endpoint }) {
  const models = Array.isArray(endpoint.models) ? endpoint.models : [];
  const candidates = [
    trim(endpoint.model),
    trim(endpoint.defaultModel),
    trim(payload?.model),
    trim(endpoint.envModel),
  ].filter(Boolean);

  if (!models.length) {
    return candidates[0] || "";
  }

  const supported = candidates.find((model) => modelExists(models, model));
  if (supported) return supported;

  return choosePreferredAiGatewayModel(scope, operation, models);
}

function isModelCacheFresh(endpoint, ttlMs) {
  if (!endpoint?.modelsUpdatedAt || !Array.isArray(endpoint.models)) return false;
  const updatedAt = new Date(endpoint.modelsUpdatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt <= ttlMs;
}

async function ensureEndpointModels(endpoint, gateway, logContext = {}) {
  if (!endpoint || endpoint.source !== "settings") return endpoint;
  const ttlMs =
    Number(gateway?.modelsRefreshTtlMs) || DEFAULT_MODELS_REFRESH_TTL_MS;
  if (isModelCacheFresh(endpoint, ttlMs)) {
    appendAiGatewayLog({
      ...logContext,
      ...endpointLogMeta(endpoint),
      type: "models",
      status: "cache",
      modelCount: endpoint.models.length,
      message: "Dùng model cache còn hạn.",
    });
    return endpoint;
  }

  try {
    const result = await fetchAiGatewayModels({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      timeoutMs: Math.min(endpoint.timeoutMs || DEFAULT_TIMEOUT_MS, 30000),
      logContext: {
        ...logContext,
        ...endpointLogMeta(endpoint),
        type: "models",
      },
    });
    const models = result.models || [];
    persistEndpointModelCache(endpoint, { models, error: "" });
    return {
      ...endpoint,
      models,
      modelsUpdatedAt: new Date().toISOString(),
      modelCacheError: "",
    };
  } catch (error) {
    persistEndpointModelCache(endpoint, {
      models: endpoint.models || [],
      error: String(error?.message || error || "").slice(0, 500),
    });
    return {
      ...endpoint,
      modelCacheError: String(error?.message || error || "").slice(0, 500),
    };
  }
}

function withResolvedModel(scope, operation, payload, endpoint) {
  if (!payload || typeof payload !== "object") return payload;
  const model = resolveSmartModel({ scope, operation, payload, endpoint });
  if (!model) return payload;
  endpoint.selectedModel = model;
  return { ...payload, model };
}

async function callOperation(client, scope, operation, args, endpoint, requestId) {
  const payload = withResolvedModel(scope, operation, args[0], endpoint);
  const rest = args.slice(1);
  appendAiGatewayLog({
    requestId,
    scope,
    operation,
    ...endpointLogMeta(endpoint),
    type: "request",
    status: "sending",
    model: endpoint.selectedModel || trim(payload?.model),
    message: "Đang gửi request AI.",
  });

  if (operation === "chat.completions.create") {
    return client.chat.completions.create(payload, ...rest);
  }
  if (operation === "responses.create") {
    return client.responses.create(payload, ...rest);
  }
  if (operation === "embeddings.create") {
    return client.embeddings.create(payload, ...rest);
  }

  throw new Error(`Unsupported AI gateway operation: ${operation}`);
}

export async function runAiGatewayOperation(scope, operation, args) {
  const { gateway, endpoints } = await getRuntimeEndpoints(scope);
  const requestId = makeRequestId(scope || "ai");
  if (!endpoints.length) {
    appendAiGatewayLog({
      requestId,
      scope,
      operation,
      type: "request",
      status: "error",
      message: `Không có AI endpoint khả dụng cho scope ${scope}.`,
    });
    throw new Error(`Không có AI endpoint khả dụng cho scope ${scope}`);
  }

  appendAiGatewayLog({
    requestId,
    scope,
    operation,
    type: "request",
    status: "start",
    strategy: gateway?.strategy || "failover",
    model: trim(args?.[0]?.model),
    message: `Bắt đầu request AI với ${endpoints.length} endpoint khả dụng.`,
  });

  const rotated =
    gateway?.strategy === "roundRobin"
      ? rotateEndpoints(scope, operation, endpoints)
      : endpoints;
  const now = Date.now();
  const available = rotated.filter(
    (endpoint) => !isEndpointCooling(scope, endpoint, now),
  );
  const candidates = available.length ? available : rotated;
  const errors = [];

  for (const endpoint of candidates) {
    let activeEndpoint = endpoint;
    const attemptStartedAt = Date.now();
    try {
      appendAiGatewayLog({
        requestId,
        scope,
        operation,
        ...endpointLogMeta(endpoint),
        type: "request",
        status: "attempt",
        strategy: gateway?.strategy || "failover",
        message: "Đang thử endpoint.",
      });
      activeEndpoint = await ensureEndpointModels(endpoint, gateway, {
        requestId,
        scope,
        operation,
      });
      const client = createOpenAiClient(activeEndpoint);
      const startedAt = Date.now();
      const result = await callOperation(
        client,
        scope,
        operation,
        args,
        activeEndpoint,
        requestId,
      );
      const latencyMs = Date.now() - startedAt;
      markEndpointSuccess(scope, activeEndpoint, {
        latencyMs,
      });
      appendAiGatewayLog({
        requestId,
        scope,
        operation,
        ...endpointLogMeta(activeEndpoint),
        type: "request",
        status: "ok",
        model: activeEndpoint.selectedModel,
        latencyMs,
        message: "Request AI thành công.",
      });
      return result;
    } catch (error) {
      markEndpointFailure(scope, activeEndpoint, error, gateway);
      appendAiGatewayLog({
        requestId,
        scope,
        operation,
        ...endpointLogMeta(activeEndpoint),
        type: "request",
        status: "error",
        model: activeEndpoint.selectedModel,
        latencyMs: Date.now() - attemptStartedAt,
        error: String(error?.message || error || ""),
        message: "Endpoint trả lỗi, runtime sẽ thử endpoint tiếp theo nếu còn.",
      });
      errors.push(
        `${endpoint.label || endpoint.id}: ${String(error?.message || error)}`,
      );
    }
  }

  appendAiGatewayLog({
    requestId,
    scope,
    operation,
    type: "request",
    status: "failed_all",
    error: errors.join(" | "),
    message: "Tất cả endpoint đều lỗi.",
  });
  throw new Error(
    `Tất cả AI endpoint đều lỗi cho scope ${scope}: ${errors.join(" | ")}`,
  );
}

export function createAiGatewayClient(scope) {
  return {
    chat: {
      completions: {
        create: (...args) =>
          runAiGatewayOperation(scope, "chat.completions.create", args),
      },
    },
    responses: {
      create: (...args) => runAiGatewayOperation(scope, "responses.create", args),
    },
    embeddings: {
      create: (...args) =>
        runAiGatewayOperation(scope, "embeddings.create", args),
    },
  };
}

function extractModelIds(payload) {
  const rawList = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];

  return rawList
    .map((item) => {
      if (typeof item === "string") return item;
      return trim(item?.id || item?.name || item?.model);
    })
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

export async function fetchAiGatewayModels({
  baseUrl,
  apiKey,
  timeoutMs,
  logContext,
} = {}) {
  const url = endpointModelsUrl(baseUrl);
  if (!url) {
    appendAiGatewayLog({
      ...(logContext || {}),
      type: "models",
      status: "error",
      baseUrl,
      error: "Thiếu base URL để tải danh sách model.",
    });
    throw new Error("Thiếu base URL để tải danh sách model");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number(timeoutMs) || DEFAULT_TIMEOUT_MS,
  );
  const startedAt = Date.now();
  if (logContext) {
    appendAiGatewayLog({
      ...logContext,
      type: logContext.type || "models",
      status: "sending",
      baseUrl: normalizeOpenAiBaseUrl(baseUrl),
      message: "Đang gọi /models.",
    });
  }

  try {
    const headers = { Accept: "application/json" };
    if (trim(apiKey)) headers.Authorization = `Bearer ${trim(apiKey)}`;
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      throw new Error(
        json?.error?.message || json?.message || `HTTP ${response.status}`,
      );
    }
    const result = {
      url,
      models: extractModelIds(json),
      rawCount: Array.isArray(json?.data)
        ? json.data.length
        : Array.isArray(json?.models)
          ? json.models.length
          : 0,
    };
    if (logContext) {
      appendAiGatewayLog({
        ...logContext,
        type: logContext.type || "models",
        status: "ok",
        baseUrl: normalizeOpenAiBaseUrl(baseUrl),
        latencyMs: Date.now() - startedAt,
        modelCount: result.models.length,
        message: "Đã tải danh sách model.",
      });
    }
    return result;
  } catch (error) {
    if (logContext) {
      appendAiGatewayLog({
        ...logContext,
        type: logContext.type || "models",
        status: "error",
        baseUrl: normalizeOpenAiBaseUrl(baseUrl),
        latencyMs: Date.now() - startedAt,
        error: String(error?.message || error || ""),
        message: "Không tải được danh sách model.",
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function getAiGatewayHealthSnapshot() {
  const now = Date.now();
  return Array.from(runtimeState.entries()).map(([key, value]) => ({
    key,
    failures: Number(value.failures || 0),
    lastError: value.lastError || "",
    lastFailureAt: value.lastFailureAt || null,
    lastSuccessAt: value.lastSuccessAt || null,
    cooldownUntil: value.cooldownUntil
      ? new Date(value.cooldownUntil).toISOString()
      : null,
    cooling: Boolean(value.cooldownUntil && value.cooldownUntil > now),
  }));
}

export function getAiGatewayEnvFallbacks() {
  return ["cccd", "poster", "default"].reduce((acc, scope) => {
    const cfg = scopeEnvConfig(scope);
    acc[scope] = {
      baseUrl: normalizeOpenAiBaseUrl(cfg.baseUrl) || "https://api.openai.com/v1",
      model: cfg.model,
      apiKeySet: Boolean(cfg.apiKey && !/^missing-/i.test(cfg.apiKey)),
    };
    return acc;
  }, {});
}
