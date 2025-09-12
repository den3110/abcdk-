import asyncHandler from "express-async-handler";
import Tournament from "../models/tournamentModel.js";
import mongoose from "mongoose";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import Registration from "../models/registrationModel.js";
import Court from "../models/courtModel.js";
import { sleep } from "../utils/sleep.js";

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
// GET /tournaments
const getTournaments = asyncHandler(async (req, res) => {
  // await sleep(10000)
  const sort = (req.query.sort || "-startDate").toString();
  const limit = req.query.limit
    ? Math.max(parseInt(req.query.limit, 10) || 0, 0)
    : null;
  const status = (req.query.status || "").toString().toLowerCase(); // upcoming|ongoing|finished
  const rawKeyword = (req.query.keyword ?? req.query.q ?? "").toString().trim();

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  const pipeline = [];

  // ----- Search (keyword / q) -----
  if (rawKeyword) {
    const tokens = rawKeyword.split(/\s+/).filter(Boolean).map(escapeRegex);
    const tokenConds = tokens.map((tk) => ({
      $or: [
        { name: { $regex: tk, $options: "i" } },
        { slug: { $regex: tk, $options: "i" } },
        { code: { $regex: tk, $options: "i" } },
        { "location.city": { $regex: tk, $options: "i" } },
        { "location.province": { $regex: tk, $options: "i" } },
        { venueName: { $regex: tk, $options: "i" } },
      ],
    }));

    const orExpr = [];
    if (tokenConds.length) orExpr.push({ $and: tokenConds });

    if (mongoose.Types.ObjectId.isValid(rawKeyword)) {
      orExpr.push({ _id: new mongoose.Types.ObjectId(rawKeyword) });
    }

    pipeline.push({
      $match: orExpr.length === 1 ? orExpr[0] : { $or: orExpr },
    });
  }

  // ----- Tính status theo ngày theo TZ -----
  pipeline.push(
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
    }
  );

  // ----- Lọc theo status -----
  if (["upcoming", "ongoing", "finished"].includes(status)) {
    pipeline.push({ $match: { status } });
  }

  // ----- Sort / Limit -----
  pipeline.push({ $sort: sortSpec });
  if (limit) pipeline.push({ $limit: limit });

  // ----- registered / isFull / remaining -----
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
    }
  );

  // ----- Bracket stats để hỗ trợ noRankDelta (tự tích ở giải khi toàn bộ bracket đã bật) -----
  pipeline.push(
    {
      $lookup: {
        from: "brackets",
        let: { tid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tid"] } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              noRankOn: {
                $sum: { $cond: [{ $eq: ["$noRankDelta", true] }, 1, 0] },
              },
            },
          },
        ],
        as: "_bc",
      },
    },
    {
      $addFields: {
        bracketsTotal: { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
        bracketsNoRankDeltaTrue: {
          $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0],
        },
        // true nếu có >=1 bracket và tất cả đều bật
        allBracketsNoRankDelta: {
          $cond: [
            { $gt: [{ $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] }, 0] },
            {
              $eq: [
                { $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0] },
                { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
              ],
            },
            false,
          ],
        },
        // hiệu lực thực tế để FE tham chiếu nhanh
        effectiveNoRankDelta: {
          $or: [
            { $eq: ["$noRankDelta", true] },
            {
              $cond: [
                {
                  $gt: [
                    { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
                    0,
                  ],
                },
                {
                  $eq: [
                    { $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0] },
                    { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
                  ],
                },
                false,
              ],
            },
          ],
        },
      },
    },
    { $project: { _rc: 0, _bc: 0, _nowDay: 0, _startDay: 0, _endDay: 0 } }
  );

  const tournaments = await Tournament.aggregate(pipeline);
  res.status(200).json(tournaments);
});

const getTournamentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // lấy tournament
  const tour = await Tournament.findById(id).lean();
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const meId = req.user?._id ? String(req.user._id) : null;

  // load managers
  const managerRows = await TournamentManager.find({ tournament: id })
    .select("user role")
    .lean();

  const managers = managerRows.map((r) => ({
    user: r.user,
    role: r.role,
  }));

  const amOwner = !!(meId && String(tour.createdBy) === meId);
  const amManager =
    amOwner || (!!meId && managerRows.some((r) => String(r.user) === meId));

  // === NEW: thống kê đăng ký & check-in theo Registration ===
  const [registrationsCount, checkedInCount] = await Promise.all([
    Registration.countDocuments({ tournament: id }),
    Registration.countDocuments({
      tournament: id,
      checkinAt: { $ne: null },
    }),
  ]);

  // trả về đầy đủ tour + flags + stats
  res.json({
    ...tour,
    managers,
    amOwner,
    amManager,
    stats: {
      registrationsCount, // số đội đăng ký
      checkedInCount, // số đội đã check-in
    },
  });
});

/**
 * GET /api/tournaments/:id/brackets
 * User route: trả về các bracket của giải, sort theo stage -> order -> createdAt
 * Thêm matchesCount (tính qua $lookup, không tốn populate).
 */
// helper

