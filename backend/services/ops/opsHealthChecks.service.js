// services/ops/opsHealthChecks.service.js
// Bộ kiểm tra định kỳ "cái gì sắp hỏng / sắp hết hạn / đang tồn đọng".
//
// Mỗi check trả về:
//   { key, label, status: "ok" | "warn" | "error" | "critical" | "skip", message, detail, hint }
//   - "skip"  = tính năng đang tắt / chưa cấu hình → không cảnh báo, chỉ hiện trong báo cáo ngày
//   - "hint"  = việc người vận hành cần làm để sửa
// Mọi check đều tự bọc try/catch: một check chết không được kéo sập cả vòng quét.
import tls from "tls";
import mongoose from "mongoose";

import OtpLog from "../../models/otpLogModel.js";
import FbToken from "../../models/fbTokenModel.js";
import SupportTicket from "../../models/supportTicketModel.js";
import CoachApplication from "../../models/coachApplicationModel.js";
import CourtOwnerRequest from "../../models/courtOwnerRequestModel.js";
import NicknameChangeRequest from "../../models/nicknameChangeRequestModel.js";
import FeedReport from "../../models/feedReportModel.js";
import Complaint from "../../models/complaintModel.js";
import User from "../../models/userModel.js";

import { getSystemSettingsRuntime } from "../systemSettingsRuntime.service.js";
import { getRecordingDriveStatus } from "../driveRecordings.service.js";
import { getCfgStr } from "../config.service.js";
import { getPublicStatusSnapshot } from "../publicStatus.service.js";
import { getRecentErrorStats } from "./opsRuntime.service.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function envNum(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function envList(name, fallback = []) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function check(key, label, status, message, extra = {}) {
  return { key, label, status, message, detail: null, hint: "", ...extra };
}

function daysUntil(date) {
  if (!date) return null;
  return Math.floor((new Date(date).getTime() - Date.now()) / DAY_MS);
}

function hoursSince(date) {
  if (!date) return null;
  return (Date.now() - new Date(date).getTime()) / HOUR_MS;
}

async function withTimeout(promise, ms, fallbackValue) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ═══════════════════════ 1. Zalo ZNS (OTP qua Zalo) ═══════════════════════ */

