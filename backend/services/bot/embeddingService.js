// services/embeddingService.js
import { openai, OPENAI_EMBEDDING_MODEL } from "../../lib/openaiClient.js";

// Dùng model embed rẻ, ví dụ: "text-embedding-3-small"
export async function embedText(text) {
  try {
    const response = await openai.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    });
    return response.data[0].embedding; // array of numbers
  } catch (error) {
    console.error("Error embedding text:", error);
    throw error; // Re-throw the error after logging
  }
}

// Cosine similarity đơn giản
export function cosineSim(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
