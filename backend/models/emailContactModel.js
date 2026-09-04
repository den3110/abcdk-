// models/emailContactModel.js
// Một liên hệ trong danh sách khách hàng: email + tên + avatar + phone.
import mongoose from "mongoose";

const { Schema } = mongoose;

const emailContactSchema = new Schema(
  {
    list: {
      type: Schema.Types.ObjectId,
      ref: "EmailContactList",
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: "", trim: true },
    avatar: { type: String, default: "" },
    phone: { type: String, default: "", trim: true },
    extId: { type: String, default: "" }, // id/code từ nguồn (vd PickVN)
    optOut: { type: Boolean, default: false, index: true },
    optOutAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Không trùng email trong cùng 1 danh sách
emailContactSchema.index({ list: 1, email: 1 }, { unique: true });

const EmailContact =
  mongoose.models.EmailContact ||
  mongoose.model("EmailContact", emailContactSchema);

export default EmailContact;