/* ========== Helpers ========== */
function buildKoLabels(B) {
  const labels = [];
  for (let s = B; s >= 2; s >>= 1) {
    if (s === 8) labels.push("QF");
    else if (s === 4) labels.push("SF");
    else if (s === 2) labels.push("F");
    else labels.push(`R${s}`);
  }
  return labels;
}

function sanitizeKoMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ko = { ...raw };
  if (!ko.entrants || ko.entrants <= 1) {
    if (ko.bracketSize && ko.bracketSize >= 2) {
      const labels = buildKoLabels(ko.bracketSize);
      ko.labels = labels;
      ko.rounds = Math.log2(ko.bracketSize) | 0;
      ko.startKey = labels[0];
    } else return null;
  } else {
    const B =
      ko.bracketSize && ko.bracketSize >= 2
        ? ko.bracketSize
        : 1 << Math.ceil(Math.log2(ko.entrants));
    ko.bracketSize = B;
    ko.rounds = Math.log2(B) | 0;
    ko.byes = typeof ko.byes === "number" ? ko.byes : B - ko.entrants;
    ko.labels =
      Array.isArray(ko.labels) && ko.labels.length
        ? ko.labels
        : buildKoLabels(B);
    ko.startKey = ko.startKey || ko.labels[0];
  }
  return ko;
}

