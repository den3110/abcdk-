import OpenAI from "openai";
import { createHash } from "node:crypto";

import { openai as configuredOpenAI } from "../lib/openaiClient.js";

const USE_CLIPROXY = Boolean(
  process.env.CLIPROXY_API_KEY || process.env.CLIPROXY_BASE_URL,
);

const DIRECT_OPENAI = process.env.OPENAI_API_KEY
  && !USE_CLIPROXY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30_000,
    })
  : null;

const AI_MODEL =
  process.env.OPENAI_COMMAND_PALETTE_MODEL ||
  (DIRECT_OPENAI ? "gpt-5-mini" : process.env.OPENAI_DEFAULT_MODEL) ||
  "gpt-5-mini";

const ALLOWED_SCOPES = new Set([
  "actions",
  "pages",
  "tournaments",
  "clubs",
  "news",
  "players",
]);

const MAX_QUERY_LENGTH = 180;
const MAX_CANDIDATES = 28;
const MAX_TERMS = 6;

const EMPTY_ASSIST_RESPONSE = Object.freeze({
  primaryId: null,
  topIds: [],
  suggestedScope: null,
  queryRewrite: "",
  reason: "",
  confidence: 0,
  suggestedPrompts: [],
  operatorMode: "pick",
  operatorTitle: "",
  operatorHint: "",
  planIds: [],
  clarifyQuestion: "",
  clarifyChoices: [],
});

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "primaryId",
    "topIds",
    "suggestedScope",
    "queryRewrite",
    "reason",
    "confidence",
    "suggestedPrompts",
    "operatorMode",
    "operatorTitle",
    "operatorHint",
    "planIds",
    "clarifyQuestion",
    "clarifyChoices",
  ],
  properties: {
    primaryId: {
      anyOf: [{ type: "null" }, { type: "string", maxLength: 120 }],
    },
    topIds: {
      type: "array",
      maxItems: 8,
      items: { type: "string", maxLength: 120 },
    },
    suggestedScope: {
      anyOf: [
        { type: "null" },
        {
          type: "string",
          enum: ["actions", "pages", "tournaments", "clubs", "news", "players"],
        },
      ],
    },
    queryRewrite: {
      type: "string",
      maxLength: 120,
    },
    reason: {
      type: "string",
      maxLength: 160,
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    suggestedPrompts: {
      type: "array",
      maxItems: 3,
      items: {
        type: "string",
        maxLength: 60,
      },
    },
    operatorMode: {
      type: "string",
      enum: ["pick", "plan", "clarify"],
    },
    operatorTitle: {
      type: "string",
      maxLength: 80,
    },
    operatorHint: {
      type: "string",
      maxLength: 140,
    },
    planIds: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 120 },
    },
    clarifyQuestion: {
      type: "string",
      maxLength: 120,
    },
    clarifyChoices: {
      type: "array",
      maxItems: 4,
      items: {
        type: "string",
        maxLength: 60,
      },
    },
  },
};

