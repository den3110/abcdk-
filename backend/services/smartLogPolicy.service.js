import {
  cccdOpenai,
  OPENAI_CCCD_MODEL,
} from "../lib/openaiClient.js";
import { getObserverSinkConfig } from "./observerConfig.service.js";
import { getPeakRuntimeMetricsSnapshot } from "./requestMetrics.service.js";

const DEFAULT_AI_ADVICE = {
  ok: false,
  confirmOffload: false,
  severity: "unknown",
  reason: "",
  recommendation: "",
};

let routingState = {
  mode: "primary",
  reason: "normal",
  burstUntil: 0,
  lastDecisionAt: null,
  lastAiAdvice: null,
  lastAiAskedAt: 0,
  aiInFlight: false,
};

function nowIso() {
  return new Date().toISOString();
}

function shouldEnterBurst(cfg, totals = {}, extra = {}) {
  const reasons = [];
  const reqPerMin = Number(totals.reqPerMin || 0);
  const p95Ms = Number(totals.p95Ms || 0);
  const errors5xx = Number(totals.errors5xx || 0);
  const primaryPending = Number(extra.primaryPending || 0);

  if (reqPerMin >= Number(cfg.burstReqPerMinuteThreshold || 1200)) {
    reasons.push(`req_per_min=${reqPerMin}`);
  }
  if (p95Ms >= Number(cfg.burstP95MsThreshold || 1500)) {
    reasons.push(`p95_ms=${p95Ms}`);
  }
  if (errors5xx >= Number(cfg.burst5xxPerMinuteThreshold || 30)) {
    reasons.push(`errors_5xx=${errors5xx}`);
  }
  if (primaryPending >= Number(cfg.primaryQueueBurstThreshold || 3000)) {
    reasons.push(`primary_queue=${primaryPending}`);
  }

  return reasons;
}

function updateRoutingState(next = {}) {
  routingState = {
    ...routingState,
    ...next,
    lastDecisionAt: nowIso(),
  };
}

function buildManualDecision(mode, cfg) {
  if (mode === "primary") {
    return {
      mode: "primary",
      primary: cfg.primaryLogEnabled !== false,
      observer: false,
      reason: "manual_primary",
    };
  }

  if (mode === "observer") {
    return {
      mode: "observer",
      primary: false,
      observer: cfg.enabled !== false,
      reason: "manual_observer",
    };
  }

  if (mode === "hybrid") {
    return {
      mode: "hybrid",
      primary: cfg.primaryLogEnabled !== false,
      observer: cfg.enabled !== false,
      reason: "manual_hybrid",
    };
  }

  return null;
}

function safeJsonParse(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(normalized);
  } catch {
    const match = normalized.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function extractMessageText(messageContent) {
  if (typeof messageContent === "string") return messageContent;
  if (!Array.isArray(messageContent)) return "";
  return messageContent
    .map((part) => part?.text || part?.content || "")
    .filter(Boolean)
    .join("\n");
}

async function askAiAdvisor(decision, snapshot) {
  const cfg = getObserverSinkConfig();
  const model =
    process.env.OBSERVER_LOG_AI_MODEL ||
    process.env.OPENAI_CCCD_MODEL ||
    OPENAI_CCCD_MODEL ||
    "gpt-5";

  const messages = [
    {
      role: "system",
      content:
        "Bạn là trợ lý vận hành hệ thống PickleTour. Trả về JSON ngắn, không markdown.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Confirm whether log offload to Observer Azure is reasonable.",
        decision,
        runtime: snapshot?.totals || {},
        topEndpoints: snapshot?.endpoints?.slice?.(0, 5) || [],
        expectedJson: {
          confirmOffload: "boolean",
          severity: "low|medium|high",
          reason: "string",
          recommendation: "string",
        },
      }),
    },
  ];

  const call = cccdOpenai.chat.completions.create({
    model,
    messages,
    response_format: { type: "json_object" },
  });

  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error("AI advisor timeout")),
      cfg.aiAdvisorTimeoutMs
    );
  });

  const response = await Promise.race([call, timeout]);
  const text = extractMessageText(response?.choices?.[0]?.message?.content);
  const parsed = safeJsonParse(text) || {};
  return {
    ok: true,
    model,
    confirmOffload: parsed.confirmOffload === true,
    severity: String(parsed.severity || "medium"),
    reason: String(parsed.reason || ""),
    recommendation: String(parsed.recommendation || ""),
    advisedAt: nowIso(),
  };
}

export function getSmartLogRoutingState() {
  return { ...routingState };
}

export function decideSmartLogRoute(event = {}, extra = {}) {
  const cfg = getObserverSinkConfig();
  const smartMode = String(cfg.smartMode || "smart").toLowerCase();
  const manualDecision = buildManualDecision(smartMode, cfg);
  if (manualDecision) {
    updateRoutingState({
      mode: manualDecision.mode,
      reason: manualDecision.reason,
    });
    return manualDecision;
  }

  const snapshot = getPeakRuntimeMetricsSnapshot();
  const reasons = shouldEnterBurst(cfg, snapshot?.totals || {}, extra);
  const now = Date.now();

  if (reasons.length) {
    routingState.burstUntil = now + Number(cfg.burstCooldownMs || 300000);
  }

  const burstActive = reasons.length || now < Number(routingState.burstUntil || 0);
  const observerAvailable = cfg.enabled !== false;
  const primaryAvailable = cfg.primaryLogEnabled !== false;

  if (burstActive && observerAvailable) {
    const reason = reasons.length
      ? reasons.join(",")
      : routingState.reason || "burst_cooldown";
    const decision = {
      mode: "observer_burst",
      primary: false,
      observer: true,
      reason,
      snapshot,
    };
    updateRoutingState({ mode: decision.mode, reason });
    return decision;
  }

  if (primaryAvailable) {
    const decision = {
      mode: "primary",
      primary: true,
      observer: false,
      reason: "normal",
      snapshot,
    };
    updateRoutingState({ mode: decision.mode, reason: decision.reason });
    return decision;
  }

  const fallbackDecision = {
    mode: "observer_fallback",
    primary: false,
    observer: observerAvailable,
    reason: "primary_disabled",
    snapshot,
  };
  updateRoutingState({
    mode: fallbackDecision.mode,
    reason: fallbackDecision.reason,
  });
  return fallbackDecision;
}

export function maybeAskSmartLogAiAdvisor(decision) {
  const cfg = getObserverSinkConfig();
  if (!cfg.aiAdvisorEnabled || decision?.mode !== "observer_burst") return;
  if (routingState.aiInFlight) return;

  const now = Date.now();
  if (now - Number(routingState.lastAiAskedAt || 0) < cfg.aiAdvisorMinIntervalMs) {
    return;
  }

  routingState.aiInFlight = true;
  routingState.lastAiAskedAt = now;

  askAiAdvisor(decision, decision.snapshot)
    .then((advice) => {
      routingState.lastAiAdvice = advice;
    })
    .catch((error) => {
      routingState.lastAiAdvice = {
        ...DEFAULT_AI_ADVICE,
        reason: error?.message || String(error),
        advisedAt: nowIso(),
      };
    })
    .finally(() => {
      routingState.aiInFlight = false;
    });
}
