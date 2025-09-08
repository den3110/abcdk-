// models/Subscription.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const subscriptionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    topicType: {
      type: String,
      enum: ["tournament", "match", "club", "org", "global"],
      required: true,
      index: true,
    },
    topicId: { type: Schema.Types.ObjectId, default: null, index: true }, // null cho "global"
    muted: { type: Boolean, default: false, index: true },
    // có thể mở rộng: categories: ["schedule","result","news"] để user lọc sâu hơn
  },
  { timestamps: true }
);

// 1 user chỉ có 1 bản ghi cho cùng topic
subscriptionSchema.index(
  { user: 1, topicType: 1, topicId: 1 },
  { unique: true }
);

export default mongoose.models.Subscription ||
  mongoose.model("Subscription", subscriptionSchema);
