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
import TournamentManager from "../models/tournamentManagerModel.js";
import {
  publishNotification,
  EVENTS,
} from "./notifications/notificationHub.js";

// Gửi 2 push: 1 cho VĐV/team, 1 cho BTC (forAdmin=true label khác).
async function notifyPromoteRegistration(registration, autoPromoted) {
  try {
    const tid = registration.tournament;
    // Audience VĐV: player1 + player2
    const players = [];
    if (registration.player1?.user)
      players.push(String(registration.player1.user));
    if (registration.player2?.user)
      players.push(String(registration.player2.user));
    if (players.length) {
      publishNotification(
        EVENTS.REGISTRATION_WAITLIST_PROMOTED,
        {
          registrationId: registration._id,
          tournamentId: tid,
          autoPromoted: !!autoPromoted,
          forAdmin: false,
          overrideAudience: players,
        },
        {},
      ).catch((e) =>
        console.error("[notify] waitlist promote (players):", e?.message || e),
      );
    }
    // Audience admin: tour.createdBy + managers
    const adminIds = [];
    if (tid) {
      const tour = await Tournament.findById(tid).select("createdBy").lean();
      if (tour?.createdBy) adminIds.push(String(tour.createdBy));
      const mgrs = await TournamentManager.find({ tournament: tid })
        .select("user")
        .lean();
      for (const m of mgrs || []) if (m?.user) adminIds.push(String(m.user));
    }
    if (adminIds.length) {
      publishNotification(
        EVENTS.REGISTRATION_WAITLIST_PROMOTED,
        {
          registrationId: registration._id,
          tournamentId: tid,
          autoPromoted: !!autoPromoted,
          forAdmin: true,
          overrideAudience: [...new Set(adminIds)],
        },
        {},
      ).catch((e) =>
        console.error("[notify] waitlist promote (admin):", e?.message || e),
      );
    }
  } catch (err) {
    console.error(
      "[waitlist] notifyPromoteRegistration error:",
      err?.message || err,
    );
  }
}

async function notifyPromoteMlpTeam(team, autoPromoted) {
  try {
    const tid = team.tournament;
    // Audience team: captain + players
    const teamAudience = [];
    if (team.captain) teamAudience.push(String(team.captain));
    for (const p of team.players || []) if (p) teamAudience.push(String(p));
    if (teamAudience.length) {
      publishNotification(
        EVENTS.MLP_TEAM_WAITLIST_PROMOTED,
        {
          teamId: team._id,
          tournamentId: tid,
          autoPromoted: !!autoPromoted,
          forAdmin: false,
          overrideAudience: [...new Set(teamAudience)],
        },
        {},
      ).catch((e) =>
        console.error("[notify] mlp team promote (team):", e?.message || e),
      );
    }
    // Audience admin
    const adminIds = [];
    if (tid) {
      const tour = await Tournament.findById(tid).select("createdBy").lean();
      if (tour?.createdBy) adminIds.push(String(tour.createdBy));
      const mgrs = await TournamentManager.find({ tournament: tid })
        .select("user")
        .lean();
      for (const m of mgrs || []) if (m?.user) adminIds.push(String(m.user));
    }
    if (adminIds.length) {
      publishNotification(
        EVENTS.MLP_TEAM_WAITLIST_PROMOTED,
        {
          teamId: team._id,
          tournamentId: tid,
          autoPromoted: !!autoPromoted,
          forAdmin: true,
          overrideAudience: [...new Set(adminIds)],
        },
        {},
      ).catch((e) =>
        console.error("[notify] mlp team promote (admin):", e?.message || e),
      );
    }
  } catch (err) {
    console.error(
      "[waitlist] notifyPromoteMlpTeam error:",
      err?.message || err,
    );
  }
}

export { notifyPromoteRegistration, notifyPromoteMlpTeam };

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

  // Notify cặp + BTC — auto-promoted
  notifyPromoteRegistration(next, true).catch(() => {});
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
  if (next) notifyPromoteMlpTeam(next, true).catch(() => {});
  return next;
}
