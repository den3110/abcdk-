// controllers/seedToolsController.js
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../../models/matchModel.js";
import Bracket from "../../models/bracketModel.js";

/**
 * Re-trigger propagate cho các trận đã finished trong 1 giải
 * Body:
 *  - stageIndex?: number | number[]  (giới hạn stage nguồn)
 *  - dryRun?: boolean                (chỉ đếm, không ghi)
 */
export const reapplyPropagation = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const { stageIndex, dryRun = false } = req.body || {};

  const tid = new mongoose.Types.ObjectId(id);
  const stageCond = Array.isArray(stageIndex)
    ? { stageIndex: { $in: stageIndex } }
    : (Number.isInteger(stageIndex) ? { stageIndex } : {});

  const finished = await Match.find({
    tournament: tid,
    status: "finished",
    winner: { $in: ["A", "B"] },
    ...stageCond,
  }).select("_id").lean();

  if (dryRun) {
    return res.json({ ok: true, dryRun: true, wouldTouch: finished.length });
  }

  // Dùng findOneAndUpdate để kích hoạt post("findOneAndUpdate")
  let touched = 0;
  for (const m of finished) {
    await Match.findOneAndUpdate(
      { _id: m._id },
      { $set: { updatedAt: new Date() } }, // no-op update
      { new: true }
    );
    touched++;
  }

  return res.json({ ok: true, propagatedFrom: touched });
});

/**
 * Áp dụng lại seed/propagate cho 1 bracket mới tạo
 * Body:
 *  - forceReset?: boolean  → xoá pairA/pairB/previousA/previousB để nhận feed mới
 *  - sourceStages?: number | number[] → chỉ re-trigger propagate từ các stage nguồn này (nếu bỏ trống: tất cả)
 *  - runGroupRank?: boolean (default true) → nếu bracket là group thì auto feed groupRank
 *  - dryRun?: boolean
 */
export const reapplySeedsForBracket = expressAsyncHandler(async (req, res) => {
  const { id, bid } = req.params;
  const {
    forceReset = false,
    sourceStages,
    runGroupRank = true,
    dryRun = false,
  } = req.body || {};

  const tid = new mongoose.Types.ObjectId(id);
  const br = await Bracket.findById(bid).select("type stage").lean();
  if (!br) return res.status(404).json({ ok: false, message: "Bracket not found" });

  // 1) (optional) reset các slot trong bracket mới
  let resetCount = 0;
  if (forceReset) {
    if (dryRun) {
      resetCount = await Match.countDocuments({ bracket: bid });
    } else {
      const resReset = await Match.updateMany(
        { bracket: bid },
        {
          $unset: { pairA: "", pairB: "", previousA: "", previousB: "" },
          $set: { participants: [] },
        }
      );
      resetCount = resReset.modifiedCount || 0;
    }
  }

  // 2) biên dịch seed nội bộ bracket (matchWinner → previous*)
  let compiled = 0;
  if (!dryRun) {
    await Match.compileSeedsForBracket(bid);
    // khó lấy số lượng thay đổi thực tế; nếu cần bạn có thể sửa static để trả count
    compiled = await Match.countDocuments({ bracket: bid });
  }

  // 3) re-trigger propagate từ các trận đã finished (theo sourceStages nếu có)
  const stageCond = Array.isArray(sourceStages)
    ? { stageIndex: { $in: sourceStages } }
    : (Number.isInteger(sourceStages) ? { stageIndex: sourceStages } : {});

  const finished = await Match.find({
    tournament: tid,
    status: "finished",
    winner: { $in: ["A", "B"] },
    ...stageCond,
  }).select("_id").lean();

  let propagatedFrom = 0;
  if (!dryRun) {
    for (const m of finished) {
      // kích hoạt post("findOneAndUpdate") → propagateFromFinishedMatch(...)
      await Match.findOneAndUpdate(
        { _id: m._id },
        { $set: { updatedAt: new Date() } },
        { new: true }
      );
      propagatedFrom++;
    }
  }

  // 4) nếu là group và bật runGroupRank → feed seed groupRank
  let groupRankRan = false;
  if (!dryRun && runGroupRank && br.type === "group") {
    try {
      const { autoFeedGroupRank } = await import("../../services/autoFeedGroupRank.js");
      await autoFeedGroupRank({
        tournamentId: tid,
        bracketId: new mongoose.Types.ObjectId(bid),
        stageIndex: br.stage,
        provisional: true,
        finalizeOnComplete: true,
        log: false,
      });
      groupRankRan = true;
    } catch (e) {
      console.error("[reapplySeedsForBracket] autoFeedGroupRank failed:", e?.message || e);
    }
  }

  return res.json({
    ok: true,
    dryRun,
    bracket: bid,
    forceReset,
    summary: {
      resetMatches: resetCount,
      compiledApprox: compiled,
      propagatedFrom,
      groupRankRan,
    },
  });
});

