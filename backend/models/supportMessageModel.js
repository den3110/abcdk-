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
    ticket: { type: Schema.Types.ObjectId, ref: "SupportTicket", required: true, index: true },

    senderRole: { type: String, enum: ["user", "staff"], required: true },
    senderUser: { type: Schema.Types.ObjectId, ref: "User", default: null },

    text: { type: String, default: "", trim: true },
    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("SupportMessage", SupportMessageSchema);
