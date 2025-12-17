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
    },

    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: "" },

    // read markers (để sau này bạn làm badge “chưa đọc”)
    userLastReadAt: { type: Date, default: null },
    staffLastReadAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("SupportTicket", SupportTicketSchema);
