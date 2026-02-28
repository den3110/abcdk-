import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Ranking from "../models/rankingModel.js";
import Registration from "../models/registrationModel.js"; // (không dùng trực tiếp trong pipeline, chỉ để tham khảo)
import Match from "../models/matchModel.js"; // (không dùng trực tiếp)
import Tournament from "../models/tournamentModel.js"; // (không dùng trực tiếp)
import Assessment from "../models/assessmentModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Bracket from "../models/bracketModel.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";
import RankingSearchQuota from "../models/rankingSearchQuotaModel.js";
/* GET điểm kèm user (dùng trong danh sách) */ // Admin
/* GET điểm kèm user (dùng trong danh sách) */ // Admin
export const getUsersWithRank = asyncHandler(async (req, res) => {
  const parseIntOr = (v, d) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };
  const pageSize = Math.min(
    100,
    Math.max(1, parseIntOr(req.query?.pageSize, 10)),
  );
  const page = Math.max(Number(req.query.page) || 1, 1);

  // ── Build keyword filter: name + nickname + phone + email + cccd (+ domain suffix)
  const kw = (req.query.keyword || "").trim();
  const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = kw ? new RegExp(escapeRegex(kw), "i") : null;

  const conds = [];

  if (kw) {
    const orList = [
      { name: rx },
      { nickname: rx },
      { phone: rx },
      { email: rx },
    ];

    // --- Search theo CCCD ---
    // Nếu keyword toàn số: ưu tiên match prefix CCCD (hợp với tìm theo 6/12 số đầu)
    if (/^\d+$/.test(kw)) {
      orList.push({
        cccd: {
          $regex: "^" + escapeRegex(kw),
          $options: "i",
        },
      });
    } else {
      // fallback: cho phép gõ lẫn chữ, vẫn check chứa trong cccd (hầu như không dùng, nhưng an toàn)
      orList.push({ cccd: rx });
    }

    // --- Search theo domain email (@gmail, @yahoo, ...) ---
    if (kw.startsWith("@")) {
      const domain = kw.slice(1).trim();
      if (domain) {
        const rxDomainSuffix = new RegExp(`@${escapeRegex(domain)}$`, "i");
        orList.push({ email: rxDomainSuffix });
      }
    }

    conds.push({ $or: orList });
  }

  // ── role filter
  if (req.query.role) {
    conds.push({ role: req.query.role });
  }

  // ── cccdStatus filter
  const rawStatus = (req.query.cccdStatus || "").trim();
  const ALLOWED = new Set(["unverified", "pending", "verified", "rejected"]);
  if (ALLOWED.has(rawStatus)) {
    if (rawStatus === "unverified") {
      conds.push({
        $or: [{ cccdStatus: { $exists: false } }, { cccdStatus: "unverified" }],
      });
    } else {
      conds.push({ cccdStatus: rawStatus });
    }
  }

  const filter = conds.length ? { $and: conds } : {};

  // ── tổng số user theo filter
  const total = await User.countDocuments(filter);

  // ── danh sách user trang hiện tại
  const users = await User.find(filter)
    // .sort({ createdAt: -1 })
    .limit(pageSize)
    .skip(pageSize * (page - 1))
    .lean();

  // ── map điểm từ Ranking
  const ids = users
    .map((u) => u?._id)
    .filter((id) => mongoose.isValidObjectId(id));

  let rankMap = {};
  if (ids.length) {
    const ranks = await Ranking.find({ user: { $in: ids } })
      .select("user single double")
      .lean();

    rankMap = ranks.reduce((acc, r) => {
      acc[String(r.user)] = r;
      return acc;
    }, {});
  }

  // ── build absolute URL cho cccdImages ở production
  const isProd = process.env.NODE_ENV === "production";
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const origin = `${proto}://${host}`;

  const isAbsUrl = (s) => /^https?:\/\//i.test(s || "");
  const toAbsUrl = (p) => {
    if (!p) return p;
    if (isAbsUrl(p)) return p;
    return `${origin}${p.startsWith("/") ? "" : "/"}${p}`;
  };

  const list = users.map((u) => {
    const cccdImages = isProd
      ? {
          front: toAbsUrl(u?.cccdImages?.front || ""),
          back: toAbsUrl(u?.cccdImages?.back || ""),
        }
      : u?.cccdImages || { front: "", back: "" };

    return {
      ...u,
      cccdImages,
      single: rankMap[String(u._id)]?.single ?? 0,
      double: rankMap[String(u._id)]?.double ?? 0,
    };
  });

  res.json({ users: list, total, pageSize });
});

export const adminUpdateRanking = asyncHandler(async (req, res) => {
  const { single, double } = req.body;
  const { id: userId } = req.params;

  // 1) Validate
  if (single == null || double == null) {
    res.status(400);
    throw new Error("Thiếu điểm");
  }
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }

  const sSingle = Number(single);
  const sDouble = Number(double);
  if (!Number.isFinite(sSingle) || !Number.isFinite(sDouble)) {
    res.status(400);
    throw new Error("Điểm không hợp lệ");
  }

  // 2) User tồn tại?
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  // 3) Cập nhật/Upsert Ranking (with hasStaffAssessment sync)
  const rank = await Ranking.findOneAndUpdate(
    { user: userId },
    {
      $set: {
        single: sSingle,
        double: sDouble,
        updatedAt: new Date(),
        hasStaffAssessment: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Recalculate tier after setting hasStaffAssessment
  if (rank) {
    rank.recalculateTier();
    await rank.save();
  }

  // 4) Nếu CHƯA từng có "tự chấm", tạo một bản tự chấm (admin hỗ trợ)
  const hasSelfAssessment = await Assessment.exists({
    user: userId,
    "meta.selfScored": true,
  });

  let createdSelfAssessment = false;
  if (!hasSelfAssessment) {
    await Assessment.create({
      user: userId,
      scorer: req.user?._id || null, // ai chấm (admin)
      items: [], // items không bắt buộc
      singleScore: sSingle, // snapshot thời điểm này
      doubleScore: sDouble,
      // singleLevel/doubleLevel: tuỳ bạn có map từ DUPR không, tạm để trống
      meta: {
        selfScored: true, // ❗ cờ tự chấm nằm trong meta
        // các field khác giữ default: freq=0, competed=false, external=0
      },
      note: "Tự chấm trình (admin hỗ trợ)",
      scoredAt: new Date(),
    });
    createdSelfAssessment = true;
  }

  // 5) Ghi lịch sử
  const note = createdSelfAssessment
    ? "Admin chấm điểm và tạo tự chấm (admin hỗ trợ)"
    : "Admin chấm điểm trình";

  await ScoreHistory.create({
    user: userId,
    scorer: req.user?._id || null,
    single: sSingle,
    double: sDouble,
    note,
    scoredAt: new Date(),
  });

  // 6) Trả kết quả
  res.json({
    message: createdSelfAssessment
      ? "Đã cập nhật điểm và tạo tự chấm (admin hỗ trợ)"
      : "Đã cập nhật điểm",
    user: userId,
    single: rank.single,
    double: rank.double,
    createdSelfAssessment,
  });
});

export async function getLeaderboard(req, res) {
  const list = await Ranking.aggregate([
    { $match: { isHiddenFromRankings: { $ne: true } } },
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          { $sort: { scoredAt: -1 } },
          { $limit: 1 },
          { $project: { scorer: 1, "meta.selfScored": 1 } },
        ],
        as: "latest",
      },
    },
    { $addFields: { latest: { $arrayElemAt: ["$latest", 0] } } },
    {
      $addFields: {
        isSelfScoredLatest: {
          $cond: [
            {
              $or: [
                { $eq: ["$latest.meta.selfScored", true] },
                { $eq: ["$latest.scorer", "$user"] },
              ],
            },
            true,
            false,
          ],
        },
      },
    },
    // sort theo yêu cầu: reputation trước, rồi points, rồi điểm
    {
      $sort: {
        reputation: -1,
        double: -1,
        single: -1,
        points: -1,
        lastUpdated: -1,
      },
    },
    {
      $project: {
        user: 1,
        single: 1,
        double: 1,
        points: 1,
        reputation: 1,
        isSelfScoredLatest: 1,
        lastUpdated: 1,
      },
    },
  ]);
  res.json(list);
}

