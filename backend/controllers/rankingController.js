import Ranking from "../models/rankingModel.js";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import mongoose from "mongoose";
import Registration from "../models/registrationModel.js"; // (không dùng trực tiếp trong pipeline, chỉ để tham khảo)
import Match from "../models/matchModel.js"; // (không dùng trực tiếp)
import Tournament from "../models/tournamentModel.js"; // (không dùng trực tiếp)
import Assessment from "../models/assessmentModel.js";

export const getRankings = asyncHandler(async (req, res) => {
  const page = Math.max(0, parseInt(req.query.page ?? 0, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? 10, 10)));
  const keyword = String(req.query.keyword ?? "").trim();

  // 1) Nếu có keyword, lấy danh sách _id user khớp nickname (không lọc role)
  let userIdsFilter = null;
  if (keyword) {
    const rawIds = await User.find(
      { nickname: { $regex: keyword, $options: "i" } },
      { _id: 1 }
    ).lean();

    const ids = rawIds
      .map((d) => d?._id)
      .filter((id) => mongoose.isValidObjectId(id));

    if (ids.length === 0) {
      return res.json({ docs: [], totalPages: 0, page });
    }
    userIdsFilter = ids;
  }

  // 2) Match cơ bản cho Ranking
  const matchStage = {
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  // 3) Đếm số user duy nhất để tính totalPages
  const countAgg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },
    { $group: { _id: "$user" } },
    { $count: "n" },
  ]);
  const totalUniqueUsers = countAgg[0]?.n ?? 0;

  // 4) Lấy docs theo trang với các tính toán tier
  const docsAgg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },

    // Chuẩn hoá giá trị để sort an toàn
    {
      $addFields: {
        reputation: { $ifNull: ["$reputation", 0] },
        points: { $ifNull: ["$points", 0] },
        single: { $ifNull: ["$single", 0] },
        double: { $ifNull: ["$double", 0] },
      },
    },

    // Nếu (giả định) có nhiều bản / user, chọn bản "đẹp" nhất theo điểm (để ổn định)
    { $sort: { updatedAt: -1, double: -1, single: -1, points: -1, _id: 1 } },
    { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$doc" } },

    // Join sang users (FULL ROLE, không lọc)
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
        pipeline: [
          {
            $project: {
              nickname: 1,
              // role: 1,
              gender: 1,
              province: 1,
              avatar: 1,
              verified: 1,
              createdAt: 1,
              cccdStatus: 1,
            },
          },
        ],
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },

    // Lấy lần chấm gần nhất (để biết tự chấm hay không)
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user._id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          { $sort: { scoredAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { scorer: 1, scoredAt: 1, meta: 1 } },
        ],
        as: "latestAssess",
      },
    },
    { $addFields: { latestAssess: { $arrayElemAt: ["$latestAssess", 0] } } },
    {
      $addFields: {
        isSelfScoredLatest: {
          $cond: [
            {
              $or: [
                { $eq: ["$latestAssess.meta.selfScored", true] },
                { $eq: ["$latestAssess.scorer", "$user._id"] },
              ],
            },
            true,
            false,
          ],
        },
      },
    },

    // --- Tính số trận ĐÔI/ĐƠN đã KẾT THÚC cho user ---

    // Lấy tất cả registrations của user + phân loại theo eventType (single/double)
    {
      $lookup: {
        from: "registrations",
        let: { uid: "$user._id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$player1.user", "$$uid"] },
                  { $eq: ["$player2.user", "$$uid"] },
                ],
              },
            },
          },
          {
            $lookup: {
              from: "tournaments",
              localField: "tournament",
              foreignField: "_id",
              as: "tour",
              pipeline: [{ $project: { eventType: 1 } }],
            },
          },
          {
            $addFields: {
              eventType: {
                $ifNull: [{ $arrayElemAt: ["$tour.eventType", 0] }, "double"],
              },
            },
          },
          { $group: { _id: "$eventType", ids: { $push: "$_id" } } },
        ],
        as: "regsByType",
      },
    },

    // Rút 2 mảng regIds: regsDoubleIds & regsSingleIds
    {
      $addFields: {
        regsDoubleIds: {
          $let: {
            vars: {
              arr: {
                $filter: {
                  input: "$regsByType",
                  as: "r",
                  cond: { $eq: ["$$r._id", "double"] },
                },
              },
            },
            in: { $ifNull: [{ $arrayElemAt: ["$$arr.ids", 0] }, []] },
          },
        },
        regsSingleIds: {
          $let: {
            vars: {
              arr: {
                $filter: {
                  input: "$regsByType",
                  as: "r",
                  cond: { $eq: ["$$r._id", "single"] },
                },
              },
            },
            in: { $ifNull: [{ $arrayElemAt: ["$$arr.ids", 0] }, []] },
          },
        },
      },
    },

    // Đếm trận ĐÔI đã finished
    {
      $lookup: {
        from: "matches",
        let: { rids: "$regsDoubleIds" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$status", "finished"] },
                  {
                    $or: [
                      { $in: ["$pairA", "$$rids"] },
                      { $in: ["$pairB", "$$rids"] },
                    ],
                  },
                ],
              },
            },
          },
          { $count: "n" },
        ],
        as: "doubleCnt",
      },
    },
    {
      $addFields: {
        doubleMatches: { $ifNull: [{ $arrayElemAt: ["$doubleCnt.n", 0] }, 0] },
      },
    },

    // Đếm trận ĐƠN đã finished
    {
      $lookup: {
        from: "matches",
        let: { rids: "$regsSingleIds" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$status", "finished"] },
                  {
                    $or: [
                      { $in: ["$pairA", "$$rids"] },
                      { $in: ["$pairB", "$$rids"] },
                    ],
                  },
                ],
              },
            },
          },
          { $count: "n" },
        ],
        as: "singleCnt",
      },
    },
    {
      $addFields: {
        singleMatches: { $ifNull: [{ $arrayElemAt: ["$singleCnt.n", 0] }, 0] },
      },
    },

    // Tính tier cho đôi/đơn
    {
      $addFields: {
        doubleTier: {
          $switch: {
            branches: [
              { case: { $gte: ["$doubleMatches", 10] }, then: 0 },
              { case: { $gte: ["$doubleMatches", 5] }, then: 1 },
              { case: { $gte: ["$doubleMatches", 1] }, then: 2 },
            ],
            default: 4,
          },
        },
        singleTier: {
          $switch: {
            branches: [
              { case: { $gte: ["$singleMatches", 10] }, then: 0 },
              { case: { $gte: ["$singleMatches", 5] }, then: 1 },
              { case: { $gte: ["$singleMatches", 1] }, then: 2 },
            ],
            default: 4,
          },
        },
        selfTier: { $cond: [{ $eq: ["$isSelfScoredLatest", true] }, 3, 4] },
      },
    },

    // Badge hiệu lực (ưu tiên đôi → đơn → tự chấm → chưa đấu)
    {
      $addFields: {
        effectiveTier: {
          $cond: [
            { $ne: ["$doubleTier", 4] },
            "$doubleTier",
            {
              $cond: [{ $ne: ["$singleTier", 4] }, "$singleTier", "$selfTier"],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        tierColor: {
          $switch: {
            branches: [
              { case: { $eq: ["$effectiveTier", 0] }, then: "green" },
              { case: { $eq: ["$effectiveTier", 1] }, then: "blue" },
              { case: { $eq: ["$effectiveTier", 2] }, then: "yellow" },
              { case: { $eq: ["$effectiveTier", 3] }, then: "red" },
            ],
            default: "grey",
          },
        },
        tierLabel: {
          $switch: {
            branches: [
              { case: { $eq: ["$effectiveTier", 0] }, then: "≥10 trận" },
              { case: { $eq: ["$effectiveTier", 1] }, then: "5–9 trận" },
              { case: { $eq: ["$effectiveTier", 2] }, then: "1–4 trận" },
              { case: { $eq: ["$effectiveTier", 3] }, then: "Tự chấm" },
            ],
            default: "Chưa đấu",
          },
        },
      },
    },

    // === SORT theo ưu tiên mới ===
    {
      $sort: {
        doubleTier: 1, // Ưu tiên ĐÔI
        singleTier: 1, // rồi tới ĐƠN
        selfTier: 1, // rồi tới TỰ CHẤM
        double: -1, // sau đó theo điểm rank
        single: -1,
        points: -1,
        updatedAt: -1,
        _id: 1,
      },
    },

    // Paginate
    { $skip: page * limit },
    { $limit: limit },

    // Project gọn
    {
      $project: {
        user: 1, // đầy đủ role + info cơ bản
        single: 1,
        double: 1,
        mix: 1,
        points: 1,
        reputation: 1,
        updatedAt: 1,

        // trận/tiers tách đôi & đơn
        doubleMatches: 1,
        singleMatches: 1,
        doubleTier: 1,
        singleTier: 1,

        // badge hiệu lực (ưu tiên đôi)
        effectiveTier: 1,
        tierColor: 1,
        tierLabel: 1,

        // cờ tự chấm gần nhất
        isSelfScoredLatest: 1,
      },
    },
  ]);

  res.json({
    docs: docsAgg,
    totalPages: Math.ceil(totalUniqueUsers / limit),
    page,
  });
});

