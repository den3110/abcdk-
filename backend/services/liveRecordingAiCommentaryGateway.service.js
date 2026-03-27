import axios from "axios";
import OpenAI from "openai";

import { OPENAI_DEFAULT_MODEL } from "../lib/openaiClient.js";
import SystemSettings from "../models/systemSettingsModel.js";

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_TTS_MODEL =
  process.env.LIVE_RECORDING_AI_TTS_MODEL || "gpt-4o-mini-tts";
const DEFAULT_SCRIPT_MODEL =
  process.env.LIVE_RECORDING_AI_SCRIPT_MODEL ||
  OPENAI_DEFAULT_MODEL ||
  "gpt-5-codex-mini";
const HEALTH_CACHE_TTL_MS = 30000;

const VOICE_PRESETS = {
  vi_male_pro: {
    id: "vi_male_pro",
    language: "vi",
    gender: "male",
    label: "Viet Nam nam chuyen nghiep",
    providerVoiceId: process.env.LIVE_RECORDING_AI_VOICE_VI_MALE || "alloy",
    defaultSpeed: 1,
    stylePrompt:
      "Binh luan vien nam chuyen nghiep, ro nhip, giau nang luong vua phai.",
  },
  vi_female_pro: {
    id: "vi_female_pro",
    language: "vi",
    gender: "female",
    label: "Viet Nam nu chuyen nghiep",
    providerVoiceId: process.env.LIVE_RECORDING_AI_VOICE_VI_FEMALE || "nova",
    defaultSpeed: 1,
    stylePrompt:
      "Binh luan vien nu truyen cam, chuyen nghiep, sang ro va tu tin.",
  },
  en_male_pro: {
    id: "en_male_pro",
    language: "en",
    gender: "male",
    label: "English male pro",
    providerVoiceId: process.env.LIVE_RECORDING_AI_VOICE_EN_MALE || "alloy",
    defaultSpeed: 1,
    stylePrompt:
      "Professional male sports commentator, clear, composed, energetic.",
  },
  en_female_pro: {
    id: "en_female_pro",
    language: "en",
    gender: "female",
    label: "English female pro",
    providerVoiceId: process.env.LIVE_RECORDING_AI_VOICE_EN_FEMALE || "nova",
    defaultSpeed: 1,
    stylePrompt:
      "Professional female sports commentator, expressive, polished, vivid.",
  },
};

const TONE_PRESETS = {
  professional: {
    id: "professional",
    label: "Chuyen nghiep",
    instructions:
      "Giu giong binh luan vien chuyen nghiep, can bang, chuan phat thanh the thao.",
    speed: 1,
  },
  energetic: {
    id: "energetic",
    label: "Nang luong",
    instructions:
      "Giong giau nang luong, dut khoat, nhan manh cac pha cao trao nhung khong gao thet.",
    speed: 1.03,
  },
  dramatic: {
    id: "dramatic",
    label: "Kich tinh",
    instructions:
      "Giong co cam xuc, biet keo nhip o thoi diem then chot, tang do hoi hop vua phai.",
    speed: 0.98,
  },
};

let cachedHealth = null;
let scriptClientCache = null;
let ttsClientCache = null;

function safeText(value) {
  return String(value || "").trim();
}

function cleanBaseUrl(value = "") {
  let next = safeText(value);
  if (!next) return "";
  next = next.replace(/\/+$/, "");
  next = next.replace(/\/responses$/i, "");
  next = next.replace(/\/models$/i, "");
  next = next.replace(/\/audio\/speech$/i, "");
  return next;
}

function buildScriptUrls(baseUrl = "") {
  const normalizedBaseUrl = cleanBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return { baseUrl: "", responsesUrl: "", modelsUrl: "" };
  }
  return {
    baseUrl: normalizedBaseUrl,
    responsesUrl: `${normalizedBaseUrl}/responses`,
    modelsUrl: `${normalizedBaseUrl}/models`,
  };
}

function buildTtsUrls(baseUrl = "") {
  const normalizedBaseUrl = cleanBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return { baseUrl: "", speechUrl: "", modelsUrl: "" };
  }
  return {
    baseUrl: normalizedBaseUrl,
    speechUrl: `${normalizedBaseUrl}/audio/speech`,
    modelsUrl: `${normalizedBaseUrl}/models`,
  };
}

async function loadAiCommentaryGatewaySettings() {
  const doc =
    (await SystemSettings.findById("system")
      .select("liveRecording.aiCommentary")
      .lean()
      .catch(() => null)) || {};
  return doc?.liveRecording?.aiCommentary || {};
}

