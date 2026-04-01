import ChatBotMessage from "../../models/chatBotMessageModel.js";
import ChatBotTelemetry from "../../models/chatBotTelemetryModel.js";

const TELEMETRY_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.CHATBOT_TELEMETRY_RETENTION_DAYS || 30),
);

function computeExpiresAt() {
  return new Date(Date.now() + TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function compactString(value, maxLength = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function compactStringList(values, limit = 12, maxLength = 96) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => compactString(item, maxLength))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function percentileFromSorted(values, fraction) {
  if (!values.length) return 0;
  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1));
  return values[index];
}

export async function logChatTelemetry(payload = {}) {
  try {
    if (!payload.turnId) return null;

    return await ChatBotTelemetry.create({
      turnId: String(payload.turnId),
      userId: payload.userId || null,
      messageId: payload.messageId || null,
      replyTo: payload.replyTo || null,
      pageType: compactString(payload.pageType, 80),
      pageSection: compactString(payload.pageSection, 80),
      pageView: compactString(payload.pageView, 80),
      surface: compactString(payload.surface, 24) || "web",
      intent: compactString(payload.intent, 80),
      routeKind: compactString(payload.routeKind, 80),
      routeLane: compactString(payload.routeLane, 80),
      queryScope: [
        "general_knowledge",
        "page_scoped",
        "entity_scoped",
        "operator",
      ].includes(payload.queryScope)
        ? payload.queryScope
        : "",
      contextConfidence: ["high", "medium", "low"].includes(
        payload.contextConfidence,
      )
        ? payload.contextConfidence
        : "",
      toolsPlanned: compactStringList(payload.toolsPlanned, 12, 48),
      toolsUsed: compactStringList(payload.toolsUsed, 12, 48),
      toolLatencyMs: (Array.isArray(payload.toolLatencyMs) ? payload.toolLatencyMs : [])
        .slice(0, 12)
        .map((item) => ({
          tool: compactString(item?.tool, 48),
          durationMs: Number(item?.durationMs || 0),
          error: Boolean(item?.error),
        })),
      model: compactString(payload.model, 80),
      mode: compactString(payload.mode, 40),
      reasoningUsed: Boolean(payload.reasoningUsed),
      firstTokenLatencyMs: Number(payload.firstTokenLatencyMs || 0),
      processingTimeMs: Number(payload.processingTimeMs || 0),
      actionCount: Number(payload.actionCount || 0),
      actionTypes: compactStringList(payload.actionTypes, 12, 48),
      actionExecuted: (Array.isArray(payload.actionExecuted) ? payload.actionExecuted : [])
        .slice(0, 12)
        .map((item) => ({
          type: compactString(item?.type, 48),
          label: compactString(item?.label, 96),
          success: item?.success !== false,
          at: item?.at ? new Date(item.at) : new Date(),
        })),
      workflowCount: Number(payload.workflowCount || 0),
      workflowExecuted: Number(payload.workflowExecuted || 0),
      cardKinds: compactStringList(payload.cardKinds, 12, 48),
      sourceCount: Number(payload.sourceCount || 0),
      groundingStatus: ["grounded", "partial", "unsupported"].includes(
        payload.groundingStatus,
      )
        ? payload.groundingStatus
        : "",
      operatorStatus: ["page_action", "navigate_fallback", "unsupported"].includes(
        payload.operatorStatus,
      )
        ? payload.operatorStatus
        : "",
      retrievalMode: ["internal", "hybrid_live"].includes(payload.retrievalMode)
        ? payload.retrievalMode
        : "",
      guardApplied: Boolean(payload.guardApplied),
      fallbackUsed: Boolean(payload.fallbackUsed),
      unsupportedIntent: compactString(payload.unsupportedIntent, 80),
      unsupportedAction: compactString(payload.unsupportedAction, 96),
      mutationType: compactString(payload.mutationType, 64),
      mutationConfirmed: Number(payload.mutationConfirmed || 0),
      mutationCancelled: Number(payload.mutationCancelled || 0),
      outcome: ["success", "aborted", "error", "empty"].includes(payload.outcome)
        ? payload.outcome
        : "success",
      feedback: payload.feedback
        ? {
            value: payload.feedback.value === "negative" ? "negative" : "positive",
            reason: compactString(payload.feedback.reason, 120),
            note: compactString(payload.feedback.note, 320),
            at: payload.feedback.at ? new Date(payload.feedback.at) : new Date(),
          }
        : undefined,
      meta: payload.meta || null,
      expiresAt: computeExpiresAt(),
    });
  } catch (error) {
    console.error("[logChatTelemetry] error:", error.message);
    return null;
  }
}

