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
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    .lean();

  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }

  // Helper: lấy nickname ưu tiên player.nickname/nickName;
  // nếu thiếu hoặc rỗng => fallback sang user.nickname/user.nickName.
  const fillNick = (p) => {
    if (!p) return p;
    const pick = (v) => (v && String(v).trim()) || "";
    const primary = pick(p.nickname) || pick(p.nickName);
    const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
    const n = primary || fromUser || "";

    if (n) {
      // điền cả hai key để FE dùng key nào cũng có giá trị
      p.nickname = n;
      p.nickName = n;
    }
    // Không muốn lộ cấu trúc user ra FE thì bỏ comment:
    // if (p.user) delete p.user;

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

  // bổ sung streams từ meta nếu có
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
