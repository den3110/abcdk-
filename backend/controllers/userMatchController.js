// controllers/userMatchController.js
import asyncHandler from "express-async-handler";
import UserMatch from "../models/userMatchModel.js";
import User from "../models/userModel.js";
import crypto from "crypto";

/**
 * Helper: build score from gameScores
 */
function buildScoreFromGameScores(m) {
  if (
    Array.isArray(m.gameScores) &&
    m.gameScores.length > 0 &&
    m.gameScores[0]
  ) {
    return {
      a: typeof m.gameScores[0].a === "number" ? m.gameScores[0].a : 0,
      b: typeof m.gameScores[0].b === "number" ? m.gameScores[0].b : 0,
    };
  }
  return { a: 0, b: 0 };
}

/**
 * Helper: build liveSource (để FE show icon / mở link nhanh)
 */
function buildLiveSource(m) {
  return (
    m.facebookLive?.watch_url ||
    m.facebookLive?.video_permalink_url ||
    m.facebookLive?.permalink_url ||
    m.video ||
    null
  );
}

function genNick() {
  // total length = 10: "#" + 9 chars (base36)
  const n = BigInt("0x" + crypto.randomBytes(6).toString("hex")); // 48-bit
  const s = n.toString(36).padStart(9, "0").slice(0, 9);
  return `#${s}`;
}

function genPassword() {
  // password random để pass schema required
  return crypto.randomBytes(24).toString("hex");
}

async function createUserFromManualName(fullName) {
  const name = String(fullName || "").trim();
  if (!name) return null;

  // retry nếu đụng unique nickname
  for (let i = 0; i < 8; i++) {
    const nickname = genNick();
    try {
      const u = await User.create({
        name, // full name = tên nhập tay
        nickname, // unique "#..."
        password: genPassword(),
        // KHÔNG set phone/email để khỏi dính unique sparse
        // optional: avatar/bio nếu bạn muốn
        // bio: "Auto-created from userMatch manual participant",
      });
      return u;
    } catch (e) {
      // duplicate key nickname
      if (
        e?.code === 11000 &&
        (e?.keyPattern?.nickname || e?.keyValue?.nickname)
      ) {
        continue;
      }
      throw e;
    }
  }

  throw new Error("Không tạo được nickname unique cho user nhập tay");
}

/**
 * GET /api/user-matches
 * Danh sách match tự do của user hiện tại
 * Query:
 *  - search: chuỗi tìm kiếm (title, location, note, tên người chơi)
 *  - from, to: ISO date string (lọc theo scheduledAt)
 *  - status: scheduled/live/finished/canceled/all
 *  - page, limit: phân trang
 */
