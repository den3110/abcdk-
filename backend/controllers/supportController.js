import mongoose from "mongoose";
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
const CATEGORY_VALUES = new Set([
  "account",
  "tournament",
  "payment",
  "technical",
  "report",
  "other",
]);
const PRIORITY_VALUES = new Set(["low", "normal", "high", "urgent"]);

const safePreview = (s = "") => String(s || "").trim().slice(0, 140);

const normalizeEnum = (value, allowed, fallback) => {
  const clean = String(value || "").trim().toLowerCase();
  return allowed.has(clean) ? clean : fallback;
};

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
        .slice(0, 10)
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

const publicMessageFilter = {
  $or: [{ visibility: { $exists: false } }, { visibility: "public" }],
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

const buildTicketResponse = async (
  ticketId,
  filter = {},
  { includeInternal = false } = {},
) => {
  const ticket = await SupportTicket.findOne({ _id: ticketId, ...filter })
    .populate("user", "name email nickname phone avatar")
    .populate("assignedTo", "name email nickname avatar")
    .populate("closedBy", "name email nickname avatar")
    .lean();

  if (!ticket) return null;

  const messageFilter = includeInternal
    ? { ticket: ticketId }
    : { ticket: ticketId, ...publicMessageFilter };

  const messages = await SupportMessage.find(messageFilter)
    .populate("senderUser", "name email nickname avatar role")
    .sort({ createdAt: 1 })
    .lean();

  return { ticket, messages };
};

const updateTicketLastMessage = (ticket, text, attachments) => {
  ticket.lastMessageAt = new Date();
  ticket.lastMessagePreview =
    safePreview(text) || (attachments?.length ? "[Ảnh đính kèm]" : "");
};

const notifyAdminsAboutUserMessage = async ({ req, ticket, msg, text }) => {
  try {
    notifySupportToTelegram({
      ticketId: ticket._id,
      title: ticket.title,
      fromUserLabel: buildFromUserLabel(req.user),
      text: msg?.text || text,
      attachmentsCount: Array.isArray(msg?.attachments)
        ? msg.attachments.length
        : 0,
      attachments: msg?.attachments || [],
    });
  } catch (error) {
    console.warn("[support] notify telegram failed:", error?.message);
  }

  const adminAudience = await getAdminAudience();
  if (!adminAudience.length) return;

  publishSupportNotification(
    EVENTS.SUPPORT_NEW_TICKET,
    {
      ticketId: String(ticket._id),
      title: ticket.title,
      preview: safePreview(text),
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
};

export const createTicket = async (req, res) => {
  try {
    const {
      title,
      text,
      attachments,
      category,
      priority,
      contactEmail,
      contactPhone,
      source = "web",
    } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanAttachments = cleanAttachmentsOf(attachments);

    if (!cleanText && cleanAttachments.length === 0) {
      return res.status(400).json({
        message: "Vui lòng nhập nội dung hoặc đính kèm ảnh.",
      });
    }

    const now = new Date();
    const ticket = await SupportTicket.create({
      user: req.user._id,
      title: String(title || "Hỗ trợ").trim().slice(0, 160) || "Hỗ trợ",
      status: "open",
      category: normalizeEnum(category, CATEGORY_VALUES, "other"),
      priority: normalizeEnum(priority, PRIORITY_VALUES, "normal"),
      lastMessageAt: now,
      lastMessagePreview:
        safePreview(cleanText) ||
        (cleanAttachments.length ? "[Ảnh đính kèm]" : ""),
      userLastReadAt: now,
      staffLastReadAt: null,
      meta: {
        source: String(source || "web").trim().slice(0, 40),
        contactEmail: String(contactEmail || "").trim().slice(0, 160),
        contactPhone: String(contactPhone || "").trim().slice(0, 40),
      },
    });

    const msg = await SupportMessage.create({
      ticket: ticket._id,
      senderRole: "user",
      senderUser: req.user._id,
      visibility: "public",
      kind: "message",
      text: cleanText,
      attachments: cleanAttachments,
    });

    await notifyAdminsAboutUserMessage({ req, ticket, msg, text: cleanText });

    res.status(201).json(ticket);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể tạo yêu cầu hỗ trợ.",
    });
  }
};

export const listMyTickets = async (req, res) => {
  try {
    const { status = "", category = "", priority = "", keyword = "" } =
      req.query || {};
    const filter = { user: req.user._id };

    if (STATUS_VALUES.has(String(status))) filter.status = String(status);
    if (CATEGORY_VALUES.has(String(category))) filter.category = String(category);
    if (PRIORITY_VALUES.has(String(priority))) filter.priority = String(priority);

    const q = String(keyword || "").trim();
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ title: regex }, { lastMessagePreview: regex }];
    }

    const items = await SupportTicket.find(filter)
      .populate("assignedTo", "name email nickname avatar")
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

    const wasClosed = ticket.status === "closed";
    const msg = await SupportMessage.create({
      ticket: id,
      senderRole: "user",
      senderUser: req.user._id,
      visibility: "public",
      kind: "message",
      text: cleanText,
      attachments: cleanAttachments,
      meta: wasClosed ? { reopenedTicket: true } : {},
    });

    ticket.status = "open";
    updateTicketLastMessage(ticket, cleanText, cleanAttachments);
    ticket.userLastReadAt = new Date();
    ticket.staffLastReadAt = null;
    if (wasClosed) {
      ticket.closedAt = null;
      ticket.closedBy = null;
      ticket.closeReason = "";
      ticket.meta = {
        ...(ticket.meta || {}),
        reopenedAt: new Date(),
        reopenedBy: req.user._id,
      };
    }
    await ticket.save();

    await notifyAdminsAboutUserMessage({ req, ticket, msg, text: cleanText });

    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể gửi phản hồi.",
    });
  }
};

