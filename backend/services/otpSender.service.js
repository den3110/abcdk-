// services/otpSender.service.js
// Gửi OTP có rate-limit + ghi nhật ký (OtpLog). Dùng chung cho đăng ký + kích hoạt SĐT.
//   - Tối đa 3 lần / ngày / SĐT (đếm lần gửi thành công)
//   - Mỗi lần cách nhau tối thiểu 60 giây (tính từ lần gửi gần nhất, mọi trạng thái)
import OtpLog from "../models/otpLogModel.js";
import { sendZaloZnsOtp } from "./zaloZns.service.js";

export const OTP_MAX_PER_DAY = 3;
export const OTP_MIN_INTERVAL_MS = 60 * 1000;

export function normalizeTo84(phone = "") {
  let s = String(phone).trim().replace(/\s+/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[^\d]/g, "");
  if (s.startsWith("0")) return "84" + s.slice(1);
  if (s.startsWith("84")) return s;
  return s;
}

export function genOtp6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Kiểm tra rate-limit theo SĐT (chuẩn 84...).
 * @returns {Promise<{ok:boolean, reason?:string, waitSec?:number, message?:string, todayCount?:number}>}
 */
export async function checkOtpRateLimit(phone84) {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayCount = await OtpLog.countDocuments({
    phone: phone84,
    status: "success",
    createdAt: { $gte: startOfDay },
  });
  if (todayCount >= OTP_MAX_PER_DAY) {
    return {
      ok: false,
      reason: "daily",
      todayCount,
      message: `Bạn đã gửi OTP quá ${OTP_MAX_PER_DAY} lần trong ngày. Vui lòng thử lại vào ngày mai.`,
    };
  }

  const last = await OtpLog.findOne({ phone: phone84 })
    .sort({ createdAt: -1 })
    .select("createdAt")
    .lean();
  if (last) {
    const elapsed = now - new Date(last.createdAt).getTime();
    if (elapsed < OTP_MIN_INTERVAL_MS) {
      const waitSec = Math.ceil((OTP_MIN_INTERVAL_MS - elapsed) / 1000);
      return {
        ok: false,
        reason: "cooldown",
        waitSec,
        todayCount,
        message: `Vui lòng đợi ${waitSec} giây rồi gửi lại mã.`,
      };
    }
  }
  return { ok: true, todayCount };
}

/**
 * Gửi OTP qua Zalo ZNS (đã rate-limit + ghi log). Trả { otp } để caller lưu hash.
 * Throw lỗi có `.rateLimited=true` khi vượt giới hạn (caller nên trả 429).
 */
export async function sendOtpWithLimit({
  user = null,
  phone,
  purpose = "register",
  ip = "",
}) {
  const phone84 = normalizeTo84(phone);
  if (!phone84 || phone84.length < 10) {
    throw new Error("Số điện thoại không hợp lệ.");
  }

  const rl = await checkOtpRateLimit(phone84);
  if (!rl.ok) {
    const e = new Error(rl.message);
    e.rateLimited = true;
    e.reason = rl.reason;
    e.waitSec = rl.waitSec;
    throw e;
  }

  const otp = genOtp6();
  try {
    const res = await sendZaloZnsOtp({ phone, otp });
    await OtpLog.create({
      user,
      phone: phone84,
      purpose,
      status: "success",
      tranId: res?.tranId || "",
      msgId: res?.msgId || "",
      cost: 0,
      ip,
    });
    return { otp, tranId: res?.tranId || "", msgId: res?.msgId || "" };
  } catch (err) {
    await OtpLog.create({
      user,
      phone: phone84,
      purpose,
      status: "failed",
      error: String(err?.message || err).slice(0, 500),
      ip,
    });
    throw err;
  }
}