export const listMyUserMatches = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Không xác thực được user");
  }

  const {
    search = "",
    from,
    to,
    status = "all",
    page = 1,
    limit = 50,
  } = req.query;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const and = [{ createdBy: userId }];

  // lọc trạng thái (nếu cần)
  if (status && status !== "all") {
    and.push({ status });
  }

  // lọc theo khoảng thời gian (scheduledAt)
  if (from || to) {
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    and.push({ scheduledAt: range });
  }

  // search
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    and.push({
      $or: [
        { title: regex },
        { note: regex },
        { "location.name": regex },
        { "location.address": regex },
        { "participants.displayName": regex },
      ],
    });
  }

  const filter = and.length ? { $and: and } : {};

  const [total, rows] = await Promise.all([
    UserMatch.countDocuments(filter),
    UserMatch.find(filter)
      .sort({ scheduledAt: -1, createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  const items = rows.map((m) => {
    const score = buildScoreFromGameScores(m);
    const liveSource = buildLiveSource(m);

    return {
      _id: m._id,
      title: m.title || "",
      note: m.note || "",
      status: m.status,
      scheduledAt: m.scheduledAt || m.createdAt,
      createdAt: m.createdAt,
      location: m.location || { name: "", address: "" },
      score,
      liveSource,
    };
  });

  res.json({
    items,
    total,
    page: pageNum,
    limit: limitNum,
  });
});

/**
 * POST /api/user-matches
 * Tạo match tự do (để sau bạn làm màn tạo riêng)
 */
export const createUserMatch = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Không xác thực được user");
  }

  const {
    title,
    note,
    sportType,
    scheduledAt,
    participants = [],

    // vẫn đọc để tương thích FE cũ, nhưng KHÔNG bắt buộc
    locationName,
    locationAddress,
  } = req.body || {};

  const normalized = [];
  const usedSlots = new Set(); // chống trùng A1/A2/B1/B2

  if (Array.isArray(participants)) {
    for (const p of participants) {
      if (!p) continue;

      const side = p.side === "A" || p.side === "B" ? p.side : null;
      const order = [1, 2].includes(Number(p.order)) ? Number(p.order) : 1;

      const displayName = String(p.displayName || "").trim();
      let uid = p.user || null;

      // nếu có side -> check trùng slot
      if (side) {
        const slot = `${side}${order}`;
        if (usedSlots.has(slot)) {
          res.status(400);
          throw new Error(`Trùng slot participant: ${slot}`);
        }
        usedSlots.add(slot);
      }

      // nếu không có user mà có displayName => tạo User mới
      if (!uid && displayName) {
        const u = await createUserFromManualName(displayName);
        uid = u?._id || null;
      }

      // Nếu vẫn không có gì (draft mode có thể) => bỏ qua để đỡ bẩn
      if (!uid && !displayName && !side) continue;

      normalized.push({
        user: uid,
        displayName: displayName || "Player",
        side,
        order,
        isGuest: false,
        avatar: String(p.avatar || "").trim(),
        contact: p.contact || {},
        role: p.role || "player",
      });
    }
  }

  const payload = {
    createdBy: userId,
    title: title || "",
    note: note || "",
    sportType: sportType || "pickleball",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    participants: normalized,
  };

  // ✅ location OPTIONAL: chỉ lưu khi có dữ liệu thật
  const locName = String(locationName || "").trim();
  const locAddr = String(locationAddress || "").trim();
  if (locName || locAddr) {
    payload.location = { name: locName, address: locAddr };
  }

  const doc = await UserMatch.create(payload);
  res.status(201).json(doc);
});

/**
 * GET /api/user-matches/:id
 */
export const getUserMatchById = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Không xác thực được user");
  }

  const match = await UserMatch.findById(req.params.id).lean();

  if (!match || String(match.createdBy) !== String(userId)) {
    res.status(404);
    throw new Error("Không tìm thấy trận đấu");
  }

  res.json(match);
});

/**
 * PUT /api/user-matches/:id
 * Update basic info (score, status, note, location...)
 */
export const updateUserMatch = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Không xác thực được user");
  }

  const match = await UserMatch.findById(req.params.id);

  if (!match || String(match.createdBy) !== String(userId)) {
    res.status(404);
    throw new Error("Không tìm thấy trận đấu");
  }

  const {
    title,
    note,
    status,
    scheduledAt,
    locationName,
    locationAddress,
    score,
  } = req.body || {};

  if (title !== undefined) match.title = title;
  if (note !== undefined) match.note = note;
  if (status !== undefined) match.status = status;
  if (scheduledAt !== undefined) {
    match.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  }
  if (locationName !== undefined || locationAddress !== undefined) {
    match.location = {
      name:
        locationName !== undefined ? locationName : match.location?.name || "",
      address:
        locationAddress !== undefined
          ? locationAddress
          : match.location?.address || "",
    };
  }

  // Map score → gameScores[0]
  if (score && typeof score === "object") {
    const a = Number.isFinite(score.a) ? score.a : 0;
    const b = Number.isFinite(score.b) ? score.b : 0;

    if (!Array.isArray(match.gameScores) || match.gameScores.length === 0) {
      match.gameScores = [{ a, b, capped: false }];
    } else {
      match.gameScores[0].a = a;
      match.gameScores[0].b = b;
    }
  }

  await match.save();
  res.json(match);
});

/**
 * DELETE /api/user-matches/:id
 */
