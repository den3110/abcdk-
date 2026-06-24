import { DateTime } from "luxon";

const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
const DEFAULT_START = "02:00";
const DEFAULT_END = "06:00";
const TZ_ALIASES = new Set([
  "asia/ho_chi_minh",
  "asia/saigon",
  "utc+7",
  "utc+07",
  "utc+07:00",
  "gmt+7",
  "gmt+07",
  "gmt+07:00",
  "+07",
  "+07:00",
  "ict",
]);

function asTrimmed(value) {
  return String(value || "").trim();
}

function asBool(value, fallback = false) {
  const normalized = asTrimmed(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeTimezone(value) {
  const raw = asTrimmed(value);
  if (!raw) return DEFAULT_TZ;
  if (TZ_ALIASES.has(raw.toLowerCase())) return DEFAULT_TZ;

  const probe = DateTime.now().setZone(raw);
  return probe.isValid ? raw : DEFAULT_TZ;
}

function parseWindowTime(rawValue, fallbackValue) {
  const raw = asTrimmed(rawValue || fallbackValue);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return parseWindowTime(fallbackValue, fallbackValue);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return parseWindowTime(fallbackValue, fallbackValue);
  }

  return { raw, hour, minute };
}

function buildWindowDateTime(base, time) {
  return base.set({
    hour: time.hour,
    minute: time.minute,
    second: 0,
    millisecond: 0,
  });
}

export function getBackgroundJobWindowConfig() {
  const enabledByPeak = asBool(process.env.PEAK_LIVE_MODE, false);
  const enabled = asBool(
    process.env.BACKGROUND_JOBS_WINDOW_ENABLED,
    enabledByPeak
  );
  const disabled = asBool(process.env.BACKGROUND_JOBS_DISABLED, false);
  const timezone = normalizeTimezone(
    process.env.BACKGROUND_JOBS_WINDOW_TZ ||
      process.env.CRON_TZ ||
      process.env.TZ
  );
  const start = parseWindowTime(
    process.env.BACKGROUND_JOBS_WINDOW_START,
    DEFAULT_START
  );
  const end = parseWindowTime(
    process.env.BACKGROUND_JOBS_WINDOW_END,
    DEFAULT_END
  );

  return {
    enabled,
    disabled,
    timezone,
    start,
    end,
    crossesMidnight:
      end.hour < start.hour ||
      (end.hour === start.hour && end.minute <= start.minute),
  };
}

export function getBackgroundJobWindowDecision(now = new Date()) {
  const config = getBackgroundJobWindowConfig();
  if (config.disabled) {
    return {
      allowed: false,
      reason: "background_jobs_disabled",
      delayMs: null,
      scheduledAt: null,
      timezone: config.timezone,
      windowStart: config.start.raw,
      windowEnd: config.end.raw,
    };
  }

  if (!config.enabled) {
    return {
      allowed: true,
      reason: "window_disabled",
      delayMs: 0,
      scheduledAt: null,
      timezone: config.timezone,
      windowStart: config.start.raw,
      windowEnd: config.end.raw,
    };
  }

  const nowInZone = DateTime.fromJSDate(now).setZone(config.timezone);
  const todayStart = buildWindowDateTime(nowInZone.startOf("day"), config.start);
  const todayEnd = buildWindowDateTime(nowInZone.startOf("day"), config.end);

  let inWindow = false;
  let nextWindowStart = todayStart;

  if (!config.crossesMidnight) {
    inWindow = nowInZone >= todayStart && nowInZone < todayEnd;
    if (!inWindow) {
      nextWindowStart = nowInZone < todayStart ? todayStart : todayStart.plus({ days: 1 });
    }
  } else {
    const overnightEnd = todayEnd.plus({ days: 1 });
    const previousWindowStart = todayStart.minus({ days: 1 });
    inWindow =
      (nowInZone >= todayStart && nowInZone < overnightEnd) ||
      nowInZone < todayEnd;
    if (!inWindow) {
      nextWindowStart = nowInZone >= todayEnd ? todayStart : previousWindowStart;
    }
  }

  const delayMs = Math.max(
    0,
    Math.round(nextWindowStart.toMillis() - nowInZone.toMillis())
  );

  return {
    allowed: inWindow,
    reason: inWindow ? "inside_window" : "outside_window",
    delayMs: inWindow ? 0 : delayMs,
    scheduledAt: inWindow ? nowInZone.toJSDate() : nextWindowStart.toJSDate(),
    scheduledAtIso: inWindow ? nowInZone.toISO() : nextWindowStart.toISO(),
    timezone: config.timezone,
    windowStart: config.start.raw,
    windowEnd: config.end.raw,
  };
}

export function shouldRunBackgroundJob() {
  return getBackgroundJobWindowDecision().allowed;
}

export function isBackgroundJobLeaderProcess() {
  const leaderOnly = asBool(process.env.BACKGROUND_JOBS_LEADER_ONLY, true);
  if (!leaderOnly) return true;

  const instanceId = asTrimmed(
    process.env.NODE_APP_INSTANCE ?? process.env.pm_id
  );
  return !instanceId || instanceId === "0";
}

export function getNextBackgroundJobDelayMs(fallbackMs = 60_000) {
  const decision = getBackgroundJobWindowDecision();
  if (decision.allowed) return 0;
  if (Number.isFinite(Number(decision.delayMs))) {
    return Math.max(5_000, Number(decision.delayMs));
  }
  return Math.max(5_000, Number(fallbackMs) || 60_000);
}
