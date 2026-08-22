// controllers/chatController.js
// Handlers cho tính năng Nhắn tin.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import ChatConversation from "../models/chatConversationModel.js";
import ChatMessage from "../models/chatMessageModel.js";
import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import User from "../models/userModel.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { getIO } from "../socket/index.js";
import { notifyChatMessage } from "../services/chatNotifier.js";
import { attachTournamentRegCounts } from "../utils/enrichTournament.js";
import { getBlockedIdSet } from "./friendController.js";

const USER_FIELDS = "_id name nickname avatar role phone";

const isAdmin = (u) => u?.role === "admin" || u?.role === "superAdmin";

const isParticipant = (conv, userId) => {
  const uid = String(userId);
  return (conv.participants || []).some((p) => String(p?._id || p) === uid);
};

function toConvDTO(conv, viewerId) {
  const c = typeof conv.toObject === "function" ? conv.toObject() : { ...conv };
  const unreadMap = c.unread || {};
  const myUnread =
    unreadMap instanceof Map
      ? unreadMap.get(String(viewerId)) || 0
      : Number(unreadMap[String(viewerId)] || 0);
  const others = (c.participants || []).filter(
    (p) => String(p?._id || p) !== String(viewerId)
  );
  return {
    _id: c._id,
    type: c.type,
    tournament: c.tournament,
    participants: c.participants,
    otherParticipants: others,
    lastMessage: c.lastMessage,
    lastMessageAt: c.lastMessageAt,
    unread: myUnread,
    muted: (c.mutedBy || [])
      .map(String)
      .includes(String(viewerId)),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// Rút gọn replyTo (khi đã populate) thành preview nhẹ để render quote.
function toReplyPreview(rt) {
  if (!rt) return null;
  if (typeof rt !== "object") return { _id: rt }; // chưa populate → chỉ id
  const s = rt.sender && typeof rt.sender === "object" ? rt.sender : null;
  return {
    _id: rt._id,
    content: rt.deletedAt ? "" : rt.content || "",
    attachments: (rt.attachments || []).map((a) => ({ type: a?.type })),
    deletedAt: rt.deletedAt || null,
    sender: s
      ? { _id: s._id, name: s.name, nickname: s.nickname, avatar: s.avatar }
      : rt.sender || null,
  };
}

function toMessageDTO(msg) {
  const m = typeof msg.toObject === "function" ? msg.toObject() : { ...msg };
  return {
    _id: m._id,
    conversation: m.conversation,
    sender: m.sender,
    content: m.content,
    attachments: m.attachments || [],
    replyTo: toReplyPreview(m.replyTo),
    reactions: (m.reactions || []).map((r) => ({
      user: r?.user?._id ? String(r.user._id) : String(r?.user || ""),
      emoji: r?.emoji,
    })),
    mentions: m.mentions || [],
    linkedTournament: m.linkedTournament || null,
    readBy: m.readBy || [],
    systemKind: m.systemKind || null,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

// Populate spec cho replyTo (dùng chung listMessages + sendMessage response)
const REPLY_POPULATE = {
  path: "replyTo",
  select: "_id content attachments sender deletedAt",
  populate: { path: "sender", select: "_id name nickname avatar" },
};

function emitToConv(convId, event, payload) {
  try {
    const io = getIO?.();
    if (io) io.to(`chat:${convId}`).emit(event, payload);
  } catch (err) {
    console.error("[chat] socket emit error:", err?.message || err);
  }
}

/* ─────────────────────── CONVERSATIONS ─────────────────────── */

// GET /api/chat/conversations
export const listConversations = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const cursor = decodeCursor(req.query.cursor);

  const q = {
    participants: viewer._id,
    hiddenFor: { $ne: viewer._id },
    isBlocked: false,
  };
  // Loại DM với user đã chặn (hoặc bị chặn) — Apple 1.2
  const blocked = await getBlockedIdSet(viewer._id);
  if (blocked.size) {
    q.$nor = [
      {
        type: "dm",
        participants: {
          $in: Array.from(blocked).map(
            (id) => new mongoose.Types.ObjectId(id)
          ),
        },
      },
    ];
  }
  if (cursor?.payload?.lastAt) {
    q.lastMessageAt = { $lt: new Date(cursor.payload.lastAt) };
  }

  const docs = await ChatConversation.find(q)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate("participants", USER_FIELDS)
    .populate("tournament", "_id name image");

  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map((d) => toConvDTO(d, viewer._id));
  const nextCursor = hasMore
    ? encodeCursor({
        lastAt: docs[limit - 1].lastMessageAt?.toISOString() || null,
      })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// POST /api/chat/conversations/dm  { peerUserId }
export const openDmConversation = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const peerId = req.body?.peerUserId;
  if (!peerId || !mongoose.isValidObjectId(peerId)) {
    res.status(400);
    throw new Error("peerUserId không hợp lệ");
  }
  if (String(peerId) === String(viewer._id)) {
    res.status(400);
    throw new Error("Không thể nhắn cho chính mình");
  }
  const peer = await User.findById(peerId).select("_id");
  if (!peer) {
    res.status(404);
    throw new Error("Không tìm thấy user");
  }

  // Chặn tạo/mở DM giữa 2 user đang có quan hệ blocked (bất kỳ hướng) — Apple 1.2
  const blocked = await getBlockedIdSet(viewer._id);
  if (blocked.has(String(peerId))) {
    res.status(403);
    throw new Error("Không thể nhắn tin: đã chặn hoặc bị chặn.");
  }

  const sorted = [String(viewer._id), String(peerId)].sort();
  let conv = await ChatConversation.findOne({
    type: "dm",
    participants: { $all: sorted, $size: 2 },
  })
    .populate("participants", USER_FIELDS);

  if (!conv) {
    conv = await ChatConversation.create({
      type: "dm",
      participants: sorted,
      initiator: viewer._id,
    });
    conv = await ChatConversation.findById(conv._id).populate(
      "participants",
      USER_FIELDS
    );
  } else if (conv.hiddenFor?.length) {
    // un-hide nếu trước đó user đã ẩn
    await ChatConversation.updateOne(
      { _id: conv._id },
      { $pull: { hiddenFor: viewer._id } }
    );
  }

  res.json(toConvDTO(conv, viewer._id));
});

// POST /api/chat/conversations/tournament/:tid
export const openTournamentConversation = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const tid = req.params.tid;
  if (!mongoose.isValidObjectId(tid)) {
    res.status(400);
    throw new Error("tournamentId không hợp lệ");
  }
  const tournament = await Tournament.findById(tid).select("_id name image createdBy");
  if (!tournament) {
    res.status(404);
    throw new Error("Không tìm thấy giải đấu");
  }

  // Tổng hợp participants: viewer + organizer (createdBy) + tất cả managers
  const managers = await TournamentManager.find({ tournament: tid })
    .select("user")
    .lean();
  const set = new Set([String(viewer._id)]);
  if (tournament.createdBy) set.add(String(tournament.createdBy));
  for (const m of managers) if (m?.user) set.add(String(m.user));
  const participants = Array.from(set);

  let conv = await ChatConversation.findOne({
    type: "tournament",
    tournament: tid,
    initiator: viewer._id,
  }).populate("participants", USER_FIELDS);

  if (!conv) {
    conv = await ChatConversation.create({
      type: "tournament",
      tournament: tid,
      initiator: viewer._id,
      participants,
    });
    // system message chào mừng
    await ChatMessage.create({
      conversation: conv._id,
      sender: viewer._id,
      content: `Cuộc trò chuyện được tạo — bạn có thể nhắn cho BTC "${tournament.name}".`,
      systemKind: "conversation_created",
    });
    conv = await ChatConversation.findById(conv._id).populate(
      "participants",
      USER_FIELDS
    );
  } else {
    // Sync participants nếu manager list thay đổi
    const currentSet = new Set(conv.participants.map((p) => String(p._id || p)));
    const toAdd = participants.filter((p) => !currentSet.has(p));
    if (toAdd.length) {
      await ChatConversation.updateOne(
        { _id: conv._id },
        { $addToSet: { participants: { $each: toAdd } } }
      );
      conv = await ChatConversation.findById(conv._id).populate(
        "participants",
        USER_FIELDS
      );
    }
    if (conv.hiddenFor?.length) {
      await ChatConversation.updateOne(
        { _id: conv._id },
        { $pull: { hiddenFor: viewer._id } }
      );
    }
  }

  res.json(toConvDTO(conv, viewer._id));
});

