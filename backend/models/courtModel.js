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

    cluster: { type: String, default: "Main", index: true },
    bracket: {
      type: Types.ObjectId,
      ref: "Bracket",
      required: true,
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

    /* 🔴 NEW: cấu hình LIVE theo sân */
    liveConfig: {
      enabled: { type: Boolean, default: false }, // bật/tắt auto dùng link LIVE này cho sân
      videoUrl: { type: String, default: "" }, // URL LIVE mặc định của sân
      overrideExisting: { type: Boolean, default: false }, // true: cho phép ghi đè match.video (nếu sau này dùng)
    },
  },
  { timestamps: true }
);

// Mỗi bracket trong 1 tournament không được trùng tên sân
courtSchema.index({ tournament: 1, bracket: 1, name: 1 }, { unique: true });

export default mongoose.model("Court", courtSchema);
