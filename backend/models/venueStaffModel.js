import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Nhân viên / quản lý của 1 cụm sân — mỗi bản ghi = 1 user PickleTour được cấp quyền.
 * role "manager" = toàn quyền (được đồng bộ vào Venue.managers để tương thích canManageVenue).
 * role "cashier"/"staff" = quyền theo mảng permissions.
 */
const venueStaffSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["manager", "cashier", "staff"], default: "staff" },
    permissions: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    note: { type: String, default: "", maxlength: 200 },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

venueStaffSchema.index({ venue: 1, user: 1 }, { unique: true });

export default mongoose.model("VenueStaff", venueStaffSchema);
