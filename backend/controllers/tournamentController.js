import asyncHandler from "express-async-handler";
import Tournament from "../models/tournamentModel.js";
import mongoose from "mongoose";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";

const isId = (id) => mongoose.Types.ObjectId.isValid(id);
// @desc    Lấy danh sách giải đấu (lọc theo sportType & groupId)
// @route   GET /api/tournaments?sportType=&groupId=
// @access  Public

/**
 * GET /api/tournaments/public
 * Query:
 *  - sportType: Number (1/2)
 *  - groupId:   Number
 *  - sort:      string, ví dụ "-startDate,name" (mặc định: "-startDate")
 *  - limit:     number (optional)
 */
const getTournaments = asyncHandler(async (req, res) => {
  const sort = (req.query.sort || "-startDate").toString();
  const limit = req.query.limit
    ? Math.max(parseInt(req.query.limit, 10) || 0, 0)
    : null;
  const status = (req.query.status || "").toString().toLowerCase(); // optional: upcoming|ongoing|finished

  const parseSort = (s) =>
    s.split(",").reduce((acc, token) => {
      const key = token.trim();
      if (!key) return acc;
      if (key.startsWith("-")) acc[key.slice(1)] = -1;
      else acc[key] = 1;
      return acc;
    }, {});

  const sortSpec = Object.keys(parseSort(sort)).length
    ? parseSort(sort)
    : { startDate: -1, _id: -1 };
  const TZ = "Asia/Bangkok";

  const pipeline = [
    // Tính status theo ngày (bao gồm cả start/end) theo TZ, bỏ qua status của model
    {
      $addFields: {
        _nowDay: {
          $dateToString: { date: "$$NOW", format: "%Y-%m-%d", timezone: TZ },
        },
        _startDay: {
          $dateToString: {
            date: "$startDate",
            format: "%Y-%m-%d",
            timezone: TZ,
          },
        },
        _endDay: {
          $dateToString: { date: "$endDate", format: "%Y-%m-%d", timezone: TZ },
        },
      },
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $lt: ["$_nowDay", "$_startDay"] }, then: "upcoming" },
              { case: { $gt: ["$_nowDay", "$_endDay"] }, then: "finished" },
            ],
            default: "ongoing",
          },
        },
      },
    },
  ];

  // Lọc theo status mới nếu FE truyền
  if (["upcoming", "ongoing", "finished"].includes(status)) {
    pipeline.push({ $match: { status } });
  }

  // Sort/limit
  pipeline.push({ $sort: sortSpec });
  if (limit) pipeline.push({ $limit: limit });

  // Tính registered / isFull / remaining
  pipeline.push(
    {
      $lookup: {
        from: "registrations",
        let: { tid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tid"] } } },
          { $group: { _id: null, c: { $sum: 1 } } },
        ],
        as: "_rc",
      },
    },
    {
      $addFields: {
        registered: { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
        isFull: {
          $cond: [
            {
              $and: [
                { $gt: ["$maxPairs", 0] },
                {
                  $gte: [
                    { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
                    "$maxPairs",
                  ],
                },
              ],
            },
            true,
            false,
          ],
        },
        remaining: {
          $cond: [
            { $gt: ["$maxPairs", 0] },
            {
              $max: [
                0,
                {
                  $subtract: [
                    "$maxPairs",
                    { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
                  ],
                },
              ],
            },
            null,
          ],
        },
      },
    },
    // Ẩn trường trung gian
    { $project: { _rc: 0, _nowDay: 0, _startDay: 0, _endDay: 0 } }
  );

  const tournaments = await Tournament.aggregate(pipeline);
  res.json(tournaments);
});

const getTournamentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // lấy tournament
  const tour = await Tournament.findById(id)
    // .populate('createdBy', 'name avatar') // nếu muốn kèm info chủ giải
    .lean();

  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const meId = req.user?._id ? String(req.user._id) : null;

  // load managers
  const managerRows = await TournamentManager.find({ tournament: id })
    .select("user role")
    // .populate('user', 'name avatar') // nếu muốn kèm info user
    .lean();

  const managers = managerRows.map((r) => ({
    user: r.user, // hoặc r.user._id nếu populate
    role: r.role,
  }));

  const amOwner = !!(meId && String(tour.createdBy) === meId);
  const amManager =
    amOwner || (!!meId && managerRows.some((r) => String(r.user) === meId));

  // trả về đầy đủ tour + flags tiện dụng
  res.json({
    ...tour,
    managers,
    amOwner,
    amManager,
  });
});

