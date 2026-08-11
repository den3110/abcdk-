// services/waitlistService.js
// Auto-promote FIFO khi có slot approved trống (VĐV/đội rút, admin xoá).
// Áp dụng cho cả Registration (giải thường + team) và MlpTeam (MLP).
//
// Quy tắc:
// - Sort theo createdAt ASC (cặp đăng ký sớm nhất được ưu tiên).
// - Nếu maxPairs=0 hoặc không set → không có cap → skip.
// - Chỉ promote 1 slot mỗi lần gọi (mỗi lần 1 cặp rút = 1 cặp được điền).
// - Bump tournament.registered counter khi promote registration.
// - Emit notification khi có (mlpNotifier / feedNotifier tuỳ loại).

import mongoose from "mongoose";
import Registration from "../models/registrationModel.js";
import MlpTeam from "../models/mlpTeamModel.js";
import Tournament from "../models/tournamentModel.js";

/**
 * Auto-promote 1 registration waitlist cũ nhất → approved.
 * Trả về registration mới được promote hoặc null nếu không có ai.
 */
export async function autoPromoteRegistrationFromWaitlist(tournamentId) {
  if (!mongoose.isValidObjectId(tournamentId)) return null;
  const tour = await Tournament.findById(tournamentId)
    .select("_id maxPairs registered")
    .lean();
  if (!tour) return null;
  // Nếu maxPairs=0 → không có cap; waitlist không có nghĩa. Bỏ qua.
  if (!tour.maxPairs || tour.maxPairs <= 0) return null;

  // Đếm số approved hiện tại — chỉ promote khi < maxPairs.
  const currentApproved = await Registration.countDocuments({
    tournament: tournamentId,
    $or: [
      { status: "approved" },
      { status: { $exists: false } },
      { status: null },
    ],
  });
  if (currentApproved >= tour.maxPairs) return null;

  const next = await Registration.findOneAndUpdate(
    { tournament: tournamentId, status: "waitlisted" },
    { $set: { status: "approved", approvedAt: new Date() } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (!next) return null;

  await Tournament.updateOne(
    { _id: tournamentId },
    { $inc: { registered: 1 }, $set: { updatedAt: new Date() } },
  );
  return next;
}

/**
 * Auto-promote 1 MlpTeam waitlist cũ nhất → approved.
 * Trả về team mới được promote hoặc null nếu không có ai.
 */
export async function autoPromoteMlpTeamFromWaitlist(tournamentId, promotedBy = null) {
  if (!mongoose.isValidObjectId(tournamentId)) return null;
  const tour = await Tournament.findById(tournamentId)
    .select("_id maxPairs tournamentMode")
    .lean();
  if (!tour) return null;
  if (!tour.maxPairs || tour.maxPairs <= 0) return null;

  const currentApproved = await MlpTeam.countDocuments({
    tournament: tournamentId,
    status: { $in: ["approved", "pending"] },
  });
  if (currentApproved >= tour.maxPairs) return null;

  const next = await MlpTeam.findOneAndUpdate(
    { tournament: tournamentId, status: "waitlisted" },
    {
      $set: {
        status: "approved",
        approvedBy: promotedBy || null,
        approvedAt: new Date(),
      },
    },
    { sort: { createdAt: 1 }, new: true },
  );
  return next;
}
