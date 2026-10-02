// Pickletour Network — cấp "vé" vào chung mạng lưới Tailscale cho user PickleTour
// đã được admin cấp quyền (hasNetworkAccess), KHÔNG cần họ cài app Tailscale hay có
// tài khoản Tailscale riêng. Thiết bị vào tailnet dưới dạng node tagged, ephemeral.
//
// Luồng: app (user có quyền) → GET /status (kiểm tra được phép?) → POST /session
// (backend gọi Tailscale API cấp auth key ephemeral/tagged) → app dùng key đó cho
// lớp VPN (Network Extension) để lên tailnet → tới được camera/máy live.
import asyncHandler from "express-async-handler";
import tailscale from "../services/tailscale.service.js";
import LiveControlMachine from "../models/liveControlMachineModel.js";
import { isAdminActor } from "../middleware/authMiddleware.js";

const ONLINE_MS = 60 * 1000;

function userAllowed(user) {
  return Boolean(isAdminActor(user) || user?.hasNetworkAccess === true);
}

// GET /api/network-access/status  (protect)
// Trả về app biết: user có được phép không + dịch vụ đã cấu hình chưa + cấu hình chung.
export const networkStatus = asyncHandler(async (req, res) => {
  const allowed = userAllowed(req.user);
  res.json({
    allowed,
    configured: tailscale.isConfigured(),
    ...tailscale.networkConfig(), // { tailnet, tag, keyTtlSeconds, loginServer }
  });
});

// POST /api/network-access/session  (protect + adminOrNetworkAccess)
// Cấp 1 auth key ephemeral/tagged + danh sách máy (tailscaleIp) để app hiển thị.
export const createNetworkSession = asyncHandler(async (req, res) => {
  if (!tailscale.isConfigured()) {
    res.status(501);
    throw new Error("Pickletour Network chưa được cấu hình trên máy chủ");
  }
  let keyInfo;
  try {
    keyInfo = await tailscale.createAuthKey({
      description: `pickletour-net ${req.user?._id || "user"}`,
    });
  } catch (e) {
    res.status(e?.status === 501 ? 501 : 502);
    throw new Error("Không cấp được vé Tailscale: " + (e?.message || e));
  }

  // Danh sách máy live trong tailnet (chỉ địa chỉ 100.x + nhãn; KHÔNG lộ PIN).
  const machines = (
    await LiveControlMachine.find({ tailscaleIp: { $ne: "" } })
      .select("machineId label tailscaleIp port lastSeenAt")
      .lean()
  ).map((m) => ({
    machineId: m.machineId,
    label: m.label || m.machineId,
    tailscaleIp: m.tailscaleIp,
    port: m.port || 8788,
    online: Boolean(m.lastSeenAt && Date.now() - new Date(m.lastSeenAt).getTime() < ONLINE_MS),
  }));

  res.json({
    authKey: keyInfo.key, // bí mật — chỉ thiết bị của user này dùng
    expiresAt: keyInfo.expiresAt,
    tag: keyInfo.tag,
    loginServer: keyInfo.loginServer,
    keyTtlSeconds: keyInfo.keyTtlSeconds,
    machines,
  });
});

export default { networkStatus, createNetworkSession };
