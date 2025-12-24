import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import mongoose from "mongoose";
import Registration from "../models/registrationModel.js";
import Bracket from "../models/bracketModel.js";
import { applyRatingForFinishedMatch } from "../utils/applyRatingForFinishedMatch.js";
import UserMatch from "../models/userMatchModel.js";
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

  // ===== constants / helpers =====
  const BRACKET_SELECT = [
    "name",
    "type",
    "stage",
    "order",
    "drawRounds",

    // ⬇️ lấy toàn bộ meta của bracket
    "meta",

    "groups._id",
    "groups.name",
    "groups.expectedSize",
    "drawStatus",
    "noRankDelta",
    "scheduler",
    "drawSettings",

    // giữ nguyên các phần config đang dùng
    "config.rules",
    "config.roundRobin",
    "config.doubleElim",
    "config.swiss",
    "config.gsl",
    "config.roundElim",

    "createdAt",
    "tournament",
  ].join(" ");

  const GROUP_LIKE = new Set(["group", "round_robin", "swiss", "gsl"]);
  const isGroupType = (t) => GROUP_LIKE.has(String(t || "").toLowerCase());

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

  const personName = (p) =>
    pickTrim(p?.nickname) ||
    pickTrim(p?.nickName) ||
    pickTrim(p?.user?.nickname) ||
    pickTrim(p?.user?.nickName) ||
    "";

  const pairName = (pair) => {
    if (!pair) return "";
    const a = personName(pair.player1);
    const b = personName(pair.player2);
    if (a || b) return [a, b].filter(Boolean).join(" & ");
    return pickTrim(pair.teamName) || pickTrim(pair.label) || "";
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

  // đổi #R->#B chỉ khi group-like
  const displayLabelKey = (raw, bracketType) => {
    const s = String(raw || "");
    if (!s) return "";
    return isGroupType(bracketType) ? s.replace(/#R(\d+)/i, "#B$1") : s;
  };

  // Lấy T = số cuối trong labelKey; thiếu thì fallback order
  const extractT = (labelKey, order) => {
    const s = String(labelKey || "");
    const m = s.match(/(\d+)\s*$/);
    if (m) return Number(m[1]);
    return Number.isFinite(order) ? Number(order) : 1;
  };

  // ✅ Lấy B (lượt vòng bảng) ƯU TIÊN từ labelKey (#R/#B), thiếu thì rrRound, cuối cùng 1
  const getGroupRoundB = (m) => {
    const lk = String(m?.labelKey || "");
    const hit = lk.match(/#(?:R|B)\s*(\d+)/i);
    if (hit) return Number(hit[1]);
    if (Number.isFinite(m?.rrRound)) return Number(m.rrRound);
    return 1;
  };

  // Tính offset V cho toàn giải
  const buildOffsets = async (tournamentId) => {
    const brackets = await Bracket.find({ tournament: tournamentId })
      .select("_id type order createdAt")
      .lean();

    if (!brackets.length) return { offsetMap: new Map(), typeMap: new Map() };

    const ids = brackets.map((b) => b._id);
    const agg = await Match.aggregate([
      {
        $match: {
          tournament: new mongoose.Types.ObjectId(String(tournamentId)),
          bracket: { $in: ids },
        },
      },
      { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
    ]);

    const maxRoundMap = new Map(
      agg.map((x) => [String(x._id), Number(x.maxRound || 1)])
    );
    const typeMap = new Map(brackets.map((b) => [String(b._id), b.type]));
    const roundsCountMap = new Map(
      brackets.map((b) => [
        String(b._id),
        isGroupType(b.type) ? 1 : maxRoundMap.get(String(b._id)) || 1,
      ])
    );

    const sorted = [...brackets].sort((a, b) => {
      const oa = a.order ?? 9999;
      const ob = b.order ?? 9999;
      if (oa !== ob) return oa - ob;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ca !== cb) return ca - cb;
      return String(a._id).localeCompare(String(b._id));
    });

    let cum = 0;
    const offsetMap = new Map();
    for (const b of sorted) {
      offsetMap.set(String(b._id), cum);
      cum += roundsCountMap.get(String(b._id)) || 1;
    }
    return { offsetMap, typeMap };
  };

  const computeCodeDisplay = (m, offsetMap, typeMap) => {
    const bId = String(m?.bracket?._id || m?.bracket || "");
    const bType = typeMap.get(bId) || m?.bracket?.type;
    const offset = offsetMap.get(bId) || 0;
    const T = extractT(m?.labelKey, m?.order);

    if (isGroupType(bType)) {
      const B = getGroupRoundB(m); // ⬅️ B lấy từ labelKey trước
      const V = offset + 1; // group-like luôn 1 vòng
      return `V${V}-B${B}-T${T}`;
    } else {
      const r = Number(m?.round || 1); // KO: V = offset + round
      const V = offset + r;
      return `V${V}-T${T}`;
    }
  };

  // ===== fetch match =====
  const m = await Match.findById(id)
    // Pairs + players
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
    // refs & liveBy
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .populate({ path: "liveBy", select: "name nickname nickName" })
    // neighbors
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    // bracket
    .populate({ path: "bracket", select: BRACKET_SELECT })
    .lean();

  if (!m) return res.status(404).json({ message: "Match not found" });

  // chuẩn hoá tên
  if (m.pairA) {
    m.pairA.player1 = fillNick(m.pairA.player1);
    m.pairA.player2 = fillNick(m.pairA.player2);
  }
  if (m.pairB) {
    m.pairB.player1 = fillNick(m.pairB.player1);
    m.pairB.player2 = fillNick(m.pairB.player2);
  }
  if (m.liveBy) {
    const lb = m.liveBy;
    m.liveBy = {
      _id: lb._id,
      name: lb.name || "",
      nickname: pickTrim(lb.nickname) || pickTrim(lb.nickName) || "",
    };
  }
  if (Array.isArray(m.referee)) {
    m.referee = m.referee.map((r) => ({
      _id: r._id,
      name: r.name || r.fullName || "",
      nickname: pickTrim(r.nickname) || pickTrim(r.nickName) || "",
    }));
  }
  if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

  m.bracket = normalizeBracketShape(m.bracket);
  m.pairAName = pairName(m.pairA);
  m.pairBName = pairName(m.pairB);

  // ===== codeDisplay + labelKeyDisplay =====
  try {
    const tournamentId = m.bracket?.tournament || m.tournament || null;
    const { offsetMap, typeMap } = tournamentId
      ? await buildOffsets(tournamentId)
      : {
          offsetMap: new Map(),
          typeMap: new Map([[String(m?.bracket?._id || ""), m?.bracket?.type]]),
        };

    const bType =
      typeMap.get(String(m?.bracket?._id || "")) || m?.bracket?.type;
    m.labelKeyDisplay = displayLabelKey(m.labelKey, bType);
    m.codeDisplay = computeCodeDisplay(m, offsetMap, typeMap);
  } catch (e) {
    // fallback an toàn nếu có lỗi
    const bType = m?.bracket?.type;
    m.labelKeyDisplay = displayLabelKey(m.labelKey, bType);
    const T = extractT(m?.labelKey, m?.order);
    if (isGroupType(bType)) {
      const B = getGroupRoundB(m);
      m.codeDisplay = `V1-B${B}-T${T}`;
    } else {
      const r = Number(m?.round || 1);
      m.codeDisplay = `V${r}-T${T}`;
    }
  }

  // ===== prevBracket (giữ như cũ) =====
  m.prevBracket = null;
  m.prevBrackets = [];
  try {
    const curMeta = await Bracket.findById(m.bracket?._id)
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
        _id: { $ne: m.bracket._id },
      })
        .select(BRACKET_SELECT)
        .sort({ order: -1, createdAt: -1, _id: -1 })
        .lean();

      if (prev) {
        m.prevBracket = normalizeBracketShape(prev);
        m.prevBrackets = [m.prevBracket];
      }
    }
  } catch (e) {
    console.error("[getMatchPublic] prevBracket error:", e?.message || e);
  }

  return res.json({ ...m, code: m.codeDisplay });
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
  let A, B;
  try {
    A = await normPairInput(pairA, "A");
    B = await normPairInput(pairB, "B");
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

  // 10) nếu match đã finished + winner hợp lệ -> apply rating
  if (
    match.status === "finished" &&
    match.winner &&
    (match.winner === "A" || match.winner === "B") &&
    !match?.ratingApplied
  ) {
    try {
      await applyRatingForFinishedMatch(match._id);
    } catch (err) {
      console.error(
        "[adminPatchMatch] applyRatingForFinishedMatch error:",
        err
      );
    }
  }

  const tournamentId = String(match.tournament);

  // 11) SOCKET: bắn snapshot match vừa update
  try {
    const io = req.app.get("io");
    if (io) {
      const m = await Match.findById(match._id)
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
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
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "referee",
          select: "name fullName nickname nickName",
        })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        .populate({
          path: "bracket",
          select: [
            "noRankDelta",
            "name",
            "type",
            "stage",
            "order",
            "drawRounds",
            "drawStatus",
            "scheduler",
            "drawSettings",
            "meta.drawSize",
            "meta.maxRounds",
            "meta.expectedFirstRoundMatches",
            "groups._id",
            "groups.name",
            "groups.expectedSize",
            "config.rules",
            "config.doubleElim",
            "config.roundRobin",
            "config.swiss",
            "config.gsl",
            "config.roundElim",
            "overlay",
          ].join(" "),
        })
        .populate({
          path: "court",
          select: "name number code label zone area venue building floor",
        })
        .populate({
          path: "liveBy",
          select: "name fullName nickname nickName",
        })
        .select(
          "label managers court courtLabel courtCluster " +
            "scheduledAt startAt startedAt finishedAt status " +
            "tournament bracket rules currentGame gameScores " +
            "round order roundCode roundName " +
            "seedA seedB previousA previousB nextMatch winner serve overlay " +
            "video videoUrl stream streams meta " +
            "format rrRound pool " +
            "liveBy liveVersion"
        )
        .lean();

      if (m) {
        const pick = (v) => (v && String(v).trim()) || "";
        const fillNick = (p) => {
          if (!p) return p;
          const primary = pick(p.nickname) || pick(p.nickName);
          const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
          const n = primary || fromUser || "";
          if (n) {
            p.nickname = n;
            p.nickName = n;
          }
          return p;
        };

        if (m.pairA) {
          m.pairA.player1 = fillNick(m.pairA.player1);
          m.pairA.player2 = fillNick(m.pairA.player2);
        }
        if (m.pairB) {
          m.pairB.player1 = fillNick(m.pairB.player1);
          m.pairB.player2 = fillNick(m.pairB.player2);
        }

        if (!m.streams && m.meta?.streams) {
          m.streams = m.meta.streams;
        }

        const dto = typeof toDTO === "function" ? toDTO(m) : m;

        io.to(String(m._id)).emit("status:updated", {
          matchId: m._id,
          status: m.status,
        });

        io.to(`match:${String(m._id)}`).emit("match:snapshot", dto);
      }
    }
  } catch (err) {
    console.error("[adminPatchMatch] socket emit error:", err);
  }

  // 12) response
  res.json({
    _id: match._id,
    tournament: match.tournament,
    tournamentId,
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
const ALLOWED_PLATFORMS = new Set([
  "facebook",
  "youtube",
  "tiktok",
  "rtmp",
  "other",
]);

const normPlatform = (p) => {
  if (!p) return "other";
  const s = String(p).toLowerCase().trim();
  return ALLOWED_PLATFORMS.has(s) ? s : "other";
};

const parseTs = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  return Number.isFinite(d.getTime()) ? d : new Date();
};

const ensureLiveShape = (live = {}) => {
  const out = {
    status: "idle",
    platforms: {},
    sessions: [],
    lastChangedAt: new Date(),
  };
  if (live && typeof live === "object") {
    out.status = live.status || "idle";
    out.platforms =
      live.platforms && typeof live.platforms === "object"
        ? { ...live.platforms }
        : {};
    out.sessions = Array.isArray(live.sessions) ? [...live.sessions] : [];
    out.lastChangedAt = live.lastChangedAt
      ? new Date(live.lastChangedAt)
      : new Date();
  }
  return out;
};

const emitSocket = (req, matchId, payload) => {
  try {
    const io = req.app?.get?.("io");
    if (io) io.to(`match:${matchId}`).emit("live_status", payload);
  } catch {}
};

/**
 * POST /api/matches/:id/live/start
 * body: { platform, timestamp? }
 */
export const notifyStreamStarted = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("matchId không hợp lệ");
  }

  const platform = normPlatform(req.body?.platform);
  const startedAt = parseTs(req.body?.timestamp);

  const matchKindHeader =
    req.get("x-pkt-match-kind") || req.headers["x-pkt-match-kind"];

  // ====================== USER MATCH BRANCH ======================
  if (matchKindHeader) {
    const userMatch = await UserMatch.findById(id).select("live").lean();
    if (!userMatch) {
      res.status(404);
      throw new Error("UserMatch không tồn tại");
    }

    const live = ensureLiveShape(userMatch.live);

    // Idempotent: nếu đã có session đang mở cho platform thì không push thêm
    const hasOpen = live.sessions.some(
      (s) => s.platform === platform && !s.endedAt
    );

    if (!hasOpen) {
      live.sessions.push({ platform, startedAt, endedAt: null });
    }

    // Bật cờ platform và trạng thái tổng
    live.platforms[platform] = {
      ...(live.platforms[platform] || {}),
      active: true,
      lastStartAt: startedAt,
    };
    live.status = "live";
    live.lastChangedAt = new Date();

    const updated = await UserMatch.findByIdAndUpdate(
      id,
      {
        $set: {
          "live.status": live.status,
          "live.lastChangedAt": live.lastChangedAt,
          [`live.platforms.${platform}`]: live.platforms[platform],
          "live.sessions": live.sessions,
        },
      },
      { new: true }
    )
      .select("live")
      .lean();

    emitSocket(req, id, {
      matchId: id,
      platform,
      status: "live",
      live: updated.live,
    });

    return res.json({
      ok: true,
      matchId: id,
      platform,
      status: "live",
      live: updated.live,
    });
  }

  // ====================== MATCH BRANCH (LOGIC CŨ) ======================
  const match = await Match.findById(id).select("live").lean();
  if (!match) {
    res.status(404);
    throw new Error("Match không tồn tại");
  }

  const live = ensureLiveShape(match.live);

  // Idempotent: nếu đã có session đang mở cho platform thì không push thêm
  const hasOpen = live.sessions.some(
    (s) => s.platform === platform && !s.endedAt
  );

  if (!hasOpen) {
    live.sessions.push({ platform, startedAt, endedAt: null });
  }

  // Bật cờ platform và trạng thái tổng
  live.platforms[platform] = {
    ...(live.platforms[platform] || {}),
    active: true,
    lastStartAt: startedAt,
  };
  live.status = "live";
  live.lastChangedAt = new Date();

  const updated = await Match.findByIdAndUpdate(
    id,
    {
      $set: {
        "live.status": live.status,
        "live.lastChangedAt": live.lastChangedAt,
        [`live.platforms.${platform}`]: live.platforms[platform],
        // Ghi đè toàn bộ sessions (đơn giản, dễ hiểu; nếu muốn atomic bằng arrayFilters có thể nâng cấp sau)
        "live.sessions": live.sessions,
      },
    },
    { new: true }
  )
    .select("live")
    .lean();

  emitSocket(req, id, {
    matchId: id,
    platform,
    status: "live",
    live: updated.live,
  });

  res.json({
    ok: true,
    matchId: id,
    platform,
    status: "live",
    live: updated.live,
  });
});

