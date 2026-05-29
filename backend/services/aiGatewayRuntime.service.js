import OpenAI from "openai";
import fetch from "node-fetch";
import { getSystemSettingsRuntime } from "./systemSettingsRuntime.service.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_FAILURE_COOLDOWN_MS = 60_000;
const MAX_FAILURE_COOLDOWN_MS = 10 * 60_000;

const runtimeState = new Map();
const roundRobinCursor = new Map();

function trim(value) {
  return String(value || "").trim();
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

  return {
    id,
    label: trim(endpoint.label) || id,
    baseUrl,
    apiKey: trim(endpoint.apiKey) || envConfig.apiKey,
    model: trim(scopeConfig.model) || trim(endpoint.defaultModel),
    envModel: trim(envConfig.model),
    timeoutMs:
      Number(endpoint.timeoutMs) ||
      Number(gateway?.timeoutMs) ||
      DEFAULT_TIMEOUT_MS,
    priority: Number(endpoint.priority) || 100,
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
    envModel: envConfig.model,
    timeoutMs: Number(gateway?.timeoutMs) || envConfig.timeoutMs,
    priority: 9999,
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

function markEndpointSuccess(scope, endpoint) {
  runtimeState.set(endpointKey(scope, endpoint), {
    failures: 0,
    lastError: "",
    lastFailureAt: null,
    cooldownUntil: 0,
    lastSuccessAt: new Date().toISOString(),
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
}

function rotateEndpoints(scope, operation, endpoints) {
  if (!endpoints.length) return endpoints;
  const key = `${scope}:${operation}`;
  const cursor = Number(roundRobinCursor.get(key) || 0) % endpoints.length;
  roundRobinCursor.set(key, cursor + 1);
  return [...endpoints.slice(cursor), ...endpoints.slice(0, cursor)];
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

function withResolvedModel(payload, endpoint) {
  if (!payload || typeof payload !== "object") return payload;
  const model = trim(endpoint.model) || trim(payload.model) || trim(endpoint.envModel);
  if (!model) return payload;
  return { ...payload, model };
}

async function callOperation(client, operation, args, endpoint) {
  const payload = withResolvedModel(args[0], endpoint);
  const rest = args.slice(1);

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
  if (!endpoints.length) {
    throw new Error(`Không có AI endpoint khả dụng cho scope ${scope}`);
  }

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
    try {
      const client = createOpenAiClient(endpoint);
      const result = await callOperation(client, operation, args, endpoint);
      markEndpointSuccess(scope, endpoint);
      return result;
    } catch (error) {
      markEndpointFailure(scope, endpoint, error, gateway);
      errors.push(
        `${endpoint.label || endpoint.id}: ${String(error?.message || error)}`,
      );
    }
  }

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

export async function fetchAiGatewayModels({ baseUrl, apiKey, timeoutMs } = {}) {
  const url = endpointModelsUrl(baseUrl);
  if (!url) throw new Error("Thiếu base URL để tải danh sách model");

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number(timeoutMs) || DEFAULT_TIMEOUT_MS,
  );

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
    return {
      url,
      models: extractModelIds(json),
      rawCount: Array.isArray(json?.data)
        ? json.data.length
        : Array.isArray(json?.models)
          ? json.models.length
          : 0,
    };
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
