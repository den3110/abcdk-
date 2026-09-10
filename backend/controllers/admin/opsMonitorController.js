// controllers/admin/opsMonitorController.js
// API admin cho hệ thống giám sát vận hành:
//   GET    /api/admin/ops/status        — snapshot trạng thái các check (không bắn Telegram)
//   POST   /api/admin/ops/run           — chạy 1 vòng quét ngay (tuỳ chọn bắn cảnh báo)
//   POST   /api/admin/ops/digest        — gửi báo cáo tổng hợp lên Telegram ngay
//   POST   /api/admin/ops/test          — gửi 1 tin test để kiểm tra token/chat id
//   GET    /api/admin/ops/alerts        — danh sách state cảnh báo đang lưu
//   POST   /api/admin/ops/alerts/:key/mute — tạm tắt 1 cảnh báo trong N phút
import expressAsyncHandler from "express-async-handler";
import OpsAlertState from "../../models/opsAlertStateModel.js";
import {
  runOpsMonitorCycle,
  sendOpsDigest,
  getLastOpsSnapshot,
} from "../../services/ops/opsMonitor.service.js";
import { runOpsHealthChecks } from "../../services/ops/opsHealthChecks.service.js";
import {
  isOpsAlertEnabled,
  notifyOpsEvent,
} from "../../services/ops/opsAlert.service.js";
import {
  getOpsTelegramConfig,
  isOpsTelegramConfigured,
  opsTgProbe,
} from "../../services/ops/opsTelegram.service.js";

export const getOpsStatus = expressAsyncHandler(async (req, res) => {
  const refresh = String(req.query.refresh || "") === "1";
  const snapshot = refresh || !getLastOpsSnapshot()
    ? await runOpsHealthChecks()
    : getLastOpsSnapshot();

  const cfg = await getOpsTelegramConfig();
  res.json({
    enabled: await isOpsAlertEnabled(),
    telegramConfigured: await isOpsTelegramConfigured(),
    configSource: cfg.source, // "settings" | "env"
    chatCount: cfg.chatIds.length,
    snapshot,
  });
});

export const runOpsCheck = expressAsyncHandler(async (req, res) => {
  const notify = String(req.body?.notify ?? "true") !== "false";
  const result = await runOpsMonitorCycle({ notify });
  res.json({ ok: true, notify, ...result });
});

export const sendOpsDigestNow = expressAsyncHandler(async (req, res) => {
  const result = await sendOpsDigest();
  res.json({ ok: true, ...result });
});

export const testOpsChannel = expressAsyncHandler(async (req, res) => {
  const probe = await opsTgProbe();
  if (!probe.ok) {
    return res.status(400).json({ ok: false, ...probe });
  }
  const result = await notifyOpsEvent({
    severity: "info",
    title: "Tin test từ hệ thống giám sát",
    lines: [
      { label: "Người gửi", value: req.user?.email || req.user?.name || "admin" },
      "Nếu bạn thấy tin này, kênh cảnh báo vận hành đã hoạt động.",
    ],
  });
  res.json({ ok: true, probe, delivered: result?.sent === true });
});

export const listOpsAlerts = expressAsyncHandler(async (req, res) => {
  const status = String(req.query.status || "");
  const filter = {};
  if (status === "firing" || status === "ok") filter.status = status;
  const items = await OpsAlertState.find(filter)
    .sort({ status: 1, severity: -1, lastSeenAt: -1 })
    .limit(200)
    .lean();
  res.json({ items, total: items.length });
});

export const muteOpsAlert = expressAsyncHandler(async (req, res) => {
  const key = String(req.params.key || "").trim();
  const minutes = Math.max(1, Math.min(30 * 24 * 60, Number(req.body?.minutes) || 60));
  if (!key) {
    res.status(400);
    throw new Error("Thiếu key cảnh báo");
  }
  const mutedUntil = new Date(Date.now() + minutes * 60 * 1000);
  const updated = await OpsAlertState.findOneAndUpdate(
    { key },
    { $set: { mutedUntil } },
    { new: true }
  ).lean();
  if (!updated) {
    res.status(404);
    throw new Error("Không tìm thấy cảnh báo");
  }
  res.json({ ok: true, key, mutedUntil });
});
