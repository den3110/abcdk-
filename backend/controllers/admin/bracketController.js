// controllers/bracketController.js
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Bracket from "../../models/bracketModel.js";
import Tournament from "../../models/tournamentModel.js";
import Match from "../../models/matchModel.js";
import Registration from "../../models/registrationModel.js";
import { clearTournamentPresentationCaches } from "../../services/cacheInvalidation.service.js";
import {
  analyzeBlueprintRuntime,
  BLUEPRINT_STAGE_ORDER,
  blueprintUiTypeFromStageKey,
  buildPublishedBlueprintPlan,
  groupBracketsBySemanticStage,
} from "../../services/blueprintRuntime.service.js";

// ===== Helpers =====
const isPow2 = (n) => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
const ceilPow2 = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));
const countPaidRegs = async (tournamentId) =>
  Registration.countDocuments({
    tournament: tournamentId,
    "payment.status": "Paid",
  });

const SEED_BYE = { type: "bye", ref: null, label: "BYE" };
const DEFAULT_KO_RULES = {
  bestOf: 3,
  pointsToWin: 11,
  winByTwo: true,
  cap: { mode: "none", points: null },
};

function roundTitleByPairs(pairs) {
  if (pairs === 1) return "F";
  if (pairs === 2) return "SF";
  if (pairs === 4) return "QF";
  return `R${pairs * 2}`;
}

function normalizeRules(rules, fallback = DEFAULT_KO_RULES) {
  const src = rules && typeof rules === "object" ? rules : fallback;
  return {
    bestOf: [1, 3, 5].includes(Number(src.bestOf))
      ? Number(src.bestOf)
      : fallback.bestOf,
    pointsToWin: [11, 15, 21].includes(Number(src.pointsToWin))
      ? Number(src.pointsToWin)
      : fallback.pointsToWin,
    winByTwo:
      typeof src.winByTwo === "boolean" ? src.winByTwo : fallback.winByTwo,
    cap: {
      mode: ["none", "hard", "soft"].includes(String(src?.cap?.mode || ""))
        ? String(src.cap.mode)
        : fallback.cap.mode,
      points:
        src?.cap?.points === null || typeof src?.cap?.points === "undefined"
          ? null
          : Number(src.cap.points) || null,
    },
  };
}

function registrationIdFromSeed(seed) {
  if (String(seed?.type || "") !== "registration") return null;
  const ref = seed?.ref && typeof seed.ref === "object" ? seed.ref : {};
  return ref.registration || ref.reg || seed.registration || seed.reg || null;
}

function registrationSeed(regId, label = "") {
  if (!regId) return null;
  return { type: "registration", ref: { registration: regId }, label };
}

function sanitizeKoSeed(seed, pairId = null) {
  if (seed?.type === "registration") {
    const regId = registrationIdFromSeed(seed) || pairId;
    return regId ? registrationSeed(regId, seed.label || "") : SEED_BYE;
  }
  if (pairId) return registrationSeed(pairId);
  if (seed?.type === "bye") return SEED_BYE;
  return seed?.type ? seed : SEED_BYE;
}

function pairFromKoSeed(seed) {
  return registrationIdFromSeed(seed);
}

function pickKoRules({ round, order, rounds, baseRules, semiRules, finalRules }) {
  if (round === rounds && order === 0 && finalRules) return finalRules;
  if (rounds >= 2 && round === rounds - 1 && semiRules) return semiRules;
  return baseRules;
}

