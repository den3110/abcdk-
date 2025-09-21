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

  // Quyền
  if (!canAdminMatch(req.user)) {
    res.status(403);
    throw new Error("Bạn không có quyền chỉnh sửa trận này");
  }

  const match = await Match.findById(id);
  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  const { gameScores, winner, status } = req.body || {};
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

  // 2) rules: không patch ở endpoint này

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
    updates.status = status; // normalize bên dưới sẽ xử lý startedAt/finishedAt
    touchLive = true;
  }

  // 5) Reopen: nếu set status KHÁC finished mà request KHÔNG gửi winner -> clear winner
  if (hasStatusField && status !== "finished" && !hasWinnerField) {
    updates.winner = ""; // cho phép chuyển về live/scheduled dù DB đang có winner
    touchLive = true;
  }

  // 6) Chỉ infer winner khi request đang set status = finished (nếu client không gửi winner)
  if (hasStatusField && status === "finished" && !hasWinnerField) {
    const srcScores = updates.gameScores ?? match.gameScores;
    const w = inferWinnerFromScores(match.rules, srcScores);
    if (w) updates.winner = w;
  }

  // 7) Normalize theo status + winner (giữ nguyên normalizeStatusTransition hiện có)
  if (updates.status !== undefined || updates.winner !== undefined) {
    const desiredStatus = updates.status ?? match.status;
    const desiredWinner = updates.winner ?? match.winner;
    const t = normalizeStatusTransition(match, desiredStatus, desiredWinner);
    updates.status = t.status;
    updates.startedAt = t.startedAt;
    updates.finishedAt = t.finishedAt;
  }

  // 8) liveVersion ++ nếu có thay đổi liên quan live/score
  if (touchLive) updates.liveVersion = (match.liveVersion || 0) + 1;

  // 9) Lưu
  match.set(updates);
  await match.save(); // chạy pre/post save hooks

  res.json({
    _id: match._id,
    status: match.status,
    winner: match.winner,
    gameScores: match.gameScores,
    currentGame: match.currentGame,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    liveVersion: match.liveVersion,
    rules: match.rules,
    updatedAt: match.updatedAt,
  });
});