/* ============================ small helpers ============================ */
const isOID = (x) => !!x && mongoose.isValidObjectId(x);
const toNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const uniq = (arr) => [...new Set(arr.map(String))];
const norm = (s) => String(s ?? "").toLowerCase();
const nowUtc = () => new Date();

/** escape regex for keyword */
const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripSpaces = (s = "") => s.replace(/\s+/g, "");
const digitsOnly = (s = "") => s.replace(/\D+/g, "");

/** Map regIds -> userIds (player1.user / player2.user / users[] / members[].user)  */
async function mapRegToUsers(regIds) {
  if (!Array.isArray(regIds) || regIds.length === 0) return new Map();
  const regs = await Registration.find(
    { _id: { $in: regIds.filter(isOID) } },
    { "player1.user": 1, "player2.user": 1, users: 1, members: 1 },
  ).lean();

  const out = new Map();
  for (const r of regs) {
    const set = new Set();
    const add = (u) => isOID(u) && set.add(String(u));
    add(r?.player1?.user);
    add(r?.player2?.user);
    Array.isArray(r?.users) && r.users.forEach(add);
    Array.isArray(r?.members) && r.members.forEach((m) => add(m?.user));
    out.set(String(r._id), [...set]);
  }
  return out;
}

/* ========================= podium from KO bracket ========================= */

/**
 * Lấy KO bracket cuối cùng của 1 giải
 * Ưu tiên stage/order mới nhất; fallback updatedAt/_id
 */
async function findLastKoBracketForTournament(tournamentId) {
  return Bracket.findOne({
    tournament: tournamentId,
    type: { $in: ["knockout", "roundElim"] },
  })
    .sort({ stage: -1, order: -1, updatedAt: -1, _id: -1 })
    .select({
      _id: 1,
      type: 1,
      stage: 1,
      order: 1,
      "meta.maxRounds": 1,
      drawRounds: 1,
    })
    .lean();
}

/**
 * Tính podium (regIds) từ KO bracket
 * - vàng/bạc từ chung kết
 * - đồng hạng 3: ưu tiên trận "consol" (winner), nếu không có thì lấy 2 đội thua bán kết
 */
async function computeKoPodiumRegIdsForBracket(br) {
  const podium = { goldReg: null, silverReg: null, bronzeRegs: [] };
  if (!br?._id) return podium;

  // Toàn bộ match FINISHED trong KO bracket này
  const matches = await Match.find(
    { bracket: br._id, status: "finished" },
    {
      _id: 1,
      round: 1,
      order: 1,
      branch: 1,
      winner: 1, // "A" | "B"
      pairA: 1,
      pairB: 1,
      updatedAt: 1,
    },
  ).lean();

  if (!matches.length) return podium;

  // Tìm maxRound
  const maxRoundFromMeta = toNum(br?.meta?.maxRounds) ?? toNum(br?.drawRounds);
  const maxRoundFromData = Math.max(
    0,
    ...matches.map((m) => toNum(m.round) ?? 0),
  );
  const maxRound = Math.max(maxRoundFromMeta ?? 0, maxRoundFromData);
  if (!maxRound || maxRound < 1) return podium;

  // Chung kết = round = maxRound (lấy trận cập nhật mới nhất)
  const finals = matches
    .filter((m) => (toNum(m.round) ?? 0) === maxRound)
    .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));
  const final = finals.at(-1);
  if (!final || (final.winner !== "A" && final.winner !== "B")) return podium;

  const goldReg = final.winner === "A" ? final.pairA : final.pairB;
  const silverReg = final.winner === "A" ? final.pairB : final.pairA;

  // Đồng hạng 3:
  //  - Ưu tiên trận branch="consol" (winner lấy Bronze)
  //  - Nếu không có, lấy 2 đội thua bán kết (round = maxRound - 1)
  let bronzeRegs = [];
  const consol = matches
    .filter(
      (m) =>
        norm(m.branch) === "consol" && (toNum(m.round) ?? 0) >= maxRound - 1,
    )
    .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))
    .at(-1);

  if (consol && (consol.winner === "A" || consol.winner === "B")) {
    bronzeRegs.push(consol.winner === "A" ? consol.pairA : consol.pairB);
  } else {
    const semis = matches.filter((m) => (toNum(m.round) ?? 0) === maxRound - 1);
    for (const sm of semis) {
      if (sm.winner === "A" || sm.winner === "B") {
        const loserReg = sm.winner === "A" ? sm.pairB : sm.pairA;
        bronzeRegs.push(loserReg);
      }
    }
  }

  podium.goldReg = goldReg || null;
  podium.silverReg = silverReg || null;
  podium.bronzeRegs = uniq(bronzeRegs.filter(Boolean));
  return podium;
}

/**
 * Gom podium cho các giải đã kết thúc trong N ngày gần đây
 * - Chỉ lấy từ KO bracket cuối của từng giải
 * - Trả về: { podiumMapByUserId, rawList }
 *   - podiumMapByUserId: { [userId]: [{tournamentId,tournamentName,medal,finishedAt}] }
 *   - rawList: mảng achievements (hữu ích để debug/log)
 */
async function buildRecentPodiumsByUser({ days = 30 } = {}) {
  const now = nowUtc();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // 1) Các giải "đã kết thúc" trong 30 ngày
  const tours = await Tournament.find(
    {
      $or: [
        { status: "finished" },
        { finishedAt: { $ne: null } },
        {
          endAt: { $type: "date" },
        },
      ],
    },
    { _id: 1, name: 1, title: 1, finishedAt: 1, endAt: 1 },
  )
    .lean()
    .then((all) =>
      all.filter((t) => {
        const fAt = t.finishedAt || t.endAt;
        const d = fAt ? new Date(fAt) : null;
        return d && d >= start && d <= now;
      }),
    );

  if (!tours.length) {
    return { podiumMapByUserId: {}, rawList: [] };
  }

  // 2) Với mỗi giải, lấy KO bracket cuối → tính podium (regIds)
  const achievementsReg = []; // { tournamentId, tournamentName, finishedAt, medal, regIds: [] }

  for (const t of tours) {
    const tournamentId = t._id;
    const tournamentName = t.name || t.title || "Giải đấu";
    const finishedAt = t.finishedAt || t.endAt || null;

    const br = await findLastKoBracketForTournament(tournamentId);
    if (!br?._id) continue;

    const { goldReg, silverReg, bronzeRegs } =
      await computeKoPodiumRegIdsForBracket(br);

    if (goldReg) {
      achievementsReg.push({
        tournamentId,
        tournamentName,
        finishedAt,
        medal: "gold",
        regIds: [goldReg],
      });
    }
    if (silverReg) {
      achievementsReg.push({
        tournamentId,
        tournamentName,
        finishedAt,
        medal: "silver",
        regIds: [silverReg],
      });
    }
    if (bronzeRegs?.length) {
      achievementsReg.push({
        tournamentId,
        tournamentName,
        finishedAt,
        medal: "bronze",
        regIds: bronzeRegs,
      });
    }
  }

  if (!achievementsReg.length) {
    return { podiumMapByUserId: {}, rawList: [] };
  }

  // 3) Map regIds -> userIds một lần
  const allRegIds = uniq(achievementsReg.flatMap((a) => a.regIds));
  const regToUsers = await mapRegToUsers(allRegIds);

  // 4) Fetch hidden users to exclude them from podiums
  const allUserIds = uniq(Array.from(regToUsers.values()).flat());
  const hiddenRankings = await mongoose
    .model("Ranking")
    .find(
      { user: { $in: allUserIds }, isHiddenFromRankings: true },
      { user: 1 },
    )
    .lean();
  const hiddenUserIds = new Set(hiddenRankings.map((r) => String(r.user)));

  // 5) Bung thành achievements theo user
  const podiumMapByUserId = {};
  for (const a of achievementsReg) {
    for (const rid of a.regIds) {
      const userIds = regToUsers.get(String(rid)) || [];
      for (const uid of userIds) {
        if (hiddenUserIds.has(String(uid))) continue; // Bỏ qua user bị ẩn khỏi bxh
        (podiumMapByUserId[uid] ||= []).push({
          tournamentId: String(a.tournamentId),
          tournamentName: a.tournamentName,
          medal: a.medal,
          finishedAt: a.finishedAt || null,
        });
      }
    }
  }

  return { podiumMapByUserId, rawList: achievementsReg };
}

