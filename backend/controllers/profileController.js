// controllers/profileController.js
import asyncHandler from "express-async-handler";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import User from "../models/userModel.js";
import mongoose from "mongoose";

/**
 * GET /api/score-history/:id?page=1
 * Trả về lịch sử chấm điểm của một user (id = VĐV)
 * Mặc định pageSize = 10; nếu không cần phân trang, bỏ toàn bộ phần `page/pageSize`.
 */
export const getRatingHistory = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.page) || 1;

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
      .replace(/[\u0300-\u036f]/g, "") // bỏ dấu tiếng Việt
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
    .sort({ scoredAt: -1 })
    .skip(pageSize * (page - 1))
    .limit(pageSize)
    .select("scoredAt single double note scorer user")
    .populate("scorer", "name email")
    .populate("user", "name nickname email avatar")
    .lean();

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
      single: r.single,
      double: r.double,
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

  res.json({ history, total, pageSize, page });
});

/* -------- helpers -------- */

/* -------- helpers -------- */
function buildHistMap(rows) {
  // map[userId] = [{t, single, double}, ...] (đã sort asc theo t)
  const map = {};
  for (const r of rows) {
    const k = String(r.user);
    (map[k] ||= []).push({
      t: new Date(r.scoredAt).getTime(),
      single: r.single,
      double: r.double,
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

function buildScoreText(gameScores = []) {
  if (!Array.isArray(gameScores) || !gameScores.length) return "";
  return gameScores.map((g) => `${g.a ?? 0} - ${g.b ?? 0}`).join(" , ");
}

export const getMatchHistory = asyncHandler(async (req, res) => {
  const userId = String(req.params.id);

  // >>> Phân trang (GIỮ NGUYÊN)
  const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit ?? "1000", 10))
  );
  const sliceRange = (arr) => {
    const start = (page - 1) * limit;
    return arr.slice(start, start + limit);
  };

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
  const matches = await Match.find({
    $and: [
      { $or: [{ pairA: { $in: myRegIds } }, { pairB: { $in: myRegIds } }] },
      { status: "finished" },
    ],
  })
    .sort({ finishedAt: -1, createdAt: -1 })
    .select(
      "_id code tournament bracket pairA pairB gameScores winner finishedAt scheduledAt round order status video"
    )
    .populate("tournament", "name eventType _id")
    .populate("bracket", "type stage _id createdAt")
    .lean();

  if (!matches.length) return res.json({ items: [], total: 0, page, limit });

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

  const histMap = buildHistMap(histRows);

  // ★ NEW: nạp Users để lấy nickname/avatar (ưu tiên nickname)
  const users = await User.find({ _id: { $in: [...allUserIds] } })
    .select("_id nickname nickName nick_name avatar name fullName")
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  function attachNick(p, base) {
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

  // Nạp toàn bộ bracket của mỗi tournament
  const bracketsByTournament = new Map(); // tId -> [brackets]
  for (const tId of tournamentIds) {
    const bks = await Bracket.find({ tournament: tId }) // tId đã chắc chắn hợp lệ
      .select("_id type stage createdAt")
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
      const type = String(b.type || "").toLowerCase();
      if (type === "group") {
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
    let acc = 0;
    for (const b of bks) {
      const brId = String(b._id);
      baseMap.set(brId, acc + 1);
      acc += cntMap.get(brId) || 1;
    }
    baseStartByTournament.set(String(tId), baseMap);
  }

  // Helper build mã trận mới: R{globalRound}-T{order+1}
  const buildGlobalRCode = (m) => {
    const tRaw = m?.tournament?._id || m?.tournament;
    const bRaw = m?.bracket?._id || m?.bracket;

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
    const when =
      (m.finishedAt && new Date(m.finishedAt).getTime()) ||
      (m.scheduledAt && new Date(m.scheduledAt).getTime()) ||
      Date.now();

    const regA = regById.get(String(m.pairA));
    const regB = regById.get(String(m.pairB));

    const team1 = [regA?.player1, regA?.player2]
      .filter(Boolean)
      .map((p) => attachNick(p, decoratePlayer(p, histMap, when, typeKey)));
    const team2 = [regB?.player1, regB?.player2]
      .filter(Boolean)
      .map((p) => attachNick(p, decoratePlayer(p, histMap, when, typeKey)));

    const code = buildGlobalRCode(m);

    return {
      _id: m._id,
      code,
      dateTime: m.finishedAt || m.scheduledAt || null,
      tournament: { id: tour?._id, name: tour?.name || "" },
      team1,
      team2,
      scoreText: buildScoreText(m.gameScores) || "—",
      winner: m.winner || "",
      video: m.video || "",
    };
  });

  // >>> Trả về theo phân trang (GIỮ NGUYÊN)
  const total = out.length;
  const items = sliceRange(out);
  return res.json({ items, total, page, limit });
});
