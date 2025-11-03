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
  const hasSortQP = Object.prototype.hasOwnProperty.call(req.query, "sort");
  const sortQP = (req.query.sort || "").toString().trim();
  const limit = req.query.limit
    ? Math.max(parseInt(req.query.limit, 10) || 0, 0)
    : null;
  const status = (req.query.status || "").toString().toLowerCase(); // upcoming|ongoing|finished (chỉ dùng lọc nếu có)
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
  const sortSpecFromQP = hasSortQP ? parseSort(sortQP) : {};

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
        { location: { $regex: tk, $options: "i" } },
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

  // ----- Chuẩn hoá mốc thời gian -----
  pipeline.push({
    $addFields: {
      _startInstant: { $ifNull: ["$startAt", "$startDate"] },
      _endInstant: {
        $ifNull: [
          { $ifNull: ["$endAt", "$endDate"] },
          { $ifNull: ["$startAt", "$startDate"] }, // fallback
        ],
      },
    },
  });

  // ----- Tính “độ gần để sort” KHÔNG dựa trên status -----
  // nearDeltaMs: 0 cho giải đang diễn ra (now ∈ [start,end])
  //              (start - now) cho giải sắp diễn ra
  //              (now - end) cho giải đã kết thúc
  // tieMs:      ưu tiên kết thúc sớm hơn trong ongoing; bắt đầu sớm hơn trong upcoming; kết thúc gần hơn trong finished
  pipeline.push(
    {
      $addFields: {
        _isOngoing: {
          $and: [
            { $lte: ["$_startInstant", "$$NOW"] },
            { $gte: ["$_endInstant", "$$NOW"] },
          ],
        },
        _isUpcoming: { $gt: ["$_startInstant", "$$NOW"] },
      },
    },
    {
      $addFields: {
        nearDeltaMs: {
          $cond: [
            "$_isOngoing",
            0,
            {
              $cond: [
                "$_isUpcoming",
                { $subtract: ["$_startInstant", "$$NOW"] },
                { $subtract: ["$$NOW", "$_endInstant"] },
              ],
            },
          ],
        },
        tieMs: {
          $cond: [
            "$_isOngoing",
            { $max: [0, { $subtract: ["$_endInstant", "$$NOW"] }] }, // sắp kết thúc trước → lên trước
            {
              $cond: [
                "$_isUpcoming",
                { $max: [0, { $subtract: ["$_startInstant", "$$NOW"] }] }, // bắt đầu sớm hơn → lên trước
                { $max: [0, { $subtract: ["$$NOW", "$_endInstant"] }] }, // vừa kết thúc → lên trước
              ],
            },
          ],
        },
      },
    }
  );

  // ----- (Tuỳ chọn) Lọc theo status nếu client truyền, nhưng KHÔNG dùng status để sort -----
  if (["upcoming", "ongoing", "finished"].includes(status)) {
    // dùng status lưu trong DB (nếu muốn vẫn có thể tính runtime như trước)
    pipeline.push({ $match: { status } });
  }

  // ----- Sort / Limit -----
  // Ưu tiên tuyệt đối theo nearDeltaMs -> tieMs; sau đó cho phép ép thêm trường phụ từ QP (nếu có) -> _id ổn định
  pipeline.push({
    $sort: {
      nearDeltaMs: 1,
      tieMs: 1,
      ...sortSpecFromQP,
      _id: -1,
    },
  });
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
        _isOngoing: 0,
        _isUpcoming: 0,
        nearDeltaMs: 0,
        tieMs: 0,
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
const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
};

export { getTournaments, getTournamentById };

