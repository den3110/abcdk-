import mongoose from "mongoose";

const { Schema } = mongoose;

const courtClusterSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    description: { type: String, default: "", trim: true },
    venueName: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    color: { type: String, default: "", trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

courtClusterSchema.index({ isActive: 1, order: 1, name: 1 });

export default mongoose.model("CourtCluster", courtClusterSchema);
