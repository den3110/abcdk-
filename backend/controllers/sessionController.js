// controllers/sessionController.js
// Buổi tập / sinh hoạt CLB + điểm danh.
// Xem: thành viên. Tạo/sửa/xoá: admin. Điểm danh: thành viên (bản thân) hoặc admin (người khác).
import mongoose from "mongoose";
import ClubSession from "../models/clubSessionModel.js";
import ClubSessionAttendance from "../models/clubSessionAttendanceModel.js";
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

/** GET /clubs/:id/sessions */
export const listSessions = async (req, res) => {
  try {
    const meId = req.user?._id ? String(req.user._id) : null;
    const isMember = await resolveIsMember(req);
    if (!canReadClubContent(req.club, meId, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem buổi tập." });
    }
    const { page = 1, limit = 30 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));

    const [rows, total] = await Promise.all([
      ClubSession.find({ club: req.club._id })
        .sort({ startAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      ClubSession.countDocuments({ club: req.club._id }),
    ]);

    let mySet = new Set();
    if (meId && rows.length) {
      const mine = await ClubSessionAttendance.find({
        session: { $in: rows.map((r) => r._id) },
        user: meId,
      })
        .select("session")
        .lean();
      mySet = new Set(mine.map((m) => String(m.session)));
    }
    const items = rows.map((r) => ({ ...r, myCheckedIn: mySet.has(String(r._id)) }));
    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listSessions error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/sessions — admin (repeatWeeks: lặp hàng tuần) */
export const createSession = async (req, res) => {
  try {
    const { title = "Buổi tập", startAt, location = "", note = "", repeatWeeks = 1 } = req.body || {};
    if (!startAt) return res.status(400).json({ message: "Thiếu thời gian bắt đầu." });
    const base = new Date(startAt);
    if (Number.isNaN(base.getTime()))
      return res.status(400).json({ message: "Thời gian không hợp lệ." });

    const weeks = Math.min(52, Math.max(1, parseInt(repeatWeeks, 10) || 1));
    const docs = [];
    for (let i = 0; i < weeks; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i * 7);
      docs.push({
        club: req.club._id,
        title: String(title || "Buổi tập").slice(0, 200),
        startAt: d,
        location: String(location || "").slice(0, 300),
        note: String(note || "").slice(0, 2000),
        createdBy: req.user._id,
      });
    }
    const created = await ClubSession.insertMany(docs);
    return res.status(201).json({ items: created, count: created.length });
  } catch (err) {
    console.error("createSession error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** PATCH /clubs/:id/sessions/:sessionId — admin */
export const updateSession = async (req, res) => {
  try {
    const patch = {};
    ["title", "startAt", "location", "note"].forEach((k) => {
      if (k in req.body) patch[k] = req.body[k];
    });
    if (patch.startAt) patch.startAt = new Date(patch.startAt);
    const doc = await ClubSession.findOneAndUpdate(
      { _id: req.params.sessionId, club: req.club._id },
      { $set: patch },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Không tìm thấy buổi tập." });
    return res.json(doc);
  } catch (err) {
    console.error("updateSession error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** DELETE /clubs/:id/sessions/:sessionId — admin */
export const deleteSession = async (req, res) => {
  try {
    const del = await ClubSession.deleteOne({
      _id: req.params.sessionId,
      club: req.club._id,
    });
    if (!del.deletedCount)
      return res.status(404).json({ message: "Không tìm thấy buổi tập." });
    await ClubSessionAttendance.deleteMany({ session: req.params.sessionId });
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteSession error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/sessions/:sessionId/checkin — điểm danh (bản thân, hoặc admin điểm danh {member}) */
export const checkinSession = async (req, res) => {
  try {
    const session = await ClubSession.findOne({
      _id: req.params.sessionId,
      club: req.club._id,
    });
    if (!session) return res.status(404).json({ message: "Không tìm thấy buổi tập." });

    // Xác định người được điểm danh
    let targetUser = String(req.user._id);
    if (req.body?.member && String(req.body.member) !== String(req.user._id)) {
      if (!isAdminReq(req))
        return res.status(403).json({ message: "Chỉ quản trị điểm danh người khác." });
      if (!mongoose.isValidObjectId(req.body.member))
        return res.status(400).json({ message: "Thành viên không hợp lệ." });
      targetUser = String(req.body.member);
    } else {
      // tự điểm danh — phải là thành viên
      if (!(await resolveIsMember(req)))
        return res.status(403).json({ message: "Chỉ thành viên được điểm danh." });
    }

    const existed = await ClubSessionAttendance.findOne({
      session: session._id,
      user: targetUser,
    });
    let checkedIn;
    if (existed) {
      await ClubSessionAttendance.deleteOne({ _id: existed._id });
      await ClubSession.updateOne({ _id: session._id }, { $inc: { attendeeCount: -1 } });
      checkedIn = false;
    } else {
      await ClubSessionAttendance.create({
        session: session._id,
        club: req.club._id,
        user: targetUser,
        recordedBy: req.user._id,
      });
      await ClubSession.updateOne({ _id: session._id }, { $inc: { attendeeCount: 1 } });
      checkedIn = true;
    }
    return res.json({ ok: true, checkedIn });
  } catch (err) {
    if (err?.code === 11000) return res.json({ ok: true, checkedIn: true });
    console.error("checkinSession error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/sessions/:sessionId/attendance — danh sách người điểm danh */
export const listAttendance = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!canReadClubContent(req.club, req.user?._id, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem." });
    }
    const rows = await ClubSessionAttendance.find({
      session: req.params.sessionId,
      club: req.club._id,
    })
      .sort({ checkedInAt: 1 })
      .populate("user", USER_FIELDS)
      .lean();
    return res.json({ items: rows.map((r) => r.user).filter(Boolean) });
  } catch (err) {
    console.error("listAttendance error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/sessions/stats — BXH chuyên cần (top thành viên đi nhiều nhất) */
export const attendanceStats = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!canReadClubContent(req.club, req.user?._id, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem." });
    }
    const rows = await ClubSessionAttendance.aggregate([
      { $match: { club: req.club._id } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);
    const ids = rows.map((r) => r._id);
    const users = await mongoose
      .model("User")
      .find({ _id: { $in: ids } })
      .select(USER_FIELDS)
      .lean();
    const uMap = {};
    for (const u of users) uMap[String(u._id)] = u;
    const items = rows
      .map((r) => ({ user: uMap[String(r._id)], count: r.count }))
      .filter((x) => x.user);
    const totalSessions = await ClubSession.countDocuments({ club: req.club._id });
    return res.json({ items, totalSessions });
  } catch (err) {
    console.error("attendanceStats error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
