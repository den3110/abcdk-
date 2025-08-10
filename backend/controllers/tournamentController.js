import asyncHandler from "express-async-handler";
import tournamentModel from "../models/tournamentModel.js";

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

  const tournaments = await tournamentModel.aggregate(pipeline);
  res.json(tournaments);
});

const getTournamentById = asyncHandler(async (req, res) => {
  const tour = await tournamentModel.findById(req.params.id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  res.json(tour); // trả toàn bộ, gồm contactHtml & contentHtml
});

export { getTournaments, getTournamentById };