/* ========== Controller ========== */
export const listTournamentBrackets = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isId(id)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }

    const rows = await Bracket.aggregate([
      { $match: { tournament: new mongoose.Types.ObjectId(id) } },
      { $sort: { stage: 1, order: 1, createdAt: 1 } },

      // fallback theo matches (nếu cần)
      {
        $lookup: {
          from: "matches",
          let: { bid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$bracket", "$$bid"] } } },
            { $group: { _id: "$roundKey", matches: { $sum: 1 } } },
            { $project: { _id: 0, roundKey: "$_id", matches: 1 } },
          ],
          as: "_rounds",
        },
      },

      // DrawSession KO mới nhất: LẤY CẢ source & board để FE vẽ sơ đồ prefill
      {
        $lookup: {
          from: "drawsessions",
          let: { bid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$bracket", "$$bid"] },
                    { $eq: ["$mode", "knockout"] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 1, board: 1, computedMeta: 1, source: 1 } }, // 👈 lấy thêm source
          ],
          as: "_draw",
        },
      },

      // Giữ matchesCount như cũ
      {
        $addFields: {
          matchesCount: { $sum: "$_rounds.matches" },
        },
      },
    ]);

    // === Thu thập mọi regId trong board prefill để map tên ===
    const allIds = new Set();
    for (const b of rows) {
      const ds = Array.isArray(b._draw) ? b._draw[0] : null;
      const pairs = ds?.board?.pairs || [];
      for (const p of pairs) {
        if (p?.a) allIds.add(String(p.a));
        if (p?.b) allIds.add(String(p.b));
      }
    }
    const regIds = [...allIds].map((s) => new mongoose.Types.ObjectId(s));
    let regMap = new Map();
    if (regIds.length) {
      const regs = await Registration.find({ _id: { $in: regIds } })
        .select("_id name displayName team shortName")
        .lean();
      regMap = new Map(
        regs.map((r) => [
          String(r._id),
          {
            name:
              r.displayName ||
              r.shortName ||
              r.name ||
              (r.team ? r.team.name : "Unnamed"),
          },
        ])
      );
    }

    // === Hậu xử lý: build ko + prefill (để FE render sơ đồ ngay cả khi chưa có match) ===
    const list = rows.map((b) => {
      let ko = null;
      let prefill = null;

      if (b.type === "knockout") {
        const ds = Array.isArray(b._draw) ? b._draw[0] : null;

        // 1) ƯU TIÊN: ko meta từ DrawSession
        if (ds?.computedMeta?.ko) {
          const sanitized = sanitizeKoMeta(ds.computedMeta.ko);
          if (sanitized) {
            ko = sanitized;
            if (ds.computedMeta.flags) {
              ko.flags = ds.computedMeta.flags;
            }
          }
        }

        // 2) prefill board để vẽ sơ đồ (kể cả khi entrants null/ BYE)
        if (ds?.board?.pairs?.length) {
          const pairs = ds.board.pairs.map((p) => ({
            index: p.index,
            a: p.a
              ? {
                  id: String(p.a),
                  name: regMap.get(String(p.a))?.name || null,
                }
              : null, // null = BYE
            b: p.b
              ? {
                  id: String(p.b),
                  name: regMap.get(String(p.b))?.name || null,
                }
              : null,
          }));
          prefill = {
            drawId: String(ds._id),
            roundKey: ds.board.roundKey || (ko ? ko.startKey : null),
            isVirtual: !!ds?.computedMeta?.flags?.virtual,
            source: ds?.source
              ? {
                  fromBracket: ds.source.fromBracket
                    ? String(ds.source.fromBracket)
                    : null,
                  fromName: ds.source.fromName || null,
                  fromType: ds.source.fromType || null,
                  mode: ds.source.mode || null,
                  params: ds.source.params || null,
                }
              : null,
            pairs,
          };

          // nếu chưa có ko, suy B từ board
          if (!ko) {
            const B = pairs.length * 2;
            if (B >= 2) {
              const labels = buildKoLabels(B);
              ko = {
                bracketSize: B,
                rounds: Math.log2(B) | 0,
                startKey: labels[0],
                labels,
              };
            }
          }
        }

        // 3) Cuối: nếu vẫn chưa có ko thì fallback từ matches
        if (!ko && Array.isArray(b._rounds) && b._rounds.length) {
          const maxMatches = b._rounds.reduce(
            (m, r) => Math.max(m, r?.matches || 0),
            0
          );
          const B = maxMatches * 2;
          if (B >= 2) {
            const labels = buildKoLabels(B);
            ko = {
              bracketSize: B,
              rounds: Math.log2(B) | 0,
              startKey: labels[0],
              labels,
            };
          }
        }
      }

      // loại bỏ field tạm
      const { _rounds, _draw, ...rest } = b;
      const out = { ...rest };
      if (ko) out.ko = ko;
      if (prefill) out.prefill = prefill;
      return out;
    });

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
      status, // optional: 'scheduled' | 'queued' | 'assigned' | 'live' | 'finished'
      court, // 🆕 optional: court id cụ thể
      hasCourt, // 🆕 optional: '1' | 'true' → chỉ lấy trận đã gán sân
      courtStatus, // 🆕 optional: lọc theo trạng thái của sân (idle/assigned/live/maintenance)
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

    // Base filter
    const filter = { tournament: id };
    if (status) filter.status = status;
    if (bracket && isId(bracket)) filter.bracket = bracket;

    // Lọc theo stage/type -> lấy ds bracket trước
    if (
      (stage && Number.isFinite(Number(stage))) ||
      (type && typeof type === "string")
    ) {
      const bFilter = { tournament: id };
      if (stage) bFilter.stage = Number(stage);
      if (type) bFilter.type = type;

      const brs = await Bracket.find(bFilter).select("_id").lean();
      const ids = brs.map((b) => b._id);
      if (filter.bracket) {
        filter.bracket = {
          $in: ids.filter((x) => String(x) === String(filter.bracket)),
        };
      } else {
        filter.bracket = { $in: ids };
      }
    }

    // 🆕 Lọc theo court
    if (court && isId(court)) {
      filter.court = court;
    }
    // 🆕 Chỉ lấy trận đã gán court
    if (hasCourt === "1" || hasCourt === "true") {
      filter.court = { $ne: null, ...(filter.court || {}) };
    }

    // 🆕 Lọc theo courtStatus (cần tra bảng Court -> danh sách courtId theo status)
    if (courtStatus) {
      const courtCond = { tournament: id };
      if (bracket && isId(bracket)) courtCond.bracket = bracket;
      const courts = await Court.find({ ...courtCond, status: courtStatus })
        .select("_id")
        .lean();
      const ids = courts.map((c) => c._id);
      // nếu đã có filter.court thì giao phần giao nhau
      if (filter.court && filter.court.$ne === null) {
        // đã có điều kiện khác (vd hasCourt), chuyển thành $in
        filter.court = { $in: ids };
      } else if (filter.court) {
        // đã set 1 court cụ thể → kiểm tra khớp status
        if (!ids.some((x) => String(x) === String(filter.court))) {
          // không có court này trong status yêu cầu → trả rỗng nhanh
          return res.json({ total: 0, page: 1, limit: 0, list: [] });
        }
      } else {
        filter.court = { $in: ids };
      }
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 1000);
    const skip = (pg - 1) * lim;

    // Query + populate
    const [listRaw, total] = await Promise.all([
      Match.find(filter)
        .populate({ path: "tournament", select: "name" })
        .populate({ path: "bracket", select: "name type stage order" })
        .populate({ path: "pairA", select: "player1 player2" })
        .populate({ path: "pairB", select: "player1 player2" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "referee", select: "name nickname" })
        // 🆕 LẤY SÂN đầy đủ hơn
        .populate({
          path: "court",
          select: "name cluster status bracket order",
        })
        .sort(sortSpec)
        .skip(lim ? skip : 0)
        .limit(lim || 0)
        .lean(),
      Match.countDocuments(filter),
    ]);

    // 🆕 Phẳng hoá thông tin sân để FE dùng tiện
    const list = listRaw.map((m) => ({
      ...m,
      courtId: m.court?._id || m.court || null,
      courtName: m.court?.name || m.courtLabel || "", // ưu tiên tên Court, fallback courtLabel
      courtStatus: m.court?.status || "", // trạng thái sân hiện tại
      courtOrder: m.court?.order ?? null, // thứ tự sân trong bracket
      courtBracket: m.court?.bracket || null, // bracket của sân (thiết kế mới: required)
      courtCluster: m.court?.cluster || m.courtCluster || "", // clusterKey (thường = String(bracketId))
    }));

    res.json({ total, page: pg, limit: lim, list });
  } catch (err) {
    next(err);
  }
});

export { getTournaments, getTournamentById };
