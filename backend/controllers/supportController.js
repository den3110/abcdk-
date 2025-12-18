import SupportTicket from "../models/supportTicketModel.js";
import SupportMessage from "../models/supportMessageModel.js";
import { notifySupportToTelegram } from "../bot/supportBridge.js";
// import { notifySupportToTelegram } from "../bot/kycBot.js";

const safePreview = (s = "") => String(s || "").trim().slice(0, 140);

const buildFromUserLabel = (u) => {
  try {
    const name = u?.name || "User";
    const nick = u?.nickname ? ` (@${u.nickname})` : "";
    return `${name}${nick}`;
  } catch {
    return "User";
  }
};

export const createTicket = async (req, res) => {
  try {
    const { title, text, attachments } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanAttachments = Array.isArray(attachments) ? attachments : [];

    if (!cleanText && cleanAttachments.length === 0) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập nội dung hoặc đính kèm ảnh." });
    }

    const ticket = await SupportTicket.create({
      user: req.user._id,
      title: String(title || "Hỗ trợ").trim() || "Hỗ trợ",
      status: "open",
      lastMessageAt: new Date(),
      lastMessagePreview:
        safePreview(cleanText) || (cleanAttachments.length ? "[Ảnh đính kèm]" : ""),
      userLastReadAt: new Date(),
      staffLastReadAt: null,
    });

    const msg = await SupportMessage.create({
      ticket: ticket._id,
      senderRole: "user",
      senderUser: req.user._id,
      text: cleanText,
      attachments: cleanAttachments,
    });

    // ✅ Notify Telegram (fail không ảnh hưởng API)
    try {
      await notifySupportToTelegram({
        ticketId: ticket._id,
        title: ticket.title,
        fromUserLabel: buildFromUserLabel(req.user),
        text: msg?.text || cleanText,
        attachmentsCount: Array.isArray(msg?.attachments)
          ? msg.attachments.length
          : cleanAttachments.length,
      });
    } catch (e) {
      console.warn("[support:createTicket] notify telegram failed:", e?.message);
    }

    res.status(201).json(ticket);
  } catch (e) {
    res.status(500).json({ message: e?.message || "Create ticket failed" });
  }
};

export const listMyTickets = async (req, res) => {
  try {
    const items = await SupportTicket.find({ user: req.user._id })
      .sort({ lastMessageAt: -1 })
      .lean();
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: e?.message || "List tickets failed" });
  }
};

export const getMyTicketDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await SupportTicket.findOne({ _id: id, user: req.user._id }).lean();
    if (!ticket)
      return res.status(404).json({ message: "Không tìm thấy yêu cầu hỗ trợ." });

    const messages = await SupportMessage.find({ ticket: id })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ ticket, messages });
  } catch (e) {
    res.status(500).json({ message: e?.message || "Get ticket failed" });
  }
};

export const addMyMessage = async (req, res) => {
  try {
    const { id } = req.params; // ticketId
    const { text, attachments } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanAttachments = Array.isArray(attachments) ? attachments : [];

    if (!cleanText && cleanAttachments.length === 0) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập nội dung hoặc đính kèm ảnh." });
    }

    const ticket = await SupportTicket.findOne({ _id: id, user: req.user._id });
    if (!ticket)
      return res.status(404).json({ message: "Không tìm thấy yêu cầu hỗ trợ." });

    const msg = await SupportMessage.create({
      ticket: id,
      senderRole: "user",
      senderUser: req.user._id,
      text: cleanText,
      attachments: cleanAttachments,
    });

    ticket.lastMessageAt = new Date();
    ticket.lastMessagePreview =
      safePreview(cleanText) || (cleanAttachments.length ? "[Ảnh đính kèm]" : "");
    ticket.userLastReadAt = new Date(); // user vừa gửi -> coi như đã đọc
    ticket.staffLastReadAt = null; // staff chưa đọc
    await ticket.save();

    // ✅ Notify Telegram (fail không ảnh hưởng API)
    try {
      notifySupportToTelegram({
        ticketId: ticket._id,
        title: ticket.title,
        fromUserLabel: buildFromUserLabel(req.user),
        text: msg?.text || cleanText,
        attachmentsCount: Array.isArray(msg?.attachments)
          ? msg.attachments.length
          : cleanAttachments.length,
      });
    } catch (e) {
      console.warn("[support:addMyMessage] notify telegram failed:", e?.message);
    }

    res.status(201).json(msg);
  } catch (e) {
    res.status(500).json({ message: e?.message || "Send message failed" });
  }
};

/* ===== ADMIN (staff trả lời) ===== */
export const adminListTickets = async (req, res) => {
  try {
    const items = await SupportTicket.find({})
      .populate("user", "name email nickname")
      .sort({ lastMessageAt: -1 })
      .lean();
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: e?.message || "Admin list tickets failed" });
  }
};

export const adminReply = async (req, res) => {
  try {
    const { id } = req.params; // ticketId
    const { text, attachments } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanAttachments = Array.isArray(attachments) ? attachments : [];

    if (!cleanText && cleanAttachments.length === 0) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập nội dung hoặc đính kèm ảnh." });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) return res.status(404).json({ message: "Không tìm thấy ticket." });

    const msg = await SupportMessage.create({
      ticket: id,
      senderRole: "staff",
      senderUser: req.user?._id || null,
      text: cleanText,
      attachments: cleanAttachments,
    });

    ticket.lastMessageAt = new Date();
    ticket.lastMessagePreview =
      safePreview(cleanText) || (cleanAttachments.length ? "[Ảnh đính kèm]" : "");
    ticket.staffLastReadAt = new Date();
    await ticket.save();

    res.status(201).json(msg);
  } catch (e) {
    res.status(500).json({ message: e?.message || "Admin reply failed" });
  }
};