// GET /api/chat/conversations/:cid
export const getConversation = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const conv = await ChatConversation.findById(req.params.cid)
    .populate("participants", USER_FIELDS)
    .populate("tournament", "_id name image");
  if (!conv || !isParticipant(conv, viewer._id)) {
    res.status(404);
    throw new Error("Không tìm thấy hội thoại");
  }
  res.json(toConvDTO(conv, viewer._id));
});

// PATCH /api/chat/conversations/:cid  { muted?, hidden? }
export const patchConversation = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const conv = await ChatConversation.findById(req.params.cid);
  if (!conv || !isParticipant(conv, viewer._id)) {
    res.status(404);
    throw new Error("Không tìm thấy hội thoại");
  }
  const update = {};
  if (req.body?.muted === true) update.$addToSet = { mutedBy: viewer._id };
  else if (req.body?.muted === false) update.$pull = { mutedBy: viewer._id };
  if (req.body?.hidden === true) {
    update.$addToSet = { ...(update.$addToSet || {}), hiddenFor: viewer._id };
  } else if (req.body?.hidden === false) {
    update.$pull = { ...(update.$pull || {}), hiddenFor: viewer._id };
  }
  if (Object.keys(update).length) await ChatConversation.updateOne({ _id: conv._id }, update);
  const fresh = await ChatConversation.findById(conv._id)
    .populate("participants", USER_FIELDS)
    .populate("tournament", "_id name image");
  res.json(toConvDTO(fresh, viewer._id));
});

