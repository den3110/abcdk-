import { DateTime } from "luxon";

const DEFAULT_WINDOW_TZ = "Asia/Saigon";
const DEFAULT_WINDOW_START = "00:00";
const DEFAULT_WINDOW_END = "06:00";

function asTrimmed(value) {
  return String(value || "").trim();
}

function parseWindowTime(rawValue, fallbackValue) {
  const raw = asTrimmed(rawValue || fallbackValue);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) {
    return parseWindowTime(fallbackValue, fallbackValue);
  }

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

  return {
    raw,
    hour,
    minute,
  };
}

function isTruthy(value) {
  const normalized = asTrimmed(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function getLiveRecordingExportWindowConfig() {
  const timezone = asTrimmed(process.env.LIVE_RECORDING_EXPORT_WINDOW_TZ) || DEFAULT_WINDOW_TZ;
  const start = parseWindowTime(
    process.env.LIVE_RECORDING_EXPORT_WINDOW_START,
    DEFAULT_WINDOW_START
  );
  const end = parseWindowTime(
    process.env.LIVE_RECORDING_EXPORT_WINDOW_END,
    DEFAULT_WINDOW_END
  );
  const enabled = isTruthy(process.env.LIVE_RECORDING_EXPORT_WINDOW_ENABLED);

  return {
    enabled,
    timezone,
    start,
    end,
    crossesMidnight:
      end.hour < start.hour ||
      (end.hour === start.hour && end.minute <= start.minute),
  };
}

function buildWindowDateTime(base, time) {
  return base.set({
    hour: time.hour,
    minute: time.minute,
    second: 0,
    millisecond: 0,
  });
}

export function getLiveRecordingExportWindowDecision(now = new Date()) {
  const config = getLiveRecordingExportWindowConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      shouldQueueNow: true,
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

  const scheduledAt = inWindow ? nowInZone : nextWindowStart;
  const delayMs = Math.max(
    0,
    Math.round(scheduledAt.toMillis() - nowInZone.toMillis())
  );

  return {
    enabled: true,
    shouldQueueNow: inWindow || delayMs === 0,
    delayMs,
    scheduledAt: scheduledAt.toJSDate(),
    scheduledAtIso: scheduledAt.toISO(),
    timezone: config.timezone,
    windowStart: config.start.raw,
    windowEnd: config.end.raw,
  };
}
