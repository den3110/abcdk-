// controllers/complaintsController.js  (ESM)
import mongoose from "mongoose";
import Complaint from "../models/complaintModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import { notifyNewComplaint } from "../services/telegram/notifyNewComplaint.js";

const asObjectId = (v) => {
  try {
    return new mongoose.Types.ObjectId(v);
  } catch {
    return null;
  }
};

const getUserIdFromPlayer = (pl) => {
  if (!pl) return null;
  if (pl.user) return String(pl.user._id || pl.user);
  return pl._id ? String(pl._id) : null;
};

const isManagerOfTournament = (tour, userId) => {
  if (!tour || !userId) return false;
  if (String(tour.createdBy) === String(userId)) return true;
  if (Array.isArray(tour.managers)) {
    return tour.managers.some((m) => String(m?.user ?? m) === String(userId));
  }
  return !!tour.isManager;
};

export async function createComplaint(req, res, next) {
  try {
    const userId = String(req.user?._id || "");
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { tournamentId, regId } = req.params;
    const content = String(req.body?.content || "").trim();
    if (!content) {
      return res
        .status(400)
        .json({ message: "Nội dung khiếu nại không được để trống" });
    }

    const tid = asObjectId(tournamentId);
    const rid = asObjectId(regId);
    if (!tid || !rid) {
      return res.status(400).json({ message: "ID không hợp lệ" });
    }

    const [tour, reg] = await Promise.all([
      Tournament.findById(tid).lean(),
      Registration.findById(rid).lean(),
    ]);

    if (!tour)
      return res.status(404).json({ message: "Không tìm thấy giải đấu" });
    if (!reg)
      return res.status(404).json({ message: "Không tìm thấy đăng ký" });
    if (String(reg.tournament) !== String(tid)) {
      return res.status(400).json({ message: "Đăng ký không thuộc giải này" });
    }

    const ownerOk = String(reg.createdBy) === String(userId);
    const p1 = getUserIdFromPlayer(reg.player1);
    const p2 = getUserIdFromPlayer(reg.player2);
    const playerOk = [p1, p2]
      .filter(Boolean)
      .some((uid) => String(uid) === String(userId));
    const isAdmin = !!(
      req.user?.isAdmin ||
      req.user?.role === "admin" ||
      (req.user?.roles || []).includes?.("admin")
    );
    const managerOk = isManagerOfTournament(tour, userId);

    if (!(ownerOk || playerOk || isAdmin || managerOk)) {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền gửi khiếu nại cho đăng ký này" });
    }

    // Chống spam basic: tối đa 3 khiếu nại đang mở của cùng user cho cùng registration
    const openCount = await Complaint.countDocuments({
      registration: rid,
      createdBy: userId,
      status: { $in: ["open", "in_progress"] },
    });
    if (openCount >= 5) {
      return res.status(429).json({
        message:
          "Bạn đã vượt quá giới hạn khiếu nại đang xử lý cho đăng ký này",
      });
    }

    const complaint = await Complaint.create({
      tournament: tid,
      registration: rid,
      createdBy: userId,
      content,
      status: "open",
    });

    // Thông báo Telegram bằng helper riêng
    try {
      notifyNewComplaint({
        tournament: tour,
        registration: reg,
        user: req.user,
        content,
        complaint,
      });
    } catch (e) {
      console.error("notifyNewComplaint error:", e);
    }

    return res.status(201).json({ complaint });
  } catch (err) {
    next(err);
  }
}

export async function listComplaints(req, res, next) {
  try {
    const { tournamentId } = req.params;
    const tid = asObjectId(tournamentId);
    if (!tid) return res.status(400).json({ message: "ID không hợp lệ" });

    const tour = await Tournament.findById(tid).lean();
    if (!tour)
      return res.status(404).json({ message: "Không tìm thấy giải đấu" });

    const userId = String(req.user?._id || "");
    const isAdmin = !!(
      req.user?.isAdmin ||
      req.user?.role === "admin" ||
      (req.user?.roles || []).includes?.("admin")
    );
    if (!(isAdmin || isManagerOfTournament(tour, userId))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const items = await Complaint.find({ tournament: tid })
      .sort({ createdAt: -1 })
      .populate("registration", "_id code shortCode player1 player2")
      .populate("createdBy", "_id name nickname phone")
      .lean();

    res.json({ items });
  } catch (err) {
    next(err);
  }
}