/* ─────────────────────── MESSAGES ─────────────────────── */

// GET /api/chat/conversations/:cid/messages?cursor=&limit=
export const listMessages = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const cid = req.params.cid;
  const conv = await ChatConversation.findById(cid);
  if (!conv || !isParticipant(conv, viewer._id)) {
    res.status(404);
    throw new Error("Không tìm thấy hội thoại");
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const cursor = decodeCursor(req.query.cursor);
  const q = { conversation: cid, deletedAt: null };
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }
  const docs = await ChatMessage.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("sender", USER_FIELDS)
    .populate("mentions", USER_FIELDS)
    .populate(REPLY_POPULATE)
    .populate("linkedTournament", "_id name image location startDate endDate status maxPairs");
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map(toMessageDTO);
  await attachTournamentRegCounts(items);
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// POST /api/chat/conversations/:cid/messages  { content, attachments?, replyTo? }
export const sendMessage = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const cid = req.params.cid;
  const conv = await ChatConversation.findById(cid);
  if (!conv || !isParticipant(conv, viewer._id)) {
    res.status(404);
    throw new Error("Không tìm thấy hội thoại");
  }
  if (conv.isBlocked) {
    res.status(403);
    throw new Error("Hội thoại đã bị khoá");
  }
  // Chặn gửi nếu là DM giữa 2 user đang blocked lẫn nhau — Apple 1.2
  if (conv.type === "dm") {
    const other = (conv.participants || [])
      .map((p) => String(p?._id || p))
      .find((p) => p !== String(viewer._id));
    if (other) {
      const blocked = await getBlockedIdSet(viewer._id);
      if (blocked.has(other)) {
        res.status(403);
        throw new Error("Không thể gửi tin nhắn: đã chặn hoặc bị chặn.");
      }
    }
  }
  const content = String(req.body?.content || "").slice(0, 4000);
  const attachments = Array.isArray(req.body?.attachments)
    ? req.body.attachments.slice(0, 10)
    : [];
  const replyTo =
    req.body?.replyTo && mongoose.isValidObjectId(req.body.replyTo)
      ? req.body.replyTo
      : null;
  const linkedTournament =
    req.body?.linkedTournament &&
    mongoose.isValidObjectId(req.body.linkedTournament)
      ? req.body.linkedTournament
      : null;
  const mentions = Array.isArray(req.body?.mentions)
    ? req.body.mentions
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(String(id)))
        .slice(0, 20)
    : [];
  if (!content.trim() && !attachments.length && !linkedTournament) {
    res.status(400);
    throw new Error("Tin nhắn không thể trống");
  }

  const msg = await ChatMessage.create({
    conversation: cid,
    sender: viewer._id,
    content,
    attachments,
    replyTo,
    mentions,
    linkedTournament,
    readBy: [viewer._id],
  });

  // Cập nhật preview + unread
  conv.lastMessage = {
    text: content || (attachments.length ? "[Đính kèm]" : ""),
    sender: viewer._id,
    at: new Date(),
    hasAttachment: attachments.length > 0,
  };
  conv.lastMessageAt = new Date();
  conv.bumpUnreadExcept(viewer._id);
  // un-hide cho tất cả (nếu có ai đã ẩn thì tin mới sẽ bring back)
  conv.hiddenFor = [];
  await conv.save();

  const populated = await ChatMessage.findById(msg._id)
    .populate("sender", USER_FIELDS)
    .populate("mentions", USER_FIELDS)
    .populate(REPLY_POPULATE)
    .populate("linkedTournament", "_id name image location startDate endDate status maxPairs");
  const dto = toMessageDTO(populated);
  await attachTournamentRegCounts([dto]);

  emitToConv(cid, "chat:message:new", { conversationId: String(cid), message: dto });
  // Cũng emit "chat:conversation:updated" để list tự bump lên top
  const io = getIO?.();
  if (io) {
    for (const p of conv.participants) {
      io.to(`user:${String(p)}`).emit("chat:conversation:bumped", {
        conversationId: String(cid),
        lastMessage: conv.lastMessage,
        lastMessageAt: conv.lastMessageAt,
      });
    }
  }

  // Push notify — fire and forget
  notifyChatMessage({
    conversation: conv,
    message: populated,
    actorId: viewer._id,
  });

  res.status(201).json(dto);
});

