import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import mongoose from "mongoose";
import Registration from "../models/registrationModel.js";

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

    // ===== Tournament =====
    {
      $lookup: {
        from: "tournaments",
        localField: "tournament",
        foreignField: "_id",
        as: "_tour",
      },
    },
    { $unwind: "$_tour" },

    // ===== Bracket hiện tại =====
    {
      $lookup: {
        from: "brackets",
        localField: "bracket",
        foreignField: "_id",
        as: "_br",
      },
    },
    { $addFields: { _br: { $arrayElemAt: ["$_br", 0] } } },

    // ===== Lấy toàn bộ brackets & tính _span (số vòng chiếm dụng) =====
    {
      $lookup: {
        from: "brackets",
        let: { tId: "$tournament" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tId"] } } },

          // ---- Chuẩn hoá type về 3 nhóm: group / roundelim (PO) / knockout (KO)
          {
            $addFields: {
              __typeRaw: { $toLower: { $ifNull: ["$type", ""] } },
              __tNorm: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $in: [
                          { $toLower: { $ifNull: ["$type", ""] } },
                          [
                            "group",
                            "round_robin",
                            "round-robin",
                            "rr",
                            "gsl",
                            "swiss",
                          ],
                        ],
                      },
                      then: "group",
                    },
                    {
                      case: {
                        $in: [
                          { $toLower: { $ifNull: ["$type", ""] } },
                          ["po", "roundelim", "round_elim", "round-elim"],
                        ],
                      },
                      then: "roundelim",
                    },
                    {
                      case: {
                        $in: [
                          { $toLower: { $ifNull: ["$type", ""] } },
                          [
                            "knockout",
                            "ko",
                            "single_elim",
                            "single-elim",
                            "singleelimination",
                          ],
                        ],
                      },
                      then: "knockout",
                    },
                  ],
                  default: { $toLower: { $ifNull: ["$type", ""] } },
                },
              },
            },
          },

          // ---- Lấy số vòng từ matches: max(round) + số round distinct
          {
            $lookup: {
              from: "matches",
              let: { bid: "$_id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$bracket", "$$bid"] } } },
                {
                  $group: {
                    _id: null,
                    maxRound: { $max: { $ifNull: ["$round", 0] } },
                    roundsSet: { $addToSet: { $ifNull: ["$round", 0] } },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    maxRound: 1,
                    roundCount: { $size: "$roundsSet" },
                  },
                },
              ],
              as: "_mx",
            },
          },
          {
            $addFields: {
              _mxAgg: { $arrayElemAt: ["$_mx", 0] },
              _mxMaxRound: {
                $ifNull: [{ $arrayElemAt: ["$_mx.maxRound", 0] }, 0],
              },
              _mxRoundCount: {
                $ifNull: [{ $arrayElemAt: ["$_mx.roundCount", 0] }, 0],
              },
            },
          },
          {
            $addFields: {
              _roundsFromMatches: { $max: ["$_mxMaxRound", "$_mxRoundCount"] },
            },
          },

          // ---- Fallback từ meta/config
          {
            $addFields: {
              _metaRounds: {
                $max: [
                  { $ifNull: ["$meta.maxRounds", 0] },
                  { $ifNull: ["$drawRounds", 0] },
                ],
              },
              _reCutRounds: {
                $ifNull: ["$config.roundElim.cutRounds", 0],
              },
            },
          },

          // ---- Quy tắc tính _span
          {
            $addFields: {
              _span: {
                $switch: {
                  branches: [
                    // Group-like: luôn là 1
                    { case: { $eq: ["$__tNorm", "group"] }, then: 1 },
                    // RoundElim (PO): ưu tiên matches, rồi cutRounds/meta; min 1
                    {
                      case: { $eq: ["$__tNorm", "roundelim"] },
                      then: {
                        $max: [
                          1,
                          "$_roundsFromMatches",
                          "$_reCutRounds",
                          "$_metaRounds",
                        ],
                      },
                    },
                    // Knockout (KO): ưu tiên matches, rồi meta/drawRounds; min 1
                    {
                      case: { $eq: ["$__tNorm", "knockout"] },
                      then: {
                        $max: [1, "$_roundsFromMatches", "$_metaRounds"],
                      },
                    },
                  ],
                  default: 1,
                },
              },
            },
          },

          { $project: { _id: 1, stage: 1, order: 1, _span: 1 } },
          { $sort: { stage: 1, order: 1, _id: 1 } },
        ],
        as: "_allBrs",
      },
    },

    // ===== Tính base V cho bracket hiện tại: 1 + SUM(_span) các bracket trước
    {
      $addFields: {
        _brIds: { $map: { input: "$_allBrs", as: "b", in: "$$b._id" } },
        _spans: { $map: { input: "$_allBrs", as: "b", in: "$$b._span" } },
      },
    },
    { $addFields: { _curIndex: { $indexOfArray: ["$_brIds", "$_br._id"] } } },
    {
      $addFields: {
        _baseSum: {
          $let: {
            vars: {
              arr: {
                $cond: [
                  { $gt: ["$_curIndex", 0] },
                  { $slice: ["$_spans", 0, "$_curIndex"] },
                  [],
                ],
              },
            },
            in: {
              $reduce: {
                input: "$$arr",
                initialValue: 0,
                in: { $add: ["$$value", "$$this"] },
              },
            },
          },
        },
      },
    },
    { $addFields: { _baseRoundStart: { $add: [1, "$_baseSum"] } } },

    // ===== Registrations / Users / Court / Time … (giữ nguyên như bạn đang có) =====
    // -- (đoạn dưới giống hệt bản trước của bạn, mình không đổi gì ngoài giữ gọn)

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

    {
      $lookup: {
        from: "courts",
        localField: "court",
        foreignField: "_id",
        as: "_court",
      },
    },
    { $addFields: { _court: { $arrayElemAt: ["$_court", 0] } } },

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

    // Team labels (nickname)
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

    // ===== Date/time output =====
    {
      $addFields: {
        _outDate: { $cond: ["$_tourUpcoming", "$_openStr", "$_schedDate"] },
        _outTime: {
          $cond: ["$_tourUpcoming", "00:00", { $ifNull: ["$_schedTime", ""] }],
        },
      },
    },

    // ===== referee/liveBy nick =====
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

    // ===== Ưu tiên group-code nếu có =====
    {
      $addFields: {
        _codeCandidates: [
          { $ifNull: ["$codeResolved", ""] },
          { $ifNull: ["$globalCodeV", ""] },
          { $ifNull: ["$globalCode", ""] },
          { $ifNull: ["$code", ""] },
        ],
      },
    },
    {
      $addFields: {
        _groupCode: {
          $let: {
            vars: { arr: "$_codeCandidates" },
            in: {
              $reduce: {
                input: "$$arr",
                initialValue: "",
                in: {
                  $cond: [
                    { $ne: ["$$value", ""] },
                    "$$value",
                    {
                      $cond: [
                        {
                          $regexMatch: {
                            input: "$$this",
                            regex: "^#?V\\d+-B[\\w-]+#\\d+$",
                          },
                        },
                        {
                          $cond: [
                            { $eq: [{ $substrCP: ["$$this", 0, 1] }, "#"] },
                            "$$this",
                            { $concat: ["#", "$$this"] },
                          ],
                        },
                        "",
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },

    // ===== Sort =====
    {
      $addFields: {
        _brStage: { $ifNull: ["$_br.stage", 9999] },
        _brOrder: { $ifNull: ["$_br.order", 9999] },
        _sortSchedDate: { $ifNull: ["$_schedDate", "9999-12-31"] },
        _sortSchedTime: { $ifNull: ["$_schedTime", "23:59"] },
        _roundSafe: { $ifNull: ["$round", 1] },
        _orderSafe: { $ifNull: ["$order", 0] },
      },
    },
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

    // ===== Project =====
    {
      $project: {
        _id: 1,

        code: {
          $cond: [
            { $gt: [{ $strLenCP: "$_groupCode" }, 0] },
            "$_groupCode",
            {
              $let: {
                vars: {
                  dispRound: {
                    $add: [
                      "$_baseRoundStart",
                      { $add: [{ $ifNull: ["$round", 1] }, -1] },
                    ],
                  },
                  order1: { $add: [{ $ifNull: ["$order", 0] }, 1] },
                },
                in: {
                  $concat: [
                    "V",
                    { $toString: "$$dispRound" },
                    "-T",
                    { $toString: "$$order1" },
                  ],
                },
              },
            },
          ],
        },

        bracketId: "$_br._id",
        bracketName: "$_br.name",
        bracketType: "$_br.type",

        date: "$_outDate",
        time: "$_outTime",

        team1: "$_team1",
        team2: "$_team2",

        score1: { $ifNull: ["$_lastSet.a", 0] },
        score2: { $ifNull: ["$_lastSet.b", 0] },

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
    // ===== Pairs A/B + players (giữ như bạn đang dùng) =====
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

    // ===== Referees (array) & liveBy =====
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .populate({ path: "liveBy", select: "name nickname nickName" })

    // ===== Trước/Sau =====
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })

    // ===== ⭐ Bracket: lấy thêm trường để FE tính V/bảng, rules, ... =====
    .populate({
      path: "bracket",
      select: [
        "name",
        "type",
        "stage",
        "order",
        "drawRounds",
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        "groups._id",
        "groups.name",
        "groups.expectedSize",
        "drawStatus",
        "noRankDelta",
        "scheduler",
        "drawSettings",
        // config.*
        "config.rules",
        "config.roundRobin",
        "config.doubleElim",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
      ].join(" "),
    })
    .lean();

  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }

  // ===== Helpers =====
  const pickTrim = (v) => (v && String(v).trim()) || "";
  const fillNick = (p) => {
    if (!p) return p;
    const primary = pickTrim(p.nickname) || pickTrim(p.nickName);
    const fromUser = p.user
      ? pickTrim(p.user.nickname) || pickTrim(p.user.nickName)
      : "";
    const n = primary || fromUser || "";
    if (n) {
      p.nickname = n;
      p.nickName = n;
    }
    return p;
  };

  // Chuẩn hoá nickname cho players
  if (match.pairA) {
    match.pairA.player1 = fillNick(match.pairA.player1);
    match.pairA.player2 = fillNick(match.pairA.player2);
  }
  if (match.pairB) {
    match.pairB.player1 = fillNick(match.pairB.player1);
    match.pairB.player2 = fillNick(match.pairB.player2);
  }

  // liveBy → chuẩn hoá { _id, name, nickname }
  if (match.liveBy) {
    const lb = match.liveBy;
    match.liveBy = {
      _id: lb._id,
      name: lb.name || "",
      nickname: pickTrim(lb.nickname) || pickTrim(lb.nickName) || "",
    };
  }

  // referee[] → chuẩn hoá { _id, name, nickname }
  if (Array.isArray(match.referee)) {
    match.referee = match.referee.map((r) => ({
      _id: r._id,
      name: r.name || r.fullName || "",
      nickname: pickTrim(r.nickname) || pickTrim(r.nickName) || "",
    }));
  }

  // Bổ sung streams từ meta nếu có
  if (!match.streams && match.meta?.streams) {
    match.streams = match.meta.streams;
  }

  // ===== ⭐ Chuẩn hoá bracket một chút cho FE (optional) =====
  if (match.bracket) {
    const b = match.bracket;

    // Đảm bảo groups luôn là [] để FE dễ duyệt
    if (!Array.isArray(b.groups)) b.groups = [];

    // Đồng nhất key hiển thị meta (nếu thiếu)
    b.meta = b.meta || {};
    if (typeof b.meta.drawSize !== "number") b.meta.drawSize = 0;
    if (typeof b.meta.maxRounds !== "number") b.meta.maxRounds = 0;
    if (typeof b.meta.expectedFirstRoundMatches !== "number")
      b.meta.expectedFirstRoundMatches = 0;

    // Giữ nguyên config.rules… nếu không có cũng trả về object rỗng
    b.config = b.config || {};
    b.config.rules = b.config.rules || {};
    b.config.roundRobin = b.config.roundRobin || {};
    b.config.doubleElim = b.config.doubleElim || {};
    b.config.swiss = b.config.swiss || {};
    b.config.gsl = b.config.gsl || {};
    b.config.roundElim = b.config.roundElim || {};

    // Đảm bảo các cờ khác
    if (typeof b.noRankDelta !== "boolean") b.noRankDelta = false;
    b.scheduler = b.scheduler || {};
    b.drawSettings = b.drawSettings || {};
  }

  return res.json(match);
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

/* ===================== Helpers ===================== */
const clamp = (n, min = 0, max = 99) => Math.max(min, Math.min(max, n));
const toInt = (v, def = 0) => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
};

function sanitizeGameScores(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const it of input) {
    const a = clamp(toInt(it?.a, 0));
    const b = clamp(toInt(it?.b, 0));
    const capped = Boolean(it?.capped && (a > 0 || b > 0));
    out.push({ a, b, capped });
  }
  // cắt đuôi các set rỗng ở cuối
  while (out.length && out.at(-1).a === 0 && out.at(-1).b === 0) out.pop();
  return out;
}

function countSets(gs = []) {
  let A = 0,
    B = 0;
  for (const g of gs) {
    const a = toInt(g?.a, 0),
      b = toInt(g?.b, 0);
    if (a > b) A++;
    else if (b > a) B++;
  }
  return { A, B };
}

function inferWinnerFromScores(rules, gs) {
  const bestOf = rules?.bestOf ?? 1;
  const need = Math.floor(bestOf / 2) + 1;
  const { A, B } = countSets(gs);
  if (A >= need) return "A";
  if (B >= need) return "B";
  return ""; // chưa xác định
}

function normalizeStatusTransition(doc, incomingStatus, incomingWinner) {
  // clone
  const result = {
    status: doc.status,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt,
  };
  const now = new Date();

  switch (incomingStatus) {
    case "live":
      result.status = "live";
      if (!result.startedAt) result.startedAt = now;
      result.finishedAt = null;
      break;
    case "finished":
      result.status = "finished";
      if (!result.startedAt) result.startedAt = doc.startedAt || now;
      result.finishedAt = now;
      break;
    case "scheduled":
    case "queued":
    case "assigned":
      result.status = incomingStatus;
      if (incomingStatus === "scheduled") {
        // chỉ reset finishedAt; giữ startedAt nếu bạn muốn audit, hoặc clear luôn tuỳ policy:
        // result.startedAt = null;
      }
      result.finishedAt = null;
      break;
    default:
      // không đổi
      break;
  }

  // Nếu winner được đặt A/B nhưng status chưa "finished", nâng lên finished
  if (
    (incomingWinner === "A" || incomingWinner === "B") &&
    result.status !== "finished"
  ) {
    result.status = "finished";
    if (!result.startedAt) result.startedAt = doc.startedAt || now;
    result.finishedAt = now;
  }

  return result;
}

function extractUserRoles(user) {
  const roles = new Set(
    [
      String(user?.role || "").toLowerCase(),
      ...(user?.roles || []).map((x) => String(x).toLowerCase()),
      ...(user?.permissions || []).map((x) => String(x).toLowerCase()),
    ].filter(Boolean)
  );
  if (user?.isAdmin) roles.add("admin");
  return roles;
}

function canAdminMatch(user /*, match */) {
  const r = extractUserRoles(user);
  return (
    r.has("admin") ||
    r.has("superadmin") ||
    r.has("tournament:admin") ||
    r.has("tournament:manage")
  );
}

/* ===================== Controllers ===================== */

export const getMatchById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("Invalid match id");
  }

  const match = await Match.findById(id)
    .populate([
      { path: "pairA", select: "player1 player2" },
      { path: "pairB", select: "player1 player2" },
      {
        path: "tournament",
        select: "name organizers managers owner createdBy",
      },
      { path: "bracket", select: "name stage type" },
      { path: "liveBy", select: "name" },
    ])
    .lean();

  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  res.json(match);
});

export const adminPatchMatch = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("Invalid match id");
  }

  // if (!canAdminMatch(req.user)) {
  //   res.status(403);
  //   throw new Error("Bạn không có quyền chỉnh sửa trận này");
  // }

  const match = await Match.findById(id);
  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  const { gameScores, winner, status, pairA, pairB } = req.body || {};

  const hasScoresField = Object.prototype.hasOwnProperty.call(
    req.body,
    "gameScores"
  );
  const hasWinnerField = Object.prototype.hasOwnProperty.call(
    req.body,
    "winner"
  );
  const hasStatusField = Object.prototype.hasOwnProperty.call(
    req.body,
    "status"
  );

  const updates = {};
  let touchLive = false;

  const normPairInput = async (val, sideLabel) => {
    if (typeof val === "undefined")
      return { provided: false, value: undefined };
    if (val === null || val === "") return { provided: true, value: null };

    const rawId = String(val?._id || val?.id || val || "").trim();
    if (!mongoose.isValidObjectId(rawId)) {
      throw new Error(
        sideLabel === "A"
          ? "pairA không hợp lệ"
          : sideLabel === "B"
          ? "pairB không hợp lệ"
          : "pair id không hợp lệ"
      );
    }

    const reg = await Registration.findById(rawId).select("_id tournament");
    if (!reg) {
      throw new Error(
        sideLabel === "A"
          ? "Registration cho pairA không tồn tại"
          : "Registration cho pairB không tồn tại"
      );
    }
    if (String(reg.tournament) !== String(match.tournament)) {
      throw new Error(
        sideLabel === "A"
          ? "pairA không thuộc cùng giải (tournament)"
          : "pairB không thuộc cùng giải (tournament)"
      );
    }
    return { provided: true, value: reg._id };
  };

  // Chuẩn hoá A/B (nếu được gửi)
  try {
    var A = await normPairInput(pairA, "A");
    var B = await normPairInput(pairB, "B");
  } catch (e) {
    res.status(400);
    throw e;
  }

  if (
    A?.provided &&
    B?.provided &&
    A.value &&
    B.value &&
    String(A.value) === String(B.value)
  ) {
    res.status(400);
    throw new Error("pairA và pairB không được trùng nhau");
  }

  const willSetA = A?.provided;
  const willSetB = B?.provided;

  const newA = willSetA
    ? A.value === null
      ? null
      : new mongoose.Types.ObjectId(A.value)
    : match.pairA;
  const newB = willSetB
    ? B.value === null
      ? null
      : new mongoose.Types.ObjectId(B.value)
    : match.pairB;

  const changedA = willSetA && String(newA ?? "") !== String(match.pairA ?? "");
  const changedB = willSetB && String(newB ?? "") !== String(match.pairB ?? "");
  const teamsChanged = changedA || changedB;

  if (teamsChanged) {
    updates.pairA = newA;
    updates.pairB = newB;
    touchLive = true; // bump live
  }

  // 1) gameScores
  if (hasScoresField) {
    const cleansed = sanitizeGameScores(gameScores);
    if (!cleansed) {
      res.status(400);
      throw new Error("gameScores phải là mảng [{a,b}]");
    }
    updates.gameScores = cleansed;
    updates.currentGame = Math.max(0, cleansed.length - 1);
    touchLive = true;
  }

  // 3) winner
  if (hasWinnerField) {
    const w =
      winner === "A" ? "A" : winner === "B" ? "B" : winner === "" ? "" : null;
    if (w === null) {
      res.status(400);
      throw new Error("winner phải là 'A' | 'B' | ''");
    }
    updates.winner = w;
    touchLive = true;
  }

  // 4) status
  if (hasStatusField) {
    const allowed = ["scheduled", "queued", "assigned", "live", "finished"];
    if (!allowed.includes(status)) {
      res.status(400);
      throw new Error(`status không hợp lệ: ${status}`);
    }
    updates.status = status;
    touchLive = true;
  }

  // 5) reopen -> clear winner nếu không finished và client không gửi winner
  if (hasStatusField && status !== "finished" && !hasWinnerField) {
    updates.winner = "";
    touchLive = true;
  }

  // 6) infer winner nếu set finished nhưng không gửi winner
  if (hasStatusField && status === "finished" && !hasWinnerField) {
    const srcScores = updates.gameScores ?? match.gameScores;
    const w = inferWinnerFromScores(match.rules, srcScores);
    if (w) updates.winner = w;
  }

  // 7) normalize theo status + winner
  if (updates.status !== undefined || updates.winner !== undefined) {
    const desiredStatus = updates.status ?? match.status;
    const desiredWinner = updates.winner ?? match.winner;
    const t = normalizeStatusTransition(match, desiredStatus, desiredWinner);
    updates.status = t.status;
    updates.startedAt = t.startedAt;
    updates.finishedAt = t.finishedAt;
  }

  // 8) bump liveVersion nếu có thay đổi liên quan live/score/teams
  if (touchLive) updates.liveVersion = (match.liveVersion || 0) + 1;

  // 9) save
  match.set(updates);
  await match.save();

  const tournamentId = String(match.tournament);

  res.json({
    _id: match._id,
    tournament: match.tournament, // 👈 thêm
    tournamentId, // 👈 thêm (string)
    status: match.status,
    winner: match.winner,
    gameScores: match.gameScores,
    currentGame: match.currentGame,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    liveVersion: match.liveVersion,
    rules: match.rules,
    pairA: match.pairA,
    pairB: match.pairB,
    updatedAt: match.updatedAt,
  });
});