export const rateMyTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const score = Number(req.body?.score);
    const comment = String(req.body?.comment || "").trim().slice(0, 800);

    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ message: "Điểm đánh giá không hợp lệ." });
    }

    const ticket = await SupportTicket.findOne({ _id: id, user: req.user._id });
    if (!ticket) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy yêu cầu hỗ trợ." });
    }
    if (ticket.status !== "closed") {
      return res
        .status(400)
        .json({ message: "Chỉ đánh giá sau khi case đã đóng." });
    }

    ticket.ratingScore = score;
    ticket.ratingComment = comment;
    ticket.ratedAt = new Date();
    await ticket.save();

    res.json(ticket);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể lưu đánh giá.",
    });
  }
};

const buildAdminFilter = (query = {}) => {
  const {
    status = "",
    category = "",
    priority = "",
    assigned = "",
    keyword = "",
    unread = "",
  } = query;
  const filter = {};

  if (STATUS_VALUES.has(String(status))) filter.status = String(status);
  if (CATEGORY_VALUES.has(String(category))) filter.category = String(category);
  if (PRIORITY_VALUES.has(String(priority))) filter.priority = String(priority);

  if (String(assigned) === "unassigned") {
    filter.assignedTo = null;
  } else if (mongoose.isValidObjectId(assigned)) {
    filter.assignedTo = assigned;
  }

  if (String(unread) === "1" || String(unread) === "true") {
    filter.$expr = {
      $gt: ["$lastMessageAt", { $ifNull: ["$staffLastReadAt", new Date(0)] }],
    };
  }

  const q = String(keyword || "").trim();
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { title: regex },
      { lastMessagePreview: regex },
      { closeReason: regex },
      { "meta.source": regex },
      { "meta.contactEmail": regex },
      { "meta.contactPhone": regex },
    ];
  }

  return filter;
};

export const adminListTickets = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query || {};
    const filter = buildAdminFilter(req.query);
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const [items, total, open, pending, closed, unread] = await Promise.all([
      SupportTicket.find(filter)
        .populate("user", "name email nickname phone avatar")
        .populate("assignedTo", "name email nickname avatar")
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      SupportTicket.countDocuments(filter),
      SupportTicket.countDocuments({ ...filter, status: "open" }),
      SupportTicket.countDocuments({ ...filter, status: "pending" }),
      SupportTicket.countDocuments({ ...filter, status: "closed" }),
      SupportTicket.countDocuments({
        ...filter,
        $expr: {
          $gt: [
            "$lastMessageAt",
            { $ifNull: ["$staffLastReadAt", new Date(0)] },
          ],
        },
      }),
    ]);

    res.json({
      items,
      total,
      page: safePage,
      pageSize: safeLimit,
      stats: { open, pending, closed, unread },
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

    const detail = await buildTicketResponse(id, {}, { includeInternal: true });
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
      visibility: "public",
      kind: "message",
      text: cleanText,
      attachments: cleanAttachments,
    });

    ticket.status = "pending";
    if (!ticket.assignedTo && req.user?._id) ticket.assignedTo = req.user._id;
    updateTicketLastMessage(ticket, cleanText, cleanAttachments);
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
    const body = req.body || {};

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Không tìm thấy ticket." });
    }

    const previousStatus = ticket.status;
    const nextStatus = String(body.status || "").trim();
    if (nextStatus) {
      if (!STATUS_VALUES.has(nextStatus)) {
        return res
          .status(400)
          .json({ message: "Trạng thái không hợp lệ." });
      }
      ticket.status = nextStatus;
      if (nextStatus === "closed") {
        ticket.closedAt = new Date();
        ticket.closedBy = req.user?._id || null;
        ticket.closeReason = String(body.closeReason || ticket.closeReason || "")
          .trim()
          .slice(0, 800);
      } else if (previousStatus === "closed") {
        ticket.closedAt = null;
        ticket.closedBy = null;
        ticket.closeReason = "";
      }
    }

    if (body.category !== undefined) {
      ticket.category = normalizeEnum(body.category, CATEGORY_VALUES, ticket.category);
    }
    if (body.priority !== undefined) {
      ticket.priority = normalizeEnum(body.priority, PRIORITY_VALUES, ticket.priority);
    }

    if (body.assignToMe === true || body.assignedTo === "me") {
      ticket.assignedTo = req.user?._id || null;
    } else if (body.assignedTo === null || body.assignedTo === "") {
      ticket.assignedTo = null;
    } else if (mongoose.isValidObjectId(body.assignedTo)) {
      ticket.assignedTo = body.assignedTo;
    }

    const internalNote = String(body.internalNote || "").trim();
    if (internalNote) {
      await SupportMessage.create({
        ticket: id,
        senderRole: "staff",
        senderUser: req.user?._id || null,
        visibility: "internal",
        kind: "internal_note",
        text: internalNote.slice(0, 2000),
      });
      ticket.meta = {
        ...(ticket.meta || {}),
        lastInternalNoteAt: new Date(),
      };
    }

    ticket.staffLastReadAt = new Date();
    await ticket.save();

    if (ticket.status === "closed" && previousStatus !== "closed") {
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

    const detail = await buildTicketResponse(id, {}, { includeInternal: true });
    res.json(detail?.ticket || ticket);
  } catch (error) {
    res.status(500).json({
      message: error?.message || "Không thể cập nhật trạng thái ticket.",
    });
  }
};