async function checkZaloZns() {
  const KEY = "zalo-zns";
  const LABEL = "Zalo ZNS (OTP)";
  const settings = await getSystemSettingsRuntime({ ensureDocument: true });
  const cfg = settings?.zaloZns || {};

  if (!cfg.enabled) {
    return check(KEY, LABEL, "skip", "Đang tắt trong Cài đặt hệ thống");
  }
  if (!String(cfg.accessToken || "").trim()) {
    return check(KEY, LABEL, "error", "Chưa có access_token — OTP qua Zalo sẽ hỏng", {
      hint: "Admin → Cài đặt → Zalo ZNS: dán access_token mới từ Zalo OA.",
    });
  }
  if (!String(cfg.templateId || "").trim()) {
    return check(KEY, LABEL, "error", "Chưa có template_id", {
      hint: "Admin → Cài đặt → Zalo ZNS: điền template_id của mẫu ZNS đã duyệt.",
    });
  }

  const canAutoRefresh = Boolean(
    String(cfg.appId || "").trim() &&
      String(cfg.secretKey || "").trim() &&
      String(cfg.refreshToken || "").trim()
  );
  const refreshedHours = hoursSince(cfg.tokenRefreshedAt);

  // Zalo: access_token sống ~25 giờ, refresh_token hết hạn sau ~3 tháng KHÔNG dùng
  // và bị xoay mỗi lần refresh → refresh_token nằm im quá lâu là sắp chết.
  const staleHours = envNum("OPS_ZALO_TOKEN_STALE_HOURS", 20);
  const refreshWarnDays = envNum("OPS_ZALO_REFRESH_WARN_DAYS", 60);

  const detail = {
    autoRefresh: canAutoRefresh,
    tokenRefreshedAt: cfg.tokenRefreshedAt || null,
  };

  if (!canAutoRefresh) {
    return check(
      KEY,
      LABEL,
      "warn",
      "Chưa bật auto-refresh (thiếu app_id / secret_key / refresh_token) — access_token sẽ hết hạn sau ~25 giờ và phải dán tay",
      {
        detail,
        hint: "Admin → Cài đặt → Zalo ZNS: điền app_id, secret_key, refresh_token để token tự làm mới.",
      }
    );
  }

  if (refreshedHours != null && refreshedHours > refreshWarnDays * 24) {
    return check(
      KEY,
      LABEL,
      "error",
      `refresh_token đã ${Math.round(refreshedHours / 24)} ngày không được dùng — Zalo huỷ refresh_token sau ~3 tháng`,
      {
        detail,
        hint: "Vào Zalo OA lấy access_token + refresh_token mới rồi cập nhật ở Admin → Cài đặt → Zalo ZNS.",
      }
    );
  }

  // Lỗi token thực tế khi gửi OTP trong 24h qua (đáng tin hơn suy đoán theo thời gian).
  const since = new Date(Date.now() - DAY_MS);
  const [failed, succeeded] = await Promise.all([
    OtpLog.countDocuments({ createdAt: { $gte: since }, status: "failed" }),
    OtpLog.countDocuments({ createdAt: { $gte: since }, status: "success" }),
  ]);
  detail.otp24h = { failed, succeeded };

  if (failed > 0 && succeeded === 0) {
    const last = await OtpLog.findOne({ createdAt: { $gte: since }, status: "failed" })
      .sort({ createdAt: -1 })
      .select("error")
      .lean();
    return check(
      KEY,
      LABEL,
      "error",
      `${failed} lượt gửi OTP lỗi / 0 thành công trong 24h — nhiều khả năng token hỏng`,
      {
        detail: { ...detail, lastError: last?.error || "" },
        hint: "Kiểm tra Admin → Logs OTP; nếu lỗi token thì lấy access_token mới ở Zalo OA.",
      }
    );
  }

  if (refreshedHours != null && refreshedHours > staleHours && failed > succeeded) {
    return check(KEY, LABEL, "warn", `Token đã ${Math.round(refreshedHours)} giờ chưa làm mới và tỷ lệ gửi lỗi đang cao`, {
      detail,
    });
  }

  return check(
    KEY,
    LABEL,
    "ok",
    refreshedHours == null
      ? "Đã cấu hình, auto-refresh bật"
      : `Token làm mới ${Math.round(refreshedHours)} giờ trước, auto-refresh bật`,
    { detail }
  );
}

/* ═══════════════ 2. Google Drive ghi hình (Recording Drive OAuth) ═══════════════ */

async function checkRecordingDrive() {
  const KEY = "drive-recording";
  const LABEL = "Google Drive (ghi hình)";
  const status = await getRecordingDriveStatus();

  if (!status?.enabled) {
    return check(KEY, LABEL, "skip", "Drive output đang tắt");
  }

  const detail = {
    mode: status.mode,
    account: status.accountEmail || "",
    folder: status.folderName || status.folderId || "",
    connectedAt: status.connectedAt || "",
  };

  if (!status.connected) {
    return check(KEY, LABEL, "error", "Chưa kết nối OAuth — video sẽ không đẩy lên Drive được", {
      detail,
      hint: "Admin → Recording Drive → bấm Kết nối Google Drive và đăng nhập lại.",
    });
  }
  if (!status.ready) {
    return check(KEY, LABEL, "error", status.message || "Drive chưa sẵn sàng", {
      detail,
      hint: "Admin → Recording Drive: kết nối lại hoặc chọn lại thư mục đích (Google Picker).",
    });
  }
  return check(KEY, LABEL, "ok", `Sẵn sàng — ${status.accountEmail || "?"} → ${status.folderName || status.folderId}`, {
    detail,
  });
}

/* ═══════════════════════ 3. YouTube Live (OAuth) ═══════════════════════ */

