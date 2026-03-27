import { sendTelegramMessage } from "../services/telegram.service.js";

const seen = new Map();
const DEDUPE_TTL_MS = 10 * 60 * 1000;

function purgeSeen() {
  const now = Date.now();
  for (const [key, expiresAt] of seen.entries()) {
    if (expiresAt <= now) {
      seen.delete(key);
    }
  }
}

function isDuplicate(key) {
  purgeSeen();
  if (!key) return false;
  if (seen.has(key)) return true;
  seen.set(key, Date.now() + DEDUPE_TTL_MS);
  return false;
}

function safeClip(value, max = 3000) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function readHeaderBearer(req) {
  const raw = String(req.get("authorization") || "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return "";
  return raw.slice(7).trim();
}

function normalizeTagEntries(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags
      .map((entry) => {
        if (Array.isArray(entry) && entry.length >= 2) {
          return [String(entry[0]), entry[1]];
        }
        if (entry && typeof entry === "object" && entry.key) {
          return [String(entry.key), entry.value];
        }
        return null;
      })
      .filter(Boolean);
  }
  if (typeof tags === "object") {
    return Object.entries(tags);
  }
  return [];
}

function readTag(payload, ...names) {
  const sources = [
    payload?.tags,
    payload?.data?.tags,
    payload?.data?.issue?.tags,
    payload?.data?.event?.tags,
    payload?.event?.tags,
  ];

  for (const source of sources) {
    const entries = normalizeTagEntries(source);
    for (const [key, value] of entries) {
      if (names.includes(String(key).toLowerCase())) {
        return value;
      }
    }
  }

  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function readEnvironment(payload) {
  return (
    firstText(
      payload?.environment,
      payload?.data?.environment,
      payload?.data?.event?.environment,
      payload?.event?.environment,
      readTag(payload, "environment"),
    ) || "unknown"
  );
}

function readLevel(payload) {
  return (
    firstText(
      payload?.level,
      payload?.data?.event?.level,
      payload?.data?.issue?.level,
      payload?.event?.level,
      readTag(payload, "level"),
    ) || "error"
  );
}

function readProject(payload) {
  return (
    firstText(
      payload?.project,
      payload?.project_name,
      payload?.project_slug,
      payload?.data?.project,
      payload?.data?.issue?.project?.slug,
      payload?.data?.issue?.project?.name,
      payload?.data?.event?.project,
    ) || "unknown"
  );
}

function readTitle(payload) {
  return (
    firstText(
      payload?.title,
      payload?.message,
      payload?.data?.issue?.title,
      payload?.data?.event?.title,
      payload?.event?.title,
    ) || "Sentry issue"
  );
}

function readCulprit(payload) {
  return firstText(
    payload?.culprit,
    payload?.data?.issue?.culprit,
    payload?.data?.event?.culprit,
    payload?.event?.culprit,
  );
}

function readRelease(payload) {
  const releaseValue =
    payload?.release ||
    payload?.data?.release ||
    payload?.data?.event?.release ||
    payload?.event?.release ||
    payload?.data?.issue?.release ||
    payload?.data?.issue?.release?.version ||
    readTag(payload, "release");

  if (releaseValue && typeof releaseValue === "object") {
    return firstText(releaseValue.version, releaseValue.name);
  }

  return firstText(releaseValue);
}

function readUser(payload) {
  const user =
    payload?.user ||
    payload?.data?.user ||
    payload?.data?.event?.user ||
    payload?.event?.user ||
    payload?.data?.issue?.user;

  if (!user || typeof user !== "object") return "";

  return firstText(
    user.email,
    user.username,
    user.name,
    user.id,
    user.ip_address,
  );
}

function readIssueUrl(payload) {
  return firstText(
    payload?.url,
    payload?.issue_url,
    payload?.web_url,
    payload?.data?.url,
    payload?.data?.issue?.url,
    payload?.data?.issue?.web_url,
    payload?.data?.event?.url,
    payload?.event?.url,
  );
}

function buildDedupeKey(payload) {
  const action = firstText(payload?.action, payload?.event, "issue");
  const issueId = firstText(
    payload?.issue?.id,
    payload?.data?.issue?.id,
    payload?.issue_id,
  );
  const eventId = firstText(
    payload?.event_id,
    payload?.data?.event?.event_id,
    payload?.data?.event?.id,
    payload?.event?.event_id,
    payload?.event?.id,
  );

  if (issueId || eventId) {
    return [action, issueId || "no-issue", eventId || "no-event"].join(":");
  }

  return [action, readProject(payload), readTitle(payload)].join(":");
}

function isProductionPayload(payload) {
  const environment = String(readEnvironment(payload) || "unknown")
    .trim()
    .toLowerCase();
  if (!environment || environment === "unknown") return true;
  return environment === "production";
}

function formatTelegramMessage(payload) {
  const environment = readEnvironment(payload);
  const project = readProject(payload);
  const level = readLevel(payload).toUpperCase();
  const title = safeClip(readTitle(payload), 600);
  const culprit = safeClip(readCulprit(payload), 500);
  const release = safeClip(readRelease(payload), 200);
  const user = safeClip(readUser(payload), 200);
  const issueUrl = readIssueUrl(payload);

  const lines = [
    "🚨 Sentry issue",
    "",
    `Project: ${project}`,
    `Env: ${environment || "unknown"}`,
    `Level: ${level || "ERROR"}`,
    `Title: ${title || "Sentry issue"}`,
  ];

  if (culprit) lines.push(`Culprit: ${culprit}`);
  if (release) lines.push(`Release: ${release}`);
  if (user) lines.push(`User: ${user}`);
  if (issueUrl) lines.push(`Link: ${issueUrl}`);

  return safeClip(lines.join("\n"), 3500);
}

export function sentryIssueWebhookHandler(req, res) {
  const expectedToken = String(process.env.SENTRY_WEBHOOK_TOKEN || "").trim();
  if (!expectedToken) {
    return res.status(503).json({
      message: "Sentry webhook is disabled: missing SENTRY_WEBHOOK_TOKEN",
    });
  }

  const token = readHeaderBearer(req);
  if (!token) {
    return res.status(401).json({ message: "Missing bearer token" });
  }

  if (token !== expectedToken) {
    return res.status(403).json({ message: "Invalid bearer token" });
  }

  const payload = req.body || {};
  const dedupeKey = buildDedupeKey(payload);

  res.status(202).json({ ok: true });

  setImmediate(async () => {
    try {
      if (!isProductionPayload(payload)) return;
      if (isDuplicate(dedupeKey)) return;

      const chatId =
        process.env.TELEGRAM_CHAT_SENTRY_ID ||
        process.env.TELEGRAM_CHAT_CRASH_ID;

      if (!chatId) {
        console.warn(
          "[sentry->tele] Missing TELEGRAM_CHAT_SENTRY_ID / TELEGRAM_CHAT_CRASH_ID",
        );
        return;
      }

      await sendTelegramMessage(formatTelegramMessage(payload), { chatId });
    } catch (error) {
      console.error("[sentry->tele] forward error:", error?.message || error);
    }
  });
}