// ===== CREATE =====
// adminCreateBracket
export const adminCreateBracket = expressAsyncHandler(async (req, res) => {
  const { id } = req.params; // tournament id
  const {
    name,
    type = "knockout",
    stage = 1,
    order = 0,
    drawRounds,
    meta,
    config,
    noRankDelta, // ⭐ NEW
  } = req.body;

  const tour = await Tournament.findById(id).select("noRankDelta"); // ⭐ select thêm flag
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const allowed = ["group", "knockout", "roundElim"];
  if (!allowed.includes(type)) {
    res.status(400);
    throw new Error(`type must be one of ${allowed.join(", ")}`);
  }

  // Validate drawRounds nếu có (cho knockout/roundElim)
  let toSaveDrawRounds;
  if (typeof drawRounds !== "undefined") {
    if (!["knockout", "roundElim"].includes(type)) {
      res.status(400);
      throw new Error("drawRounds chỉ áp dụng cho knockout / roundElim");
    }
    const n = Number(drawRounds);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400);
      throw new Error("drawRounds phải là số nguyên dương (>= 1)");
    }
    const paidCount = await countPaidRegs(id);
    const maxRounds = Math.floor(Math.log2(Math.max(0, paidCount)));
    if (maxRounds < 1) {
      res.status(400);
      throw new Error("Không đủ số đội đã thanh toán để thiết lập (cần ≥ 2).");
    }
    if (n > maxRounds) {
      res.status(400);
      throw new Error(
        `drawRounds tối đa là ${maxRounds} (2^${maxRounds} ≤ ${paidCount} đội đã thanh toán).`
      );
    }
    toSaveDrawRounds = n;
  }

  // Sanitize meta nếu có (nhẹ cho UI)
  let toSaveMeta;
  if (meta && typeof meta === "object") {
    const m = {};
    if (Number.isFinite(meta.drawSize))
      m.drawSize = Math.max(2, Number(meta.drawSize));
    if (Number.isFinite(meta.maxRounds))
      m.maxRounds = Math.max(1, Number(meta.maxRounds));
    if (Number.isFinite(meta.expectedFirstRoundMatches))
      m.expectedFirstRoundMatches = Math.max(
        1,
        Number(meta.expectedFirstRoundMatches)
      );
    // Đồng bộ cơ bản: nếu có drawSize → làm tròn & set maxRounds/expected…
    if (m.drawSize) {
      const pow2 = isPow2(m.drawSize) ? m.drawSize : ceilPow2(m.drawSize);
      m.drawSize = pow2;
      m.maxRounds = Math.round(Math.log2(pow2));
      m.expectedFirstRoundMatches = pow2 / 2;
    }
    toSaveMeta = m;
  }

  // Nhận config (nếu FE muốn lưu gì thêm)
  let toSaveConfig;
  if (config && typeof config === "object") {
    toSaveConfig = config;
    // nếu type = roundElim và có config.roundElim.drawSize → làm tròn 2^k
    if (
      toSaveConfig.roundElim &&
      Number.isFinite(toSaveConfig.roundElim.drawSize)
    ) {
      const ds = Number(toSaveConfig.roundElim.drawSize);
      toSaveConfig.roundElim.drawSize = isPow2(ds)
        ? ds
        : ceilPow2(Math.max(2, ds));
    }
    if (
      toSaveConfig.roundElim &&
      Number.isFinite(toSaveConfig.roundElim.cutRounds)
    ) {
      toSaveConfig.roundElim.cutRounds = Math.max(
        1,
        Number(toSaveConfig.roundElim.cutRounds)
      );
    }
  }

  // ⭐ NEW: Quyết định cờ noRankDelta cho bracket
  // - Nếu client gửi boolean → dùng.
  // - Nếu không gửi → kế thừa từ Tournament.
  // - Nếu Tournament đang bật → ép true (đảm bảo "tự tích hết bracket trong giải").
  let toSaveNoRankDelta =
    typeof noRankDelta === "boolean" ? !!noRankDelta : !!tour.noRankDelta;
  if (tour.noRankDelta) toSaveNoRankDelta = true;

  const bracket = await Bracket.create({
    tournament: id,
    name,
    type,
    stage,
    order,
    ...(typeof toSaveDrawRounds !== "undefined"
      ? { drawRounds: toSaveDrawRounds }
      : {}),
    ...(toSaveMeta ? { meta: toSaveMeta } : {}),
    ...(toSaveConfig ? { config: toSaveConfig } : {}),
    noRankDelta: toSaveNoRankDelta, // ⭐ NEW
    createdBy: req.user?._id,
  });

  await clearTournamentPresentationCaches();
  res.status(201).json(bracket);
});

// ===== LIST (kèm meta trong schema nên trả ra là có) =====
export const getBracketsWithMatches = expressAsyncHandler(async (req, res) => {
  const { id } = req.params; // tournament id
  const list = await Bracket.find({ tournament: id })
    .sort({ order: 1, stage: 1 })
    .populate({
      path: "tournament",
      // chỉ lấy các field cần thiết để payload gọn
      select:
        "_id name image sportType groupId regOpenDate registrationDeadline startDate endDate eventType maxPairs status location expected matchesCount finishedAt",
    })
    .lean();

  res.json(list);
});

