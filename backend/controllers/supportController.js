import SupportTicket from "../models/supportTicketModel.js";
import SupportMessage from "../models/supportMessageModel.js";
import User from "../models/userModel.js";
import { notifySupportToTelegram } from "../bot/supportBridge.js";
import {
  CATEGORY,
  EVENTS,
  publishNotification,
} from "../services/notifications/notificationHub.js";

const STATUS_VALUES = new Set(["open", "pending", "closed"]);

const safePreview = (s = "") => String(s || "").trim().slice(0, 140);

const cleanAttachmentsOf = (attachments) =>
  Array.isArray(attachments)
    ? attachments
        .map((item) => ({
          url: String(item?.url || "").trim(),
          mime: String(item?.mime || "image/jpeg").trim() || "image/jpeg",
          name: String(item?.name || "").trim(),
          size: Number(item?.size || 0) || 0,
        }))
        .filter((item) => item.url)
    : [];

const buildFromUserLabel = (u) => {
  try {
    const name = u?.name || "User";
    const nick = u?.nickname ? ` (@${u.nickname})` : "";
    return `${name}${nick}`;
  } catch {
    return "User";
  }
};

const getAdminAudience = async () => {
  const users = await User.find({
    isDeleted: { $ne: true },
    $or: [{ role: "admin" }, { isSuperUser: true }],
  })
    .select("_id")
    .lean();
  return users.map((user) => String(user._id));
};

const publishSupportNotification = (eventName, ctx, opts = {}) => {
  publishNotification(eventName, ctx, opts).catch((error) => {
    console.warn(
      `[support] publish ${eventName} failed:`,
      error?.message || error,
    );
  });
};

const buildTicketResponse = async (ticketId, filter = {}) => {
  const ticket = await SupportTicket.findOne({ _id: ticketId, ...filter })
    .populate("user", "name email nickname phone avatar")
    .lean();

  if (!ticket) return null;

  const messages = await SupportMessage.find({ ticket: ticketId })
    .populate("senderUser", "name email nickname avatar role")
    .sort({ createdAt: 1 })
    .lean();

  return { ticket, messages };
};

export const createTicket = async (req, res) => {
  try {
    const { title, text, attachments } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanAttachments = cleanAttachmentsOf(attachments);

    if (!cleanText && cleanAttachments.length === 0) {
      return res.status(400).json({
        message: "Vui lòng nhập nội dung hoặc đính kèm ảnh.",
      });
    }

    const ticket = await SupportTicket.create({
      user: req.user._id,
      title: String(title || "Hỗ trợ").trim() || "Hỗ trợ",
      status: "open",
      lastMessageAt: new Date(),
      lastMessagePreview:
        safePreview(cleanText) ||
        (cleanAttachments.length ? "[Ảnh đính kèm]" : ""),
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

    try {
      notifySupportToTelegram({
        ticketId: ticket._id,
        title: ticket.title,
        fromUserLabel: buildFromUserLabel(req.user),
        text: msg?.text || cleanText,
        attachmentsCount: Array.isArray(msg?.attachments)
          ? msg.attachments.length
          : cleanAttachments.length,
        attachments: msg?.attachments || cleanAttachments,
      });
    } catch (error) {
      console.warn(
        "[support:createTicket] notify telegram failed:",
        error?.message,
      );
    }

    const adminAudience = await getAdminAudience();
    if (adminAudience.length) {
      publishSupportNotification(
        EVENTS.SUPPORT_NEW_TICKET,
        {
          ticketId: String(ticket._id),
          title: ticket.title,
          preview: safePreview(cleanText),
          overrideAudience: adminAudience,
          topicType: "support",
          topicId: String(ticket._id),
          category: CATEGORY.SUPPORT,
          messageId: String(msg._id),
        },
        {
          dispatchMeta: {
            sourceKind: "support_ticket",
            triggeredBy: req.user?._id || null,
            scope: "support_admins",
          },
        },
      );
    }

    res.status(201).json(ticket);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể tạo yêu cầu hỗ trợ.",
    });
  }
};

export const listMyTickets = async (req, res) => {
  try {
    const items = await SupportTicket.find({ user: req.user._id })
      .sort({ lastMessageAt: -1 })
      .lean();
    res.json(items);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể tải danh sách hỗ trợ.",
    });
  }
};

export const getMyTicketDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await SupportTicket.findOne({
      _id: id,
      user: req.user._id,
    });
    if (!ticket) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy yêu cầu hỗ trợ." });
    }

    ticket.userLastReadAt = new Date();
    await ticket.save();

    const detail = await buildTicketResponse(id, { user: req.user._id });
    res.json(detail);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể tải yêu cầu hỗ trợ.",
    });
  }
};