/**
 * POST /api/matches/:id/live/end
 * body: { platform, timestamp? }
 */
/**
 * POST /api/matches/:id/live/end
 * body: { platform, timestamp? }
 */

function pickFacebookMeta(doc) {
  const liveVideoId =
    doc?.facebookLive?.videoId ||
    doc?.facebookLive?.liveVideoId ||
    doc?.live?.platforms?.facebook?.liveVideoId ||
    doc?.live?.platforms?.facebook?.id ||
    null;

  // ✅ token lấy trực tiếp từ facebookLive trong doc
  const pageAccessToken =
    doc?.facebookLive?.pageAccessToken ||
    doc?.facebookLive?.pageToken ||
    doc?.facebookLive?.accessToken ||
    doc?.facebookLive?.access_token ||
    null;

  const pageId =
    doc?.facebookLive?.pageId ||
    doc?.facebookLive?.page_id ||
    doc?.facebookLive?.page?.id ||
    doc?.live?.platforms?.facebook?.pageId ||
    doc?.live?.platforms?.facebook?.page_id ||
    null;

  return {
    liveVideoId: liveVideoId ? String(liveVideoId) : null,
    pageId: pageId ? String(pageId) : null,
    pageAccessToken: pageAccessToken ? String(pageAccessToken) : null,
  };
}

