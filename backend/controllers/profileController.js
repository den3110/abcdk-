// controllers/profileController.js
import asyncHandler from "express-async-handler";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";

/**
 * GET /api/score-history/:id?page=1
 * Trả về lịch sử chấm điểm của một user (id = VĐV)
 * Mặc định pageSize = 10; nếu không cần phân trang, bỏ toàn bộ phần `page/pageSize`.
 */
export const getRatingHistory = asyncHandler(async (req, res) => {
  const pageSize = 10;
  const page = Number(req.query.page) || 1;

  const filter = { user: req.params.id };
  const total = await ScoreHistory.countDocuments(filter);

  const list = await ScoreHistory.find(filter)
    .sort({ scoredAt: -1 }) // mới nhất trước
    .skip(pageSize * (page - 1))
    .limit(pageSize)
    .select("scoredAt single double note") // trường mong muốn
    .populate("scorer", "name email"); // nếu muốn biết ai chấm

  res.json({ history: list, total, pageSize });
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

  // >>> phân trang (KHÔNG đổi logic xử lý)
  const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit ?? "20", 10))
  );
  const sliceRange = (arr) => {
    const start = (page - 1) * limit;
    return arr.slice(start, start + limit);
  };

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
      "_id code tournament pairA pairB gameScores winner finishedAt scheduledAt round order status video"
    ) // video đang dùng ở FE
    .populate("tournament", "name eventType _id")
    .lean();

  if (!matches.length) return res.json({ items: [], total: 0, page, limit });

  // 🔧 gom tất cả pair ids xuất hiện trong các trận rồi nạp registrations tương ứng
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
    .sort({ scoredAt: 1, _id: 1 }) // tăng dần để tìm pre/post theo thời điểm
    .select("user single double scoredAt")
    .lean();

  const histMap = buildHistMap(histRows);

  // ★ NEW: nạp Users để lấy nickname/avatar (ưu tiên nickname)
  const users = await User.find({ _id: { $in: [...allUserIds] } })
    .select("_id nickname nickName nick_name avatar name fullName")
    .lean(); // có thể chỉ cần nickname + avatar
  const userById = new Map(users.map((u) => [String(u._id), u])); // ★ NEW

  // ★ NEW: helper chuẩn hóa nickname/ avatar và ghi đè lên base
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
    return {
      ...base,
      // đảm bảo FE đọc trường nickname
      nickname,
      avatar,
      // nếu muốn tránh lộ họ tên trên FE, có thể clear:
      // name: undefined,
      // fullName: undefined,
    };
  }

  // 4) Build kết quả cho FE (GIỮ NGUYÊN logic điểm), chỉ thêm bước attachNick
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
      .map((p) => attachNick(p, decoratePlayer(p, histMap, when, typeKey))); // ★ NEW
    const team2 = [regB?.player1, regB?.player2]
      .filter(Boolean)
      .map((p) => attachNick(p, decoratePlayer(p, histMap, when, typeKey))); // ★ NEW

    const fallbackCode = `V${m.round ?? "?"}-B${m.order ?? "?"}`;
    const code = m.code || fallbackCode;

    return {
      _id: m._id,
      code,
      dateTime: m.finishedAt || m.scheduledAt || null,
      tournament: { id: tour?._id, name: tour?.name || "" },
      team1,
      team2,
      scoreText: buildScoreText(m.gameScores) || "—",
      winner: m.winner || "", // "A" | "B" | ""
      video: m.video || "",
    };
  });

  // >>> trả về theo phân trang
  const total = out.length;
  const items = sliceRange(out);
  return res.json({ items, total, page, limit });
});
