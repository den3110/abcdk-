// services/ops/opsAlert.service.js
// Lớp cảnh báo vận hành: định dạng tin, khử trùng lặp (dedupe/cooldown) và bắn lên Telegram.
//
// Dedupe lưu ở Mongo (OpsAlertState) nên an toàn khi API chạy PM2 cluster:
// 2 process cùng gặp 1 lỗi thì chỉ 1 tin được gửi.
import os from "os";
import OpsAlertState from "../../models/opsAlertStateModel.js";
import { htmlEscape, isOpsTelegramConfigured, opsTgSend } from "./opsTelegram.service.js";

const SEVERITY_META = {
  info: { emoji: "ℹ️", label: "THÔNG TIN", rank: 0, cooldownMs: 12 * 60 * 60 * 1000 },
  warn: { emoji: "⚠️", label: "CẢNH BÁO", rank: 1, cooldownMs: 6 * 60 * 60 * 1000 },
  error: { emoji: "🔴", label: "LỖI", rank: 2, cooldownMs: 30 * 60 * 1000 },
  critical: { emoji: "🚨", label: "NGHIÊM TRỌNG", rank: 3, cooldownMs: 10 * 60 * 1000 },
};

export const SEVERITIES = Object.keys(SEVERITY_META);

export function severityMeta(severity) {
  return SEVERITY_META[severity] || SEVERITY_META.warn;
}

export function severityRank(severity) {
  return severityMeta(severity).rank;
}

export function isOpsAlertEnabled() {
  if (String(process.env.OPS_MONITOR_ENABLED || "1") === "0") return false;
  return isOpsTelegramConfigured();
}

function appLabel() {
  return String(process.env.OPS_MONITOR_APP_LABEL || "PickleTour").trim();
}

function envLabel() {
  return String(process.env.NODE_ENV || "development").trim();
}

export function formatTime(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: process.env.TZ || "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return new Date(date).toISOString();
  }
}

/** Mô tả khoảng thời gian đã trôi qua theo kiểu người đọc (2 giờ 15 phút). */
export function humanizeAge(from, to = new Date()) {
  const ms = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  return `${days} ngày`;
}

/**
 * lines nhận 3 dạng:
 *   "chuỗi thường"            → tự escape
 *   { label, value }          → "<b>label:</b> value" (value được escape)
 *   { raw: "<a href=…>…</a>" } → chèn nguyên văn (chỉ dùng cho HTML mình tự dựng)
 */
function renderLines(lines = []) {
  const out = [];
  for (const line of lines) {
    if (line == null || line === false) continue;
    if (typeof line === "string") {
      out.push(htmlEscape(line));
      continue;
    }
    if (typeof line === "object" && typeof line.raw === "string") {
      out.push(line.raw);
      continue;
    }
    if (typeof line === "object" && line.label != null) {
      const value = line.value == null || line.value === "" ? "—" : String(line.value);
      out.push(`<b>${htmlEscape(line.label)}:</b> ${htmlEscape(value)}`);
      continue;
    }
    out.push(htmlEscape(String(line)));
  }
  return out;
}

export function buildOpsMessage({
  severity = "warn",
  title = "",
  lines = [],
  footer = "",
  code = "",
}) {
  const meta = severityMeta(severity);
  const head = `${meta.emoji} <b>${htmlEscape(title || meta.label)}</b>`;
  const body = renderLines(lines);
  const blocks = [head];
  if (body.length) blocks.push(body.join("\n"));
  if (code) {
    blocks.push(`<pre>${htmlEscape(String(code).slice(0, 1200))}</pre>`);
  }
  const tail = [
    `${appLabel()} · ${envLabel()} · ${os.hostname()}`,
    formatTime(),
    footer,
  ]
    .filter(Boolean)
    .join(" · ");
  blocks.push(`<i>${htmlEscape(tail)}</i>`);
  return blocks.join("\n\n");
}

