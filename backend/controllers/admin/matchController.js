import Match from "../../models/matchModel.js";
import Bracket from "../../models/bracketModel.js";
import Registration from "../../models/registrationModel.js";
import User from "../../models/userModel.js";
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { softResetChainFrom } from "../../services/matchChainReset.js";
import applyRatingsForMatch from "../../utils/applyRatingsForMatch.js";
import { applyRatingForFinishedMatch } from "../../utils/applyRatingForFinishedMatch.js";
import { onMatchFinished } from "../../services/courtQueueService.js";
import { scheduleMatchStartSoon } from "../../utils/scheduleNotifications.js";
import { decorateServeAndSlots } from "../../utils/liveServeUtils.js";

/* Tạo 1 trận trong 1 bảng */
export const adminCreateMatch = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const {
    pairA,
    pairB,
    previousA,
    previousB,
    round = 1,
    order = 0,
    rules,
    ratingDelta, // giữ như cũ
    referee, // userId trọng tài (optional)
    // ⭐ NEW: chỉ dùng video
    video,
  } = req.body;

  const bracket = await Bracket.findById(bracketId);
  if (!bracket) {
    res.status(404);
    throw new Error("Bracket not found");
  }

  // Validate nguồn đội (giữ nguyên)
  if (pairA && previousA) {
    res.status(400);
    throw new Error("Provide either pairA or previousA for side A (not both)");
  }
  if (pairB && previousB) {
    res.status(400);
    throw new Error("Provide either pairB or previousB for side B (not both)");
  }
  if ((!pairA && !previousA) || (!pairB && !previousB)) {
    res.status(400);
    throw new Error("Each side must have a team: pairX or previousX");
  }
  if (previousA && previousB && String(previousA) === String(previousB)) {
    res.status(400);
    throw new Error("previousA and previousB cannot be the same match");
  }
  if (pairA && pairB && String(pairA) === String(pairB)) {
    res.status(400);
    throw new Error("Two teams must be different");
  }

  // ===== Chuẩn hoá rules (thêm cap) — giữ nguyên =====
  const capModeRaw = (rules?.cap?.mode ?? "none").toString();
  const capMode = ["none", "hard", "soft"].includes(capModeRaw)
    ? capModeRaw
    : "none";
  let capPoints =
    rules?.cap?.points === "" ||
    rules?.cap?.points === null ||
    rules?.cap?.points === undefined
      ? null
      : Number(rules?.cap?.points);
  capPoints =
    Number.isFinite(capPoints) && capPoints > 0 ? Math.floor(capPoints) : null;
  if (capMode === "none") capPoints = null;

  const finalRules = {
    bestOf: [1, 3, 5].includes(Number(rules?.bestOf))
      ? Number(rules.bestOf)
      : 3,
    pointsToWin: [11, 15, 21].includes(Number(rules?.pointsToWin))
      ? Number(rules.pointsToWin)
      : 11,
    winByTwo: typeof rules?.winByTwo === "boolean" ? rules.winByTwo : true,
    cap: { mode: capMode, points: capPoints },
  };

  // Nếu theo Registration: kiểm tra tính hợp lệ (giữ nguyên)
  let rA = null,
    rB = null;
  if (pairA) {
    rA = await Registration.findById(pairA);
    if (!rA) {
      res.status(400);
      throw new Error("pairA is not a valid registration");
    }
    if (String(rA.tournament) !== String(bracket.tournament)) {
      res.status(400);
      throw new Error("pairA does not belong to this tournament");
    }
  }
  if (pairB) {
    rB = await Registration.findById(pairB);
    if (!rB) {
      res.status(400);
      throw new Error("pairB is not a valid registration");
    }
    if (String(rB.tournament) !== String(bracket.tournament)) {
      res.status(400);
      throw new Error("pairB does not belong to this tournament");
    }
  }

  // Nếu theo Winner-of: kiểm tra trận nguồn (giữ nguyên)
  let prevMatchA = null,
    prevMatchB = null;
  if (previousA) {
    prevMatchA = await Match.findById(previousA);
    if (!prevMatchA) {
      res.status(400);
      throw new Error("previousA match not found");
    }
    if (
      String(prevMatchA.bracket) !== String(bracketId) ||
      String(prevMatchA.tournament) !== String(bracket.tournament)
    ) {
      res.status(400);
      throw new Error(
        "previousA must be a match in the same bracket/tournament"
      );
    }
    if ((prevMatchA.round || 1) >= Number(round)) {
      res.status(400);
      throw new Error("previousA must be from an earlier round");
    }
  }
  if (previousB) {
    prevMatchB = await Match.findById(previousB);
    if (!prevMatchB) {
      res.status(400);
      throw new Error("previousB match not found");
    }
    if (
      String(prevMatchB.bracket) !== String(bracketId) ||
      String(prevMatchB.tournament) !== String(bracket.tournament)
    ) {
      res.status(400);
      throw new Error(
        "previousB must be a match in the same bracket/tournament"
      );
    }
    if ((prevMatchB.round || 1) >= Number(round)) {
      res.status(400);
      throw new Error("previousB must be from an earlier round");
    }
  }

  // Validate mềm cho knockout khi round > 1 và chọn tay (giữ nguyên)
  if (Number(round) > 1 && (pairA || pairB)) {
    const prevRoundMatches = await Match.find({
      bracket: bracketId,
      tournament: bracket.tournament,
      round: Number(round) - 1,
    }).select("pairA pairB");

    const appearedInPrev = new Set();
    prevRoundMatches.forEach((m) => {
      if (m.pairA) appearedInPrev.add(String(m.pairA));
      if (m.pairB) appearedInPrev.add(String(m.pairB));
    });

    if (pairA && !appearedInPrev.has(String(pairA))) {
      res.status(400);
      throw new Error(
        "pairA is not coming from previous round of this bracket"
      );
    }
    if (pairB && !appearedInPrev.has(String(pairB))) {
      res.status(400);
      throw new Error(
        "pairB is not coming from previous round of this bracket"
      );
    }

    const samePrevMatch = prevRoundMatches.some(
      (m) =>
        (String(m.pairA) === String(pairA) &&
          String(m.pairB) === String(pairB)) ||
        (String(m.pairA) === String(pairB) && String(m.pairB) === String(pairA))
    );
    if (samePrevMatch) {
      res.status(400);
      throw new Error(
        "Both teams come from the same previous match; pick two different matches"
      );
    }
  }

  // validate & chuẩn hoá referee (nếu có) — giữ nguyên
  let refId = undefined;
  if (referee !== undefined && referee !== null && referee !== "") {
    if (!mongoose.isValidObjectId(referee)) {
      res.status(400);
      throw new Error("referee không hợp lệ");
    }
    const refUser = await User.findById(referee).select("_id role");
    if (!refUser) {
      res.status(404);
      throw new Error("Không tìm thấy người dùng để gán làm trọng tài");
    }
    if (!["referee", "admin"].includes(refUser.role)) {
      res.status(400);
      throw new Error("Người này không có quyền trọng tài");
    }
    refId = refUser._id;
  }

  // ⭐ NEW: chuẩn hoá video nếu được gửi lên (không thay đổi gì nếu client không gửi)
  const hasVideoField = Object.prototype.hasOwnProperty.call(req.body, "video");
  const videoSanitized = hasVideoField
    ? video == null
      ? ""
      : String(video).trim()
    : undefined;

  // Tạo match (giữ nguyên, chỉ thêm video nếu có gửi)
  const createPayload = {
    tournament: bracket.tournament,
    bracket: bracketId,
    round: Math.max(1, Number(round)),
    order: Math.max(0, Number(order)),
    pairA: pairA || null,
    pairB: pairB || null,
    previousA: previousA || null,
    previousB: previousB || null,
    rules: finalRules,
    gameScores: [],
    status: "scheduled",
    ratingDelta: Math.max(0, Number(ratingDelta) || 0),
    ratingApplied: false,
    ratingAppliedAt: null,
    referee: refId,
  };
  if (hasVideoField) createPayload.video = videoSanitized;

  try {
    const match = await Match.create(createPayload);
  } catch (e) {
    console.log(e);
  }
  await scheduleMatchStartSoon(match);

  // Link ngược từ trận nguồn (giữ nguyên)
  if (prevMatchA) {
    prevMatchA.nextMatch = match._id;
    prevMatchA.nextSlot = "A";
    await prevMatchA.save();
  }
  if (prevMatchB) {
    prevMatchB.nextMatch = match._id;
    prevMatchB.nextSlot = "B";
    await prevMatchB.save();
  }

  // tăng đếm (giữ nguyên)
  bracket.matchesCount = (bracket.matchesCount || 0) + 1;
  await bracket.save();

  const populated = await Match.findById(match._id)
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    .populate({
      path: "referee",
      select: "name nickname email phone avatar role",
    });

  res.status(201).json(populated);
});

