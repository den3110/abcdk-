// services/tournamentLifecycle.js
import mongoose from "mongoose";
import { DateTime } from "luxon";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import { addTournamentReputationBonus } from "./reputationService.js";

const { isValidObjectId, Types } = mongoose;

/** Lấy _id hợp lệ dưới dạng chuỗi 24-hex từ nhiều dạng đầu vào */
function toHexId(v) {
  if (!v) return null;
  if (typeof v === "string") return isValidObjectId(v) ? v : null;
  if (v instanceof Types.ObjectId) return v.toString();
  if (typeof v === "object" && v._id) return toHexId(v._id);
  return null;
}

export async function finalizeTournamentById(id) {
  // id có thể là string/ObjectId → chuẩn hoá
  const tid = toHexId(id);
  if (!tid) return false;

  // Lấy timezone & trạng thái hiện tại
  const t0 = await Tournament.findById(tid)
    .select("_id status timezone")
    .lean();
  if (!t0) return false;
  if (t0.status === "finished") return false;

  const tz = t0.timezone || "Asia/Ho_Chi_Minh";
  const nowLocal = DateTime.now().setZone(tz);
  const endOfLocalDayUTC = nowLocal.endOf("day").toUTC();
  const nowUTC = nowLocal.toUTC();

  // Cập nhật trạng thái + chốt endDate/endAt
  const t = await Tournament.findOneAndUpdate(
    { _id: tid, status: { $ne: "finished" } },
    {
      $set: {
        status: "finished",
        finishedAt: nowUTC.toJSDate(), // để trace
        endDate: nowLocal.toJSDate(), // ngày hiển thị theo TZ
        endAt: endOfLocalDayUTC.toJSDate(), // mốc chuẩn UTC để so sánh
      },
    },
    { new: true }
  );
  if (!t) return false; // có thể race

  // Gom userIds từ đăng ký (player1, player2) — KHÔNG map(String) !!!
  const regs = await Registration.find({ tournament: tid })
    .select("player1 player2")
    .lean();

  const userIds = Array.from(
    new Set(
      regs
        .flatMap((r) => [toHexId(r.player1), toHexId(r.player2)])
        .filter(Boolean)
    )
  );

  // +10% uy tín (idempotent nhờ unique index trên ReputationEvent)
  await addTournamentReputationBonus({
    userIds,
    tournamentId: tid,
    amount: 10,
  });

  return true;
}

/** Quét & kết thúc các giải đã quá hạn (endAt <= now UTC) */
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

/** Chuyển upcoming -> ongoing khi tới startAt */
export async function markOngoingTournaments() {
  const now = new Date();
  const r = await Tournament.updateMany(
    { status: "upcoming", startAt: { $lte: now } },
    { $set: { status: "ongoing" } }
  );
  return { modified: r.modifiedCount || 0 };
}