/* -------------------- helpers -------------------- */

function toObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

async function resetBracketSlots(bracketIds) {
  const r = await Match.updateMany(
    { bracket: { $in: bracketIds } },
    {
      $unset: { pairA: "", pairB: "", previousA: "", previousB: "" },
      $set: { participants: [] },
    }
  );
  return r.modifiedCount || 0;
}

/** Lấy danh sách entry slots (matchId + slot A/B) cho Round 1 của 1 KO bracket. */
async function getKOEntrySlotsRound1(bracketId, { entryOrder = "byMatch" } = {}) {
  const r1 = await Match.find({ bracket: bracketId, round: 1 })
    .select("_id order")
    .sort({ order: 1 })
    .lean();

  // byMatch: R1#0(A,B), R1#1(A,B), ...
  // snake:   R1#0(A,B), R1#1(B,A), R1#2(A,B), ...
  const slots = [];
  for (const m of r1) {
    if (entryOrder === "snake" && m.order % 2 === 1) {
      slots.push({ matchId: m._id, slot: "B" }, { matchId: m._id, slot: "A" });
    } else {
      slots.push({ matchId: m._id, slot: "A" }, { matchId: m._id, slot: "B" });
    }
  }
  return slots;
}

/** Winners của 1 round trong 1 hoặc nhiều bracket nguồn (KO/PO). */
async function listRoundWinners({ bracketIds, round }) {
  if (!Number.isInteger(round)) return [];
  const matches = await Match.find({
    bracket: { $in: bracketIds },
    round,
    status: "finished",
    winner: { $in: ["A", "B"] },
  })
    .select("_id order pairA pairB winner")
    .sort({ order: 1 })
    .lean();

  return matches.map((m) => (m.winner === "A" ? m.pairA : m.pairB)).filter(Boolean);
}

/** Điền qualifiers (mảng regIds) vào KO R1 theo slots đã lấy. */
async function fillQualifiersIntoKO(bracketId, qualifiers, { entryOrder = "byMatch" } = {}) {
  const slots = await getKOEntrySlotsRound1(bracketId, { entryOrder });
  const updates = [];
  for (let i = 0; i < slots.length && i < qualifiers.length; i++) {
    const { matchId, slot } = slots[i];
    const field = slot === "A" ? "pairA" : "pairB";
    updates.push(
      Match.updateOne(
        { _id: matchId, [field]: { $in: [null, undefined, ""] } },
        { $set: { [field]: qualifiers[i] } }
      )
    );
  }
  await Promise.all(updates);
  // Nối khung KO (winner → previousA/B các round sau)
  await Match.compileSeedsForBracket(bracketId);
}

/* -------------------- main controller -------------------- */

