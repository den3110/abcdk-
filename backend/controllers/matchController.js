import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import mongoose from "mongoose";

// controllers/matchController.js
const getMatchesByTournament = asyncHandler(async (req, res) => {
  const raw = await Match.find({ tournament: req.params.id })
    .populate([
      {
        path: "reg1",
        select:
          "player1.fullName player2.fullName player1.avatar player2.avatar",
      },
      {
        path: "reg2",
        select:
          "player1.fullName player2.fullName player1.avatar player2.avatar",
      },
    ])
    .sort({ date: 1, time: 1 });

  // 👉  chỉ giữ trận đủ 2 registration
  const result = raw
    .filter((m) => m.reg1 && m.reg2) // bỏ trận thiếu đội
    .map((m) => ({
      _id: m._id,
      code: m.code,
      date: m.date,
      time: m.time,
      team1: `${m.reg1.player1.fullName} / ${m.reg1.player2.fullName}`,
      team2: `${m.reg2.player1.fullName} / ${m.reg2.player2.fullName}`,
      avatar1: m.reg1.player1.avatar || "",
      avatar2: m.reg2.player1.avatar || "",
      score1: m.score1,
      score2: m.score2,
      field: m.field,
      referee: m.referee,
      status: m.status,
    }));

  res.json(result);
});