/* ============================ getRankings API ============================ */
/**
 * Response shape:
 * {
 *   docs: [ ... như cũ ... ],
 *   totalPages: Number,
 *   page: Number,
 *   podiums30d: { [userId]: [{tournamentId, tournamentName, medal, finishedAt}] }
 * }
 */

const getClientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0].trim();
    if (first) return normalizeIp(first);
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return normalizeIp(realIp);
  }

  return normalizeIp(
    req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "",
  );
};

const normalizeIp = (ip) => {
  if (!ip) return "unknown";
  if (ip.startsWith("::ffff:")) return ip.substring(7);
  if (ip === "::1") return "127.0.0.1";
  return ip;
};

const getTodayYMD = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getRemainingResetTimeSeconds = () => {
  const now = new Date();
  // 0h ngày hôm sau (giờ local của server)
  const reset = new Date(now);
  reset.setHours(24, 0, 0, 0); // = 00:00 ngày tiếp theo

  const diffMs = reset.getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / 1000)); // tính ra giây
};

// ❗ Khi đã hết lượt search trong ngày thì chỉ cho xem tối đa 5 trang
const MAX_PAGES_WHEN_QUOTA_EXHAUSTED = 5;

/**
 * Rule:
 * - Guest, IP chưa từng login hôm nay: max 3 lượt (total < 3)
 * - Sau khi IP đã từng login (hasLoggedIn = true):
 *    + Guest: chỉ dùng được đến khi total < 7
 *      (tức <7 thì vẫn search được cho đến khi =7)
 *    + Login: được search đến khi total < 10
 * - Nếu total >= 10: hết sạch, cả guest lẫn login đều không search được nữa
 * - Admin / Trọng tài: bỏ qua quota, không đụng đến model này.
 *
 * Hàm này chỉ được gọi khi user KHÔNG phải admin/referee.
 * @throws tạo lỗi 429 nếu vượt quota.
 */
const enforceRankingSearchLimit = async (
  req,
  { isLoggedIn, loginLimit, isUnlimited } = {},
) => {
  // User không giới hạn & đang đăng nhập => bỏ qua quota luôn
  if (isLoggedIn && isUnlimited) {
    return { remainingTime: null }; // null = không giới hạn
  }

  const ip = getClientIp(req);
  const ymd = getTodayYMD();
  const remainingResetTime = getRemainingResetTimeSeconds();

  const DEFAULT_TOTAL_LIMIT = 5; // mặc định 5 lượt / ngày
  const GUEST_LIMIT_NO_LOGIN = 3; // guest, IP chưa login: 3 lượt
  const totalLimitForGuest = DEFAULT_TOTAL_LIMIT;

  // Limit khi ĐÃ đăng nhập: nếu user có custom thì dùng, không thì default 5
  const totalLimitForLogin =
    typeof loginLimit === "number" && loginLimit > 0
      ? loginLimit
      : DEFAULT_TOTAL_LIMIT;

  let quota = await RankingSearchQuota.findOne({ ip, ymd });
  if (!quota) {
    quota = await RankingSearchQuota.create({
      ip,
      ymd,
      total: 0,
      hasLoggedIn: false,
    });
  }

  const buildError = (msg) => {
    const err = new Error(msg);
    err.statusCode = 429;
    err.remainingResetTime = remainingResetTime;
    err.remainingTime = 0; // ở mode hiện tại thì hết lượt
    return err;
  };

  // ===== CASE: GUEST (chưa đăng nhập) =====
  if (!isLoggedIn) {
    // IP chưa từng login: 3 lượt guest / ngày
    if (!quota.hasLoggedIn) {
      if (quota.total >= GUEST_LIMIT_NO_LOGIN) {
        throw buildError(
          "Bạn đã dùng hết lượt tìm kiếm ở chế độ khách cho hôm nay. Vui lòng đăng nhập tài khoản để tiếp tục tra cứu xếp hạng.",
        );
      }

      quota.total += 1;
      await quota.save();

      const remainingTime = Math.max(0, GUEST_LIMIT_NO_LOGIN - quota.total); // còn bao nhiêu lượt guest hôm nay

      return { remainingTime };
    }

    // IP đã từng login: guest dùng đến khi chạm base 5 lượt / ngày / IP
    if (quota.total >= totalLimitForGuest) {
      throw buildError(
        "Bạn đã dùng hết lượt tìm kiếm ở chế độ khách. Đăng nhập tài khoản để tiếp tục tra cứu xếp hạng nhé.",
      );
    }

    quota.total += 1;
    await quota.save();

    const remainingTime = Math.max(0, totalLimitForGuest - quota.total); // còn bao nhiêu lượt guest hôm nay (sau khi đã từng login)

    return { remainingTime };
  }

  // ===== CASE: ĐÃ ĐĂNG NHẬP =====
  if (quota.total >= totalLimitForLogin) {
    throw buildError(
      "Bạn đã sử dụng hết lượt tìm kiếm hôm nay, vui lòng quay lại vào ngày mai.",
    );
  }

  quota.total += 1;
  quota.hasLoggedIn = true;
  await quota.save();

  const remainingTime = Math.max(0, totalLimitForLogin - quota.total); // còn bao nhiêu lượt khi đang đăng nhập

  return { remainingTime };
};

