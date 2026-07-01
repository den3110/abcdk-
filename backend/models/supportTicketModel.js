import mongoose from "mongoose";

const { Schema } = mongoose;

const SUPPORT_CATEGORIES = [
  "account",
  "tournament",
  "payment",
  "technical",
  "report",
  "other",
];

const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"];

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
      index: true,
    },
    category: {
      type: String,
      enum: SUPPORT_CATEGORIES,
      default: "other",
      index: true,
    },
    priority: {
      type: String,
      enum: SUPPORT_PRIORITIES,
      default: "normal",
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: "" },

    userLastReadAt: { type: Date, default: null },
    staffLastReadAt: { type: Date, default: null },

    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    closeReason: { type: String, default: "", trim: true },

    ratingScore: { type: Number, min: 1, max: 5, default: null },
    ratingComment: { type: String, default: "", trim: true },
    ratedAt: { type: Date, default: null },

    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

SupportTicketSchema.index({ status: 1, lastMessageAt: -1 });
SupportTicketSchema.index({ category: 1, priority: 1, lastMessageAt: -1 });
SupportTicketSchema.index({ assignedTo: 1, status: 1, lastMessageAt: -1 });

export default mongoose.model("SupportTicket", SupportTicketSchema);
