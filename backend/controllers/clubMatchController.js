// controllers/clubMatchController.js
// Trận giao hữu nội bộ + BXH. Xem: thành viên. Ghi: thành viên. Xoá: người tạo/admin.
import mongoose from "mongoose";
import ClubMatch from "../models/clubMatchModel.js";
import ClubMember from "../models/clubMemberModel.js";
import { canReadClubContent } from "../utils/clubVisibility.js";

const USER_FIELDS = "fullName nickname avatar";

async function resolveIsMember(req) {
  const meId = req.user?._id ? String(req.user._id) : null;
  if (!meId) return false;
  if (String(req.club.owner) === meId) return true;
  if (req.clubMembership?.status === "active") return true;
  const exists = await ClubMember.exists({
    club: req.club._id,
    user: meId,
    status: "active",
  });
  return !!exists;
}
function isAdminReq(req) {
  const isOwner =
    req.user?._id && String(req.club.owner) === String(req.user._id);
  return isOwner || req.clubMembership?.role === "admin";
}

/** GET /clubs/:id/matches */
export const listMatches = async (req, res) => {
  try {
    const meId = req.user?._id ? String(req.user._id) : null;
    const isMember = await resolveIsMember(req);
    if (!canReadClubContent(req.club, meId, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem." });
    }
    const { page = 1, limit = 30 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const [items, total] = await Promise.all([
      ClubMatch.find({ club: req.club._id })
        .sort({ playedAt: -1, _id: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate("teamA", USER_FIELDS)
        .populate("teamB", USER_FIELDS)
        .lean(),
      ClubMatch.countDocuments({ club: req.club._id }),
    ]);
    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listMatches error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/matches — thành viên ghi kết quả */
export const createMatch = async (req, res) => {
  try {
    if (!(await resolveIsMember(req)))
      return res.status(403).json({ message: "Chỉ thành viên mới ghi kết quả." });

    const { teamA, teamB, scoreA, scoreB, playedAt, note } = req.body || {};
    const cleanTeam = (t) =>
      [...new Set((Array.isArray(t) ? t : []).map(String))]
        .filter((x) => mongoose.isValidObjectId(x))
        .slice(0, 2);
    const a = cleanTeam(teamA);
    const b = cleanTeam(teamB);
    if (!a.length || !b.length)
      return res.status(400).json({ message: "Cần chọn người cho cả 2 bên." });
    if (a.some((x) => b.includes(x)))
      return res.status(400).json({ message: "Một người không thể ở cả 2 bên." });
    const sA = Math.max(0, Math.round(Number(scoreA) || 0));
    const sB = Math.max(0, Math.round(Number(scoreB) || 0));
    if (sA === sB)
      return res.status(400).json({ message: "Tỉ số không được hoà." });

    const doc = await ClubMatch.create({
      club: req.club._id,
      teamA: a,
      teamB: b,
      scoreA: sA,
      scoreB: sB,
      playedAt: playedAt ? new Date(playedAt) : new Date(),
      note: String(note || "").slice(0, 500),
      createdBy: req.user._id,
    });
    const populated = await ClubMatch.findById(doc._id)
      .populate("teamA", USER_FIELDS)
      .populate("teamB", USER_FIELDS)
      .lean();
    return res.status(201).json(populated);
  } catch (err) {
    console.error("createMatch error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** DELETE /clubs/:id/matches/:matchId — người tạo hoặc admin */
export const deleteMatch = async (req, res) => {
  try {
    const m = await ClubMatch.findOne({
      _id: req.params.matchId,
      club: req.club._id,
    });
    if (!m) return res.status(404).json({ message: "Không tìm thấy trận." });
    if (String(m.createdBy) !== String(req.user._id) && !isAdminReq(req))
      return res.status(403).json({ message: "Không có quyền xoá." });
    await ClubMatch.deleteOne({ _id: m._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteMatch error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/matches/leaderboard — BXH nội bộ */
export const leaderboard = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!canReadClubContent(req.club, req.user?._id, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem." });
    }
    const matches = await ClubMatch.find({ club: req.club._id })
      .select("teamA teamB scoreA scoreB")
      .limit(5000)
      .lean();

    const stat = new Map(); // uid -> { played, won, lost }
    const bump = (uid, won) => {
      const k = String(uid);
      const s = stat.get(k) || { played: 0, won: 0, lost: 0 };
      s.played += 1;
      if (won) s.won += 1;
      else s.lost += 1;
      stat.set(k, s);
    };
    for (const m of matches) {
      const aWon = (m.scoreA || 0) > (m.scoreB || 0);
      for (const u of m.teamA || []) bump(u, aWon);
      for (const u of m.teamB || []) bump(u, !aWon);
    }

    const ids = [...stat.keys()].map((s) => new mongoose.Types.ObjectId(s));
    const users = await mongoose
      .model("User")
      .find({ _id: { $in: ids } })
      .select(USER_FIELDS)
      .lean();
    const uMap = {};
    for (const u of users) uMap[String(u._id)] = u;

    const items = [...stat.entries()]
      .map(([uid, s]) => ({
        user: uMap[uid],
        played: s.played,
        won: s.won,
        lost: s.lost,
        winRate: s.played ? Math.round((s.won / s.played) * 100) : 0,
        points: s.won * 3,
      }))
      .filter((x) => x.user)
      .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played);

    return res.json({ items, totalMatches: matches.length });
  } catch (err) {
    console.error("leaderboard error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
