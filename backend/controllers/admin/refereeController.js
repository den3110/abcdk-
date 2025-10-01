// controllers/admin/refereeController.js
import mongoose from "mongoose";
import User from "../../models/userModel.js";
import { canManageTournament } from "../../utils/tournamentAuth.js";

const rx = (q) => {
  const safe = String(q || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(safe, "i");
};

/**
 * GET /api/admin/referees/search?tid=&q=&limit=
 * - Tìm user (không giới hạn role)
 * - Nếu có tid → trả thêm isAssigned (đã nằm trong referee.tournaments)
 * - Sắp xếp: đã gán trước, sau đó đến role=referee, rồi theo tên
 */
export const searchUsersForRefereeAssign = async (req, res, next) => {
  try {
    // Quyền

    const { q = "", limit = 50, tid = "" } = req.query;
    const me = req.user;
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, tid);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const L = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const hasTid = tid && mongoose.isValidObjectId(tid);
    const TID = hasTid ? new mongoose.Types.ObjectId(tid) : null;

    const filter = { isDeleted: { $ne: true } };
    if (q && String(q).trim()) {
      const r = rx(q.trim());
      filter.$or = [{ name: r }, { nickname: r }, { email: r }, { phone: r }];
    }

    const users = await User.find(filter)
      .select(
        "_id name nickname email phone avatar role province referee.tournaments"
      )
      .limit(L)
      .lean();

    const data = users.map((u) => {
      const assigned =
        hasTid &&
        Array.isArray(u?.referee?.tournaments) &&
        u.referee.tournaments.some((x) => String(x) === String(TID));
      return {
        _id: u._id,
        name: u.name,
        nickname: u.nickname,
        email: u.email,
        phone: u.phone,
        avatar: u.avatar,
        role: u.role, // để biết đang là user/referee/admin
        province: u.province,
        isAssigned: hasTid ? !!assigned : undefined,
        isReferee: u.role === "referee",
      };
    });

    if (hasTid) {
      // đã gán đứng trên; sau đó ưu tiên role=referee
      data.sort((a, b) => {
        const byAssigned = (b.isAssigned === true) - (a.isAssigned === true);
        if (byAssigned !== 0) return byAssigned;
        const byRole = (b.isReferee === true) - (a.isReferee === true);
        if (byRole !== 0) return byRole;
        return String(a.name || a.nickname || "").localeCompare(
          String(b.name || b.nickname || ""),
          "vi",
          { sensitivity: "base" }
        );
      });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
};
