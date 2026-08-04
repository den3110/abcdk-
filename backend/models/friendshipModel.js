// models/friendshipModel.js
// Quan hệ bạn bè giữa 2 user. 1 document duy nhất giữa cặp (A,B),
// với status pending → accepted / declined / blocked.
import mongoose from "mongoose";

const { Schema } = mongoose;

const friendshipSchema = new Schema(
  {
    requester: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    addressee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "blocked"],
      default: "pending",
      index: true,
    },
    acceptedAt: { type: Date, default: null },
    // Ai chặn ai (dùng khi status=blocked)
    blockedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Đảm bảo không tồn tại 2 record cùng cặp (theo cả 2 hướng).
// requester + addressee đã hardcoded phía controller là sorted khi tra cứu.
friendshipSchema.index(
  { requester: 1, addressee: 1 },
  { unique: true }
);
friendshipSchema.index({ addressee: 1, status: 1 });
friendshipSchema.index({ requester: 1, status: 1 });

const Friendship =
  mongoose.models.Friendship ||
  mongoose.model("Friendship", friendshipSchema);

export default Friendship;
