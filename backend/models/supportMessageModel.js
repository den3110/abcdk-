import mongoose from "mongoose";
const { Schema } = mongoose;

const AttachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    mime: { type: String, default: "image/jpeg" },
    name: { type: String, default: "" },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const SupportMessageSchema = new Schema(
  {
    ticket: { 
      type: Schema.Types.ObjectId, 
      ref: "SupportTicket", 
      required: true, 
      index: true 
    },
    senderRole: { 
      type: String, 
      enum: ["user", "staff"], 
      required: true,
      index: true, // ✅ Index để query theo role
    },
    senderUser: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      default: null 
    },
    text: { type: String, default: "", trim: true },
    attachments: { type: [AttachmentSchema], default: [] },
    
    // ✅ Thêm meta để lưu info Telegram admin
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// ✅ Index compound cho query messages của ticket
SupportMessageSchema.index({ ticket: 1, createdAt: -1 });

export default mongoose.model("SupportMessage", SupportMessageSchema);