// POST /api/chat/conversations/:cid/read
export const markRead = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const cid = req.params.cid;
  const conv = await ChatConversation.findById(cid);
  if (!conv || !isParticipant(conv, viewer._id)) {
    res.status(404);
    throw new Error("Không tìm thấy hội thoại");
  }
  // reset unread
  conv.unread.set(String(viewer._id), 0);
  await conv.save();
  // đánh dấu readBy cho tất cả messages chưa có
  await ChatMessage.updateMany(
    { conversation: cid, readBy: { $ne: viewer._id }, deletedAt: null },
    { $addToSet: { readBy: viewer._id } }
  );
  emitToConv(cid, "chat:read", {
    conversationId: String(cid),
    userId: String(viewer._id),
    at: new Date().toISOString(),
  });
  res.json({ success: true });
});

// DELETE /api/chat/messages/:mid  (sender hoặc admin)
export const deleteMessage = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const m = await ChatMessage.findById(req.params.mid);
  if (!m || m.deletedAt) {
    res.status(404);
    throw new Error("Không tìm thấy tin nhắn");
  }
  if (String(m.sender) !== String(viewer._id) && !isAdmin(viewer)) {
    res.status(403);
    throw new Error("Không có quyền xoá");
  }
  m.deletedAt = new Date();
  m.deletedBy = viewer._id;
  m.content = "";
  m.attachments = [];
  await m.save();
  emitToConv(m.conversation, "chat:message:deleted", {
    conversationId: String(m.conversation),
    messageId: String(m._id),
  });
  res.json({ success: true });
});

