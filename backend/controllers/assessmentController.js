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

  // Người chấm có phải chính chủ không
  const selfScored = String(req.user?._id || "") === String(userId);

  // Gom các role lại (role, roles[], isAdmin)
  const rawRoles = [
    req.user?.role,
    ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
  ]
    .filter(Boolean)
    .map((r) => String(r).toLowerCase());

  const isAdmin = req.user?.isAdmin === true || rawRoles.includes("admin");

  const isMod = rawRoles.includes("mod") || rawRoles.includes("moderator");

  // scoreBy khớp với enum: ["admin", "mod", "moderator", "self"]
  let scoreBy = "self";
  if (isAdmin) {
    scoreBy = "admin";
  } else if (rawRoles.includes("moderator")) {
    scoreBy = "moderator";
  } else if (rawRoles.includes("mod")) {
    scoreBy = "mod";
  }

  const isStaff =
    scoreBy === "admin" || scoreBy === "mod" || scoreBy === "moderator";

  // Note hiển thị
  let finalNote = noteInput;
  if (scoreBy === "admin") {
    finalNote = "admin chấm điểm trình";
  } else if (scoreBy === "mod" || scoreBy === "moderator") {
    finalNote = "mod chấm điểm trình";
  }

  // === RULE CŨ: không cho tự chấm nếu user đã từng tham gia giải ===
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

  // === RULE MỚI:
  // Nếu user được chấm là role user
  // và đã từng có assessment meta.scoreBy ∈ ["admin", "mod", "moderator"]
  // thì user thường (scoreBy = "self") không được chấm nữa
  try {
    let isTargetNormalUser = true;

    const targetUser = await User.findById(userId).select("role roles isAdmin");

    if (targetUser) {
      const targetRoles = [
        targetUser.role,
        ...(Array.isArray(targetUser.roles) ? targetUser.roles : []),
      ]
        .filter(Boolean)
        .map((r) => String(r).toLowerCase());

      const targetIsAdmin =
        targetUser.isAdmin === true || targetRoles.includes("admin");
      const targetIsMod =
        targetRoles.includes("mod") || targetRoles.includes("moderator");

      // Nếu không phải admin/mod => coi là user thường
      isTargetNormalUser = !targetIsAdmin && !targetIsMod;
    }

    if (isTargetNormalUser && !isStaff) {
      const hasStaffAssessment = await Assessment.exists({
        user: userId,
        "meta.scoreBy": { $in: ["admin", "mod", "moderator"] },
      });

      if (hasStaffAssessment) {
        return res.status(403).json({
          message:
            "Người chơi này đã được mod/admin chấm điểm trước đó, bạn không thể chấm thêm nữa.",
        });
      }
    }
  } catch (e) {
    console.error("Check staff assessment failed:", e);
    // Có lỗi thì bỏ qua rule mới, tránh chặn nhầm
  }

  // === PHẦN TẠO ASSESSMENT GIỮ NGUYÊN ===
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
          meta: { ...metaInput, selfScored, scoreBy },
          note: finalNote,
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
          note: finalNote,
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
