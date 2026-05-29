import crypto from "crypto";
import SystemSettings from "../../models/systemSettingsModel.js";
import {
  ensureSystemSettingsDocument,
  invalidateSystemSettingsRuntimeCache,
  normalizeSystemSettings,
} from "../../services/systemSettingsRuntime.service.js";
import {
  choosePreferredAiGatewayModel,
  fetchAiGatewayModels,
  getAiGatewayEnvFallbacks,
  getAiGatewayHealthSnapshot,
  getAiGatewayRequestLogs,
} from "../../services/aiGatewayRuntime.service.js";

const SCOPE_KEYS = ["cccd", "poster", "default"];

function makeAdminRequestId() {
  return `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  const models = Array.isArray(endpoint.modelCache?.models)
    ? endpoint.modelCache.models.map((model) => trim(model)).filter(Boolean)
    : [];
  return {
    id: trim(endpoint.id),
    label: trim(endpoint.label),
    baseUrl: trim(endpoint.baseUrl),
    enabled: endpoint.enabled !== false,
    priority: Number(endpoint.priority) || 100,
    timeoutMs: Number(endpoint.timeoutMs) || 45000,
    defaultModel: trim(endpoint.defaultModel),
    notes: trim(endpoint.notes),
    modelCache: {
      models,
      updatedAt: endpoint.modelCache?.updatedAt || null,
      error: trim(endpoint.modelCache?.error),
    },
    health: {
      status: trim(endpoint.health?.status) || "unknown",
      lastCheckedAt: endpoint.health?.lastCheckedAt || null,
      lastOkAt: endpoint.health?.lastOkAt || null,
      lastError: trim(endpoint.health?.lastError),
      latencyMs: Number(endpoint.health?.latencyMs) || 0,
      selectedModel: trim(endpoint.health?.selectedModel),
    },
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
      const baseUrl = normalizeBaseUrl(endpoint.baseUrl);
      const shouldKeepSmartState =
        normalizeBaseUrl(previousEndpoint.baseUrl) === baseUrl && !trim(endpoint.apiKey);
      return {
        id,
        label: trim(endpoint.label) || trim(previousEndpoint.label) || "AI endpoint",
        baseUrl,
        apiKey: keepExistingSecret(endpoint.apiKey, previousEndpoint.apiKey),
        enabled: endpoint.enabled !== false,
        priority: clampNumber(endpoint.priority, 100, 1, 10000),
        timeoutMs: clampNumber(endpoint.timeoutMs, 45000, 1000, 300000),
        defaultModel: trim(endpoint.defaultModel),
        notes: trim(endpoint.notes),
        modelCache: {
          models:
            shouldKeepSmartState && Array.isArray(previousEndpoint.modelCache?.models)
              ? previousEndpoint.modelCache.models
              : [],
          updatedAt: shouldKeepSmartState
            ? previousEndpoint.modelCache?.updatedAt || undefined
            : undefined,
          error: shouldKeepSmartState ? trim(previousEndpoint.modelCache?.error) : "",
        },
        health: {
          status: shouldKeepSmartState
            ? trim(previousEndpoint.health?.status) || "unknown"
            : "unknown",
          lastCheckedAt: shouldKeepSmartState
            ? previousEndpoint.health?.lastCheckedAt || undefined
            : undefined,
          lastOkAt: shouldKeepSmartState
            ? previousEndpoint.health?.lastOkAt || undefined
            : undefined,
          lastError: shouldKeepSmartState ? trim(previousEndpoint.health?.lastError) : "",
          latencyMs: shouldKeepSmartState
            ? Number(previousEndpoint.health?.latencyMs) || 0
            : 0,
          selectedModel: shouldKeepSmartState
            ? trim(previousEndpoint.health?.selectedModel)
            : "",
        },
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
    modelsRefreshTtlMs: clampNumber(
      payload.modelsRefreshTtlMs,
      900000,
      60000,
      86400000,
    ),
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

async function updateEndpointSmartState(endpointId, patch = {}) {
  const set = {};
  if (patch.modelCache) {
    set["aiGateway.endpoints.$.modelCache"] = patch.modelCache;
  }
  if (patch.health) {
    set["aiGateway.endpoints.$.health"] = patch.health;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultModel")) {
    set["aiGateway.endpoints.$.defaultModel"] = trim(patch.defaultModel);
  }
  if (!Object.keys(set).length) return;

  await SystemSettings.updateOne(
    { _id: "system", "aiGateway.endpoints.id": endpointId },
    { $set: set },
  );
  invalidateSystemSettingsRuntimeCache();
}

function getEndpointSecret(endpoint = {}, body = {}) {
  return (
    trim(body.apiKey) ||
    trim(endpoint.apiKey) ||
    trim(process.env.OPENAI_API_KEY) ||
    trim(process.env.CLIPROXY_API_KEY)
  );
}

function pickSmartDefaultModel(endpoint, models) {
  if (endpoint.defaultModel && models.includes(endpoint.defaultModel)) {
    return endpoint.defaultModel;
  }
  return choosePreferredAiGatewayModel("cccd", "chat.completions.create", models);
}

async function refreshOneEndpoint(endpoint, body = {}) {
  const baseUrl = normalizeBaseUrl(body.baseUrl || endpoint?.baseUrl);
  const apiKey = getEndpointSecret(endpoint, body);
  const timeoutMs = clampNumber(
    body.timeoutMs || endpoint?.timeoutMs,
    45000,
    1000,
    300000,
  );
  const startedAt = Date.now();
  const result = await fetchAiGatewayModels({
    baseUrl,
    apiKey,
    timeoutMs,
    logContext: {
      requestId: makeAdminRequestId(),
      scope: "admin",
      operation: "models.refresh",
      endpointId: trim(endpoint?.id),
      endpointLabel: trim(endpoint?.label),
      endpointSource: "settings",
      baseUrl,
    },
  });
  const models = result.models || [];
  const selectedModel = pickSmartDefaultModel(endpoint || {}, models);
  const checkedAt = new Date();

  if (endpoint?.id) {
    await updateEndpointSmartState(endpoint.id, {
      defaultModel: selectedModel || endpoint.defaultModel,
      modelCache: {
        models,
        updatedAt: checkedAt,
        error: "",
      },
      health: {
        status: "ok",
        lastCheckedAt: checkedAt,
        lastOkAt: checkedAt,
        lastError: "",
        latencyMs: Date.now() - startedAt,
        selectedModel,
      },
    });
  }

  return {
    ok: true,
    endpointId: endpoint?.id || "",
    baseUrl,
    latencyMs: Date.now() - startedAt,
    modelCount: models.length,
    selectedModel,
    models,
    url: result.url,
  };
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
    const result = await refreshOneEndpoint(saved || { id: endpointId }, req.body || {});
    res.json(result);
  } catch (error) {
    const endpointId = trim(req.body?.endpointId);
    if (endpointId) {
      await updateEndpointSmartState(endpointId, {
        modelCache: {
          models: [],
          updatedAt: new Date(),
          error: String(error?.message || error || "").slice(0, 500),
        },
        health: {
          status: "error",
          lastCheckedAt: new Date(),
          lastError: String(error?.message || error || "").slice(0, 500),
          latencyMs: 0,
          selectedModel: "",
        },
      }).catch(() => {});
    }
    next(error);
  }
}

export async function testAiGatewayEndpoint(req, res, next) {
  try {
    const endpointId = trim(req.body?.endpointId);
    const saved = await getSavedEndpoint(endpointId);
    const result = await refreshOneEndpoint(saved || { id: endpointId }, req.body || {});
    res.json({
      ok: true,
      endpointId: result.endpointId,
      baseUrl: result.baseUrl,
      latencyMs: result.latencyMs,
      modelCount: result.modelCount,
      selectedModel: result.selectedModel,
      models: result.models.slice(0, 50),
    });
  } catch (error) {
    const endpointId = trim(req.body?.endpointId);
    if (endpointId) {
      await updateEndpointSmartState(endpointId, {
        health: {
          status: "error",
          lastCheckedAt: new Date(),
          lastError: String(error?.message || error || "").slice(0, 500),
          latencyMs: 0,
          selectedModel: "",
        },
      }).catch(() => {});
    }
    next(error);
  }
}

export async function refreshAiGatewayEndpoints(req, res, next) {
  try {
    const doc = await ensureSystemSettingsDocument();
    const settings = normalizeSystemSettings(doc);
    const endpoints = (settings.aiGateway?.endpoints || []).filter(
      (endpoint) => endpoint.enabled !== false && trim(endpoint.baseUrl),
    );
    const results = [];

    for (const endpoint of endpoints) {
      try {
        results.push(await refreshOneEndpoint(endpoint));
      } catch (error) {
        const checkedAt = new Date();
        const message = String(error?.message || error || "").slice(0, 500);
        await updateEndpointSmartState(endpoint.id, {
          modelCache: {
            models: Array.isArray(endpoint.modelCache?.models)
              ? endpoint.modelCache.models
              : [],
            updatedAt: checkedAt,
            error: message,
          },
          health: {
            status: "error",
            lastCheckedAt: checkedAt,
            lastOkAt: endpoint.health?.lastOkAt || undefined,
            lastError: message,
            latencyMs: 0,
            selectedModel: "",
          },
        });
        results.push({
          ok: false,
          endpointId: endpoint.id,
          baseUrl: endpoint.baseUrl,
          error: message,
        });
      }
    }

    const updated = await ensureSystemSettingsDocument();
    res.json({
      ok: results.every((item) => item.ok),
      total: results.length,
      results,
      ...buildAdminAiGatewayResponse(normalizeSystemSettings(updated)),
    });
  } catch (error) {
    next(error);
  }
}

export async function getAiGatewayLogs(req, res, next) {
  try {
    const logs = getAiGatewayRequestLogs({
      limit: req.query?.limit,
      afterId: req.query?.afterId,
    });
    res.json({
      logs,
      latestId: logs.length ? logs[logs.length - 1].id : 0,
    });
  } catch (error) {
    next(error);
  }
}
