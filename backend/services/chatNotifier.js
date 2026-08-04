// services/chatNotifier.js — Push cho tin nhắn mới.
import User from "../models/userModel.js";
import { sendToUserIds } from "./notifications/expoPush.js";
import { createInAppNotifications } from "./inAppNotify.js";

async function pickActorLabel(actorId) {
  if (!actorId) return "Ai đó";
  try {
    const u = await User.findById(actorId).select("nickname name").lean();
    return u?.nickname || u?.name || "Ai đó";
  } catch {
    return "Ai đó";
  }
}

export async function notifyChatMessage({ conversation, message, actorId }) {
  try {
    const targets = (conversation.participants || [])
      .map((p) => String(p?._id || p))
      .filter((uid) => uid !== String(actorId));
    if (!targets.length) return;
    // Loại user đã mute
    const muted = new Set(
      (conversation.mutedBy || []).map((x) => String(x))
    );
    const finalTargets = targets.filter((uid) => !muted.has(uid));
    if (!finalTargets.length) return;

    const actor = await pickActorLabel(actorId);
    const preview = message.content
      ? message.content.slice(0, 120)
      : message.attachments?.length
        ? "📎 Đã gửi tệp đính kèm"
        : "";

    // Push realtime
    await sendToUserIds(
      finalTargets,
      {
        title: actor,
        body: preview,
        data: {
          url: `/messages/${String(conversation._id)}`,
          kind: "CHAT_MESSAGE_NEW",
          conversationId: String(conversation._id),
        },
      },
      { ttl: 3600 }
    );

    // Ghi vào notification center (in-app)
    await createInAppNotifications({
      recipients: finalTargets,
      actorId,
      type: "CHAT_MESSAGE_NEW",
      title: actor,
      body: preview,
      url: `/messages/${String(conversation._id)}`,
      data: {
        conversationId: String(conversation._id),
        messageId: String(message._id),
      },
    });
  } catch (err) {
    console.error("[chatNotifier] error:", err?.message || err);
  }
}
