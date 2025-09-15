// services/teleTopicService.js
import Tournament from "../../models/tournamentModel.js";
import { createForumTopic, createInviteLink } from "../../utils/telegram.js";

const TAG = "[teleTopicService]";

/**
 * Đảm bảo tournament có forum topic.
 * - Ưu tiên dùng hubChatId đã lưu trong t.tele, nếu thiếu thì fallback ENV.
 * - Bỏ qua nếu tele.enabled === false.
 * - Idempotent: nếu đã có topicId thì trả về luôn.
 */
export async function ensureTournamentForumTopic(tournament) {
  if (!tournament) return null;

  // lấy bản mới nhất nếu cần
  const t =
    typeof tournament?.populate === "function"
      ? tournament
      : await Tournament.findById(tournament._id || tournament).exec();

  if (!t) return null;

  const tele = t.tele || {};
  if (tele.enabled === false) {
    console.log(`${TAG} tele.disabled for tournament=${t._id}`);
    return null;
  }

  const hubChatId = tele.hubChatId || process.env.TELEGRAM_HUB_CHAT_ID || null;

  if (!hubChatId) {
    console.error(`${TAG} missing hubChatId (env or t.tele.hubChatId)`, {
      tournamentId: String(t._id),
      hasTele: !!t.tele,
    });
    return null;
  }

  if (tele.topicId) {
    // đã có topic từ trước
    return tele.topicId;
  }

  try {
    // tạo topic mới theo tên giải
    const topicId = await createForumTopic({
      chatId: hubChatId,
      name: t.title,
    });

    // tạo invite link (tuỳ chọn, có thể fail nếu quyền không đủ)
    let inviteLink = tele.inviteLink;
    try {
      inviteLink =
        inviteLink ||
        (await createInviteLink({ chatId: hubChatId, name: t.title }));
    } catch (e) {
      console.error(
        `${TAG} createInviteLink failed (non-fatal):`,
        e?.message || e,
        {
          tournamentId: String(t._id),
        }
      );
    }

    t.tele = {
      ...tele,
      hubChatId,
      topicId,
      inviteLink,
      enabled: tele.enabled !== false, // mặc định true
    };
    await t.save();

    console.log(`${TAG} created topic`, {
      tournamentId: String(t._id),
      topicId,
      hubChatId,
    });

    return topicId;
  } catch (e) {
    console.error(
      `${TAG} ensureTournamentForumTopic failed:`,
      e?.message || e,
      {
        tournamentId: String(t._id),
        hubChatId,
        title: t.title,
      }
    );
    return null;
  }
}