// ===== UPDATE =====
// adminUpdateBracket
export const adminUpdateBracket = expressAsyncHandler(async (req, res) => {
  const { tournamentId, bracketId } = req.params;
  const { name, type, stage, order, drawRounds, meta, config, noRankDelta } =
    req.body; // ⭐ NEW

  const br = await Bracket.findById(bracketId);
  if (!br || String(br.tournament) !== String(tournamentId)) {
    res.status(404);
    throw new Error("Bracket not found in this tournament");
  }

  // Lấy flag của giải để đảm bảo "giải bật → bracket phải bật"
  const tour = await Tournament.findById(tournamentId).select("noRankDelta");
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const allowed = ["group", "knockout", "roundElim"];
  if (type && !allowed.includes(type)) {
    res.status(400);
    throw new Error(`type must be one of ${allowed.join(", ")}`);
  }

  if (typeof name === "string") br.name = name.trim();
  if (type) br.type = type;
  if (Number.isFinite(Number(stage))) br.stage = Number(stage);
  if (Number.isFinite(Number(order))) br.order = Number(order);

  // ⭐ NEW: Update noRankDelta nếu client gửi
  if (typeof noRankDelta === "boolean") {
    br.noRankDelta = !!noRankDelta;
  }

  // ⭐ NEW: Nếu Giải đang bật, ép Bracket bật (không cho off lệch luật)
  if (tour.noRankDelta) {
    br.noRankDelta = true;
  }

  const finalType = br.type;

  if (typeof drawRounds !== "undefined") {
    if (!["knockout", "roundElim"].includes(finalType)) {
      res.status(400);
      throw new Error("Số vòng chỉ áp dụng cho knockout / roundElim");
    }
    const n = Number(drawRounds);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400);
      throw new Error("Số vòng phải là số nguyên dương (>= 1)");
    }
    const paidCount = await countPaidRegs(tournamentId);
    const maxRounds = Math.floor(Math.log2(Math.max(0, paidCount)));
    if (maxRounds < 1) {
      res.status(400);
      throw new Error("Không đủ số đội đã thanh toán để thiết lập (cần ≥ 2).");
    }
    if (n > maxRounds) {
      res.status(400);
      throw new Error(
        `Số vòng tối đa là ${maxRounds} (2^${maxRounds} ≤ ${paidCount} đội đã thanh toán).`
      );
    }
    br.drawRounds = n;
  }

  // Update meta (nhẹ cho UI)
  if (meta && typeof meta === "object") {
    br.meta = br.meta || {};
    if (Number.isFinite(meta.drawSize))
      br.meta.drawSize = Math.max(2, Number(meta.drawSize));
    if (Number.isFinite(meta.maxRounds))
      br.meta.maxRounds = Math.max(1, Number(meta.maxRounds));
    if (Number.isFinite(meta.expectedFirstRoundMatches))
      br.meta.expectedFirstRoundMatches = Math.max(
        1,
        Number(meta.expectedFirstRoundMatches)
      );

    // Đồng bộ nếu có drawSize
    if (br.meta.drawSize) {
      const pow2 = isPow2(br.meta.drawSize)
        ? br.meta.drawSize
        : ceilPow2(br.meta.drawSize);
      br.meta.drawSize = pow2;
      br.meta.maxRounds = Math.round(Math.log2(pow2));
      br.meta.expectedFirstRoundMatches = pow2 / 2;
    }
  }

  // Update config (nếu FE muốn)
  if (config && typeof config === "object") {
    br.config = { ...(br.config?.toObject?.() || br.config || {}), ...config };

    // Chuẩn hoá roundElim nếu có
    if (br.config.roundElim) {
      if (Number.isFinite(br.config.roundElim.drawSize)) {
        const ds = Number(br.config.roundElim.drawSize);
        br.config.roundElim.drawSize = isPow2(ds)
          ? ds
          : ceilPow2(Math.max(2, ds));
      }
      if (Number.isFinite(br.config.roundElim.cutRounds)) {
        br.config.roundElim.cutRounds = Math.max(
          1,
          Number(br.config.roundElim.cutRounds)
        );
      }
    }
  }

  await br.save();
  await clearTournamentPresentationCaches();
  res.json(br);
});

