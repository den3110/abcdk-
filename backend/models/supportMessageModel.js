import mongoose from "mongoose";

const { Schema } = mongoose;

const AttachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    mime: { type: String, default: "image/jpeg" },
    name: { type: String, default: "" },
    size: { type: Number, default: 0 },
  },
  { _id: false },
);

const SupportMessageSchema = new Schema(
  {
    ticket: {
      type: Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
      index: true,
    },
    senderRole: {
      type: String,
      enum: ["user", "staff", "system"],
      required: true,
      index: true,
    },
    senderUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    visibility: {
      type: String,
      enum: ["public", "internal"],
      default: "public",
      index: true,
    },
    kind: {
      type: String,
      enum: ["message", "internal_note", "status"],
      default: "message",
    },
    text: { type: String, default: "", trim: true },
    attachments: { type: [AttachmentSchema], default: [] },

    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

SupportMessageSchema.index({ ticket: 1, createdAt: -1 });
SupportMessageSchema.index({ ticket: 1, visibility: 1, createdAt: 1 });

export default mongoose.model("SupportMessage", SupportMessageSchema);