export async function submitChatFeedback({
  userId,
  messageId,
  value,
  reason = "",
  note = "",
}) {
  if (!userId || !messageId) {
    throw new Error("Thiếu userId hoặc messageId");
  }

  const normalizedValue = value === "negative" ? "negative" : "positive";
  const feedback = {
    value: normalizedValue,
    reason: compactString(reason, 120),
    note: compactString(note, 320),
    at: new Date(),
  };

  const message = await ChatBotMessage.findOne({
    _id: messageId,
    role: "bot",
    userId,
  }).lean();

  if (!message) {
    throw new Error("Không tìm thấy tin nhắn bot để gửi feedback");
  }

  await ChatBotMessage.updateOne(
    { _id: messageId, userId },
    {
      $set: {
        "meta.feedback": feedback,
      },
    },
  );

  await ChatBotTelemetry.findOneAndUpdate(
    { messageId, userId },
    {
      $set: {
        feedback,
      },
      $setOnInsert: {
        turnId: String(message.replyTo || message._id),
        userId,
        messageId,
        replyTo: message.replyTo || null,
        outcome: "success",
        expiresAt: computeExpiresAt(),
      },
    },
    {
      upsert: true,
      new: true,
    },
  );

  return feedback;
}

function normalizeClientEventType(value) {
  const next = String(value || "").trim().toLowerCase();
  if (
    [
      "action_executed",
      "action_unsupported",
      "action_degraded",
      "suggestion_clicked",
      "workflow_executed",
      "workflow_degraded",
      "workflow_unsupported",
      "mutation_confirmed",
      "mutation_cancelled",
    ].includes(
      next,
    )
  ) {
    return next;
  }
  return "";
}

function compactClientEvent(payload = {}) {
  const type = normalizeClientEventType(payload.type);
  if (!type) return null;

  return {
    type,
    label: compactString(payload.label, 120),
    actionType: compactString(payload.actionType, 48),
    success: payload.success !== false,
    at: payload.at ? new Date(payload.at) : new Date(),
    detail: compactString(payload.detail, 240),
    surface: compactString(payload.surface, 24) || "",
  };
}

