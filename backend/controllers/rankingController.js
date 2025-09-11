import Ranking from "../models/rankingModel.js";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import mongoose from "mongoose";
import Registration from "../models/registrationModel.js"; // (không dùng trực tiếp trong pipeline, chỉ để tham khảo)
import Match from "../models/matchModel.js"; // (không dùng trực tiếp)
import Tournament from "../models/tournamentModel.js"; // (không dùng trực tiếp)
import Assessment from "../models/assessmentModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";

export const getRankings = asyncHandler(async (req, res) => {
  // -------- Params --------
  const page = Math.max(0, parseInt(req.query.page ?? 0, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? 10, 10)));
  const keyword = String(req.query.keyword ?? "").trim();

  // -------- Optional filter by nickname --------
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

  // -------- Match stage (once) --------
  const matchStage = {
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  const now = new Date();

  const agg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },

    {
      $facet: {
        // ✅ SỬA Ở ĐÂY: đếm distinct user nhưng loại mồ côi giống nhánh docs
        total: [
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "u",
              pipeline: [{ $project: { _id: 1 } }],
            },
          },
          { $match: { "u.0": { $exists: true } } },
          { $group: { _id: "$user" } },
          { $count: "n" },
        ],

        // --- heavy docs pipeline (y nguyên) ---
        docs: [
          {
            $addFields: {
              reputation: { $ifNull: ["$reputation", 0] },
              points: { $ifNull: ["$points", 0] },
              single: { $ifNull: ["$single", 0] },
              double: { $ifNull: ["$double", 0] },
              mix: { $ifNull: ["$mix", 0] },
            },
          },
          {
            $sort: {
              updatedAt: -1,
              double: -1,
              single: -1,
              points: -1,
              _id: 1,
            },
          },
          { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
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
                    gender: 1,
                    province: 1,
                    avatar: 1,
                    verified: 1,
                    createdAt: 1,
                    cccdStatus: 1,
                    dob: 1,
                  },
                },
              ],
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },
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
          {
            $addFields: {
              latestAssess: { $arrayElemAt: ["$latestAssess", 0] },
            },
          },
          {
            $addFields: {
              isSelfScoredLatest: {
                $or: [
                  { $eq: ["$latestAssess.meta.selfScored", true] },
                  { $eq: ["$latestAssess.scorer", "$user._id"] },
                ],
              },
            },
          },
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
                    pipeline: [
                      {
                        $project: {
                          _id: 1,
                          eventType: 1,
                          status: 1,
                          finishedAt: 1,
                          endAt: 1,
                        },
                      },
                    ],
                  },
                },
                {
                  $addFields: {
                    eventType: {
                      $ifNull: [
                        { $arrayElemAt: ["$tour.eventType", 0] },
                        "double",
                      ],
                    },
                    tourId: { $arrayElemAt: ["$tour._id", 0] },
                    status: {
                      $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""],
                    },
                    finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
                    endAt: { $arrayElemAt: ["$tour.endAt", 0] },
                  },
                },
                {
                  $addFields: {
                    tourFinished: {
                      $or: [
                        { $eq: ["$status", "finished"] },
                        { $ne: ["$finishedAt", null] },
                        { $lt: ["$endAt", now] },
                      ],
                    },
                  },
                },
                { $match: { tourFinished: true } },
                { $group: { _id: { eventType: "$eventType", t: "$tourId" } } },
                {
                  $group: {
                    _id: "$_id.eventType",
                    tourIds: { $addToSet: "$_id.t" },
                    count: { $sum: 1 },
                  },
                },
              ],
              as: "finishedToursByType",
            },
          },
          {
            $addFields: {
              doubleTours: {
                $let: {
                  vars: {
                    item: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$finishedToursByType",
                            as: "r",
                            cond: { $eq: ["$$r._id", "double"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: { $ifNull: ["$$item.count", 0] },
                },
              },
              singleTours: {
                $let: {
                  vars: {
                    item: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$finishedToursByType",
                            as: "r",
                            cond: { $eq: ["$$r._id", "single"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: { $ifNull: ["$$item.count", 0] },
                },
              },
            },
          },
          {
            $addFields: {
              doubleTier: {
                $switch: {
                  branches: [
                    { case: { $gte: ["$doubleTours", 10] }, then: 0 },
                    { case: { $gte: ["$doubleTours", 5] }, then: 1 },
                    { case: { $gte: ["$doubleTours", 1] }, then: 2 },
                  ],
                  default: 4,
                },
              },
              singleTier: {
                $switch: {
                  branches: [
                    { case: { $gte: ["$singleTours", 10] }, then: 0 },
                    { case: { $gte: ["$singleTours", 5] }, then: 1 },
                    { case: { $gte: ["$singleTours", 1] }, then: 2 },
                  ],
                  default: 4,
                },
              },
              selfTier: {
                $cond: [{ $eq: ["$isSelfScoredLatest", true] }, 3, 4],
              },
            },
          },
          {
            $addFields: {
              effectiveTier: {
                $cond: [
                  { $ne: ["$doubleTier", 4] },
                  "$doubleTier",
                  {
                    $cond: [
                      { $ne: ["$singleTier", 4] },
                      "$singleTier",
                      "$selfTier",
                    ],
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
                    { case: { $eq: ["$effectiveTier", 0] }, then: "≥10 giải" },
                    { case: { $eq: ["$effectiveTier", 1] }, then: "5–9 giải" },
                    { case: { $eq: ["$effectiveTier", 2] }, then: "1–4 giải" },
                    { case: { $eq: ["$effectiveTier", 3] }, then: "Tự chấm" },
                  ],
                  default: "Chưa đấu",
                },
              },
              reputation: {
                $min: [
                  100,
                  {
                    $multiply: [{ $add: ["$singleTours", "$doubleTours"] }, 10],
                  },
                ],
              },
            },
          },
          {
            $sort: {
              effectiveTier: 1,
              double: -1,
              single: -1,
              points: -1,
              reputation: -1,
              updatedAt: -1,
              _id: 1,
            },
          },
          { $skip: page * limit },
          { $limit: limit },
          {
            $project: {
              user: 1,
              single: 1,
              double: 1,
              mix: 1,
              points: 1,
              reputation: 1,
              updatedAt: 1,
              doubleTours: 1,
              singleTours: 1,
              doubleTier: 1,
              singleTier: 1,
              effectiveTier: 1,
              tierColor: 1,
              tierLabel: 1,
              isSelfScoredLatest: 1,
            },
          },
        ],
      },
    },

    {
      $project: {
        docs: "$docs",
        total: { $ifNull: [{ $arrayElemAt: ["$total.n", 0] }, 0] },
      },
    },
    { $addFields: { totalPages: { $ceil: { $divide: ["$total", limit] } } } },
  ]);

  const first = agg[0] || { docs: [], totalPages: 0 };
  return res.json({ docs: first.docs, totalPages: first.totalPages, page });
});

