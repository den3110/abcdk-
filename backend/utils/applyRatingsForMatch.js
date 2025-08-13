import Bracket from "../models/bracketModel.js";
import Registration from "../models/registrationModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Tournament from "../models/tournamentModel.js";

// helpers: áp dụng cộng/trừ điểm khi trận đã finished
async function applyRatingsForMatch(mt, bracketId, reqUserId) {
  // ĐÃ áp dụng rồi thì bỏ
  if (mt.ratingApplied) return;

  const delta = Number(mt.ratingDelta) || 0;
  if (!mt.winner || mt.status !== "finished" || delta <= 0) return;

  // Lấy tournament để biết single/double
  const br = await Bracket.findById(bracketId).select("tournament").lean();
  if (!br) return;
  const tour = await Tournament.findById(br.tournament)
    .select("eventType")
    .lean();
  const key = tour?.eventType === "single" ? "single" : "double";

  // Lấy 2 registration (đội thắng / thua)
  const winRegId = mt.winner === "A" ? mt.pairA : mt.pairB;
  const loseRegId = mt.winner === "A" ? mt.pairB : mt.pairA;
  if (!winRegId || !loseRegId) return;

  const regs = await Registration.find({ _id: { $in: [winRegId, loseRegId] } })
    .select("player1 player2")
    .lean();

  const regMap = new Map(regs.map((r) => [String(r._id), r]));
  const winReg = regMap.get(String(winRegId));
  const loseReg = regMap.get(String(loseRegId));
  if (!winReg || !loseReg) return;

  const finishedAt = mt.finishedAt || new Date();
  const scorer = reqUserId || null;

  // helper: push một bản ghi ScoreHistory cho từng user
  const writeRow = async (userId, isWinner) => {
    if (!userId) return;
    // lấy record gần nhất để biết baseline
    const last = await ScoreHistory.findOne({ user: userId })
      .sort({ scoredAt: -1 })
      .select("single double")
      .lean();

    const baseSingle = last?.single ?? 0;
    const baseDouble = last?.double ?? 0;

    let nextSingle = baseSingle;
    let nextDouble = baseDouble;

    if (key === "single") {
      const val = isWinner ? baseSingle + delta : baseSingle - delta;
      nextSingle = Math.max(0, val); // không âm
    } else {
      const val = isWinner ? baseDouble + delta : baseDouble - delta;
      nextDouble = Math.max(0, val); // không âm
    }

    await ScoreHistory.create({
      user: userId,
      scorer,
      single: nextSingle,
      double: nextDouble,
      note: `Match ${mt.code || `R${mt.round ?? "?"}#${mt.order ?? "?"}`} ${
        isWinner ? "+" : "-"
      }${delta} (${key})`,
      scoredAt: finishedAt,
    });
  };

  // đội thắng: +delta
  await writeRow(winReg?.player1?.user, true);
  await writeRow(winReg?.player2?.user, true);

  // đội thua: -delta
  await writeRow(loseReg?.player1?.user, false);
  await writeRow(loseReg?.player2?.user, false);

  // đánh dấu đã áp dụng để không cộng trừ lặp lại
  mt.ratingApplied = true; // <-- NEW
  mt.ratingAppliedAt = new Date(); // <-- NEW
  await mt.save();
}

export default applyRatingsForMatch;