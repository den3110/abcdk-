// controllers/scheduleController.js
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import Registration from "../models/registrationModel.js";
import { DateTime } from "luxon";

/**
 * @desc    Get user's match schedule (calendar view)
 * @route   GET /api/schedule/my-matches
 * @access  Private
 */
export const getMyMatchSchedule = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      startDate, // YYYY-MM-DD
      endDate, // YYYY-MM-DD
      timezone = "Asia/Ho_Chi_Minh",
      status, // scheduled, live, finished
      tournamentId,
    } = req.query;

    // Build date range filter
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter.scheduledAt = {};
      if (startDate) {
        const start = DateTime.fromISO(startDate, { zone: timezone })
          .startOf("day")
          .toUTC()
          .toJSDate();
        dateFilter.scheduledAt.$gte = start;
      }
      if (endDate) {
        const end = DateTime.fromISO(endDate, { zone: timezone })
          .endOf("day")
          .toUTC()
          .toJSDate();
        dateFilter.scheduledAt.$lte = end;
      }
    }

    // Build main filter
    const filter = {
      participants: userId, // Sử dụng field participants đã có sẵn!
      scheduledAt: { $ne: null }, // Chỉ lấy trận đã có lịch
      ...dateFilter,
    };

    if (status) filter.status = status;
    if (tournamentId) filter.tournament = tournamentId;

    console.log(filter)

    // Query matches với đầy đủ thông tin
    const matches = await Match.find(filter)
      .populate({
        path: "tournament",
        select:
          "name image sportType location timezone startDate endDate overlay",
      })
      .populate({
        path: "bracket",
        select: "name type stage order config.rules drawSettings",
      })
      .populate({
        path: "pairA",
        select: "player1 player2 seed teamName",
        populate: [
          {
            path: "player1",
            select: "fullName name nickname user",
            populate: { path: "user", select: "nickname name" },
          },
          {
            path: "player2",
            select: "fullName name nickname user",
            populate: { path: "user", select: "nickname name" },
          },
        ],
      })
      .populate({
        path: "pairB",
        select: "player1 player2 seed teamName",
        populate: [
          {
            path: "player1",
            select: "fullName name nickname user",
            populate: { path: "user", select: "nickname name" },
          },
          {
            path: "player2",
            select: "fullName name nickname user",
            populate: { path: "user", select: "nickname name" },
          },
        ],
      })
      .populate({
        path: "court",
        select: "name number label zone",
      })
      .populate({
        path: "referee",
        select: "name nickname",
      })
      .sort({ scheduledAt: 1, queueOrder: 1 })
      .lean();
    // Group by date & enhance data
    const scheduleMap = new Map();

    for (const match of matches) {
      if (!match.scheduledAt) continue;

      // Convert to user's timezone
      const tz = match.tournament?.timezone || timezone;
      const localTime = DateTime.fromJSDate(match.scheduledAt).setZone(tz);
      const dateKey = localTime.toISODate(); // YYYY-MM-DD

      if (!scheduleMap.has(dateKey)) {
        scheduleMap.set(dateKey, {
          date: dateKey,
          dayOfWeek: localTime.toFormat("cccc"), // Monday, Tuesday...
          matchCount: 0,
          matches: [],
          tournaments: new Set(),
          brackets: new Set(),
        });
      }

      const dayData = scheduleMap.get(dateKey);

      // Determine user's side
      const isTeamA =
        match.pairA?.player1?.user?._id?.toString() === userId.toString() ||
        match.pairA?.player2?.user?._id?.toString() === userId.toString();

      const isTeamB =
        match.pairB?.player1?.user?._id?.toString() === userId.toString() ||
        match.pairB?.player2?.user?._id?.toString() === userId.toString();

      const mySide = isTeamA ? "A" : isTeamB ? "B" : null;

      // Enhanced match data
      const enhancedMatch = {
        _id: match._id,
        code: match.code,
        round: match.round,
        order: match.order,
        status: match.status,
        scheduledAt: match.scheduledAt,
        localScheduledTime: localTime.toFormat("HH:mm"), // 14:30
        startedAt: match.startedAt,
        finishedAt: match.finishedAt,
        mySide, // "A" or "B"
        myTeam: mySide === "A" ? match.pairA : match.pairB,
        opponentTeam: mySide === "A" ? match.pairB : match.pairA,
        winner: match.winner,
        isWinner:
          match.winner && match.winner === mySide
            ? true
            : match.winner
            ? false
            : null,
        gameScores: match.gameScores || [],
        court: match.court,
        courtLabel: match.courtLabel || match.court?.name || "",
        referee: match.referee,
        tournament: {
          _id: match.tournament._id,
          name: match.tournament.name,
          image: match.tournament.image,
          location: match.tournament.location,
          timezone: match.tournament.timezone,
        },
        bracket: {
          _id: match.bracket._id,
          name: match.bracket.name,
          type: match.bracket.type,
          stage: match.bracket.stage,
          color: getBracketColor(match.bracket.stage, match.bracket.type),
        },
        rules: match.rules,
        // Time calculations
        timeUntilMatch: calculateTimeUntil(match.scheduledAt),
        isUpcoming: match.scheduledAt > new Date(),
        isPast: match.finishedAt ? true : false,
        isToday: localTime.hasSame(DateTime.now().setZone(tz), "day"),
      };

      dayData.matches.push(enhancedMatch);
      dayData.matchCount++;
      dayData.tournaments.add(match.tournament.name);
      dayData.brackets.add(match.bracket.name);
    }

    // Convert Map to Array và thêm metadata
    const schedule = Array.from(scheduleMap.values()).map((day) => ({
      ...day,
      tournaments: Array.from(day.tournaments),
      brackets: Array.from(day.brackets),
      hasMultipleTournaments: day.tournaments.size > 1,
      hasMultipleBrackets: day.brackets.size > 1,
    }));

    // Summary statistics
    const summary = {
      totalMatches: matches.length,
      upcomingMatches: matches.filter((m) => m.scheduledAt > new Date()).length,
      liveMatches: matches.filter((m) => m.status === "live").length,
      finishedMatches: matches.filter((m) => m.status === "finished").length,
      uniqueTournaments: new Set(
        matches.map((m) => m.tournament._id.toString())
      ).size,
      uniqueBrackets: new Set(matches.map((m) => m.bracket._id.toString()))
        .size,
      dateRange: {
        start: startDate || schedule[0]?.date || null,
        end: endDate || schedule[schedule.length - 1]?.date || null,
      },
    };

    res.json({
      success: true,
      data: {
        schedule,
        summary,
        timezone,
      },
    });
  } catch (error) {
    console.error("[Schedule] Get error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy lịch thi đấu",
      error: error.message,
    });
  }
};

