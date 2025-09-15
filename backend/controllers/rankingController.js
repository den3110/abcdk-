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
  const page = Math.max(0, parseInt(req.query.page ?? 0, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? 10, 10)));
  const keywordRaw = String(req.query.keyword ?? "").trim();

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripSpaces = (s) => s.replace(/\s+/g, "");
  const digitsOnly = (s) => s.replace(/\D+/g, "");

  let userIdsFilter = null;
  if (keywordRaw) {
    const orConds = [];
    orConds.push({ nickname: { $regex: keywordRaw, $options: "i" } });

    const emailCandidate = stripSpaces(keywordRaw);
    if (emailCandidate.includes("@")) {
      orConds.push({
        email: { $regex: `^${escapeRegExp(emailCandidate)}$`, $options: "i" },
      });
    }

    const phoneDigits = digitsOnly(keywordRaw);
    if (phoneDigits.length >= 9) {
      const phonePattern = `^${phoneDigits.split("").join("\\s*")}$`;
      orConds.push({ phone: { $regex: phonePattern } });
      orConds.push({ cccd: { $regex: phonePattern } });
    }

    const rawIds = await User.find({ $or: orConds }, { _id: 1 }).lean();
    const ids = rawIds
      .map((d) => d?._id)
      .filter((id) => mongoose.isValidObjectId(id));
    if (ids.length === 0) return res.json({ docs: [], totalPages: 0, page });
    userIdsFilter = ids;
  }

  const matchStage = {
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };
  const now = new Date();

  const agg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },

    {
      $facet: {
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

        docs: [
          // newest ranking per user
          {
            $addFields: {
              points: { $ifNull: ["$points", 0] },
              single: { $ifNull: ["$single", 0] },
              double: { $ifNull: ["$double", 0] },
              mix: { $ifNull: ["$mix", 0] },
              reputation: { $ifNull: ["$reputation", 0] },
            },
          },
          { $sort: { updatedAt: -1, _id: 1 } },
          { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },

          // join user
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

          // ===== tournaments finished (unique) =====
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
                    status: {
                      $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""],
                    },
                    finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
                    rawEndAt: { $arrayElemAt: ["$tour.endAt", 0] },
                  },
                },
                {
                  $addFields: {
                    endAtDate: {
                      $convert: {
                        input: "$rawEndAt",
                        to: "date",
                        onError: null,
                        onNull: null,
                      },
                    },
                    tourFinished: {
                      $or: [
                        { $eq: ["$status", "finished"] },
                        { $ne: ["$finishedAt", null] },
                        {
                          $and: [
                            { $ne: ["$endAtDate", null] },
                            { $lt: ["$endAtDate", now] },
                          ],
                        },
                      ],
                    },
                  },
                },
                { $match: { tourFinished: true } },
                { $group: { _id: "$tournament" } },
                { $count: "n" },
              ],
              as: "finishedToursCount",
            },
          },
          {
            $addFields: {
              totalTours: {
                $ifNull: [{ $arrayElemAt: ["$finishedToursCount.n", 0] }, 0],
              },
            },
          },

          // ===== flags from ASSESSMENTS only =====
          // official: meta.scoreBy in [admin, mod, moderator]
          {
            $lookup: {
              from: "assessments",
              let: { uid: "$user._id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
                {
                  $match: {
                    $expr: {
                      $in: [
                        { $toLower: { $ifNull: ["$meta.scoreBy", ""] } },
                        ["admin", "mod", "moderator"],
                      ],
                    },
                  },
                },
                { $limit: 1 },
                { $project: { _id: 1 } },
              ],
              as: "assOfficial",
            },
          },
          {
            $addFields: {
              hasOfficial: { $gt: [{ $size: "$assOfficial" }, 0] },
            },
          },

          // self: selfScored==true OR scorer==user (any assessment)
          {
            $lookup: {
              from: "assessments",
              let: { uid: "$user._id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
                {
                  $match: {
                    $expr: {
                      $or: [
                        {
                          $eq: [{ $ifNull: ["$meta.selfScored", false] }, true],
                        },
                        {
                          $eq: [
                            { $toString: { $ifNull: ["$scorer", ""] } },
                            { $toString: "$$uid" },
                          ],
                        },
                      ],
                    },
                  },
                },
                { $limit: 1 },
                { $project: { _id: 1 } },
              ],
              as: "assSelf",
            },
          },
          { $addFields: { hasSelf: { $gt: [{ $size: "$assSelf" }, 0] } } },

          // ===== color grouping =====
          {
            $addFields: {
              isGold: { $or: [{ $gt: ["$totalTours", 0] }, "$hasOfficial"] },
              isRed: {
                $and: [
                  { $eq: ["$totalTours", 0] },
                  { $eq: ["$hasOfficial", false] },
                  "$hasSelf",
                ],
              },
            },
          },
          {
            $addFields: {
              colorRank: { $cond: ["$isGold", 0, { $cond: ["$isRed", 1, 2] }] },
              tierLabel: {
                $switch: {
                  branches: [
                    { case: "$isGold", then: "Đã đấu/Official" },
                    { case: "$isRed", then: "Tự chấm" },
                  ],
                  default: "Chưa có điểm",
                },
              },
              tierColor: {
                $switch: {
                  branches: [
                    { case: "$isGold", then: "yellow" }, // gộp 3 màu thành vàng
                    { case: "$isRed", then: "red" },
                  ],
                  default: "grey",
                },
              },
              reputation: { $min: [100, { $multiply: ["$totalTours", 10] }] },
            },
          },

          // sort & paginate
          {
            $sort: {
              colorRank: 1,
              double: -1,
              single: -1,
              points: -1,
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
              updatedAt: 1,

              // info UI/debug
              tierLabel: 1,
              tierColor: 1,
              colorRank: 1,
              totalTours: 1,
              hasOfficial: 1,
              hasSelf: 1,
              reputation: 1,
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
