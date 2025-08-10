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

    // Lấy tournament để biết regOpenDate/startDate
    {
      $lookup: {
        from: "tournaments",
        localField: "tournament",
        foreignField: "_id",
        as: "_tour",
      },
    },
    { $unwind: "$_tour" },

    // pairA/pairB
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

    // referee
    {
      $lookup: {
        from: "users",
        localField: "referee",
        foreignField: "_id",
        as: "_ref",
      },
    },
    { $addFields: { _ref: { $arrayElemAt: ["$_ref", 0] } } },

    // court (nếu có)
    {
      $lookup: {
        from: "courts",
        localField: "court",
        foreignField: "_id",
        as: "_court",
      },
    },
    { $addFields: { _court: { $arrayElemAt: ["$_court", 0] } } },

    // Tính "tournamentUpcoming" = hôm nay < startDate (theo ngày, TZ Asia/Bangkok)
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
    {
      $addFields: {
        _tourUpcoming: { $lt: ["$_todayStr", "$_startStr"] }, // “sắp diễn ra”
      },
    },

    // Lấy set cuối (mặc định 0-0)
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

    // Tên đội
    {
      $addFields: {
        _team1: {
          $cond: [
            { $ifNull: ["$_ra", false] },
            {
              $concat: [
                { $ifNull: ["$_ra.player1.fullName", "??"] },
                " & ",
                { $ifNull: ["$_ra.player2.fullName", "??"] },
              ],
            },
            "Chưa xác định",
          ],
        },
        _team2: {
          $cond: [
            { $ifNull: ["$_rb", false] },
            {
              $concat: [
                { $ifNull: ["$_rb.player1.fullName", "??"] },
                " & ",
                { $ifNull: ["$_rb.player2.fullName", "??"] },
              ],
            },
            "Chưa xác định",
          ],
        },
      },
    },

    // Map status của MATCH → nhãn VN + màu chip
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
                // scheduled
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
                // scheduled
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

    // Quy tắc ngày/giờ hiển thị:
    // - Nếu tournamentUpcoming → date = regOpenDate, time = "00:00"
    // - Ngược lại → date/time = từ scheduledAt (nếu có, còn không để null/"")
    {
      $addFields: {
        _outDate: {
          $cond: ["$_tourUpcoming", "$_openStr", "$_schedDate"],
        },
        _outTime: {
          $cond: ["$_tourUpcoming", "00:00", { $ifNull: ["$_schedTime", ""] }],
        },
      },
    },

    // Shape cho FE
    {
      $project: {
        _id: 1,
        code: {
          $ifNull: [
            "$code",
            {
              $concat: [
                "M-",
                { $toString: "$round" },
                "-",
                { $toString: "$order" },
              ],
            },
          ],
        },
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
                $ifNull: [
                  "$_court.name", // ưu tiên tên sân từ Court
                  { $ifNull: ["$courtLabel", ""] }, // fallback nhãn text nếu có
                ],
              },
            },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: "$$label" }, 0] }, // có chuỗi khác rỗng
                "$$label",
                "Chưa xác định", // mặc định
              ],
            },
          },
        },
        referee: { $ifNull: ["$_ref.name", ""] },
        status: "$_statusVN",
        statusColor: "$_statusColor",
      },
    },

    // Sắp xếp
    { $sort: { date: 1, time: 1, code: 1 } },
  ];

  const rows = await Match.aggregate(pipeline);
  res.json(rows);
});

export { getMatchesByTournament };
