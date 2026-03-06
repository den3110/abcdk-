// src/lib/openaiClient.js
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();
export const openai = new OpenAI({
  apiKey: process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.CLIPROXY_BASE_URL || undefined,
});