async function endFacebookLiveVideo({
  liveVideoId,
  pageAccessToken,
  graphVersion = process.env.FB_GRAPH_VERSION || "v21.0",
}) {
  if (!liveVideoId || !pageAccessToken) {
    return { skipped: true, reason: "missing_liveVideoId_or_pageAccessToken" };
  }

  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(
    String(liveVideoId)
  )}`;

  try {
    const resp = await axios.post(
      url,
      null,
      {
        params: { end_live_video: true },
        headers: {
          Authorization: `Bearer ${pageAccessToken}`,
          Accept: "application/json",
        },
        timeout: 12_000,
      }
    );

    return { status: resp.status, data: resp.data };
  } catch (err) {
    return {
      error: true,
      status: err?.response?.status || 0,
      data: err?.response?.data || { message: err?.message },
    };
  }
}

export const notifyStreamEnded = asyncHandler(async (req, res) => {
  console.log(1234567890);

  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("matchId không hợp lệ");
  }

  const platform = normPlatform(req.body?.platform);
  const endedAt = parseTs(req.body?.timestamp);

  const matchKindHeader =
    req.get("x-pkt-match-kind") || req.headers["x-pkt-match-kind"];

  // ====================== USER MATCH BRANCH ======================
  if (matchKindHeader) {
    // ✅ cần lấy facebookLive để có pageAccessToken + liveVideoId
    const userMatch = await UserMatch.findById(id)
      .select("live facebookLive")
      .lean();

    if (!userMatch) {
      res.status(404);
      throw new Error("UserMatch không tồn tại");
    }

    const live = ensureLiveShape(userMatch.live);

    // đóng session gần nhất
    for (let i = live.sessions.length - 1; i >= 0; i--) {
      const s = live.sessions[i];
      if (s.platform === platform && !s.endedAt) {
        s.endedAt = endedAt;
        break;
      }
    }

    // tắt cờ platform
    live.platforms[platform] = {
      ...(live.platforms[platform] || {}),
      active: false,
      lastEndAt: endedAt,
    };

    // status
    const anyActive = Object.values(live.platforms).some(
      (p) => p?.active === true
    );
    live.status = anyActive ? "live" : "idle";
    live.lastChangedAt = new Date();

    const updated = await UserMatch.findByIdAndUpdate(
      id,
      {
        $set: {
          "live.status": live.status,
          "live.lastChangedAt": live.lastChangedAt,
          [`live.platforms.${platform}`]: live.platforms[platform],
          "live.sessions": live.sessions,
        },
      },
      { new: true }
    )
      .select("live")
      .lean();

    // ======= END LIVE FACEBOOK (UserMatch): token lấy từ userMatch.facebookLive.pageAccessToken =======
    if (platform === "facebook") {
      const { pageId, liveVideoId, pageAccessToken } = pickFacebookMeta(userMatch);

      try {
        const fbRes = await endFacebookLiveVideo({
          liveVideoId,
          pageAccessToken,
        });

        // không throw để không làm fail API chính
        if (fbRes?.error || fbRes?.skipped) {
          console.warn("[FB][UserMatch] end_live failed/skipped:", {
            userMatchId: id,
            pageId,
            liveVideoId,
            status: fbRes?.status,
            data: fbRes?.data,
            skippedReason: fbRes?.reason,
          });
        }
      } catch (e) {
        console.warn("[FB][UserMatch] end_live exception:", e?.message || e);
      }
    }

    emitSocket(req, id, {
      matchId: id,
      platform,
      status: live.status,
      live: updated.live,
    });

    return res.json({
      ok: true,
      matchId: id,
      platform,
      status: live.status,
      live: updated.live,
    });
  }

  // ====================== MATCH BRANCH (LOGIC CŨ) ======================
  // ✅ cần lấy facebookLive để có pageAccessToken + liveVideoId
  const match = await Match.findById(id).select("live facebookLive").lean();
  if (!match) {
    res.status(404);
    throw new Error("Match không tồn tại");
  }

  const live = ensureLiveShape(match.live);

  // đóng session gần nhất
  for (let i = live.sessions.length - 1; i >= 0; i--) {
    const s = live.sessions[i];
    if (s.platform === platform && !s.endedAt) {
      s.endedAt = endedAt;
      break;
    }
  }

  // tắt cờ platform
  live.platforms[platform] = {
    ...(live.platforms[platform] || {}),
    active: false,
    lastEndAt: endedAt,
  };

  // status
  const anyActive = Object.values(live.platforms).some(
    (p) => p?.active === true
  );
  live.status = anyActive ? "live" : "idle";
  live.lastChangedAt = new Date();

  const updated = await Match.findByIdAndUpdate(
    id,
    {
      $set: {
        "live.status": live.status,
        "live.lastChangedAt": live.lastChangedAt,
        [`live.platforms.${platform}`]: live.platforms[platform],
        "live.sessions": live.sessions,
      },
    },
    { new: true }
  )
    .select("live")
    .lean();

  // ======= END LIVE FACEBOOK (Match): token lấy từ match.facebookLive.pageAccessToken =======
  if (platform === "all") {
    const { pageId, liveVideoId, pageAccessToken } = pickFacebookMeta(match);

    try {
      const fbRes = await endFacebookLiveVideo({
        liveVideoId,
        pageAccessToken,
      });

      if (fbRes?.error || fbRes?.skipped) {
        console.warn("[FB][Match] end_live failed/skipped:", {
          matchId: id,
          pageId,
          liveVideoId,
          status: fbRes?.status,
          data: fbRes?.data,
          skippedReason: fbRes?.reason,
        });
      }
    } catch (e) {
      console.warn("[FB][Match] end_live exception:", e?.message || e);
    }
  }

  emitSocket(req, id, {
    matchId: id,
    platform,
    status: live.status,
    live: updated.live,
  });

  return res.json({
    ok: true,
    matchId: id,
    platform,
    status: live.status,
    live: updated.live,
  });
});

export const updateMatchSettings = asyncHandler(async (req, res) => {
  try {
    const { matchId } = req.params;

    // ✅ 1. Logic chọn Model dựa trên Header
    // Lấy header (lưu ý: header trong nodejs thường tự chuyển về chữ thường)
    const matchKindHeader = req.headers["x-pkt-match-kind"];

    let TargetModel;

    // Nếu có header này (bất kể giá trị là gì, miễn là có gửi lên) -> dùng UserMatch
    // Hoặc bạn có thể check kỹ hơn: if (matchKindHeader === 'user') ...
    if (matchKindHeader) {
      console.log(`[API] Updating UserMatch (Kind: ${matchKindHeader})`);
      TargetModel = UserMatch;
    } else {
      console.log("[API] Updating Standard Match");
      TargetModel = Match;
    }

    // ✅ 2. Chuẩn bị dữ liệu update
    // Frontend gửi lên: { bestOf, pointsToWin, winByTwo, cap, timeoutPerGame... }
    // Database thường lưu: { rules: { bestOf... }, timeoutPerGame... }
    const {
      bestOf,
      pointsToWin,
      winByTwo,
      cap,
      timeoutPerGame,
      timeoutMinutes,
      medicalTimeouts,
    } = req.body;

    // Sử dụng dot notation để update field lồng nhau (nested fields) mà không ghi đè cả object rules
    const updateData = {
      "rules.bestOf": bestOf,
      "rules.pointsToWin": pointsToWin,
      "rules.winByTwo": winByTwo,
      "rules.cap": cap, // object { mode, points }

      // Các field nằm ngoài rules (tùy schema của bạn)
      timeoutPerGame,
      timeoutMinutes,
      medicalTimeouts,
    };

    // Loại bỏ các key undefined (tránh lỗi nếu frontend không gửi field đó)
    Object.keys(updateData).forEach(
      (key) => updateData[key] === undefined && delete updateData[key]
    );

    // ✅ 3. Thực hiện Update
    const updatedMatch = await TargetModel.findByIdAndUpdate(
      matchId,
      { $set: updateData },
      { new: true, runValidators: true } // new: true để trả về data sau khi update
    );

    if (!updatedMatch) {
      return res.status(404).json({ message: "Không tìm thấy trận đấu này." });
    }

    res.status(200).json(updatedMatch);
  } catch (error) {
    console.error("Update Match Error:", error);
    res.status(500).json({
      message: "Lỗi server khi cập nhật trận đấu.",
      error: error.message,
    });
  }
});
