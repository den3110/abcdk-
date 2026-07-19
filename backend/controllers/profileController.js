// controllers/profileController.js
import asyncHandler from "express-async-handler";
import ScoreHistory from "../models/scoreHistoryModel.js";
import RatingChange from "../models/ratingChangeModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import User from "../models/userModel.js";
import Ranking from "../models/rankingModel.js";
import mongoose from "mongoose";
import { shouldHideUserRatings } from "../utils/privacyControl.js";
import { clearRankingPresentationCaches } from "../services/cacheInvalidation.service.js";
import {
  buildMatchCodePayload,
  isGroupishBracketType,
} from "../utils/matchDisplayCode.js";

const MAX_PROFILE_PAGE_SIZE = 1000;
const RATING_MIN = 0;
const RATING_MAX = 8;

const round3 = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

const formatSignedDelta = (value) => {
  let rounded = round3(value);
  if (Object.is(rounded, -0)) rounded = 0;
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(3)}`;
};

const replaceScoreHistoryDeltaNote = (note, delta) => {
  const signed = formatSignedDelta(delta);
  const text = String(note ?? "");
  const deltaPrefix = /^[+-]\d+(?:\.\d+)?/;
  if (deltaPrefix.test(text)) return text.replace(deltaPrefix, signed);
  return text ? `${signed} ${text}` : signed;
};

const ratingHistoryKey = (kind) => (kind === "singles" ? "single" : "double");

const assertSuperAdmin = (req, action) => {
  const isSuper = Boolean(req.user?.isSuperAdmin || req.user?.isSuperUser);
  if (!isSuper) {
    const label = action || "thao tác điểm trình";
    const err = new Error(`Chỉ Super Admin mới được ${label}`);
    err.status = 403;
    throw err;
  }
};

const hasPlayableScore = (match) => {
  const games = Array.isArray(match?.gameScores) ? match.gameScores : [];
  return games.some((game) => {
    const a = Number(game?.a ?? game?.scoreA ?? 0);
    const b = Number(game?.b ?? game?.scoreB ?? 0);
    return Number.isFinite(a) && Number.isFinite(b) && a + b > 0;
  });
};

const splitMillisEvenly = (totalMillis, count) => {
  if (!Number.isFinite(totalMillis) || count <= 0) return [];
  const sign = totalMillis < 0 ? -1 : 1;
  const abs = Math.abs(totalMillis);
  const base = Math.trunc(abs / count);
  const remainder = abs % count;
  return Array.from({ length: count }, (_, index) =>
    sign * (base + (index < remainder ? 1 : 0))
  );
};

const addUserId = (set, value) => {
  if (mongoose.isValidObjectId(value)) set.add(String(value));
};

const registrationUserIds = (reg) => {
  const ids = new Set();
  addUserId(ids, reg?.player1?.user);
  addUserId(ids, reg?.player2?.user);
  return [...ids];
};

const uniqueObjectIds = (values = []) =>
  [...new Set(values.map(String).filter((value) => mongoose.isValidObjectId(value)))].map(
    (value) => new mongoose.Types.ObjectId(value)
  );

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthyQuery(value) {
  return ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
}

function resolvePaging(query, fallbackLimit) {
  const wantsAll = isTruthyQuery(query?.all);
  const limit = wantsAll
    ? MAX_PROFILE_PAGE_SIZE
    : Math.min(
        MAX_PROFILE_PAGE_SIZE,
        parsePositiveInt(query?.limit ?? query?.pageSize, fallbackLimit)
      );
  const page = wantsAll ? 1 : parsePositiveInt(query?.page, 1);

  return {
    wantsAll,
    page,
    limit,
    skip: wantsAll ? 0 : limit * (page - 1),
  };
}

/**
 * GET /api/score-history/:id?page=1
 * Trả về lịch sử chấm điểm của một user (id = VĐV)
 * Mặc định pageSize = 10; nếu không cần phân trang, bỏ toàn bộ phần `page/pageSize`.
 */
export const getRatingHistory = asyncHandler(async (req, res) => {
  const { wantsAll, page, limit, skip } = resolvePaging(req.query, 10);

  const isAdmin = !!(
    req.user &&
    (req.user.isAdmin || req.user.role === "admin")
  );

  // ===== 1) Detect cộng/trừ điểm trong note (+5, -3, + 2.5, "thưởng +10", "phạt - 1", ...)
  const DELTA_RE = /(^|\s)[+-]\s*\d+(\.\d+)?\b/;
  const isDeltaNote = (n) => DELTA_RE.test(String(n || "").trim());

  // ===== 2) Helpers: bỏ dấu và chuẩn hoá để detect "tự ..." (sửa lỗi đ/Đ)
  const asciiFold = (s = "") =>
    String(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // bỏ dấu tiếng Việt
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");

  const normText = (s = "") =>
    asciiFold(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ") // ký tự lạ -> space
      .replace(/\s+/g, " ")
      .trim();

  // ===== 3) Detect "tự chấm trình / tự đánh giá / tự chấm điểm" (kể cả không dấu, dính liền)
  const isSelfNote = (n) => {
    const t = normText(n);
    const compact = t.replace(/\s+/g, "");

    // cụm tiếng Việt phổ biến
    if (
      t.includes("tu cham trinh") ||
      t.includes("tu danh gia") ||
      t.includes("tu cham diem") ||
      t.includes("tu danh diem") ||
      /^tu (cham|danh)/.test(t)
    )
      return true;

    // biến thể dính liền
    if (
      compact.includes("tuchamtrinh") ||
      compact.includes("tudanhgia") ||
      compact.includes("tuchamdiem") ||
      compact.includes("tudanhdiem")
    )
      return true;

    // tiếng Anh
    if (/^self( |-)?(rate|rating|assess(ment)?|scor(e|ed)?)/.test(t))
      return true;

    return false;
  };

  // ===== 4) Mask cho non-admin
  const MASK_SCORER = {
    _id: "000000000000000000000000",
    name: "Mod Pickletour",
    email: "contact@pickletour.vn",
  };

  // ===== 5) Query
  const filter = { user: req.params.id };
  const total = await ScoreHistory.countDocuments(filter);

  const rows = await ScoreHistory.find(filter)
    .sort({ scoredAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .select("scoredAt single double note scorer user")
    .populate("scorer", "name email")
    .populate("user", "name nickname email avatar")
    .lean();

  const isHiddenInfo = await shouldHideUserRatings(req.user, req.params.id);

  // ===== 6) Transform
  const history = rows.map((r) => {
    const isDelta = isDeltaNote(r.note);
    const isSelf = isSelfNote(r.note);

    // Hiển thị note
    const noteForClient =
      isDelta || isSelf
        ? r.note ?? ""
        : isAdmin
        ? r.note ?? ""
        : "Mod Pickletour chấm trình";

    // Scorer: delta => null; còn lại: admin thấy thật, non-admin thấy mask
    const realScorer = r.scorer
      ? { _id: r.scorer._id, name: r.scorer.name, email: r.scorer.email }
      : null;
    const scorerForClient = isDelta ? null : isAdmin ? realScorer : MASK_SCORER;

    return {
      _id: r._id,
      scoredAt: r.scoredAt,
      single: isHiddenInfo ? null : r.single,
      double: isHiddenInfo ? null : r.double,
      note: noteForClient,
      scorer: scorerForClient,
      user: r.user
        ? {
            _id: r.user._id,
            name: r.user.name,
            nickname: r.user.nickname,
            email: r.user.email,
            avatar: r.user.avatar,
          }
        : { _id: req.params.id },
    };
  });

  res.json({
    history,
    total,
    page,
    limit,
    pageSize: limit,
    all: wantsAll,
  });
});

/* -------- helpers -------- */

/* -------- helpers -------- */
function buildHistMap(rows, isHiddenInfo = false) {
  // map[userId] = [{t, single, double}, ...] (đã sort asc theo t)
  const map = {};
  for (const r of rows) {
    const k = String(r.user);
    (map[k] ||= []).push({
      t: new Date(r.scoredAt).getTime(),
      single: isHiddenInfo ? null : r.single,
      double: isHiddenInfo ? null : r.double,
    });
  }
  return map;
}

// Lấy điểm pre/post và delta quanh thời điểm 'when'
function decoratePlayer(p, histMap, when, key /* 'single' | 'double' */) {
  if (!p) return null;
  const uid = p.user ? String(p.user) : "";
  const hist = histMap[uid] || [];
  let pre = undefined,
    post = undefined;
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i];
    // if (h.t <= when) pre = h[key];
    // if (h.t >= when) {
    //   post = h[key];
    //   break;
    // }
    // pre: chỉ lấy record trước thời điểm trận kết thúc
    if (h.t < when) pre = h[key];
    // post: lấy record tại hoặc sau thời điểm trận kết thúc (record apply điểm)
    if (h.t >= when) {
      post = h[key];
      break;
    }
  }
  // fallback khi không có record hai phía
  if (post === undefined) post = pre;
  if (pre === undefined) pre = post;

  const delta = (post ?? 0) - (pre ?? 0);
  return {
    _id: p.user || null,
    name: p.fullName || "",
    avatar: p.avatar || "",
    preScore: Number.isFinite(pre) ? pre : undefined,
    postScore: Number.isFinite(post) ? post : undefined,
    delta: Number.isFinite(delta) ? delta : undefined,
    regScore: p.score ?? undefined, // snapshot lúc đăng ký (nếu cần)
  };
}

function applyRatingChangeToPlayer(base, ratingChange) {
  if (!base || !ratingChange) return base;
  const before = Number(ratingChange.before);
  const after = Number(ratingChange.after);
  const delta = Number(ratingChange.delta);
  return {
    ...base,
    preScore: Number.isFinite(before) ? before : base.preScore,
    postScore: Number.isFinite(after) ? after : base.postScore,
    delta: Number.isFinite(delta) ? delta : base.delta,
  };
}

function decorateUnchangedPlayer(p, histMap, when, key /* 'single' | 'double' */) {
  if (!p) return null;
  const uid = p.user ? String(p.user) : "";
  const hist = histMap[uid] || [];
  let value = undefined;
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i];
    if (h.t <= when && Number.isFinite(h[key])) {
      value = h[key];
    }
  }
  if (value === undefined) {
    const regScore = Number(p.score);
    if (Number.isFinite(regScore)) value = regScore;
  }

  return {
    _id: p.user || null,
    name: p.fullName || "",
    avatar: p.avatar || "",
    preScore: Number.isFinite(value) ? value : undefined,
    postScore: Number.isFinite(value) ? value : undefined,
    delta: Number.isFinite(value) ? 0 : undefined,
    regScore: p.score ?? undefined,
  };
}

function buildScoreText(gameScores = []) {
  if (!Array.isArray(gameScores) || !gameScores.length) return "";
  return gameScores.map((g) => `${g.a ?? 0} - ${g.b ?? 0}`).join(" , ");
}

const addToScoreHistory = async ({
  user,
  key,
  matchId,
  anchorAt,
  amount,
  noteDelta,
}) => {
  const delta = Number(amount) || 0;
  if (!user || !key || !matchId || !anchorAt || !delta) return 0;

  const addStage = [
    {
      $set: {
        [key]: {
          $round: [
            {
              $max: [
                { $add: [{ $ifNull: [`$${key}`, 0] }, delta] },
                0,
              ],
            },
            3,
          ],
        },
      },
    },
  ];

  const nearStart = new Date(anchorAt.getTime() - 2000);
  const nearEnd = new Date(anchorAt.getTime() + 2000);
  const currentFilter = {
    user,
    [key]: { $ne: null },
    $or: [
      { sourceMatch: matchId },
      {
        sourceMatch: { $exists: false },
        scoredAt: { $gte: nearStart, $lte: nearEnd },
        note: /^[+-]\d/,
      },
      {
        sourceMatch: null,
        scoredAt: { $gte: nearStart, $lte: nearEnd },
        note: /^[+-]\d/,
      },
    ],
  };

  const currentOut = await ScoreHistory.updateMany(currentFilter, addStage);

  const nextNoteDelta = Number(noteDelta);
  if (Number.isFinite(nextNoteDelta)) {
    const currentRows = await ScoreHistory.find(currentFilter)
      .select("_id note")
      .lean();

    if (currentRows.length) {
      await ScoreHistory.bulkWrite(
        currentRows.map((row) => ({
          updateOne: {
            filter: { _id: row._id },
            update: {
              $set: {
                note: replaceScoreHistoryDeltaNote(row.note, nextNoteDelta),
              },
            },
          },
        })),
        { ordered: false }
      );
    }
  }

  const futureOut = await ScoreHistory.updateMany(
    {
      user,
      [key]: { $ne: null },
      scoredAt: { $gt: anchorAt },
    },
    addStage
  );

  return (currentOut.modifiedCount || 0) + (futureOut.modifiedCount || 0);
};

const shiftFutureRatingChanges = async ({ user, kind, anchorAt, amount }) => {
  const delta = Number(amount) || 0;
  if (!user || !kind || !anchorAt || !delta) return 0;

  const out = await RatingChange.updateMany(
    {
      user,
      kind,
      revoked: { $ne: true },
      createdAt: { $gt: anchorAt },
    },
    [
      {
        $set: {
          before: {
            $round: [
              { $max: [{ $add: [{ $ifNull: ["$before", 0] }, delta] }, 0] },
              3,
            ],
          },
          after: {
            $round: [
              { $max: [{ $add: [{ $ifNull: ["$after", 0] }, delta] }, 0] },
              3,
            ],
          },
        },
      },
    ]
  );

  return out.modifiedCount || 0;
};

const syncRankingsFromLatestHistory = async (usersByKey) => {
  let rankingSynced = 0;
  const touchedUserIds = new Set();
  const now = new Date();

  for (const [key, userSet] of usersByKey.entries()) {
    if (!userSet?.size) continue;
    const userIds = uniqueObjectIds([...userSet]);
    if (!userIds.length) continue;

    const rows = await ScoreHistory.aggregate([
      {
        $match: {
          user: { $in: userIds },
          [key]: { $type: "number" },
        },
      },
      { $sort: { scoredAt: -1, createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$user",
          value: { $first: `$${key}` },
        },
      },
    ]);

    const latestByUser = new Map(
      rows
        .filter((row) => Number.isFinite(Number(row?.value)))
        .map((row) => [String(row._id), round3(row.value)])
    );

    const ops = userIds.map((userId) => {
      const userKey = String(userId);
      touchedUserIds.add(userKey);
      return {
        updateOne: {
          filter: { user: userId },
          update: {
            $set: {
              [key]: latestByUser.get(userKey) ?? 0,
              lastUpdated: now,
            },
            $currentDate: { updatedAt: true },
            $setOnInsert: { user: userId },
          },
          upsert: true,
        },
      };
    });

    if (ops.length) {
      const out = await Ranking.bulkWrite(ops, { ordered: false });
      rankingSynced +=
        (out.modifiedCount || 0) +
        (out.upsertedCount || 0) +
        (out.matchedCount || 0);
    }
  }

  if (touchedUserIds.size) {
    await Ranking.bulkRecalculateTiers([...touchedUserIds]);
  }

  return {
    rankingSynced,
    rankingUsersSynced: touchedUserIds.size,
  };
};

const getCurrentRatingValue = async (userId, key) => {
  const rank = await Ranking.findOne({ user: userId }).select(key).lean();
  const ranked = Number(rank?.[key]);
  if (Number.isFinite(ranked)) return round3(ranked);

  const latest = await ScoreHistory.findOne({
    user: userId,
    [key]: { $type: "number" },
  })
    .sort({ scoredAt: -1, createdAt: -1, _id: -1 })
    .select(key)
    .lean();
  const value = Number(latest?.[key]);
  return Number.isFinite(value) ? round3(value) : 0;
};

export const adjustMatchRatingTarget = asyncHandler(async (req, res) => {
  assertSuperAdmin(req, "chỉnh điểm trình theo mục tiêu");

  const userId = String(req.params.id || "");
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }

  const targetScore = Number(req.body?.targetScore);
  if (
    !Number.isFinite(targetScore) ||
    targetScore < RATING_MIN ||
    targetScore > RATING_MAX
  ) {
    res.status(400);
    throw new Error("Điểm mục tiêu không hợp lệ");
  }

  const matchIds = [
    ...new Set(
      (Array.isArray(req.body?.matchIds) ? req.body.matchIds : [])
        .map(String)
        .filter((id) => mongoose.isValidObjectId(id))
    ),
  ];
  if (!matchIds.length) {
    res.status(400);
    throw new Error("Chưa chọn trận để dàn điểm");
  }

  const matches = await Match.find({
    _id: { $in: uniqueObjectIds(matchIds) },
    status: "finished",
    winner: { $in: ["A", "B"] },
  })
    .select(
      "_id tournament pairA pairB gameScores winner finishedAt scheduledAt updatedAt createdAt"
    )
    .populate("tournament", "eventType")
    .populate("pairA", "player1.user player2.user")
    .populate("pairB", "player1.user player2.user")
    .lean();

  if (matches.length !== matchIds.length) {
    res.status(400);
    throw new Error("Có trận không tồn tại hoặc chưa kết thúc");
  }

  const plans = matches
    .map((match) => {
      const kind =
        match?.tournament?.eventType === "single" ? "singles" : "doubles";
      const key = ratingHistoryKey(kind);
      const teamAIds = registrationUserIds(match.pairA);
      const teamBIds = registrationUserIds(match.pairB);
      const targetOnA = teamAIds.includes(userId);
      const targetOnB = teamBIds.includes(userId);
      const anchorAt =
        match.finishedAt ||
        match.scheduledAt ||
        match.updatedAt ||
        match.createdAt ||
        new Date();

      return {
        match,
        kind,
        key,
        teamAIds,
        teamBIds,
        targetSide: targetOnA ? "A" : targetOnB ? "B" : "",
        anchorAt: new Date(anchorAt),
      };
    })
    .sort((a, b) => {
      const time = a.anchorAt.getTime() - b.anchorAt.getTime();
      if (time !== 0) return time;
      return String(a.match._id).localeCompare(String(b.match._id));
    });

  const kindSet = new Set(plans.map((plan) => plan.kind));
  if (kindSet.size !== 1) {
    res.status(400);
    throw new Error("Chỉ chọn các trận cùng loại điểm đơn hoặc đôi");
  }

  for (const plan of plans) {
    if (!plan.targetSide) {
      res.status(400);
      throw new Error("Có trận không thuộc user đang mở hồ sơ");
    }
    if (!plan.match?.pairA || !plan.match?.pairB || !hasPlayableScore(plan.match)) {
      res.status(400);
      throw new Error("Không thể chỉnh điểm cho trận BYE hoặc trận không có tỷ số");
    }
  }

  const kind = plans[0].kind;
  const key = plans[0].key;
  const currentScore = await getCurrentRatingValue(userId, key);
  const currentMillis = Math.round(currentScore * 1000);
  const targetMillis = Math.round(targetScore * 1000);
  const totalMillis = targetMillis - currentMillis;

  if (totalMillis === 0) {
    return res.json({
      ok: true,
      kind,
      key,
      currentScore,
      targetScore: round3(targetScore),
      totalDelta: 0,
      adjustedMatches: 0,
      message: "Điểm hiện tại đã bằng điểm mục tiêu",
    });
  }

  const logs = await RatingChange.find({
    match: { $in: plans.map((plan) => plan.match._id) },
    kind,
    revoked: { $ne: true },
  }).select("_id user match kind before after delta");

  const logsByMatchUser = new Map();
  for (const log of logs) {
    logsByMatchUser.set(`${log.match}|${log.user}`, log);
  }

  for (const plan of plans) {
    const allIds = [...new Set([...plan.teamAIds, ...plan.teamBIds])];
    for (const uid of allIds) {
      if (!logsByMatchUser.has(`${plan.match._id}|${uid}`)) {
        res.status(400);
        throw new Error("Có trận chưa có đủ log cộng/trừ điểm trình");
      }
    }
  }

  const adjustmentsMillis = splitMillisEvenly(totalMillis, plans.length);
  const usersByKey = new Map([[key, new Set()]]);
  let ratingChangesUpdated = 0;
  let scoreHistoriesShifted = 0;
  let futureLogsShifted = 0;
  const perMatch = [];

  for (const [index, plan] of plans.entries()) {
    const amount = adjustmentsMillis[index] / 1000;
    if (!amount) {
      perMatch.push({
        match: plan.match._id,
        deltaForTarget: 0,
      });
      continue;
    }

    const sameSideIds = plan.targetSide === "A" ? plan.teamAIds : plan.teamBIds;
    const otherSideIds = plan.targetSide === "A" ? plan.teamBIds : plan.teamAIds;
    const signedAdjustments = new Map();
    sameSideIds.forEach((uid) => signedAdjustments.set(uid, amount));
    otherSideIds.forEach((uid) => signedAdjustments.set(uid, -amount));

    const updatedDeltas = [];
    for (const [uid, signedAmount] of signedAdjustments.entries()) {
      const log = logsByMatchUser.get(`${plan.match._id}|${uid}`);
      const freshLog =
        (await RatingChange.findById(log._id).select("before after delta")) ||
        log;
      const before = Number(freshLog.before);
      const after = Number(freshLog.after);
      const safeBefore = Number.isFinite(before) ? before : 0;
      const rawAfter = (Number.isFinite(after) ? after : safeBefore) +
        signedAmount;
      const nextAfter = round3(Math.max(0, rawAfter));
      const nextDelta = round3(nextAfter - safeBefore);

      await RatingChange.updateOne(
        { _id: log._id },
        {
          $set: {
            after: nextAfter,
            delta: nextDelta,
            updatedAt: new Date(),
          },
        }
      );
      log.after = nextAfter;
      log.delta = nextDelta;
      ratingChangesUpdated += 1;
      updatedDeltas.push(Math.abs(nextDelta));

      scoreHistoriesShifted += await addToScoreHistory({
        user: log.user,
        key,
        matchId: plan.match._id,
        anchorAt: plan.anchorAt,
        amount: signedAmount,
        noteDelta: nextDelta,
      });
      futureLogsShifted += await shiftFutureRatingChanges({
        user: log.user,
        kind,
        anchorAt: plan.anchorAt,
        amount: signedAmount,
      });
      usersByKey.get(key).add(String(uid));
    }

    if (updatedDeltas.length) {
      const avgAbsDelta = updatedDeltas.reduce((sum, value) => sum + value, 0) /
        updatedDeltas.length;
      await Match.updateOne(
        { _id: plan.match._id },
        { $set: { ratingDelta: round3(avgAbsDelta) } }
      );
    }

    perMatch.push({
      match: plan.match._id,
      deltaForTarget: round3(amount),
    });
  }

  const rankingSync = await syncRankingsFromLatestHistory(usersByKey);
  await clearRankingPresentationCaches();

  return res.json({
    ok: true,
    kind,
    key,
    currentScore,
    targetScore: round3(targetScore),
    totalDelta: round3(totalMillis / 1000),
    adjustedMatches: plans.length,
    ratingChangesUpdated,
    scoreHistoriesShifted,
    futureLogsShifted,
    rankingSynced: rankingSync.rankingSynced,
    rankingUsersSynced: rankingSync.rankingUsersSynced,
    perMatch,
  });
});

export const getMatchHistory = asyncHandler(async (req, res) => {
  const userId = String(req.params.id);

  const isHiddenInfo = await shouldHideUserRatings(req.user, userId);

  // >>> Phân trang (GIỮ NGUYÊN)
  const { page, limit, skip } = resolvePaging(req.query, 10);

  // ✅ FIX: helper check ObjectId
  const isOID = (v) => mongoose.Types.ObjectId.isValid(String(v ?? ""));

  // 1) Lấy các registration mà user tham gia
  const myRegs = await Registration.find({
    $or: [{ "player1.user": userId }, { "player2.user": userId }],
  })
    .select("_id tournament player1 player2")
    .lean();

  if (!myRegs.length) return res.json({ items: [], total: 0, page, limit });

  const myRegIds = myRegs.map((r) => r._id);

  // 2) Lấy các trận của mình và đã kết thúc
  const matchFilter = {
    $and: [
      { $or: [{ pairA: { $in: myRegIds } }, { pairB: { $in: myRegIds } }] },
      { status: "finished" },
    ],
  };

  const [total, matches] = await Promise.all([
    Match.countDocuments(matchFilter),
    Match.find(matchFilter)
      .sort({ finishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "_id code displayCode codeResolved globalCode matchCode bracketCode slotCode roundCode labelKey meta tournament bracket pairA pairB gameScores winner finishedAt scheduledAt round order status video branch phase format pool group groupCode groupNo groupIndex rrRound globalRound stageIndex matchNo index"
      )
      .populate("tournament", "name eventType _id")
      .populate("bracket", "type stage order _id createdAt meta drawRounds config")
      .lean(),
  ]);

  if (!matches.length) return res.json({ items: [], total, page, limit });

  // 🔧 Gom tất cả pair ids để nạp registrations tương ứng
  const allPairIds = [];
  for (const m of matches) {
    if (m.pairA) allPairIds.push(String(m.pairA));
    if (m.pairB) allPairIds.push(String(m.pairB));
  }
  const uniqPairIds = [...new Set(allPairIds)];

  const allRegs = await Registration.find({ _id: { $in: uniqPairIds } })
    .select("_id player1 player2")
    .lean();
  const regById = new Map(allRegs.map((r) => [String(r._id), r]));

  // 3) Gom userIds để lấy lịch sử điểm + hồ sơ (để có nickname)
  const allUserIds = new Set();
  for (const r of allRegs) {
    if (r?.player1?.user) allUserIds.add(String(r.player1.user));
    if (r?.player2?.user) allUserIds.add(String(r.player2.user));
  }

  const histRows = await ScoreHistory.find({ user: { $in: [...allUserIds] } })
    .sort({ scoredAt: 1, _id: 1 })
    .select("user single double scoredAt")
    .lean();

  const histMap = buildHistMap(histRows, isHiddenInfo);

  const matchIds = matches.map((m) => m._id).filter(Boolean);
  const ratingChanges = matchIds.length
    ? await RatingChange.find({
        match: { $in: matchIds },
        revoked: { $ne: true },
      })
        .select("user match kind before after delta")
        .lean()
    : [];
  const ratingChangeByMatchUserKind = new Map();
  for (const row of ratingChanges) {
    const mapKey = `${row.match}|${row.user}|${row.kind}`;
    ratingChangeByMatchUserKind.set(mapKey, row);
  }

  // ★ NEW: nạp Users để lấy nickname/avatar (ưu tiên nickname)
  const users = await User.find({ _id: { $in: [...allUserIds] } })
    .select("_id nickname nickName nick_name avatar name fullName")
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  function attachNick(p, base) {
    if (isHiddenInfo && String(base?._id) !== String(req.user?._id)) {
      if ('preScore' in base) base.preScore = null;
      if ('postScore' in base) base.postScore = null;
    }
    const u = userById.get(String(p?.user));
    const nickname =
      u?.nickname ||
      u?.nickName ||
      u?.nick_name ||
      p?.nickname ||
      p?.nickName ||
      p?.nick_name ||
      base?.nickname ||
      base?.name ||
      base?.fullName ||
      "N/A";
    const avatar = u?.avatar || p?.avatar || base?.avatar || "";
    return { ...base, nickname, avatar };
  }

  /* ==========================================================
     NEW: TÍNH "R" TOÀN GIẢI (cộng dồn qua các bracket theo stage)
  ========================================================== */

  // ✅ FIX: chỉ tính các tournament là ObjectId hợp lệ
  const tournamentIds = [
    ...new Set(
      matches
        .map((m) => m?.tournament?._id || m?.tournament)
        .filter((id) => isOID(id))
        .map((id) => String(id))
    ),
  ];

  const isGroupLikeBracket = (bracket) => {
    const type = String(bracket?.type || "").toLowerCase();
    return (
      isGroupishBracketType(type) ||
      type.includes("group") ||
      type.includes("roundrobin") ||
      type.includes("round-robin")
    );
  };

  // Nạp toàn bộ bracket của mỗi tournament
  const bracketsByTournament = new Map(); // tId -> [brackets]
  for (const tId of tournamentIds) {
    const bks = await Bracket.find({ tournament: tId }) // tId đã chắc chắn hợp lệ
      .select("_id type stage order createdAt meta drawRounds config")
      .lean();
    bks.sort((a, b) => {
      const sa = Number(a.stage ?? 0);
      const sb = Number(b.stage ?? 0);
      if (sa !== sb) return sa - sb;
      const ca = new Date(a.createdAt || 0).getTime();
      const cb = new Date(b.createdAt || 0).getTime();
      if (ca !== cb) return ca - cb;
      return String(a._id).localeCompare(String(b._id));
    });
    bracketsByTournament.set(String(tId), bks);
  }

  // Nạp rounds thực tế theo bracket trong từng tournament
  const roundsCountMapByTournament = new Map(); // tId -> Map(brId -> count)
  for (const tId of tournamentIds) {
    const tMatches = await Match.find({ tournament: tId })
      .select("bracket round")
      .lean();
    const map = new Map();
    for (const tm of tMatches) {
      // ✅ FIX: bỏ bracket không hợp lệ (null/"null"/rỗng)
      if (!isOID(tm?.bracket)) continue;
      const brId = String(tm.bracket);
      const r = Number(tm.round ?? 1);
      if (!map.has(brId)) map.set(brId, new Set());
      map.get(brId).add(r);
    }
    // chuyển Set -> count
    const countMap = new Map();
    const bks = bracketsByTournament.get(String(tId)) || [];
    for (const b of bks) {
      const brId = String(b._id);
      if (isGroupLikeBracket(b)) {
        countMap.set(brId, 1);
      } else {
        const c = map.get(brId)?.size || 0;
        countMap.set(brId, Math.max(1, c));
      }
    }
    roundsCountMapByTournament.set(String(tId), countMap);
  }

  // Tính baseStart (R bắt đầu) cho từng bracket
  const baseStartByTournament = new Map(); // tId -> Map(brId -> baseStart)
  for (const tId of tournamentIds) {
    const bks = bracketsByTournament.get(String(tId)) || [];
    const cntMap = roundsCountMapByTournament.get(String(tId)) || new Map();
    const baseMap = new Map();
    const buckets = [];
    const groupBrackets = bks.filter((b) => isGroupLikeBracket(b));
    const nonGroupBrackets = bks.filter((b) => !isGroupLikeBracket(b));

    if (groupBrackets.length) {
      buckets.push({
        sortStage: 0,
        sortOrder: Math.min(
          ...groupBrackets.map((b) => Number(b?.order ?? 0)),
        ),
        spanRounds: 1,
        brackets: groupBrackets,
      });
    }

    const nonGroupByStage = new Map();
    for (const b of nonGroupBrackets) {
      const stageKey = Number.isFinite(Number(b?.stage)) ? Number(b.stage) : 9999;
      const list = nonGroupByStage.get(stageKey) || [];
      list.push(b);
      nonGroupByStage.set(stageKey, list);
    }

    for (const [stageKey, stageBrackets] of nonGroupByStage.entries()) {
      const spanRounds = stageBrackets.reduce(
        (sum, b) => sum + (cntMap.get(String(b._id)) || 1),
        0,
      );
      buckets.push({
        sortStage: stageKey,
        sortOrder: Math.min(
          ...stageBrackets.map((b) => Number(b?.order ?? 0)),
        ),
        spanRounds: Math.max(1, spanRounds),
        brackets: stageBrackets,
      });
    }

    buckets.sort((a, b) => {
      if (a.sortStage !== b.sortStage) return a.sortStage - b.sortStage;
      return a.sortOrder - b.sortOrder;
    });

    let acc = 0;
    for (const bucket of buckets) {
      for (const b of bucket.brackets) {
        baseMap.set(String(b._id), acc + 1);
      }
      acc += bucket.spanRounds;
    }
    baseStartByTournament.set(String(tId), baseMap);
  }

  // Helper build mã trận mới: R{globalRound}-T{order+1}
  const baseByTournament = new Map();
  for (const [tId, baseStartMap] of baseStartByTournament.entries()) {
    const baseMap = new Map();
    for (const [brId, baseStart] of baseStartMap.entries()) {
      baseMap.set(brId, Math.max(0, Number(baseStart || 1) - 1));
    }
    baseByTournament.set(tId, baseMap);
  }

  const matchesByBracketId = new Map();
  for (const m of matches) {
    const bracketId = String(m?.bracket?._id || m?.bracket || "");
    if (!bracketId) continue;
    if (!matchesByBracketId.has(bracketId)) {
      matchesByBracketId.set(bracketId, []);
    }
    matchesByBracketId.get(bracketId).push(m);
  }

  const buildGlobalRCode = (m) => {
    const tRaw = m?.tournament?._id || m?.tournament;
    const bRaw = m?.bracket?._id || m?.bracket;
    const codePayload = buildMatchCodePayload(m, {
      baseByBracketId: isOID(tRaw)
        ? baseByTournament.get(String(tRaw)) || new Map()
        : new Map(),
      matchesByBracketId,
      preferComputed: true,
    });
    const displayCode = String(
      codePayload?.displayCode || codePayload?.code || "",
    ).trim();
    if (displayCode) return displayCode;

    // ✅ FIX: fallback an toàn nếu thiếu tournament/bracket
    if (!isOID(tRaw) || !isOID(bRaw)) {
      const tIndex = Number.isFinite(Number(m.order))
        ? Number(m.order) + 1
        : "?";
      return `V?-T${tIndex}`;
    }

    const tId = String(tRaw);
    const brId = String(bRaw);
    const baseMap = baseStartByTournament.get(tId);
    const base = baseMap?.get(brId) ?? 1;

    const localRound = Number(m.round ?? 1);
    const globalRound =
      base + (Number.isFinite(localRound) ? localRound - 1 : 0);
    const tIndex = Number.isFinite(Number(m.order)) ? Number(m.order) + 1 : "?";

    return `V${globalRound}-T${tIndex}`;
  };

  // 4) Build kết quả cho FE
  const out = matches.map((m) => {
    const tour = m.tournament || {};
    const typeKey = tour.eventType === "single" ? "single" : "double";
    const ratingKind = typeKey === "single" ? "singles" : "doubles";
    const when =
      (m.finishedAt && new Date(m.finishedAt).getTime()) ||
      (m.scheduledAt && new Date(m.scheduledAt).getTime()) ||
      Date.now();

    const regA = regById.get(String(m.pairA));
    const regB = regById.get(String(m.pairB));
    const profileRatingChange = ratingChangeByMatchUserKind.get(
      `${m._id}|${userId}|${ratingKind}`
    );
    const ratingAdjustable = Boolean(
      profileRatingChange && regA && regB && hasPlayableScore(m)
    );

    const decorateForMatch = (p) => {
      const userId = p?.user ? String(p.user) : "";
      const ratingChange = ratingChangeByMatchUserKind.get(
        `${m._id}|${userId}|${ratingKind}`
      );
      const base = ratingChange
        ? decoratePlayer(p, histMap, when, typeKey)
        : decorateUnchangedPlayer(p, histMap, when, typeKey);
      return attachNick(p, applyRatingChangeToPlayer(base, ratingChange));
    };

    const team1 = [regA?.player1, regA?.player2]
      .filter(Boolean)
      .map(decorateForMatch);
    const team2 = [regB?.player1, regB?.player2]
      .filter(Boolean)
      .map(decorateForMatch);

    const code = buildGlobalRCode(m);

    return {
      _id: m._id,
      code,
      displayCode: code,
      codeResolved: code,
      dateTime: m.finishedAt || m.scheduledAt || null,
      tournament: { id: tour?._id, name: tour?.name || "" },
      ratingKind,
      ratingKey: typeKey,
      ratingAdjustable,
      team1,
      team2,
      scoreText: buildScoreText(m.gameScores) || "—",
      winner: m.winner || "",
      video: m.video || "",
    };
  });

  // >>> Trả về theo phân trang (GIỮ NGUYÊN)
  return res.json({ items: out, total, page, limit });
});