function getScriptConfig(settings = {}) {
  const baseUrl = cleanBaseUrl(
    settings?.scriptBaseUrl || process.env.LIVE_RECORDING_AI_SCRIPT_BASE_URL
  );
  const apiKey = safeText(process.env.LIVE_RECORDING_AI_SCRIPT_API_KEY);
  return {
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    timeoutMs:
      Number(process.env.LIVE_RECORDING_AI_SCRIPT_TIMEOUT_MS) ||
      DEFAULT_TIMEOUT_MS,
    configuredModel:
      safeText(settings?.scriptModel) ||
      safeText(process.env.LIVE_RECORDING_AI_SCRIPT_MODEL) ||
      null,
    ...buildScriptUrls(baseUrl),
  };
}

function getTtsConfig(settings = {}) {
  const baseUrl = cleanBaseUrl(
    settings?.ttsBaseUrl || process.env.LIVE_RECORDING_AI_TTS_BASE_URL
  );
  const isBuiltinAdapter = /\/api\/ai-tts\/v1$/i.test(baseUrl);
  const apiKey =
    safeText(process.env.LIVE_RECORDING_AI_TTS_API_KEY) ||
    (isBuiltinAdapter ? "local-adapter" : "");
  return {
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    timeoutMs:
      Number(process.env.LIVE_RECORDING_AI_TTS_TIMEOUT_MS) ||
      DEFAULT_TIMEOUT_MS,
    configuredModel:
      safeText(settings?.ttsModel) ||
      safeText(process.env.LIVE_RECORDING_AI_TTS_MODEL) ||
      "",
    ...buildTtsUrls(baseUrl),
  };
}

function extractModelIds(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data
    .map((item) => safeText(item?.id || item?.model || item?.name))
    .filter(Boolean);
}

function chooseScriptModel({ configuredModel, availableModels = [] }) {
  if (configuredModel) return configuredModel;
  if (availableModels.length) return availableModels[0];
  return DEFAULT_SCRIPT_MODEL;
}

function chooseTtsModel({ configuredModel, availableModels = [] }) {
  if (configuredModel) return configuredModel;
  if (availableModels.length) return availableModels[0];
  return DEFAULT_TTS_MODEL;
}

function getOpenAiClient(cacheRef, config, cacheStoreSetter) {
  if (!config.apiKeyConfigured || !config.baseUrl) return null;
  const cacheKey = [config.baseUrl, config.apiKey, config.timeoutMs].join("|");
  if (cacheRef?.key === cacheKey && cacheRef?.client) {
    return cacheRef.client;
  }
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
  });
  cacheStoreSetter({ key: cacheKey, client });
  return client;
}

async function probeModels(config, chooseModel) {
  if (!config.apiKeyConfigured || !config.modelsUrl) {
    return {
      status: "not_configured",
      availableModels: [],
      selectedModel: config.configuredModel || null,
      effectiveModel: chooseModel({
        configuredModel: config.configuredModel,
        availableModels: [],
      }),
      message: "not_configured",
    };
  }

  try {
    const response = await axios.get(config.modelsUrl, {
      timeout: Math.max(8000, config.timeoutMs),
      headers: { Authorization: `Bearer ${config.apiKey}` },
      validateStatus: () => true,
    });
    const statusCode = Number(response.status) || 0;
    const availableModels = extractModelIds(response.data);
    return {
      status:
        statusCode === 401 || statusCode === 403
          ? "auth_error"
          : statusCode === 404 || statusCode === 405
          ? "misconfigured"
          : statusCode >= 200 && statusCode < 300
          ? availableModels.length
            ? "online"
            : "degraded"
          : "degraded",
      availableModels,
      selectedModel: config.configuredModel || null,
      effectiveModel: chooseModel({
        configuredModel: config.configuredModel,
        availableModels,
      }),
      message: "ok",
    };
  } catch (error) {
    return {
      status: "degraded",
      availableModels: [],
      selectedModel: config.configuredModel || null,
      effectiveModel: chooseModel({
        configuredModel: config.configuredModel,
        availableModels: [],
      }),
      message: safeText(error?.message) || "gateway_unreachable",
    };
  }
}

export function getAiCommentaryVoicePresets() {
  return Object.values(VOICE_PRESETS);
}

export function getAiCommentaryTonePresets() {
  return Object.values(TONE_PRESETS);
}

export function invalidateLiveRecordingAiCommentaryGatewayHealthCache() {
  cachedHealth = null;
}

