// Bình luận viên (mic điện thoại → trộn vào luồng live).
// Luồng: trình duyệt BLV (getUserMedia + WebRTC) → backend /offer → aiortc sidecar
// (giải mã Opus → PCM) → POST stream PCM tới control-server desktop qua Tailscale
// → worker ffmpeg amix vào luồng. Token (JWT ngắn hạn) gắn {machineId, sid}.
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import LiveControlMachine from "../models/liveControlMachineModel.js";
import CommentaryCode from "../models/commentaryCodeModel.js";
import TournamentAutoLiveSession from "../models/tournamentAutoLiveSessionModel.js";

const ONLINE_MS = 60 * 1000;
const TOKEN_TTL = "2h";
const TTL_MS = 2 * 60 * 60 * 1000;

async function genUniqueCode() {
  for (let i = 0; i < 6; i += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    // eslint-disable-next-line no-await-in-loop
    const existed = await CommentaryCode.findOne({ code }).lean();
    if (!existed) return code;
  }
  return String(Date.now()).slice(-6);
}
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
  const courtName = String(req.body?.courtName || "");
  const token = jwt.sign(
    { typ: "commentary", machineId, sid, courtName },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
  // Mã ngắn 6 số → link gọn /c/<code>.
  const code = await genUniqueCode();
  await CommentaryCode.create({
    code, machineId, sid, courtName, expiresAt: new Date(Date.now() + TTL_MS),
  });
  // Trang bình luận là route SPA của frontend.
  const base = (process.env.PUBLIC_WEB_BASE || "https://pickletour.vn").replace(/\/+$/, "");
  res.json({
    code,
    url: `${base}/c/${code}`,        // link gọn (ưu tiên)
    token,
    fullUrl: `${base}/commentary/${token}`,
    expiresIn: TOKEN_TTL,
  });
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

// GET /api/commentary/by-code/:code  (công khai) → đổi mã ngắn thành token + info
export const resolveCommentaryCode = asyncHandler(async (req, res) => {
  const code = String(req.params.code || "").trim();
  const doc = await CommentaryCode.findOne({ code }).lean();
  if (!doc || (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now())) {
    res.status(404);
    throw new Error("Mã bình luận không tồn tại hoặc đã hết hạn");
  }
  const m = await LiveControlMachine.findOne({ machineId: doc.machineId }).lean();
  const token = jwt.sign(
    { typ: "commentary", machineId: doc.machineId, sid: doc.sid, courtName: doc.courtName || "" },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
  res.json({
    token,
    sid: doc.sid,
    courtName: doc.courtName || "",
    machineLabel: m?.label || doc.machineId,
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

  // Nếu nguồn phiên là RTSP (VPS cùng Tailscale có thể tới) → cho aiortc kéo THẲNG
  // RTSP full-res (đẹp hơn 360p). aiortc thử rtsp trước, lỗi thì fallback preview360.
  let rtspUrl = "";
  try {
    const sess = await TournamentAutoLiveSession.findById(d.sid).select("sourceUrl").lean();
    const su = String(sess?.sourceUrl || "").trim();
    if (/^rtsp:\/\//i.test(su)) rtspUrl = su;
  } catch {}

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
        rtspUrl, // ưu tiên: VPS kéo RTSP full-res; rỗng/lỗi → dùng previewUrl 360p
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