export const addMyMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, attachments } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanAttachments = cleanAttachmentsOf(attachments);

    if (!cleanText && cleanAttachments.length === 0) {
      return res.status(400).json({
        message: "Vui lòng nhập nội dung hoặc đính kèm ảnh.",
      });
    }

    const ticket = await SupportTicket.findOne({ _id: id, user: req.user._id });
    if (!ticket) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy yêu cầu hỗ trợ." });
    }

    const msg = await SupportMessage.create({
      ticket: id,
      senderRole: "user",
      senderUser: req.user._id,
      text: cleanText,
      attachments: cleanAttachments,
    });

    ticket.status = "open";
    ticket.lastMessageAt = new Date();
    ticket.lastMessagePreview =
      safePreview(cleanText) ||
      (cleanAttachments.length ? "[Ảnh đính kèm]" : "");
    ticket.userLastReadAt = new Date();
    ticket.staffLastReadAt = null;
    await ticket.save();

    try {
      notifySupportToTelegram({
        ticketId: ticket._id,
        title: ticket.title,
        fromUserLabel: buildFromUserLabel(req.user),
        text: msg?.text || cleanText,
        attachmentsCount: Array.isArray(msg?.attachments)
          ? msg.attachments.length
          : cleanAttachments.length,
        attachments: msg?.attachments || cleanAttachments,
      });
    } catch (error) {
      console.warn(
        "[support:addMyMessage] notify telegram failed:",
        error?.message,
      );
    }

    const adminAudience = await getAdminAudience();
    if (adminAudience.length) {
      publishSupportNotification(
        EVENTS.SUPPORT_NEW_TICKET,
        {
          ticketId: String(ticket._id),
          title: ticket.title,
          preview: safePreview(cleanText),
          overrideAudience: adminAudience,
          topicType: "support",
          topicId: String(ticket._id),
          category: CATEGORY.SUPPORT,
          messageId: String(msg._id),
        },
        {
          dispatchMeta: {
            sourceKind: "support_ticket",
            triggeredBy: req.user?._id || null,
            scope: "support_admins",
          },
        },
      );
    }

    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể gửi phản hồi.",
    });
  }
};

export const adminListTickets = async (req, res) => {
  try {
    const { status = "", keyword = "", page = 1, limit = 50 } = req.query || {};
    const filter = {};

    if (STATUS_VALUES.has(String(status))) {
      filter.status = String(status);
    }

    if (String(keyword || "").trim()) {
      const regex = new RegExp(String(keyword).trim(), "i");
      filter.$or = [
        { title: regex },
        { lastMessagePreview: regex },
        { "meta.source": regex },
      ];
    }

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate("user", "name email nickname phone avatar")
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page: safePage,
      pageSize: safeLimit,
    });
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể tải danh sách ticket.",
    });
  }
};

export const adminGetTicketDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Không tìm thấy ticket." });
    }

    ticket.staffLastReadAt = new Date();
    await ticket.save();

    const detail = await buildTicketResponse(id);
    res.json(detail);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể tải ticket.",
    });
  }
};

export const adminReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, attachments } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanAttachments = cleanAttachmentsOf(attachments);

    if (!cleanText && cleanAttachments.length === 0) {
      return res.status(400).json({
        message: "Vui lòng nhập nội dung hoặc đính kèm ảnh.",
      });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Không tìm thấy ticket." });
    }

    const msg = await SupportMessage.create({
      ticket: id,
      senderRole: "staff",
      senderUser: req.user?._id || null,
      text: cleanText,
      attachments: cleanAttachments,
    });

    ticket.status = "pending";
    ticket.lastMessageAt = new Date();
    ticket.lastMessagePreview =
      safePreview(cleanText) ||
      (cleanAttachments.length ? "[Ảnh đính kèm]" : "");
    ticket.staffLastReadAt = new Date();
    await ticket.save();

    publishSupportNotification(
      EVENTS.SUPPORT_STAFF_REPLIED,
      {
        ticketId: String(ticket._id),
        title: ticket.title,
        preview: safePreview(cleanText),
        messageId: String(msg._id),
        topicType: "user",
        topicId: String(ticket.user),
        userId: String(ticket.user),
        category: CATEGORY.SUPPORT,
      },
      {
        dispatchMeta: {
          sourceKind: "support_reply",
          triggeredBy: req.user?._id || null,
          userId: String(ticket.user),
        },
      },
    );

    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể gửi phản hồi admin.",
    });
  }
};

export const adminUpdateTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || "").trim();

    if (!STATUS_VALUES.has(status)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ." });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Không tìm thấy ticket." });
    }

    const previousStatus = ticket.status;
    ticket.status = status;
    ticket.staffLastReadAt = new Date();
    await ticket.save();

    if (status === "closed" && previousStatus !== "closed") {
      publishSupportNotification(
        EVENTS.SUPPORT_TICKET_CLOSED,
        {
          ticketId: String(ticket._id),
          title: ticket.title,
          topicType: "user",
          topicId: String(ticket.user),
          userId: String(ticket.user),
          category: CATEGORY.SUPPORT,
        },
        {
          dispatchMeta: {
            sourceKind: "support_status",
            triggeredBy: req.user?._id || null,
            userId: String(ticket.user),
          },
        },
      );
    }

    res.json(ticket);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể cập nhật trạng thái ticket.",
    });
  }
};
