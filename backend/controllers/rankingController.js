import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Ranking from "../models/rankingModel.js";
import Registration from "../models/registrationModel.js"; // (không dùng trực tiếp trong pipeline, chỉ để tham khảo)
import Match from "../models/matchModel.js"; // (không dùng trực tiếp)
import Tournament from "../models/tournamentModel.js"; // (không dùng trực tiếp)
import Assessment from "../models/assessmentModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Bracket from "../models/bracketModel.js";

/* GET điểm kèm user (dùng trong danh sách) */ // Admin
export const getUsersWithRank = asyncHandler(async (req, res) => {
  // pageSize: ưu tiên lấy từ req.body.pageSize, mặc định 10, kẹp [1..100]
  const parseIntOr = (v, d) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };
  const pageSize = Math.min(
    100,
    Math.max(1, parseIntOr(req.query?.pageSize, 10))
  );

  const page = Math.max(Number(req.query.page) || 1, 1);

  // ── Build keyword filter: name + nickname + phone + email (+ domain suffix)
  const kw = (req.query.keyword || "").trim();
  const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = kw ? new RegExp(escapeRegex(kw), "i") : null;

  const conds = [];

  if (kw) {
    const orList = [
      { name: rx },
      { nickname: rx },
      { phone: rx },
      { email: rx },
    ];

    if (kw.startsWith("@")) {
      const domain = kw.slice(1).trim();
      if (domain) {
        const rxDomainSuffix = new RegExp(`@${escapeRegex(domain)}$`, "i");
        orList.push({ email: rxDomainSuffix });
      }
    }

    conds.push({ $or: orList });
  }

  // ── role filter
  if (req.query.role) {
    conds.push({ role: req.query.role });
  }

  // ── cccdStatus filter
  const rawStatus = (req.query.cccdStatus || "").trim();
  const ALLOWED = new Set(["unverified", "pending", "verified", "rejected"]);
  if (ALLOWED.has(rawStatus)) {
    if (rawStatus === "unverified") {
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
    // .sort({ createdAt: -1 })
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

/* ======================= helpers: podium từ bracket cuối ======================= */
/* ============ helpers nhỏ ============ */
const isOID = (x) => !!x && mongoose.isValidObjectId(x);
const uniq = (arr) => [...new Set(arr.map(String))];
const toNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const norm = (s) => String(s ?? "").toLowerCase();

/* Map regIds -> userIds (player1.user / player2.user / users[] / members[].user) */
async function mapRegToUsers(regIds) {
  const regs = await Registration.find(
    { _id: { $in: regIds.filter(isOID) } },
    { "player1.user": 1, "player2.user": 1, users: 1, members: 1 }
  ).lean();

  const out = new Map();
  for (const r of regs) {
    const set = new Set();
    const add = (u) => isOID(u) && set.add(String(u));
    add(r?.player1?.user);
    add(r?.player2?.user);
    Array.isArray(r?.users) && r.users.forEach(add);
    Array.isArray(r?.members) && r.members.forEach((m) => add(m?.user));
    out.set(String(r._id), [...set]);
  }
  return out;
}

/* Tổng hợp podium CHỈ từ bracket KO (knockout/roundElim) cuối cùng */
async function computeKoPodiumFromLastBracket(tournamentId) {
  const podium = { gold: [], silver: [], bronze: [] };

  // 1) Lấy KO bracket cuối cùng trong giải
  const br = await Bracket.findOne({
    tournament: tournamentId,
    type: { $in: ["knockout", "roundElim"] },
  })
    .sort({ stage: -1, order: -1, updatedAt: -1, _id: -1 })
    .select({
      _id: 1,
      type: 1,
      stage: 1,
      order: 1,
      "meta.maxRounds": 1,
      drawRounds: 1,
    })
    .lean();

  if (!br?._id) return podium;

  // 2) Lấy toàn bộ match đã FINISHED trong KO bracket này
  const matches = await Match.find(
    { bracket: br._id, status: "finished" },
    {
      _id: 1,
      round: 1,
      order: 1,
      branch: 1,
      winner: 1, // "A" | "B"
      pairA: 1,
      pairB: 1,
      updatedAt: 1,
    }
  ).lean();

  if (!matches.length) return podium;

  // 3) Xác định maxRound của KO
  const maxRoundFromMeta = toNum(br?.meta?.maxRounds) ?? toNum(br?.drawRounds);
  const maxRoundFromData = Math.max(
    0,
    ...matches.map((m) => toNum(m.round) ?? 0)
  );
  const maxRound = Math.max(maxRoundFromMeta ?? 0, maxRoundFromData);

  if (!maxRound || maxRound < 1) return podium;

  // 4) Chung kết = match có round = maxRound (chọn cái mới nhất nếu có nhiều)
  const finals = matches
    .filter((m) => (toNum(m.round) ?? 0) === maxRound)
    .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));
  const final = finals.at(-1);

  if (final && (final.winner === "A" || final.winner === "B")) {
    const goldReg = final.winner === "A" ? final.pairA : final.pairB;
    const silverReg = final.winner === "A" ? final.pairB : final.pairA;

    // 5) Đồng hạng 3:
    //    - Ưu tiên match nhánh "consol" nếu có (winner lấy Bronze)
    //    - Nếu không có, lấy 2 đội THUA ở bán kết (round = maxRound - 1)
    let bronzeRegs = [];
    const consol = matches
      .filter(
        (m) =>
          norm(m.branch) === "consol" && (toNum(m.round) ?? 0) >= maxRound - 1
      )
      .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))
      .at(-1);

    if (consol && (consol.winner === "A" || consol.winner === "B")) {
      bronzeRegs.push(consol.winner === "A" ? consol.pairA : consol.pairB);
    } else {
      const semis = matches.filter(
        (m) => (toNum(m.round) ?? 0) === maxRound - 1
      );
      for (const sm of semis) {
        if (sm.winner === "A" || sm.winner === "B") {
          const loserReg = sm.winner === "A" ? sm.pairB : sm.pairA;
          bronzeRegs.push(loserReg);
        }
      }
    }

    // 6) Map reg -> users
    const regIds = uniq([goldReg, silverReg, ...bronzeRegs].filter(Boolean));
    const regMap = await mapRegToUsers(regIds);

    podium.gold = uniq(regMap.get(String(goldReg)) || []);
    podium.silver = uniq(regMap.get(String(silverReg)) || []);
    podium.bronze = uniq(
      bronzeRegs.flatMap((rid) => regMap.get(String(rid)) || [])
    );
  }

  return podium;
}