export function resolveAiCommentaryVoicePreset(value, fallbackLanguage = "vi") {
  const normalized = safeText(value).toLowerCase();
  if (VOICE_PRESETS[normalized]) return VOICE_PRESETS[normalized];
  return fallbackLanguage === "en"
    ? VOICE_PRESETS.en_male_pro
    : VOICE_PRESETS.vi_male_pro;
}

export function resolveAiCommentaryTonePreset(value) {
  const normalized = safeText(value).toLowerCase();
  return TONE_PRESETS[normalized] || TONE_PRESETS.professional;
}

export async function checkLiveRecordingAiCommentaryGatewayHealth({
  forceRefresh = false,
  settings = null,
} = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedHealth?.expiresAt > now && cachedHealth?.value) {
    return cachedHealth.value;
  }

  const persistedSettings =
    settings || (await loadAiCommentaryGatewaySettings());
  const scriptConfig = getScriptConfig(persistedSettings);
  const ttsConfig = getTtsConfig(persistedSettings);

  const scriptProbe = await probeModels(scriptConfig, chooseScriptModel);
  const ttsProbe = await probeModels(ttsConfig, chooseTtsModel);

  const script = {
    status: scriptProbe.status,
    baseUrl: scriptConfig.baseUrl,
    responsesUrl: scriptConfig.responsesUrl,
    modelsUrl: scriptConfig.modelsUrl,
    availableModels: scriptProbe.availableModels,
    selectedModel: scriptProbe.selectedModel,
    effectiveModel: scriptProbe.effectiveModel,
    message:
      scriptProbe.status === "not_configured"
        ? "AI script route chua cau hinh."
        : scriptProbe.status === "online"
        ? `Script gateway online (${scriptProbe.availableModels.length} models)`
        : scriptProbe.message || `Script gateway ${scriptProbe.status}`,
  };

  const tts = {
    status: ttsProbe.status,
    baseUrl: ttsConfig.baseUrl,
    speechUrl: ttsConfig.speechUrl,
    modelsUrl: ttsConfig.modelsUrl,
    availableModels: ttsProbe.availableModels,
    selectedModel: ttsProbe.selectedModel,
    effectiveModel: ttsProbe.effectiveModel,
    message:
      ttsProbe.status === "not_configured"
        ? "TTS gateway chua cau hinh."
        : ttsProbe.status === "online"
        ? `TTS gateway online (${ttsProbe.availableModels.length} models)`
        : ttsProbe.message || `TTS gateway ${ttsProbe.status}`,
  };

  const value = {
    checkedAt: new Date().toISOString(),
    overallStatus:
      script.status === "online" && tts.status === "online"
        ? "online"
        : script.status === "not_configured" || tts.status === "not_configured"
        ? "not_configured"
        : "degraded",
    script,
    tts,
    presets: {
      voices: getAiCommentaryVoicePresets(),
      tones: getAiCommentaryTonePresets(),
    },
  };

  cachedHealth = {
    value,
    expiresAt: now + HEALTH_CACHE_TTL_MS,
  };

  return value;
}

export function getAiCommentaryScriptClient() {
  const config = getScriptConfig();
  return getOpenAiClient(scriptClientCache, config, (next) => {
    scriptClientCache = next;
  });
}

export function getAiCommentaryTtsClient() {
  const config = getTtsConfig();
  return getOpenAiClient(ttsClientCache, config, (next) => {
    ttsClientCache = next;
  });
}

export async function getLiveRecordingAiCommentaryRuntime() {
  const persistedSettings = await loadAiCommentaryGatewaySettings();
  const health = await checkLiveRecordingAiCommentaryGatewayHealth({
    settings: persistedSettings,
  });
  const scriptConfig = getScriptConfig(persistedSettings);
  const ttsConfig = getTtsConfig(persistedSettings);

  return {
    health,
    script: {
      ...scriptConfig,
      client: getOpenAiClient(scriptClientCache, scriptConfig, (next) => {
        scriptClientCache = next;
      }),
      effectiveModel: health?.script?.effectiveModel || DEFAULT_SCRIPT_MODEL,
      availableModels: health?.script?.availableModels || [],
    },
    tts: {
      ...ttsConfig,
      client: getOpenAiClient(ttsClientCache, ttsConfig, (next) => {
        ttsClientCache = next;
      }),
      effectiveModel:
        health?.tts?.effectiveModel ||
        chooseTtsModel({
          configuredModel: ttsConfig.configuredModel,
          availableModels: [],
        }),
      availableModels: health?.tts?.availableModels || [],
    },
  };
}