/* Danh sách trận theo bracket */
export const getMatchesByBracket = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(bracketId)) {
    return res.status(400).json({ message: "Invalid bracket id" });
  }

  const { status, type, round, rrRound, stage, limit, skip } = req.query;

  // ===== load bracket hiện tại để biết type/order/tournament
  const br = await Bracket.findById(bracketId)
    .select("_id tournament type order")
    .lean();
  if (!br) return res.status(404).json({ message: "Bracket not found" });

  const GROUP_TYPES = new Set(["group", "round_robin", "gsl"]);
  const isGroupBracket = GROUP_TYPES.has(String(br.type || "").toLowerCase());

  // ===== tính elimOffset: tổng số "vòng" của các bracket non-group đứng trước (order < current)
  let elimOffset = 0;
  if (!isGroupBracket && Number.isFinite(Number(br.order))) {
    // 1) Lấy danh sách prev brackets cùng tournament, order < current
    const prevBrs = await Bracket.find({
      tournament: br.tournament,
      order: { $lt: br.order },
    })
      .select("_id type meta.maxRounds")
      .lean();

    // 2) Chỉ giữ non-group
    const prevElim = prevBrs.filter(
      (b) => !GROUP_TYPES.has(String(b.type || "").toLowerCase())
    );

    if (prevElim.length) {
      const prevIds = prevElim.map((b) => b._id);

      // 3) Lấy max(round) theo bracket từ collection Match (nếu đã tạo trận)
      const maxRoundsAgg = await Match.aggregate([
        { $match: { bracket: { $in: prevIds } } },
        {
          $group: {
            _id: "$bracket",
            maxRound: { $max: { $ifNull: ["$round", 0] } },
          },
        },
      ]).allowDiskUse(true);

      const maxRoundMap = new Map(
        maxRoundsAgg.map((x) => [String(x._id), Number(x.maxRound || 0)])
      );

      // 4) Cộng dồn theo từng bracket: max(meta.maxRounds, max(round))
      elimOffset = prevElim.reduce((sum, b) => {
        const metaRounds = Number(b?.meta?.maxRounds || 0);
        const aggRounds = maxRoundMap.get(String(b._id)) || 0;
        return sum + Math.max(metaRounds, aggRounds);
      }, 0);
    }
  }

  // ===== filters như cũ
  const filter = { bracket: new mongoose.Types.ObjectId(bracketId) };
  if (status) {
    const arr = String(status)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (arr.length) filter.status = arr.length > 1 ? { $in: arr } : arr[0];
  }
  if (type) filter.type = String(type).toLowerCase();

  if (round !== undefined) {
    const r = Number(round);
    if (Number.isFinite(r)) filter.round = r;
  }
  if (rrRound !== undefined) {
    const rr = Number(rrRound);
    if (Number.isFinite(rr)) filter.rrRound = rr;
  }
  if (stage !== undefined) {
    const st = Number(stage);
    filter.stageIndex = Number.isFinite(st) ? st : stage;
  }

  // ===== query chính
  let q = Match.find(filter)
    .sort({ round: 1, order: 1, createdAt: 1 })
    .populate({
      path: "pairA",
      select: "player1 player2",
      options: { lean: true },
    })
    .populate({
      path: "pairB",
      select: "player1 player2",
      options: { lean: true },
    })
    .populate({
      path: "previousA",
      select: "round order",
      options: { lean: true },
    })
    .populate({
      path: "previousB",
      select: "round order",
      options: { lean: true },
    })
    .lean({ virtuals: true });

  if (typeof q.allowDiskUse === "function") q = q.allowDiskUse(true);

  const lim = parseInt(limit, 10);
  const sk = parseInt(skip, 10);
  if (Number.isFinite(sk) && sk > 0) q = q.skip(sk);
  if (Number.isFinite(lim) && lim > 0) q = q.limit(Math.min(lim, 1000));

  const matches = await q;

  // ===== helpers
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

  const detectB = (m) => {
    // Ưu tiên pool.name: "A" → 1, "B" → 2 ...
    const key = (m?.pool?.name || "").toString().trim();
    if (key) {
      const c = key.toUpperCase().charCodeAt(0);
      if (c >= 65 && c <= 90) return c - 64; // A=1
    }
    // fallback các field cũ (0-based → +1)
    const cand = [
      ["groupIndex", true],
      ["group", false],
      ["poolIndex", true],
      ["pool", false],
      ["rrGroup", false],
      ["gIndex", true],
      ["meta?.groupIndex", true],
      ["meta?.group", false],
    ];
    for (const [k, zero] of cand) {
      let v;
      if (k.includes("meta?.")) v = m?.meta?.[k.split("?.")[1]];
      else v = m?.[k];
      if (num(v) !== undefined) return zero ? num(v) + 1 : Math.max(1, num(v));
    }
    return 1;
  };

  // T luôn +1
  const detectT = (m, idx) => {
    const base =
      num(m?.order) ??
      num(m?.no) ??
      num(m?.matchNo) ??
      num(m?.index) ??
      (Number.isFinite(idx) ? idx : 0);
    return (base ?? 0) + 1;
  };

  // V cho group = 1; non-group = elimOffset + (round || 1)
  const detectV = (m) => {
    if (isGroupBracket) return 1;
    const r = num(m?.round) ?? 1;
    return elimOffset + r;
  };

  const withCode = matches.map((m, idx) => {
    const V = detectV(m);
    const T = detectT(m, idx);
    if (isGroupBracket) {
      const B = detectB(m);
      return { ...m, code: `V${V}-B${B}-T${T}` };
    }
    return { ...m, code: `V${V}-T${T}` };
  });

  return res.json(withCode);
});

