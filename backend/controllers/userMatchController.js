// controllers/userMatchController.js
import asyncHandler from "express-async-handler";
import UserMatch from "../models/userMatchModel.js";
import User from "../models/userModel.js";
import { es, ES_USER_INDEX } from "../services/esClient.js";

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
    locationName,
    locationAddress,
    scheduledAt,
    participants = [],
  } = req.body || {};

  const doc = await UserMatch.create({
    createdBy: userId,
    title: title || "",
    note: note || "",
    sportType: sportType || "pickleball",
    location: {
      name: locationName || "",
      address: locationAddress || "",
    },
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    participants: Array.isArray(participants)
      ? participants.map((p) => ({
          user: p.user || null,
          displayName: p.displayName || "",
          side: p.side || null,
          order: p.order || 1,
        }))
      : [],
  });

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

  if (!search) {
    return res.json({ items: [] });
  }

  let items = [];

  // ----- Ưu tiên search bằng Elasticsearch -----
  try {
    // nếu bạn đang dùng esClient export const es = new Client(...)
    // thì ở đầu file nhớ:
    // import { es, ES_USER_INDEX } from "../../src/services/esClient.js";
    const indexName = process.env.ES_USERS_INDEX || ES_USER_INDEX || "users";

    const esRes = await es.search({
      index: indexName,
      size: lim,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: search,
                fields: [
                  "nickname^4",
                  "name^3",
                  "province^1",
                  "email^0.5",
                  "phone^0.5",
                ],
                fuzziness: "AUTO",
              },
            },
          ],
          filter: [
            { term: { isDeleted: false } }, // mapping bool
          ],
        },
      },
    });

    items = (esRes.hits?.hits || []).map((hit) => {
      const src = hit._source || {};
      return {
        // 👇 dùng luôn document id của ES (đã map = Mongo _id khi bulk)
        userId: hit._id,
        name: src.name || "",
        nickname: src.nickname || "",
        avatar: src.avatar || "",
        province: src.province || "",
        score: hit._score ?? undefined,
      };
    });
  } catch (err) {
    console.error(
      "[userMatch] ES searchPlayersForUserMatch failed, fallback Mongo:",
      err?.message || err
    );
  }

  // ----- Fallback Mongo (phòng khi ES lỗi / chưa index) -----
  if (!items.length) {
    const regex = new RegExp(escapeRegex(search), "i");

    const users = await User.find({
      isDeleted: { $ne: true },
      $or: [
        { nickname: regex },
        { name: regex },
        { phone: regex },
        { email: regex },
      ],
    })
      .select("_id name nickname avatar province")
      .limit(lim)
      .lean();

    items = users.map((u) => ({
      userId: String(u._id),
      name: u.name || "",
      nickname: u.nickname || "",
      avatar: u.avatar || "",
      province: u.province || "",
    }));
  }

  res.json({ items });
});

// helper escapeRegex nếu chưa có
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


