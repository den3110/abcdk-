// src/lib/openaiClient.js
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

// Global client that may route through custom proxy (DeepSeek etc.).
// Do not set an SDK timeout here because poster AI jobs can run longer in the background.
export const openai = new OpenAI({
  apiKey: process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.CLIPROXY_BASE_URL || undefined,
});

function normalizeOpenAiBaseUrl(value) {
  const base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return undefined;
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

export const OPENAI_CCCD_MODEL =
  process.env.OPENAI_CCCD_MODEL ||
  process.env.OPENAI_CCCD_DIRECT_MODEL ||
  "gpt-5";

export const cccdOpenai = new OpenAI({
  apiKey:
    process.env.OPENAI_CCCD_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.CLIPROXY_API_KEY ||
    "local-cccd",
  baseURL: normalizeOpenAiBaseUrl(
    process.env.OPENAI_CCCD_BASE_URL || "http://127.0.0.1:8317",
  ),
});

export const OPENAI_POSTER_VISION_MODEL =
  process.env.OPENAI_POSTER_VISION_MODEL ||
  process.env.OPENAI_POSTER_MODEL ||
  "gpt-5";

export const posterOpenai = new OpenAI({
  apiKey:
    process.env.OPENAI_POSTER_API_KEY ||
    process.env.OPENAI_CCCD_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.CLIPROXY_API_KEY ||
    "local-poster",
  baseURL: normalizeOpenAiBaseUrl(
    process.env.OPENAI_POSTER_BASE_URL ||
      process.env.OPENAI_CCCD_BASE_URL ||
      "http://127.0.0.1:8317",
  ),
});

export const OPENAI_DEFAULT_MODEL =
  process.env.BOT_MODEL ||
  process.env.OPENAI_DEFAULT_MODEL ||
  "gpt-5-codex-mini";
export const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL || "gpt-5-codex-mini";
export const OPENAI_CCCD_DIRECT_MODEL = OPENAI_CCCD_MODEL;
export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "gpt-5-codex-mini";