/* Trọng tài cập nhật điểm */
export const refereeUpdateScore = expressAsyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const { gameScores, status, winner, note } = req.body;

  const match = await Match.findById(matchId);
  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  // chỉ referee assigned hoặc admin mới được sửa
  const isRef =
    req.user.role === "referee" &&
    match.referee?.toString() === req.user._id.toString();
  const isAdmin = req.user.role === "admin";
  if (!isRef && !isAdmin) {
    res.status(403);
    throw new Error("Forbidden");
  }

  if (Array.isArray(gameScores)) {
    match.gameScores = gameScores.map((g) => ({
      a: Number(g.a) || 0,
      b: Number(g.b) || 0,
    }));
  }
  if (status) match.status = status;
  if (winner !== undefined) match.winner = winner; // "A"|"B"|""
  if (note !== undefined) match.note = note;

  await match.save();
  res.json(match);
});

/* Gán trọng tài */
export const adminAssignReferee = expressAsyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const { refereeId } = req.body;

  const match = await Match.findById(matchId);
  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  match.referee = refereeId || undefined;
  await match.save();
  res.json(match);
});

/**
 * GET /admin/matches
 * Admin-only: returns every match, optionally filtered by tournament/bracket/status
 */
// controllers/admin/matchController.js

export const adminGetAllMatchesPagination = expressAsyncHandler(
  async (req, res) => {
    const {
      tournament, // optional
      bracket, // optional
      status, // optional
      page = 1,
      limit = 10,
      sort = "round,order,-createdAt", // mặc định: round↑, order↑, createdAt↓
    } = req.query;

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lm = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200); // cap 200/trang

    const filter = {};
    if (tournament) filter.tournament = tournament;
    if (bracket) filter.bracket = bracket;
    if (status) filter.status = status;

    const parseSort = (s) =>
      s
        .toString()
        .split(",")
        .reduce((acc, token) => {
          const key = token.trim();
          if (!key) return acc;
          if (key.startsWith("-")) acc[key.slice(1)] = -1;
          else acc[key] = 1;
          return acc;
        }, {});

    const sortSpec = Object.keys(parseSort(sort)).length
      ? parseSort(sort)
      : { round: 1, order: 1, createdAt: -1, _id: -1 };

    const skip = (pg - 1) * lm;

    // Lấy danh sách + tổng
    const [listRaw, total] = await Promise.all([
      Match.find(filter)
        .populate({ path: "tournament", select: "name" })
        // cần thêm type/stage/order và meta để suy ra số vòng của bracket
        .populate({
          path: "bracket",
          select:
            "name type stage order prefill ko meta config drawRounds tournament",
        })
        .populate({ path: "pairA", select: "player1 player2" })
        .populate({ path: "pairB", select: "player1 player2" })
        .populate({ path: "referee", select: "name nickname" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .sort(sortSpec)
        .skip(skip)
        .limit(lm)
        .lean(),
      Match.countDocuments(filter),
    ]);

    if (!listRaw.length) {
      return res.json({ total, page: pg, limit: lm, list: [] });
    }

    // ====== TÍNH offset V-round CHO MỖI GIẢI ======
    // Gom các tournament xuất hiện trong trang này
    const tourIds = [
      ...new Set(
        listRaw
          .map((m) => String(m.tournament?._id || m.tournament || ""))
          .filter(Boolean)
      ),
    ];

    // Lấy tất cả bracket của các giải này để tính offset chính xác theo thứ tự
    const allBrackets = await Bracket.find({
      tournament: { $in: tourIds },
    })
      .select(
        "_id tournament type stage order prefill ko meta config drawRounds"
      )
      .lean();

    // ===== Ước lượng số đội/scale để tính số vòng khi chưa có trận =====
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

    // Lấy max round có thật của mỗi bracket (nhẹ nhất có thể)
    const maxRoundByBracket = new Map();
    await Promise.all(
      allBrackets.map(async (b) => {
        const doc = await Match.findOne({ bracket: b._id })
          .sort({ round: -1 })
          .select("round")
          .lean();
        maxRoundByBracket.set(String(b._id), Number(doc?.round) || 0);
      })
    );

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

    // Group brackets theo tournament + sắp xếp để tính offset ổn định
    const brsByTour = new Map();
    for (const b of allBrackets) {
      const tid = String(b.tournament);
      if (!brsByTour.has(tid)) brsByTour.set(tid, []);
      brsByTour.get(tid).push(b);
    }

    // offsetByBracket: tổng số vòng của các bracket đứng TRƯỚC (theo stage↑, rồi order↑)
    const offsetByBracket = new Map();
    for (const [tid, arr] of brsByTour.entries()) {
      const sorted = arr.slice().sort((a, b) => {
        const as = Number.isFinite(a?.stage) ? a.stage : 9999;
        const bs = Number.isFinite(b?.stage) ? b.stage : 9999;
        if (as !== bs) return as - bs;
        const ao = Number.isFinite(a?.order) ? a.order : 9999;
        const bo = Number.isFinite(b?.order) ? b.order : 9999;
        if (ao !== bo) return ao - bo;
        return String(a._id).localeCompare(String(b._id));
      });

      let acc = 0;
      for (const b of sorted) {
        offsetByBracket.set(String(b._id), acc);
        acc += roundsCountForBracket(b);
      }
    }

    // Map kết quả + TRẢ VỀ code = V…-T… (đồng thời giữ rawCode)
    const list = listRaw.map((m) => {
      const br = m.bracket || {};
      const bid = String(br?._id || "");
      const typeStr = String(br?.type || "").toLowerCase();
      const isGroup = typeStr === "group" || typeStr === "roundrobin";

      const base = offsetByBracket.get(bid) || 0;
      const localRound = isGroup ? 1 : Number.isFinite(m.round) ? m.round : 1;
      const globalRound = base + localRound;
      const tIdx = Number.isFinite(m.order) ? m.order + 1 : null;
      const globalCode = `V${globalRound}${tIdx ? `-T${tIdx}` : ""}`;

      return {
        ...m,
        rawCode: m.code || "", // giữ mã gốc (nếu có)
        code: globalCode, // TRẢ code theo V/T
        globalRound, // tiện dụng cho FE
      };
    });

    res.json({ total, page: pg, limit: lm, list });
  }
);

export const adminGetAllMatches = expressAsyncHandler(async (req, res) => {
  const { tournament, bracket, status } = req.query;
  const filter = {};
  if (tournament) filter.tournament = tournament;
  if (bracket) filter.bracket = bracket;
  if (status) filter.status = status;

  const matches = await Match.find(filter)
    // Populate tên giải đấu
    .populate({ path: "tournament", select: "name" })
    // Populate tên bracket
    .populate({ path: "bracket", select: "name" })
    // 2 cặp đấu
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    // trọng tài
    .populate({ path: "referee", select: "name nickname" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })

    .sort({ createdAt: -1 });

  res.json(matches);
});

export const adminListMatchGroups = expressAsyncHandler(async (req, res) => {
  const { status } = req.query;

  const match = {};
  if (status) match.status = status;

  const groups = await Match.aggregate([
    { $match: match },
    // gom theo tournament + bracket để lấy danh sách duy nhất
    { $group: { _id: { t: "$tournament", b: "$bracket" } } },

    // JOIN tournaments, chỉ giữ những bản ghi có tournament tồn tại
    {
      $lookup: {
        from: "tournaments",
        localField: "_id.t",
        foreignField: "_id",
        as: "t",
      },
    },
    { $unwind: "$t" }, // ⟵ tournament không tồn tại sẽ bị loại

    // JOIN brackets (giữ optional; nếu không tồn tại thì bracketName = "—")
    {
      $lookup: {
        from: "brackets",
        localField: "_id.b",
        foreignField: "_id",
        as: "b",
      },
    },
    // Nếu muốn CHỈ lấy bracket tồn tại, bỏ comment dòng dưới:
    // { $match: { "b.0": { $exists: true } } },

    {
      $project: {
        tournamentId: "$_id.t",
        bracketId: "$_id.b",
        tournamentName: "$t.name",
        bracketName: { $ifNull: [{ $first: "$b.name" }, "—"] },
      },
    },
    { $sort: { tournamentName: 1, bracketName: 1 } },
  ]);

  // gộp theo tournament (giữ nguyên cấu trúc response cũ)
  const map = {};
  for (const g of groups) {
    const tId = g.tournamentId.toString();
    if (!map[tId]) {
      map[tId] = {
        tournamentId: tId,
        tournamentName: g.tournamentName,
        brackets: [],
      };
    }
    map[tId].brackets.push({
      bracketId: g.bracketId?.toString?.() ?? "",
      bracketName: g.bracketName,
    });
  }

  res.json(Object.values(map));
});

export const adminGetMatchById = expressAsyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id)
    .populate({ path: "tournament", select: "name eventType" })
    .populate({
      path: "bracket",
      select: "name type stage round rules format eventType",
    })
    .populate({
      path: "pairA",
      populate: [
        {
          path: "player1.user",
          select: "name nickname phone cccd cccdImages avatar",
        },
        {
          path: "player2.user",
          select: "name nickname phone cccd cccdImages avatar",
        },
      ],
    })
    .populate({
      path: "pairB",
      populate: [
        {
          path: "player1.user",
          select: "name nickname phone cccd cccdImages avatar",
        },
        {
          path: "player2.user",
          select: "name nickname phone cccd cccdImages avatar",
        },
      ],
    })
    .populate({ path: "referee", select: "name nickname" })
    .lean();

  if (!match) {
    res.status(404);
    throw new Error("Match không tồn tại");
  }

  const toIntOrNull = (v) =>
    v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;

  const flattenFromUser = (p = {}) => {
    const u = p.user || {};
    return {
      ...p,
      nickname:
        (p.nickname != null && p.nickname !== "" ? p.nickname : null) ??
        u.nickname ??
        null,
      name: p.name ?? u.name ?? null,
      phone: p.phone ?? u.phone ?? null,
      cccd: p.cccd ?? u.cccd ?? null,
      cccdImages:
        p.cccdImages && (p.cccdImages.front || p.cccdImages.back)
          ? p.cccdImages
          : u.cccdImages || { front: "", back: "" },
      avatar: p.avatar ?? u.avatar ?? "",
    };
  };

  const normalizeReg = (reg) =>
    reg
      ? {
          ...reg,
          player1: flattenFromUser(reg.player1 || {}),
          player2: flattenFromUser(reg.player2 || {}),
        }
      : reg;

  const mergedRules = {
    bestOf: match?.rules?.bestOf ?? match?.bracket?.rules?.bestOf ?? 3,
    pointsToWin:
      match?.rules?.pointsToWin ?? match?.bracket?.rules?.pointsToWin ?? 11,
    winByTwo:
      (match?.rules?.winByTwo ?? match?.bracket?.rules?.winByTwo ?? true) ===
      true,
    cap: {
      mode:
        match?.rules?.cap?.mode ?? match?.bracket?.rules?.cap?.mode ?? "none",
      points: toIntOrNull(
        match?.rules?.cap?.points ?? match?.bracket?.rules?.cap?.points ?? null
      ),
    },
  };
  if (!["none", "hard", "soft"].includes(mergedRules.cap.mode))
    mergedRules.cap.mode = "none";
  if (mergedRules.cap.mode === "none") mergedRules.cap.points = null;

  const idOf = (p) =>
    String(p?.user?._id || p?.user || p?._id || p?.id || "") || "";
  const ensureBase = (reg, baseObj = {}) => {
    const out = { ...(baseObj || {}) };
    const p1 = idOf(reg?.player1);
    const p2 = idOf(reg?.player2);
    if (p1 && !out[p1]) out[p1] = 1;
    if (p2 && !out[p2]) out[p2] = 2;
    return out;
  };
  const flipSlot = (n) => (n === 1 ? 2 : 1);
  const slotNow = (base, teamScore) =>
    teamScore % 2 === 0 ? base : flipSlot(base);

  const slotsRaw =
    match.slots && typeof match.slots === "object"
      ? match.slots
      : match.meta?.slots || {};
  const pairA = normalizeReg(match.pairA);
  const pairB = normalizeReg(match.pairB);
  const baseA = ensureBase(pairA, slotsRaw?.base?.A);
  const baseB = ensureBase(pairB, slotsRaw?.base?.B);

  const gs = Array.isArray(match.gameScores) ? match.gameScores : [];
  const last = gs.length ? gs[gs.length - 1] : { a: 0, b: 0 };
  const curA = Number(last?.a || 0);
  const curB = Number(last?.b || 0);

  const serve = { ...(match.serve || {}) };
  if (!serve.serverId && slotsRaw?.serverId)
    serve.serverId = String(slotsRaw.serverId);
  if (!serve.receiverId && slotsRaw?.receiverId)
    serve.receiverId = String(slotsRaw.receiverId);

  if (!serve.serverId && (serve.server === 1 || serve.server === 2)) {
    const side = serve.side === "B" ? "B" : "A";
    const cand =
      side === "A"
        ? [idOf(pairA?.player1), idOf(pairA?.player2)].filter(Boolean)
        : [idOf(pairB?.player1), idOf(pairB?.player2)].filter(Boolean);
    for (const uid of cand) {
      const now =
        side === "A"
          ? slotNow(Number(baseA[uid] || 1), curA)
          : slotNow(Number(baseB[uid] || 1), curB);
      if (now === Number(serve.server)) {
        serve.serverId = uid;
        break;
      }
    }
  }

  if (!serve.receiverId && serve.serverId) {
    const side = serve.side === "B" ? "B" : "A";
    const srvNow =
      side === "A"
        ? slotNow(Number(baseA[serve.serverId] || 1), curA)
        : slotNow(Number(baseB[serve.serverId] || 1), curB);
    const others =
      side === "A"
        ? [idOf(pairB?.player1), idOf(pairB?.player2)].filter(Boolean)
        : [idOf(pairA?.player1), idOf(pairA?.player2)].filter(Boolean);
    for (const uid of others) {
      const now =
        side === "A"
          ? slotNow(Number(baseB[uid] || 1), curB)
          : slotNow(Number(baseA[uid] || 1), curA);
      if (now === srvNow) {
        serve.receiverId = uid;
        break;
      }
    }
  }

  const slotsOut = { ...slotsRaw, base: { A: baseA, B: baseB } };

  // Nếu cần enrich thêm:
  const enriched = decorateServeAndSlots
    ? decorateServeAndSlots({ ...match, pairA, pairB, serve, slots: slotsOut })
    : match;

  // ✅ Trả về MỘT lần duy nhất
  return res.json({
    ...enriched,
    pairA,
    pairB,
    rules: mergedRules,
    serve,
    slots: slotsOut,
  });
});

