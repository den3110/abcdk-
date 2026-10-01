// Bình luận viên (mic điện thoại → trộn vào luồng live).
// Luồng: trình duyệt BLV (getUserMedia + WebRTC) → backend /offer → aiortc sidecar
// (giải mã Opus → PCM) → POST stream PCM tới control-server desktop qua Tailscale
// → worker ffmpeg amix vào luồng. Token (JWT ngắn hạn) gắn {machineId, sid}.
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import LiveControlMachine from "../models/liveControlMachineModel.js";

const ONLINE_MS = 60 * 1000;
const TOKEN_TTL = "2h";
// Sidecar aiortc chạy cục bộ trên VPS (pm2). Đổi bằng env nếu cần.
const AIORTC_URL = process.env.COMMENTARY_AIORTC_URL || "http://127.0.0.1:8790";

function isOnline(m) {
  return m?.lastSeenAt && Date.now() - new Date(m.lastSeenAt).getTime() < ONLINE_MS;
}

// POST /api/live-control/:machineId/commentary-token  (admin)
// body: { sid, courtName? } → { token, url }
export const createCommentaryToken = asyncHandler(async (req, res) => {
  const machineId = String(req.params.machineId || "").trim();
  const sid = String(req.body?.sid || "").trim();
  if (!machineId || !sid) {
    res.status(400);
    throw new Error("Thiếu machineId hoặc sid");
  }
  const m = await LiveControlMachine.findOne({ machineId }).lean();
  if (!m) {
    res.status(404);
    throw new Error("Không tìm thấy máy");
  }
  const token = jwt.sign(
    { typ: "commentary", machineId, sid, courtName: String(req.body?.courtName || "") },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
  // Trang bình luận là route SPA của frontend (pickletour.vn/commentary/:token).
  const base = (process.env.PUBLIC_WEB_BASE || "https://pickletour.vn").replace(/\/+$/, "");
  res.json({ token, url: `${base}/commentary/${token}`, expiresIn: TOKEN_TTL });
});

function verifyCommentaryToken(token) {
  const d = jwt.verify(String(token || ""), process.env.JWT_SECRET);
  if (d?.typ !== "commentary" || !d.machineId || !d.sid) {
    throw new Error("Token bình luận không hợp lệ");
  }
  return d;
}

// GET /api/commentary/info/:token  (công khai, token-gated) → thông tin hiển thị trang
export const commentaryInfo = asyncHandler(async (req, res) => {
  let d;
  try {
    d = verifyCommentaryToken(req.params.token);
  } catch (e) {
    res.status(401);
    throw new Error("Liên kết bình luận hết hạn hoặc không hợp lệ");
  }
  const m = await LiveControlMachine.findOne({ machineId: d.machineId }).lean();
  res.json({
    ok: true,
    sid: d.sid,
    courtName: d.courtName || "",
    machineLabel: m?.label || d.machineId,
    online: isOnline(m),
  });
});

// POST /api/commentary/offer  (công khai, token-gated)
// body: { token, sdp, type } → chuyển offer cho aiortc sidecar (kèm relayUrl đã gắn
// PIN — chỉ backend biết) → trả answer cho trình duyệt.
export const commentaryOffer = asyncHandler(async (req, res) => {
  let d;
  try {
    d = verifyCommentaryToken(req.body?.token);
  } catch (e) {
    res.status(401);
    throw new Error("Liên kết bình luận hết hạn hoặc không hợp lệ");
  }
  const { sdp, type } = req.body || {};
  if (!sdp || !type) {
    res.status(400);
    throw new Error("Thiếu SDP offer");
  }
  const m = await LiveControlMachine.findOne({ machineId: d.machineId }).lean();
  if (!m) {
    res.status(404);
    throw new Error("Không tìm thấy máy live");
  }
  if (!isOnline(m) || !m.tailscaleIp) {
    res.status(503);
    throw new Error("Máy live đang offline");
  }
  // URL control-server desktop nhận PCM (chứa PIN — không lộ ra trình duyệt).
  const relay = new URL(`http://${m.tailscaleIp}:${m.port || 8788}/api/commentary`);
  relay.searchParams.set("sid", d.sid);
  if (m.pin) relay.searchParams.set("k", m.pin);
  // URL preview 360p (video-only) cho BLV xem luồng — aiortc sẽ đọc làm video track.
  const preview = new URL(`http://${m.tailscaleIp}:${m.port || 8788}/api/preview360`);
  preview.searchParams.set("sid", d.sid);
  if (m.pin) preview.searchParams.set("k", m.pin);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${AIORTC_URL}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp,
        type,
        relayUrl: relay.toString(),
        previewUrl: preview.toString(),
      }),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
    if (!r.ok) {
      res.status(502);
      throw new Error(data?.error || "Dịch vụ bình luận lỗi");
    }
    return res.json(data); // { sdp, type }
  } catch (e) {
    if (e?.name === "AbortError" || /ECONNREFUSED|fetch failed/i.test(String(e?.message))) {
      res.status(503);
      throw new Error("Dịch vụ bình luận (aiortc) chưa chạy trên máy chủ");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
});
