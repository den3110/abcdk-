// models/Complaint.js  (ESM)
import mongoose, { Schema, Types } from "mongoose";

const ComplaintSchema = new Schema(
  {
    tournament: {
      type: Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    registration: {
      type: Types.ObjectId,
      ref: "Registration",
      required: true,
      index: true,
    },
    createdBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "rejected"],
      default: "open",
      index: true,
    },
    managerNotes: { type: String, trim: true, maxlength: 4000 },
  },
  { timestamps: true }
);

export default mongoose.models.Complaint ||
  mongoose.model("Complaint", ComplaintSchema);
