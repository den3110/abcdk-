import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Sự kiện "xé vé" / đánh social do chủ sân tạo. Người chơi đăng ký (mua vé) theo suất.
 * Quản lý doanh thu, điểm trình, số lượng, giới tính.
 */
const venueEventSchema = new Schema(
  {
    venue: { type: Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    court: { type: Schema.Types.ObjectId, ref: "VenueCourt", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", maxlength: 2000 },
    coverImage: { type: String, default: "" },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },

    capacity: { type: Number, default: 12, min: 1, max: 500 }, // số suất tối đa
    price: { type: Number, default: 0, min: 0 }, // giá vé / người

    // Điểm trình yêu cầu (0 = không giới hạn). skillType chọn loại điểm để đối chiếu.
    skillType: { type: String, enum: ["double", "single", "mix"], default: "double" },
    skillMin: { type: Number, default: 0, min: 0 },
    skillMax: { type: Number, default: 0, min: 0 },

    // Chính sách giới tính: any = không giới hạn; male/female = chỉ 1 giới; balanced = giới hạn theo quota
    genderPolicy: { type: String, enum: ["any", "male", "female", "balanced"], default: "any" },
    maleQuota: { type: Number, default: 0, min: 0 }, // dùng khi balanced (0 = không cap)
    femaleQuota: { type: Number, default: 0, min: 0 },

    // Thanh toán: online (QR + bill) hoặc onsite (trả tại sân, chủ đánh dấu đã thu)
    paymentMode: { type: String, enum: ["online", "onsite"], default: "online" },

    status: { type: String, enum: ["open", "closed", "cancelled"], default: "open", index: true },
  },
  { timestamps: true },
);

venueEventSchema.index({ venue: 1, startAt: -1 });
venueEventSchema.index({ status: 1, startAt: 1 });

export default mongoose.model("VenueEvent", venueEventSchema);
