// services/feedNotifier.js
// Push notify cho Bảng tin — dùng expoPush.sendToUserIds trực tiếp (không đi qua
// notificationHub) vì các event feed không cần audience resolver phức tạp.
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

function dedupe(arr = []) {
  return Array.from(
    new Set(
      arr
        .filter(Boolean)
        .map((x) => String(x))
    )
  );
}

/**
 * Comment mới lên bài — notify author bài (nếu khác actor).
 */
export async function notifyFeedComment({
  postId,
  postAuthorId,
  actorId,
  commentPreview,
  parentAuthorId = null,
  mentions = [],
}) {
  try {
    const targets = dedupe(
      [postAuthorId, parentAuthorId, ...mentions].filter(
        (uid) => String(uid) !== String(actorId)
      )
    );
    if (!targets.length) return;
    const actor = await pickActorLabel(actorId);
    const isReply = !!parentAuthorId;
    const title = isReply ? "Có phản hồi mới" : "Có bình luận mới";
    const body = `${actor}: ${String(commentPreview || "").slice(0, 120)}`;
    await sendToUserIds(
      targets,
      {
        title,
        body,
        data: {
          url: `/feed/post/${postId}`,
          kind: isReply ? "FEED_REPLY_NEW" : "FEED_COMMENT_NEW",
          postId: String(postId),
        },
      },
      { ttl: 3600 }
    );
    await createInAppNotifications({
      recipients: targets,
      actorId,
      type: isReply ? "FEED_REPLY_NEW" : "FEED_COMMENT_NEW",
      title,
      body,
      url: `/feed/post/${postId}`,
      data: { postId: String(postId) },
    });
  } catch (err) {
    console.error("[feedNotifier] comment error:", err?.message || err);
  }
}

/**
 * Mention trong post body — notify user được nhắc.
 */
export async function notifyFeedMention({ postId, actorId, targets = [] }) {
  try {
    const uniq = dedupe(
      targets.filter((uid) => String(uid) !== String(actorId))
    );
    if (!uniq.length) return;
    const actor = await pickActorLabel(actorId);
    await sendToUserIds(
      uniq,
      {
        title: "Bạn được nhắc tới",
        body: `${actor} nhắc tới bạn trong một bài viết`,
        data: {
          url: `/feed/post/${postId}`,
          kind: "FEED_MENTION",
          postId: String(postId),
        },
      },
      { ttl: 3600 }
    );
    await createInAppNotifications({
      recipients: uniq,
      actorId,
      type: "FEED_MENTION",
      title: "Bạn được nhắc tới",
      body: `${actor} nhắc tới bạn trong một bài viết`,
      url: `/feed/post/${postId}`,
      data: { postId: String(postId) },
    });
  } catch (err) {
    console.error("[feedNotifier] mention error:", err?.message || err);
  }
}