export const listTournamentMatches = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isId(id))
      return res.status(400).json({ message: "Invalid tournament id" });

    const {
      bracket,
      stage,
      type,
      status,
      court,
      hasCourt,
      courtStatus,
      page = 1,
      limit = 200000,
      sort = "round,order,createdAt",
    } = req.query;

    // ---- parse sort ----
    const parseSort = (s) =>
      String(s || "")
        .split(",")
        .reduce((acc, tok) => {
          const key = tok.trim();
          if (!key) return acc;
          acc[key.startsWith("-") ? key.slice(1) : key] = key.startsWith("-")
            ? -1
            : 1;
          return acc;
        }, {});
    const sortSpec = Object.keys(parseSort(sort)).length
      ? parseSort(sort)
      : { round: 1, order: 1, createdAt: 1 };

    // ---- base filter ----
    const filter = { tournament: id };
    if (status) filter.status = status;
    if (bracket && isId(bracket)) filter.bracket = bracket;

    if (
      (stage && Number.isFinite(Number(stage))) ||
      (type && typeof type === "string")
    ) {
      const bFilter = { tournament: id };
      if (stage) bFilter.stage = Number(stage);
      if (type) bFilter.type = type;
      const brs = await Bracket.find(bFilter).select("_id").lean();
      const ids = brs.map((b) => b._id);
      filter.bracket = filter.bracket
        ? { $in: ids.filter((x) => String(x) === String(filter.bracket)) }
        : { $in: ids };
    }

    // ---- court filters ----
    if (court && isId(court)) filter.court = court;
    if (hasCourt === "1" || hasCourt === "true") {
      filter.court = { $ne: null, ...(filter.court || {}) };
    }
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
        if (!ids.some((x) => String(x) === String(filter.court)))
          return res.json({ total: 0, page: 1, limit: 0, list: [] });
      } else {
        filter.court = { $in: ids };
      }
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 1000);
    const skip = (pg - 1) * lim;

    // ---- fetch ----
    const [listRaw, total] = await Promise.all([
      Match.find(filter)
        .populate({ path: "tournament", select: "name" })
        .populate({
          path: "bracket",
          // cần groups để map B từ pool/name/_id
          select:
            "name type stage order prefill ko meta config drawRounds groups._id groups.name",
        })
        .populate({ path: "pairA", select: "player1 player2 name teamName" })
        .populate({ path: "pairB", select: "player1 player2 name teamName" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "referee", select: "name nickname" })
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

    // ---- stage buckets: Group = V1 cho toàn giải ----
    const allBrackets = await Bracket.find({ tournament: id })
      .select("_id type stage order prefill ko meta config drawRounds")
      .lean();

    // max round theo bracket (fallback khi thiếu config)
    const roundsAgg = await Match.aggregate([
      { $match: { tournament: toObjectId(id) } }, // dùng helper toObjectId của bạn
      { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
    ]);
    const maxRoundByBracket = new Map(
      roundsAgg.map((r) => [String(r._id), Number(r.maxRound) || 0])
    );

    const tkey = (t) => String(t || "").toLowerCase();
    const isGroupish = (t) => {
      const k = tkey(t);
      return k === "group" || k === "round_robin" || k === "gsl";
    };

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
        .map(Number)
        .filter((x) => Number.isFinite(x) && x >= 2);
      return cands.length ? ceilPow2(Math.max(...cands)) : 0;
    };
    const roundsCountForBracket = (br) => {
      const type = tkey(br?.type);
      const bid = String(br?._id || "");
      if (isGroupish(type)) return 1;

      // roundElim / playoff
      if (["roundelim", "po", "playoff"].includes(type)) {
        let k =
          Number(br?.meta?.maxRounds) ||
          Number(br?.config?.roundElim?.maxRounds) ||
          0;
        if (!k) k = maxRoundByBracket.get(bid) || 1;
        return Math.max(1, k);
      }

      // knockout / double_elim...
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
      return drawRounds ? Math.max(1, drawRounds) : 1;
    };

    const groupBrs = allBrackets.filter((b) => isGroupish(b.type));
    const nonGroupBrs = allBrackets.filter((b) => !isGroupish(b.type));
    const stageVal = (b) =>
      Number.isFinite(b?.stage) ? Number(b.stage) : 9999;

    const buckets = [];
    if (groupBrs.length) {
      buckets.push({
        key: "group",
        isGroup: true,
        brs: groupBrs,
        spanRounds: 1, // cả vòng bảng = V1
        stageHint: 1,
        orderHint: Math.min(...groupBrs.map((b) => Number(b?.order ?? 0))),
      });
    }
    const byStage = new Map();
    for (const b of nonGroupBrs) {
      const s = stageVal(b);
      if (!byStage.has(s)) byStage.set(s, []);
      byStage.get(s).push(b);
    }
    const stageKeys = Array.from(byStage.keys()).sort((a, b) => a - b);
    for (const s of stageKeys) {
      const brs = byStage.get(s);
      const span = Math.max(...brs.map((b) => roundsCountForBracket(b))) || 1;
      buckets.push({
        key: `stage-${s}`,
        isGroup: false,
        brs,
        spanRounds: span,
        stageHint: s,
        orderHint: Math.min(...brs.map((b) => Number(b?.order ?? 0))),
      });
    }
    buckets.sort((a, b) => {
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      if (a.stageHint !== b.stageHint) return a.stageHint - b.stageHint;
      return a.orderHint - b.orderHint;
    });

    const baseByBracketId = new Map();
    let acc = 0;
    for (const bucket of buckets) {
      for (const br of bucket.brs) baseByBracketId.set(String(br._id), acc);
      acc += bucket.spanRounds;
    }

    // ---- helpers build code ----
    const safeInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const alphaToNum = (s) => {
      const m = String(s || "")
        .trim()
        .match(/^[A-Za-z]/);
      if (!m) return undefined;
      return m[0].toUpperCase().charCodeAt(0) - 64; // A=1, B=2, ...
    };
    const getGroupNo = (m, br) => {
      // 1) từ pool.name hoặc pool.key
      const poolName = m?.pool?.name || m?.pool?.key || m?.groupCode || "";
      if (poolName) {
        const num = String(poolName).match(/\d+/);
        if (num) return parseInt(num[0], 10);
        const a = alphaToNum(poolName);
        if (a) return a;
      }
      // 2) map theo _id / name trong bracket.groups
      const groups = Array.isArray(br?.groups) ? br.groups : [];
      if (groups.length) {
        if (m?.pool?.id) {
          const i = groups.findIndex(
            (g) => String(g?._id) === String(m.pool.id)
          );
          if (i >= 0) return i + 1;
        }
        if (poolName) {
          const i = groups.findIndex(
            (g) =>
              String(g?.name || "")
                .trim()
                .toUpperCase() === String(poolName).trim().toUpperCase()
          );
          if (i >= 0) return i + 1;
        }
      }
      // 3) các field số trực tiếp
      const direct = [
        m?.groupNo,
        m?.groupIndex,
        m?.groupIdx,
        m?.group,
        m?.meta?.groupNo,
        m?.meta?.groupIndex,
        m?.meta?.pool,
        m?.group?.no,
        m?.group?.index,
        m?.group?.order,
        m?.pool?.index,
        m?.pool?.no,
        m?.pool?.order,
      ];
      for (const c of direct) {
        const n = safeInt(c);
        if (typeof n === "number") return n <= 0 ? 1 : n;
      }
      return undefined;
    };
    const getGroupT = (m) => {
      // ưu tiên labelKey: "...#N" (N 1-based)
      const lk = String(m?.labelKey || "");
      const mk = lk.match(/#(\d+)\s*$/);
      if (mk) return parseInt(mk[1], 10);

      const oig = safeInt(m?.orderInGroup) ?? safeInt(m?.meta?.orderInGroup);
      if (typeof oig === "number") return oig + 1;

      const ord = safeInt(m?.order);
      if (typeof ord === "number") return ord + 1;

      return 1;
    };
    const getNonGroupT = (m) => {
      const lk = String(m?.labelKey || "");
      const mk = lk.match(/#(\d+)\s*$/);
      if (mk) return parseInt(mk[1], 10);

      const ord =
        safeInt(m?.order) ??
        safeInt(m?.meta?.order) ??
        safeInt(m?.matchNo) ??
        safeInt(m?.index) ??
        0;
      return ord + 1;
    };

    // ---- flatten + FINAL CODE ----
    const list = listRaw.map((m) => {
      const br = m.bracket || {};
      const bid = String(br?._id || "");
      const groupStage = isGroupish(br?.type);

      const base = baseByBracketId.get(bid) ?? 0;
      const localRound = groupStage
        ? 1
        : Number.isFinite(m.round)
        ? m.round
        : 1;
      const globalRound = base + localRound; // KO ngay sau group => 2

      let code;
      if (groupStage) {
        const bNo = getGroupNo(m, br);
        const T = getGroupT(m);
        code = `V1-${bNo ? `B${bNo}` : "B?"}-T${T}`;
      } else {
        const T = getNonGroupT(m);
        code = `V${globalRound}-T${T}`;
      }

      const globalCode = `V${globalRound}`;

      // phẳng court
      const courtId = m.court?._id || m.court || null;
      const courtName = m.court?.name || m.courtLabel || "";
      const courtStatus = m.court?.status || "";
      const courtOrder = Number.isFinite(m.court?.order) ? m.court.order : null;
      const courtBracket = m.court?.bracket || null;
      const courtCluster = m.court?.cluster || m.courtCluster || "";

      return {
        ...m,
        courtId,
        courtName,
        courtStatus,
        courtOrder,
        courtBracket,
        courtCluster,
        globalRound,
        globalCode, // "V1", "V2", ...
        code, // "V1-Bx-Ty" hoặc "V2-Tz" ...
      };
    });

    res.json({ total, page: pg, limit: lim, list });
  } catch (err) {
    next(err);
  }
});