export const getRankings = asyncHandler(async (req, res) => {
  // ===== Cursor-based pagination =====
  const rawCursor =
    typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? 10, 10)));

  let page = 0;

  if (rawCursor) {
    const payload = decodeCursor(rawCursor);
    if (
      payload &&
      typeof payload.page === "number" &&
      // đảm bảo limit khớp, tránh dùng cursor cũ với limit khác
      (payload.limit === undefined || payload.limit === limit)
    ) {
      page = Math.max(0, payload.page);
    }
  } else {
    // fallback: vẫn hỗ trợ ?page= nếu cần (0-based)
    page = Math.max(0, parseInt(req.query.page ?? 0, 10));
  }

  // ===== keyword =====
  const keywordRaw = String(req.query.keyword ?? "").trim();

  const role = String(req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin" || !!req.user?.isAdmin;
  const isReferee =
    role === "referee" ||
    role === "ref" ||
    role === "umpire" ||
    role === "official";

  // Lấy config limit theo user (nếu có)
  let userSearchLimit = null;
  let isUnlimitedSearch = false;

  if (req.user) {
    if (req.user.rankingSearchUnlimited) {
      isUnlimitedSearch = true;
    }
    if (
      typeof req.user.rankingSearchLimit === "number" &&
      req.user.rankingSearchLimit > 0
    ) {
      userSearchLimit = req.user.rankingSearchLimit; // ví dụ 10, 20, ...
    }
  }

  // ✅ Biến trả ra FE + trạng thái quota
  let remainingTime = null;
  let quotaExhausted = false;
  const isLimitedUser = !isAdmin && !isReferee && !isUnlimitedSearch;

  // Helper nội bộ: check quota đã hết hay chưa (KHÔNG trừ lượt)
  const checkQuotaExhaustedForToday = async () => {
    if (!isLimitedUser) return false;

    const ip = getClientIp(req);
    const ymd = getTodayYMD();
    const quotaDoc = await RankingSearchQuota.findOne({ ip, ymd }).lean();
    if (!quotaDoc) return false;

    const DEFAULT_TOTAL_LIMIT = 5;
    const GUEST_LIMIT_NO_LOGIN = 3;
    const totalLimitForGuest = DEFAULT_TOTAL_LIMIT;
    const totalLimitForLogin =
      typeof userSearchLimit === "number" && userSearchLimit > 0
        ? userSearchLimit
        : DEFAULT_TOTAL_LIMIT;

    if (!req.user) {
      // Guest
      if (!quotaDoc.hasLoggedIn) {
        // IP chưa từng login -> limit guest = 3
        return quotaDoc.total >= GUEST_LIMIT_NO_LOGIN;
      }
      // IP đã từng login -> guest giới hạn theo totalLimitForGuest (mặc định 5)
      return quotaDoc.total >= totalLimitForGuest;
    }

    // Đã đăng nhập
    return quotaDoc.total >= totalLimitForLogin;
  };

  // ====== Quota: chỉ trừ lượt khi CÓ keyword (search) và user bị giới hạn ======
  if (keywordRaw && isLimitedUser) {
    const quotaInfo = await enforceRankingSearchLimit(req, {
      isLoggedIn: !!req.user,
      loginLimit: userSearchLimit,
      isUnlimited: isUnlimitedSearch,
    });
    // Nếu enforce không ném lỗi thì search này được phép
    if (quotaInfo && typeof quotaInfo.remainingTime === "number") {
      remainingTime = quotaInfo.remainingTime;

      // Nếu sau search này remainingTime <= 0 thì coi như đã xài hết quota search trong ngày
      if (remainingTime <= 0) {
        quotaExhausted = true;
      }
    }
  } else if (!keywordRaw) {
    // Không có keyword: chỉ đọc trạng thái quota để biết đã "hết lượt search" hay chưa
    quotaExhausted = await checkQuotaExhaustedForToday();
  }

  // ===== Gate phân trang khi đã hết lượt search =====
  //  - Không ảnh hưởng admin / referee / user unlimited
  //  - Khi quotaExhausted === true:
  //      + cho xem page 0..4 (tức 5 trang đầu)
  //      + từ page >= 5 (trang thứ 6 trở đi) ném lỗi 429 giống hết lượt search
  if (
    isLimitedUser &&
    quotaExhausted &&
    page >= MAX_PAGES_WHEN_QUOTA_EXHAUSTED // 0-based -> 5 = trang thứ 6
  ) {
    const err = new Error(
      "Bạn đã sử dụng hết lượt tìm kiếm hôm nay, và chỉ được xem tối đa 5 trang kết quả. Vui lòng quay lại vào ngày mai.",
    );
    err.statusCode = 429;
    err.remainingTime = 0;
    err.remainingResetTime = getRemainingResetTimeSeconds();
    throw err;
  }

  const isAdminForProjection = isAdmin;

  /* ======= keyword filter -> userIds ======= */
  let userIdsFilter = null;
  if (keywordRaw) {
    const orConds = [];
    const namePattern = keywordRaw
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join(".*");
    if (namePattern) {
      orConds.push({ name: { $regex: namePattern, $options: "i" } });
      orConds.push({ nickname: { $regex: namePattern, $options: "i" } });
    }
    const emailCandidate = stripSpaces(keywordRaw);
    if (emailCandidate.includes("@")) {
      orConds.push({
        email: { $regex: `^${escapeRegExp(emailCandidate)}$`, $options: "i" },
      });
    }
    const phoneDigits = digitsOnly(keywordRaw);
    if (phoneDigits.length >= 9) {
      const phonePattern = `^${phoneDigits.split("").join("\\s*")}$`;
      orConds.push({ phone: { $regex: phonePattern } });
      orConds.push({ cccd: { $regex: phonePattern } });
    }

    if (orConds.length > 0) {
      const rawIds = await User.find({ $or: orConds }, { _id: 1 }).lean();
      const ids = rawIds.map((d) => d?._id).filter((id) => isOID(id));
      if (!ids.length) {
        return res.json({
          docs: [],
          totalPages: 0,
          page,
          podiums30d: {},
          nextCursor: null,
          hasMore: false,
          remainingTime,
        });
      }
      userIdsFilter = ids;
    }
  }

  /* ======= project user theo quyền ======= */
  const baseUserProject = {
    _id: 1,
    nickname: 1,
    gender: 1,
    province: 1,
    avatar: 1,
    verified: 1,
    createdAt: 1,
    cccdStatus: 1,
    dob: 1,
  };
  const adminExtraProject = {
    name: 1,
    email: 1,
    phone: 1,
    cccd: 1,
    cccdImages: 1,
    note: 1,
  };
  const userProject = isAdminForProjection
    ? { ...baseUserProject, ...adminExtraProject }
    : baseUserProject;

  /* ======= aggregate rankings ======= */
  const matchStage = {
    isHiddenFromRankings: { $ne: true },
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  const agg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },
    {
      $facet: {
        total: [
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "u",
              pipeline: [{ $project: { _id: 1 } }],
            },
          },
          { $match: { "u.0": { $exists: true } } },
          { $group: { _id: "$user" } },
          { $count: "n" },
        ],
        docs: [
          {
            $addFields: {
              points: { $ifNull: ["$points", 0] },
              single: { $ifNull: ["$single", 0] },
              double: { $ifNull: ["$double", 0] },
              mix: { $ifNull: ["$mix", 0] },
              reputation: { $ifNull: ["$reputation", 0] },
            },
          },
          { $sort: { user: 1, updatedAt: -1, _id: 1 } },
          { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "user",
              pipeline: [{ $project: userProject }],
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },

          // ===== Số giải đã kết thúc user từng tham gia =====
          {
            $lookup: {
              from: "registrations",
              let: { uid: "$user._id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $or: [
                        { $eq: ["$player1.user", "$$uid"] },
                        { $eq: ["$player2.user", "$$uid"] },
                      ],
                    },
                  },
                },
                {
                  $lookup: {
                    from: "tournaments",
                    localField: "tournament",
                    foreignField: "_id",
                    as: "tour",
                    pipeline: [
                      {
                        $project: {
                          _id: 1,
                          status: 1,
                          finishedAt: 1,
                          endAt: 1,
                        },
                      },
                    ],
                  },
                },
                {
                  $addFields: {
                    status: {
                      $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""],
                    },
                    finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
                    rawEndAt: { $arrayElemAt: ["$tour.endAt", 0] },
                  },
                },
                {
                  $addFields: {
                    endAtDate: {
                      $convert: {
                        input: "$rawEndAt",
                        to: "date",
                        onError: null,
                        onNull: null,
                      },
                    },
                    tourFinished: {
                      $or: [
                        { $eq: ["$status", "finished"] },
                        { $ne: ["$finishedAt", null] },
                        {
                          $and: [
                            { $ne: ["$endAtDate", null] },
                            { $lt: ["$endAtDate", new Date()] },
                          ],
                        },
                      ],
                    },
                  },
                },
                { $match: { tourFinished: true } },
                { $group: { _id: "$tournament" } },
                { $count: "n" },
              ],
              as: "finishedToursCount",
            },
          },
          {
            $addFields: {
              totalTours: {
                $ifNull: [{ $arrayElemAt: ["$finishedToursCount.n", 0] }, 0],
              },
            },
          },

          // ===== Official nếu có Assessment do admin/mod chấm =====
          {
            $lookup: {
              from: "assessments",
              let: { uid: "$user._id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
                {
                  $match: {
                    $expr: {
                      $in: [
                        { $toLower: "$meta.scoreBy" },
                        ["admin", "mod", "moderator"],
                      ],
                    },
                  },
                },
                { $sort: { scoredAt: -1, createdAt: -1, _id: -1 } },
                { $limit: 1 },
                { $project: { _id: 1 } },
              ],
              as: "assess_staff",
            },
          },
          {
            $addFields: {
              hasStaffAssessment: { $gt: [{ $size: "$assess_staff" }, 0] },
            },
          },

          // ======= Điểm xám: 0 điểm & chưa từng tham gia giải =======
          {
            $addFields: {
              zeroPoints: {
                $and: [
                  { $eq: ["$points", 0] },
                  { $eq: ["$single", 0] },
                  { $eq: ["$double", 0] },
                  { $eq: ["$mix", 0] },
                ],
              },
            },
          },
          {
            $addFields: {
              isGrey: { $and: ["$zeroPoints", { $eq: ["$totalTours", 0] }] },
            },
          },

          // ======= Tier/màu với precedence: Grey > Gold > Red > Default =======
          {
            $addFields: {
              // Vàng chỉ khi KHÔNG xám và (đã từng đấu giải KẾT THÚC hoặc có staff assessment)
              isGold: {
                $and: [
                  { $not: ["$isGrey"] },
                  { $or: [{ $gt: ["$totalTours", 0] }, "$hasStaffAssessment"] },
                ],
              },
            },
          },
          {
            $addFields: {
              isRed: {
                $and: [
                  { $eq: ["$totalTours", 0] },
                  { $not: ["$isGold"] },
                  { $not: ["$isGrey"] },
                ],
              },
            },
          },
          {
            $addFields: {
              colorRank: {
                $cond: [
                  "$isGold",
                  0,
                  {
                    $cond: [
                      "$isRed",
                      1,
                      {
                        $cond: ["$isGrey", 2, 3],
                      },
                    ],
                  },
                ],
              },
              tierLabel: {
                $switch: {
                  branches: [
                    { case: "$isGold", then: "Official/Đã duyệt" },
                    { case: "$isRed", then: "Tự chấm" },
                    { case: "$isGrey", then: "0 điểm / Chưa đấu" },
                  ],
                  default: "Chưa có điểm",
                },
              },
              tierColor: {
                $switch: {
                  branches: [
                    { case: "$isGold", then: "yellow" },
                    { case: "$isRed", then: "red" },
                    { case: "$isGrey", then: "grey" },
                  ],
                  default: "grey",
                },
              },
              reputation: { $min: [100, { $multiply: ["$totalTours", 10] }] },
            },
          },

          {
            $sort: {
              colorRank: 1,
              double: -1,
              single: -1,
              points: -1,
              updatedAt: -1,
              _id: 1,
            },
          },
          { $skip: page * limit },
          { $limit: limit },
          {
            $project: {
              user: 1,
              single: 1,
              double: 1,
              mix: 1,
              points: 1,
              updatedAt: 1,
              tierLabel: 1,
              tierColor: 1,
              colorRank: 1,
              totalTours: 1,
              reputation: 1,
            },
          },
        ],
      },
    },
    {
      $project: {
        docs: "$docs",
        total: { $ifNull: [{ $arrayElemAt: ["$total.n", 0] }, 0] },
      },
    },
    { $addFields: { totalPages: { $ceil: { $divide: ["$total", limit] } } } },
  ]);

  const first = agg[0] || { docs: [], totalPages: 0 };

  /* ======= podium 30 ngày (theo user) ======= */
  const { podiumMapByUserId } = await buildRecentPodiumsByUser({ days: 30 });

  const totalPages = first.totalPages || 0; // GIỮ NGUYÊN số trang thật, không cắt

  const hasMore = page + 1 < totalPages;
  const nextCursor = hasMore ? encodeCursor({ page: page + 1, limit }) : null;

  return res.json({
    docs: first.docs || [],
    totalPages,
    page,
    podiums30d: podiumMapByUserId,
    nextCursor,
    hasMore,
    remainingTime,
  });
});