/**
 * Giành quyền gửi cho một `key` — chỉ 1 process/1 lần trong cooldown được đi tiếp.
 * Trả về document state nếu được gửi, null nếu bị chặn (đang trong cooldown / bị mute).
 */
async function claimNotifySlot(key, cooldownMs, patch) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - Math.max(0, cooldownMs));

  const muted = await OpsAlertState.findOne({ key }).select("mutedUntil").lean();
  if (muted?.mutedUntil && new Date(muted.mutedUntil) > now) return null;

  try {
    return await OpsAlertState.findOneAndUpdate(
      {
        key,
        $or: [{ lastNotifiedAt: null }, { lastNotifiedAt: { $lte: cutoff } }],
      },
      {
        $set: { ...patch, lastSeenAt: now, lastNotifiedAt: now },
        $inc: { occurrences: 1 },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Doc đã tồn tại nhưng chưa hết cooldown → upsert đụng unique index → coi như bị chặn.
    if (error?.code === 11000) {
      await OpsAlertState.updateOne(
        { key },
        { $set: { lastSeenAt: now }, $inc: { occurrences: 1 } }
      ).catch(() => {});
      return null;
    }
    throw error;
  }
}

/**
 * Gửi 1 cảnh báo lên Telegram ops.
 * Có `key` → khử trùng lặp theo cooldown; không có `key` → gửi thẳng.
 * KHÔNG BAO GIỜ throw: cảnh báo hỏng không được làm hỏng luồng nghiệp vụ.
 */
export async function sendOpsAlert({
  key = "",
  kind = "event",
  severity = "warn",
  title,
  lines = [],
  code = "",
  footer = "",
  detail = null,
  cooldownMs,
  silent,
  force = false,
} = {}) {
  try {
    if (!isOpsAlertEnabled()) return { sent: false, reason: "disabled" };

    const meta = severityMeta(severity);
    const effectiveCooldown =
      typeof cooldownMs === "number" ? cooldownMs : meta.cooldownMs;

    let state = null;
    if (key && !force) {
      state = await claimNotifySlot(key, effectiveCooldown, {
        kind,
        severity,
        status: "firing",
        title: String(title || "").slice(0, 300),
        message: renderLines(lines).join(" | ").slice(0, 1000),
        detail,
      });
      if (!state) return { sent: false, reason: "cooldown" };
    }

    const repeatNote =
      state && state.occurrences > 1 ? `lần thứ ${state.occurrences}` : "";

    const html = buildOpsMessage({
      severity,
      title,
      lines,
      code,
      footer: [footer, repeatNote].filter(Boolean).join(" · "),
    });

    const quiet =
      typeof silent === "boolean" ? silent : severityRank(severity) <= 0;
    const result = await opsTgSend(html, { silent: quiet });
    return { sent: result.sent > 0, result, state };
  } catch (error) {
    console.error("[ops-alert] sendOpsAlert error:", error?.message || error);
    return { sent: false, reason: "error", error: error?.message };
  }
}

/** Báo lỗi runtime (exception, 5xx, job fail…) — gộp theo `key` để khỏi spam. */
export async function reportOpsIncident({
  key,
  severity = "error",
  title,
  lines = [],
  error,
  cooldownMs,
} = {}) {
  const stack = error?.stack ? String(error.stack).split("\n").slice(0, 6).join("\n") : "";
  return sendOpsAlert({
    key,
    kind: "incident",
    severity,
    title,
    lines: error?.message
      ? [...lines, { label: "Lỗi", value: error.message }]
      : lines,
    code: stack,
    cooldownMs,
  });
}

/** Sự kiện nghiệp vụ cần người biết ngay (phiếu hỗ trợ mới, đơn chờ duyệt…). */
export async function notifyOpsEvent({
  key = "",
  severity = "info",
  title,
  lines = [],
  cooldownMs = 0,
} = {}) {
  return sendOpsAlert({
    key,
    kind: "event",
    severity,
    title,
    lines,
    cooldownMs,
    force: !key,
  });
}
