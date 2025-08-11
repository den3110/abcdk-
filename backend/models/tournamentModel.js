import mongoose from "mongoose";
import { DateTime } from "luxon";
const tournamentSchema = new mongoose.Schema(
  {
    /* Thông tin cơ bản */
    name: { type: String, required: true },
    image: {
      type: String,
      default: null,
      required: true,
    },
    sportType: { type: Number, required: true }, // 1 Pickleball, 2 Tennis …
    groupId: { type: Number, default: 0 },

    /* Cấu hình đăng ký & giới hạn điểm */
    regOpenDate: {
      type: Date,
      required: true,
      default: Date.now, // ✅ mặc định hôm nay
    },
    maxPairs: { type: Number, default: 0, min: 0 },
    registrationDeadline: {
      type: Date,
      required: true,
      default: Date.now, // ✅
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now, // ✅
    },
    endDate: {
      type: Date,
      required: true,
      default: Date.now, // ✅
    },
    eventType: {
      type: String,
      enum: ["single", "double"],
      default: "double",
    },
    scoreCap: { type: Number, required: true, default: 0 }, // Tổng điểm đôi
    scoreGap: { type: Number, required: true, default: 0 }, // Chênh lệch đôi
    singleCap: { type: Number, required: true, default: 0 }, // Điểm tối đa 1 VĐV

    /* Thống kê */
    // registered: { type: Number, default: 0 },
    expected: { type: Number, default: 0 },
    matchesCount: { type: Number, default: 0 },

    /* Trạng thái & mô tả */
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "finished"], // ✅ EN values
      default: "upcoming",
    },
    finishedAt: { type: Date, default: null },
    location: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contactHtml: { type: String, default: "" },
    contentHtml: { type: String, default: "" },
    timezone: { type: String, default: "Asia/Ho_Chi_Minh" },

    // Mốc chuẩn UTC để máy so sánh (đã quy đổi từ startDate/endDate + timezone)
    startAt: { type: Date, default: null }, // thường là startDate.startOf('day') theo TZ => UTC
    endAt: { type: Date, default: null }, // thường là endDate.endOf('day') theo TZ => UTC
  },
  { timestamps: true }
);

// helper chuẩn hóa mốc UTC từ field + timezone
function recomputeUTC(doc) {
  const tz = doc.timezone || "Asia/Ho_Chi_Minh";
  // Nếu bạn muốn “kết thúc theo hết ngày địa phương”, dùng endOf('day')
  // Nếu muốn “đúng giờ phút bạn nhập”, bỏ .endOf('day') và giữ nguyên.
  if (doc.startDate) {
    const s = DateTime.fromJSDate(doc.startDate)
      .setZone(tz)
      .startOf("day")
      .toUTC();
    doc.startAt = s.toJSDate();
  }
  if (doc.endDate) {
    const e = DateTime.fromJSDate(doc.endDate).setZone(tz).endOf("day").toUTC();
    doc.endAt = e.toJSDate();
  }
}

tournamentSchema.pre("save", function (next) {
  recomputeUTC(this);
  next();
});

// khi update bằng findOneAndUpdate
tournamentSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() || {};
  // nếu đổi timezone hoặc endDate/startDate thì tính lại endAt/startAt
  if (
    update.$set?.timezone ||
    update.$set?.endDate ||
    update.$set?.startDate ||
    update.timezone ||
    update.endDate ||
    update.startDate
  ) {
    // cần doc gốc để tính, ta sẽ làm sau update bằng hook post
    this.setOptions({ new: true }); // trả doc mới
  }
  next();
});

tournamentSchema.post("findOneAndUpdate", async function (doc, next) {
  try {
    if (!doc) return next();
    recomputeUTC(doc);
    await doc.save();
    next();
  } catch (e) {
    next(e);
  }
});

tournamentSchema.index({ status: 1, endAt: 1 }); // scan nhanh giải đã quá hạn
// (tuỳ chọn) index cho chuyển ongoing
tournamentSchema.index({ status: 1, startAt: 1 });

export default mongoose.model("Tournament", tournamentSchema);
