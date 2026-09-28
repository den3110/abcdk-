import mongoose from "mongoose";

/**
 * Tài khoản hộp thư (webmail trong admin). Mỗi doc = 1 địa chỉ @pickletour.vn.
 * Mật khẩu lưu mã hoá at-rest bằng secret.service (encryptToken) — field passCipher.
 */
const mailboxAccountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    label: { type: String, default: "" }, // tên hiển thị trong sidebar admin
    fromName: { type: String, default: "" }, // tên người gửi khi soạn thư

    // IMAP (đọc thư)
    imapHost: { type: String, default: "imap.hostinger.com" },
    imapPort: { type: Number, default: 993 },
    imapSecure: { type: Boolean, default: true },

    // SMTP (gửi thư)
    smtpHost: { type: String, default: "smtp.hostinger.com" },
    smtpPort: { type: Number, default: 465 },
    smtpSecure: { type: Boolean, default: true },

    // Đăng nhập (username thường = email). 1 mật khẩu dùng chung IMAP + SMTP (Hostinger).
    username: { type: String, default: "" },
    passCipher: { type: String, default: "" }, // encryptToken(password)

    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

const MailboxAccount = mongoose.model("MailboxAccount", mailboxAccountSchema);

export default MailboxAccount;
