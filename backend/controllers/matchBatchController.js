// controllers/matchBatchController.js
import expressAsyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";
import mongoose from "mongoose";
import User from "../models/userModel.js"

/** POST /admin/matches/batch/update-referee
 * body: { ids: [matchId...], referee: userId }
 */
export const batchAssignReferee = expressAsyncHandler(async (req, res) => {
  const { ids, referees } = req.body;

  // 1) Validate match ids
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("ids must be a non-empty array");
  }
  const invalidMatchIds = ids.filter((id) => !mongoose.isValidObjectId(id));
  if (invalidMatchIds.length) {
    res.status(400);
    throw new Error(`Invalid match ids: ${invalidMatchIds.join(", ")}`);
  }

  // 2) Validate & normalize referees (array; empty array = clear)
  if (!Array.isArray(referees)) {
    res.status(400);
    throw new Error("referees must be an array (send [] to clear)");
  }
  const refIds = Array.from(new Set(referees.map(String).filter(Boolean)));

  // 3) If not clearing, verify users exist and have proper roles
  if (refIds.length > 0) {
    const invalidRefIds = refIds.filter((id) => !mongoose.isValidObjectId(id));
    if (invalidRefIds.length) {
      res.status(400);
      throw new Error(`Invalid referee ids: ${invalidRefIds.join(", ")}`);
    }

    const users = await User.find({ _id: { $in: refIds } }).select("_id role");
    if (users.length !== refIds.length) {
      const found = new Set(users.map((u) => String(u._id)));
      const missing = refIds.filter((id) => !found.has(id));
      res.status(404);
      throw new Error(`Referees not found: ${missing.join(", ")}`);
    }

    const bad = users.find((u) => !["referee", "admin"].includes(u.role));
    if (bad) {
      res.status(400);
      throw new Error("Some users do not have referee permission");
    }
  }

  // 4) Update all matches: set array (or clear with [])
  const result = await Match.updateMany(
    { _id: { $in: ids } },
    { $set: { referee: refIds } }, // field 'referee' is an array<ObjectId>
    { runValidators: true }
  );

  res.json({
    matched: result.matchedCount ?? result.n ?? ids.length,
    updated: result.modifiedCount ?? result.nModified ?? 0,
  });
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

/** POST /admin/brackets/:bracketId/matches/clear
 * body: {
 *   status?: 'scheduled'|'queued'|'assigned'|'live'|'finished' | string[]  // optional filter
 *   dryRun?: boolean                                                       // optional: chỉ đếm, không xoá
 * }
 * Xoá tất cả match thuộc bracket (giữ nguyên bracket).
 */
export const clearBracketMatches = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const { status, dryRun } = req.body || {};

  const br = await Bracket.findById(bracketId).select("_id");
  if (!br) {
    res.status(404);
    throw new Error("Bracket not found");
  }

  const query = { bracket: br._id };
  if (typeof status !== "undefined") {
    if (Array.isArray(status) && status.length) {
      query.status = { $in: status };
    } else if (typeof status === "string" && status.trim()) {
      query.status = status.trim();
    } else {
      res.status(400);
      throw new Error(
        "status must be a non-empty string or an array of strings"
      );
    }
  }

  if (dryRun) {
    const wouldDelete = await Match.countDocuments(query);
    return res.json({ wouldDelete });
  }

  const result = await Match.deleteMany(query);
  res.json({ deleted: result.deletedCount || 0 });
});
