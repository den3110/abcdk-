// controllers/matchBatchController.js
import expressAsyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";

/** POST /admin/matches/batch/update-referee
 * body: { ids: [matchId...], referee: userId }
 */
export const batchAssignReferee = expressAsyncHandler(async (req, res) => {
  const { ids, referee } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    res.status(400);
    throw new Error("ids must be a non-empty array");
  }
  const result = await Match.updateMany(
    { _id: { $in: ids } },
    { $set: { referee: referee || null } }
  );
  res.json({ updated: result.modifiedCount ?? result.nModified ?? 0 });
});

/** POST /admin/brackets/:bracketId/matches/batch-delete
 * body: { ids: [matchId...] }
 */
export const batchDeleteMatches = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    res.status(400);
    throw new Error("ids must be a non-empty array");
  }
  const result = await Match.deleteMany({
    _id: { $in: ids },
    bracket: bracketId,
  });
  res.json({ deleted: result.deletedCount || 0 });
});

/** POST /admin/brackets/:bracketId/round-elim/skeleton
 * body: { drawSize: N (2^m), cutRounds: K (>=1), overwrite=false }
 * Tạo r vòng: r = min(K, log2(N)-1), mỗi vòng tạo N/2^r trận, chưa gán pairA/B.
 */
export const buildRoundElimSkeleton = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const { drawSize, cutRounds, overwrite } = req.body || {};

  const br = await Bracket.findById(bracketId);
  if (!br) {
    res.status(404);
    throw new Error("Bracket not found");
  }
  if (br.type !== "roundElim") {
    res.status(400);
    throw new Error("Only allowed for roundElim bracket");
  }

  const N = Number(drawSize);
  const K = Number(cutRounds);
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) {
    res.status(400);
    throw new Error("drawSize must be a power of 2 (>=2)");
  }
  if (!Number.isInteger(K) || K < 1 || K >= Math.log2(N)) {
    res.status(400);
    throw new Error("cutRounds must be >=1 and < log2(drawSize)");
  }

  const existingCount = await Match.countDocuments({ bracket: br._id });
  if (existingCount > 0 && !overwrite) {
    res.status(400);
    throw new Error(
      "Bracket already has matches. Pass overwrite=true to force."
    );
  }
  if (existingCount > 0 && overwrite) {
    await Match.deleteMany({ bracket: br._id });
  }

  const defaultRules = {
    bestOf: br.config?.rules?.bestOf ?? 3,
    pointsToWin: br.config?.rules?.pointsToWin ?? 11,
    winByTwo: br.config?.rules?.winByTwo ?? true,
  };

  const docs = [];
  const rounds = Math.min(K, Math.max(1, Math.log2(N) - 1));
  for (let r = 1; r <= rounds; r++) {
    const count = Math.max(1, N >> r); // N/2^r
    for (let i = 0; i < count; i++) {
      docs.push({
        tournament: br.tournament,
        bracket: br._id,
        round: r,
        order: i,
        rules: defaultRules,
        status: "scheduled",
      });
    }
  }
  if (!docs.length) return res.json({ created: 0 });

  const result = await Match.insertMany(docs);
  res.json({ created: result.length, rounds });
});
