// models/playInviteModel.js
// "Tìm bạn đánh" — lời mời giao lưu pickleball. Người chơi đăng kèo (địa điểm,
// giờ, trình mong muốn, số người cần), người khác xin tham gia, chủ kèo duyệt.
import mongoose from "mongoose";

const { Schema } = mongoose;

export const PLAY_STATUSES = ["open", "full", "closed", "cancelled", "done"];
export const JOIN_STATUSES = ["pending", "accepted", "declined"];

const participantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: JOIN_STATUSES, default: "pending" },
    note: { type: String, default: "", maxlength: 300 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const playInviteSchema = new Schema(
  {
    host: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "", trim: true, maxlength: 140 },
    note: { type: String, default: "", maxlength: 2000 },

    // Địa điểm
    province: { type: String, default: "", trim: true, maxlength: 80, index: true },
    district: { type: String, default: "", trim: true, maxlength: 80 },
    courtName: { type: String, default: "", trim: true, maxlength: 160 },

    // Thời gian chơi
    playAt: { type: Date, required: true, index: true },
    durationMin: { type: Number, default: 90 },

    // Trình mong muốn (điểm trình DUPR-like). null = mọi trình.
    skillMin: { type: Number, default: null },
    skillMax: { type: Number, default: null },

    // Số người cần THÊM (ngoài chủ kèo)
    slots: { type: Number, default: 1, min: 1, max: 50 },

    contactPhone: { type: String, default: "", trim: true, maxlength: 20 },

    participants: { type: [participantSchema], default: [] },
    acceptedCount: { type: Number, default: 0 },

    status: { type: String, enum: PLAY_STATUSES, default: "open", index: true },
  },
  { timestamps: true }
);

playInviteSchema.index({ status: 1, playAt: 1 });
playInviteSchema.index({ province: 1, status: 1, playAt: 1 });

const PlayInvite =
  mongoose.models.PlayInvite || mongoose.model("PlayInvite", playInviteSchema);

export default PlayInvite;