/**
 * DELETE /api/matches/:matchId
 * Xoá 1 match:
 * - Gỡ liên kết từ các trận "trước" (previousA/B) -> nextMatch/nextSlot
 * - Gỡ liên kết ở "trận sau" (nextMatch) -> previousA/previousB nếu đang trỏ về match này
 * - Giảm matchesCount của bracket
 */
export const adminDeleteMatch = expressAsyncHandler(async (req, res) => {
  const { matchId } = req.params;

  const match = await Match.findById(matchId);
  if (!match) {
    res.status(404);
    throw new Error("Match not found");
  }

  // 1) Unlink từ các trận trước (nếu họ có nextMatch trỏ vào match này)
  const prevIds = [match.previousA, match.previousB].filter(Boolean);
  if (prevIds.length) {
    await Match.updateMany(
      { _id: { $in: prevIds }, nextMatch: match._id },
      { $set: { nextMatch: null, nextSlot: null } }
    );
  }

  // 2) Unlink ở trận sau (nếu có)
  if (match.nextMatch) {
    const nm = await Match.findById(match.nextMatch);
    if (nm) {
      let changed = false;
      if (String(nm.previousA) === String(match._id)) {
        nm.previousA = null;
        changed = true;
      }
      if (String(nm.previousB) === String(match._id)) {
        nm.previousB = null;
        changed = true;
      }
      if (changed) await nm.save();
    }
  }

  // 3) Xoá match
  await match.deleteOne();

  // 4) Giảm matchesCount của bracket (nếu có)
  if (match.bracket) {
    await Bracket.findByIdAndUpdate(match.bracket, {
      $inc: { matchesCount: -1 },
    }).exec();
  }

  res.json({ message: "Match deleted", deletedId: matchId });
});

