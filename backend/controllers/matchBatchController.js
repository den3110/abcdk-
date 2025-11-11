// controllers/matchBatchController.js
import expressAsyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import { toDTO } from "../socket/liveHandlers.js";

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
    { $set: { referee: refIds } },
    { runValidators: true }
  );

  // 5) SOCKET: bắn lại snapshot từng trận để FE thấy referee mới
  const io = req.app.get("io");

  // lấy lại toàn bộ match đã update với populate đầy đủ
  const updatedMatches = await Match.find({ _id: { $in: ids } })
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    .populate({ path: "tournament", select: "name image eventType overlay" })
    .populate({
      path: "bracket",
      select: [
        "noRankDelta",
        "name",
        "type",
        "stage",
        "order",
        "drawRounds",
        "drawStatus",
        "scheduler",
        "drawSettings",
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        "groups._id",
        "groups.name",
        "groups.expectedSize",
        "config.rules",
        "config.doubleElim",
        "config.roundRobin",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
        "overlay",
      ].join(" "),
    })
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor",
    })
    .populate({ path: "liveBy", select: "name fullName nickname nickName" })
    .select(
      "label managers court courtLabel courtCluster " +
        "scheduledAt startAt startedAt finishedAt status " +
        "tournament bracket rules currentGame gameScores " +
        "round order roundCode roundName " +
        "seedA seedB previousA previousB nextMatch winner serve overlay " +
        "video videoUrl stream streams meta " +
        "format rrRound pool " +
        "liveBy liveVersion"
    )
    .lean();

  // hàm fill nickname giống đoạn bạn gửi
  const pick = (v) => (v && String(v).trim()) || "";
  const fillNick = (p) => {
    if (!p) return p;
    const primary = pick(p.nickname) || pick(p.nickName);
    const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
    const n = primary || fromUser || "";
    if (n) {
      p.nickname = n;
      p.nickName = n;
    }
    return p;
  };

  for (const m of updatedMatches) {
    if (!m) continue;

    if (m.pairA) {
      m.pairA.player1 = fillNick(m.pairA.player1);
      m.pairA.player2 = fillNick(m.pairA.player2);
    }
    if (m.pairB) {
      m.pairB.player1 = fillNick(m.pairB.player1);
      m.pairB.player2 = fillNick(m.pairB.player2);
    }

    // fallback stream
    if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

    // 5.1) báo đơn giản: status
    io?.to(String(m._id)).emit("status:updated", {
      matchId: m._id,
      status: m.status,
    });

    // 5.2) báo đầy đủ để FE refetch UI
    io?.to(`match:${String(m._id)}`).emit("match:snapshot", toDTO(m));
  }

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

export const batchSetLiveUrl = expressAsyncHandler(async (req, res) => {
  const { ids, video } = req.body || {};

  // 1) validate ids
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400);
    throw new Error("ids must be a non-empty array");
  }
  const uniqIds = Array.from(new Set(ids.map(String)));
  const invalid = uniqIds.filter((id) => !mongoose.isValidObjectId(id));
  if (invalid.length) {
    res.status(400);
    throw new Error(`Invalid match ids: ${invalid.join(", ")}`);
  }

  // 2) normalize video
  const v = typeof video === "string" ? video.trim() : "";
  const update = v
    ? { $set: { video: v, videoUrl: v, "meta.video": v } }
    : { $unset: { video: "", videoUrl: "", "meta.video": "" } };

  // 3) updateMany
  const result = await Match.updateMany({ _id: { $in: uniqIds } }, update, {
    runValidators: true,
  });

  // 4) lấy lại match đã cập nhật + populate cần thiết để toDTO
  const updatedMatches = await Match.find({ _id: { $in: uniqIds } })
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    .populate({ path: "tournament", select: "name image eventType overlay" })
    .populate({
      path: "bracket",
      select: [
        "noRankDelta",
        "name",
        "type",
        "stage",
        "order",
        "drawRounds",
        "drawStatus",
        "scheduler",
        "drawSettings",
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        "groups._id",
        "groups.name",
        "groups.expectedSize",
        "config.rules",
        "config.doubleElim",
        "config.roundRobin",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
        "overlay",
      ].join(" "),
    })
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor",
    })
    .populate({ path: "liveBy", select: "name fullName nickname nickName" })
    .select(
      "label managers court courtLabel courtCluster " +
        "scheduledAt startAt startedAt finishedAt status " +
        "tournament bracket rules currentGame gameScores " +
        "round order roundCode roundName " +
        "seedA seedB previousA previousB nextMatch winner serve overlay " +
        "video videoUrl stream streams meta " +
        "format rrRound pool " +
        "liveBy liveVersion"
    )
    .lean();

  // helper: fill nickname
  const pick = (v) => (v && String(v).trim()) || "";
  const fillNick = (p) => {
    if (!p) return p;
    const primary = pick(p.nickname) || pick(p.nickName);
    const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
    const n = primary || fromUser || "";
    if (n) {
      p.nickname = n;
      p.nickName = n;
    }
    return p;
  };

  // 5) SOCKET: phát snapshot/updated để FE nhận ngay link video mới
  const io = req.app.get("io");
  for (const m of updatedMatches) {
    if (!m) continue;

    if (m.pairA) {
      m.pairA.player1 = fillNick(m.pairA.player1);
      m.pairA.player2 = fillNick(m.pairA.player2);
    }
    if (m.pairB) {
      m.pairB.player1 = fillNick(m.pairB.player1);
      m.pairB.player2 = fillNick(m.pairB.player2);
    }
    if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

    // emit snapshot đầy đủ
    io?.to(`match:${String(m._id)}`).emit("match:snapshot", toDTO(m));
  }

  res.json({
    matched: result.matchedCount ?? result.n ?? uniqIds.length,
    updated: result.modifiedCount ?? result.nModified ?? 0,
    video: v, // giá trị đã set ("" nếu xoá)
  });
});
