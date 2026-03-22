// models/courtModel.js
import mongoose from "mongoose";
const { Schema, Types } = mongoose;

const manualAssignmentItemSchema = new Schema(
  {
    matchId: { type: Types.ObjectId, ref: "Match", required: true },
    order: { type: Number, default: 0 },
    state: {
      type: String,
      enum: ["pending", "done", "skipped"],
      default: "pending",
    },
    actedAt: { type: Date, default: null },
  },
  { _id: false }
);

const manualAssignmentSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    bracketId: { type: Types.ObjectId, ref: "Bracket", default: null },
    fallbackToAuto: { type: Boolean, default: true },
    items: { type: [manualAssignmentItemSchema], default: [] },
    updatedBy: { type: Types.ObjectId, ref: "User", default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const courtSchema = new Schema(
  {
    tournament: {
      type: Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    name: { type: String, required: true },

    cluster: { type: String, default: "Main", index: true },
    bracket: {
      type: Types.ObjectId,
      ref: "Bracket",
      required: false,
      default: null,
      index: true,
    },

    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["idle", "assigned", "live", "maintenance"],
      default: "idle",
    },
    currentMatch: { type: Types.ObjectId, ref: "Match", default: null },

    /* LIVE per-court */
    liveConfig: {
      enabled: { type: Boolean, default: false },
      videoUrl: { type: String, default: "" },
      overrideExisting: { type: Boolean, default: false },

      // ⚙️ Cấu hình nâng cao
      advancedSettingEnabled: { type: Boolean, default: false },

      // "default" = live theo page hệ thống, "custom" = page tự chọn
      pageMode: {
        type: String,
        enum: ["default", "custom"],
        default: "default",
      },

      // Id Page trong FacebookPageConnection (pageId)
      pageConnectionId: { type: String, default: null },

      // Tên Page để hiển thị (cache, auto-fill từ FacebookPageConnection)
      pageConnectionName: { type: String, default: "" },

      // Payload gọn cho mấy service khác xài
      // ví dụ: { mode: "default" } hoặc { mode: "custom", pageConnectionId: "xxx" }
      advancedSetting: { type: Schema.Types.Mixed, default: null },
    },

    defaultReferees: [
      { type: Types.ObjectId, ref: "User", default: undefined },
    ],

    manualAssignment: {
      type: manualAssignmentSchema,
      default: () => ({
        enabled: false,
        bracketId: null,
        fallbackToAuto: true,
        items: [],
        updatedBy: null,
        updatedAt: null,
      }),
    },
  },
  { timestamps: true }
);

courtSchema.index({ tournament: 1, status: 1, cluster: 1 });
courtSchema.index({ tournament: 1, isActive: 1, status: 1, order: 1 });
courtSchema.index({ tournament: 1, currentMatch: 1 });

export default mongoose.model("Court", courtSchema);
