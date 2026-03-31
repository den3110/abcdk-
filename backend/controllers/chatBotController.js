// controllers/chatBotController.js
// ✅ v3.0 - Agent-based with Function Calling
// Thay thế hoàn toàn 3-layer cũ (quickResponse + skillMatching + GPT planner)

import {
  runAgent,
  runAgentStream,
  BOT_IDENTITY,
  getChatCapabilities,
} from "../services/bot/pikoraService.js";
import ChatBotMessage from "../models/chatBotMessageModel.js";
import {
  getChatTelemetrySummary,
  listChatTelemetryTurns,
  logChatTelemetry,
  recordChatTelemetryEvent,
  submitChatFeedback,
} from "../services/bot/chatBotTelemetryService.js";

// Roles that bypass session limit
const UNLIMITED_ROLES = ["admin", "referee"];
const SESSION_LIMIT = 30;

function readHeaderString(req, key) {
  const value = req.headers[key];
  if (typeof value !== "string" || !value.trim()) return "";
  const text = value.trim();
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function trimSnapshotText(value, maxLength = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function sanitizeSnapshotList(list, limit = 8, maxLength = 96) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((item) => trimSnapshotText(item, maxLength))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function sanitizePageSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const next = {
    pageType: trimSnapshotText(snapshot.pageType, 64),
    entityTitle: trimSnapshotText(snapshot.entityTitle, 140),
    sectionTitle: trimSnapshotText(snapshot.sectionTitle, 120),
    pageSummary: trimSnapshotText(snapshot.pageSummary, 240),
    activeLabels: sanitizeSnapshotList(snapshot.activeLabels, 8, 72),
    visibleActions: sanitizeSnapshotList(snapshot.visibleActions, 8, 72),
    highlights: sanitizeSnapshotList(snapshot.highlights, 8, 96),
    metrics: sanitizeSnapshotList(snapshot.metrics, 8, 96),
  };

  return Object.values(next).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  )
    ? next
    : null;
}

function sanitizeCapabilityKeys(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => trimSnapshotText(item, 48).toLowerCase())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, 24);
}

function sanitizeReasoningMode(value) {
  return value === "force_reasoner" ? "force_reasoner" : "auto";
}

function buildRequestContext(req) {
  const currentUser = req.user;
  const pageSnapshot = sanitizePageSnapshot(req.body?.pageSnapshot);
  const reasoningMode = sanitizeReasoningMode(req.body?.reasoningMode);
  const capabilityKeys = sanitizeCapabilityKeys(req.body?.capabilityKeys);
  return {
    currentUser,
    currentUserId: currentUser?._id,
    tournamentId: readHeaderString(req, "x-pkt-tournament-id"),
    matchId: readHeaderString(req, "x-pkt-match-id"),
    bracketId: readHeaderString(req, "x-pkt-bracket-id"),
    courtCode: readHeaderString(req, "x-pkt-court-code"),
    courtId: readHeaderString(req, "x-pkt-court-id"),
    currentPath: readHeaderString(req, "x-pkt-current-path"),
    currentUrl: readHeaderString(req, "x-pkt-current-url"),
    pageTitle: readHeaderString(req, "x-pkt-page-title"),
    pageType: readHeaderString(req, "x-pkt-page-type"),
    pageSection: readHeaderString(req, "x-pkt-page-section"),
    pageView: readHeaderString(req, "x-pkt-page-view"),
    adminSection: readHeaderString(req, "x-pkt-admin-section"),
    clubId: readHeaderString(req, "x-pkt-club-id"),
    clubTab: readHeaderString(req, "x-pkt-club-tab"),
    newsSlug: readHeaderString(req, "x-pkt-news-slug"),
    profileUserId: readHeaderString(req, "x-pkt-profile-user-id"),
    pageSnapshot,
    capabilityKeys,
    reasoningMode,
  };
}

function buildStoredContext(context) {
  return {
    tournamentId: context.tournamentId || "",
    matchId: context.matchId || "",
    bracketId: context.bracketId || "",
    courtCode: context.courtCode || "",
    courtId: context.courtId || "",
    currentPath: context.currentPath || "",
    currentUrl: context.currentUrl || "",
    pageTitle: context.pageTitle || "",
    pageType: context.pageType || "",
    pageSection: context.pageSection || "",
    pageView: context.pageView || "",
    adminSection: context.adminSection || "",
    clubId: context.clubId || "",
    clubTab: context.clubTab || "",
    newsSlug: context.newsSlug || "",
    profileUserId: context.profileUserId || "",
    pageSnapshot: context.pageSnapshot || null,
    capabilityKeys: context.capabilityKeys || [],
    reasoningMode: context.reasoningMode || "auto",
  };
}