/* GET điểm kèm user (dùng trong danh sách) */ // Admin
export const getUsersWithRank = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Math.max(Number(req.query.page) || 1, 1);

  // ── Build keyword filter: name + nickname + phone
  const kw = (req.query.keyword || "").trim();
  const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = kw ? new RegExp(escapeRegex(kw), "i") : null;

  const keyword = kw
    ? {
        $or: [
          { name: rx }, // họ tên
          { nickname: rx }, // nickname
          { phone: rx }, // số điện thoại
        ],
      }
    : {};

  // ── role filter (nếu có)
  const role = req.query.role ? { role: req.query.role } : {};

  const filter = { ...keyword, ...role };

  // ── tổng số user theo filter
  const total = await User.countDocuments(filter);

  // ── danh sách user trang hiện tại
  const users = await User.find(filter)
    .limit(pageSize)
    .skip(pageSize * (page - 1))
    .lean();

  // ── map điểm từ Ranking
  const ids = users
    .map((u) => u?._id)
    .filter((id) => mongoose.isValidObjectId(id));

  let rankMap = {};
  if (ids.length) {
    const ranks = await Ranking.find({ user: { $in: ids } })
      .select("user single double")
      .lean();

    rankMap = ranks.reduce((acc, r) => {
      acc[String(r.user)] = r;
      return acc;
    }, {});
  }

  // ── build absolute URL cho cccdImages ở production
  const isProd = process.env.NODE_ENV === "production";
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const origin = `${proto}://${host}`;

  const isAbsUrl = (s) => /^https?:\/\//i.test(s || "");
  const toAbsUrl = (p) => {
    if (!p) return p;
    if (isAbsUrl(p)) return p;
    return `${origin}${p.startsWith("/") ? "" : "/"}${p}`;
  };

  const list = users.map((u) => {
    const cccdImages = isProd
      ? {
          front: toAbsUrl(u?.cccdImages?.front || ""),
          back: toAbsUrl(u?.cccdImages?.back || ""),
        }
      : u?.cccdImages || { front: "", back: "" };

    return {
      ...u,
      cccdImages,
      single: rankMap[String(u._id)]?.single ?? 0,
      double: rankMap[String(u._id)]?.double ?? 0,
    };
  });

  res.json({ users: list, total, pageSize });
});

