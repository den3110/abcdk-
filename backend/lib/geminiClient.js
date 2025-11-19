// src/lib/geminiClient.js
import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || null;

if (!apiKey) {
  console.warn(
    "[Gemini] Missing GEMINI_API_KEY / GOOGLE_API_KEY env. News discovery sẽ fail nếu không set key."
  );
}

export const gemini = new GoogleGenAI({
  apiKey,
});

export { Type };
