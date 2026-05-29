// src/lib/openaiClient.js
import OpenAI from "openai";
import dotenv from "dotenv";
import { createAiGatewayClient } from "../services/aiGatewayRuntime.service.js";
dotenv.config();

function normalizeOpenAiBaseUrl(value) {
  const base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return undefined;
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

export const OPENAI_CCCD_MODEL =
  process.env.OPENAI_CCCD_MODEL ||
  process.env.OPENAI_CCCD_DIRECT_MODEL ||
  "gpt-5";

export const OPENAI_POSTER_VISION_MODEL =
  process.env.OPENAI_POSTER_VISION_MODEL ||
  process.env.OPENAI_POSTER_MODEL ||
  "gpt-5";

export const OPENAI_DEFAULT_MODEL =
  process.env.BOT_MODEL ||
  process.env.OPENAI_DEFAULT_MODEL ||
  "gpt-5-codex-mini";
export const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL || "gpt-5-codex-mini";
export const OPENAI_CCCD_DIRECT_MODEL = OPENAI_CCCD_MODEL;
export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "gpt-5-codex-mini";

// OpenAI-compatible clients are resolved at call time from SystemSettings.
// Environment variables remain as the final fallback when DB config is empty.
export const openai = createAiGatewayClient("default");
export const cccdOpenai = createAiGatewayClient("cccd");
export const posterOpenai = createAiGatewayClient("poster");

export const directOpenai = new OpenAI({
  apiKey: process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: normalizeOpenAiBaseUrl(process.env.CLIPROXY_BASE_URL),
});