/**
 * GET /api/tournaments/:id/brackets
 * User route: trả về các bracket của giải, sort theo stage -> order -> createdAt
 * Thêm matchesCount (tính qua $lookup, không tốn populate).
 */
export const listTournamentBrackets = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isId(id))
      return res.status(400).json({ message: "Invalid tournament id" });

    const list = await Bracket.aggregate([
      { $match: { tournament: new mongoose.Types.ObjectId(id) } },
      { $sort: { stage: 1, order: 1, createdAt: 1 } },
      {
        $lookup: {
          from: "matches",
          localField: "_id",
          foreignField: "bracket",
          as: "_m",
        },
      },
      { $addFields: { matchesCount: { $size: "$_m" } } },
      { $project: { _m: 0 } },
    ]);

    res.json(list);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/:id/matches
 * User route: trả về match của giải (có thể lọc theo bracket/type/stage/status).
 * HỖ TRỢ phân trang: ?page=1&limit=50, sort: ?sort=round,order (mặc định round asc, order asc).
 * Populate chuẩn theo schema (KHÔNG dùng 'reg1', 'reg2' — đó là lý do lỗi strictPopulate trước đây).
 */
export const listTournamentMatches = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params; // tournament id
    if (!isId(id))
      return res.status(400).json({ message: "Invalid tournament id" });

    const {
      bracket, // optional: id bracket cụ thể
      stage, // optional: lọc theo stage của bracket
      type, // optional: 'group' | 'knockout'
      status, // optional: 'scheduled' | 'live' | 'finished'
      page = 1,
      limit = 200,
      sort = "round,order,createdAt",
    } = req.query;

    // Parse sort "a,-b" -> {a:1,b:-1}
    const parseSort = (s) =>
      String(s)
        .split(",")
        .reduce((acc, tok) => {
          const key = tok.trim();
          if (!key) return acc;
          if (key.startsWith("-")) acc[key.slice(1)] = -1;
          else acc[key] = 1;
          return acc;
        }, {});
    const sortSpec = Object.keys(parseSort(sort)).length
      ? parseSort(sort)
      : { round: 1, order: 1, createdAt: 1 };

    // Base filter: đúng giải
    const filter = { tournament: id };
    if (status) filter.status = status;
    if (bracket && isId(bracket)) filter.bracket = bracket;

    // Nếu lọc theo stage/type: tìm trước các bracket thuộc giải đáp ứng điều kiện
    if (
      (stage && Number.isFinite(Number(stage))) ||
      (type && typeof type === "string")
    ) {
      const bFilter = { tournament: id };
      if (stage) bFilter.stage = Number(stage);
      if (type) bFilter.type = type;

      const brs = await Bracket.find(bFilter).select("_id").lean();
      const ids = brs.map((b) => b._id);
      // nếu đồng thời có param bracket cụ thể thì ưu tiên giao nhau
      if (filter.bracket) {
        filter.bracket = {
          $in: ids.filter((x) => String(x) === String(filter.bracket)),
        };
      } else {
        filter.bracket = { $in: ids };
      }
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 1000);
    const skip = (pg - 1) * lim;

    // Query + populate CHUẨN (không có 'reg1'/'reg2')
    const [list, total] = await Promise.all([
      Match.find(filter)
        .populate({ path: "tournament", select: "name" })
        .populate({ path: "bracket", select: "name type stage order" })
        .populate({ path: "pairA", select: "player1 player2" })
        .populate({ path: "pairB", select: "player1 player2" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "referee", select: "name nickname" })
        .sort(sortSpec)
        .skip(lim ? skip : 0)
        .limit(lim || 0)
        .lean(),
      Match.countDocuments(filter),
    ]);

    res.json({
      total,
      page: pg,
      limit: lim,
      list,
    });
  } catch (err) {
    next(err);
  }
});

export { getTournaments, getTournamentById };
