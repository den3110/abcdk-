// controllers/reviewController.js — Đánh giá giải đấu / sân chơi
import mongoose from "mongoose";
import Review from "../models/reviewModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import { asId } from "../utils/ids.js";

const TARGET_TYPES = ["tournament", "venue"];

function clampRating(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function clampAspect(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
}

async function hasParticipated(userId, tournamentId) {
  if (!userId || !tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId))
    return false;
  const uid = asId(userId);
  const count = await Registration.countDocuments({
    tournament: asId(tournamentId),
    $or: [
      { "player1.user": uid },
      { "player2.user": uid },
      { user: uid },
    ],
  });
  return count > 0;
}

async function buildSummary(targetType, targetId) {
  const rows = await Review.aggregate([
    { $match: { targetType, targetId: String(targetId), hidden: { $ne: true } } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avg: { $avg: "$rating" },
        avgOrg: { $avg: "$aspects.organization" },
        avgVenue: { $avg: "$aspects.venue" },
        avgValue: { $avg: "$aspects.value" },
        s1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
        s2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
        s3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
        s4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
        s5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
      },
    },
  ]);
  const r = rows[0];
  if (!r) {
    return {
      count: 0,
      avg: 0,
      aspects: { organization: null, venue: null, value: null },
      dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }
  const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  return {
    count: r.count,
    avg: round1(r.avg) || 0,
    aspects: {
      organization: round1(r.avgOrg),
      venue: round1(r.avgVenue),
      value: round1(r.avgValue),
    },
    dist: { 1: r.s1, 2: r.s2, 3: r.s3, 4: r.s4, 5: r.s5 },
  };
}

/** GET /api/reviews/:targetType/:targetId?page=&limit= */
export async function listReviews(req, res) {
  try {
    const { targetType, targetId } = req.params;
    if (!TARGET_TYPES.includes(targetType))
      return res.status(400).json({ message: "Loại đối tượng không hợp lệ" });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { targetType, targetId: String(targetId), hidden: { $ne: true } };

    const [items, total, summary] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("reviewer", "name nickname avatar")
        .lean(),
      Review.countDocuments(filter),
      buildSummary(targetType, targetId),
    ]);

    // Đánh giá của chính user hiện tại (nếu có)
    let mine = null;
    if (req.user?._id) {
      mine = await Review.findOne({
        targetType,
        targetId: String(targetId),
        reviewer: req.user._id,
      })
        .populate("reviewer", "name nickname avatar")
        .lean();
    }

    res.json({
      items,
      total,
      page,
      hasMore: skip + items.length < total,
      summary,
      mine,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

/** POST /api/reviews/:targetType/:targetId  { rating, comment, aspects } (upsert) */
export async function upsertReview(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Chưa đăng nhập" });

    const { targetType, targetId } = req.params;
    if (!TARGET_TYPES.includes(targetType))
      return res.status(400).json({ message: "Loại đối tượng không hợp lệ" });

    const rating = clampRating(req.body?.rating);
    if (!rating)
      return res.status(400).json({ message: "Vui lòng chọn số sao (1-5)" });

    const comment = String(req.body?.comment || "").slice(0, 1000);
    const aspects = {
      organization: clampAspect(req.body?.aspects?.organization),
      venue: clampAspect(req.body?.aspects?.venue),
      value: clampAspect(req.body?.aspects?.value),
    };

    // Xác minh "đã tham gia" cho giải đấu
    let verified = false;
    if (targetType === "tournament") {
      verified = await hasParticipated(userId, targetId);
    }

    const doc = await Review.findOneAndUpdate(
      { targetType, targetId: String(targetId), reviewer: userId },
      { $set: { rating, comment, aspects, verified } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate("reviewer", "name nickname avatar");

    const summary = await buildSummary(targetType, targetId);
    res.json({ ok: true, review: doc, summary });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "Bạn đã đánh giá rồi" });
    }
    res.status(500).json({ message: e.message });
  }
}

/** DELETE /api/reviews/:targetType/:targetId (xoá đánh giá của chính mình) */
export async function deleteMyReview(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Chưa đăng nhập" });

    const { targetType, targetId } = req.params;
    await Review.deleteOne({
      targetType,
      targetId: String(targetId),
      reviewer: userId,
    });
    const summary = await buildSummary(targetType, targetId);
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

/** GET /api/reviews/:targetType/:targetId/summary — chỉ lấy tổng hợp (nhẹ) */
export async function getReviewSummary(req, res) {
  try {
    const { targetType, targetId } = req.params;
    if (!TARGET_TYPES.includes(targetType))
      return res.status(400).json({ message: "Loại đối tượng không hợp lệ" });
    const summary = await buildSummary(targetType, targetId);
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

/** ADMIN: GET /api/reviews/admin/list?targetType=&hidden=&page=&limit= */
export async function adminListReviews(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.targetType && TARGET_TYPES.includes(req.query.targetType))
      filter.targetType = req.query.targetType;
    if (req.query.hidden === "true") filter.hidden = true;
    if (req.query.hidden === "false") filter.hidden = { $ne: true };

    const [items, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("reviewer", "name nickname avatar")
        .lean(),
      Review.countDocuments(filter),
    ]);

    // Đính kèm tên giải đấu cho các review tournament
    const tourIds = items
      .filter((r) => r.targetType === "tournament")
      .map((r) => r.targetId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    let tourMap = {};
    if (tourIds.length) {
      const tours = await Tournament.find({ _id: { $in: tourIds.map(asId) } })
        .select("name")
        .lean();
      tourMap = Object.fromEntries(tours.map((t) => [String(t._id), t.name]));
    }
    const enriched = items.map((r) => ({
      ...r,
      targetName:
        r.targetType === "tournament" ? tourMap[r.targetId] || null : r.targetId,
    }));

    res.json({ items: enriched, total, page, hasMore: skip + items.length < total });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

/** ADMIN: PATCH /api/reviews/admin/:id/hidden { hidden } */
export async function adminSetHidden(req, res) {
  try {
    const { id } = req.params;
    const hidden = Boolean(req.body?.hidden);
    const doc = await Review.findByIdAndUpdate(
      id,
      { $set: { hidden } },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ message: "Không tìm thấy" });
    res.json({ ok: true, review: doc });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}