/** Tạo mật khẩu ngẫu nhiên mạnh */
function generatePassword(len = 12) {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const L = "abcdefghijkmnopqrstuvwxyz";
  const D = "23456789";
  const S = "!@#$%^&*()-_=+[]{};:,.?";
  const all = U + L + D + S;

  // đảm bảo đa dạng
  let pwd =
    U[Math.floor(Math.random() * U.length)] +
    L[Math.floor(Math.random() * L.length)] +
    D[Math.floor(Math.random() * D.length)] +
    S[Math.floor(Math.random() * S.length)];

  while (pwd.length < len) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/**
 * POST /api/admin/users
 * Body (JSON):
 * {
 *   name, nickname, phone, email,
 *   password?, // nếu không gửi -> server tự sinh
 *   role="user", verified="pending", gender="unspecified",
 *   province, dob, avatar, cccd, cccdStatus
 * }
 * Trả về: { created: true, user }
 */
export const adminCreateUser = asyncHandler(async (req, res) => {
  const {
    name,
    nickname,
    phone,
    email,
    password,
    role = "user",
    verified = "pending",
    gender = "unspecified",
    province = "",
    dob,
    avatar = "",
    cccd,
    cccdStatus,
  } = req.body || {};

  // Yêu cầu quyền admin (đã kiểm tra ở middleware)
  // Validate cơ bản
  if (role === "user" && !String(nickname || "").trim()) {
    return res.status(400).json({ message: "User phải có nickname." });
  }

  // Chuẩn hoá
  const doc = {
    name: String(name || "").trim(),
    nickname: String(nickname || "").trim() || undefined,
    phone: String(phone || "").trim() || undefined,
    email:
      String(email || "")
        .trim()
        .toLowerCase() || undefined,
    password: String(password || "") || generatePassword(12),
    role,
    verified,
    gender,
    province: String(province || "").trim(),
    avatar: String(avatar || "").trim(),
  };

  if (cccd) doc.cccd = String(cccd).trim();
  if (cccdStatus) doc.cccdStatus = String(cccdStatus).trim();

  if (dob) {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) {
      return res
        .status(400)
        .json({ message: "dob không hợp lệ (yyyy-mm-dd hoặc ISO)." });
    }
    doc.dob = d;
  }

  // Pre-check trùng lặp để trả lỗi thân thiện (tránh đợi Mongo nổ E11000)
  const orConds = [];
  if (doc.email) orConds.push({ email: doc.email });
  if (doc.phone) orConds.push({ phone: doc.phone });
  if (doc.nickname) orConds.push({ nickname: doc.nickname });
  if (doc.cccd) orConds.push({ cccd: doc.cccd });

  if (orConds.length) {
    const existed = await User.findOne({ $or: orConds }).lean();
    if (existed) {
      if (doc.email && existed.email === doc.email)
        return res.status(409).json({ message: "Email đã tồn tại." });
      if (doc.phone && existed.phone === doc.phone)
        return res.status(409).json({ message: "Số điện thoại đã tồn tại." });
      if (doc.nickname && existed.nickname === doc.nickname)
        return res.status(409).json({ message: "Nickname đã tồn tại." });
      if (doc.cccd && existed.cccd === doc.cccd)
        return res.status(409).json({ message: "CCCD đã tồn tại." });
      return res
        .status(409)
        .json({ message: "Thông tin duy nhất đã tồn tại." });
    }
  }

  try {
    const user = await User.create(doc); // sẽ hash password trong pre('save')
    const safe = user.toObject();
    delete safe.password;
    return res.status(201).json({ created: true, user: safe });
  } catch (err) {
    // Bắt E11000 (duplicate key) phòng trường hợp race condition
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || {})[0] || "dupe";
      const map = {
        email: "Email đã tồn tại.",
        phone: "Số điện thoại đã tồn tại.",
        nickname: "Nickname đã tồn tại.",
        cccd: "CCCD đã tồn tại.",
      };
      return res
        .status(409)
        .json({ message: map[key] || "Thông tin duy nhất đã tồn tại." });
    }
    return res
      .status(400)
      .json({ message: err.message || "Tạo user thất bại." });
  }
});

/* ======================================================================
   V2 OPTIMIZED RANKING APIs
   - Uses denormalized fields (totalFinishedTours, hasStaffAssessment, colorRank, tierColor, tierLabel)
   - Pagination BEFORE user lookup for better performance
   ====================================================================== */

/**
 * GET /api/rankings/v2
 * Optimized rankings API using denormalized fields
 */