// ===== REBUILD KNOCKOUT TREE (keep bracket, replace matches only) =====
export const rebuildKnockoutBracket = expressAsyncHandler(async (req, res) => {
  const { tournamentId, bracketId } = req.params;
  const {
    drawSize,
    preserveSeeds = false,
    thirdPlace,
  } = req.body || {};

  const size = Number(drawSize);
  if (!Number.isInteger(size) || size < 2 || !isPow2(size)) {
    res.status(400);
    throw new Error("drawSize phải là lũy thừa của 2 và >= 2");
  }
  if (size > 1024) {
    res.status(400);
    throw new Error("drawSize tối đa đang hỗ trợ là 1024");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const br = await Bracket.findOne({
      _id: bracketId,
      tournament: tournamentId,
    }).session(session);

    if (!br) {
      res.status(404);
      throw new Error("Bracket not found in this tournament");
    }
    if (br.type !== "knockout") {
      res.status(400);
      throw new Error("Chỉ tạo lại được bracket loại knockout");
    }

    const existingMatches = await Match.find({ bracket: br._id })
      .select("_id round order status pairA pairB seedA seedB")
      .sort({ round: 1, order: 1 })
      .session(session)
      .lean();

    const lockedCount = existingMatches.filter((m) =>
      ["live", "finished"].includes(String(m?.status || "").toLowerCase())
    ).length;
    if (lockedCount > 0) {
      res.status(409);
      throw new Error(
        `Không thể tạo lại vì knockout đang có ${lockedCount} trận live/finished`
      );
    }

    const rounds = Math.round(Math.log2(size));
    const firstPairs = size / 2;
    const oldRound1 = new Map(
      existingMatches
        .filter((m) => Number(m.round || 1) === 1)
        .map((m) => [Number(m.order || 0), m])
    );
    const prefillSeeds = new Map(
      (Array.isArray(br?.prefill?.seeds) ? br.prefill.seeds : []).map((s) => [
        Number(s?.pair || 0),
        s,
      ])
    );

    const r1Seeds = Array.from({ length: firstPairs }, (_, idx) => {
      const pairNo = idx + 1;
      const old = oldRound1.get(idx);
      const prefill = prefillSeeds.get(pairNo);
      return {
        pair: pairNo,
        A: preserveSeeds
          ? sanitizeKoSeed(old?.seedA || prefill?.A, old?.pairA)
          : SEED_BYE,
        B: preserveSeeds
          ? sanitizeKoSeed(old?.seedB || prefill?.B, old?.pairB)
          : SEED_BYE,
      };
    });

    const baseRules = normalizeRules(
      br?.config?.blueprint?.rules || br?.config?.rules
    );
    const semiRules = br?.config?.blueprint?.semiRules
      ? normalizeRules(br.config.blueprint.semiRules, baseRules)
      : null;
    const finalRules = br?.config?.blueprint?.finalRules
      ? normalizeRules(br.config.blueprint.finalRules, baseRules)
      : null;
    const thirdPlaceRules = br?.config?.blueprint?.thirdPlaceRules
      ? normalizeRules(br.config.blueprint.thirdPlaceRules, finalRules || baseRules)
      : null;
    const useThirdPlace =
      typeof thirdPlace === "boolean"
        ? thirdPlace
        : !!br?.config?.blueprint?.thirdPlaceEnabled;

    const deleteResult = await Match.deleteMany({ bracket: br._id }).session(
      session
    );

    const created = {};
    created[1] = await Match.insertMany(
      r1Seeds.map((seed, idx) => ({
        tournament: br.tournament,
        bracket: br._id,
        format: "knockout",
        round: 1,
        order: idx,
        seedA: seed.A || SEED_BYE,
        seedB: seed.B || SEED_BYE,
        pairA: pairFromKoSeed(seed.A),
        pairB: pairFromKoSeed(seed.B),
        rules: pickKoRules({
          round: 1,
          order: idx,
          rounds,
          baseRules,
          semiRules,
          finalRules,
        }),
        status: "scheduled",
      })),
      { session }
    );

    for (let round = 2; round <= rounds; round += 1) {
      const previous = created[round - 1] || [];
      const matchCount = Math.ceil(previous.length / 2);
      created[round] = await Match.insertMany(
        Array.from({ length: matchCount }, (_, idx) => ({
          tournament: br.tournament,
          bracket: br._id,
          format: "knockout",
          round,
          order: idx,
          previousA: previous[idx * 2]?._id || null,
          previousB: previous[idx * 2 + 1]?._id || null,
          rules: pickKoRules({
            round,
            order: idx,
            rounds,
            baseRules,
            semiRules,
            finalRules,
          }),
          status: "scheduled",
        })),
        { session }
      );
    }

    for (let round = 1; round < rounds; round += 1) {
      const current = created[round] || [];
      const next = created[round + 1] || [];
      for (let idx = 0; idx < next.length; idx += 1) {
        const nextMatch = next[idx];
        const left = current[idx * 2];
        const right = current[idx * 2 + 1];
        if (left) {
          left.nextMatch = nextMatch._id;
          left.nextSlot = "A";
          await left.save({ session });
        }
        if (right) {
          right.nextMatch = nextMatch._id;
          right.nextSlot = "B";
          await right.save({ session });
        }
      }
    }

    if (useThirdPlace && rounds >= 2) {
      await Match.insertMany(
        [
          {
            tournament: br.tournament,
            bracket: br._id,
            format: "knockout",
            round: rounds,
            order: created[rounds]?.length || 1,
            isThirdPlace: true,
            seedA: {
              type: "stageMatchLoser",
              ref: {
                stageIndex: Number(br.stage || 1),
                round: rounds - 1,
                order: 0,
              },
              label: `L-V${rounds - 1}-T1`,
            },
            seedB: {
              type: "stageMatchLoser",
              ref: {
                stageIndex: Number(br.stage || 1),
                round: rounds - 1,
                order: 1,
              },
              label: `L-V${rounds - 1}-T2`,
            },
            rules: thirdPlaceRules || finalRules || baseRules,
            status: "scheduled",
          },
        ],
        { session }
      );
    }

    const realSeedCount = r1Seeds.reduce((count, seed) => {
      return count + (pairFromKoSeed(seed.A) ? 1 : 0) + (pairFromKoSeed(seed.B) ? 1 : 0);
    }, 0);

    br.drawRounds = rounds;
    br.meta = {
      ...(br.meta?.toObject?.() || br.meta || {}),
      drawSize: size,
      maxRounds: rounds,
      expectedFirstRoundMatches: firstPairs,
      knockoutFinalNotified: false,
    };
    br.config = {
      ...(br.config?.toObject?.() || br.config || {}),
      rules: baseRules,
      blueprint: {
        ...(br.config?.blueprint?.toObject?.() || br.config?.blueprint || {}),
        drawSize: size,
        seeds: r1Seeds,
        rules: baseRules,
        semiRules,
        finalRules,
        thirdPlaceEnabled: useThirdPlace,
        thirdPlaceRules: thirdPlaceRules || null,
      },
    };
    br.prefill = {
      roundKey: roundTitleByPairs(firstPairs),
      seeds: r1Seeds,
    };
    br.teamsCount = realSeedCount;
    br.matchesCount = await Match.countDocuments({ bracket: br._id }).session(
      session
    );
    br.drawStatus = realSeedCount > 0 ? "drawn" : "planned";
    br.markModified("config");
    br.markModified("meta");
    br.markModified("prefill");
    await br.save({ session });

    await session.commitTransaction();
    await clearTournamentPresentationCaches();

    return res.json({
      ok: true,
      bracket: br,
      drawSize: size,
      rounds,
      deleted: deleteResult.deletedCount || 0,
      created: br.matchesCount,
      preservedSeeds: !!preserveSeeds,
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// ===== DELETE (cascade matches) =====
export const deleteBracketCascade = expressAsyncHandler(async (req, res) => {
  const { tourId, bracketId } = req.params;
  const br = await Bracket.findOne({ _id: bracketId, tournament: tourId });
  if (!br) return res.status(404).json({ message: "Bracket not found" });

  await Match.deleteMany({ bracket: br._id });
  await br.deleteOne();

  await clearTournamentPresentationCaches();
  res.json({ message: "Bracket deleted (and its matches)" });
});

/* ===== helpers (local) ===== */
const nextPow2 = ceilPow2;
const maxPoRoundsFor = (n) => {
  const N = Math.max(0, Number(n) || 0);
  const losers1 = Math.floor(N / 2);
  return Math.max(1, 1 + (losers1 > 0 ? Math.floor(Math.log2(losers1)) : 0));
};

// giữ nguyên seed object nếu có; không tự suy luận từ match để tránh sai
const sanitizeSeeds = (seeds) => {
  if (!Array.isArray(seeds)) return [];
  return seeds
    .map((s) => ({
      pair: Number(s?.pair) || 0,
      A: s?.A && s.A.type ? s.A : null,
      B: s?.B && s.B.type ? s.B : null,
    }))
    .filter((s) => s.pair > 0);
};

const normalizeGroupConfig = (cfg = {}) => {
  const groupCount = Number(
    cfg.groupCount || (Array.isArray(cfg.groups) ? cfg.groups.length : 0) || 0
  );
  const groups =
    Array.isArray(cfg.groups) && cfg.groups.length
      ? cfg.groups.map(String)
      : Array.from({ length: groupCount }, (_, i) => String(i + 1));

  // ưu tiên groupSizes nếu có; nếu không thì rỗng (Blueprint sẽ tự hiển thị fallback)
  const groupSizes = Array.isArray(cfg.groupSizes)
    ? cfg.groupSizes.map((v) => Number(v) || 0)
    : [];

  const out = {
    groupCount: groups.length,
    groups,
    groupSize: Number(cfg.groupSize || 0), // vẫn trả để tương thích
    groupSizes, // ưu tiên dùng khi có
    qualifiersPerGroup: Number(cfg.qualifiersPerGroup || 0), // có thể =0 nếu meta mới giữ
  };
  return out;
};

const normalizePoConfig = (cfg = {}) => {
  const drawSize = Math.max(0, Number(cfg.drawSize || 0));
  const maxRounds = Math.max(
    1,
    Math.min(Number(cfg.maxRounds || 1), maxPoRoundsFor(drawSize))
  );
  const seeds = sanitizeSeeds(cfg.seeds);

  return { drawSize, maxRounds, seeds };
};

const normalizeKoConfig = (cfg = {}) => {
  const ds = Math.max(2, Number(cfg.drawSize || 2));
  const drawSize = nextPow2(ds); // KO luôn 2^n
  const firstPairs = Math.max(1, drawSize / 2);
  const seeds = sanitizeSeeds(cfg.seeds).filter(
    (s) => s.pair >= 1 && s.pair <= firstPairs
  );
  return { drawSize, seeds };
};

/* ============================================================
 * GET /admin/tournaments/:id/brackets
 * trả về danh sách bracket đã chuẩn hoá cho Blueprint prefill
 * ============================================================ */
export const getTournamentBracketsStructure = expressAsyncHandler(
  async (req, res) => {
    const { id } = req.params; // tournament id

    const tournament = await Tournament.findById(id).select("drawPlan").lean();
    const raw = await Bracket.find({ tournament: id })
      .sort({ order: 1, stage: 1 })
      .select(
        "_id tournament name type stage order config meta prefill groups"
      )
      .populate({
        path: "groups.regIds",
        select: "player1 player2 teamName name label title",
      })
      .lean();

    if (!raw.length) return res.json([]);

    const publishedPlan = buildPublishedBlueprintPlan({
      tournamentPlan: tournament?.drawPlan,
      brackets: raw,
    });
    const runtimeByKey = await analyzeBlueprintRuntime({
      tournamentId: id,
      brackets: raw,
    });
    const buckets = groupBracketsBySemanticStage(raw);

    const list = BLUEPRINT_STAGE_ORDER.reduce((acc, stageKey) => {
      const bucket = buckets[stageKey] || [];
      const primary = bucket[0];
      if (!primary) return acc;

      const stagePlan = publishedPlan[stageKey] || null;
      acc.push({
        _id: primary._id,
        tournament: primary.tournament,
        name: primary.name,
        title: primary.name,
        type: blueprintUiTypeFromStageKey(stageKey),
        semanticStage: stageKey,
        stage: primary.stage,
        order: primary.order,
        config: stagePlan,
        rules: stagePlan?.rules || null,
        roundRules: stagePlan?.roundRules || null,
        semiRules: stagePlan?.semiRules || null,
        finalRules: stagePlan?.finalRules || null,
        thirdPlace: !!stagePlan?.thirdPlaceEnabled,
        meta: primary.meta || {},
        groups: Array.isArray(primary.groups) ? primary.groups : [],
        runtime: runtimeByKey[stageKey] || null,
        publishedBracketId:
          runtimeByKey[stageKey]?.publishedBracketId || String(primary._id),
      });
      return acc;
    }, []);

    res.json(list);
  }
);
