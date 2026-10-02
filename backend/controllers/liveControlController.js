import asyncHandler from "express-async-handler";
import LiveControlMachine from "../models/liveControlMachineModel.js";
import TournamentAutoLiveSession from "../models/tournamentAutoLiveSessionModel.js";
import { isAdminActor } from "../middleware/authMiddleware.js";

// Bình luận viên (không phải admin) chỉ được gọi các path ĐỌC qua proxy.
const COMMENTATOR_READ_PATHS = new Set(["/api/state", "/api/get-opacity"]);

const ONLINE_MS = 60 * 1000; // coi là online nếu heartbeat trong 60s
const PROXY_TIMEOUT_MS = 15000;

function isOnline(m) {
  return m?.lastSeenAt && Date.now() - new Date(m.lastSeenAt).getTime() < ONLINE_MS;
}
function publicMachine(m) {
  return {
    machineId: m.machineId,
    label: m.label || m.machineId,
    online: isOnline(m),
    tailscaleIp: m.tailscaleIp || "",
    cpuModel: m.cpuModel || "",
    cpuPct: m.cpuPct || 0,
    moreCourts: m.moreCourts,
    lastSeenAt: m.lastSeenAt,
  };
}

// POST /api/live-control/register  (desktop app gọi — admin auth)
// body: { machineId, label, tailscaleIp, port, pin, cpuModel?, cpuPct?, moreCourts? }

// GET /api/live-control/:machineId/session-rtsp?sid=  (ADMIN ONLY — URL chứa creds cam)
// Trả rtspUrl nếu nguồn là RTSP ngoài (phone có thể tới qua Tailscale); rỗng nếu
// nguồn là local (Dahua P2P tunnel 127.x) / Imou / không RTSP → app dùng WebRTC.
export const sessionRtsp = asyncHandler(async (req, res) => {
  const sid = String(req.query.sid || "").trim();
  if (!sid) { res.status(400); throw new Error("Thiếu sid"); }
  let sess = null;
  try {
    sess = await TournamentAutoLiveSession.findById(sid).select("sourceUrl").lean();
  } catch { sess = null; }
  const url = String(sess?.sourceUrl || "").trim();
  const isRtsp = /^rtsp:\/\//i.test(url);
  let host = "";
  try { if (isRtsp) host = new URL(url).hostname; } catch { host = ""; }
  const local = !host || /^(127\.|0\.0\.0\.0$|localhost$|::1$)/i.test(host);
  const direct = isRtsp && !local;
  res.json({ direct, rtspUrl: direct ? url : "", host: direct ? host : "" });
});

export const registerMachine = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const machineId = String(b.machineId || "").trim();
  if (!machineId) { res.status(400); throw new Error("Thiếu machineId"); }
  const tailscaleIp = String(b.tailscaleIp || "").trim();
  const port = Number(b.port) || 8788;
  const pin = String(b.pin || "").trim();
  const doc = await LiveControlMachine.findOneAndUpdate(
    { machineId },
    {
      $set: {
        machineId, label: String(b.label || "").trim(),
        tailscaleIp, port, pin,
        cpuModel: String(b.cpuModel || "").trim(),
        cpuPct: Number(b.cpuPct) || 0,
        moreCourts: b.moreCourts == null ? null : Number(b.moreCourts),
        lastSeenAt: new Date(),
        registeredBy: req.user?._id || null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.json({ ok: true, machine: publicMachine(doc) });
});

// GET /api/live-control/machines  (app — admin auth) → danh sách máy (online trước)
export const listMachines = asyncHandler(async (_req, res) => {
  const rows = await LiveControlMachine.find({}).sort({ lastSeenAt: -1 }).lean();
  const machines = rows.map(publicMachine).sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
  res.json({ machines });
});

// ALL /api/live-control/:machineId/call  (app — admin auth)
// body: { path: "/api/state", method?: "GET"|"POST", body?: {} }
// → forward tới control-server desktop qua Tailscale, gắn PIN (?k=), trả nguyên kết quả.
export const proxyCall = asyncHandler(async (req, res) => {
  const m = await LiveControlMachine.findOne({ machineId: String(req.params.machineId || "") }).lean();
  if (!m) { res.status(404); throw new Error("Không tìm thấy máy"); }
  if (!isOnline(m)) { res.status(503); throw new Error("Máy đang offline (desktop chưa chạy/đăng ký)"); }
  if (!m.tailscaleIp) { res.status(503); throw new Error("Máy chưa có IP Tailscale"); }

  const b = req.body || {};
  let path = String(b.path || "").trim();
  if (!path.startsWith("/")) path = "/" + path;
  if (!path.startsWith("/api/")) { res.status(400); throw new Error("path không hợp lệ"); }
  const method = String(b.method || "GET").toUpperCase();

  // Bình luận viên: CHỈ cho phép path đọc (xem phiên), chặn mọi lệnh điều khiển.
  if (!isAdminActor(req.user)) {
    if (method !== "GET" || !COMMENTATOR_READ_PATHS.has(path.split("?")[0])) {
      res.status(403);
      throw new Error("Bình luận viên không có quyền điều khiển luồng live");
    }
  }

  const base = `http://${m.tailscaleIp}:${m.port || 8788}`;
  const url = new URL(base + path);
  if (m.pin) url.searchParams.set("k", m.pin);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
  try {
    const r = await fetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(b.body || {}),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    // Máy live từ chối (PIN sai / không đủ quyền phía máy): KHÔNG trả 401/403 (SPA coi
    // 401 là HẾT PHIÊN đăng nhập → tự đá ra login) và KHÔNG trả 5xx (ops-monitor báo
    // "bão lỗi 5xx" → spam Telegram vì màn live poll /api/state mỗi 5s). Dùng 409 (lỗi
    // cấu hình/kết nối máy live, không phải lỗi server) kèm thông báo rõ.
    if (r.status === 401 || r.status === 403) {
      return res.status(409).json({
        error:
          "Máy live từ chối kết nối (PIN không khớp). Hãy đăng nhập lại app live trên máy đó để đăng ký lại.",
        machineStatus: r.status,
        detail: data?.error || data?.message || undefined,
      });
    }
    return res.status(r.status).json(data);
  } catch (e) {
    res.status(502);
    throw new Error("Không gọi được máy live qua Tailscale: " + (e?.message || e));
  } finally {
    clearTimeout(timer);
  }
});
