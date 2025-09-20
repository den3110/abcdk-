// controllers/telegramWebhook.js  (ESM)
import mongoose from "mongoose";
import Complaint from "../models/complaintModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import {
  tgAnswerCallbackQuery,
  tgEditMessageReplyMarkup,
} from "../utils/telegram.js";
import { notifyComplaintStatusChange } from "../services/telegram/notifyNewComplaint.js";

export async function telegramWebhook(req, res, next) {
  try {
    const cq = req.body?.callback_query;
    if (!cq) return res.status(200).json({ ok: true }); // ignore non-callback

    // Cho user cảm giác nút đã nhận
    await tgAnswerCallbackQuery({
      callback_query_id: cq.id,
      text: "Đang cập nhật…",
    });

    const data = String(cq.data || "");
    const m = data.match(/^complaint:(resolve|reject):([a-fA-F0-9]{24})$/);
    if (!m) {
      await tgAnswerCallbackQuery({
        callback_query_id: cq.id,
        text: "Không hiểu yêu cầu",
        show_alert: true,
      });
      return res.status(200).json({ ok: true });
    }
    const action = m[1]; // resolve | reject
    const id = m[2];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await tgAnswerCallbackQuery({
        callback_query_id: cq.id,
        text: "ID không hợp lệ",
        show_alert: true,
      });
      return res.status(200).json({ ok: true });
    }

    const complaint = await Complaint.findById(id);
    if (!complaint) {
      await tgAnswerCallbackQuery({
        callback_query_id: cq.id,
        text: "Không tìm thấy khiếu nại",
        show_alert: true,
      });
      return res.status(200).json({ ok: true });
    }

    // Cập nhật trạng thái
    complaint.status = action === "resolve" ? "resolved" : "rejected";
    await complaint.save();

    const [tour, reg] = await Promise.all([
      Tournament.findById(complaint.tournament).lean(),
      Registration.findById(complaint.registration).lean(),
    ]);

    const chatId = cq.message?.chat?.id;
    const topicId = cq.message?.message_thread_id; // nếu group dùng forum topic
    const msgId = cq.message?.message_id;

    // Gửi 1 TIN NHẮN MỚI thông báo kết quả vào ĐÚNG chat/topic của message gốc:
    await notifyComplaintStatusChange({
      complaint: complaint.toObject(),
      tournament: tour,
      registration: reg,
      newStatus: complaint.status,
      actor: cq.from,
      chatId,
      topicId,
    });

    // Gỡ inline keyboard của message gốc để tránh bấm lại
    if (chatId && msgId) {
      await tgEditMessageReplyMarkup({
        chat_id: chatId,
        message_id: msgId,
        reply_markup: { inline_keyboard: [] },
      });
    }

    await tgAnswerCallbackQuery({
      callback_query_id: cq.id,
      text: "Đã cập nhật",
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}