export const getRankingsV2 = asyncHandler(async (req, res) => {
  const parseIntOr = (v, d) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };
  const limit = Math.min(
    100,
    Math.max(1, parseIntOr(req.query?.pageSize ?? req.query?.limit, 12)),
  );
  const page = Math.max(parseIntOr(req.query?.page, 0), 0);
  const keywordRaw = String(req.query.keyword ?? "").trim();

  // Check if user is admin for extended projection
  const isAdminForProjection =
    req.user?.isAdmin === true ||
    (Array.isArray(req.user?.roles) &&
      req.user.roles.some((r) =>
        ["admin", "mod", "moderator"].includes(String(r).toLowerCase()),
      ));

  const baseUserProject = {
    _id: 1,
    nickname: 1,
    gender: 1,
    province: 1,
    avatar: 1,
    verified: 1,
    createdAt: 1,
    cccdStatus: 1,
    dob: 1,
  };
  const adminExtraProject = {
    name: 1,
    email: 1,
    phone: 1,
    cccd: 1,
    cccdImages: 1,
    note: 1,
  };
  const userProject = isAdminForProjection
    ? { ...baseUserProject, ...adminExtraProject }
    : baseUserProject;

  // Build user filter if keyword provided
  let userIdsFilter = null;
  if (keywordRaw) {
    const orConds = [];
    const namePattern = keywordRaw
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join(".*");
    if (namePattern) {
      orConds.push({ name: { $regex: namePattern, $options: "i" } });
      orConds.push({ nickname: { $regex: namePattern, $options: "i" } });
    }
    const emailCandidate = stripSpaces(keywordRaw);
    if (emailCandidate.includes("@")) {
      orConds.push({
        email: { $regex: `^${escapeRegExp(emailCandidate)}$`, $options: "i" },
      });
    }
    const phoneDigits = digitsOnly(keywordRaw);
    if (phoneDigits.length >= 9) {
      const phonePattern = `^${phoneDigits.split("").join("\\s*")}$`;
      orConds.push({ phone: { $regex: phonePattern } });
      orConds.push({ cccd: { $regex: phonePattern } });
    }

    if (orConds.length > 0) {
      const rawIds = await User.find({ $or: orConds }, { _id: 1 }).lean();
      const ids = rawIds.map((d) => d?._id).filter((id) => isOID(id));
      if (!ids.length) {
        return res.json({
          docs: [],
          totalPages: 0,
          total: 0,
          page,
        });
      }
      userIdsFilter = ids;
    }
  }

  const matchStage = {
    user: { $type: "objectId" },
    isHiddenFromRankings: { $ne: true },
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  // Use $facet for accurate count (excludes deleted users)
  const agg = await Ranking.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "u_chk",
        pipeline: [{ $project: { _id: 1 } }],
      },
    },
    { $match: { "u_chk.0": { $exists: true } } },
    { $project: { u_chk: 0 } },
    {
      $facet: {
        // Count only rankings with existing users
        total: [{ $count: "n" }],
        // Docs pipeline - optimized
        docs: [
          {
            $addFields: {
              points: { $ifNull: ["$points", 0] },
              single: { $ifNull: ["$single", 0] },
              double: { $ifNull: ["$double", 0] },
              mix: { $ifNull: ["$mix", 0] },
              reputation: { $ifNull: ["$reputation", 0] },
              totalTours: { $ifNull: ["$totalFinishedTours", 0] },
              hasStaffAssessment: { $ifNull: ["$hasStaffAssessment", false] },
              colorRank: { $ifNull: ["$colorRank", 2] },
              tierColor: { $ifNull: ["$tierColor", "grey"] },
              tierLabel: { $ifNull: ["$tierLabel", "0 điểm / Chưa đấu"] },
            },
          },
          {
            $sort: {
              colorRank: 1,
              double: -1,
              single: -1,
              points: -1,
              updatedAt: -1,
              _id: 1,
            },
          },
          { $skip: page * limit },
          { $limit: limit },
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "user",
              pipeline: [{ $project: userProject }],
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },
          {
            $project: {
              user: 1,
              single: 1,
              double: 1,
              mix: 1,
              points: 1,
              updatedAt: 1,
              tierLabel: 1,
              tierColor: 1,
              colorRank: 1,
              totalTours: 1,
              reputation: 1,
            },
          },
        ],
      },
    },
    {
      $project: {
        docs: "$docs",
        total: { $ifNull: [{ $arrayElemAt: ["$total.n", 0] }, 0] },
      },
    },
  ]);

  const first = agg[0] || { docs: [], total: 0 };
  const totalPages = Math.ceil(first.total / limit);

  res.json({
    docs: first.docs,
    totalPages,
    total: first.total,
    page,
  });
});

/**
 * GET /api/rankings/rankings/v2
 * Optimized rankings-only API with same validation as original
 */
