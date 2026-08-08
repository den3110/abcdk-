// controllers/tournamentOverlayController.js
// Proxy tới overlay generator (chạy nội bộ tại http://127.0.0.1:3131).
// Cho phép admin/manager giải tạo scoreboard overlay từ poster + tên giải.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Tournament from "../models/tournamentModel.js";

const GENERATOR_URL = (
  process.env.OVERLAY_GENERATOR_URL || "http://127.0.0.1:3131"
).replace(/\/$/, "");
const GENERATE_TIMEOUT_MS = Number(
  process.env.OVERLAY_GENERATE_TIMEOUT_MS || 90_000
);
const DEPLOY_TIMEOUT_MS = 15_000;
const MAX_POSTER_BYTES = 8 * 1024 * 1024; // Claude vision giới hạn ~5MB, để 8MB an toàn

const isAdmin = (u) =>
  u?.role === "admin" || u?.role === "superAdmin" || u?.isAdmin;
const isManagerOf = (u, tour) => {
  if (!u?._id || !tour) return false;
  if (String(tour.createdBy) === String(u._id)) return true;
  if (Array.isArray(tour.managers)) {
    return tour.managers.some(
      (m) => String(m?.user ?? m) === String(u._id)
    );
  }
  return false;
};
const canManage = (u, tour) => isAdmin(u) || isManagerOf(u, tour);

async function fetchTournamentOr404(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400);
    throw new Error("Tournament ID không hợp lệ");
  }
  const tour = await Tournament.findById(req.params.id).select(
    "name image overlayUrl createdBy managers tournamentMode"
  );
  if (!tour) {
    res.status(404);
    throw new Error("Không tìm thấy giải");
  }
  if (!canManage(req.user, tour)) {
    res.status(403);
    throw new Error("Không có quyền tạo overlay cho giải này");
  }
  return tour;
}

/**
 * Fetch ảnh từ URL public → trả về { base64, mediaType } để forward cho generator.
 */
