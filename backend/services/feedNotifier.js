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

// Lọc bỏ user đã bật notificationPrefs.feedMuteAll — không nhận noti bảng tin.
async function filterFeedMute(userIds = []) {
  if (!userIds.length) return userIds;
  try {
    const muted = await User.find({
      _id: { $in: userIds },
      "notificationPrefs.feedMuteAll": true,
    })
      .select("_id")
      .lean();
    if (!muted.length) return userIds;
    const set = new Set(muted.map((u) => String(u._id)));
    return userIds.filter((uid) => !set.has(String(uid)));
  } catch (err) {
    console.error("[feedNotifier] mute filter error:", err?.message || err);
    return userIds;
  }
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
    const actorStr = String(actorId);
    const mentionSet = new Set(
      dedupe(mentions.filter((uid) => String(uid) !== actorStr).map(String))
    );
    // User được @mention được ưu tiên notification "Bạn được nhắc tới" — tách khỏi
    // luồng thông báo comment/reply thường để rõ nghĩa hơn.
    const nonMentionTargets = dedupe(
      [postAuthorId, parentAuthorId]
        .filter(Boolean)
        .map(String)
        .filter((uid) => uid !== actorStr && !mentionSet.has(uid))
    );

    const actor = await pickActorLabel(actorId);
    const isReply = !!parentAuthorId;
    const preview = String(commentPreview || "").slice(0, 120);

    // Nhóm 1: người được nhắc → title chuyên biệt
    if (mentionSet.size) {
      const targets = await filterFeedMute(Array.from(mentionSet));
      if (targets.length) {
      const title = "Bạn được nhắc tới trong bình luận";
      const body = `${actor}: ${preview}`;
      await sendToUserIds(
        targets,
        {
          title,
          body,
          data: {
            url: `/feed/post/${postId}`,
            kind: "FEED_MENTION_COMMENT",
            postId: String(postId),
          },
        },
        { ttl: 3600 }
      );
      await createInAppNotifications({
        recipients: targets,
        actorId,
        type: "FEED_MENTION_COMMENT",
        title,
        body,
        url: `/feed/post/${postId}`,
        data: { postId: String(postId) },
      });
      }
    }

    // Nhóm 2: chủ post + chủ comment gốc → title chung
    if (nonMentionTargets.length) {
      const filtered = await filterFeedMute(nonMentionTargets);
      if (filtered.length) {
        const title = isReply ? "Có phản hồi mới" : "Có bình luận mới";
        const body = `${actor}: ${preview}`;
        await sendToUserIds(
          filtered,
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
          recipients: filtered,
          actorId,
          type: isReply ? "FEED_REPLY_NEW" : "FEED_COMMENT_NEW",
          title,
          body,
          url: `/feed/post/${postId}`,
          data: { postId: String(postId) },
        });
      }
    }
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
    const filtered = await filterFeedMute(uniq);
    if (!filtered.length) return;
    const actor = await pickActorLabel(actorId);
    await sendToUserIds(
      filtered,
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
      recipients: filtered,
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
