// utils/phoneGate.js
// Kiểm tra "yêu cầu đã kích hoạt SĐT" cho các thao tác (đăng tin Chợ, tạo/tham gia kèo…).
import { getSystemSettingsRuntime } from "../services/systemSettingsRuntime.service.js";
import User from "../models/userModel.js";

export const PHONE_GATE_MESSAGE =
  "Vui lòng kích hoạt số điện thoại (qua Zalo) trong Hồ sơ trước khi thực hiện thao tác này.";

/**
 * @returns {Promise<{required:boolean, verified:boolean}>}
 * required=true khi ZNS bật + bật toggle requireVerifiedForActions.
 */
export async function checkActionPhoneGate(userId) {
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    const zns = settings?.zaloZns || {};
    const required =
      zns.enabled === true && zns.requireVerifiedForActions === true;
    if (!required) return { required: false, verified: true };
    const u = await User.findById(userId).select("phoneVerified").lean();
    return { required: true, verified: !!u?.phoneVerified };
  } catch {
    // Lỗi cấu hình → không chặn (fail-open để không làm hỏng luồng chính)
    return { required: false, verified: true };
  }
}
