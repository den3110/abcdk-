import crypto from "crypto";
import SystemSettings from "../../models/systemSettingsModel.js";
import {
  ensureSystemSettingsDocument,
  invalidateSystemSettingsRuntimeCache,
  normalizeSystemSettings,
} from "../../services/systemSettingsRuntime.service.js";
import {
  fetchAiGatewayModels,
  getAiGatewayEnvFallbacks,
  getAiGatewayHealthSnapshot,
} from "../../services/aiGatewayRuntime.service.js";

const SCOPE_KEYS = ["cccd", "poster", "default"];

function trim(value) {
  return String(value || "").trim();
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeBaseUrl(value) {
  const base = trim(value).replace(/\/+$/, "");
  if (!base) return "";
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function keepExistingSecret(nextValue, previousValue) {
  const next = trim(nextValue);
  if (next) return next;
  return trim(previousValue);
}

function maskEndpoint(endpoint = {}) {
  return {
    id: trim(endpoint.id),
    label: trim(endpoint.label),
    baseUrl: trim(endpoint.baseUrl),
    enabled: endpoint.enabled !== false,
    priority: Number(endpoint.priority) || 100,
    timeoutMs: Number(endpoint.timeoutMs) || 45000,
    defaultModel: trim(endpoint.defaultModel),
    notes: trim(endpoint.notes),
    apiKey: "",
    apiKeySet: Boolean(trim(endpoint.apiKey)),
  };
}

function sanitizeScope(scope = {}) {
  return {
    enabled: scope.enabled !== false,
    endpointIds: Array.isArray(scope.endpointIds)
      ? scope.endpointIds.map((id) => trim(id)).filter(Boolean)
      : [],
    model: trim(scope.model),
    fallbackToEnv: scope.fallbackToEnv !== false,
  };
}

function sanitizeAiGatewayPayload(payload = {}, previous = {}) {
  const previousById = new Map(
    (Array.isArray(previous.endpoints) ? previous.endpoints : [])
      .filter((endpoint) => trim(endpoint?.id))
      .map((endpoint) => [trim(endpoint.id), endpoint]),
  );

  const endpoints = (Array.isArray(payload.endpoints) ? payload.endpoints : [])
    .map((endpoint) => {
      const id = trim(endpoint.id) || crypto.randomUUID();
      const previousEndpoint = previousById.get(id) || {};
      return {
        id,
        label: trim(endpoint.label) || trim(previousEndpoint.label) || "AI endpoint",
        baseUrl: normalizeBaseUrl(endpoint.baseUrl),
        apiKey: keepExistingSecret(endpoint.apiKey, previousEndpoint.apiKey),
        enabled: endpoint.enabled !== false,
        priority: clampNumber(endpoint.priority, 100, 1, 10000),
        timeoutMs: clampNumber(endpoint.timeoutMs, 45000, 1000, 300000),
        defaultModel: trim(endpoint.defaultModel),
        notes: trim(endpoint.notes),
      };
    })
    .filter((endpoint) => endpoint.baseUrl);

  const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
  const scopes = {};
  for (const scopeKey of SCOPE_KEYS) {
    const scope = sanitizeScope(payload.scopes?.[scopeKey] || previous.scopes?.[scopeKey] || {});
    scope.endpointIds = scope.endpointIds.filter((id) => endpointIds.has(id));
    scopes[scopeKey] = scope;
  }

  return {
    enabled: payload.enabled !== false,
    strategy: payload.strategy === "roundRobin" ? "roundRobin" : "failover",
    timeoutMs: clampNumber(payload.timeoutMs, 45000, 1000, 300000),
    failureCooldownMs: clampNumber(
      payload.failureCooldownMs,
      60000,
      1000,
      600000,
    ),
    endpoints,
    scopes,
  };
}

function buildAdminAiGatewayResponse(settings) {
  const aiGateway = settings?.aiGateway || {};
  return {
    config: {
      ...aiGateway,
      endpoints: (aiGateway.endpoints || []).map(maskEndpoint),
    },
    envFallbacks: getAiGatewayEnvFallbacks(),
    health: getAiGatewayHealthSnapshot(),
  };
}

async function getSavedEndpoint(endpointId) {
  if (!endpointId) return null;
  const doc = await ensureSystemSettingsDocument();
  const settings = normalizeSystemSettings(doc);
  return (settings.aiGateway?.endpoints || []).find(
    (endpoint) => trim(endpoint.id) === trim(endpointId),
  );
}

export async function getAiGatewayConfig(req, res, next) {
  try {
    const doc = await ensureSystemSettingsDocument();
    const settings = normalizeSystemSettings(doc);
    res.json(buildAdminAiGatewayResponse(settings));
  } catch (error) {
    next(error);
  }
}

export async function updateAiGatewayConfig(req, res, next) {
  try {
    const doc = await ensureSystemSettingsDocument();
    const previous = normalizeSystemSettings(doc);
    const aiGateway = sanitizeAiGatewayPayload(
      req.body?.aiGateway || req.body || {},
      previous.aiGateway || {},
    );

    const updated = await SystemSettings.findByIdAndUpdate(
      "system",
      {
        $set: {
          aiGateway,
          updatedAt: new Date(),
          ...(req.user?._id ? { updatedBy: req.user._id } : {}),
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    invalidateSystemSettingsRuntimeCache();
    res.json(buildAdminAiGatewayResponse(normalizeSystemSettings(updated)));
  } catch (error) {
    next(error);
  }
}

export async function listAiGatewayModels(req, res, next) {
  try {
    const endpointId = trim(req.body?.endpointId);
    const saved = await getSavedEndpoint(endpointId);
    const baseUrl = normalizeBaseUrl(req.body?.baseUrl || saved?.baseUrl);
    const apiKey =
      trim(req.body?.apiKey) ||
      trim(saved?.apiKey) ||
      trim(process.env.OPENAI_API_KEY) ||
      trim(process.env.CLIPROXY_API_KEY);
    const timeoutMs = clampNumber(
      req.body?.timeoutMs || saved?.timeoutMs,
      45000,
      1000,
      300000,
    );

    const result = await fetchAiGatewayModels({ baseUrl, apiKey, timeoutMs });
    res.json({
      ok: true,
      endpointId,
      baseUrl,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function testAiGatewayEndpoint(req, res, next) {
  try {
    const endpointId = trim(req.body?.endpointId);
    const saved = await getSavedEndpoint(endpointId);
    const baseUrl = normalizeBaseUrl(req.body?.baseUrl || saved?.baseUrl);
    const apiKey =
      trim(req.body?.apiKey) ||
      trim(saved?.apiKey) ||
      trim(process.env.OPENAI_API_KEY) ||
      trim(process.env.CLIPROXY_API_KEY);
    const timeoutMs = clampNumber(
      req.body?.timeoutMs || saved?.timeoutMs,
      45000,
      1000,
      300000,
    );
    const startedAt = Date.now();
    const result = await fetchAiGatewayModels({ baseUrl, apiKey, timeoutMs });

    res.json({
      ok: true,
      endpointId,
      baseUrl,
      latencyMs: Date.now() - startedAt,
      modelCount: result.models.length,
      models: result.models.slice(0, 50),
    });
  } catch (error) {
    next(error);
  }
}