async function fetchImageAsBase64(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Fetch poster thất bại: HTTP ${resp.status}`);
    }
    const mediaType = (resp.headers.get("content-type") || "image/png")
      .split(";")[0]
      .trim();
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mediaType)) {
      throw new Error(`Poster không phải ảnh (content-type: ${mediaType})`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_POSTER_BYTES) {
      throw new Error(
        `Poster quá lớn (${(buf.length / 1024 / 1024).toFixed(
          1
        )}MB, tối đa ${MAX_POSTER_BYTES / 1024 / 1024}MB)`
      );
    }
    return { base64: buf.toString("base64"), mediaType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gọi generator service với timeout dài (Claude vision mất 20-60s).
 */
async function callGenerator(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${GENERATOR_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await resp.json();
    } catch {
      payload = { error: `Generator trả về non-JSON (HTTP ${resp.status})` };
    }
    if (!resp.ok) {
      const err = new Error(payload?.error || `Generator lỗi HTTP ${resp.status}`);
      err.statusCode = resp.status;
      throw err;
    }
    return payload;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        `Generator timeout sau ${Math.round(timeoutMs / 1000)}s`
      );
    }
    if (err.code === "ECONNREFUSED" || /ECONNREFUSED|ENOTFOUND/.test(String(err))) {
      throw new Error(
        `Không kết nối được overlay generator tại ${GENERATOR_URL}. Kiểm tra dịch vụ overlay-gen đã chạy chưa (systemctl status overlay-gen).`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/admin/tournaments/:id/overlay/status
export const getOverlayStatus = asyncHandler(async (req, res) => {
  const tour = await fetchTournamentOr404(req, res);
  let key = { set: false, tail: "" };
  try {
    const resp = await fetch(`${GENERATOR_URL}/api/keystatus`, {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) key = await resp.json();
  } catch {
    /* generator down — trả set:false */
  }
  res.json({
    generatorUrl: GENERATOR_URL,
    keySet: !!key.set,
    keyTail: key.tail || "",
    currentUrl: tour.overlayUrl || "",
    defaults: {
      posterUrl: tour.image || "",
      tournamentName: tour.name || "",
    },
  });
});

// POST /api/admin/tournaments/:id/overlay/generate
// body: { tournamentName?, category?, posterBase64?, posterMediaType?, posterUrl? }
// - Nếu client không gửi poster override → backend fetch tour.image
export const generateOverlay = asyncHandler(async (req, res) => {
  const tour = await fetchTournamentOr404(req, res);
  const body = req.body || {};
  const tournamentName = String(
    body.tournamentName || tour.name || ""
  ).trim();
  if (!tournamentName) {
    res.status(400);
    throw new Error("Thiếu tên giải");
  }
  const category = String(body.category || "").trim();

  // Lấy poster: ưu tiên client upload → posterUrl override → tour.image
  let imageBase64 = String(body.posterBase64 || "").trim();
  let mediaType = String(body.posterMediaType || "image/png").split(";")[0];
  if (!imageBase64) {
    const url = String(body.posterUrl || tour.image || "").trim();
    if (!url) {
      res.status(400);
      throw new Error(
        "Giải chưa có ảnh poster và bạn không upload override. Hãy upload ảnh hoặc cập nhật poster của giải."
      );
    }
    const fetched = await fetchImageAsBase64(url);
    imageBase64 = fetched.base64;
    mediaType = fetched.mediaType;
  }

  const payload = await callGenerator(
    "/api/generate",
    { imageBase64, mediaType, tournamentName, category },
    GENERATE_TIMEOUT_MS
  );
  // { theme, html, slug, filename }
  res.json(payload);
});

// POST /api/admin/tournaments/:id/overlay/deploy
// body: { filename, html }  → lưu URL trả về vào tour.overlayUrl
export const deployOverlay = asyncHandler(async (req, res) => {
  const tour = await fetchTournamentOr404(req, res);
  const filename = String(req.body?.filename || "").trim();
  const html = String(req.body?.html || "");
  if (!filename || !html) {
    res.status(400);
    throw new Error("Thiếu filename hoặc html");
  }
  if (!/^[a-z0-9._-]+\.html$/i.test(filename)) {
    res.status(400);
    throw new Error("Tên file không hợp lệ (chỉ [a-z0-9._-].html)");
  }
  const payload = await callGenerator(
    "/api/deploy",
    { filename, html },
    DEPLOY_TIMEOUT_MS
  );
  if (payload?.url) {
    tour.overlayUrl = payload.url;
    await tour.save();
  }
  res.json({
    url: payload.url,
    filename,
    savedToTournament: !!payload?.url,
  });
});

// DELETE /api/admin/tournaments/:id/overlay
// Xóa URL khỏi giải (không xóa file trên server — chỉ ngắt liên kết).
export const clearOverlay = asyncHandler(async (req, res) => {
  const tour = await fetchTournamentOr404(req, res);
  tour.overlayUrl = "";
  await tour.save();
  res.json({ success: true });
});

/* ═════════════════ Admin-only: quản lý ANTHROPIC_API_KEY của generator ═════════════════ */
// GET /api/admin/overlay-generator/keystatus
export const getGeneratorKeyStatus = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin được xem trạng thái key");
  }
  try {
    const resp = await fetch(`${GENERATOR_URL}/api/keystatus`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return res.status(502).json({
        error: `Generator trả HTTP ${resp.status}`,
        generatorUrl: GENERATOR_URL,
      });
    }
    const payload = await resp.json();
    return res.json({ ...payload, generatorUrl: GENERATOR_URL });
  } catch (err) {
    return res.status(502).json({
      error:
        err?.name === "AbortError"
          ? "Generator không phản hồi (timeout)"
          : err?.message || "Không kết nối được generator",
      generatorUrl: GENERATOR_URL,
    });
  }
});

// POST /api/admin/overlay-generator/setkey  body: { apiKey }
// Forward tới generator /api/setkey — generator sẽ validate key qua Anthropic
// và lưu vào /root/overlay-generator/.env.
export const setGeneratorKey = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin được đổi API key");
  }
  const apiKey = String(req.body?.apiKey || "").trim();
  if (!apiKey) {
    res.status(400);
    throw new Error("Thiếu apiKey");
  }
  const payload = await callGenerator(
    "/api/setkey",
    { apiKey },
    15_000
  );
  res.json(payload);
});