export const getTournamentMatchesForCheckin = asyncHandler(async (req, res) => {
  const { id } = req.params; // tournamentId
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid tournament id" });
  }

  const TZ = "Asia/Bangkok";

  const pipeline = [
    { $match: { tournament: new mongoose.Types.ObjectId(id) } },

    // ===== Tournament (ngày/giờ, eventType nếu cần) =====
    {
      $lookup: {
        from: "tournaments",
        localField: "tournament",
        foreignField: "_id",
        as: "_tour",
      },
    },
    { $unwind: "$_tour" },

    // ===== Bracket (để lấy type/stage/order) =====
    {
      $lookup: {
        from: "brackets",
        localField: "bracket",
        foreignField: "_id",
        as: "_br",
      },
    },
    { $addFields: { _br: { $arrayElemAt: ["$_br", 0] } } },

    // ===== Registration pairs =====
    {
      $lookup: {
        from: "registrations",
        localField: "pairA",
        foreignField: "_id",
        as: "_ra",
      },
    },
    {
      $lookup: {
        from: "registrations",
        localField: "pairB",
        foreignField: "_id",
        as: "_rb",
      },
    },
    {
      $addFields: {
        _ra: { $arrayElemAt: ["$_ra", 0] },
        _rb: { $arrayElemAt: ["$_rb", 0] },
      },
    },

    // ===== Users cho từng player (để lấy nickname) =====
    {
      $lookup: {
        from: "users",
        localField: "_ra.player1.user",
        foreignField: "_id",
        as: "_ra_u1",
      },
    },
    { $addFields: { _ra_u1: { $arrayElemAt: ["$_ra_u1", 0] } } },
    {
      $lookup: {
        from: "users",
        localField: "_ra.player2.user",
        foreignField: "_id",
        as: "_ra_u2",
      },
    },
    { $addFields: { _ra_u2: { $arrayElemAt: ["$_ra_u2", 0] } } },
    {
      $lookup: {
        from: "users",
        localField: "_rb.player1.user",
        foreignField: "_id",
        as: "_rb_u1",
      },
    },
    { $addFields: { _rb_u1: { $arrayElemAt: ["$_rb_u1", 0] } } },
    {
      $lookup: {
        from: "users",
        localField: "_rb.player2.user",
        foreignField: "_id",
        as: "_rb_u2",
      },
    },
    { $addFields: { _rb_u2: { $arrayElemAt: ["$_rb_u2", 0] } } },

    // ===== Referees & liveBy =====
    {
      $lookup: {
        from: "users",
        localField: "referee",
        foreignField: "_id",
        as: "_ref",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "liveBy",
        foreignField: "_id",
        as: "_liveBy",
      },
    },
    { $addFields: { _liveBy: { $arrayElemAt: ["$_liveBy", 0] } } },

    // ===== Court =====
    {
      $lookup: {
        from: "courts",
        localField: "court",
        foreignField: "_id",
        as: "_court",
      },
    },
    { $addFields: { _court: { $arrayElemAt: ["$_court", 0] } } },

    // ===== Ngày/giờ =====
    {
      $addFields: {
        _todayStr: {
          $dateToString: { date: "$$NOW", format: "%Y-%m-%d", timezone: TZ },
        },
        _startStr: {
          $dateToString: {
            date: "$_tour.startDate",
            format: "%Y-%m-%d",
            timezone: TZ,
          },
        },
        _openStr: {
          $dateToString: {
            date: "$_tour.regOpenDate",
            format: "%Y-%m-%d",
            timezone: TZ,
          },
        },

        _schedDate: {
          $cond: [
            { $ifNull: ["$scheduledAt", false] },
            {
              $dateToString: {
                date: "$scheduledAt",
                format: "%Y-%m-%d",
                timezone: TZ,
              },
            },
            null,
          ],
        },
        _schedTime: {
          $cond: [
            { $ifNull: ["$scheduledAt", false] },
            {
              $dateToString: {
                date: "$scheduledAt",
                format: "%H:%M",
                timezone: TZ,
              },
            },
            null,
          ],
        },
      },
    },
    { $addFields: { _tourUpcoming: { $lt: ["$_todayStr", "$_startStr"] } } },

    // ===== Set cuối =====
    {
      $addFields: {
        _lastSet: {
          $cond: [
            { $gt: [{ $size: "$gameScores" }, 0] },
            { $arrayElemAt: ["$gameScores", -1] },
            { a: 0, b: 0 },
          ],
        },
      },
    },

    // ===== Nickname cho từng player (ưu tiên nickname) =====
    {
      $addFields: {
        _p1aNick: {
          $let: {
            vars: { u: "$_ra_u1", r: "$_ra.player1" },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ["$$u.nickname", ""] } }, 0] },
                "$$u.nickname",
                {
                  $cond: [
                    {
                      $gt: [
                        { $strLenCP: { $ifNull: ["$$r.nickname", ""] } },
                        0,
                      ],
                    },
                    "$$r.nickname",
                    {
                      $cond: [
                        {
                          $gt: [
                            { $strLenCP: { $ifNull: ["$$u.name", ""] } },
                            0,
                          ],
                        },
                        "$$u.name",
                        { $ifNull: ["$$r.fullName", "??"] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        _p2aNick: {
          $let: {
            vars: { u: "$_ra_u2", r: "$_ra.player2" },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ["$$u.nickname", ""] } }, 0] },
                "$$u.nickname",
                {
                  $cond: [
                    {
                      $gt: [
                        { $strLenCP: { $ifNull: ["$$r.nickname", ""] } },
                        0,
                      ],
                    },
                    "$$r.nickname",
                    {
                      $cond: [
                        {
                          $gt: [
                            { $strLenCP: { $ifNull: ["$$u.name", ""] } },
                            0,
                          ],
                        },
                        "$$u.name",
                        { $ifNull: ["$$r.fullName", ""] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        _p1bNick: {
          $let: {
            vars: { u: "$_rb_u1", r: "$_rb.player1" },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ["$$u.nickname", ""] } }, 0] },
                "$$u.nickname",
                {
                  $cond: [
                    {
                      $gt: [
                        { $strLenCP: { $ifNull: ["$$r.nickname", ""] } },
                        0,
                      ],
                    },
                    "$$r.nickname",
                    {
                      $cond: [
                        {
                          $gt: [
                            { $strLenCP: { $ifNull: ["$$u.name", ""] } },
                            0,
                          ],
                        },
                        "$$u.name",
                        { $ifNull: ["$$r.fullName", "??"] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        _p2bNick: {
          $let: {
            vars: { u: "$_rb_u2", r: "$_rb.player2" },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ["$$u.nickname", ""] } }, 0] },
                "$$u.nickname",
                {
                  $cond: [
                    {
                      $gt: [
                        { $strLenCP: { $ifNull: ["$$r.nickname", ""] } },
                        0,
                      ],
                    },
                    "$$r.nickname",
                    {
                      $cond: [
                        {
                          $gt: [
                            { $strLenCP: { $ifNull: ["$$u.name", ""] } },
                            0,
                          ],
                        },
                        "$$u.name",
                        { $ifNull: ["$$r.fullName", ""] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },

    // ===== Team label theo nickname (đánh đơn sẽ chỉ hiện p1) =====
    {
      $addFields: {
        _team1: {
          $cond: [
            { $ifNull: ["$_ra", false] },
            {
              $let: {
                vars: { a: "$_p1aNick", b: "$_p2aNick" },
                in: {
                  $cond: [
                    { $gt: [{ $strLenCP: "$$b" }, 0] },
                    { $concat: ["$$a", " & ", "$$b"] },
                    "$$a",
                  ],
                },
              },
            },
            "Chưa xác định",
          ],
        },
        _team2: {
          $cond: [
            { $ifNull: ["$_rb", false] },
            {
              $let: {
                vars: { a: "$_p1bNick", b: "$_p2bNick" },
                in: {
                  $cond: [
                    { $gt: [{ $strLenCP: "$$b" }, 0] },
                    { $concat: ["$$a", " & ", "$$b"] },
                    "$$a",
                  ],
                },
              },
            },
            "Chưa xác định",
          ],
        },
      },
    },

    // ===== Status VN + màu =====
    {
      $addFields: {
        _statusVN: {
          $cond: [
            { $eq: ["$status", "finished"] },
            "Hoàn thành",
            {
              $cond: [
                { $eq: ["$status", "live"] },
                "Đang thi đấu",
                {
                  $cond: [
                    {
                      $and: [
                        { $ifNull: ["$scheduledAt", false] },
                        { $eq: ["$_todayStr", "$_schedDate"] },
                      ],
                    },
                    "Chuẩn bị",
                    "Dự kiến",
                  ],
                },
              ],
            },
          ],
        },
        _statusColor: {
          $cond: [
            { $eq: ["$status", "finished"] },
            "success",
            {
              $cond: [
                { $eq: ["$status", "live"] },
                "warning",
                {
                  $cond: [
                    {
                      $and: [
                        { $ifNull: ["$scheduledAt", false] },
                        { $eq: ["$_todayStr", "$_schedDate"] },
                      ],
                    },
                    "info",
                    "default",
                  ],
                },
              ],
            },
          ],
        },
      },
    },

    // ===== Output date/time (nếu chưa diễn ra dùng ngày mở reg) =====
    {
      $addFields: {
        _outDate: { $cond: ["$_tourUpcoming", "$_openStr", "$_schedDate"] },
        _outTime: {
          $cond: ["$_tourUpcoming", "00:00", { $ifNull: ["$_schedTime", ""] }],
        },
      },
    },

    // ===== Nickname cho liveBy & referee list =====
    {
      $addFields: {
        _liveNick: {
          $let: {
            vars: {
              nn: { $ifNull: ["$_liveBy.nickname", ""] },
              nm: { $ifNull: ["$_liveBy.name", ""] },
            },
            in: {
              $cond: [{ $gt: [{ $strLenCP: "$$nn" }, 0] }, "$$nn", "$$nm"],
            },
          },
        },
        _refNicks: {
          $map: {
            input: { $ifNull: ["$_ref", []] },
            as: "r",
            in: {
              $let: {
                vars: {
                  nn: { $ifNull: ["$$r.nickname", ""] },
                  nm: { $ifNull: ["$$r.name", ""] },
                },
                in: {
                  $cond: [{ $gt: [{ $strLenCP: "$$nn" }, 0] }, "$$nn", "$$nm"],
                },
              },
            },
          },
        },
      },
    },
    {
      $addFields: {
        _refNicksFiltered: {
          $filter: {
            input: "$_refNicks",
            as: "n",
            cond: { $gt: [{ $strLenCP: "$$n" }, 0] },
          },
        },
      },
    },
    {
      $addFields: {
        _refereeJoined: {
          $reduce: {
            input: "$_refNicksFiltered",
            initialValue: "",
            in: {
              $cond: [
                { $eq: ["$$value", ""] },
                "$$this",
                { $concat: ["$$value", ", ", "$$this"] },
              ],
            },
          },
        },
      },
    },

    // ===== Khóa sort theo BRACKET → MATCH =====
    {
      $addFields: {
        _brStage: { $ifNull: ["$_br.stage", 9999] },
        _brOrder: { $ifNull: ["$_br.order", 9999] },
        _sortSchedDate: { $ifNull: ["$_schedDate", "9999-12-31"] },
        _sortSchedTime: { $ifNull: ["$_schedTime", "23:59"] },
        _roundSafe: { $ifNull: ["$round", 9999] },
        _orderSafe: { $ifNull: ["$order", 9999] },
      },
    },

    // ===== Sắp xếp: BRACKET trước, rồi round/order/time =====
    {
      $sort: {
        _brStage: 1,
        _brOrder: 1,
        _roundSafe: 1,
        _orderSafe: 1,
        _sortSchedDate: 1,
        _sortSchedTime: 1,
      },
    },

    // ===== Project output cho FE =====
    {
      $project: {
        _id: 1,
        code: {
          $ifNull: [
            "$code",
            {
              $concat: [
                "M-",
                { $toString: { $ifNull: ["$round", 0] } },
                "-",
                { $toString: { $ifNull: ["$order", 0] } },
              ],
            },
          ],
        },

        // Bracket info
        bracketId: "$_br._id",
        bracketName: "$_br.name",
        bracketType: "$_br.type",

        // Date/time
        date: "$_outDate",
        time: "$_outTime",

        // Team labels (nickname-based)
        team1: "$_team1",
        team2: "$_team2",

        // Score (last set)
        score1: { $ifNull: ["$_lastSet.a", 0] },
        score2: { $ifNull: ["$_lastSet.b", 0] },

        // Field label
        field: {
          $let: {
            vars: {
              label: {
                $ifNull: ["$_court.name", { $ifNull: ["$courtLabel", ""] }],
              },
            },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: "$$label" }, 0] },
                "$$label",
                "Chưa xác định",
              ],
            },
          },
        },

        // Referee string (ưu tiên liveBy)
        referee: {
          $let: {
            vars: { live: "$_liveNick", joined: "$_refereeJoined" },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: "$$live" }, 0] },
                "$$live",
                { $ifNull: ["$$joined", ""] },
              ],
            },
          },
        },

        status: "$_statusVN",
        statusColor: "$_statusColor",
      },
    },
  ];

  const rows = await Match.aggregate(pipeline);
  res.json(rows);
});

/**
 * GET /api/matches/:id
 * Public: trả về match đã populate những phần FE cần
 */
export const getMatchPublic = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid match id" });
  }

  const match = await Match.findById(id)
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    // referee giờ là array<ObjectId> — populate bình thường
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    // ⭐ NEW: lấy thông tin người đang live (user)
    .populate({ path: "liveBy", select: "name nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    .lean();

  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }

  // Helper: chuẩn hoá nickname cho player (và user nếu cần)
  const fillNick = (p) => {
    if (!p) return p;
    const pick = (v) => (v && String(v).trim()) || "";
    const primary = pick(p.nickname) || pick(p.nickName);
    const fromUser = p.user
      ? pick(p.user.nickname) || pick(p.user.nickName)
      : "";
    const n = primary || fromUser || "";
    if (n) {
      p.nickname = n;
      p.nickName = n;
    }
    return p;
  };

  if (match.pairA) {
    match.pairA.player1 = fillNick(match.pairA.player1);
    match.pairA.player2 = fillNick(match.pairA.player2);
  }
  if (match.pairB) {
    match.pairB.player1 = fillNick(match.pairB.player1);
    match.pairB.player2 = fillNick(match.pairB.player2);
  }

  // ⭐ NEW: chuẩn hoá liveBy để luôn có { _id, name, nickname }
  if (match.liveBy) {
    const lb = match.liveBy;
    const nickname =
      (lb.nickname && String(lb.nickname).trim()) ||
      (lb.nickName && String(lb.nickName).trim()) ||
      "";
    match.liveBy = {
      _id: lb._id,
      name: lb.name || "",
      nickname, // luôn expose key 'nickname'
    };
  }

  // Chuẩn hoá referee (array) — vẫn giữ mỗi item chỉ có {_id, name, nickname}
  if (Array.isArray(match.referee)) {
    match.referee = match.referee.map((r) => ({
      _id: r._id,
      name: r.name || r.fullName || "",
      nickname:
        (r.nickname && String(r.nickname).trim()) ||
        (r.nickName && String(r.nickName).trim()) ||
        "",
    }));
  }

  // Bổ sung streams từ meta nếu có
  if (!match.streams && match.meta?.streams) {
    match.streams = match.meta.streams;
  }

  res.json(match);
});