export const getRankingOnlyV2 = asyncHandler(async (req, res) => {
  // ===== Parse pagination params =====
  const rawCursor =
    typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit ?? req.query.pageSize ?? 12, 10)),
  );

  let page = 0;
  if (rawCursor) {
    const payload = decodeCursor(rawCursor);
    if (
      payload &&
      typeof payload.page === "number" &&
      (payload.limit === undefined || payload.limit === limit)
    ) {
      page = Math.max(0, payload.page);
    }
  } else {
    page = Math.max(0, parseInt(req.query.page ?? 0, 10));
  }

  const keywordRaw = String(req.query.keyword ?? "").trim();

  // ===== Check user roles =====
  const role = String(req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin" || !!req.user?.isAdmin;
  const isReferee =
    role === "referee" ||
    role === "ref" ||
    role === "umpire" ||
    role === "official";

  let userSearchLimit = null;
  let isUnlimitedSearch = false;

  if (req.user) {
    if (req.user.rankingSearchUnlimited) {
      isUnlimitedSearch = true;
    }
    if (
      typeof req.user.rankingSearchLimit === "number" &&
      req.user.rankingSearchLimit > 0
    ) {
      userSearchLimit = req.user.rankingSearchLimit;
    }
  }

  let remainingTime = null;
  let quotaExhausted = false;
  const isLimitedUser = !isAdmin && !isReferee && !isUnlimitedSearch;

  // ===== Quota checking =====
  const checkQuotaExhaustedForToday = async () => {
    if (!isLimitedUser) return false;

    const ip = getClientIp(req);
    const ymd = getTodayYMD();
    const quotaDoc = await RankingSearchQuota.findOne({ ip, ymd }).lean();
    if (!quotaDoc) return false;

    const DEFAULT_TOTAL_LIMIT = 5;
    const GUEST_LIMIT_NO_LOGIN = 3;
    const totalLimitForGuest = DEFAULT_TOTAL_LIMIT;
    const totalLimitForLogin =
      typeof userSearchLimit === "number" && userSearchLimit > 0
        ? userSearchLimit
        : DEFAULT_TOTAL_LIMIT;

    if (!req.user) {
      if (!quotaDoc.hasLoggedIn) {
        return quotaDoc.total >= GUEST_LIMIT_NO_LOGIN;
      }
      return quotaDoc.total >= totalLimitForGuest;
    }

    return quotaDoc.total >= totalLimitForLogin;
  };

  if (keywordRaw && isLimitedUser) {
    const quotaInfo = await enforceRankingSearchLimit(req, {
      isLoggedIn: !!req.user,
      loginLimit: userSearchLimit,
      isUnlimited: isUnlimitedSearch,
    });
    if (quotaInfo && typeof quotaInfo.remainingTime === "number") {
      remainingTime = quotaInfo.remainingTime;
      if (remainingTime <= 0) quotaExhausted = true;
    }
  } else if (!keywordRaw) {
    quotaExhausted = await checkQuotaExhaustedForToday();
  }

  if (
    isLimitedUser &&
    quotaExhausted &&
    page >= MAX_PAGES_WHEN_QUOTA_EXHAUSTED
  ) {
    const err = new Error(
      "Bạn đã sử dụng hết lượt tìm kiếm hôm nay, và chỉ được xem tối đa 5 trang kết quả. Vui lòng quay lại vào ngày mai.",
    );
    err.statusCode = 429;
    err.remainingTime = 0;
    err.remainingResetTime = getRemainingResetTimeSeconds();
    throw err;
  }

  // ===== Admin projection =====
  const isAdminForProjection = isAdmin;

  const baseUserProject = {
    _id: 1,
    nickname: 1,
    gender: 1,
    province: 1,
    avatar: 1,
    verified: 1,
    createdAt: 1,
    cccdStatus: 1,
    dob: 1,
  };
  const adminExtraProject = {
    name: 1,
    email: 1,
    phone: 1,
    cccd: 1,
    cccdImages: 1,
    note: 1,
  };
  const userProject = isAdminForProjection
    ? { ...baseUserProject, ...adminExtraProject }
    : baseUserProject;

  // ===== Build user filter if keyword provided =====
  let userIdsFilter = null;
  if (keywordRaw) {
    const orConds = [];
    const namePattern = keywordRaw
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join(".*");
    if (namePattern) {
      orConds.push({ name: { $regex: namePattern, $options: "i" } });
      orConds.push({ nickname: { $regex: namePattern, $options: "i" } });
    }
    const emailCandidate = stripSpaces(keywordRaw);
    if (emailCandidate.includes("@")) {
      orConds.push({
        email: { $regex: `^${escapeRegExp(emailCandidate)}$`, $options: "i" },
      });
    }
    const phoneDigits = digitsOnly(keywordRaw);
    if (phoneDigits.length >= 9) {
      const phonePattern = `^${phoneDigits.split("").join("\\s*")}$`;
      orConds.push({ phone: { $regex: phonePattern } });
      orConds.push({ cccd: { $regex: phonePattern } });
    }

    if (orConds.length > 0) {
      const rawIds = await User.find({ $or: orConds }, { _id: 1 }).lean();
      const ids = rawIds.map((d) => d?._id).filter((id) => isOID(id));
      if (!ids.length) {
        return res.json({
          docs: [],
          totalPages: 0,
          page,
          nextCursor: null,
          hasMore: false,
          remainingTime,
        });
      }
      userIdsFilter = ids;
    }
  }

  const matchStage = {
    isHiddenFromRankings: { $ne: true },
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  // ===== Optimized aggregation using denormalized fields =====
  const agg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "u_chk",
        pipeline: [{ $project: { _id: 1 } }],
      },
    },
    { $match: { "u_chk.0": { $exists: true } } },
    { $project: { u_chk: 0 } },
    {
      $facet: {
        total: [{ $count: "n" }],
        docs: [
          // Use denormalized fields from Ranking model
          {
            $addFields: {
              points: { $ifNull: ["$points", 0] },
              single: { $ifNull: ["$single", 0] },
              double: { $ifNull: ["$double", 0] },
              mix: { $ifNull: ["$mix", 0] },
              reputation: { $ifNull: ["$reputation", 0] },
              totalTours: { $ifNull: ["$totalFinishedTours", 0] },
              hasStaffAssessment: { $ifNull: ["$hasStaffAssessment", false] },
              colorRank: { $ifNull: ["$colorRank", 2] },
              tierColor: { $ifNull: ["$tierColor", "grey"] },
              tierLabel: { $ifNull: ["$tierLabel", "0 điểm / Chưa đấu"] },
            },
          },
          {
            $sort: {
              colorRank: 1,
              double: -1,
              single: -1,
              points: -1,
              updatedAt: -1,
              _id: 1,
            },
          },
          { $skip: page * limit },
          { $limit: limit },
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "user",
              pipeline: [{ $project: userProject }],
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },
          {
            $project: {
              user: 1,
              single: 1,
              double: 1,
              mix: 1,
              points: 1,
              updatedAt: 1,
              tierLabel: 1,
              tierColor: 1,
              colorRank: 1,
              totalTours: 1,
              reputation: 1,
            },
          },
        ],
      },
    },
    {
      $project: {
        docs: "$docs",
        total: { $ifNull: [{ $arrayElemAt: ["$total.n", 0] }, 0] },
      },
    },
    { $addFields: { totalPages: { $ceil: { $divide: ["$total", limit] } } } },
  ]);

  const first = agg[0] || { docs: [], totalPages: 0 };
  const totalPages = first.totalPages || 0;

  const hasMore = page + 1 < totalPages;
  const nextCursor = hasMore ? encodeCursor({ page: page + 1, limit }) : null;

  return res.json({
    docs: first.docs || [],
    totalPages,
    page,
    nextCursor,
    hasMore,
    remainingTime,
  });
});