/* ======================= getRankings (ONLY KO podium) ======================= */
export const getRankings = asyncHandler(async (req, res) => {
  const page = Math.max(0, parseInt(req.query.page ?? 0, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? 10, 10)));
  const keywordRaw = String(req.query.keyword ?? "").trim();

  const isAdmin =
    String(req.user?.role || "").toLowerCase() === "admin" ||
    !!req.user?.isAdmin;

  // ====== Giải đã kết thúc gần nhất ======
  const now = new Date();
  const latestTour = await Tournament.findOne({
    $or: [
      { status: "finished" },
      { finishedAt: { $ne: null } },
      { endAt: { $type: "date", $lt: now } },
    ],
  })
    .sort({ finishedAt: -1, endAt: -1, updatedAt: -1, _id: -1 })
    .select({ _id: 1, name: 1, title: 1, finishedAt: 1, endAt: 1, status: 1 })
    .lean();

  // ====== Podium CHỈ từ KO bracket ======
  let podium = { gold: [], silver: [], bronze: [] };
  if (latestTour?._id) {
    podium = await computeKoPodiumFromLastBracket(latestTour._id);
  }

  // ====== Keyword -> lọc user ======
  const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripSpaces = (s = "") => s.replace(/\s+/g, "");
  const digitsOnly = (s = "") => s.replace(/\D+/g, "");

  let userIdsFilter = null;
  if (keywordRaw) {
    const orConds = [];
    const namePattern = keywordRaw
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join(".*");
    if (namePattern) {
      orConds.push({ name: { $regex: namePattern, $options: "i" } });
      orConds.push({ nickname: { $regex: namePattern, $options: "i" } });
    }
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

    if (orConds.length > 0) {
      const rawIds = await User.find({ $or: orConds }, { _id: 1 }).lean();
      const ids = rawIds.map((d) => d?._id).filter((id) => isOID(id));
      if (!ids.length) {
        return res.json({
          docs: [],
          totalPages: 0,
          page,
          latestTournament: latestTour
            ? {
                _id: latestTour._id,
                name: latestTour.name || latestTour.title || "Giải đấu",
                finishedAt: latestTour.finishedAt || latestTour.endAt || null,
                podium,
              }
            : null,
        });
      }
      userIdsFilter = ids;
    }
  }

  const matchStage = {
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  // ====== Project user theo quyền ======
  const baseUserProject = {
    _id: 1,
    nickname: 1,
    gender: 1,
    province: 1,
    avatar: 1,
    verified: 1,
    createdAt: 1,
    cccdStatus: 1,
    dob: 1,
  };
  const adminExtraProject = {
    name: 1,
    email: 1,
    phone: 1,
    cccd: 1,
    cccdImages: 1,
    note: 1,
  };
  const userProject = isAdmin
    ? { ...baseUserProject, ...adminExtraProject }
    : baseUserProject;

  // ====== Aggregate rankings (giữ logic sắp xếp/phan trang cũ) ======
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
          {
            $addFields: {
              points: { $ifNull: ["$points", 0] },
              single: { $ifNull: ["$single", 0] },
              double: { $ifNull: ["$double", 0] },
              mix: { $ifNull: ["$mix", 0] },
              reputation: { $ifNull: ["$reputation", 0] },
            },
          },
          { $sort: { user: 1, updatedAt: -1, _id: 1 } },
          { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "user",
              pipeline: [{ $project: userProject }],
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },

          // số giải đã kết thúc user từng đăng ký → để giữ tier/reputation (như bạn đang dùng)
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
                            { $lt: ["$endAtDate", new Date()] },
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

          // màu/tier
          {
            $addFields: {
              isGold: { $gt: ["$totalTours", 0] },
              isRed: {
                $and: [{ $eq: ["$totalTours", 0] }],
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
                    { case: "$isGold", then: "yellow" },
                    { case: "$isRed", then: "red" },
                  ],
                  default: "grey",
                },
              },
              reputation: { $min: [100, { $multiply: ["$totalTours", 10] }] },
            },
          },

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
              tierLabel: 1,
              tierColor: 1,
              colorRank: 1,
              totalTours: 1,
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

  // gắn latestMedal từ KO podium
  const g = new Set(podium.gold.map(String));
  const s = new Set(podium.silver.map(String));
  const b = new Set(podium.bronze.map(String));
  const docs = (first.docs || []).map((d) => {
    const uid = d?.user?._id ? String(d.user._id) : null;
    let latestMedal = null;
    if (uid) {
      if (g.has(uid)) latestMedal = "gold";
      else if (s.has(uid)) latestMedal = "silver";
      else if (b.has(uid)) latestMedal = "bronze";
    }
    return { ...d, latestMedal };
  });

  return res.json({
    docs,
    totalPages: first.totalPages || 0,
    page,
    latestTournament: latestTour
      ? {
          _id: latestTour._id,
          name: latestTour.name || latestTour.title || "Giải đấu",
          finishedAt: latestTour.finishedAt || latestTour.endAt || null,
          podium, // <-- CHỈ từ vòng KO
        }
      : null,
  });
});