/**
 * @desc    Get matches for a specific date
 * @route   GET /api/schedule/date/:date
 * @access  Private
 */
export const getMatchesByDate = async (req, res) => {
  try {
    const userId = req.user._id;
    const { date } = req.params; // YYYY-MM-DD
    const { timezone = "Asia/Ho_Chi_Minh" } = req.query;

    const startOfDay = DateTime.fromISO(date, { zone: timezone })
      .startOf("day")
      .toUTC()
      .toJSDate();

    const endOfDay = DateTime.fromISO(date, { zone: timezone })
      .endOf("day")
      .toUTC()
      .toJSDate();

    const matches = await Match.find({
      participants: userId,
      scheduledAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    })
      .populate("tournament bracket pairA pairB court referee")
      .sort({ scheduledAt: 1 })
      .lean();

    res.json({
      success: true,
      data: {
        date,
        matchCount: matches.length,
        matches,
      },
    });
  } catch (error) {
    console.error("[Schedule] Get by date error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy lịch theo ngày",
      error: error.message,
    });
  }
};

/**
 * @desc    Get upcoming matches (next 7 days)
 * @route   GET /api/schedule/upcoming
 * @access  Private
 */
export const getUpcomingMatches = async (req, res) => {
  try {
    const userId = req.user._id;
    const { days = 7, timezone = "Asia/Ho_Chi_Minh" } = req.query;

    const now = DateTime.now().setZone(timezone).toUTC().toJSDate();
    const future = DateTime.now()
      .setZone(timezone)
      .plus({ days: parseInt(days) })
      .toUTC()
      .toJSDate();

    const matches = await Match.find({
      participants: userId,
      scheduledAt: {
        $gte: now,
        $lte: future,
      },
      status: { $in: ["scheduled", "queued", "assigned"] },
    })
      .populate("tournament bracket pairA pairB court")
      .sort({ scheduledAt: 1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      data: {
        matches,
        count: matches.length,
      },
    });
  } catch (error) {
    console.error("[Schedule] Get upcoming error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy lịch sắp tới",
      error: error.message,
    });
  }
};