// update match
export const adminUpdateMatch = expressAsyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const {
    round,
    order,
    pairA,
    pairB,
    rules,
    status, // 'scheduled' | 'live' | 'finished' | 'assigned' | 'queued'
    winner, // 'A' | 'B' | ''
    ratingDelta, // số điểm cộng/trừ cho trận
    referee, // backward-compat: string | string[] | null | ''
    referees, // NEW: string[]
    video, // chỉ dùng video
  } = req.body;

  const mt = await Match.findById(matchId);
  if (!mt) {
    res.status(404);
    throw new Error("Không tìm thấy trận đấu");
  }

  const br = await Bracket.findById(mt.bracket);
  if (!br) {
    res.status(400);
    throw new Error("Không tìm thấy nhánh thi đấu của trận này");
  }

  // round/order
  if (Number.isFinite(Number(round))) mt.round = Math.max(1, Number(round));
  if (Number.isFinite(Number(order))) mt.order = Math.max(0, Number(order));

  // cập nhật ratingDelta nếu có truyền (không âm)
  if (ratingDelta !== undefined) {
    const v = Number(ratingDelta);
    mt.ratingDelta = Number.isFinite(v) && v >= 0 ? v : 0;
  }

  // 👇 gán / bỏ gán trọng tài (hỗ trợ nhiều trọng tài + tương thích ngược)
  if (referee !== undefined || referees !== undefined) {
    const raw = referees !== undefined ? referees : referee;
    const list =
      raw == null || raw === "" ? [] : Array.isArray(raw) ? raw : [raw];

    // chuẩn hoá: string[] duy nhất
    const ids = Array.from(new Set(list.map((x) => String(x))));

    // cho phép clear nếu rỗng
    if (ids.length === 0) {
      mt.referee = [];
    } else {
      // validate ObjectId
      for (const id of ids) {
        if (!mongoose.isValidObjectId(id)) {
          res.status(400);
          throw new Error("referee không hợp lệ");
        }
      }
      // load & validate role
      const users = await User.find({ _id: { $in: ids } }).select("_id role");
      if (users.length !== ids.length) {
        res.status(404);
        throw new Error("Có trọng tài không tồn tại");
      }
      const invalid = users.find((u) => !["referee", "admin"].includes(u.role));
      if (invalid) {
        res.status(400);
        throw new Error("Có người không có quyền trọng tài");
      }
      mt.referee = users.map((u) => u._id); // lưu mảng ObjectId
    }
  }

  // ⭐ NEW: cập nhật video (trim, cho phép clear)
  if (Object.prototype.hasOwnProperty.call(req.body, "video")) {
    mt.video = video == null ? "" : String(video).trim();
  }

  // pairA/pairB (nếu cập nhật, phải hợp lệ & cùng tournament)
  const setRegIfProvided = async (sideKey, regId) => {
    if (!regId) return;
    const r = await Registration.findById(regId);
    if (!r) {
      res.status(400);
      throw new Error(`${sideKey} is not a valid registration`);
    }
    if (String(r.tournament) !== String(br.tournament)) {
      res.status(400);
      throw new Error(`${sideKey} does not belong to this tournament`);
    }
    mt[sideKey] = r._id;
  };

  if (pairA) await setRegIfProvided("pairA", pairA);
  if (pairB) await setRegIfProvided("pairB", pairB);

  if (mt.pairA && mt.pairB && String(mt.pairA) === String(mt.pairB)) {
    res.status(400);
    throw new Error("Two teams must be different");
  }

  // ===== rules (thêm cap: { mode: 'none'|'hard'|'soft', points: number|null }) =====
  if (rules) {
    // sanitize cap
    const incomingMode = (
      rules?.cap?.mode ??
      mt.rules?.cap?.mode ??
      "none"
    ).toString();
    const capMode = ["none", "hard", "soft"].includes(incomingMode)
      ? incomingMode
      : "none";

    let capPoints =
      rules?.cap?.points === "" || rules?.cap?.points == null
        ? null
        : Number(rules.cap.points);
    capPoints =
      Number.isFinite(capPoints) && capPoints > 0
        ? Math.floor(capPoints)
        : null;
    if (capMode === "none") capPoints = null;

    const nextRules = {
      bestOf: [1, 3, 5].includes(Number(rules.bestOf))
        ? Number(rules.bestOf)
        : mt.rules?.bestOf ?? 3,
      pointsToWin: [11, 15, 21].includes(Number(rules.pointsToWin))
        ? Number(rules.pointsToWin)
        : mt.rules?.pointsToWin ?? 11,
      winByTwo:
        typeof rules.winByTwo === "boolean"
          ? rules.winByTwo
          : mt.rules?.winByTwo ?? true,
      cap: { mode: capMode, points: capPoints },
    };
    mt.rules = nextRules;
  }

  // status & winner
  if (status) {
    if (
      !["scheduled", "live", "finished", "assigned", "queued"].includes(status)
    ) {
      res.status(400);
      throw new Error("Invalid status");
    }
    mt.status = status;
  }

  if (mt.status === "finished") {
    if (!["A", "B"].includes(winner)) {
      res.status(400);
      throw new Error("Winner must be 'A' or 'B' when status is 'finished'");
    }
    mt.winner = winner;
    mt.finishedAt = mt.finishedAt || new Date();
  } else {
    mt.winner = "";
    // giữ finishedAt để lưu lịch sử; nếu cần, clear theo policy riêng
  }

  await mt.save();

  // schedule start soon (không chặn lỗi)
  try {
    await scheduleMatchStartSoon(mt);
  } catch (e) {
    console.log(e);
  }

  // GIỮ LOGIC CŨ: feed winner cho các trận phụ thuộc previousA/B (KO chaining cũ)
  if (mt.status === "finished" && mt.winner) {
    const winnerReg = mt.winner === "A" ? mt.pairA : mt.pairB;
    if (winnerReg) {
      await Match.updateMany(
        { previousA: mt._id },
        { $set: { pairA: winnerReg }, $unset: { previousA: "" } }
      );
      await Match.updateMany(
        { previousB: mt._id },
        { $set: { pairB: winnerReg }, $unset: { previousB: "" } }
      );
    }
  }

  // rating & side-effects sau khi kết thúc
  try {
    if (mt.status === "finished" && !mt.ratingApplied) {
      await applyRatingForFinishedMatch(mt._id);
      await onMatchFinished({ matchId: mt._id }); // giữ nguyên fix
    }
  } catch (e) {
    console.error("[adminUpdateMatch] applyRatingForFinishedMatch error:", e);
  }

  // trả về bản populate (referee là mảng)
  const populated = await Match.findById(mt._id)
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({
      path: "referee",
      select: "name nickname email phone avatar role",
    });

  res.json(populated);
});