function sanitizeString(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeTerms(values) {
  if (!Array.isArray(values)) return [];

  return Array.from(
    new Set(
      values
        .map((value) => sanitizeString(value, 40))
        .filter(Boolean)
        .slice(0, MAX_TERMS),
    ),
  );
}

function sanitizeScope(value) {
  const scope = sanitizeString(value, 20).toLowerCase();
  return ALLOWED_SCOPES.has(scope) ? scope : null;
}

function sanitizeCandidate(candidate = {}) {
  const id = sanitizeString(candidate.id, 120);
  const title = sanitizeString(candidate.title, 80);
  const scope = sanitizeScope(candidate.scope);
  if (!id || !title || !scope) return null;

  return {
    id,
    title,
    scope,
    subtitle: sanitizeString(candidate.subtitle, 120),
    description: sanitizeString(candidate.description, 180),
    path: sanitizeString(candidate.path, 160),
    keywords: sanitizeTerms(candidate.keywords),
    aliases: sanitizeTerms(candidate.aliases),
    hints: {
      pinned: Boolean(candidate.isPinned),
      recent: Boolean(candidate.isRecent),
      contextual: Boolean(candidate.isContextual),
      suggested: Boolean(candidate.isSuggested),
    },
  };
}

function sanitizeContext(context = {}) {
  const routeKind = sanitizeString(context.routeKind, 40);
  const drawView = sanitizeString(context.drawView, 20);

  return {
    routeKind,
    currentTournamentId: sanitizeString(context.currentTournamentId, 80),
    currentTournamentName: sanitizeString(context.currentTournamentName, 80),
    currentClubId: sanitizeString(context.currentClubId, 80),
    currentClubName: sanitizeString(context.currentClubName, 80),
    drawView:
      drawView === "stage" || drawView === "board" || drawView === "history"
        ? drawView
        : "",
    isAdmin: Boolean(context.isAdmin),
    isAuthenticated: Boolean(context.isAuthenticated),
  };
}

function sanitizePayload(payload = {}) {
  return {
    query: sanitizeString(payload.query, MAX_QUERY_LENGTH),
    scope: sanitizeScope(payload.scope),
    locale: sanitizeString(payload.locale, 16) || "vi",
    currentPath: sanitizeString(payload.currentPath, 160),
    context: sanitizeContext(payload.context),
    candidates: Array.from(
      new Map(
        (Array.isArray(payload.candidates) ? payload.candidates : [])
          .map(sanitizeCandidate)
          .filter(Boolean)
          .slice(0, MAX_CANDIDATES)
          .map((candidate) => [candidate.id, candidate]),
      ).values(),
    ),
  };
}

function buildSafetyIdentifier(requestContext = {}) {
  const base =
    sanitizeString(requestContext.userId, 64) ||
    sanitizeString(requestContext.ip, 64) ||
    "anonymous";

  return createHash("sha256").update(base).digest("hex").slice(0, 48);
}

function buildInstructions(locale = "vi") {
  const language = String(locale || "").toLowerCase().startsWith("en")
    ? "English"
    : "Vietnamese";

  return [
    "You are the AI assistant behind a website command palette.",
    "Infer the user's intent from a short natural-language query.",
    "You may ONLY choose from the provided candidates. Never invent ids, URLs, or actions.",
    "Prioritize the single best next click or action, then provide a short ordered shortlist.",
    "Use currentPath and the extra context summary to understand what page the user is already on.",
    "Prefer contextual, pinned, recent, or suggested candidates only when they truly match the query.",
    "If the query is ambiguous, hedge by returning broader topIds rather than guessing a narrow action.",
    "Return reason, queryRewrite, suggestedPrompts, and operator fields in the user's language.",
    'Set operatorMode to "pick" when there is one clear best action.',
    'Set operatorMode to "plan" when the user seems to want a short workflow or there are 2-4 strong ordered steps.',
    'Set operatorMode to "clarify" when the request is ambiguous; then use clarifyQuestion and clarifyChoices to ask one short follow-up.',
    "operatorTitle should sound like a decisive next move, not a generic label.",
    "operatorHint should briefly explain why this is the next best move.",
    "planIds must be ordered from step 1 to step N and must only contain provided candidate ids.",
    `Write all free-text fields in ${language}.`,
    "Example intents:",
    '- "giải của tôi", "my tournaments" -> prefer the user tournament page/action if available.',
    '- "copy link trang này" -> prefer the current-page copy action.',
    '- "đổi dark mode", "dark theme" -> prefer the theme toggle action.',
    '- "xem bracket", "nhánh đấu" -> prefer bracket-related items.',
  ].join("\n");
}

function extractJsonText(response) {
  const text = String(response?.output_text || "").trim();
  if (!text) return "";

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end >= start) {
    return text.slice(start, end + 1);
  }

  return text;
}