function createTurnId(seed = "") {
  return seed
    ? String(seed)
    : `turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildAgentResponse(result = {}) {
  return {
    reply: result.reply || "",
    source: "agent",
    toolsUsed: result.toolsUsed || [],
    processingTime: result.processingTime,
    processingTimeMs: result.processingTimeMs,
    firstTokenLatencyMs: result.firstTokenLatencyMs,
    model: result.model,
    mode: result.mode,
    reasoningAvailable: Boolean(result.reasoningAvailable),
    rawThinking: result.rawThinking || "",
    toolSummary: result.toolSummary || [],
    suggestions: result.suggestions || [],
    actions: result.actions || [],
    answerCards: result.answerCards || [],
    sources: result.sources || [],
    intent: result.intent || "",
    routeKind: result.routeKind || "",
    capabilityKeys: result.capabilityKeys || [],
    actionExecutionSummary: result.actionExecutionSummary || null,
    contextInsight: result.contextInsight || "",
    personalization: result.personalization || null,
    trustMeta: result.trustMeta || null,
    botName: BOT_IDENTITY.nameVi,
    ...(result.navigation ? { navigation: result.navigation } : {}),
  };
}

function buildBotMeta(result = {}, extra = {}) {
  return {
    type: "agent",
    source: extra.source || "agent",
    toolsUsed: result.toolsUsed || [],
    processingTime: result.processingTime,
    processingTimeMs: result.processingTimeMs,
    firstTokenLatencyMs: result.firstTokenLatencyMs,
    model: result.model,
    mode: result.mode,
    rawThinking: result.rawThinking || "",
    reasoningAvailable: Boolean(result.reasoningAvailable),
    toolSummary: result.toolSummary || [],
    suggestions: result.suggestions || [],
    thinkingSteps: extra.thinkingSteps || [],
    actions: result.actions || [],
    answerCards: result.answerCards || [],
    sources: result.sources || [],
    intent: result.intent || "",
    routeKind: result.routeKind || "",
    capabilityKeys: result.capabilityKeys || [],
    actionExecutionSummary: result.actionExecutionSummary || null,
    contextInsight: result.contextInsight || "",
    personalization: result.personalization || null,
    trustMeta: result.trustMeta || null,
    feedback: extra.feedback || null,
  };
}

function buildTelemetryPayload({
  turnId,
  userId,
  replyTo,
  messageId,
  context,
  result = {},
  outcome = "success",
  errorMessage = "",
}) {
  return {
    turnId,
    userId,
    replyTo: replyTo || null,
    messageId: messageId || null,
    pageType: context?.pageType || context?.pageSnapshot?.pageType || "",
    pageSection: context?.pageSection || context?.pageSnapshot?.sectionTitle || "",
    pageView: context?.pageView || "",
    intent: result.intent || "",
    routeKind: result.routeKind || "",
    toolsPlanned:
      result.toolsPlanned ||
      (Array.isArray(result.toolSummary)
        ? result.toolSummary.map((item) => item?.tool).filter(Boolean)
        : []),
    toolsUsed: result.toolsUsed || [],
    toolLatencyMs: Array.isArray(result.toolSummary)
      ? result.toolSummary.map((item) => ({
          tool: item?.tool,
          durationMs: item?.durationMs,
          error: item?.error,
        }))
      : [],
    model: result.model || "",
    mode: result.mode || "",
    reasoningUsed: Boolean(result.reasoningAvailable || result.rawThinking),
    firstTokenLatencyMs: result.firstTokenLatencyMs || 0,
    processingTimeMs: result.processingTimeMs || 0,
    actionCount: Array.isArray(result.actions) ? result.actions.length : 0,
    actionTypes: Array.isArray(result.actions)
      ? result.actions.map((item) => item?.type).filter(Boolean)
      : [],
    actionExecuted: Array.isArray(result.actionExecutionSummary?.executed)
      ? result.actionExecutionSummary.executed
      : [],
    cardKinds: Array.isArray(result.answerCards)
      ? result.answerCards.map((item) => item?.kind).filter(Boolean)
      : [],
    sourceCount: Array.isArray(result.sources) ? result.sources.length : 0,
    outcome,
    meta: errorMessage
      ? { errorMessage }
      : {
          capabilityKeys: result.capabilityKeys || [],
        },
  };
}

/* ========== MAIN CHAT HANDLER ========== */
export async function handleChat(req, res) {
  let turnId = createTurnId();
  let telemetryContext = null;
  let telemetryUserId = null;
  let replyToMessageId = null;
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    const context = buildRequestContext(req);
    const {
      currentUser,
      tournamentId,
      matchId,
      bracketId,
      courtCode,
    } = context;

    const userId = currentUser?._id || null;
    telemetryContext = context;
    telemetryUserId = userId;

    // ═══════════ SESSION LIMIT ═══════════
    const userRole = currentUser?.role;
    const isUnlimited = UNLIMITED_ROLES.includes(userRole);

    if (userId && !isUnlimited) {
      const now = new Date();

      const lastLimit = await ChatBotMessage.findOne({
        userId,
        role: "system",
        "meta.kind": "session-limit",
      }).sort({ createdAt: -1 });

      let sessionStart = null;

      if (lastLimit?.meta?.resetAt) {
        const resetAt = new Date(lastLimit.meta.resetAt);

        if (now < resetAt) {
          const msLeft = resetAt.getTime() - now.getTime();
          const totalMinutesLeft = Math.ceil(msLeft / 60000);
          const hoursLeft = Math.floor(totalMinutesLeft / 60);
          const minutesLeft = totalMinutesLeft % 60;

          return res.status(429).json({
            error: "session_limit_reached",
            message: `Bạn đã đạt giới hạn ${SESSION_LIMIT} tin nhắn cho lượt này.`,
            limit: SESSION_LIMIT,
            resetAt: resetAt.toISOString(),
            remaining: { hours: hoursLeft, minutes: minutesLeft },
          });
        }

        sessionStart = new Date(lastLimit.meta.resetAt);
      }

      const countQuery = { userId, role: "user" };
      if (sessionStart) countQuery.createdAt = { $gte: sessionStart };

      const userMsgCount = await ChatBotMessage.countDocuments(countQuery);

      if (userMsgCount >= SESSION_LIMIT) {
        const limitTime = now;
        const resetAt = computeSessionResetAt(limitTime);
        const msLeft = resetAt.getTime() - now.getTime();
        const totalMinutesLeft = Math.ceil(msLeft / 60000);
        const hoursLeft = Math.floor(totalMinutesLeft / 60);
        const minutesLeft = totalMinutesLeft % 60;

        try {
          await ChatBotMessage.create({
            userId,
            role: "system",
            message: `Session limit reached. Bạn đã dùng hết ${SESSION_LIMIT} tin nhắn.`,
            meta: {
              kind: "session-limit",
              limit: SESSION_LIMIT,
              limitReachedAt: limitTime,
              resetAt,
            },
            navigation: null,
            context: buildStoredContext(context),
          });
        } catch (e) {
          console.error("[handleChat] log session-limit error:", e.message);
        }

        return res.status(429).json({
          error: "session_limit_reached",
          message: `Bạn đã đạt giới hạn ${SESSION_LIMIT} tin nhắn cho lượt này.`,
          limit: SESSION_LIMIT,
          resetAt: resetAt.toISOString(),
          remaining: { hours: hoursLeft, minutes: minutesLeft },
        });
      }
    }
    // ═══════════ END SESSION LIMIT ═══════════

    // Log user message
    let userMessageDoc = null;
    try {
      userMessageDoc = await ChatBotMessage.create({
        userId,
        role: "user",
        message,
        meta: null,
        navigation: null,
        context: buildStoredContext(context),
      });
      turnId = createTurnId(userMessageDoc?._id);
      replyToMessageId = userMessageDoc?._id || null;
    } catch (e) {
      console.error("[handleChat] log user message error:", e.message);
    }

    // ✅ RUN AGENT (thay thế toàn bộ 3 layers cũ)
    const result = await runAgent(message, context, userId);

    const response = buildAgentResponse(result);

    // Log bot message
    let botMessageDoc = null;
    try {
      botMessageDoc = await ChatBotMessage.create({
        userId,
        role: "bot",
        message: response.reply,
        meta: buildBotMeta(result, { source: "agent" }),
        navigation: result.navigation || null,
        context: buildStoredContext(context),
        replyTo: userMessageDoc?._id || null,
      });
      response.messageId = String(botMessageDoc?._id || "");
    } catch (e) {
      console.error("[handleChat] log bot message error:", e.message);
    }

    await logChatTelemetry(
      buildTelemetryPayload({
        turnId,
        userId,
        replyTo: replyToMessageId,
        messageId: botMessageDoc?._id || null,
        context,
        result,
        outcome: response.reply ? "success" : "empty",
      }),
    );

    return res.json(response);
  } catch (err) {
    console.error("handleChat error:", err);
    await logChatTelemetry(
      buildTelemetryPayload({
        turnId,
        userId: telemetryUserId,
        replyTo: replyToMessageId,
        context: telemetryContext,
        result: {},
        outcome: "error",
        errorMessage: err.message,
      }),
    );
    return res.status(500).json({
      error: "Lỗi server",
      botName: BOT_IDENTITY.nameVi,
    });
  }
}

/* ========== SSE STREAMING CHAT HANDLER ========== */
export async function handleChatStream(req, res) {
  let turnId = createTurnId();
  let telemetryContext = null;
  let telemetryUserId = null;
  let replyToMessageId = null;
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    const context = buildRequestContext(req);
    const {
      currentUser,
      tournamentId,
      matchId,
      bracketId,
      courtCode,
    } = context;

    const userId = currentUser?._id || null;
    telemetryContext = context;
    telemetryUserId = userId;

    // Session limit check (same as handleChat)
    const userRole = currentUser?.role;
    const isUnlimited = UNLIMITED_ROLES.includes(userRole);

    if (userId && !isUnlimited) {
      const now = new Date();
      const lastLimit = await ChatBotMessage.findOne({
        userId,
        role: "system",
        "meta.kind": "session-limit",
      }).sort({ createdAt: -1 });

      if (lastLimit?.meta?.resetAt) {
        const resetAt = new Date(lastLimit.meta.resetAt);
        if (now < resetAt) {
          return res.status(429).json({
            error: "session_limit_reached",
            message: `Bạn đã đạt giới hạn ${SESSION_LIMIT} tin nhắn cho lượt này.`,
          });
        }
      }

      const countQuery = { userId, role: "user" };
      if (lastLimit?.meta?.resetAt) {
        countQuery.createdAt = { $gte: new Date(lastLimit.meta.resetAt) };
      }
      const userMsgCount = await ChatBotMessage.countDocuments(countQuery);
      if (userMsgCount >= SESSION_LIMIT) {
        const resetAt = computeSessionResetAt(now);
        try {
          await ChatBotMessage.create({
            userId,
            role: "system",
            message: `Session limit reached (${SESSION_LIMIT}).`,
            meta: {
              kind: "session-limit",
              limit: SESSION_LIMIT,
              limitReachedAt: now,
              resetAt,
            },
            navigation: null,
            context: buildStoredContext(context),
          });
        } catch (e) {
          /* ignore */
        }
        return res.status(429).json({ error: "session_limit_reached" });
      }
    }

    // Log user message
    let userMessageDoc = null;
    try {
      userMessageDoc = await ChatBotMessage.create({
        userId,
        role: "user",
        message,
        meta: null,
        navigation: null,
        context: buildStoredContext(context),
      });
      turnId = createTurnId(userMessageDoc?._id);
      replyToMessageId = userMessageDoc?._id || null;
    } catch (e) {
      console.error("[handleChatStream] log user message error:", e.message);
    }

    // ═══ SSE Headers ═══
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const streamAbortController = new AbortController();
    let clientDisconnected = false;
    let streamFinished = false;

    const handleClientDisconnect = () => {
      if (clientDisconnected) return;
      clientDisconnected = true;
      streamAbortController.abort();
    };

    req.on("aborted", handleClientDisconnect);
    res.on("close", () => {
      if (!streamFinished) {
        handleClientDisconnect();
      }
    });

    const emit = (event, data) => {
      if (clientDisconnected || res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Collect thinking steps during stream for DB persistence
    const collectedSteps = [];
    const wrappedEmit = (event, data) => {
      emit(event, data);
      if (event === "thinking") {
        collectedSteps.push({ label: data.step, status: "done" });
      } else if (event === "tool_start") {
        collectedSteps.push({
          label: data.tool,
          status: "running",
          tool: data.tool,
        });
      } else if (event === "tool_done") {
        const idx = collectedSteps.findLastIndex(
          (s) => s.tool === data.tool && s.status === "running",
        );
        if (idx !== -1) {
          collectedSteps[idx] = {
            ...collectedSteps[idx],
            label: data.resultPreview || data.tool,
            status: "done",
            durationMs: data.durationMs,
            error: data.error || false,
          };
        }
      }
    };

    // ═══ Run Agent with streaming ═══
    const result = await runAgentStream(message, context, userId, wrappedEmit, {
      signal: streamAbortController.signal,
    });

    if (clientDisconnected) {
      await logChatTelemetry(
        buildTelemetryPayload({
          turnId,
          userId,
          replyTo: replyToMessageId,
          context,
          result: result || {},
          outcome: "aborted",
        }),
      );
      return;
    }

    // Log bot message after completion
    let botMessageDoc = null;
    if (result) {
      try {
        botMessageDoc = await ChatBotMessage.create({
          userId,
          role: "bot",
          message: result.reply,
          meta: buildBotMeta(result, {
            source: "agent-stream",
            thinkingSteps: collectedSteps,
          }),
          navigation: result.navigation || null,
          context: buildStoredContext(context),
          replyTo: userMessageDoc?._id || null,
        });
        emit("persisted", {
          messageId: String(botMessageDoc?._id || ""),
        });
      } catch (e) {
        console.error("[handleChatStream] log bot msg error:", e.message);
      }
    }

    await logChatTelemetry(
      buildTelemetryPayload({
        turnId,
        userId,
        replyTo: replyToMessageId,
        messageId: botMessageDoc?._id || null,
        context,
        result,
        outcome: result?.reply ? "success" : "empty",
      }),
    );

    emit("done", {});
    streamFinished = true;
    res.end();
  } catch (err) {
    if (isAbortError(err) || req.aborted) {
      await logChatTelemetry(
        buildTelemetryPayload({
          turnId,
          userId: telemetryUserId,
          replyTo: replyToMessageId,
          context: telemetryContext,
          result: {},
          outcome: "aborted",
          errorMessage: err.message,
        }),
      );
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    console.error("handleChatStream error:", err);
    await logChatTelemetry(
      buildTelemetryPayload({
        turnId,
        userId: telemetryUserId,
        replyTo: replyToMessageId,
        context: telemetryContext,
        result: {},
        outcome: "error",
        errorMessage: err.message,
      }),
    );
    // If headers already sent, try to emit error event
    if (res.headersSent) {
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: "Lỗi server" })}\n\n`,
        );
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      } catch {
        /* ignore */
      }
    } else {
      return res.status(500).json({ error: "Lỗi server" });
    }
  }
}