export const updateRanking = asyncHandler(async (req, res) => {
  const { single, double } = req.body;
  const { id: userId } = req.params;

  // 1️⃣ Validate dữ liệu
  if (single == null || double == null) {
    res.status(400);
    throw new Error("Thiếu điểm");
  }
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }

  // 2️⃣ Kiểm tra user tồn tại
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  // 3️⃣ Tạo hoặc cập nhật Ranking
  const rank = await Ranking.findOneAndUpdate(
    { user: userId },
    { single, double, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  await ScoreHistory.create({
    user: req.params.id,
    scorer: req.user._id,
    single,
    double,
    note,
  });

  // 4️⃣ Trả kết quả
  res.json({
    message: "Đã cập nhật điểm",
    user: userId,
    single: rank.single,
    double: rank.double,
  });
});

export async function getLeaderboard(req, res) {
  const list = await Ranking.aggregate([
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          { $sort: { scoredAt: -1 } },
          { $limit: 1 },
          { $project: { scorer: 1, "meta.selfScored": 1 } },
        ],
        as: "latest",
      },
    },
    { $addFields: { latest: { $arrayElemAt: ["$latest", 0] } } },
    {
      $addFields: {
        isSelfScoredLatest: {
          $cond: [
            {
              $or: [
                { $eq: ["$latest.meta.selfScored", true] },
                { $eq: ["$latest.scorer", "$user"] },
              ],
            },
            true,
            false,
          ],
        },
      },
    },
    // sort theo yêu cầu: reputation trước, rồi points, rồi điểm
    {
      $sort: {
        reputation: -1,
        double: -1,
        single: -1,
        points: -1,
        lastUpdated: -1,
      },
    },
    {
      $project: {
        user: 1,
        single: 1,
        double: 1,
        points: 1,
        reputation: 1,
        isSelfScoredLatest: 1,
        lastUpdated: 1,
      },
    },
  ]);
  res.json(list);
}
