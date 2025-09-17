// controllers/assessmentController.js
import mongoose from "mongoose";
import Assessment from "../models/assessmentModel.js";
import Ranking from "../models/rankingModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import { normalizeDupr, rawFromDupr, sanitizeMeta } from "../utils/level.js";
import Registration from "../models/registrationModel.js";

/**
 * POST /api/assessments/:userId
 * Body (đơn giản):
 * {
 *   singleLevel: number,      // 2.000..8.000
 *   doubleLevel: number,      // 2.000..8.000
 *   meta?: { freq?:0..5, competed?:bool, external?:0..10 },
 *   note?: string
 * }
 * -> { assessment, ranking }
 */
export async function createAssessment(req, res) {
  const { userId } = req.params;
  const body = req.body || {};
  const noteInput = typeof body.note === "string" ? body.note : "";

  let sLv = Number(body.singleLevel ?? body.doubleLevel);
  let dLv = Number(body.doubleLevel ?? body.singleLevel);

  if (Number.isNaN(sLv) || Number.isNaN(dLv)) {
    return res
      .status(400)
      .json({ message: "singleLevel/doubleLevel phải là số" });
  }

  sLv = normalizeDupr(sLv);
  dLv = normalizeDupr(dLv);

  const singleScore = rawFromDupr(sLv);
  const doubleScore = rawFromDupr(dLv);

  const metaInput = sanitizeMeta(body.meta);

  // Xác định selfScored (người chấm === chính chủ)
  const selfScored = String(req.user?._id || "") === String(userId);

  // Xác định quyền admin (linh hoạt theo các cách lưu role)
  const isAdmin =
    !!req.user &&
    (req.user.role === "admin" ||
      req.user.isAdmin === true ||
      (Array.isArray(req.user.roles) && req.user.roles.includes("admin")));

  // Theo yêu cầu:
  // - Admin => scoreBy = "admin", note = "admin chấm điểm trình"
  // - Không phải admin => scoreBy = "self", note giữ nguyên
  const scoreBy = isAdmin ? "admin" : "self";
  const finalNote = isAdmin ? "admin chấm điểm trình" : noteInput;

  // (Giữ nguyên) Không cho TỰ CHẤM nếu user đã từng tham gia giải
  if (selfScored) {
    try {
      const participated = await Registration.hasParticipated(userId);
      if (participated) {
        return res.status(403).json({
          message:
            "Bạn đã có điểm trình trên hệ thống, vui lòng liên hệ Admin để hỗ trợ thêm.",
        });
      }
    } catch (e) {
      console.error("Participation check failed:", e);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const [assessment] = await Assessment.create(
      [
        {
          user: userId,
          scorer: req.user?._id || null,
          items: [],
          singleScore,
          doubleScore,
          singleLevel: sLv,
          doubleLevel: dLv,
          meta: { ...metaInput, selfScored, scoreBy }, // <= cập nhật theo role
          note: finalNote, // <= ghi đè nếu admin
          scoredAt: new Date(),
        },
      ],
      { session }
    );

    const ranking = await Ranking.findOneAndUpdate(
      { user: userId },
      {
        $set: { single: sLv, double: dLv, lastUpdated: new Date() },
        $inc: {
          points:
            (metaInput.freq || 0) +
            (metaInput.competed ? 1 : 0) +
            (metaInput.external || 0) / 10,
        },
      },
      { upsert: true, new: true, session }
    );

    await ScoreHistory.create(
      [
        {
          user: userId,
          scorer: req.user?._id || null,
          single: sLv,
          double: dLv,
          note: finalNote, // <= ghi đè nếu admin
          scoredAt: new Date(),
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();
    return res.json({ assessment, ranking });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ message: e.message || "Create failed" });
  }
}

/** GET /api/assessments/:userId/latest */
export async function getLatestAssessment(req, res) {
  const { userId } = req.params;
  const a = await Assessment.findOne({ user: userId })
    .sort({ scoredAt: -1 })
    .lean();
  return res.json(a || null);
}

/** GET /api/assessments/:userId/history?limit=20 */
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
 * OPTIONAL: PUT /api/assessments/:id
 * Cho phép sửa level/note (không dùng trọng số/items nữa)
 * Body hỗ trợ:
 *  - singleLevel?, doubleLevel?, meta?, note?
 */
export async function updateAssessment(req, res) {
  const { id } = req.params;
  const body = req.body || {};

  const a = await Assessment.findById(id);
  if (!a) return res.status(404).json({ message: "Not found" });

  let needRecalc = false;

  if (body.singleLevel !== undefined) {
    const v = Number(body.singleLevel);
    if (Number.isNaN(v))
      return res.status(400).json({ message: "singleLevel phải là số" });
    a.singleLevel = normalizeDupr(v);
    a.singleScore = rawFromDupr(a.singleLevel);
    needRecalc = true;
  }
  if (body.doubleLevel !== undefined) {
    const v = Number(body.doubleLevel);
    if (Number.isNaN(v))
      return res.status(400).json({ message: "doubleLevel phải là số" });
    a.doubleLevel = normalizeDupr(v);
    a.doubleScore = rawFromDupr(a.doubleLevel);
    needRecalc = true;
  }
  if (body.meta) {
    a.meta = { ...a.meta, ...sanitizeMeta(body.meta) };
  }
  if (typeof body.note === "string") {
    a.note = body.note;
  }

  await a.save();
  return res.json(a);
}