export const searchUserMatches = expressAsyncHandler(async (req, res) => {
  const tournamentId = req.query.tournamentId;
  // q có thể là array nếu params trùng; ép về string
  const qRaw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const q = (qRaw || "").trim();
  if (!q)
    return res.status(400).json({ message: "Vui lòng nhập SĐT hoặc nickname" });
  if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
    return res.status(400).json({ message: "Invalid tournament id" });
  }

  const TZ = "Asia/Bangkok";
  const qLower = q.toLowerCase();

  // 1) Tìm registrations khớp SĐT hoặc nickname (case-insensitive)
  const regs = await Registration.aggregate([
    { $match: { tournament: new mongoose.Types.ObjectId(tournamentId) } },

    // lookup users để lấy nickname (mảng)
    {
      $lookup: {
        from: "users",
        localField: "player1.user",
        foreignField: "_id",
        as: "_u1",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "player2.user",
        foreignField: "_id",
        as: "_u2",
      },
    },

    // ✅ Stage 1: ép mảng -> object
    {
      $addFields: {
        _u1: { $arrayElemAt: ["$_u1", 0] },
        _u2: { $arrayElemAt: ["$_u2", 0] },
      },
    },

    // ✅ Stage 2: mới dùng nickname/phone để match (tránh BSON array -> string)
    {
      $addFields: {
        _matchPhone: {
          $or: [{ $eq: ["$player1.phone", q] }, { $eq: ["$player2.phone", q] }],
        },
        _matchNick: {
          $or: [
            { $eq: [{ $toLower: { $ifNull: ["$_u1.nickname", ""] } }, qLower] },
            { $eq: [{ $toLower: { $ifNull: ["$_u2.nickname", ""] } }, qLower] },
          ],
        },
      },
    },

    { $match: { $or: [{ _matchPhone: true }, { _matchNick: true }] } },

    {
      $project: {
        _id: 1,
        tournament: 1,
        player1: 1,
        player2: 1,
        checkinAt: 1,
        payment: 1,
        nickname1: { $ifNull: ["$_u1.nickname", ""] },
        nickname2: { $ifNull: ["$_u2.nickname", ""] },
      },
    },
  ]);

  if (!regs.length) {
    return res.json({ query: q, results: [] });
  }

  // 2) Lấy tất cả matches chứa các registration này
  const regIds = regs.map((r) => r._id);
  const matches = await Match.aggregate([
    {
      $match: {
        tournament: new mongoose.Types.ObjectId(tournamentId),
        $or: [{ pairA: { $in: regIds } }, { pairB: { $in: regIds } }],
      },
    },

    // court / referee
    {
      $lookup: {
        from: "courts",
        localField: "court",
        foreignField: "_id",
        as: "_court",
      },
    },
    { $addFields: { _court: { $arrayElemAt: ["$_court", 0] } } },
    {
      $lookup: {
        from: "users",
        localField: "referee",
        foreignField: "_id",
        as: "_ref",
      },
    },
    { $addFields: { _ref: { $arrayElemAt: ["$_ref", 0] } } },

    // tách ngày / giờ từ scheduledAt
    {
      $addFields: {
        _todayStr: {
          $dateToString: { date: "$$NOW", format: "%Y-%m-%d", timezone: TZ },
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

    // set cuối (mặc định 0-0)
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

    // map status -> nhãn + màu
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

    // regOwner: trận này thuộc reg nào (A/B)
    {
      $addFields: {
        regOwner: { $cond: [{ $in: ["$pairA", regIds] }, "$pairA", "$pairB"] },
      },
    },

    // shape FE
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
        date: "$_schedDate",
        time: "$_schedTime",
        score1: { $ifNull: ["$_lastSet.a", 0] },
        score2: { $ifNull: ["$_lastSet.b", 0] },
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
        referee: { $ifNull: ["$_ref.name", ""] },
        status: "$_statusVN",
        statusColor: "$_statusColor",
        pairA: 1,
        pairB: 1,
        regOwner: 1,
      },
    },

    { $sort: { date: 1, time: 1, code: 1 } },
  ]);

  // 3) Gom matches theo registration
  const resultMap = new Map(
    regs.map((r) => [
      String(r._id),
      {
        regId: r._id,
        teamLabel: `${r.player1.fullName} & ${r.player2.fullName}`,
        paid: r.payment?.status === "Paid",
        checkinAt: r.checkinAt || null,
        matches: [],
      },
    ])
  );

  for (const m of matches) {
    const rid = String(m.regOwner);
    if (resultMap.has(rid)) resultMap.get(rid).matches.push(m);
  }

  res.json({
    query: q,
    results: Array.from(resultMap.values()),
  });
});

