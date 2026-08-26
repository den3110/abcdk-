// services/clubNotifier.js
// Thông báo hoạt động CLB (thông báo/sự kiện/bình chọn mới) tới thành viên.
// Best-effort: mọi lỗi được nuốt để không chặn luồng tạo nội dung.
import ClubMember from "../models/clubMemberModel.js";
import { createInAppNotifications } from "./inAppNotify.js";
import { sendToUserIds } from "./notifications/expoPush.js";

/**
 * @param {Object} opts
 * @param {Object} opts.club — doc club (cần _id, name)
 * @param {String} opts.actorId — người tạo (loại khỏi danh sách nhận)
 * @param {String} opts.title
 * @param {String} opts.body
 * @param {String} [opts.url] — deep-link (mặc định /clubs/:id)
 * @param {Object} [opts.data]
 */
export async function notifyClubActivity({
  club,
  actorId,
  title,
  body,
  url,
  data,
}) {
  try {
    if (!club?._id) return;
    const members = await ClubMember.find({
      club: club._id,
      status: "active",
    })
      .select("user")
      .lean();

    const actor = String(actorId || "");
    const recipients = members
      .map((m) => String(m.user))
      .filter((uid) => uid && uid !== actor);
    if (!recipients.length) return;

    const deepUrl = url || `/clubs/${club._id}`;
    const payloadData = { clubId: String(club._id), kind: "CLUB_ACTIVITY", ...(data || {}) };

    // In-app (badge + list realtime)
    await createInAppNotifications({
      recipients,
      actorId,
      type: "CLUB_ACTIVITY",
      title,
      body,
      url: deepUrl,
      data: payloadData,
    });

    // Push (expo) — best-effort
    await sendToUserIds(
      recipients,
      { title, body, data: { url: deepUrl, ...payloadData } },
      { ttl: 3600 }
    );
  } catch (err) {
    console.error("[clubNotifier] error:", err?.message || err);
  }
}
