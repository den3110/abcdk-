import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_CLAUDE_POSTER_MODEL = "claude-opus-4-8";
const DEFAULT_TIMEOUT_MS = 60_000;

export const CLAUDE_CCCD_MODEL =
  process.env.CLAUDE_CCCD_MODEL ||
  process.env.ANTHROPIC_CCCD_MODEL ||
  process.env.CLAUDE_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  DEFAULT_CLAUDE_MODEL;

export const CLAUDE_POSTER_VISION_MODEL =
  process.env.CLAUDE_POSTER_VISION_MODEL ||
  process.env.CLAUDE_POSTER_MODEL ||
  process.env.ANTHROPIC_POSTER_MODEL ||
  DEFAULT_CLAUDE_POSTER_MODEL;

function trim(value) {
  return String(value || "").trim();
}

function getAnthropicApiKey() {
  return (
    trim(process.env.ANTHROPIC_API_KEY) ||
    trim(process.env.CLAUDE_API_KEY)
  );
}

function getAnthropicMessagesUrl() {
  return trim(process.env.ANTHROPIC_MESSAGES_URL) ||
    "https://api.anthropic.com/v1/messages";
}

function getAnthropicTimeoutMs() {
  const timeout = Number(process.env.ANTHROPIC_TIMEOUT_MS);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
}

function normalizeMediaType(mediaType = "") {
  const type = trim(mediaType).toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) {
    return type;
  }
  return "image/jpeg";
}

export function claudeImageBlockFromSource(source) {
  const raw = trim(source);
  if (!raw) return null;

  const dataUrlMatch = raw.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: normalizeMediaType(dataUrlMatch[1]),
        data: dataUrlMatch[2].replace(/\s+/g, ""),
      },
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    return {
      type: "image",
      source: {
        type: "url",
        url: raw,
      },
    };
  }

  throw new Error("Claude chỉ nhận ảnh dạng data URL hoặc URL HTTP(S)");
}

export function openAiContentToClaudeContent(content) {
  const parts = Array.isArray(content) ? content : [{ type: "text", text: content }];
  return parts
    .map((part) => {
      if (!part) return null;
      if (typeof part === "string") return { type: "text", text: part };
      if (part.type === "text") {
        return { type: "text", text: String(part.text || "") };
      }
      if (part.type === "image_url") {
        return claudeImageBlockFromSource(part.image_url?.url);
      }
      if (part.type === "image" && part.source) {
        return part;
      }
      return null;
    })
    .filter(Boolean);
}

export function extractClaudeText(response) {
  return (Array.isArray(response?.content) ? response.content : [])
    .map((part) => (part?.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractJson(text = "") {
  const raw = trim(text);
  if (!raw) throw new Error("Claude không trả về JSON");
  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return JSON.parse(fenced);

  const objectMatch = raw.match(/\{[\s\S]*\}$/);
  if (objectMatch) return JSON.parse(objectMatch[0]);
  throw new Error("Không đọc được JSON từ Claude");
}

export async function createClaudeMessage(payload = {}) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("Thiếu ANTHROPIC_API_KEY để gọi Claude chính thống");
  }

  const timeoutMs = getAnthropicTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(getAnthropicMessagesUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let body = {};
    try {
      body = JSON.parse(bodyText);
    } catch {}

    if (!response.ok) {
      const message =
        body?.error?.message ||
        body?.message ||
        bodyText ||
        `HTTP ${response.status}`;
      throw new Error(`Claude API lỗi ${response.status}: ${message}`);
    }

    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Claude API quá thời gian ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createClaudeJsonMessage({
  model,
  system,
  content,
  schema,
  toolName = "return_json",
  toolDescription = "Return the requested structured JSON data.",
  maxTokens = 4096,
  temperature,
}) {
  if (!schema || typeof schema !== "object") {
    throw new Error("Thiếu JSON schema cho Claude structured output");
  }

  const payload = {
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [
      {
        role: "user",
        content: openAiContentToClaudeContent(content),
      },
    ],
    tools: [
      {
        name: toolName,
        description: toolDescription,
        input_schema: schema,
      },
    ],
    tool_choice: {
      type: "tool",
      name: toolName,
    },
  };
  if (Number.isFinite(Number(temperature))) {
    payload.temperature = Number(temperature);
  }

  const response = await createClaudeMessage(payload);

  const toolUse = (Array.isArray(response?.content) ? response.content : []).find(
    (part) => part?.type === "tool_use" && part?.name === toolName,
  );

  if (toolUse?.input && typeof toolUse.input === "object") {
    return {
      data: toolUse.input,
      response,
      text: JSON.stringify(toolUse.input),
    };
  }

  const text = extractClaudeText(response);
  return {
    data: extractJson(text),
    response,
    text,
  };
}