function extractChatCompletionText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function sanitizeAssistResponse(raw, allowedIds) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const allowedIdSet = new Set(allowedIds);

  const topIds = Array.from(
    new Set(
      (Array.isArray(safe.topIds) ? safe.topIds : [])
        .map((value) => sanitizeString(value, 120))
        .filter((value) => allowedIdSet.has(value)),
    ),
  ).slice(0, 8);

  const primaryId = allowedIdSet.has(sanitizeString(safe.primaryId, 120))
    ? sanitizeString(safe.primaryId, 120)
    : topIds[0] || null;

  const normalizedTopIds = primaryId
    ? [primaryId, ...topIds.filter((value) => value !== primaryId)].slice(0, 8)
    : topIds;

  const suggestedScope = sanitizeScope(safe.suggestedScope);
  const queryRewrite = sanitizeString(safe.queryRewrite, 120);
  const reason = sanitizeString(safe.reason, 160);
  const confidence = Number(safe.confidence || 0);
  const operatorMode =
    safe.operatorMode === "plan" || safe.operatorMode === "clarify"
      ? safe.operatorMode
      : "pick";
  const operatorTitle = sanitizeString(safe.operatorTitle, 80);
  const operatorHint = sanitizeString(safe.operatorHint, 140);
  const planIds = Array.from(
    new Set(
      (Array.isArray(safe.planIds) ? safe.planIds : [])
        .map((value) => sanitizeString(value, 120))
        .filter((value) => allowedIdSet.has(value)),
    ),
  ).slice(0, 4);
  const clarifyQuestion = sanitizeString(safe.clarifyQuestion, 120);

  return {
    primaryId,
    topIds: normalizedTopIds,
    suggestedScope,
    queryRewrite,
    reason,
    confidence: Number.isFinite(confidence)
      ? Math.min(Math.max(confidence, 0), 1)
      : 0,
    suggestedPrompts: Array.from(
      new Set(
        (Array.isArray(safe.suggestedPrompts) ? safe.suggestedPrompts : [])
          .map((value) => sanitizeString(value, 60))
          .filter(Boolean),
      ),
    ).slice(0, 3),
    operatorMode,
    operatorTitle,
    operatorHint,
    planIds,
    clarifyQuestion,
    clarifyChoices: Array.from(
      new Set(
        (Array.isArray(safe.clarifyChoices) ? safe.clarifyChoices : [])
          .map((value) => sanitizeString(value, 60))
          .filter(Boolean),
      ),
    ).slice(0, 4),
  };
}

function getClient() {
  return DIRECT_OPENAI || configuredOpenAI;
}

async function requestAssistWithResponses(client, normalized, requestContext) {
  const response = await client.responses.create({
    model: AI_MODEL,
    instructions: buildInstructions(normalized.locale),
    input: JSON.stringify({
      query: normalized.query,
      scopeFilter: normalized.scope,
      currentPath: normalized.currentPath,
      context: normalized.context,
      actor: {
        isAuthenticated: Boolean(requestContext.userId),
        isAdmin: Boolean(requestContext.isAdmin),
      },
      candidates: normalized.candidates,
    }),
    text: {
      format: {
        type: "json_schema",
        name: "command_palette_assist",
        schema: responseSchema,
        strict: true,
      },
    },
    store: false,
    max_output_tokens: 320,
    safety_identifier: buildSafetyIdentifier(requestContext),
    metadata: {
      feature: "command_palette_assist",
      currentPath: normalized.currentPath || "/",
    },
  });

  return JSON.parse(extractJsonText(response) || "{}");
}

async function requestAssistWithChatCompletions(client, normalized, requestContext) {
  const response = await client.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: "system",
        content: `${buildInstructions(
          normalized.locale,
        )}\nReturn ONLY a JSON object with the requested fields.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          query: normalized.query,
          scopeFilter: normalized.scope,
          currentPath: normalized.currentPath,
          context: normalized.context,
          actor: {
            isAuthenticated: Boolean(requestContext.userId),
            isAdmin: Boolean(requestContext.isAdmin),
          },
          candidates: normalized.candidates,
        }),
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 500,
    temperature: 0.2,
  });

  return JSON.parse(extractChatCompletionText(response) || "{}");
}

export function isCommandPaletteAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.CLIPROXY_API_KEY);
}

export async function assistCommandPalette(payload, requestContext = {}) {
  const normalized = sanitizePayload(payload);

  if (!normalized.query || normalized.candidates.length === 0) {
    return EMPTY_ASSIST_RESPONSE;
  }

  if (!isCommandPaletteAiConfigured()) {
    const error = new Error("Command palette AI is not configured");
    error.statusCode = 503;
    throw error;
  }

  const client = getClient();
  let parsed = {};

  if (USE_CLIPROXY) {
    parsed = await requestAssistWithChatCompletions(
      client,
      normalized,
      requestContext,
    );
  } else {
    try {
      parsed = await requestAssistWithResponses(client, normalized, requestContext);
    } catch (error) {
      const message = String(error?.message || "");
      const status = Number(error?.status || error?.statusCode || 0);
      if (status === 405 || /405|method not allowed/i.test(message)) {
        parsed = await requestAssistWithChatCompletions(
          client,
          normalized,
          requestContext,
        );
      } else {
        throw error;
      }
    }
  }

  return sanitizeAssistResponse(
    parsed,
    normalized.candidates.map((candidate) => candidate.id),
  );
}