export async function recordChatTelemetryEvent({
  userId = null,
  messageId,
  type,
  label = "",
  actionType = "",
  success = true,
  detail = "",
  surface = "",
} = {}) {
  if (!messageId) {
    throw new Error("Thiếu messageId");
  }

  const event = compactClientEvent({
    type,
    label,
    actionType,
    success,
    detail,
    surface,
  });

  if (!event) {
    throw new Error("Loại telemetry event không hợp lệ");
  }

  const messageQuery = userId
    ? { _id: messageId, role: "bot", userId }
    : { _id: messageId, role: "bot", userId: null };

  const message = await ChatBotMessage.findOne(messageQuery).lean();
  if (!message) {
    throw new Error("Không tìm thấy tin nhắn bot để ghi telemetry");
  }

  const messageUpdate = {
    $push: {
      "meta.clientEvents": event,
    },
  };
  if (event.type === "action_executed") {
    messageUpdate.$push["meta.actionExecutionSummary.executed"] = {
      type: event.actionType,
      label: event.label,
      success: event.success,
      at: event.at,
    };
  }
  if (event.type === "workflow_executed") {
    messageUpdate.$set = {
      ...(messageUpdate.$set || {}),
      "meta.workflowExecutionSummary.lastRunAt": event.at,
    };
  }
  if (event.type === "mutation_confirmed") {
    messageUpdate.$set = {
      ...(messageUpdate.$set || {}),
      "meta.mutationPreview.lastConfirmedAt": event.at,
    };
  }

  await ChatBotMessage.updateOne({ _id: messageId }, messageUpdate);

  const telemetryUpdate = {
    $push: {
      "meta.clientEvents": event,
    },
    $setOnInsert: {
      turnId: String(message.replyTo || message._id),
      userId: message.userId || null,
      messageId,
      replyTo: message.replyTo || null,
      outcome: "success",
      expiresAt: computeExpiresAt(),
    },
  };

  if (event.type === "action_executed") {
    telemetryUpdate.$push.actionExecuted = {
      type: event.actionType,
      label: event.label,
      success: event.success,
      at: event.at,
    };
  }
  if (event.surface) {
    telemetryUpdate.$set = {
      ...(telemetryUpdate.$set || {}),
      surface: event.surface,
    };
  }
  if (event.type === "action_degraded") {
    telemetryUpdate.$set = {
      ...(telemetryUpdate.$set || {}),
      fallbackUsed: true,
      unsupportedAction: compactString(event.actionType || event.label, 96),
    };
  }
  if (event.type === "action_unsupported") {
    telemetryUpdate.$set = {
      ...(telemetryUpdate.$set || {}),
      unsupportedAction: compactString(event.actionType || event.label, 96),
    };
  }
  if (event.type === "workflow_executed") {
    telemetryUpdate.$inc = {
      ...(telemetryUpdate.$inc || {}),
      workflowExecuted: 1,
    };
  }
  if (event.type === "workflow_degraded") {
    telemetryUpdate.$inc = {
      ...(telemetryUpdate.$inc || {}),
      workflowExecuted: 1,
    };
    telemetryUpdate.$set = {
      ...(telemetryUpdate.$set || {}),
      fallbackUsed: true,
    };
  }
  if (event.type === "workflow_unsupported") {
    telemetryUpdate.$set = {
      ...(telemetryUpdate.$set || {}),
      unsupportedAction: compactString(event.actionType || event.label, 96),
    };
  }
  if (event.type === "mutation_confirmed") {
    telemetryUpdate.$inc = {
      ...(telemetryUpdate.$inc || {}),
      mutationConfirmed: 1,
    };
    telemetryUpdate.$set = {
      ...(telemetryUpdate.$set || {}),
      mutationType: compactString(event.actionType || event.label, 64),
    };
  }
  if (event.type === "mutation_cancelled") {
    telemetryUpdate.$inc = {
      ...(telemetryUpdate.$inc || {}),
      mutationCancelled: 1,
    };
    telemetryUpdate.$set = {
      ...(telemetryUpdate.$set || {}),
      mutationType: compactString(event.actionType || event.label, 64),
    };
  }

  await ChatBotTelemetry.findOneAndUpdate(
    userId ? { messageId, userId } : { messageId, userId: null },
    telemetryUpdate,
    {
      upsert: true,
      new: true,
    },
  );

  return event;
}

