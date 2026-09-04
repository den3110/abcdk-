// models/emailContactListModel.js
// Danh sách khách hàng (tệp email) để gửi chiến dịch — ví dụ "Khách hàng PickVN".
import mongoose from "mongoose";

const { Schema } = mongoose;

const emailContactListSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    source: { type: String, default: "", trim: true }, // tên file / ghi chú nguồn
    contactCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

emailContactListSchema.index({ createdAt: -1 });

const EmailContactList =
  mongoose.models.EmailContactList ||
  mongoose.model("EmailContactList", emailContactListSchema);

export default EmailContactList;
