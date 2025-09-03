// models/Evaluation.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Một bản chấm trình linh hoạt:
 * - rubric items (key/score/weight)
 * - tổng hợp singles/doubles
 * - ràng buộc evaluator chỉ được chấm user thuộc các tỉnh trong scope
 */
const EvaluationItemSchema = new Schema(
  {
    key: { type: String, required: true, trim: true }, // vd: forehand, backhand, serve, strategy,...
    score: { type: Number, required: true, min: 0, max: 10 },
    weight: { type: Number, default: 1 }, // cho phép weighting
    note: { type: String, default: "" },
  },
  { _id: false }
);

const EvaluationSchema = new Schema(
  {
    targetUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    evaluator: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // chấm theo tỉnh nào (freeze theo thời điểm chấm)
    province: { type: String, required: true, trim: true },

    // nguồn chấm (tuỳ chọn)
    source: {
      type: String,
      enum: ["live", "video", "tournament", "other"],
      default: "other",
    },

    // rubric linh hoạt
    items: { type: [EvaluationItemSchema], default: [] },

    // tổng hợp (tối giản – nếu bạn muốn map sang localRatings)
    overall: {
      singles: { type: Number, min: 2.0, max: 8.0 },
      doubles: { type: Number, min: 2.0, max: 8.0 },
    },

    notes: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "submitted", "finalized", "rejected"],
      default: "submitted",
    },

    // audit nhẹ
    finalizedAt: { type: Date },
  },
  { timestamps: true, strict: true }
);

/* ---------- Index gợi ý ---------- */
EvaluationSchema.index(
  { targetUser: 1, createdAt: -1 },
  { name: "idx_eval_target_recent" }
);
EvaluationSchema.index(
  { evaluator: 1, createdAt: -1 },
  { name: "idx_eval_evaluator_recent" }
);
EvaluationSchema.index(
  { province: 1, createdAt: -1 },
  { name: "idx_eval_province_recent" }
);

/* ---------- Helper ---------- */
EvaluationSchema.statics.assertCanGrade = async function (
  evaluatorId,
  targetUserId
) {
  const User = mongoose.model("User");
  const [evaluator, target] = await Promise.all([
    User.findById(evaluatorId).lean(),
    User.findById(targetUserId).lean(),
  ]);
  if (!evaluator || evaluator.role !== "evaluator") {
    throw new Error("Người chấm không hợp lệ hoặc không có role 'evaluator'.");
  }
  const allowed = (evaluator.gradingScopes?.provinces || []).includes(
    target?.province || ""
  );
  if (!allowed) {
    throw new Error("Evaluator không có quyền chấm người dùng thuộc tỉnh này.");
  }
  return { evaluator, target };
};

/**
 * Áp (commit) kết quả overall vào localRatings của user đích
 * - chỉ cho phép khi status = 'finalized'
 * - bạn có thể gọi chỗ service/controller sau khi duyệt
 */
EvaluationSchema.methods.applyToUserLocalRatings = async function () {
  if (this.status !== "finalized") {
    throw new Error("Chỉ áp kết quả khi Evaluation đã 'finalized'.");
  }
  const User = mongoose.model("User");
  const user = await User.findById(this.targetUser);
  if (!user) throw new Error("User không tồn tại.");

  if (this.overall?.singles != null) {
    user.localRatings.singles = this.overall.singles;
  }
  if (this.overall?.doubles != null) {
    user.localRatings.doubles = this.overall.doubles;
  }
  // có thể cập nhật reliability* nếu muốn
  await user.save();
  return user;
};

export default mongoose.model("Evaluation", EvaluationSchema);
