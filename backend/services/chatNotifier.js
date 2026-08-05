// services/chatNotifier.js — Push + in-app notification cho tin nhắn mới.
//
// UX: các tin nhắn liên tiếp trong cùng 1 cuộc hội thoại KHÔNG spam notification
// center — gộp về 1 notif duy nhất (tin nhắn mới nhất + badge count) miễn là
// user chưa đọc. Khi user đã đọc notif đó rồi, tin nhắn tiếp theo mới tạo notif mới.
import User from "../models/userModel.js";
import UserNotification from "../models/userNotificationModel.js";
import { sendToUserIds } from "./notifications/expoPush.js";
import { getIO } from "../socket/index.js";

async function pickActorLabel(actorId) {
  if (!actorId) return "Ai đó";
  try {
    const u = await User.findById(actorId).select("nickname name").lean();
    return u?.nickname || u?.name || "Ai đó";
  } catch {
    return "Ai đó";
  }
}

const ACTOR_POPULATE_FIELDS = "_id name nickname avatar";

async function upsertConversationNotification({
  recipient,
  actorId,
  actorLabel,
  conversationId,
  messageId,
  body,
  url,
}) {
  // Tìm notif unread cùng conversation → update tại chỗ; else create mới.
  // Không dùng { upsert: true } vì insert cần fields khác update ($inc/$set khác nhau).
  const now = new Date();
  const setPayload = {
    actor: actorId || null,
    title: actorLabel,
    body: String(body || "").slice(0, 500),
    url: String(url || "").slice(0, 500),
    "data.messageId": String(messageId || ""),
    "data.conversationId": String(conversationId),
    // Đẩy notif lên top danh sách (list sort theo _id giảm dần — chấp nhận stable order,
    // nhưng UI dropdown sort theo createdAt để user thấy "vừa xong")
    createdAt: now,
  };
  const existing = await UserNotification.findOneAndUpdate(
    {
      user: recipient,
      type: "CHAT_MESSAGE_NEW",
      "data.conversationId": String(conversationId),
      isRead: false,
    },
    { $set: setPayload, $inc: { count: 1 } },
    { new: true }
  );
  if (existing) return { doc: existing, isNewUnread: false };

  const created = await UserNotification.create({
    user: recipient,
    actor: actorId || null,
    type: "CHAT_MESSAGE_NEW",
    title: actorLabel,
    body: String(body || "").slice(0, 500),
    url: String(url || "").slice(0, 500),
    data: {
      conversationId: String(conversationId),
      messageId: String(messageId || ""),
    },
    count: 1,
  });
  return { doc: created, isNewUnread: true };
}

export async function notifyChatMessage({ conversation, message, actorId }) {
  try {
    const targets = (conversation.participants || [])
      .map((p) => String(p?._id || p))
      .filter((uid) => uid !== String(actorId));
    if (!targets.length) return;
    const muted = new Set(
      (conversation.mutedBy || []).map((x) => String(x))
    );
    const finalTargets = targets.filter((uid) => !muted.has(uid));
    if (!finalTargets.length) return;

    const actorLabel = await pickActorLabel(actorId);
    const preview = message.content
      ? message.content.slice(0, 120)
      : message.attachments?.length
        ? "📎 Đã gửi tệp đính kèm"
        : "";
    const url = `/messages/${String(conversation._id)}`;

    // Push realtime — title = tên actor (native OS push cần tên người gửi)
    sendToUserIds(
      finalTargets,
      {
        title: actorLabel,
        body: preview,
        data: {
          url,
          kind: "CHAT_MESSAGE_NEW",
          conversationId: String(conversation._id),
        },
      },
      { ttl: 3600 }
    ).catch((err) =>
      console.error("[chatNotifier] push error:", err?.message || err)
    );

    // In-app: upsert từng recipient song song
    const io = getIO?.();
    await Promise.all(
      finalTargets.map(async (recipient) => {
        try {
          const { doc, isNewUnread } = await upsertConversationNotification({
            recipient,
            actorId,
            actorLabel,
            conversationId: conversation._id,
            messageId: message._id,
            body: preview,
            url,
          });
          if (!io) return;
          // Populate actor cho payload socket (client cần avatar + tên)
          const populated = await UserNotification.findById(doc._id)
            .populate("actor", ACTOR_POPULATE_FIELDS)
            .lean();
          io.to(`user:${recipient}`).emit("notification:new", {
            ...populated,
            isNewUnread,
          });
        } catch (err) {
          console.error(
            "[chatNotifier] upsert error:",
            err?.message || err
          );
        }
      })
    );
  } catch (err) {
    console.error("[chatNotifier] error:", err?.message || err);
  }
}
