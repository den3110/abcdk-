// services/ops/opsMonitor.service.js
// Điều phối vòng quét định kỳ: chạy check → so với trạng thái lần trước → chỉ báo khi CÓ THAY ĐỔI
// (mới phát sinh / nặng hơn / đã hồi phục), kèm nhắc lại định kỳ nếu vấn đề kéo dài.
import OpsAlertState from "../../models/opsAlertStateModel.js";
import { runOpsHealthChecks } from "./opsHealthChecks.service.js";
import {
  formatTime,
  humanizeAge,
  isOpsAlertEnabled,
  sendOpsAlert,
  severityRank,
} from "./opsAlert.service.js";
import { opsTgSend, htmlEscape } from "./opsTelegram.service.js";

const PROBLEM_STATUSES = new Set(["warn", "error", "critical"]);

// Vấn đề kéo dài thì nhắc lại sau bao lâu (tránh im lặng nhưng cũng tránh spam)
const REMIND_MS = {
  warn: Number(process.env.OPS_REMIND_WARN_MS || 24 * 60 * 60 * 1000),
  error: Number(process.env.OPS_REMIND_ERROR_MS || 12 * 60 * 60 * 1000),
  critical: Number(process.env.OPS_REMIND_CRITICAL_MS || 3 * 60 * 60 * 1000),
};

const STATUS_EMOJI = {
  ok: "✅",
  warn: "⚠️",
  error: "🔴",
  critical: "🚨",
  skip: "⚪️",
};

let lastSnapshot = null;

export function getLastOpsSnapshot() {
  return lastSnapshot;
}

function shouldNotify(prev, result) {
  if (!prev || prev.status !== "firing") return { notify: true, reason: "new" };
  if (severityRank(result.status) > severityRank(prev.severity))
    return { notify: true, reason: "escalated" };
  if (String(prev.message || "") !== String(result.message || ""))
    return { notify: true, reason: "changed" };

  const remindMs = REMIND_MS[result.status] ?? REMIND_MS.warn;
  const last = prev.lastNotifiedAt ? new Date(prev.lastNotifiedAt).getTime() : 0;
  if (Date.now() - last >= remindMs) return { notify: true, reason: "reminder" };
  return { notify: false, reason: "unchanged" };
}

async function markFiring(key, result, notified) {
  const now = new Date();
  const update = {
    $set: {
      kind: "health",
      severity: result.status,
      status: "firing",
      title: result.label || result.key,
      message: result.message || "",
      detail: result.detail ?? null,
      lastSeenAt: now,
      resolvedAt: null,
    },
    $inc: { occurrences: 1 },
    $setOnInsert: { firstSeenAt: now },
  };
  if (notified) update.$set.lastNotifiedAt = now;
  await OpsAlertState.updateOne({ key }, update, { upsert: true });
}

async function markResolved(key, result) {
  const now = new Date();
  await OpsAlertState.updateOne(
    { key },
    {
      $set: {
        status: "ok",
        message: result.message || "",
        detail: result.detail ?? null,
        lastSeenAt: now,
        resolvedAt: now,
        lastNotifiedAt: now,
      },
    }
  );
}

/**
 * Một vòng quét. Trả về snapshot + danh sách cảnh báo đã gửi.
 * `notify=false` để chỉ lấy trạng thái (dùng cho API xem nhanh, không bắn Telegram).
 */
export async function runOpsMonitorCycle({ notify = true } = {}) {
  const snapshot = await runOpsHealthChecks();
  lastSnapshot = snapshot;

  if (!notify || !isOpsAlertEnabled()) {
    return { ...snapshot, notified: [], skipped: !notify ? "notify-off" : "disabled" };
  }

  const notified = [];

  for (const result of snapshot.results) {
    const key = `health:${result.key}`;
    const prev = await OpsAlertState.findOne({ key }).lean();

    if (prev?.mutedUntil && new Date(prev.mutedUntil) > new Date()) continue;

    if (PROBLEM_STATUSES.has(result.status)) {
      const decision = shouldNotify(prev, result);
      if (decision.notify) {
        const since =
          prev?.status === "firing" && prev?.firstSeenAt
            ? `Kéo dài ${humanizeAge(prev.firstSeenAt)}`
            : "";
        await sendOpsAlert({
          severity: result.status,
          title: `${result.label || result.key}`,
          lines: [
            { label: "Tình trạng", value: result.message },
            result.hint ? { label: "Cần làm", value: result.hint } : null,
            since ? { label: "Ghi chú", value: since } : null,
          ].filter(Boolean),
          footer: decision.reason === "reminder" ? "nhắc lại" : "",
          force: true,
        });
        notified.push({ key: result.key, reason: decision.reason, status: result.status });
      }
      await markFiring(key, result, decision.notify);
      continue;
    }

    // Trạng thái ok/skip: nếu trước đó đang lỗi thì báo đã hồi phục.
    if (prev?.status === "firing") {
      await sendOpsAlert({
        severity: "info",
        title: `Đã hồi phục — ${result.label || result.key}`,
        lines: [
          { label: "Tình trạng", value: result.message || "Bình thường" },
          prev.firstSeenAt
            ? { label: "Đã lỗi trong", value: humanizeAge(prev.firstSeenAt) }
            : null,
        ].filter(Boolean),
        force: true,
        silent: true,
      });
      notified.push({ key: result.key, reason: "recovered", status: result.status });
      await markResolved(key, result);
    }
  }

  return { ...snapshot, notified };
}

/** Báo cáo tổng hợp hằng ngày — kể cả khi mọi thứ đều ổn, để biết hệ thống vẫn đang được theo dõi. */
export async function sendOpsDigest({ snapshot } = {}) {
  if (!isOpsAlertEnabled()) return { sent: false, reason: "disabled" };

  const data = snapshot || (await runOpsHealthChecks());
  lastSnapshot = data;

  const problems = data.results.filter((r) => PROBLEM_STATUSES.has(r.status));
  const healthy = data.results.filter((r) => r.status === "ok");
  const skipped = data.results.filter((r) => r.status === "skip");

  const header = problems.length
    ? `📋 <b>Báo cáo hệ thống — ${problems.length} mục cần chú ý</b>`
    : "📋 <b>Báo cáo hệ thống — mọi thứ bình thường</b>";

  const lines = [header, ""];

  if (problems.length) {
    lines.push("<b>Cần xử lý</b>");
    for (const item of problems) {
      lines.push(
        `${STATUS_EMOJI[item.status]} <b>${htmlEscape(item.label || item.key)}</b> — ${htmlEscape(item.message)}`
      );
      if (item.hint) lines.push(`   ↳ <i>${htmlEscape(item.hint)}</i>`);
    }
    lines.push("");
  }

  if (healthy.length) {
    lines.push("<b>Bình thường</b>");
    for (const item of healthy) {
      lines.push(`✅ ${htmlEscape(item.label || item.key)} — ${htmlEscape(item.message)}`);
    }
    lines.push("");
  }

  if (skipped.length) {
    lines.push(
      `<i>Bỏ qua (đang tắt/chưa cấu hình): ${htmlEscape(
        skipped.map((item) => item.label || item.key).join(", ")
      )}</i>`
    );
    lines.push("");
  }

  lines.push(`<i>${htmlEscape(formatTime())} · quét ${data.durationMs}ms</i>`);

  const result = await opsTgSend(lines.join("\n"), { silent: !problems.length });
  return { sent: result.sent > 0, problems: problems.length };
}
