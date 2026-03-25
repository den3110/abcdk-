// src/lib/openaiClient.js
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

// Global client that may route through custom proxy (DeepSeek etc.)
export const openai = new OpenAI({
  apiKey: process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.CLIPROXY_BASE_URL || undefined,
  timeout: 120_000, // 120 seconds - cần lâu hơn cho xử lý ảnh qua proxy
});

export const OPENAI_DEFAULT_MODEL =
  process.env.BOT_MODEL ||
  process.env.OPENAI_DEFAULT_MODEL ||
  "gpt-5-codex-mini";
export const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL || "gpt-5-codex-mini";
export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "gpt-5-codex-mini";