export { getMatchesByTournament };

/**
 * PATCH /api/matches/:id/live
 * Body: { liveUrl?: string, video?: string }
 * ✅ Chỉ cập nhật field `video` (string). Không chạm vào status/startedAt/finishedAt.
 * - Gán link:  { liveUrl: "https://..." } hoặc { video: "https://..." }
 * - Xoá link:  { liveUrl: "" } hoặc { video: "" }  → video = ""
 */
export const setMatchLive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("Invalid match id");
  }

  const match = await Match.findById(id);
  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  // Lấy URL từ body (ưu tiên liveUrl)
  const raw = (req.body?.video ?? "").toString().trim();

  // (Tuỳ chọn) enforce http/https
  // if (raw && !/^https?:\/\//i.test(raw)) {
  //   res.status(400);
  //   throw new Error("Video URL must start with http/https");
  // }

  const prev = match.video || "";
  match.video = raw || ""; // chỉ cập nhật video
  if (prev !== match.video) {
    match.liveVersion = (match.liveVersion || 0) + 1; // bump version khi đổi link
  }
  if (raw) {
    match.liveBy = req.user?._id || match.liveBy || null; // ai gắn link
  }
  // ❌ KHÔNG đổi status/startedAt/finishedAt

  await match.save();

  res.json({
    success: true,
    data: {
      _id: match._id,
      video: match.video,
      liveVersion: match.liveVersion,
      // Trả thêm cho tiện debug UI, nhưng không chỉnh sửa:
      status: match.status,
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      updatedAt: match.updatedAt,
    },
  });
});
