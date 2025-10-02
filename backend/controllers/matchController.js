import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import mongoose from "mongoose";
import Registration from "../models/registrationModel.js";
import Bracket from "../models/bracketModel.js";
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

    // ===== Bracket hiện tại (kèm groups) =====
    {
      $lookup: {
        from: "brackets",
        localField: "bracket",
        foreignField: "_id",
        as: "_br",
      },
    },
    { $addFields: { _br: { $arrayElemAt: ["$_br", 0] } } },

    // ===== Lấy toàn bộ brackets & tính _span (group bucket lên trước) =====
    {
      $lookup: {
        from: "brackets",
        let: { tId: "$tournament" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tId"] } } },
          { $addFields: { __tNorm: { $toLower: { $ifNull: ["$type", ""] } } } },
          {
            $addFields: {
              __isGroup: {
                $in: ["$__tNorm", ["group", "round_robin", "gsl", "swiss"]],
              },
              __isRoundElim: {
                $in: [
                  "$__tNorm",
                  ["po", "roundelim", "round_elim", "round-elim"],
                ],
              },
            },
          },
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
          { $addFields: { _mxAgg: { $arrayElemAt: ["$_mx", 0] } } },
          {
            $addFields: {
              _roundsFromMatches: {
                $max: [
                  { $ifNull: ["$_mxAgg.maxRound", 0] },
                  { $ifNull: ["$_mxAgg.roundCount", 0] },
                ],
              },
              _metaRounds: {
                $max: [
                  { $ifNull: ["$meta.maxRounds", 0] },
                  { $ifNull: ["$drawRounds", 0] },
                ],
              },
              _reCutRounds: { $ifNull: ["$config.roundElim.cutRounds", 0] },
            },
          },
          {
            $addFields: {
              _span: {
                $switch: {
                  branches: [
                    { case: "$__isGroup", then: 1 },
                    {
                      case: "$__isRoundElim",
                      then: {
                        $max: [
                          1,
                          "$_roundsFromMatches",
                          "$_reCutRounds",
                          "$_metaRounds",
                        ],
                      },
                    },
                    {
                      case: { $not: "$__isGroup" },
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
          { $sort: { __isGroup: -1, stage: 1, order: 1, _id: 1 } }, // group trước
          { $project: { _id: 1, stage: 1, order: 1, _span: 1, __isGroup: 1 } },
        ],
        as: "_allBrs",
      },
    },

    // ===== Base round start (V1 = bucket đầu) =====
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

    // ===== Type hiện tại =====
    { $addFields: { _typeNorm: { $toLower: { $ifNull: ["$_br.type", ""] } } } },
    {
      $addFields: {
        _isGroupType: {
          $in: ["$_typeNorm", ["group", "round_robin", "gsl", "swiss"]],
        },
      },
    },

    // ===== Join registrations/users/court/referees =====
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

    // ===== Time helpers =====
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
            { $gt: [{ $size: { $ifNull: ["$gameScores", []] } }, 0] },
            { $arrayElemAt: ["$gameScores", -1] },
            { a: 0, b: 0 },
          ],
        },
      },
    },

    // ===== Team labels (rút gọn phần nickname) =====
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
                        {
                          $convert: {
                            input: "$$r.fullName",
                            to: "string",
                            onError: "??",
                            onNull: "??",
                          },
                        },
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
                        {
                          $convert: {
                            input: "$$r.fullName",
                            to: "string",
                            onError: "",
                            onNull: "",
                          },
                        },
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
                        {
                          $convert: {
                            input: "$$r.fullName",
                            to: "string",
                            onError: "??",
                            onNull: "??",
                          },
                        },
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
                        {
                          $convert: {
                            input: "$$r.fullName",
                            to: "string",
                            onError: "",
                            onNull: "",
                          },
                        },
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

    // ===== SUY LUẬN GROUP NO + T ORDER (và FIX $indexOfCP) =====
    // Chuẩn hoá inputs cho group no
    {
      $addFields: {
        _poolNameStr: {
          $convert: {
            input: { $ifNull: ["$pool.name", { $ifNull: ["$groupCode", ""] }] },
            to: "string",
            onError: "",
            onNull: "",
          },
        },
        _br_group_names: {
          $map: {
            input: { $ifNull: ["$_br.groups", []] },
            as: "g",
            in: {
              $convert: {
                input: { $ifNull: ["$$g.name", ""] },
                to: "string",
                onError: "",
                onNull: "",
              },
            },
          },
        },
        _br_group_ids: {
          $map: {
            input: { $ifNull: ["$_br.groups", []] },
            as: "g",
            in: "$$g._id",
          },
        },
      },
    },
    // Trích số từ tên bảng (A1/B2/… hoặc "Bảng 3")
    {
      $addFields: {
        _rxDigits: { $regexFind: { input: "$_poolNameStr", regex: "\\d+" } },
      },
    },
    {
      $addFields: {
        _numFromName: {
          $convert: {
            input: "$_rxDigits.match",
            to: "int",
            onError: null,
            onNull: null,
          },
        },
      },
    },

    // LẤY CHỮ CÁI ĐẦU AN TOÀN → luôn là chuỗi 1 ký tự hoặc ""
    {
      $addFields: {
        _alphaChar: { $substrCP: [{ $toUpper: "$_poolNameStr" }, 0, 1] },
      },
    },
    {
      $addFields: {
        _alphaIndex: {
          $let: {
            vars: {
              ch: {
                $convert: {
                  input: "$_alphaChar",
                  to: "string",
                  onError: "",
                  onNull: "",
                },
              },
            },
            in: {
              $let: {
                vars: {
                  pos: { $indexOfCP: ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "$$ch"] },
                },
                in: {
                  $cond: [{ $gte: ["$$pos", 0] }, { $add: ["$$pos", 1] }, null],
                },
              },
            },
          },
        },
      },
    },

    // Map theo groups trong bracket
    {
      $addFields: {
        _idxById: {
          $let: {
            vars: { key: { $ifNull: ["$pool.id", null] } },
            in: {
              $let: {
                vars: { pos: { $indexOfArray: ["$_br_group_ids", "$$key"] } },
                in: {
                  $cond: [{ $gte: ["$$pos", 0] }, { $add: ["$$pos", 1] }, null],
                },
              },
            },
          },
        },
        _idxByName: {
          $let: {
            vars: { key: "$_poolNameStr" },
            in: {
              $let: {
                vars: { pos: { $indexOfArray: ["$_br_group_names", "$$key"] } },
                in: {
                  $cond: [{ $gte: ["$$pos", 0] }, { $add: ["$$pos", 1] }, null],
                },
              },
            },
          },
        },
      },
    },

    // Các ứng viên số bảng trực tiếp
    {
      $addFields: {
        _candNums: [
          "$groupNo",
          "$groupIndex",
          "$groupIdx",
          "$group",
          "$meta.groupNo",
          "$meta.groupIndex",
          "$meta.pool",
          "$group.no",
          "$group.index",
          "$group.order",
          "$pool.index",
          "$pool.no",
          "$pool.order",
        ],
      },
    },
    {
      $addFields: {
        _candNumsConv: {
          $map: {
            input: "$_candNums",
            as: "c",
            in: {
              $convert: {
                input: "$$c",
                to: "int",
                onError: null,
                onNull: null,
              },
            },
          },
        },
        _candNumsFiltered: {
          $filter: {
            input: "$_candNumsConv",
            as: "n",
            cond: { $and: [{ $ne: ["$$n", null] }, { $gte: ["$$n", 1] }] },
          },
        },
      },
    },
    {
      $addFields: {
        _idxFromDirect: { $arrayElemAt: ["$_candNumsFiltered", 0] },
      },
    },

    // Group index cuối cùng
    {
      $addFields: {
        _groupIndexFinal: {
          $cond: [
            "$_isGroupType",
            {
              $ifNull: [
                "$_idxById",
                {
                  $ifNull: [
                    "$_idxByName",
                    {
                      $ifNull: [
                        "$_numFromName",
                        { $ifNull: ["$_alphaIndex", "$_idxFromDirect"] },
                      ],
                    },
                  ],
                },
              ],
            },
            null,
          ],
        },
      },
    },

    // === Lấy T từ labelKey qua captures[0] (không dính dấu '#') ===
    {
      $addFields: {
        _rxEndHash: {
          $regexFind: {
            input: {
              $convert: {
                input: "$labelKey",
                to: "string",
                onError: "",
                onNull: "",
              },
            },
            regex: "#(\\d+)\\s*$",
          },
        },
      },
    },
    {
      $addFields: {
        _tFromLabel: {
          $convert: {
            input: { $arrayElemAt: ["$_rxEndHash.captures", 0] },
            to: "int",
            onError: null,
            onNull: null,
          },
        },
      },
    },

    // === Fallback: mặc định 0 rồi +1 → luôn tối thiểu T1 (không còn T0) ===
    {
      $addFields: {
        _tOrderGroup: {
          $ifNull: [
            "$_tFromLabel",
            {
              $let: {
                vars: {
                  oig: {
                    $convert: {
                      input: {
                        $ifNull: ["$orderInGroup", "$meta.orderInGroup"],
                      },
                      to: "int",
                      onError: null,
                      onNull: null,
                    },
                  },
                },
                in: {
                  $cond: [{ $ne: ["$$oig", null] }, { $add: ["$$oig", 1] }, 1],
                },
              },
            },
          ],
        },
        _tOrderKO: {
          $ifNull: [
            "$_tFromLabel",
            {
              $let: {
                vars: {
                  base: {
                    $convert: {
                      input: {
                        $ifNull: [
                          "$order",
                          {
                            $ifNull: [
                              "$meta.order",
                              {
                                $ifNull: [
                                  "$matchNo",
                                  { $ifNull: ["$index", null] },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                      to: "int",
                      onError: null,
                      onNull: null,
                    },
                  },
                },
                in: {
                  $cond: [
                    { $ne: ["$$base", null] },
                    { $add: ["$$base", 1] },
                    1,
                  ],
                },
              },
            },
          ],
        },
      },
    },

    // ===== Sort keys =====
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

    // ===== Project: code chuẩn + thông tin kèm theo =====
    {
      $project: {
        _id: 1,
        code: {
          $cond: [
            "$_isGroupType",
            {
              $let: {
                vars: {
                  b: "$_groupIndexFinal",
                  t: { $ifNull: ["$_tOrderGroup", 1] },
                },
                in: {
                  $concat: [
                    "V1-",
                    {
                      $cond: [
                        { $ne: ["$$b", null] },
                        { $concat: ["B", { $toString: "$$b" }] },
                        "B?",
                      ],
                    },
                    "-T",
                    { $toString: "$$t" },
                  ],
                },
              },
            },
            {
              $let: {
                vars: {
                  disp: {
                    $add: [
                      "$_baseRoundStart",
                      { $add: [{ $ifNull: ["$round", 1] }, -1] },
                    ],
                  },
                  t: { $ifNull: ["$_tOrderKO", 1] },
                },
                in: {
                  $concat: [
                    "V",
                    { $toString: "$$disp" },
                    "-T",
                    { $toString: "$$t" },
                  ],
                },
              },
            },
          ],
        },

        // Bracket
        bracketId: "$_br._id",
        bracketName: "$_br.name",
        bracketType: "$_br.type",
        bracketStage: "$_br.stage",
        bracketOrder: "$_br.order",

        // Time
        date: "$_outDate",
        time: "$_outTime",
        scheduledAtISO: {
          $cond: [
            { $ifNull: ["$scheduledAt", false] },
            { $toString: "$scheduledAt" },
            null,
          ],
        },

        // Teams & scores
        team1: "$_team1",
        team2: "$_team2",
        score1: { $ifNull: ["$_lastSet.a", 0] },
        score2: { $ifNull: ["$_lastSet.b", 0] },

        // Court
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

        // Referee
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
        referees: {
          $map: {
            input: { $ifNull: ["$_ref", []] },
            as: "r",
            in: { _id: "$$r._id", name: "$$r.name", nickname: "$$r.nickname" },
          },
        },

        // Status
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

  const BRACKET_SELECT = [
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
    "config.rules",
    "config.roundRobin",
    "config.doubleElim",
    "config.swiss",
    "config.gsl",
    "config.roundElim",
    "createdAt",
    "tournament",
  ].join(" ");

  const match = await Match.findById(id)
    // ===== Pairs A/B + players =====
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

    // ===== Bracket của match =====
    .populate({ path: "bracket", select: BRACKET_SELECT })
    .lean();

  if (!match) return res.status(404).json({ message: "Match not found" });

  // ===== Helpers bạn đang dùng (rút gọn) =====
  const pickTrim = (v) => (v && String(v).trim()) || "";
  const fillNick = (p) => {
    if (!p) return p;
    const primary = pickTrim(p.nickname) || pickTrim(p.nickName);
    const fromUser = p.user
      ? pickTrim(p.user.nickname) || pickTrim(p.user.nickName)
      : "";
    const n = primary || fromUser || "";
    if (n) p.nickname = p.nickName = n;
    return p;
  };
  const normalizeBracketShape = (b) => {
    if (!b) return b;
    const bb = { ...b };
    if (!Array.isArray(bb.groups)) bb.groups = [];
    bb.meta = bb.meta || {};
    if (typeof bb.meta.drawSize !== "number") bb.meta.drawSize = 0;
    if (typeof bb.meta.maxRounds !== "number") bb.meta.maxRounds = 0;
    if (typeof bb.meta.expectedFirstRoundMatches !== "number")
      bb.meta.expectedFirstRoundMatches = 0;
    bb.config = bb.config || {};
    bb.config.rules = bb.config.rules || {};
    bb.config.roundRobin = bb.config.roundRobin || {};
    bb.config.doubleElim = bb.config.doubleElim || {};
    bb.config.swiss = bb.config.swiss || {};
    bb.config.gsl = bb.config.gsl || {};
    bb.config.roundElim = bb.config.roundElim || {};
    if (typeof bb.noRankDelta !== "boolean") bb.noRankDelta = false;
    bb.scheduler = bb.scheduler || {};
    bb.drawSettings = bb.drawSettings || {};
    return bb;
  };

  if (match.pairA) {
    match.pairA.player1 = fillNick(match.pairA.player1);
    match.pairA.player2 = fillNick(match.pairA.player2);
  }
  if (match.pairB) {
    match.pairB.player1 = fillNick(match.pairB.player1);
    match.pairB.player2 = fillNick(match.pairB.player2);
  }
  if (match.liveBy) {
    const lb = match.liveBy;
    match.liveBy = {
      _id: lb._id,
      name: lb.name || "",
      nickname: pickTrim(lb.nickname) || pickTrim(lb.nickName) || "",
    };
  }
  if (Array.isArray(match.referee)) {
    match.referee = match.referee.map((r) => ({
      _id: r._id,
      name: r.name || r.fullName || "",
      nickname: pickTrim(r.nickname) || pickTrim(r.nickName) || "",
    }));
  }
  if (!match.streams && match.meta?.streams) match.streams = match.meta.streams;

  match.bracket = normalizeBracketShape(match.bracket);

  // ================== ⭐ LẤY BRACKET LIỀN TRƯỚC (chuẩn) ==================
  match.prevBracket = null;
  match.prevBrackets = [];

  try {
    // LẤY LẠI meta của bracket hiện tại trực tiếp từ DB (chắc ăn)
    const curMeta = await Bracket.findById(match.bracket?._id)
      .select("tournament order createdAt")
      .lean();

    if (curMeta?.tournament) {
      const prev = await Bracket.findOne({
        tournament: curMeta.tournament,
        $or: [
          { order: { $lt: curMeta.order ?? 0 } },
          {
            order: curMeta.order ?? 0,
            createdAt: { $lt: curMeta.createdAt || new Date(0) },
          },
        ],
        _id: { $ne: match.bracket._id },
      })
        .select(BRACKET_SELECT)
        .sort({ order: -1, createdAt: -1, _id: -1 })
        .lean();

      if (prev) {
        match.prevBracket = normalizeBracketShape(prev);
        match.prevBrackets = [match.prevBracket]; // để tương thích nếu FE đang expect mảng
      }
    }
    return res.json(match);
  } catch (e) {
    console.error("[getMatchPublic] prevBracket error:", e?.message || e);

    return res.status(500);
  }
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