export const feedStageToNext = expressAsyncHandler(async (req, res) => {
  const { tid, sourceStage, targetStage } = req.params;
  const {
    mode = "AUTO",
    koRound,                 // dùng khi nguồn là KO/PO
    targetBrackets,          // ids KO đích
    forceReset = false,
    entryOrder = "byMatch",  // byMatch | snake
    dryRun = false,
  } = req.body || {};

  const tournamentId = toObjectId(tid);
  const srcStage = Number(sourceStage);
  const dstStage = Number(targetStage);

  // Lấy bracket nguồn và đích
  const sourceBrackets = await Bracket.find({
    tournament: tournamentId,
    stage: srcStage,
  })
    .select("_id type stage")
    .lean();

  if (!sourceBrackets.length) {
    return res.status(404).json({ ok: false, message: "No source brackets found for sourceStage." });
  }

  const targetQuery = { tournament: tournamentId, stage: dstStage, type: "knockout" };
  if (Array.isArray(targetBrackets) && targetBrackets.length) {
    targetQuery._id = { $in: targetBrackets.map(toObjectId) };
  }
  const koTargets = await Bracket.find(targetQuery).select("_id stage type").lean();

  if (!koTargets.length) {
    return res.status(404).json({ ok: false, message: "No KO target brackets found for targetStage." });
  }

  // Suy ra mode nếu AUTO
  let resolvedMode = mode;
  if (mode === "AUTO") {
    const t = new Set(sourceBrackets.map((b) => b.type));
    if (t.has("group") || t.has("round_robin") || t.has("gsl")) {
      resolvedMode = "GROUP_TOP";
    } else if (t.has("roundElim")) {
      resolvedMode = "PO_ROUND_WINNERS";
    } else {
      resolvedMode = "KO_ROUND_WINNERS";
    }
  }

  /* ---------------- Case A: GROUP -> KO ---------------- */
  if (resolvedMode === "GROUP_TOP") {
    // Yêu cầu: KO blueprint Round 1 phải có seeds kiểu groupRank (định nghĩa sẵn 1A vs 2B, v.v.)
    // Ta dùng lại service autoFeedGroupRank để ghi mappng groupRank -> seeds của KO.
    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        sourceType: "group-like",
        action: "autoFeedGroupRank to KO targets (requires groupRank seeds in KO R1)",
        targets: koTargets.map((b) => String(b._id)),
      });
    }

    // (tuỳ chọn) reset slot ở KO trước khi feed
    if (forceReset) {
      await resetBracketSlots(koTargets.map((b) => b._id));
    }

    // Feed theo từng bracket nguồn (để BXH tính chính xác)
    const { autoFeedGroupRank } = await import("../../services/autoFeedGroupRank.js");
    let fedFrom = 0;
    for (const gb of sourceBrackets.filter((b) =>
      ["group", "round_robin", "gsl"].includes(b.type)
    )) {
      await autoFeedGroupRank({
        tournamentId,
        bracketId: gb._id,
        stageIndex: gb.stage,        // = sourceStage
        // mở rộng: chỉ feed vào các KO đích cụ thể (nếu service bạn hỗ trợ tham số này)
        targets: koTargets.map((b) => b._id), // <-- thêm param này trong service nếu chưa có
        provisional: false,
        finalizeOnComplete: true,
        log: false,
      });
      fedFrom++;
    }

    // Nối khung KO
    for (const kb of koTargets) {
      await Match.compileSeedsForBracket(kb._id);
    }

    return res.json({
      ok: true,
      sourceStage: srcStage,
      targetStage: dstStage,
      mode: resolvedMode,
      summary: { fedFromGroupBrackets: fedFrom, koTargets: koTargets.length },
    });
  }

  /* ---- Case B: PO/KO -> KO (winners of a round) ---- */
  if (resolvedMode === "PO_ROUND_WINNERS" || resolvedMode === "KO_ROUND_WINNERS") {
    if (!Number.isInteger(koRound)) {
      return res.status(400).json({ ok: false, message: "koRound (number) is required for *_ROUND_WINNERS mode." });
    }

    const srcKOorPO = sourceBrackets.filter((b) =>
      ["roundElim", "knockout"].includes(b.type)
    );
    if (!srcKOorPO.length) {
      return res.status(400).json({ ok: false, message: "Source stage must contain roundElim/knockout brackets." });
    }

    const srcIds = srcKOorPO.map((b) => b._id);
    const qualifiers = await listRoundWinners({ bracketIds: srcIds, round: koRound });

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        sourceType: srcKOorPO[0]?.type,
        foundQualifiers: qualifiers.length,
        targets: koTargets.map((b) => String(b._id)),
      });
    }

    if (forceReset) {
      await resetBracketSlots(koTargets.map((b) => b._id));
    }

    // Điền qualifiers vào từng KO target (nếu nhiều KO, chia tuần tự)
    let used = 0;
    for (const kb of koTargets) {
      const remain = qualifiers.slice(used);
      if (!remain.length) break;
      await fillQualifiersIntoKO(kb._id, remain, { entryOrder });
      // Tính số slot mà KO này tiêu thụ
      const slots = await getKOEntrySlotsRound1(kb._id, { entryOrder });
      used += Math.min(remain.length, slots.length);
    }

    return res.json({
      ok: true,
      sourceStage: srcStage,
      targetStage: dstStage,
      mode: resolvedMode,
      koRound,
      summary: {
        qualifiersTotal: qualifiers.length,
        koTargets: koTargets.length,
        entryOrder,
      },
    });
  }

  return res.status(400).json({ ok: false, message: `Unsupported mode: ${resolvedMode}` });
});