// POST /api/chat/messages/:mid/react  { emoji }
// Toggle reaction của viewer: cùng emoji → gỡ; khác/chưa có → set emoji đó.
// emoji rỗng/null → gỡ reaction hiện tại.
export const reactMessage = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const m = await ChatMessage.findById(req.params.mid);
  if (!m || m.deletedAt) {
    res.status(404);
    throw new Error("Không tìm thấy tin nhắn");
  }
  const conv = await ChatConversation.findById(m.conversation).select(
    "participants"
  );
  if (!conv || !isParticipant(conv, viewer._id)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  const emoji = String(req.body?.emoji || "").trim().slice(0, 16);
  const uid = String(viewer._id);
  const list = Array.isArray(m.reactions) ? m.reactions : [];
  const existing = list.find((r) => String(r.user) === uid);
  let action = "set";
  if (!emoji || (existing && existing.emoji === emoji)) {
    m.reactions = list.filter((r) => String(r.user) !== uid);
    action = "remove";
  } else if (existing) {
    existing.emoji = emoji;
  } else {
    m.reactions = [...list, { user: viewer._id, emoji }];
  }
  await m.save();

  const reactions = (m.reactions || []).map((r) => ({
    user: String(r.user),
    emoji: r.emoji,
  }));
  emitToConv(m.conversation, "chat:message:reaction", {
    conversationId: String(m.conversation),
    messageId: String(m._id),
    reactions,
  });
  res.json({ success: true, action, reactions });
});

/* ─────────────────────── TYPING ─────────────────────── */

// POST /api/chat/conversations/:cid/typing  (fire-and-forget)
export const emitTyping = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const cid = req.params.cid;
  const conv = await ChatConversation.findById(cid).select("participants");
  if (!conv || !isParticipant(conv, viewer._id)) {
    res.status(404);
    throw new Error("Không tìm thấy hội thoại");
  }
  emitToConv(cid, "chat:typing", {
    conversationId: String(cid),
    userId: String(viewer._id),
    at: Date.now(),
  });
  res.json({ success: true });
});

/* ─────────────────────── ADMIN ─────────────────────── */

// GET /api/admin/chat/conversations
export const adminListConversations = asyncHandler(async (req, res) => {
  const type = req.query.type;
  const q = {};
  if (type === "dm" || type === "tournament") q.type = type;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const cursor = decodeCursor(req.query.cursor);
  if (cursor?.payload?.lastAt) {
    q.lastMessageAt = { $lt: new Date(cursor.payload.lastAt) };
  }
  const docs = await ChatConversation.find(q)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate("participants", USER_FIELDS)
    .populate("tournament", "_id name image");
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map((d) => toConvDTO(d, req.user._id));
  const nextCursor = hasMore
    ? encodeCursor({
        lastAt: docs[limit - 1].lastMessageAt?.toISOString() || null,
      })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// GET /api/admin/chat/conversations/:cid/messages  (admin xem all, không lọc soft-delete)
export const adminListMessages = asyncHandler(async (req, res) => {
  const cid = req.params.cid;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const cursor = decodeCursor(req.query.cursor);
  const q = { conversation: cid };
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }
  const docs = await ChatMessage.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("sender", USER_FIELDS)
    .populate("mentions", USER_FIELDS)
    .populate(REPLY_POPULATE)
    .populate("linkedTournament", "_id name image location startDate endDate status maxPairs");
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map(toMessageDTO);
  await attachTournamentRegCounts(items);
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// PATCH /api/admin/chat/conversations/:cid  { isBlocked }
export const adminPatchConversation = asyncHandler(async (req, res) => {
  const conv = await ChatConversation.findById(req.params.cid);
  if (!conv) {
    res.status(404);
    throw new Error("Không tìm thấy hội thoại");
  }
  if (typeof req.body?.isBlocked === "boolean") conv.isBlocked = req.body.isBlocked;
  await conv.save();
  res.json({ success: true, conversation: toConvDTO(conv, req.user._id) });
});

// DELETE /api/admin/chat/messages/:mid  (hard delete)
export const adminDeleteMessage = asyncHandler(async (req, res) => {
  const m = await ChatMessage.findById(req.params.mid);
  if (!m) {
    res.status(404);
    throw new Error("Không tìm thấy tin nhắn");
  }
  const cid = m.conversation;
  await m.deleteOne();
  emitToConv(cid, "chat:message:deleted", {
    conversationId: String(cid),
    messageId: String(req.params.mid),
  });
  res.json({ success: true });
});