/**
 * @desc    Get calendar marked dates (dates with matches)
 * @route   GET /api/schedule/marked-dates
 * @access  Private
 */
export const getMarkedDates = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      month, // YYYY-MM
      timezone = "Asia/Ho_Chi_Minh",
    } = req.query;

    let dateFilter = {};
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      const start = DateTime.fromObject(
        { year, month: monthNum, day: 1 },
        { zone: timezone }
      )
        .startOf("day")
        .toUTC()
        .toJSDate();

      const end = DateTime.fromObject(
        { year, month: monthNum, day: 1 },
        { zone: timezone }
      )
        .endOf("month")
        .toUTC()
        .toJSDate();

      dateFilter = { scheduledAt: { $gte: start, $lte: end } };
    }

    const matches = await Match.find({
      participants: userId,
      ...dateFilter,
    })
      .select("scheduledAt status bracket")
      .populate("bracket", "stage type")
      .lean();

    // Group by date
    const markedDates = {};
    for (const match of matches) {
      if (!match.scheduledAt) continue;

      const localTime = DateTime.fromJSDate(match.scheduledAt).setZone(
        timezone
      );
      const dateKey = localTime.toISODate();

      if (!markedDates[dateKey]) {
        markedDates[dateKey] = {
          marked: true,
          matchCount: 0,
          hasLive: false,
          hasUpcoming: false,
          hasFinished: false,
          dots: [],
        };
      }

      const dayData = markedDates[dateKey];
      dayData.matchCount++;

      if (match.status === "live") dayData.hasLive = true;
      if (match.status === "finished") dayData.hasFinished = true;
      if (["scheduled", "queued", "assigned"].includes(match.status)) {
        dayData.hasUpcoming = true;
      }

      // Add colored dot for bracket
      const color = getBracketColor(match.bracket.stage, match.bracket.type);
      if (!dayData.dots.find((d) => d.color === color)) {
        dayData.dots.push({ color });
      }
    }

    res.json({
      success: true,
      data: {
        markedDates,
        totalDays: Object.keys(markedDates).length,
      },
    });
  } catch (error) {
    console.error("[Schedule] Get marked dates error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy ngày có trận",
      error: error.message,
    });
  }
};

// Helper functions
function getBracketColor(stage, type) {
  const colors = {
    1: "#3B82F6", // Blue - Stage 1
    2: "#10B981", // Green - Stage 2
    3: "#F59E0B", // Orange - Stage 3
    4: "#EF4444", // Red - Stage 4
  };

  if (type === "knockout") return colors[stage] || "#6366F1";
  if (type === "group") return "#8B5CF6";
  if (type === "double_elim") return "#EC4899";
  return "#6B7280";
}

function calculateTimeUntil(scheduledAt) {
  const now = DateTime.now();
  const scheduled = DateTime.fromJSDate(scheduledAt);
  const diff = scheduled.diff(now, ["days", "hours", "minutes"]);

  if (diff.days > 0) return `${Math.floor(diff.days)} ngày`;
  if (diff.hours > 0) return `${Math.floor(diff.hours)} giờ`;
  if (diff.minutes > 0) return `${Math.floor(diff.minutes)} phút`;
  return "Sắp bắt đầu";
}
