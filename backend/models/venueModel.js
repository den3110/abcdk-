import mongoose from "mongoose";

const { Schema } = mongoose;

/* Toạ độ địa điểm (tái dùng pattern locationGeo của tournament) */
const LocationGeoSchema = new Schema(
  {
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    displayName: { type: String, default: "" },
  },
  { _id: false },
);

/* Giờ mở cửa theo từng ngày trong tuần (0 = Chủ nhật … 6 = Thứ 7) */
const DayHoursSchema = new Schema(
  {
    closed: { type: Boolean, default: false },
    open: { type: String, default: "06:00" }, // "HH:MM"
    close: { type: String, default: "22:00" }, // "HH:MM"
  },
  { _id: false },
);

function defaultWeekHours() {
  return Array.from({ length: 7 }, () => ({
    closed: false,
    open: "06:00",
    close: "22:00",
  }));
}

/**
 * Venue = cụm sân / địa điểm do "chủ sân" (courtOwner) quản lý.
 * Độc lập hoàn toàn với Tournament/Court hiện có.
 */
const venueSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    managers: [{ type: Schema.Types.ObjectId, ref: "User" }],

    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true, index: true },
    description: { type: String, default: "" },
    phone: { type: String, default: "" },

    address: { type: String, default: "" },
    province: { type: String, default: "", index: true },
    locationGeo: { type: LocationGeoSchema, default: () => ({}) },

    images: { type: [String], default: [] },
    amenities: { type: [String], default: [] },
    sport: { type: String, default: "pickleball" },

    // Giờ mở mặc định của cụm; sân con kế thừa nếu không override
    openHours: { type: [DayHoursSchema], default: defaultWeekHours },
    // Bước đặt tối thiểu (phút) cho lưới giờ
    slotMinutes: { type: Number, default: 60, min: 15, max: 240 },

    // Giá mặc định/giờ (fallback nếu sân không có bảng giá riêng)
    defaultPricePerHour: { type: Number, default: 0, min: 0 },

    // Thông tin nhận thanh toán (QR chuyển khoản — giống đăng ký giải)
    // bankShortName = tên ngân hàng tương thích SePay/VietQR (vd "Vietcombank", "MBBank")
    // bankCode = mã ngắn (vd VCB, MB) để tra logo phía app
    bankShortName: { type: String, trim: true, default: "" },
    bankCode: { type: String, trim: true, default: "" },
    bankAccountNumber: {
      type: String,
      default: "",
      set: (v) => String(v || "").replace(/\D/g, ""),
    },
    bankAccountName: { type: String, trim: true, default: "", maxlength: 64 },
    // % đặt cọc khi đặt sân (0 = không yêu cầu cọc)
    depositPercent: { type: Number, default: 0, min: 0, max: 100 },

    // Chính sách huỷ: khách được tự huỷ đến trước giờ chơi bao nhiêu tiếng
    // (0 = luôn cho huỷ). Huỷ trễ hơn -> phải liên hệ chủ sân.
    cancelPolicy: {
      hoursBefore: { type: Number, default: 0, min: 0, max: 168 },
      note: { type: String, default: "", maxlength: 300 },
    },

    // Hoa hồng nền tảng (%) tính trên doanh thu đã thu (đối soát)
    commissionPercent: { type: Number, default: 0, min: 0, max: 100 },

    status: {
      type: String,
      enum: ["active", "pending", "suspended"],
      default: "active",
    },
    isActive: { type: Boolean, default: true },
  
    /**
     * Chủ sân đã liên kết tài khoản Imou. Metadata thôi (SĐT + linkedAt) — password/session
     * lưu ở field khác (imouCreds/imouSession, mã hoá AES-GCM).
     */
    imouAccount: {
      phone: String,
      areaCode: { type: String, default: "84" },
      linkedAt: Date,
      lastCheckedAt: Date,
    },
    /**
     * Imou session tokens (encrypted AES-GCM qua encryptToken/decryptToken, đã có sẵn
     * trong services/secret.service.js). Owner-app upload sau ImouNative.login().
     * Format: encryptToken(JSON({ uuidUser, uuidKey, sessionId, regionalHost, apiVer })).
     * TTL Imou ~24-72h → refresh khi native emit sessionExpired (12002).
     */
    imouSession: {
      cipher: String,
      updatedAt: Date,
    },
    /**
     * Imou credentials encrypted — để owner-app tự relogin khi session hết hạn.
     * Backend KHÔNG dùng credentials; chỉ owner-app native đọc + login lại.
     */
    imouCreds: {
      cipher: String,
      updatedAt: Date,
    },
    /**
     * Tự duyệt yêu cầu cắt clip NGOÀI khung giờ khách đặt. true = không cần chủ sân
     * duyệt tay (yêu cầu ngoài giờ vào thẳng hàng đợi xử lý). Mặc định false.
     */
    clipAutoApprove: { type: Boolean, default: false },
    /**
     * Đầu thu Dahua/DMSS truy cập TỪ XA qua P2P (serial + mật khẩu, không cần
     * port-forward/VPN). Dùng làm nguồn auto-live. Mật khẩu mã hoá AES-GCM
     * (encryptToken/decryptToken). GIỚI HẠN: đầu thu ~1 phiên P2P/lúc → 1 cam/lúc.
     * Xem scripts/dahua-p2p/README-PICKLETOUR.md.
     */
    dahuaNvr: {
      serial: { type: String, default: "" },
      username: { type: String, default: "admin" },
      channels: { type: Number, default: 8 }, // số kênh (cam) trong đầu thu
      credCipher: String, // encryptToken(password)
      // Địa chỉ RTSP TRỰC TIẾP (LAN hoặc DDNS+cổng, vd "picapo-qt.smartddns.tv:8554"
      // hoặc "192.168.1.10:554"). Có → auto-live kéo RTSP thẳng (KHÔNG qua P2P/relay
      // → full bitrate, ổn định). Rỗng → fallback P2P tunnel.
      directHost: { type: String, default: "" },
      updatedAt: Date,
    },
  },
  { timestamps: true },
);

venueSchema.index({ province: 1, isActive: 1 });
venueSchema.index({ owner: 1, createdAt: -1 });

venueSchema.pre("save", function normalizeSlug(next) {
  if (!this.slug && this.name) {
    this.slug = String(this.name)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }
  next();
});

export default mongoose.model("Venue", venueSchema);
