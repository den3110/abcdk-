import Match from "../../models/matchModel.js";
import Bracket from "../../models/bracketModel.js";
import Registration from "../../models/registrationModel.js";
import expressAsyncHandler from "express-async-handler";

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
  } = req.body;

  const bracket = await Bracket.findById(bracketId);
  if (!bracket) {
    res.status(404);
    throw new Error("Bracket not found");
  }

  // ---- Validate nguồn đội mỗi bên ----
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

  // ---- Chuẩn hoá rules ----
  const finalRules = {
    bestOf: [1, 3, 5].includes(Number(rules?.bestOf))
      ? Number(rules.bestOf)
      : 3,
    pointsToWin: [11, 15, 21].includes(Number(rules?.pointsToWin))
      ? Number(rules.pointsToWin)
      : 11,
    winByTwo: typeof rules?.winByTwo === "boolean" ? rules.winByTwo : true,
  };

  // ---- Nếu tạo theo Registration: kiểm tra tính hợp lệ ----
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

  // ---- Nếu tạo theo Winner-of: kiểm tra trận nguồn ----
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

  // ---- Validate mềm cho knockout khi round > 1 và dùng chọn tay (pairA/pairB) ----
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

    // Không lấy cả 2 đội đến từ cùng 1 trận vòng trước
    const samePrevMatch = prevRoundMatches.some(
      (m) =>
        (String(m.pairA) === String(pairA) &&
          String(m.pairB) === String(pairB)) ||
        (String(m.pairA) === String(pairB) && String(m.pairB) === String(pairA))
    );
    if (samePrevMatch) {
      res.status(400);
      throw new Error(
        "Both teams come from the same previous match; pick winners from two different matches"
      );
    }
  }

  // ---- Tạo match ----
  const match = await Match.create({
    tournament: bracket.tournament,
    bracket: bracketId,
    round: Number(round),
    order: Number(order),
    pairA: pairA || null,
    pairB: pairB || null,
    previousA: previousA || null,
    previousB: previousB || null,
    rules: finalRules,
    gameScores: [],
    status: "scheduled",
  });

  // Nếu có previousA/B: gắn link đi lên (để sau này nếu dùng auto-feed winner)
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

  // Cập nhật đếm
  bracket.matchesCount = (bracket.matchesCount || 0) + 1;
  await bracket.save();

  const populated = await Match.findById(match._id)
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" });

  res.status(201).json(populated);
});

/* Danh sách trận theo bracket */
export const getMatchesByBracket = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const matches = await Match.find({ bracket: bracketId })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .sort({ round: 1, order: 1, createdAt: 1 });

  res.json(matches);
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

export const adminGetMatchById = expressAsyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id)
    .populate({ path: "tournament", select: "name" })
    .populate({ path: "bracket", select: "name" })
    .populate({ path: "pairA" }) // có đủ player1, player2, score…
    .populate({ path: "pairB" })
    .populate({ path: "referee", select: "name nickname" });

  if (!match) {
    res.status(404);
    throw new Error("Match không tồn tại");
  }
  res.json(match);
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

export const adminUpdateMatch = expressAsyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const {
    round,
    order,
    pairA,
    pairB,
    rules,
    status, // 'scheduled' | 'live' | 'finished'
    winner, // 'A' | 'B' | ''
  } = req.body;

  const mt = await Match.findById(matchId);
  if (!mt) {
    res.status(404);
    throw new Error("Match not found");
  }

  // Lấy bracket để đối chiếu tournament
  const br = await Bracket.findById(mt.bracket);
  if (!br) {
    res.status(400);
    throw new Error("Bracket of this match not found");
  }

  // round/order
  if (Number.isFinite(Number(round))) mt.round = Math.max(1, Number(round));
  if (Number.isFinite(Number(order))) mt.order = Math.max(0, Number(order));

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

  // rules
  if (rules) {
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
    };
    mt.rules = nextRules;
  }

  // status & winner
  if (status) {
    if (!["scheduled", "live", "finished"].includes(status)) {
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
  } else {
    // Nếu chưa kết thúc thì không lưu winner
    mt.winner = "";
  }

  await mt.save();

  const populated = await Match.findById(mt._id)
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" });

  res.json(populated);
});
