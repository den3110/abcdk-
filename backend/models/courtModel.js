import mongoose from "mongoose";
const { Schema, Types } = mongoose;

const courtSchema = new Schema(
  {
    tournament: {
      type: Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    name: { type: String, required: true },

    // Giữ cluster để scheduler dùng nội bộ, mặc định “Main”
    cluster: { type: String, default: "Main", index: true },

    // KHÔNG BẮT BUỘC nữa (để tương thích chỗ code cũ có populate vẫn ổn)
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
    },
  },
  { timestamps: true }
);

// ➜ Mỗi GIẢI (tournament) không được trùng tên sân
courtSchema.index(
  { tournament: 1, name: 1 },
  { unique: true, partialFilterExpression: { name: { $type: "string" } } }
);

export default mongoose.model("Court", courtSchema);