export const deleteUserMatch = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(401);
    throw new Error("Không xác thực được user");
  }

  const match = await UserMatch.findById(req.params.id);

  if (!match || String(match.createdBy) !== String(userId)) {
    res.status(404);
    throw new Error("Không tìm thấy trận đấu");
  }

  await match.deleteOne();
  res.json({ message: "Đã xoá trận đấu" });
});

/**
 * GET /api/user-matches/players
 * Tìm kiếm VĐV để gán vào trận tự do
 * query:
 *  - search: chuỗi tìm kiếm (tên, nickname, email, phone)
 *  - limit: số lượng tối đa (default 50)
 */
export const searchPlayersForUserMatch = asyncHandler(async (req, res) => {
  const { search = "", limit = 20 } = req.query;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const keyword = String(search || "").trim();
  if (!keyword) {
    return res.json({ items: [] });
  }
  const tokens = keyword.split(/\s+/).filter(Boolean).map(escapeRegex);
  const tokenFilters = tokens.map((token) => ({
    $or: [
      { nickname: { $regex: token, $options: "i" } },
      { name: { $regex: token, $options: "i" } },
      { province: { $regex: token, $options: "i" } },
      { email: { $regex: token, $options: "i" } },
      { phone: { $regex: token, $options: "i" } },
    ],
  }));

  const users = await User.find({
    isDeleted: { $ne: true },
    ...(tokenFilters.length ? { $and: tokenFilters } : {}),
  })
    .select("_id name nickname avatar province email phone")
    .limit(tokens.length ? lim * 4 : lim)
    .lean();

  const normalizedKeyword = keyword.toLowerCase();
  const scoreUser = (user) => {
    const nickname = String(user?.nickname || "").toLowerCase();
    const name = String(user?.name || "").toLowerCase();
    const province = String(user?.province || "").toLowerCase();
    const email = String(user?.email || "").toLowerCase();
    const phone = String(user?.phone || "").toLowerCase();
    let score = 0;
    if (nickname === normalizedKeyword) score += 200;
    if (name === normalizedKeyword) score += 180;
    if (phone === normalizedKeyword) score += 160;
    if (nickname.startsWith(normalizedKeyword)) score += 100;
    if (name.startsWith(normalizedKeyword)) score += 80;
    if (phone.startsWith(normalizedKeyword)) score += 70;
    if (email.startsWith(normalizedKeyword)) score += 50;
    if (province.startsWith(normalizedKeyword)) score += 25;
    if (nickname.includes(normalizedKeyword)) score += 20;
    if (name.includes(normalizedKeyword)) score += 15;
    if (phone.includes(normalizedKeyword)) score += 15;
    if (email.includes(normalizedKeyword)) score += 10;
    return score;
  };

  const items = users
    .map((user) => ({
      userId: String(user._id),
      name: user.name || "",
      nickname: user.nickname || "",
      avatar: user.avatar || "",
      province: user.province || "",
      _score: scoreUser(user),
    }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return String(a.nickname || a.name || "").localeCompare(
        String(b.nickname || b.name || "")
      );
    })
    .slice(0, lim)
    .map(({ _score, ...item }) => item);

  res.json({ items });
});

// helper escapeRegex nếu chưa có
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * GET /api/user-matches/:id
 * Phục vụ cho: useGetUserMatchDetailsQuery
 */
export const getUserMatchDetail = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  // Validate User
  if (!userId) {
    res.status(401);
    throw new Error("Không xác thực được user");
  }

  // Query DB
  const match = await UserMatch.findById(req.params.id)
    .populate("participants.user", "name fullName nickname avatar") // Lấy thông tin user để hiển thị tên/avatar
    .populate("createdBy", "name fullName avatar")
    .lean();

  if (!match) {
    res.status(404);
    throw new Error("Không tìm thấy trận đấu");
  }

  // (Optional) Nếu muốn chặn người lạ xem chi tiết thì check ở đây
  // if (match.visibility === 'private' && String(match.createdBy) !== String(userId)) ...

  res.json(match);
});
