// services/emailService.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const NODE_ENV = (process.env.NODE_ENV || "development").toLowerCase();
const IS_PROD = NODE_ENV === "production";

// ⚠️ GIỮ NGUYÊN FRONTEND_URL NHƯ BẠN ĐANG DÙNG
const FROM = process.env.EMAIL_FROM; // "PickleTour <contact@pickletour.vn>" hoặc email
const APP_NAME = process.env.APP_NAME || "PickleTour";
const FRONTEND_URL = IS_PROD ? process.env.HOST : "http://localhost:3000";

// (tuỳ chọn) nếu bạn muốn set name/email riêng lẻ
const FROM_EMAIL_ENV = process.env.EMAIL_FROM_EMAIL;
const FROM_NAME_ENV = process.env.EMAIL_FROM_NAME;

// ====== THEMING (có thể thay bằng ENV nếu muốn) ======
const BRAND_COLOR = process.env.EMAIL_BRAND_COLOR || "#1976d2";
const BG_COLOR = "#f6f8fb";
const CARD_BG = "#ffffff";
const TEXT_COLOR = "#1f2937";
const MUTED_COLOR = "#6b7280";
const BORDER_COLOR = "#e5e7eb";
const LOGO_URL = process.env.EMAIL_LOGO_URL || ""; // để trống thì dùng chữ

// ---- helpers ----
function parseFrom(raw, fallbackEmail, fallbackName) {
  if (raw && /<.+>/.test(raw)) {
    const m = raw.match(/^\s*"?([^"<]+?)"?\s*<\s*([^>]+)\s*>\s*$/);
    if (m) return { name: m[1].trim(), email: m[2].trim() };
  }
  if (raw && raw.includes("@")) {
    return { name: fallbackName || APP_NAME, email: raw.trim() };
  }
  if (fallbackEmail)
    return { name: fallbackName || APP_NAME, email: fallbackEmail };
  return { name: APP_NAME, email: "no-reply@pickletour.vn" };
}
const FROM_OBJ = parseFrom(FROM, FROM_EMAIL_ENV, FROM_NAME_ENV);

// SMTP Config (Hostinger)
// SMTP Config (Hostinger)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.hostinger.com",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export function initEmail() {
  // Verify connection configuration
  transporter.verify(function (error, success) {
    if (error) {
      console.error("❌ SMTP Connection Error:", error);
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn("⚠️  Hint: Check your .env for SMTP_USER and SMTP_PASS");
      }
    } else {
      console.log("✅ Server is ready to take our messages (SMTP)");
    }
  });
}

/**
 * Template email “đẹp” – inline styles để tương thích email client
 * @param {Object} opts
 * @param {string} opts.previewText  - preheader ẩn
 * @param {string} opts.heading      - tiêu đề lớn trong nội dung
 * @param {string} opts.bodyHtml     - nội dung chính (HTML)
 * @param {string} [opts.ctaText]    - text của nút
 * @param {string} [opts.ctaUrl]     - link của nút
 * @param {string} [opts.secondaryHtml] - đoạn note phụ (HTML)
 */
