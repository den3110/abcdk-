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
  const sortSpecRaw = parseSort(sort);
  const sortSpec = Object.keys(sortSpecRaw).length
    ? sortSpecRaw
    : { startDate: -1, _id: -1 };

  // Nếu cần hiển thị theo TZ cụ thể ở FE thì dùng; còn logic trạng thái dựa trên *_At (UTC) đã chuẩn từ TZ của từng giải.
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
        { "location.city": { $regex: tk, $options: "i" } }, // nếu location là object
        { "location.province": { $regex: tk, $options: "i" } },
        { location: { $regex: tk, $options: "i" } }, // nếu location là string
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

  // ----- Tính status theo "instant" (ưu tiên finishedAt) -----
  pipeline.push(
    {
      $addFields: {
        _startInstant: { $ifNull: ["$startAt", "$startDate"] },
        _endInstant: { $ifNull: ["$endAt", "$endDate"] },
      },
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $ne: ["$finishedAt", null] }, then: "finished" },
              { case: { $lt: ["$$NOW", "$_startInstant"] }, then: "upcoming" },
              { case: { $gt: ["$$NOW", "$_endInstant"] }, then: "finished" },
            ],
            default: "ongoing",
          },
        },
      },
    }
  );

  // ----- Lọc theo status (nếu truyền) -----
  if (["upcoming", "ongoing", "finished"].includes(status)) {
    pipeline.push({ $match: { status } });
  }

  // ----- Ưu tiên sort theo status trước -----
  pipeline.push({
    $addFields: {
      statusPriority: {
        $switch: {
          branches: [
            { case: { $eq: ["$status", "ongoing"] }, then: 0 },
            { case: { $eq: ["$status", "upcoming"] }, then: 1 },
          ],
          default: 2, // finished
        },
      },
    },
  });

  // ----- Sort / Limit -----
  pipeline.push({ $sort: { statusPriority: 1, ...sortSpec } });
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

  // ----- Bracket stats / effectiveNoRankDelta -----
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
    {
      $project: {
        _rc: 0,
        _bc: 0,
        _startInstant: 0,
        _endInstant: 0,
        statusPriority: 0,
      },
    }
  );

  const tournaments = await Tournament.aggregate(pipeline);
  res.status(200).json(tournaments);
});

const getTournamentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  // Lấy tournament
  const tour = await Tournament.findById(id).lean();
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const meId = req.user?._id ? String(req.user._id) : null;

  // Managers
  const managerRows = await TournamentManager.find({ tournament: id })
    .select("user role")
    .lean();

  const managers = managerRows.map((r) => ({ user: r.user, role: r.role }));

  const amOwner = !!(meId && String(tour.createdBy) === meId);
  const amManager =
    amOwner || (!!meId && managerRows.some((r) => String(r.user) === meId));

  // ---- Derive status runtime (upcoming/ongoing/finished)
  const now = new Date();
  const startInstant = tour.startAt || tour.startDate;
  const endInstant = tour.endAt || tour.endDate;

  let status = "upcoming";
  if (tour.finishedAt) status = "finished";
  else if (startInstant && now < new Date(startInstant)) status = "upcoming";
  else if (endInstant && now > new Date(endInstant)) status = "finished";
  else status = "ongoing";

  // ---- Stats: đăng ký / check-in / đã thanh toán
  const [registrationsCount, checkedInCount, paidCount] = await Promise.all([
    Registration.countDocuments({ tournament: id }),
    Registration.countDocuments({ tournament: id, checkinAt: { $ne: null } }),
    Registration.countDocuments({
      tournament: id,
      "payment.status": "Paid",
    }),
  ]);

  // ---- Chuẩn hoá thông tin thanh toán (SePay VietQR)
  const bankShortName =
    tour.bankShortName || tour.qrBank || tour.bankCode || tour.bank || "";
  const bankAccountNumber =
    tour.bankAccountNumber || tour.qrAccount || tour.bankAccount || "";
  const bankAccountName =
    tour.bankAccountName ||
    tour.accountName ||
    tour.paymentAccountName ||
    tour.beneficiaryName ||
    "";
  const registrationFee = (() => {
    const raw = tour.registrationFee ?? tour.fee ?? tour.entryFee ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  })();

  // Trả về
  res.json({
    ...tour,
    status, // trạng thái tính theo thời điểm hiện tại
    managers,
    amOwner,
    amManager,
    stats: {
      registrationsCount,
      checkedInCount,
      paidCount,
    },

    // payment fields (mới)
    bankShortName,
    bankAccountNumber,
    bankAccountName,
    registrationFee,

    // alias cũ để tương thích ngược (UI/logic cũ)
    qrBank: bankShortName,
    qrAccount: bankAccountNumber,
    fee: registrationFee,
    entryFee: registrationFee,
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
      if (filter.court && filter.court.$ne === null) {
        filter.court = { $in: ids };
      } else if (filter.court) {
        if (!ids.some((x) => String(x) === String(filter.court))) {
          return res.json({ total: 0, page: 1, limit: 0, list: [] });
        }
      } else {
        filter.court = { $in: ids };
      }
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 1000);
    const skip = (pg - 1) * lim;

    // ====== LẤY MATCHES + COUNT ======
    const [listRaw, total] = await Promise.all([
      Match.find(filter)
        .populate({ path: "tournament", select: "name" })
        .populate({
          path: "bracket",
          select: "name type stage order prefill ko meta config drawRounds",
        })
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

    // ====== TÍNH GLOBAL V-ROUND OFFSET CHO TOÀN GIẢI ======
    // Lấy tất cả bracket của giải (không áp filter) để cộng dồn chính xác
    const allBrackets = await Bracket.find({ tournament: id })
      .select("_id type stage order prefill ko meta config drawRounds")
      .lean();

    // Lấy thống kê round theo bracket (maxRound) để ước lượng số vòng nếu chưa có cấu hình
    const roundsAgg = await Match.aggregate([
      { $match: { tournament: id } },
      { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
    ]);
    const maxRoundByBracket = new Map(
      roundsAgg.map((r) => [String(r._id), Number(r.maxRound) || 0])
    );

    // Helpers: đọc "quy mô" cho KO để suy ra số vòng nếu chưa có trận
    const teamsFromRoundKey = (k) => {
      if (!k) return 0;
      const up = String(k).toUpperCase();
      if (up === "F") return 2;
      if (up === "SF") return 4;
      if (up === "QF") return 8;
      const m = /^R(\d+)$/i.exec(up);
      return m ? parseInt(m[1], 10) : 0;
    };
    const ceilPow2 = (n) =>
      Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
    const readBracketScale = (br) => {
      const fromKey =
        teamsFromRoundKey(br?.ko?.startKey) ||
        teamsFromRoundKey(br?.prefill?.roundKey);
      const fromPrefillPairs = Array.isArray(br?.prefill?.pairs)
        ? br.prefill.pairs.length * 2
        : 0;
      const fromPrefillSeeds = Array.isArray(br?.prefill?.seeds)
        ? br.prefill.seeds.length * 2
        : 0;
      const cands = [
        br?.drawScale,
        br?.targetScale,
        br?.maxSlots,
        br?.capacity,
        br?.size,
        br?.scale,
        br?.meta?.drawSize,
        br?.meta?.scale,
        fromKey,
        fromPrefillPairs,
        fromPrefillSeeds,
      ]
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x >= 2);
      if (!cands.length) return 0;
      return ceilPow2(Math.max(...cands));
    };

    const roundsCountForBracket = (br) => {
      const type = String(br?.type || "").toLowerCase();
      const bid = String(br?._id || "");
      if (type === "group" || type === "roundrobin") return 1; // vòng bảng = V1

      if (type === "roundelim" || type === "po") {
        let k =
          Number(br?.meta?.maxRounds) ||
          Number(br?.config?.roundElim?.maxRounds) ||
          0;
        if (!k) {
          const rFromMatches = maxRoundByBracket.get(bid) || 0;
          k = rFromMatches || 1;
        }
        return Math.max(1, k);
      }

      // knockout / ko
      const rFromMatches = maxRoundByBracket.get(bid) || 0;
      if (rFromMatches) return Math.max(1, rFromMatches);

      const firstPairs =
        (Array.isArray(br?.prefill?.seeds) && br.prefill.seeds.length) ||
        (Array.isArray(br?.prefill?.pairs) && br.prefill.pairs.length) ||
        0;
      if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));

      const scale = readBracketScale(br);
      if (scale) return Math.ceil(Math.log2(scale));

      const drawRounds = Number(br?.drawRounds || 0);
      if (drawRounds) return Math.max(1, drawRounds);

      return 1;
    };

    // Sắp xếp bracket theo order -> stage -> _id để tính offset ổn định
    const sortedBrs = (allBrackets || []).slice().sort((a, b) => {
      const ao = Number.isFinite(a?.order) ? a.order : 9999;
      const bo = Number.isFinite(b?.order) ? b.order : 9999;
      if (ao !== bo) return ao - bo;
      const as = Number.isFinite(a?.stage) ? a.stage : 9999;
      const bs = Number.isFinite(b?.stage) ? b.stage : 9999;
      if (as !== bs) return as - bs;
      return String(a._id).localeCompare(String(b._id));
    });

    // Tính offset cộng dồn
    const offsetByBracket = new Map();
    let acc = 0;
    for (const b of sortedBrs) {
      offsetByBracket.set(String(b._id), acc);
      acc += roundsCountForBracket(b);
    }

    // 🆕 Phẳng hoá thông tin sân + gán globalRound/globalCode
    const list = listRaw.map((m) => {
      const courtId = m.court?._id || m.court || null;
      const courtName = m.court?.name || m.courtLabel || "";
      const courtStatus = m.court?.status || "";
      const courtOrder = Number.isFinite(m.court?.order) ? m.court.order : null;
      const courtBracket = m.court?.bracket || null;
      const courtCluster = m.court?.cluster || m.courtCluster || "";

      // ====== GLOBAL V-ROUND & CODE ======
      const br = m.bracket || {};
      const bid = String(br?._id || "");
      const isGroup =
        String(br?.type || "").toLowerCase() === "group" ||
        String(br?.type || "").toLowerCase() === "roundrobin";
      const base = offsetByBracket.get(bid) || 0;
      const localRound = isGroup ? 1 : Number.isFinite(m.round) ? m.round : 1; // KO/PO: dùng round; Group: coi là 1
      const globalRound = base + localRound;
      const tIdx = Number.isFinite(m.order) ? m.order + 1 : null;
      const globalCode = `V${globalRound}${tIdx ? `-T${tIdx}` : ""}`;

      return {
        ...m,
        courtId,
        courtName,
        courtStatus,
        courtOrder,
        courtBracket,
        courtCluster,
        // NEW:
        globalRound,
        globalCode,
      };
    });

    res.json({ total, page: pg, limit: lim, list });
  } catch (err) {
    next(err);
  }
});

export { getTournaments, getTournamentById };
