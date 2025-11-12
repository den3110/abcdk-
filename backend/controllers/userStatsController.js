import mongoose from "mongoose";
import dayjs from "dayjs";

const Match = mongoose.model("Match");
const Registration = mongoose.model("Registration");
const Tournament = mongoose.model("Tournament");
const User = mongoose.model("User");
const Ranking = mongoose.model("Ranking");
const ScoreHistory = mongoose.model("ScoreHistory");

const toId = (s) => {
  try {
    return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
};
const timeCond = (from, to, field = "createdAt") => {
  const $and = [];
  if (from) $and.push({ [field]: { $gte: new Date(from) } });
  if (to) $and.push({ [field]: { $lte: new Date(to) } });
  return $and.length ? { $and } : {};
};

// Lấy list Registration._id mà user tham gia (để map vào pairA/pairB)
async function regIdsOfUser(userId) {
  const regs = await Registration.find({
    $or: [{ "player1.user": userId }, { "player2.user": userId }],
  })
    .select("_id")
    .lean();
  return regs.map((r) => r._id);
}

// Bộ lọc trận của user (ưu tiên participants, fallback pairA/pairB in regIds)
function userMatchFilter(userId, regIds, from, to) {
  const baseTime = timeCond(from, to, "createdAt"); // bạn có thể đổi sang 'startedAt'
  const ors = [{ participants: userId }];
  if (regIds?.length) {
    ors.push({ pairA: { $in: regIds } });
    ors.push({ pairB: { $in: regIds } });
  }
  return { ...baseTime, $or: ors };
}

// ===== Helpers tính thắng/thua theo schema winner="A"|"B" =====
function winProject(regIds) {
  return {
    isUserOnA: { $in: ["$pairA", regIds] },
    isUserOnB: { $in: ["$pairB", regIds] },
    isWin: {
      $switch: {
        branches: [
          {
            case: { $eq: ["$winner", "A"] },
            then: { $in: ["$pairA", regIds] },
          },
          {
            case: { $eq: ["$winner", "B"] },
            then: { $in: ["$pairB", regIds] },
          },
        ],
        default: false,
      },
    },
  };
}

function durationExpr() {
  return {
    $cond: [
      {
        $and: [
          { $ifNull: ["$startedAt", false] },
          { $ifNull: ["$finishedAt", false] },
        ],
      },
      { $divide: [{ $subtract: ["$finishedAt", "$startedAt"] }, 1000] },
      // fallback createdAt → updatedAt/finishedAt
      {
        $divide: [
          {
            $subtract: [
              { $ifNull: ["$finishedAt", "$updatedAt"] },
              "$createdAt",
            ],
          },
          1000,
        ],
      },
    ],
  };
}

// ---------- 1) KPIs tổng quan ----------
export const overview = async (req, res) => {
  const userId = toId(req.params?.uid);
  if (!userId) return res.status(400).json({ message: "uid không hợp lệ" });
  const { from, to } = req.query || {};

  // prefetch regIds (để xác định side A/B và fallback khi chưa có participants)
  const regIds = await regIdsOfUser(userId);
  const fMatch = userMatchFilter(userId, regIds, from, to);

  // đếm nhanh
  const [totalMatches, liveMatches, finishedMatches] = await Promise.all([
    Match.countDocuments(fMatch),
    Match.countDocuments({ ...fMatch, status: "live" }),
    Match.countDocuments({ ...fMatch, status: "finished" }),
  ]);

  // WL + duration
  const agg = await Match.aggregate([
    { $match: fMatch },
    { $project: { ...winProject(regIds), dur: durationExpr() } },
    {
      $group: {
        _id: null,
        wins: { $sum: { $cond: ["$isWin", 1, 0] } },
        losses: { $sum: { $cond: ["$isWin", 0, 1] } },
        totalDur: { $sum: "$dur" },
        avgDur: { $avg: "$dur" },
      },
    },
  ]);

  const k = agg?.[0] || { wins: 0, losses: 0, totalDur: 0, avgDur: 0 };

  // distinct tournaments đã chơi
  const toursAgg = await Match.aggregate([
    { $match: fMatch },
    { $group: { _id: "$tournament" } },
    { $count: "c" },
  ]);
  const tournamentsPlayed = toursAgg?.[0]?.c || 0;

  // registrations của user (đã tạo) trong range
  const regCount = await Registration.countDocuments({
    $or: [{ "player1.user": userId }, { "player2.user": userId }],
    ...timeCond(from, to, "createdAt"),
  });

  // ranking hiện tại
  const ranking = await Ranking.findOne({ user: userId })
    .select(
      "single double mix points reputation tierColor tierLabel colorRank updatedAt"
    )
    .lean();

  // trend gần nhất từ ScoreHistory (30 bản ghi)
  const lastScores = await ScoreHistory.find({ user: userId })
    .select("single double scoredAt")
    .sort({ scoredAt: -1 })
    .limit(30)
    .lean();

  return res.json({
    userId: String(userId),
    range: { from: from || null, to: to || null },
    kpis: {
      totalMatches,
      liveMatches,
      finishedMatches,
      wins: k.wins,
      losses: k.losses,
      winrate: totalMatches ? +((k.wins * 100) / totalMatches).toFixed(1) : 0,
      totalPlayMin: Math.round((k.totalDur || 0) / 60),
      avgMatchMin: Math.round((k.avgDur || 0) / 60),
      tournamentsPlayed,
      registrations: regCount,
    },
    ranking: ranking || null,
    scoreTrend: lastScores.reverse(), // để tăng dần theo thời gian
  });
};

// ---------- 2) Chuỗi theo ngày ----------
export const series = async (req, res) => {
  const userId = toId(req.params?.uid);
  if (!userId) return res.status(400).json({ message: "uid không hợp lệ" });

  const tz = req.query?.tz || "Asia/Bangkok";
  const df = req.query?.from
    ? dayjs(req.query.from)
    : dayjs().subtract(29, "day");
  const dt = req.query?.to ? dayjs(req.query.to) : dayjs();

  const regIds = await regIdsOfUser(userId);
  const fMatch = userMatchFilter(userId, regIds, df.toDate(), dt.toDate());
  const dayKey = {
    $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz },
  };

  const [perDayMatch, perDayWin] = await Promise.all([
    Match.aggregate([
      { $match: fMatch },
      { $group: { _id: dayKey, matches: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Match.aggregate([
      { $match: fMatch },
      { $project: { createdAt: 1, ...winProject(regIds) } },
      { $match: { isWin: true } },
      { $group: { _id: dayKey, wins: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // spend/orders = tổng phí đăng ký đã thanh toán theo ngày
  const spendDaily = await Registration.aggregate([
    {
      $match: {
        $or: [{ "player1.user": userId }, { "player2.user": userId }],
        "payment.status": "Paid",
        ...timeCond(df.toDate(), dt.toDate(), "createdAt"),
      },
    },
    {
      $lookup: {
        from: "tournaments",
        localField: "tournament",
        foreignField: "_id",
        as: "tour",
      },
    },
    { $unwind: { path: "$tour", preserveNullAndEmptyArrays: true } },
    { $addFields: { fee: { $ifNull: ["$tour.registrationFee", 0] } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: tz,
          },
        },
        spend: { $sum: "$fee" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // normalize range
  const days = [];
  for (
    let d = df.startOf("day");
    d.isBefore(dt.endOf("day"));
    d = d.add(1, "day")
  ) {
    days.push(d.format("YYYY-MM-DD"));
  }
  const mMap = Object.fromEntries(perDayMatch.map((x) => [x._id, x.matches]));
  const wMap = Object.fromEntries(perDayWin.map((x) => [x._id, x.wins]));
  const sMap = Object.fromEntries(spendDaily.map((x) => [x._id, x.spend]));
  const oMap = Object.fromEntries(spendDaily.map((x) => [x._id, x.orders]));

  res.json({
    tz,
    from: df.toISOString(),
    to: dt.toISOString(),
    series: days.map((d) => ({
      date: d,
      matches: mMap[d] || 0,
      wins: wMap[d] || 0,
      spend: sMap[d] || 0,
      orders: oMap[d] || 0,
    })),
  });
};

// ---------- 3) Breakdown ----------
export const breakdown = async (req, res) => {
  const userId = toId(req.params?.uid);
  if (!userId) return res.status(400).json({ message: "uid không hợp lệ" });
  const { from, to } = req.query || {};
  const regIds = await regIdsOfUser(userId);
  const fMatch = userMatchFilter(userId, regIds, from, to);

  // by tournament
  const byTour = await Match.aggregate([
    { $match: fMatch },
    { $group: { _id: "$tournament", value: { $sum: 1 } } },
    { $sort: { value: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "tournaments",
        localField: "_id",
        foreignField: "_id",
        as: "tour",
      },
    },
    { $unwind: { path: "$tour", preserveNullAndEmptyArrays: true } },
    { $project: { name: { $ifNull: ["$tour.name", "N/A"] }, value: 1 } },
  ]);

  // by status
  const byStatus = await Match.aggregate([
    { $match: fMatch },
    { $group: { _id: "$status", value: { $sum: 1 } } },
  ]);

  // top partners (đồng đội cùng registration với user)
  const partners = await Match.aggregate([
    { $match: fMatch },
    // Lookup PairA & PairB (registration -> player1.user, player2.user)
    {
      $lookup: {
        from: "registrations",
        localField: "pairA",
        foreignField: "_id",
        as: "regA",
      },
    },
    {
      $lookup: {
        from: "registrations",
        localField: "pairB",
        foreignField: "_id",
        as: "regB",
      },
    },
    { $unwind: { path: "$regA", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$regB", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userOnA: { $in: ["$pairA", regIds] },
        userOnB: { $in: ["$pairB", regIds] },
        // partners: lấy user còn lại trong registration của side chứa user
        partners: {
          $cond: [
            { $eq: [{ $in: ["$pairA", regIds] }, true] },
            {
              $setDifference: [
                [
                  { $ifNull: ["$regA.player1.user", null] },
                  { $ifNull: ["$regA.player2.user", null] },
                ],
                [toId(String(userId))],
              ],
            },
            {
              $cond: [
                { $eq: [{ $in: ["$pairB", regIds] }, true] },
                {
                  $setDifference: [
                    [
                      { $ifNull: ["$regB.player1.user", null] },
                      { $ifNull: ["$regB.player2.user", null] },
                    ],
                    [toId(String(userId))],
                  ],
                },
                [],
              ],
            },
          ],
        },
      },
    },
    { $unwind: { path: "$partners", preserveNullAndEmptyArrays: false } },
    { $group: { _id: "$partners", cnt: { $sum: 1 } } },
    { $sort: { cnt: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "u",
      },
    },
    { $unwind: { path: "u", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userId: "$_id",
        name: { $ifNull: ["$u.name", "$u.nickname"] },
        times: "$cnt",
      },
    },
  ]);

  res.json({
    byTournament: byTour.map((x) => ({ label: x.name, value: x.value })),
    byStatus: byStatus.map((x) => ({ label: x._id, value: x.value })),
    topPartners: partners,
  });
};

// ---------- 4) Heatmap giờ/ngày ----------
export const heatmap = async (req, res) => {
  const userId = toId(req.params?.uid);
  if (!userId) return res.status(400).json({ message: "uid không hợp lệ" });
  const { from, to, tz = "Asia/Bangkok" } = req.query || {};

  const regIds = await regIdsOfUser(userId);
  const fMatch = userMatchFilter(userId, regIds, from, to);

  const key = {
    day: {
      $dateToString: {
        format: "%u",
        date: { $ifNull: ["$startedAt", "$createdAt"] },
        timezone: tz,
      },
    },
    hour: {
      $dateToString: {
        format: "%H",
        date: { $ifNull: ["$startedAt", "$createdAt"] },
        timezone: tz,
      },
    },
  };
  const docs = await Match.aggregate([
    { $match: fMatch },
    { $group: { _id: key, v: { $sum: 1 } } },
  ]);

  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const ci = (x, a, b) => Math.max(a, Math.min(b, x));
  for (const r of docs) {
    const d = ci(parseInt(r._id.day, 10) - 1, 0, 6);
    const h = ci(parseInt(r._id.hour, 10), 0, 23);
    grid[d][h] = r.v;
  }
  res.json({ tz, grid });
};

// ---------- 5) Top đối thủ / top giải ----------
export const top = async (req, res) => {
  const userId = toId(req.params?.uid);
  if (!userId) return res.status(400).json({ message: "uid không hợp lệ" });
  const { from, to } = req.query || {};
  const limit = Math.max(1, Math.min(20, parseInt(req.query?.limit || 10, 10)));

  const regIds = await regIdsOfUser(userId);
  const fMatch = {
    ...userMatchFilter(userId, regIds, from, to),
    status: "finished",
  };

  const topOpponents = await Match.aggregate([
    { $match: fMatch },
    {
      $lookup: {
        from: "registrations",
        localField: "pairA",
        foreignField: "_id",
        as: "regA",
      },
    },
    {
      $lookup: {
        from: "registrations",
        localField: "pairB",
        foreignField: "_id",
        as: "regB",
      },
    },
    { $unwind: { path: "$regA", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$regB", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userOnA: { $in: ["$pairA", regIds] },
        userOnB: { $in: ["$pairB", regIds] },
        oppUsers: {
          $cond: [
            { $eq: [{ $in: ["$pairA", regIds] }, true] },
            [
              { $ifNull: ["$regB.player1.user", null] },
              { $ifNull: ["$regB.player2.user", null] },
            ],
            [
              { $ifNull: ["$regA.player1.user", null] },
              { $ifNull: ["$regA.player2.user", null] },
            ],
          ],
        },
      },
    },
    { $unwind: { path: "$oppUsers", preserveNullAndEmptyArrays: false } },
    { $match: { oppUsers: { $ne: null } } },
    { $group: { _id: "$oppUsers", cnt: { $sum: 1 } } },
    { $sort: { cnt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "u",
      },
    },
    { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userId: "$_id",
        name: { $ifNull: ["$u.name", "$u.nickname"] },
        times: "$cnt",
      },
    },
  ]);

  const topTournaments = await Match.aggregate([
    { $match: userMatchFilter(userId, regIds, from, to) },
    { $group: { _id: "$tournament", cnt: { $sum: 1 } } },
    { $sort: { cnt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "tournaments",
        localField: "_id",
        foreignField: "_id",
        as: "t",
      },
    },
    { $unwind: { path: "$t", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        tournamentId: "$_id",
        name: { $ifNull: ["$t.name", "N/A"] },
        times: "$cnt",
      },
    },
  ]);

  res.json({ topOpponents, topTournaments });
};

// ---------- 6) Hồ sơ mở rộng (Ranking + meta User) ----------
export const profile = async (req, res) => {
  const userId = toId(req.params?.uid);
  if (!userId) return res.status(400).json({ message: "uid không hợp lệ" });

  const [user, ranking, lastLoginMeta] = await Promise.all([
    User.findById(userId)
      .select("name nickname avatar province cover bio createdAt")
      .lean(),
    Ranking.findOne({ user: userId }).lean(),
    // nếu có virtual loginMeta thì populate 1 phát (nhiều hệ thống bật)
    User.findById(userId).populate("loginMeta").select("_id").lean(),
  ]);

  const lastScores = await ScoreHistory.find({ user: userId })
    .select("single double note scoredAt")
    .sort({ scoredAt: -1 })
    .limit(50)
    .lean();

  res.json({
    user: user || null,
    ranking: ranking || null,
    scoreHistory: lastScores.reverse(),
    loginMeta: lastLoginMeta?.loginMeta || null,
  });
};
