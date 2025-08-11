// services/tournamentLifecycle.js
import { DateTime } from "luxon";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import { addTournamentReputationBonus } from "./reputationService.js";

/**
 * Kết thúc 1 giải:
 * - idempotent (chỉ chạy nếu chưa finished)
 * - snap endDate về NGÀY HIỆN TẠI THEO TIMEZONE của giải
 * - endAt = cuối ngày địa phương đó (UTC)
 * - cộng uy tín +10%
 */
export async function finalizeTournamentById(id) {
  // Lấy timezone của giải (default nếu không có)
  const t0 = await Tournament.findById(id).select("_id status timezone").lean();
  if (!t0) return false;
  if (t0.status === "finished") return false;

  const tz = t0.timezone || "Asia/Ho_Chi_Minh";
  const nowLocal = DateTime.now().setZone(tz);
  const endOfLocalDayUTC = nowLocal.endOf("day").toUTC();
  const nowUTC = nowLocal.toUTC();

  // Cập nhật trạng thái + chốt endDate/endAt
  const t = await Tournament.findOneAndUpdate(
    { _id: id, status: { $ne: "finished" } },
    {
      $set: {
        status: "finished",
        // giữ finishedAt để trace, dù FE có thể bám theo endDate
        finishedAt: nowUTC.toJSDate(),
        // endDate = "ngày hiện tại" theo TZ (hiển thị)
        endDate: nowLocal.toJSDate(),
        // endAt = cuối ngày địa phương đó (chuẩn UTC để so sánh)
        endAt: endOfLocalDayUTC.toJSDate(),
      },
    },
    { new: true }
  );
  if (!t) return false; // có thể race với request khác

  // Gom userIds từ đăng ký (player1, player2)
  const regs = await Registration.find({ tournament: id })
    .select("player1 player2")
    .lean();

  const userIds = Array.from(
    new Set(
      regs.flatMap((r) => [r.player1, r.player2].filter(Boolean)).map(String)
    )
  );

  // +10% uy tín (idempotent nhờ ReputationEvent unique)
  await addTournamentReputationBonus({
    userIds,
    tournamentId: id,
    amount: 10,
  });

  return true;
}

/**
 * Quét & kết thúc các giải đã quá hạn (endAt <= now UTC)
 * - Không động vào endDate cũ nếu đã finished
 * - Với giải đang active: snap endDate về ngày hiện tại (theo TZ) như finalizeTournamentById
 */
export async function finalizeExpiredTournaments() {
  const now = new Date();

  const ids = await Tournament.find({
    status: { $ne: "finished" },
    endAt: { $lte: now },
  })
    .select("_id")
    .lean();

  let finished = 0;
  for (const { _id } of ids) {
    if (await finalizeTournamentById(_id)) finished++;
  }
  return { checked: ids.length, finished };
}

/**
 * (Tuỳ chọn) Chuyển upcoming -> ongoing khi tới startAt
 */
export async function markOngoingTournaments() {
  const now = new Date();
  const r = await Tournament.updateMany(
    { status: "upcoming", startAt: { $lte: now } },
    { $set: { status: "ongoing" } }
  );
  return { modified: r.modifiedCount || 0 };
}
