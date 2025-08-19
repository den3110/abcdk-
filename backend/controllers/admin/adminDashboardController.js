// backend/controllers/adminDashboardController.js
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import tzPlugin from "dayjs/plugin/timezone.js";
dayjs.extend(utc);
dayjs.extend(tzPlugin);

// === Đổi import model cho đúng tên project bạn ===
import Tournament from "../../models/tournamentModel.js";
import Registration from "../../models/registrationModel.js";
import Match from "../../models/matchModel.js";
import User from "../../models/userModel.js";
// import Incident from "../models/incidentModel.js"; // nếu có

const asDate = (d) => (d instanceof Date ? d : new Date(d));

/** Helper: tạo mốc thời gian theo TZ */
function getRangeByDays({ days = 30, tz = "Asia/Ho_Chi_Minh" }) {
  const end = dayjs().tz(tz).endOf("day");
  const start = end.subtract(days - 1, "day").startOf("day");
  return { start: start.toDate(), end: end.toDate(), tz };
}

/** Helper: build timeseries với $dateToString timezone */
const seriesAgg = ({ dateField, match = {}, tz, start, end }) => [
  { $match: { ...match, [dateField]: { $gte: start, $lte: end } } },
  {
    $group: {
      _id: {
        $dateToString: {
          format: "%Y-%m-%d",
          date: `$${dateField}`,
          timezone: tz,
        },
      },
      count: { $sum: 1 },
    },
  },
  { $sort: { _id: 1 } },
];

/** Tính % thay đổi (xử lý chia 0) */
function deltaPct(curr, prev) {
  if (!prev) return curr ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

/** GET /api/admin/dashboard/metrics?tz=Asia/Ho_Chi_Minh */
export async function getDashboardMetrics(req, res) {
  try {
    const tz = (req.query.tz || "Asia/Ho_Chi_Minh").toString();

    const now = dayjs().tz(tz);
    const nowJS = now.toDate();
    const todayStart = now.startOf("day").toDate();
    const todayEnd = now.endOf("day").toDate();
    const yStart = now.subtract(1, "day").startOf("day").toDate();
    const yEnd = now.subtract(1, "day").endOf("day").toDate();
    const lastWeekPoint = now.subtract(7, "day").toDate();

    const [
      // KPI 1: Giải đang mở đăng ký (theo ngày)
      openTournaments,
      openTournamentsLW,
      // KPI 2: Đăng ký mới hôm nay / hôm qua
      newRegsToday,
      newRegsYesterday,
      // KPI 3: Trận đang diễn ra
      liveMatches,
      // KPI 4: Trận chưa gán trọng tài
      unassigned,
      // TODOs
      pendingKyc,
      // Upcoming tournaments (top 5)
      upcoming,
    ] = await Promise.all([
      Tournament.countDocuments({
        regOpenDate: { $lte: nowJS },
        registrationDeadline: { $gte: nowJS },
      }),
      Tournament.countDocuments({
        regOpenDate: { $lte: lastWeekPoint },
        registrationDeadline: { $gte: lastWeekPoint },
      }),
      Registration.countDocuments({
        createdAt: { $gte: todayStart, $lte: todayEnd },
      }),
      Registration.countDocuments({ createdAt: { $gte: yStart, $lte: yEnd } }),
      Match.countDocuments({ status: "live" }),
      Match.countDocuments({
        $or: [
          { referee: { $exists: false } },
          { referee: null },
          { referee: { $type: "string" } },
        ],
      }),
      // nếu không có trường cccdStatus thì để 0
      User.countDocuments({ cccdStatus: { $ne: "verified" } }),
      // UPCOMING (5 cái gần nhất)
      Tournament.aggregate([
        { $match: { startDate: { $gte: todayStart } } },
        { $sort: { startDate: 1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "registrations",
            localField: "_id",
            foreignField: "tournament",
            as: "regs",
          },
        },
        {
          $project: {
            name: 1,
            startDate: 1,
            endDate: 1,
            registrationDeadline: 1,
            maxPairs: 1,
            status: 1,
            registered: { $size: "$regs" },
          },
        },
      ]),
    ]);

    const cards = {
      openTournaments: {
        count: openTournaments,
        deltaPct: deltaPct(openTournaments, openTournamentsLW),
      },
      newRegsToday: {
        count: newRegsToday,
        deltaPct: deltaPct(newRegsToday, newRegsYesterday),
      },
      liveMatches: {
        count: liveMatches,
      },
      unassigned: {
        count: unassigned,
        // giả định giảm là tốt → hiển thị delta âm màu "success" trên FE
        deltaPct: null,
      },
    };

    const todos = {
      needReferee: unassigned,
      pendingApprovals: 0, // nếu có workflow duyệt reg: thay bằng count chờ duyệt
      pendingKyc: pendingKyc,
      incidents: 0, // nếu có Incident model: thay bằng count unresolved
    };

    return res.json({
      cards,
      todos,
      upcoming,
      updatedAt: new Date(),
    });
  } catch (e) {
    return res
      .status(500)
      .json({ message: e.message || "Internal Server Error" });
  }
}

/** GET /api/admin/dashboard/series?tz=Asia/Ho_Chi_Minh&days=30 */
export async function getDashboardSeries(req, res) {
  try {
    const tz = (req.query.tz || "Asia/Ho_Chi_Minh").toString();
    const days = Math.max(7, Math.min(120, Number(req.query.days || 30)));
    const { start, end } = getRangeByDays({ days, tz });

    const [regsDaily, usersDaily, matchesFinished] = await Promise.all([
      Registration.aggregate(
        seriesAgg({ dateField: "createdAt", tz, start, end })
      ),
      User.aggregate(seriesAgg({ dateField: "createdAt", tz, start, end })),
      // finishedAt nếu không có → dùng updatedAt khi status finished
      Match.aggregate([
        {
          $addFields: {
            finishedAtSafe: {
              $ifNull: ["$finishedAt", "$updatedAt"],
            },
          },
        },
        ...seriesAgg({
          dateField: "finishedAtSafe",
          tz,
          start,
          end,
          match: { status: "finished" },
        }),
      ]),
    ]);

    return res.json({
      tz,
      range: { start, end },
      regsDaily, // [{_id:'2025-08-01', count: 5}, ...]
      usersDaily, // [{_id:'2025-08-01', count: 2}, ...]
      matchesFinished, // [{_id:'2025-08-01', count: 7}, ...]
      updatedAt: new Date(),
    });
  } catch (e) {
    return res
      .status(500)
      .json({ message: e.message || "Internal Server Error" });
  }
}
