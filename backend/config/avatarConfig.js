// config/avatarConfig.js

export const avatarConfig = {
  // Giới hạn dung lượng upload (multer check trước)
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB

  // Giới hạn tổng pixel để tránh ảnh khổng lồ ăn hết RAM
  MAX_INPUT_PIXELS: 40_000_000, // vd ~8000 x 5000

  // Đường dẫn logo PNG (nền trong suốt)
  LOGO_PATH: "assets/logo.png",

  // Đường dẫn avatar mặc định dùng khi mọi thứ khác hỏng
  DEFAULT_AVATAR_PATH: "assets/default-avatar.jpg",

  // Output format ưu tiên
  OUTPUT_FORMAT: "jpeg", // "jpeg" | "png" | "webp"

  JPEG_QUALITY: 90,
  WEBP_QUALITY: 90,
  PNG_COMPRESSION_LEVEL: 9,

  // Tỉ lệ logo so với cạnh ngắn
  LOGO_RATIO: 0.14, // ~14% cạnh ngắn, nhìn rõ hơn nhưng không lấn
  LOGO_MIN: 28, // logo tối thiểu 28px cho ảnh nhỏ
  LOGO_MAX: 150, // clamp cho ảnh siêu to, không phình quá
  LOGO_CORNER_RADIUS_RATIO: 0.25,
  // Padding logo
  PADDING_RATIO: 0.04, // 4% cạnh ngắn
  PADDING_MIN: 4,

  // Cho phép mimetype nào (chỉ để cảnh báo, không block cứng)
  ALLOWED_MIME_PREFIX: "image/",

  // Không xử lý animated, lấy frame đầu (chuẩn cho avatar)
  HANDLE_ANIMATED: false,
};