async function checkYoutubeToken() {
  const KEY = "youtube-oauth";
  const LABEL = "YouTube Live (OAuth)";
  const [refreshToken, clientId, clientSecret] = await Promise.all([
    getCfgStr("YOUTUBE_REFRESH_TOKEN", ""),
    getCfgStr("GOOGLE_CLIENT_ID", ""),
    getCfgStr("GOOGLE_CLIENT_SECRET", ""),
  ]);

  if (!String(refreshToken || "").trim()) {
    return check(KEY, LABEL, "skip", "Chưa kết nối YouTube");
  }
  if (!clientId || !clientSecret) {
    return check(KEY, LABEL, "error", "Có refresh_token nhưng thiếu GOOGLE_CLIENT_ID / SECRET", {
      hint: "Admin → System Config: điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET.",
    });
  }

  try {
    const { google } = await import("googleapis");
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const { token } = await oauth2.getAccessToken();
    if (!token) throw new Error("Google không trả access_token");
    return check(KEY, LABEL, "ok", "refresh_token còn dùng được");
  } catch (error) {
    const message = String(error?.message || error);
    return check(KEY, LABEL, "error", `refresh_token hỏng/hết hạn: ${message}`, {
      hint: "Admin → YouTube: bấm đăng nhập Google lại để lấy refresh_token mới.",
    });
  }
}

/* ═══════════════════════ 4. Token Facebook Page ═══════════════════════ */

async function checkFacebookTokens() {
  const KEY = "facebook-pages";
  const LABEL = "Facebook Page (livestream)";
  const pages = await FbToken.find({ disabled: { $ne: true } })
    .select("pageId pageName needsReauth pageTokenExpiresAt pageTokenIsNever lastError lastStatusCode")
    .lean();

  if (!pages.length) {
    return check(KEY, LABEL, "skip", "Chưa kết nối page nào");
  }

  const warnDays = envNum("OPS_FB_TOKEN_WARN_DAYS", 7);
  const broken = pages.filter((p) => p.needsReauth);
  const expiring = pages.filter((p) => {
    if (p.needsReauth || p.pageTokenIsNever) return false;
    const days = daysUntil(p.pageTokenExpiresAt);
    return days != null && days <= warnDays;
  });

  const detail = {
    total: pages.length,
    broken: broken.map((p) => p.pageName || p.pageId),
    expiring: expiring.map((p) => ({
      page: p.pageName || p.pageId,
      days: daysUntil(p.pageTokenExpiresAt),
    })),
  };

  if (broken.length) {
    return check(
      KEY,
      LABEL,
      "error",
      `${broken.length}/${pages.length} page cần đăng nhập lại: ${detail.broken.slice(0, 5).join(", ")}`,
      { detail, hint: "Admin → Facebook Token: bấm kết nối lại các page bị lỗi." }
    );
  }
  if (expiring.length) {
    return check(
      KEY,
      LABEL,
      "warn",
      `${expiring.length} page hết hạn token trong ${warnDays} ngày tới`,
      { detail, hint: "Admin → Facebook Token: gia hạn trước khi hết hạn." }
    );
  }
  return check(KEY, LABEL, "ok", `${pages.length} page hoạt động bình thường`, { detail });
}

/* ═══════════════════════ 5. Chứng chỉ SSL tên miền ═══════════════════════ */

function probeCertificate(host, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const socket = tls.connect(
        { host, port: 443, servername: host, timeout: timeoutMs },
        () => {
          const cert = socket.getPeerCertificate();
          done({ host, validTo: cert?.valid_to || null, issuer: cert?.issuer?.O || "" });
          socket.destroy();
        }
      );
      socket.on("timeout", () => {
        done({ host, error: "timeout" });
        socket.destroy();
      });
      socket.on("error", (error) => {
        done({ host, error: error?.message || "lỗi kết nối" });
        socket.destroy();
      });
    } catch (error) {
      done({ host, error: error?.message || "lỗi kết nối" });
    }
  });
}

