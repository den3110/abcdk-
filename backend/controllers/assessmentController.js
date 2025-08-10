// controllers/assessmentController.js
import Assessment from "../models/assessmentModel.js";
import Ranking from "../models/rankingModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import mongoose from "mongoose";
import { computeLevels } from "../utils/computeLevels.js";

/**
 * POST /api/assessments/:userId
 * body: { items: [{skillId, single, double}], note? }
 * return: { assessment, ranking }
 */
export async function createAssessment(req, res) {
  const { userId } = req.params;
  const { items = [], note = "" } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "items required" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { singleScore, doubleScore, singleLevel, doubleLevel, meta } =
      computeLevels(items);

    // Lưu bản chấm
    const assessment = await Assessment.create(
      [
        {
          user: userId,
          scorer: req.user?._id || null,
          items,
          singleScore,
          doubleScore,
          singleLevel,
          doubleLevel,
          meta,
          note,
        },
      ],
      { session }
    );

    // Cập nhật Ranking
    const r = await Ranking.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          single: singleLevel,
          double: doubleLevel,
          lastUpdated: new Date(),
        },
        $inc: {
          // ví dụ bonus point theo tần suất/đấu giải/hệ thống khác
          points:
            (meta.freq || 0) +
            (meta.competed ? 1 : 0) +
            (meta.external || 0) / 10,
        },
      },
      { upsert: true, new: true, session }
    );

    // Log lịch sử điểm (đơn/đôi) – để khớp model có sẵn của bạn
    await ScoreHistory.create(
      [
        {
          user: userId,
          scorer: req.user?._id || null,
          single: singleLevel,
          double: doubleLevel,
          note,
          scoredAt: new Date(),
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      assessment: assessment[0],
      ranking: r,
    });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ message: e.message || "Create failed" });
  }
}

/**
 * GET /api/assessments/:userId/latest
 */
export async function getLatestAssessment(req, res) {
  const { userId } = req.params;
  const a = await Assessment.findOne({ user: userId })
    .sort({ scoredAt: -1 })
    .lean();
  return res.json(a || null);
}

/**
 * GET /api/assessments/:userId/history?limit=20
 */
export async function getAssessmentHistory(req, res) {
  const { userId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const list = await Assessment.find({ user: userId })
    .sort({ scoredAt: -1 })
    .limit(limit)
    .lean();
  return res.json(list);
}

/**
 * OPTIONAL: PUT /api/assessments/:id  (admin/referee)
 * Cho phép sửa note hoặc items rồi tính lại
 */
export async function updateAssessment(req, res) {
  const { id } = req.params;
  const { items, note } = req.body;

  const a = await Assessment.findById(id);
  if (!a) return res.status(404).json({ message: "Not found" });

  if (items) {
    const { singleScore, doubleScore, singleLevel, doubleLevel, meta } =
      computeLevels(items);
    a.items = items;
    a.singleScore = singleScore;
    a.doubleScore = doubleScore;
    a.singleLevel = singleLevel;
    a.doubleLevel = doubleLevel;
    a.meta = meta;
  }
  if (typeof note === "string") a.note = note;
  await a.save();

  // Không tự động push Ranking/History khi sửa cũ (tuỳ bạn)
  return res.json(a);
}