function renderEmail({
  previewText,
  heading,
  bodyHtml,
  ctaText,
  ctaUrl,
  secondaryHtml,
}) {
  const logoBlock = LOGO_URL
    ? `<img src="${LOGO_URL}" width="40" height="40" alt="${APP_NAME}" style="display:block;border:0;outline:none;border-radius:8px" />`
    : `<div style="display:inline-block;padding:8px 12px;background:${BRAND_COLOR};color:#fff;border-radius:10px;font-weight:700;letter-spacing:.2px">${
        APP_NAME[0] || "A"
      }</div>`;

  // Nút CTA “bulletproof” (đơn giản, inline)
  const ctaBlock =
    ctaText && ctaUrl
      ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px 0">
        <tr>
          <td align="center" bgcolor="${BRAND_COLOR}" style="border-radius:10px">
            <a href="${ctaUrl}"
               style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:600;border-radius:10px"
               target="_blank" rel="noopener">
              ${ctaText}
            </a>
          </td>
        </tr>
      </table>`
      : "";

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${APP_NAME}</title>
  <style>
    /* fallback, đa số client vẫn bỏ qua <style>, nên đã inline phần chính */
  </style>
</head>
<body style="margin:0;padding:0;background:${BG_COLOR}">
  <!-- Preheader (ẩn) -->
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;color:transparent">
    ${previewText || ""}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BG_COLOR};padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%">
          <!-- Header -->
          <tr>
            <td style="padding:8px 4px 16px 4px;text-align:left;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    ${logoBlock}
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:16px;font-weight:700;color:${TEXT_COLOR};line-height:1;margin:0">${APP_NAME}</div>
                    <div style="font-size:12px;color:${MUTED_COLOR};line-height:1.4;margin-top:4px">${
                      FROM_OBJ.email
                    }</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:${CARD_BG};border:1px solid ${BORDER_COLOR};border-radius:14px;padding:24px 22px">
              <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;color:${TEXT_COLOR}">${heading}</h1>

              <div style="font-size:14px;line-height:1.7;color:${TEXT_COLOR}">
                ${bodyHtml}
              </div>

              ${ctaBlock}

              ${
                secondaryHtml
                  ? `<div style="margin-top:14px;font-size:12px;color:${MUTED_COLOR};line-height:1.6">${secondaryHtml}</div>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 4px;text-align:center;color:${MUTED_COLOR};font-size:12px;line-height:1.6">
              © ${new Date().getFullYear()} ${APP_NAME}. Nếu bạn không yêu cầu thao tác này, bạn có thể bỏ qua email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendPasswordResetEmail({ to, token }) {
  const resetUrl = `${FRONTEND_URL}/reset-password/${encodeURIComponent(
    token,
  )}`;

  const html = renderEmail({
    previewText: "Đặt lại mật khẩu tài khoản của bạn.",
    heading: "Đặt lại mật khẩu",
    bodyHtml: `
      <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản <b>${to}</b>.</p>
      <p>Nhấn nút dưới đây để đặt lại (liên kết sẽ hết hạn sau <b>1 giờ</b>).</p>
    `,
    ctaText: "Đặt lại mật khẩu",
    ctaUrl: resetUrl,
    secondaryHtml: `Nếu nút không hoạt động, hãy mở liên kết này:<br/>
      <a href="${resetUrl}" style="color:${BRAND_COLOR};word-break:break-all">${resetUrl}</a>`,
  });

  const msg = {
    to,
    from: {
      name: FROM_OBJ.name,
      address: process.env.SMTP_USER || FROM_OBJ.email,
    }, // Using the auth user as sender address is safer for SMTP
    replyTo: FROM_OBJ.email,
    subject: `[${APP_NAME}] Đặt lại mật khẩu`,
    text: `Bạn nhận được email này vì đã yêu cầu đặt lại mật khẩu cho tài khoản ${to}.
Nhấp vào liên kết dưới đây để đặt lại mật khẩu (hết hạn sau 1 giờ):
${resetUrl}

Nếu không phải bạn yêu cầu, vui lòng bỏ qua email này.`,
    html,
  };

  try {
    await transporter.sendMail(msg);
    return { ok: true };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return { ok: false, error };
  }
}

export async function sendPasswordChangedEmail({ to }) {
  const html = renderEmail({
    previewText: "Mật khẩu của bạn vừa được thay đổi.",
    heading: "Mật khẩu đã được thay đổi",
    bodyHtml: `
      <p>Chúng tôi thông báo rằng mật khẩu cho tài khoản <b>${to}</b> vừa được thay đổi thành công.</p>
    `,
    secondaryHtml: `Nếu không phải bạn thực hiện, hãy <b>đổi lại mật khẩu</b> ngay và liên hệ hỗ trợ.`,
  });

  const msg = {
    to,
    from: { name: FROM_OBJ.name, address: "support@pickletour.vn" },
    replyTo: FROM_OBJ.email,
    subject: `Mật khẩu của bạn trên ${APP_NAME} đã được thay đổi`,
    text: `Mật khẩu cho tài khoản ${to} vừa được thay đổi. Nếu không phải bạn, hãy liên hệ hỗ trợ ngay lập tức.`,
    html,
  };

  try {
    await transporter.sendMail(msg);
    return { ok: true };
  } catch (error) {
    console.error("Error sending password changed email:", error);
    return { ok: false, error };
  }
}

// ⬇️ Thêm vào dưới cùng file services/emailService.js
export async function sendPasswordResetOtpEmail({
  to,
  otp,
  expiresInSec = 600,
}) {
  const mins = Math.max(1, Math.round(expiresInSec / 60));

  // Hiển thị OTP to rõ, cách chữ để chống đọc nhầm; giữ inline styles để tương thích client email
  const otpHtmlBlock = `
    <div style="
      display:inline-block;
      margin:12px 0 4px 0;
      padding:12px 18px;
      border:1px dashed ${BORDER_COLOR};
      border-radius:12px;
      background:#f1f5f9;
      font-size:28px;
      line-height:1;
      letter-spacing:10px;
      font-weight:800;
      color:${TEXT_COLOR};
    ">
      ${String(otp).replace(/\D/g, "").split("").join(" ")}
    </div>
  `;

  const html = renderEmail({
    previewText: `Mã OTP đặt lại mật khẩu của bạn là ${otp}. Hết hạn sau ${mins} phút.`,
    heading: "Mã OTP đặt lại mật khẩu",
    bodyHtml: `
      <p>Bạn đang yêu cầu đặt lại mật khẩu cho tài khoản <b>${to}</b>.</p>
      <p>Nhập mã OTP gồm <b>6 chữ số</b> dưới đây vào ứng dụng để tiếp tục (hết hạn sau <b>${mins} phút</b>):</p>
      ${otpHtmlBlock}
      <p style="margin-top:8px">Vì lý do bảo mật, <b>không chia sẻ</b> mã này cho bất kỳ ai.</p>
    `,
    // Không cần CTA button cho luồng OTP
    secondaryHtml: `Nếu bạn không yêu cầu thao tác này, bạn có thể bỏ qua email.`,
  });

  const msg = {
    to,
    from: { name: FROM_OBJ.name, address: "support@pickletour.vn" },
    replyTo: FROM_OBJ.email,
    subject: `[${APP_NAME}] Mã OTP đặt lại mật khẩu (${mins} phút)`,
    text: `Bạn đang yêu cầu đặt lại mật khẩu cho tài khoản ${to}.
Mã OTP của bạn là: ${otp}
Mã sẽ hết hạn sau ${mins} phút. Không chia sẻ mã này cho bất kỳ ai.

Nếu không phải bạn thực hiện, hãy bỏ qua email này.`,
    html,
  };

  try {
    await transporter.sendMail(msg);
    return { ok: true };
  } catch (error) {
    console.error("Error sending OTP email:", error);
    return { ok: false, error };
  }
}