export const userCheckinRegistration = expressAsyncHandler(async (req, res) => {
  let { tournamentId, q, regId } = req.body || {};

  // q có thể là array khi client gửi trùng key, ép về string
  q = Array.isArray(q) ? q[0] : q;
  if (!q || !String(q).trim()) {
    return res.status(400).json({ message: "Vui lòng nhập SĐT hoặc nickname" });
  }
  q = String(q).trim();

  if (
    !mongoose.Types.ObjectId.isValid(tournamentId) ||
    !mongoose.Types.ObjectId.isValid(regId)
  ) {
    return res.status(400).json({ message: "Dữ liệu không hợp lệ" });
  }

  // Chuẩn hoá SĐT: chỉ giữ số, đổi 84xxxx -> 0xxxx
  const normalizePhone = (raw) => {
    if (!raw) return "";
    const digits = String(raw).replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.startsWith("84")) return "0" + digits.slice(2);
    return digits.startsWith("0") ? digits : digits; // giữ nguyên nếu đã bắt đầu bằng 0
  };
  const qPhone = normalizePhone(q);
  const isQPhone = qPhone.length >= 9; // phỏng đoán: người dùng nhập SĐT

  // Lấy registration + nickname để so khớp
  const reg = await Registration.findOne({
    _id: regId,
    tournament: tournamentId,
  })
    .populate({ path: "player1.user", select: "nickname" })
    .populate({ path: "player2.user", select: "nickname" });

  if (!reg) return res.status(404).json({ message: "Không tìm thấy đăng ký" });

  // So khớp theo phone (sau chuẩn hoá) hoặc nickname (case-insensitive)
  const p1 = normalizePhone(reg.player1?.phone);
  const p2 = normalizePhone(reg.player2?.phone);
  const okByPhone = isQPhone && (qPhone === p1 || qPhone === p2);

  const qLower = q.toLowerCase();
  const n1 = (reg.player1?.user?.nickname || "").toLowerCase();
  const n2 = (reg.player2?.user?.nickname || "").toLowerCase();
  const okByNick = !isQPhone && (qLower === n1 || qLower === n2);

  if (!okByPhone && !okByNick) {
    return res
      .status(403)
      .json({ message: "SĐT/Nickname không khớp với đăng ký này" });
  }

  const paid = (reg.payment?.status || "").toLowerCase() === "paid";
  if (!paid) {
    return res.status(400).json({ message: "Chưa thanh toán lệ phí" });
  }

  // Nếu đã check-in trước đó -> trả 200 idempotent
  if (reg.checkinAt) {
    return res.status(200).json({
      ok: true,
      message: "Đã check-in trước đó",
      checkinAt: reg.checkinAt,
    });
  }

  // Atomic update: chỉ set khi chưa có checkinAt (tránh double click/race)
  const now = new Date();
  const updated = await Registration.findOneAndUpdate(
    {
      _id: regId,
      tournament: tournamentId,
      $or: [{ checkinAt: null }, { checkinAt: { $exists: false } }],
    },
    { $set: { checkinAt: now } },
    { new: true }
  );

  if (!updated) {
    // Có thể vừa được check-in bởi request khác
    const fresh = await Registration.findById(regId).select("checkinAt");
    return res.status(200).json({
      ok: true,
      message: "Đã check-in trước đó",
      checkinAt: fresh?.checkinAt || now,
    });
  }

  return res.status(200).json({
    ok: true,
    message: "Check-in thành công",
    checkinAt: updated.checkinAt,
  });
});

