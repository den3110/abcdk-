import mongoose from "mongoose";
import crypto from "crypto";

const { Schema } = mongoose;

/** 1 suất đăng ký (vé) của user cho 1 sự kiện. */
const eventRegistrationSchema = new Schema(
  {
    event: { type: Schema.Types.ObjectId, ref: "VenueEvent", required: true, index: true },
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },

    code: { type: String, default: "", index: true },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    gender: { type: String, enum: ["male", "female", "unspecified", "other"], default: "unspecified" },
    skillPoint: { type: Number, default: 0 }, // snapshot điểm trình lúc đăng ký
    note: { type: String, default: "", maxlength: 300 },

    price: { type: Number, default: 0 },
    status: { type: String, enum: ["registered", "cancelled"], default: "registered", index: true },
    createdByRole: { type: String, enum: ["customer", "owner"], default: "customer" },

    payment: {
      status: { type: String, enum: ["Unpaid", "Paid"], default: "Unpaid" },
      method: { type: String, default: "bank_qr" },
      proofUrl: { type: String, default: "" },
      proofAt: { type: Date, default: null },
      paidAt: { type: Date, default: null },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },

    ticket: {
      token: { type: String, default: "", index: true },
      checkedInAt: { type: Date, default: null },
      checkedInBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
  },
  { timestamps: true },
);

eventRegistrationSchema.index({ event: 1, user: 1 }, { unique: true, partialFilterExpression: { user: { $type: "objectId" } } });
eventRegistrationSchema.index({ event: 1, status: 1 });

eventRegistrationSchema.pre("save", function genCodeToken(next) {
  if (!this.code) this.code = "SK" + Date.now().toString(36).slice(-6).toUpperCase();
  if (!this.ticket.token) this.ticket.token = crypto.randomBytes(16).toString("hex");
  next();
});

export default mongoose.model("EventRegistration", eventRegistrationSchema);