async function checkSslCertificates() {
  const KEY = "ssl-cert";
  const LABEL = "Chứng chỉ SSL";
  const hosts = envList("OPS_SSL_HOSTS", ["pickletour.vn", "admin.pickletour.vn"]);
  if (!hosts.length) return check(KEY, LABEL, "skip", "Không cấu hình host để kiểm tra");

  const results = await Promise.all(hosts.map((host) => probeCertificate(host)));
  const warnDays = envNum("OPS_SSL_WARN_DAYS", 21);
  const errorDays = envNum("OPS_SSL_ERROR_DAYS", 7);

  const rows = results.map((r) => ({
    host: r.host,
    error: r.error || "",
    days: r.validTo ? daysUntil(r.validTo) : null,
    validTo: r.validTo || null,
  }));

  const failed = rows.filter((r) => r.error);
  const critical = rows.filter((r) => r.days != null && r.days <= errorDays);
  const warning = rows.filter((r) => r.days != null && r.days > errorDays && r.days <= warnDays);

  if (critical.length) {
    return check(
      KEY,
      LABEL,
      "error",
      critical.map((r) => `${r.host} còn ${r.days} ngày`).join(", "),
      { detail: rows, hint: "Gia hạn certbot / kiểm tra chứng chỉ trên Cloudflare." }
    );
  }
  if (failed.length && failed.length === rows.length) {
    return check(KEY, LABEL, "warn", `Không đọc được chứng chỉ: ${failed.map((r) => r.host).join(", ")}`, {
      detail: rows,
    });
  }
  if (warning.length) {
    return check(KEY, LABEL, "warn", warning.map((r) => `${r.host} còn ${r.days} ngày`).join(", "), {
      detail: rows,
    });
  }
  const ok = rows.filter((r) => r.days != null);
  return check(
    KEY,
    LABEL,
    "ok",
    ok.map((r) => `${r.host}: ${r.days} ngày`).join(" · ") || "Không có dữ liệu",
    { detail: rows }
  );
}

/* ═══════════════════════ 6. Hạ tầng & dịch vụ nền ═══════════════════════ */

async function checkDatabase() {
  const KEY = "database";
  const LABEL = "MongoDB";
  const state = mongoose.connection?.readyState;
  if (state !== 1) {
    return check(KEY, LABEL, "critical", `Mongoose readyState = ${state} (1 = connected)`, {
      hint: "Kiểm tra mongod trên VPS và MONGO_URI.",
    });
  }
  const started = Date.now();
  await mongoose.connection.db.admin().ping();
  const latency = Date.now() - started;
  if (latency > 1500) {
    return check(KEY, LABEL, "warn", `Ping ${latency}ms — DB đang chậm`, { detail: { latency } });
  }
  return check(KEY, LABEL, "ok", `Ping ${latency}ms`, { detail: { latency } });
}

async function checkPlatformServices() {
  const KEY = "platform-services";
  const LABEL = "Dịch vụ nền (worker/relay)";
  const snapshot = await withTimeout(getPublicStatusSnapshot(), 15000, null);
  if (!snapshot) {
    return check(KEY, LABEL, "warn", "Không lấy được trạng thái dịch vụ (timeout)");
  }
  const down = (snapshot.services || []).filter(
    (service) => service.status && service.status !== "operational"
  );
  const detail = down.map((service) => ({
    key: service.key,
    status: service.status,
    detail: service.detail || "",
  }));
  if (!down.length) {
    return check(KEY, LABEL, "ok", `${(snapshot.services || []).length} dịch vụ hoạt động bình thường`);
  }
  const hasOutage = down.some((service) => service.status === "outage" || service.status === "down");
  return check(
    KEY,
    LABEL,
    hasOutage ? "error" : "warn",
    down.map((service) => `${service.key}: ${service.status}`).join(", "),
    { detail, hint: "SSH vào VPS kiểm tra pm2 status / systemctl các worker." }
  );
}