export const updateMatch = async (req, res, next) => {
  const { matchId } = req.params;
  const body = req.body || {};
  const cascade = Boolean(body.cascade || req.query.cascade); // <- mặc định false

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const oldDoc = await Match.findById(matchId).session(session);
    if (!oldDoc) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Match not found" });
    }

    const wasFinished = oldDoc.status === "finished";
    const willBeFinished = body.status === "finished";
    const winnerChanged =
      wasFinished && body.winner && body.winner !== oldDoc.winner;

    // Cập nhật tối thiểu, giữ nguyên logic cũ
    oldDoc.round = body.round ?? oldDoc.round;
    oldDoc.order = body.order ?? oldDoc.order;
    oldDoc.pairA = body.pairA ?? oldDoc.pairA;
    oldDoc.pairB = body.pairB ?? oldDoc.pairB;
    oldDoc.rules = body.rules ?? oldDoc.rules;
    oldDoc.status = body.status ?? oldDoc.status;
    oldDoc.winner = willBeFinished ? body.winner || "" : "";

    // (tuỳ chọn) nếu bạn muốn: khi không finished nữa thì xoá điểm set
    if (!willBeFinished && wasFinished) {
      oldDoc.gameScores = [];
    }

    await oldDoc.save({ session });

    // ✅ Chỉ khi BẬT cascade mới reset chuỗi
    if (cascade && ((wasFinished && !willBeFinished) || winnerChanged)) {
      await softResetChainFrom(oldDoc._id, session);
    }

    await session.commitTransaction();
    res.json(oldDoc);
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};
