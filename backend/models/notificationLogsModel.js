// models/NotificationLog.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const notificationLogSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    eventKey: { type: String, index: true, required: true }, // ví dụ: "tournament.countdown:D-1:tour#<id>"
    meta: { type: Object, default: {} },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// 1 user chỉ nhận 1 lần cho cùng eventKey
notificationLogSchema.index({ user: 1, eventKey: 1 }, { unique: true });

export default mongoose.models.NotificationLog ||
  mongoose.model("NotificationLog", notificationLogSchema);