/* ============================ ✅ NEW: ranking-only (giữ nguyên getRankings, thêm controller mới) ============================ */
export const getRankingOnly = asyncHandler(async (req, res) => {
  // Copy y nguyên getRankings, chỉ bỏ phần buildRecentPodiumsByUser + field podiums30d trong response

  // ===== Cursor-based pagination =====
  const rawCursor =
    typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? 12, 12)));

  let page = 0;

  if (rawCursor) {
    const payload = decodeCursor(rawCursor);
    if (
      payload &&
      typeof payload.page === "number" &&
      (payload.limit === undefined || payload.limit === limit)
    ) {
      page = Math.max(0, payload.page);
    }
  } else {
    page = Math.max(0, parseInt(req.query.page ?? 0, 12));
  }

  const keywordRaw = String(req.query.keyword ?? "").trim();

  const role = String(req.user?.role || "").toLowerCase();
  const isAdmin = role === "admin" || !!req.user?.isAdmin;
  const isReferee =
    role === "referee" ||
    role === "ref" ||
    role === "umpire" ||
    role === "official";

  let userSearchLimit = null;
  let isUnlimitedSearch = false;

  if (req.user) {
    if (req.user.rankingSearchUnlimited) {
      isUnlimitedSearch = true;
    }
    if (
      typeof req.user.rankingSearchLimit === "number" &&
      req.user.rankingSearchLimit > 0
    ) {
      userSearchLimit = req.user.rankingSearchLimit;
    }
  }

  let remainingTime = null;
  let quotaExhausted = false;
  const isLimitedUser = !isAdmin && !isReferee && !isUnlimitedSearch;

  const checkQuotaExhaustedForToday = async () => {
    if (!isLimitedUser) return false;

    const ip = getClientIp(req);
    const ymd = getTodayYMD();
    const quotaDoc = await RankingSearchQuota.findOne({ ip, ymd }).lean();
    if (!quotaDoc) return false;

    const DEFAULT_TOTAL_LIMIT = 5;
    const GUEST_LIMIT_NO_LOGIN = 3;
    const totalLimitForGuest = DEFAULT_TOTAL_LIMIT;
    const totalLimitForLogin =
      typeof userSearchLimit === "number" && userSearchLimit > 0
        ? userSearchLimit
        : DEFAULT_TOTAL_LIMIT;

    if (!req.user) {
      if (!quotaDoc.hasLoggedIn) {
        return quotaDoc.total >= GUEST_LIMIT_NO_LOGIN;
      }
      return quotaDoc.total >= totalLimitForGuest;
    }

    return quotaDoc.total >= totalLimitForLogin;
  };

  if (keywordRaw && isLimitedUser) {
    const quotaInfo = await enforceRankingSearchLimit(req, {
      isLoggedIn: !!req.user,
      loginLimit: userSearchLimit,
      isUnlimited: isUnlimitedSearch,
    });
    if (quotaInfo && typeof quotaInfo.remainingTime === "number") {
      remainingTime = quotaInfo.remainingTime;
      if (remainingTime <= 0) quotaExhausted = true;
    }
  } else if (!keywordRaw) {
    quotaExhausted = await checkQuotaExhaustedForToday();
  }

  if (
    isLimitedUser &&
    quotaExhausted &&
    page >= MAX_PAGES_WHEN_QUOTA_EXHAUSTED
  ) {
    const err = new Error(
      "Bạn đã sử dụng hết lượt tìm kiếm hôm nay, và chỉ được xem tối đa 5 trang kết quả. Vui lòng quay lại vào ngày mai.",
    );
    err.statusCode = 429;
    err.remainingTime = 0;
    err.remainingResetTime = getRemainingResetTimeSeconds();
    throw err;
  }

  const isAdminForProjection = isAdmin;

  let userIdsFilter = null;
  if (keywordRaw) {
    const orConds = [];
    const namePattern = keywordRaw
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join(".*");
    if (namePattern) {
      orConds.push({ name: { $regex: namePattern, $options: "i" } });
      orConds.push({ nickname: { $regex: namePattern, $options: "i" } });
    }
    const emailCandidate = stripSpaces(keywordRaw);
    if (emailCandidate.includes("@")) {
      orConds.push({
        email: { $regex: `^${escapeRegExp(emailCandidate)}$`, $options: "i" },
      });
    }
    const phoneDigits = digitsOnly(keywordRaw);
    if (phoneDigits.length >= 9) {
      const phonePattern = `^${phoneDigits.split("").join("\\s*")}$`;
      orConds.push({ phone: { $regex: phonePattern } });
      orConds.push({ cccd: { $regex: phonePattern } });
    }

    if (orConds.length > 0) {
      const rawIds = await User.find({ $or: orConds }, { _id: 1 }).lean();
      const ids = rawIds.map((d) => d?._id).filter((id) => isOID(id));
      if (!ids.length) {
        return res.json({
          docs: [],
          totalPages: 0,
          page,
          nextCursor: null,
          hasMore: false,
          remainingTime,
        });
      }
      userIdsFilter = ids;
    }
  }

  const baseUserProject = {
    _id: 1,
    nickname: 1,
    gender: 1,
    province: 1,
    avatar: 1,
    verified: 1,
    createdAt: 1,
    cccdStatus: 1,
    dob: 1,
  };
  const adminExtraProject = {
    name: 1,
    email: 1,
    phone: 1,
    cccd: 1,
    cccdImages: 1,
    note: 1,
  };
  const userProject = isAdminForProjection
    ? { ...baseUserProject, ...adminExtraProject }
    : baseUserProject;

  const matchStage = {
    isHiddenFromRankings: { $ne: true },
    ...(userIdsFilter ? { user: { $in: userIdsFilter } } : {}),
  };

  const agg = await Ranking.aggregate([
    { $match: matchStage },
    { $match: { user: { $type: "objectId" } } },
    {
      $facet: {
        total: [
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "u",
              pipeline: [{ $project: { _id: 1 } }],
            },
          },
          { $match: { "u.0": { $exists: true } } },
          { $group: { _id: "$user" } },
          { $count: "n" },
        ],
        docs: [
          {
            $addFields: {
              points: { $ifNull: ["$points", 0] },
              single: { $ifNull: ["$single", 0] },
              double: { $ifNull: ["$double", 0] },
              mix: { $ifNull: ["$mix", 0] },
              reputation: { $ifNull: ["$reputation", 0] },
            },
          },
          { $sort: { user: 1, updatedAt: -1, _id: 1 } },
          { $group: { _id: "$user", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "user",
              pipeline: [{ $project: userProject }],
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },

          {
            $lookup: {
              from: "registrations",
              let: { uid: "$user._id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $or: [
                        { $eq: ["$player1.user", "$$uid"] },
                        { $eq: ["$player2.user", "$$uid"] },
                      ],
                    },
                  },
                },
                {
                  $lookup: {
                    from: "tournaments",
                    localField: "tournament",
                    foreignField: "_id",
                    as: "tour",
                    pipeline: [
                      {
                        $project: {
                          _id: 1,
                          status: 1,
                          finishedAt: 1,
                          endAt: 1,
                        },
                      },
                    ],
                  },
                },
                {
                  $addFields: {
                    status: {
                      $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""],
                    },
                    finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
                    rawEndAt: { $arrayElemAt: ["$tour.endAt", 0] },
                  },
                },
                {
                  $addFields: {
                    endAtDate: {
                      $convert: {
                        input: "$rawEndAt",
                        to: "date",
                        onError: null,
                        onNull: null,
                      },
                    },
                    tourFinished: {
                      $or: [
                        { $eq: ["$status", "finished"] },
                        { $ne: ["$finishedAt", null] },
                        {
                          $and: [
                            { $ne: ["$endAtDate", null] },
                            { $lt: ["$endAtDate", new Date()] },
                          ],
                        },
                      ],
                    },
                  },
                },
                { $match: { tourFinished: true } },
                { $group: { _id: "$tournament" } },
                { $count: "n" },
              ],
              as: "finishedToursCount",
            },
          },
          {
            $addFields: {
              totalTours: {
                $ifNull: [{ $arrayElemAt: ["$finishedToursCount.n", 0] }, 0],
              },
            },
          },

          {
            $lookup: {
              from: "assessments",
              let: { uid: "$user._id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
                {
                  $match: {
                    $expr: {
                      $in: [
                        { $toLower: "$meta.scoreBy" },
                        ["admin", "mod", "moderator"],
                      ],
                    },
                  },
                },
                { $sort: { scoredAt: -1, createdAt: -1, _id: -1 } },
                { $limit: 1 },
                { $project: { _id: 1 } },
              ],
              as: "assess_staff",
            },
          },
          {
            $addFields: {
              hasStaffAssessment: { $gt: [{ $size: "$assess_staff" }, 0] },
            },
          },

          {
            $addFields: {
              zeroPoints: {
                $and: [
                  { $eq: ["$points", 0] },
                  { $eq: ["$single", 0] },
                  { $eq: ["$double", 0] },
                  { $eq: ["$mix", 0] },
                ],
              },
            },
          },
          {
            $addFields: {
              isGrey: { $and: ["$zeroPoints", { $eq: ["$totalTours", 0] }] },
            },
          },

          {
            $addFields: {
              isGold: {
                $and: [
                  { $not: ["$isGrey"] },
                  { $or: [{ $gt: ["$totalTours", 0] }, "$hasStaffAssessment"] },
                ],
              },
            },
          },
          {
            $addFields: {
              isRed: {
                $and: [
                  { $eq: ["$totalTours", 0] },
                  { $not: ["$isGold"] },
                  { $not: ["$isGrey"] },
                ],
              },
            },
          },
          {
            $addFields: {
              colorRank: {
                $cond: [
                  "$isGold",
                  0,
                  {
                    $cond: [
                      "$isRed",
                      1,
                      {
                        $cond: ["$isGrey", 2, 3],
                      },
                    ],
                  },
                ],
              },
              tierLabel: {
                $switch: {
                  branches: [
                    { case: "$isGold", then: "Official/Đã duyệt" },
                    { case: "$isRed", then: "Tự chấm" },
                    { case: "$isGrey", then: "0 điểm / Chưa đấu" },
                  ],
                  default: "Chưa có điểm",
                },
              },
              tierColor: {
                $switch: {
                  branches: [
                    { case: "$isGold", then: "yellow" },
                    { case: "$isRed", then: "red" },
                    { case: "$isGrey", then: "grey" },
                  ],
                  default: "grey",
                },
              },
              reputation: { $min: [100, { $multiply: ["$totalTours", 10] }] },
            },
          },

          {
            $sort: {
              colorRank: 1,
              double: -1,
              single: -1,
              points: -1,
              updatedAt: -1,
              _id: 1,
            },
          },
          { $skip: page * limit },
          { $limit: limit },
          {
            $project: {
              user: 1,
              single: 1,
              double: 1,
              mix: 1,
              points: 1,
              updatedAt: 1,
              tierLabel: 1,
              tierColor: 1,
              colorRank: 1,
              totalTours: 1,
              reputation: 1,
            },
          },
        ],
      },
    },
    {
      $project: {
        docs: "$docs",
        total: { $ifNull: [{ $arrayElemAt: ["$total.n", 0] }, 0] },
      },
    },
    { $addFields: { totalPages: { $ceil: { $divide: ["$total", limit] } } } },
  ]);

  const first = agg[0] || { docs: [], totalPages: 0 };
  const totalPages = first.totalPages || 0;

  const hasMore = page + 1 < totalPages;
  const nextCursor = hasMore ? encodeCursor({ page: page + 1, limit }) : null;

  return res.json({
    docs: first.docs || [],
    totalPages,
    page,
    nextCursor,
    hasMore,
    remainingTime,
  });
});

/* ============================ ✅ NEW: podium30d-only ============================ */
export const getPodium30d = asyncHandler(async (req, res) => {
  const { podiumMapByUserId } = await buildRecentPodiumsByUser({ days: 30 });
  return res.json({ podiums30d: podiumMapByUserId });
});