async function checkAgendaJobs() {
  const KEY = "agenda-jobs";
  const LABEL = "Job nền (Agenda)";
  const collectionName = process.env.AGENDA_COLLECTION || "jobs";
  const db = mongoose.connection?.db;
  if (!db) return check(KEY, LABEL, "skip", "Chưa kết nối DB");

  const since = new Date(Date.now() - 6 * HOUR_MS);
  const failed = await db
    .collection(collectionName)
    .find({ failedAt: { $gte: since } })
    .project({ name: 1, failReason: 1, failedAt: 1 })
    .limit(20)
    .toArray();

  if (!failed.length) return check(KEY, LABEL, "ok", "Không có job lỗi trong 6 giờ qua");

  const byName = new Map();
  for (const job of failed) {
    byName.set(job.name, (byName.get(job.name) || 0) + 1);
  }
  return check(
    KEY,
    LABEL,
    "warn",
    `${failed.length} job lỗi trong 6 giờ: ${[...byName.entries()].map(([n, c]) => `${n} (${c})`).join(", ")}`,
    {
      detail: failed.slice(0, 5).map((job) => ({
        name: job.name,
        reason: String(job.failReason || "").slice(0, 200),
      })),
    }
  );
}

async function checkErrorRate() {
  const KEY = "error-rate";
  const LABEL = "Lỗi API (5xx)";
  const stats = getRecentErrorStats();
  const threshold = envNum("OPS_ALERT_5XX_WINDOW_WARN", 20);
  if (!stats.total) {
    return check(KEY, LABEL, "ok", `Không có lỗi 5xx trong ${stats.windowMinutes} phút qua`);
  }
  const message = `${stats.total} lỗi 5xx / ${stats.windowMinutes} phút — ${stats.top
    .map((t) => `${t.route} (${t.count})`)
    .join(", ")}`;
  if (stats.total >= threshold) {
    return check(KEY, LABEL, "error", message, { detail: stats });
  }
  return check(KEY, LABEL, "ok", message, { detail: stats });
}

/* ═══════════════════════ 7. Tồn đọng cần người xử lý ═══════════════════════ */

async function countPending(Model, filter, ageField = "createdAt") {
  const [total, oldest] = await Promise.all([
    Model.countDocuments(filter),
    Model.findOne(filter).sort({ [ageField]: 1 }).select(ageField).lean(),
  ]);
  return {
    total,
    oldestAt: oldest ? oldest[ageField] : null,
    oldestHours: oldest ? hoursSince(oldest[ageField]) : null,
  };
}

function queueStatus(stat, thresholdHours) {
  if (!stat.total) return "ok";
  if (stat.oldestHours != null && stat.oldestHours >= thresholdHours) return "warn";
  return "ok";
}

async function checkPendingSupport() {
  const KEY = "pending-support";
  const LABEL = "Phiếu hỗ trợ";
  const thresholdHours = envNum("OPS_PENDING_SUPPORT_HOURS", 4);
  const stat = await countPending(SupportTicket, { status: "open" }, "lastMessageAt");
  const status = queueStatus(stat, thresholdHours);
  if (!stat.total) return check(KEY, LABEL, "ok", "Không có phiếu đang mở");
  return check(
    KEY,
    LABEL,
    status,
    `${stat.total} phiếu đang mở${
      stat.oldestHours != null ? `, phiếu cũ nhất ${Math.round(stat.oldestHours)} giờ` : ""
    }`,
    { detail: stat, hint: status === "ok" ? "" : "Admin → Hỗ trợ: trả lời các phiếu đang chờ." }
  );
}

async function checkPendingApprovals() {
  const KEY = "pending-approvals";
  const LABEL = "Đơn chờ duyệt";
  const thresholdHours = envNum("OPS_PENDING_APPROVAL_HOURS", 12);

  const [coach, courtOwner, nickname, kyc] = await Promise.all([
    countPending(CoachApplication, { status: "pending" }),
    countPending(CourtOwnerRequest, { status: "pending" }),
    countPending(NicknameChangeRequest, { status: "pending" }),
    countPending(User, { cccdStatus: "pending" }, "updatedAt"),
  ]);

  const groups = [
    { label: "HLV", stat: coach },
    { label: "Chủ sân", stat: courtOwner },
    { label: "Đổi biệt danh", stat: nickname },
    { label: "KYC CCCD", stat: kyc },
  ].filter((g) => g.stat.total > 0);

  if (!groups.length) return check(KEY, LABEL, "ok", "Không có đơn nào chờ duyệt");

  const overdue = groups.filter(
    (g) => g.stat.oldestHours != null && g.stat.oldestHours >= thresholdHours
  );
  const message = groups
    .map(
      (g) =>
        `${g.label}: ${g.stat.total}${
          g.stat.oldestHours != null ? ` (cũ nhất ${Math.round(g.stat.oldestHours)}h)` : ""
        }`
    )
    .join(" · ");

  return check(KEY, LABEL, overdue.length ? "warn" : "ok", message, {
    detail: groups,
    hint: overdue.length ? "Admin: duyệt các đơn đang quá hạn chờ." : "",
  });
}