/* GET điểm kèm user (dùng trong danh sách) */ // Admin
export const getUsersWithRank = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Math.max(Number(req.query.page) || 1, 1);

  // ── Build keyword filter: name + nickname + phone
  const kw = (req.query.keyword || "").trim();
  const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = kw ? new RegExp(escapeRegex(kw), "i") : null;

  const conds = [];

  if (kw) {
    conds.push({
      $or: [
        { name: rx }, // họ tên
        { nickname: rx }, // nickname
        { phone: rx }, // số điện thoại
        // Nếu muốn tìm theo email, mở dòng dưới:
        // { email: rx },
      ],
    });
  }

  // ── role filter (nếu có)
  if (req.query.role) {
    conds.push({ role: req.query.role });
  }

  // ── cccdStatus filter (server-side)
  const rawStatus = (req.query.cccdStatus || "").trim();
  const ALLOWED = new Set(["unverified", "pending", "verified", "rejected"]);
  if (ALLOWED.has(rawStatus)) {
    if (rawStatus === "unverified") {
      // Bao gồm cả user chưa có field cccdStatus
      conds.push({
        $or: [{ cccdStatus: { $exists: false } }, { cccdStatus: "unverified" }],
      });
    } else {
      conds.push({ cccdStatus: rawStatus });
    }
  }

  const filter = conds.length ? { $and: conds } : {};

  // ── tổng số user theo filter
  const total = await User.countDocuments(filter);

  // ── danh sách user trang hiện tại
  const users = await User.find(filter)
    // .sort({ createdAt: -1 }) // nếu cần sort, mở dòng này
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

export const adminUpdateRanking = asyncHandler(async (req, res) => {
  const { single, double } = req.body;
  const { id: userId } = req.params;

  // 1) Validate
  if (single == null || double == null) {
    res.status(400);
    throw new Error("Thiếu điểm");
  }
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }

  const sSingle = Number(single);
  const sDouble = Number(double);
  if (!Number.isFinite(sSingle) || !Number.isFinite(sDouble)) {
    res.status(400);
    throw new Error("Điểm không hợp lệ");
  }

  // 2) User tồn tại?
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  // 3) Cập nhật/Upsert Ranking
  const rank = await Ranking.findOneAndUpdate(
    { user: userId },
    { $set: { single: sSingle, double: sDouble, updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true, lean: true }
  );

  // 4) Nếu CHƯA từng có "tự chấm", tạo một bản tự chấm (admin hỗ trợ)
  const hasSelfAssessment = await Assessment.exists({
    user: userId,
    "meta.selfScored": true,
  });

  let createdSelfAssessment = false;
  if (!hasSelfAssessment) {
    await Assessment.create({
      user: userId,
      scorer: req.user?._id || null, // ai chấm (admin)
      items: [], // items không bắt buộc
      singleScore: sSingle, // snapshot thời điểm này
      doubleScore: sDouble,
      // singleLevel/doubleLevel: tuỳ bạn có map từ DUPR không, tạm để trống
      meta: {
        selfScored: true, // ❗ cờ tự chấm nằm trong meta
        // các field khác giữ default: freq=0, competed=false, external=0
      },
      note: "Tự chấm trình (admin hỗ trợ)",
      scoredAt: new Date(),
    });
    createdSelfAssessment = true;
  }

  // 5) Ghi lịch sử
  const note = createdSelfAssessment
    ? "Admin chấm điểm và tạo tự chấm (admin hỗ trợ)"
    : "Admin chấm điểm trình";

  await ScoreHistory.create({
    user: userId,
    scorer: req.user?._id || null,
    single: sSingle,
    double: sDouble,
    note,
    scoredAt: new Date(),
  });

  // 6) Trả kết quả
  res.json({
    message: createdSelfAssessment
      ? "Đã cập nhật điểm và tạo tự chấm (admin hỗ trợ)"
      : "Đã cập nhật điểm",
    user: userId,
    single: rank.single,
    double: rank.double,
    createdSelfAssessment,
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
