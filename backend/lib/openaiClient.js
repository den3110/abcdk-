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

export const OPENAI_DEFAULT_MODEL =
  process.env.BOT_MODEL ||
  process.env.OPENAI_DEFAULT_MODEL ||
  "gpt-5-codex-mini";
export const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL || "gpt-5-codex-mini";
export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "gpt-5-codex-mini";