async function checkPendingModeration() {
  const KEY = "pending-moderation";
  const LABEL = "Báo cáo & khiếu nại";
  const thresholdHours = envNum("OPS_PENDING_MODERATION_HOURS", 6);

  const [reports, complaints] = await Promise.all([
    countPending(FeedReport, { status: "pending" }),
    countPending(Complaint, { status: { $in: ["open", "in_progress"] } }),
  ]);

  const groups = [
    { label: "Báo cáo nội dung", stat: reports },
    { label: "Khiếu nại", stat: complaints },
  ].filter((g) => g.stat.total > 0);

  if (!groups.length) return check(KEY, LABEL, "ok", "Không có báo cáo/khiếu nại chờ xử lý");

  const overdue = groups.filter(
    (g) => g.stat.oldestHours != null && g.stat.oldestHours >= thresholdHours
  );
  const message = groups
    .map(
      (g) =>
        `${g.label}: ${g.stat.total}${
          g.stat.oldestHours != null ? ` (cũ nhất ${Math.round(g.stat.oldestHours)}h)` : ""
        }`
    )
    .join(" · ");

  return check(KEY, LABEL, overdue.length ? "warn" : "ok", message, { detail: groups });
}

/* ═══════════════════════ Chạy toàn bộ ═══════════════════════ */

const CHECKS = [
  { key: "zalo-zns", run: checkZaloZns },
  { key: "drive-recording", run: checkRecordingDrive },
  { key: "youtube-oauth", run: checkYoutubeToken },
  { key: "facebook-pages", run: checkFacebookTokens },
  { key: "ssl-cert", run: checkSslCertificates },
  { key: "database", run: checkDatabase },
  { key: "platform-services", run: checkPlatformServices },
  { key: "agenda-jobs", run: checkAgendaJobs },
  { key: "error-rate", run: checkErrorRate },
  { key: "pending-support", run: checkPendingSupport },
  { key: "pending-approvals", run: checkPendingApprovals },
  { key: "pending-moderation", run: checkPendingModeration },
];

const DISABLED = new Set(envList("OPS_MONITOR_DISABLED_CHECKS", []));

/** Chạy tất cả check, trả về mảng kết quả đã chuẩn hoá. */
export async function runOpsHealthChecks() {
  const startedAt = Date.now();
  const results = await Promise.all(
    CHECKS.map(async ({ key, run }) => {
      if (DISABLED.has(key)) {
        return check(key, key, "skip", "Đã tắt qua OPS_MONITOR_DISABLED_CHECKS");
      }
      try {
        return await withTimeout(
          run(),
          envNum("OPS_CHECK_TIMEOUT_MS", 20000),
          check(key, key, "warn", "Check quá thời gian cho phép")
        );
      } catch (error) {
        return check(key, key, "warn", `Check lỗi: ${error?.message || error}`, {
          detail: { stack: String(error?.stack || "").split("\n").slice(0, 3).join("\n") },
        });
      }
    })
  );

  const counts = results.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { ok: 0, warn: 0, error: 0, critical: 0, skip: 0 }
  );

  return {
    checkedAt: new Date(),
    durationMs: Date.now() - startedAt,
    counts,
    results,
  };
}

export const OPS_CHECK_KEYS = CHECKS.map((c) => c.key);