/* ========== HEALTH CHECK ========== */
export async function handleHealthCheck(req, res) {
  const capabilities = getChatCapabilities();
  return res.json({
    status: "ok",
    bot: BOT_IDENTITY,
    engine: {
      type: capabilities.backend,
      model: capabilities.defaultModel,
      provider: capabilities.provider,
      models: capabilities.models,
      streaming: capabilities.streaming,
      reasoning: capabilities.reasoning,
      actions: capabilities.actions,
      pageStateContext: capabilities.pageStateContext,
      personalization: capabilities.personalization,
      answerCards: true,
      sourceGrounding: true,
      telemetry: true,
      tools: [
        "search_tournaments",
        "get_tournament_summary",
        "search_users",
        "get_my_info",
        "get_leaderboard",
        "get_my_registrations",
        "get_my_rating_changes",
        "navigate",
        "search_knowledge",
      ],
    },
    timestamp: new Date().toISOString(),
  });
}

/* ========== BOT INFO ========== */
export async function handleBotInfo(req, res) {
  const capabilities = getChatCapabilities();
  return res.json({
    ...BOT_IDENTITY,
    capabilities,
    features: [
      "Greeting & Small Talk",
      "FAQ về PickleTour (RAG)",
      "Navigation commands",
      "Tra cứu thông tin giải đấu",
      "Tra cứu thông tin cá nhân",
      "Tìm kiếm VĐV",
      "Bảng xếp hạng",
      "Conversation memory",
      "DeepSeek native streaming",
      "Reasoner modal with raw <think>",
      "Answer cards",
      "Source grounding",
      "Feedback telemetry",
    ],
  });
}

