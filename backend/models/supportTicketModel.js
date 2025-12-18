import mongoose from "mongoose";
const { Schema } = mongoose;

const SupportTicketSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "Hỗ trợ", trim: true },
    status: {
      type: String,
      enum: ["open", "pending", "closed"],
      default: "open",
      index: true, // ✅ Thêm index để query nhanh
    },
    lastMessageAt: { type: Date, default: Date.now, index: true }, // ✅ Index để sort
    lastMessagePreview: { type: String, default: "" },
    
    // read markers
    userLastReadAt: { type: Date, default: null },
    staffLastReadAt: { type: Date, default: null },
    
    // ✅ Thêm meta để lưu thông tin thêm
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// ✅ Index compound để query tickets open/pending hiệu quả
SupportTicketSchema.index({ status: 1, lastMessageAt: -1 });

export default mongoose.model("SupportTicket", SupportTicketSchema);