export async function getChatTelemetrySummary({ days = 7 } = {}) {
  const safeDays = Math.max(1, Math.min(90, Number(days || 7)));
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

  const turns = await ChatBotTelemetry.find({
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .limit(2000)
    .lean();

  const outcomes = {};
  const intents = {};
  const routeKinds = {};
  const routeLanes = {};
  const queryScopes = {};
  const contextConfidences = {};
  const surfaces = {};
  const actionTypes = {};
  const cardKinds = {};
  const toolUsage = {};
  const failures = {};
  const feedbackReasons = {};
  const unsupportedActions = {};
  const unsupportedIntents = {};
  const groundingStatuses = {};
  const operatorStatuses = {};
  const retrievalModes = {};
  const mutationTypes = {};
  let positiveFeedback = 0;
  let negativeFeedback = 0;
  let guardHits = 0;
  let fallbackUsed = 0;
  let mutationConfirmed = 0;
  let mutationCancelled = 0;

  const firstTokenLatencies = [];
  const processingLatencies = [];
  const latencyBySurface = {};
  const actionStatusBySurface = {};
  const workflowStatusBySurface = {};

  turns.forEach((turn) => {
    outcomes[turn.outcome || "success"] = (outcomes[turn.outcome || "success"] || 0) + 1;

    if (turn.intent) {
      intents[turn.intent] = (intents[turn.intent] || 0) + 1;
    }
    if (turn.routeKind) {
      routeKinds[turn.routeKind] = (routeKinds[turn.routeKind] || 0) + 1;
    }
    if (turn.routeLane) {
      routeLanes[turn.routeLane] = (routeLanes[turn.routeLane] || 0) + 1;
    }
    if (turn.queryScope) {
      queryScopes[turn.queryScope] = (queryScopes[turn.queryScope] || 0) + 1;
    }
    if (turn.contextConfidence) {
      contextConfidences[turn.contextConfidence] =
        (contextConfidences[turn.contextConfidence] || 0) + 1;
    }
    if (turn.surface) {
      surfaces[turn.surface] = (surfaces[turn.surface] || 0) + 1;
    }
    if (turn.groundingStatus) {
      groundingStatuses[turn.groundingStatus] =
        (groundingStatuses[turn.groundingStatus] || 0) + 1;
    }
    if (turn.operatorStatus) {
      operatorStatuses[turn.operatorStatus] =
        (operatorStatuses[turn.operatorStatus] || 0) + 1;
    }
    if (turn.retrievalMode) {
      retrievalModes[turn.retrievalMode] =
        (retrievalModes[turn.retrievalMode] || 0) + 1;
    }
    if (turn.unsupportedIntent) {
      unsupportedIntents[turn.unsupportedIntent] =
        (unsupportedIntents[turn.unsupportedIntent] || 0) + 1;
    }
    if (turn.unsupportedAction) {
      unsupportedActions[turn.unsupportedAction] =
        (unsupportedActions[turn.unsupportedAction] || 0) + 1;
    }
    if (turn.guardApplied) guardHits += 1;
    if (turn.fallbackUsed) fallbackUsed += 1;
    if (turn.mutationType) {
      mutationTypes[turn.mutationType] =
        (mutationTypes[turn.mutationType] || 0) + 1;
    }
    mutationConfirmed += Number(turn.mutationConfirmed || 0);
    mutationCancelled += Number(turn.mutationCancelled || 0);

    (turn.actionTypes || []).forEach((item) => {
      actionTypes[item] = (actionTypes[item] || 0) + 1;
    });
    [...(turn.toolsUsed || []), ...(turn.toolsPlanned || [])].forEach((item) => {
      toolUsage[item] = (toolUsage[item] || 0) + 1;
    });
    (turn.cardKinds || []).forEach((item) => {
      cardKinds[item] = (cardKinds[item] || 0) + 1;
    });

    if (turn.outcome === "error" || turn.outcome === "aborted") {
      const reason = compactString(turn.meta?.errorMessage || turn.routeKind || turn.intent || "unknown", 80);
      failures[reason] = (failures[reason] || 0) + 1;
    }

    if (Number(turn.firstTokenLatencyMs) > 0) {
      firstTokenLatencies.push(Number(turn.firstTokenLatencyMs));
      const surfaceKey = turn.surface || "unknown";
      latencyBySurface[surfaceKey] = latencyBySurface[surfaceKey] || {
        firstToken: [],
        processing: [],
      };
      latencyBySurface[surfaceKey].firstToken.push(Number(turn.firstTokenLatencyMs));
    }
    if (Number(turn.processingTimeMs) > 0) {
      processingLatencies.push(Number(turn.processingTimeMs));
      const surfaceKey = turn.surface || "unknown";
      latencyBySurface[surfaceKey] = latencyBySurface[surfaceKey] || {
        firstToken: [],
        processing: [],
      };
      latencyBySurface[surfaceKey].processing.push(Number(turn.processingTimeMs));
    }

    if (turn.feedback?.value === "positive") positiveFeedback += 1;
    if (turn.feedback?.value === "negative") {
      negativeFeedback += 1;
      if (turn.feedback?.reason) {
        feedbackReasons[turn.feedback.reason] =
          (feedbackReasons[turn.feedback.reason] || 0) + 1;
      }
    }

    (turn.meta?.clientEvents || []).forEach((event) => {
      const surfaceKey = event?.surface || turn.surface || "unknown";
      actionStatusBySurface[surfaceKey] = actionStatusBySurface[surfaceKey] || {
        executed: 0,
        unsupported: 0,
        degraded: 0,
      };
      workflowStatusBySurface[surfaceKey] = workflowStatusBySurface[surfaceKey] || {
        executed: 0,
        unsupported: 0,
        degraded: 0,
      };
      if (event?.type === "action_executed") {
        actionStatusBySurface[surfaceKey].executed += 1;
      }
      if (event?.type === "action_unsupported") {
        actionStatusBySurface[surfaceKey].unsupported += 1;
        const label = compactString(
          event.label || event.actionType || event.detail || "unsupported",
          96,
        );
        unsupportedActions[label] = (unsupportedActions[label] || 0) + 1;
      }
      if (event?.type === "action_degraded") {
        actionStatusBySurface[surfaceKey].degraded += 1;
        const label = compactString(
          event.label || event.actionType || event.detail || "degraded",
          96,
        );
        unsupportedActions[label] = (unsupportedActions[label] || 0) + 1;
      }
      if (event?.type === "workflow_executed") {
        workflowStatusBySurface[surfaceKey].executed += 1;
      }
      if (event?.type === "workflow_unsupported") {
        workflowStatusBySurface[surfaceKey].unsupported += 1;
      }
      if (event?.type === "workflow_degraded") {
        workflowStatusBySurface[surfaceKey].degraded += 1;
      }
      if (event?.type === "mutation_confirmed") {
        mutationConfirmed += 1;
      }
      if (event?.type === "mutation_cancelled") {
        mutationCancelled += 1;
      }
    });
  });

  firstTokenLatencies.sort((a, b) => a - b);
  processingLatencies.sort((a, b) => a - b);
  Object.values(latencyBySurface).forEach((item) => {
    item.firstToken.sort((a, b) => a - b);
    item.processing.sort((a, b) => a - b);
  });

  const sortCountEntries = (record, limit = 8) =>
    Object.entries(record)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([label, count]) => ({ label, count }));

  const latencyBySurfaceSummary = Object.fromEntries(
    Object.entries(latencyBySurface).map(([surface, values]) => [
      surface,
      {
        firstTokenP50: percentileFromSorted(values.firstToken, 0.5),
        firstTokenP95: percentileFromSorted(values.firstToken, 0.95),
        processingP50: percentileFromSorted(values.processing, 0.5),
        processingP95: percentileFromSorted(values.processing, 0.95),
      },
    ]),
  );

  return {
    days: safeDays,
    totalTurns: turns.length,
    outcomes,
    feedback: {
      positive: positiveFeedback,
      negative: negativeFeedback,
    },
    latency: {
      firstTokenP50: percentileFromSorted(firstTokenLatencies, 0.5),
      firstTokenP95: percentileFromSorted(firstTokenLatencies, 0.95),
      processingP50: percentileFromSorted(processingLatencies, 0.5),
      processingP95: percentileFromSorted(processingLatencies, 0.95),
    },
    topIntents: sortCountEntries(intents),
    topRouteKinds: sortCountEntries(routeKinds),
    topRouteLanes: sortCountEntries(routeLanes),
    topQueryScopes: sortCountEntries(queryScopes),
    topTools: sortCountEntries(toolUsage),
    topActionTypes: sortCountEntries(actionTypes),
    topCardKinds: sortCountEntries(cardKinds),
    topFailures: sortCountEntries(failures),
    topFeedbackReasons: sortCountEntries(feedbackReasons),
    topUnsupportedActions: sortCountEntries(unsupportedActions),
    topUnsupportedIntents: sortCountEntries(unsupportedIntents),
    groundingStatuses,
    operatorStatuses,
    contextConfidences,
    retrievalModes,
    queryScopes,
    surfaces,
    guardHits,
    fallbackUsed,
    mutationTypes,
    mutationConfirmed,
    mutationCancelled,
    actionStatusBySurface,
    workflowStatusBySurface,
    latencyBySurface: latencyBySurfaceSummary,
    throughput: {
      avgTurnsPerDay: Number((turns.length / safeDays).toFixed(2)),
    },
  };
}

export async function listChatTelemetryTurns({
  days = 7,
  page = 1,
  limit = 20,
  outcome = "",
  intent = "",
  routeKind = "",
} = {}) {
  const safeDays = Math.max(1, Math.min(90, Number(days || 7)));
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  const query = {
    createdAt: {
      $gte: new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000),
    },
  };

  if (outcome) query.outcome = outcome;
  if (intent) query.intent = intent;
  if (routeKind) query.routeKind = routeKind;

  const [turns, total] = await Promise.all([
    ChatBotTelemetry.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    ChatBotTelemetry.countDocuments(query),
  ]);

  return {
    page: safePage,
    limit: safeLimit,
    total,
    turns,
  };
}