export async function handleChatFeedback(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser?._id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { messageId, value, reason, note } = req.body || {};
    if (!messageId || !value) {
      return res.status(400).json({ error: "Thiếu messageId hoặc value" });
    }

    const feedback = await submitChatFeedback({
      userId: currentUser._id,
      messageId,
      value,
      reason,
      note,
    });

    return res.json({ ok: true, feedback });
  } catch (error) {
    console.error("[handleChatFeedback] error:", error);
    return res.status(400).json({
      error: error.message || "Không gửi được feedback",
    });
  }
}

export async function handleChatTelemetrySummary(req, res) {
  try {
    const summary = await getChatTelemetrySummary({
      days: req.query.days,
    });
    return res.json(summary);
  } catch (error) {
    console.error("[handleChatTelemetrySummary] error:", error);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

export async function handleChatTelemetryTurns(req, res) {
  try {
    const data = await listChatTelemetryTurns({
      days: req.query.days,
      page: req.query.page,
      limit: req.query.limit,
      outcome: req.query.outcome,
      intent: req.query.intent,
      routeKind: req.query.routeKind,
    });
    return res.json(data);
  } catch (error) {
    console.error("[handleChatTelemetryTurns] error:", error);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

export async function handleChatTelemetryEvent(req, res) {
  try {
    const currentUser = req.user;
    const { messageId, type, label, actionType, success, detail } = req.body || {};

    if (!messageId || !type) {
      return res.status(400).json({ error: "Thiếu messageId hoặc type" });
    }

    const event = await recordChatTelemetryEvent({
      userId: currentUser?._id || null,
      messageId,
      type,
      label,
      actionType,
      success,
      detail,
    });

    return res.json({ ok: true, event });
  } catch (error) {
    console.error("[handleChatTelemetryEvent] error:", error);
    return res.status(400).json({
      error: error.message || "Không ghi được telemetry event",
    });
  }
}

/* ========== GET CHAT HISTORY (cursor-based) ========== */
export async function handleGetChatHistory(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const before = req.query.before; // cursor: _id of oldest message client has

    const query = {
      userId: currentUser._id,
      role: { $in: ["user", "bot"] }, // exclude system messages
    };

    // Cursor: fetch messages OLDER than the given _id
    if (before) {
      query._id = { $lt: before };
    }

    // Sort DESC to get the most recent N, then reverse for chronological order
    const messages = await ChatBotMessage.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1) // fetch one extra to determine hasMore
      .lean();

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop(); // remove the extra

    // Reverse to chronological order (oldest first)
    messages.reverse();

    const nextCursor = hasMore ? messages[0]?._id : null;

    return res.json({
      messages: messages.map((m) => ({
        id: m._id,
        role: m.role,
        message: m.message,
        meta: m.meta,
        navigation: m.navigation,
        context: m.context,
        createdAt: m.createdAt,
      })),
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error("[handleGetChatHistory] error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

/* ========== CLEAR CHAT HISTORY ========== */
export async function handleClearChatHistory(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await ChatBotMessage.deleteMany({
      userId: currentUser._id,
    });

    return res.json({
      success: true,
      deleted: result.deletedCount,
    });
  } catch (err) {
    console.error("[handleClearChatHistory] error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

/* ========== CLEAR LEARNING MEMORY ========== */
export async function handleClearLearningMemory(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Only admins can clear the shared learning memory
    if (currentUser.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Chỉ admin mới có thể xóa bộ nhớ học" });
    }

    const Knowledge = (await import("../models/knowledgeModel.js")).default;
    const result = await Knowledge.deleteMany({ source: "bot-learned" });

    return res.json({
      success: true,
      deleted: result.deletedCount,
    });
  } catch (err) {
    console.error("[handleClearLearningMemory] error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

/* ========== HELPERS ========== */
function computeSessionResetAt(limitTime) {
  const t = new Date(limitTime);
  const minutes = t.getMinutes();
  const extraMinutes = minutes === 0 ? 0 : 60 - minutes;
  const totalMinutes = 4 * 60 + extraMinutes;
  const reset = new Date(t.getTime() + totalMinutes * 60 * 1000);
  reset.setSeconds(0, 0);
  return reset;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}
