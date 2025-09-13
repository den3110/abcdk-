// src/controllers/overlayController.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import expressAsyncHandler from "express-async-handler";

// ===== Helpers =====
const gamesToWin = (bestOf) => Math.floor((Number(bestOf) || 3) / 2) + 1;
const gameWon = (x, y, pts, byTwo) =>
  Number(x) >= Number(pts) && (byTwo ? x - y >= 2 : x - y >= 1);

// tính số set thắng mỗi bên
function setWins(gameScores = [], rules) {
  let a = 0,
    b = 0;
  for (const g of gameScores || []) {
    if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo)) a++;
    else if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
      b++;
  }
  return { a, b };
}

// Ưu tiên nickname
const preferNick = (p) =>
  (
    p?.nickname ||
    p?.nickName ||
    p?.shortName ||
    p?.name ||
    p?.fullName ||
    ""
  ).trim();

// Tên fallback theo eventType
function regName(reg, evType) {
  if (!reg) return "—";
  if (evType === "single") return reg?.player1?.fullName || "N/A";
  const a = reg?.player1?.fullName || "N/A";
  const b = reg?.player2?.fullName || "N/A";
  return `${a} & ${b}`;
}

export async function getOverlayMatch(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid match id" });
    }

    const m = await Match.findById(id)
      .populate({ path: "tournament", select: "name eventType image" })
      .populate({
        path: "pairA",
        select: "player1 player2",
        populate: [
          { path: "player1", select: "fullName nickname name shortName" },
          { path: "player2", select: "fullName nickname name shortName" },
        ],
      })
      .populate({
        path: "pairB",
        select: "player1 player2",
        populate: [
          { path: "player1", select: "fullName nickname name shortName" },
          { path: "player2", select: "fullName nickname name shortName" },
        ],
      })
      // lấy thêm thông tin court (có thể thiếu field nào thì Mongoose tự bỏ qua)
      .populate({
        path: "court",
        select: "name number code label zone area venue building floor",
      })
      .lean();

    if (!m) return res.status(404).json({ message: "Match not found" });

    const evType =
      (m?.tournament?.eventType || "").toLowerCase() === "single"
        ? "single"
        : "double";

    const rules = {
      bestOf: Number(m?.rules?.bestOf ?? 3),
      pointsToWin: Number(m?.rules?.pointsToWin ?? 11),
      winByTwo: Boolean(m?.rules?.winByTwo ?? true),
    };

    const { a: setsA, b: setsB } = setWins(m?.gameScores || [], rules);

    const playersFromReg = (reg) => {
      if (!reg) return [];
      return [reg.player1, reg.player2].filter(Boolean).map((p) => ({
        id: String(p?._id || ""),
        nickname: preferNick(p),
        name: p?.fullName || p?.name || "",
      }));
    };

    const teamName = (reg) => {
      const ps = playersFromReg(reg);
      const nick = ps
        .map((x) => x.nickname)
        .filter(Boolean)
        .join(" & ");
      return nick || regName(reg, evType);
    };

    // Chuẩn hóa serve
    const serve =
      m?.serve && (m.serve.side || m.serve.server || m.serve.playerIndex)
        ? m.serve
        : { side: "A", server: 1 };

    // ===== Court (kèm fallback) =====
    const courtId =
      m?.court?._id ||
      m?.courtId || // fallback nếu bạn có lưu courtId riêng trong match
      null;

    const courtNumber =
      m?.court?.number ??
      m?.courtNo ?? // fallback nếu bạn lưu courtNo riêng
      undefined;

    const courtName =
      m?.court?.name ??
      m?.courtName ?? // fallback nếu bạn lưu courtName riêng
      (courtNumber != null ? `Sân ${courtNumber}` : "");

    const courtExtra = {
      code: m?.court?.code || undefined,
      label: m?.court?.label || undefined,
      zone: m?.court?.zone || m?.court?.area || undefined,
      venue: m?.court?.venue || undefined,
      building: m?.court?.building || undefined,
      floor: m?.court?.floor || undefined,
    };

    // Trả về đúng shape mà ScoreOverlay đã dùng + thêm fallback fields
    res.json({
      matchId: String(m._id),
      status: m.status || "",
      winner: m.winner || "",
      tournament: {
        id: m?.tournament?._id || null,
        name: m?.tournament?.name || "",
        image: m?.tournament?.image || "",
        eventType: evType,
      },
      teams: {
        A: {
          name: teamName(m.pairA),
          players: playersFromReg(m.pairA),
        },
        B: {
          name: teamName(m.pairB),
          players: playersFromReg(m.pairB),
        },
      },
      rules,
      serve,
      currentGame: Number.isInteger(m?.currentGame) ? m.currentGame : 0,
      gameScores: Array.isArray(m?.gameScores) ? m.gameScores : [],
      bracketType: m?.bracket?.type || "",
      roundCode:
        m?.roundCode ||
        (Number.isFinite(m?.roundSize) ? `R${m.roundSize}` : undefined),
      roundName: m?.roundName || "",
      round: Number.isFinite(m?.round) ? m.round : undefined,

      // court để auto-next-by-court hoạt động (đầy đủ + fallback)
      court: courtId
        ? {
            id: courtId,
            name: courtName,
            number: courtNumber,
            ...courtExtra,
          }
        : null,

      // thêm các key fallback cho FE normalize (p.courtId / p.courtName / p.courtNo)
      courtId: courtId || undefined,
      courtName: courtName || undefined,
      courtNo: courtNumber ?? undefined,

      // tổng kết set
      sets: { A: setsA, B: setsB },
      needSetsToWin: gamesToWin(rules.bestOf),
    });
  } catch (err) {
    console.error("GET /overlay/match error:", err);
    res.status(500).json({ message: "Server error" });
  }
}


const FINISHED = "finished";
const STATUS_RANK = {
  assigned: 0,
  queued: 1,
  scheduled: 2,
  live: 3,
};

const toTs = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
const toNum = (v) =>
  Number.isFinite(+v) ? +v : Number.POSITIVE_INFINITY;

/** Xây dựng key sort đa tiêu chí (lexicographic) */
function sortKey(m) {
  return [
    STATUS_RANK[m?.status] ?? 99,
    toNum(m?.queueOrder),
    toTs(m?.assignedAt),
    toTs(m?.scheduledAt),
    toTs(m?.startedAt),
    toNum(m?.round),
    toNum(m?.order),
    toTs(m?.createdAt),
    String(m?._id || ""),
  ];
}
function lexCmp(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/**
 * GET /api/courts/:courtId/next?after=:matchId
 * Trả { matchId: "..." } | { matchId: null }
 */
export const getNextMatchByCourt = expressAsyncHandler(async (req, res) => {
  const { courtId } = req.params;
  const { after } = req.query;

  if (!courtId || !mongoose.Types.ObjectId.isValid(courtId)) {
    return res.status(400).json({ message: "Invalid courtId" });
  }
  const cid = new mongoose.Types.ObjectId(courtId);

  // Lấy toàn bộ ứng viên trên cùng sân, chưa finished
  const candidates = await Match.find({
    court: cid,
    status: { $ne: FINISHED },
  })
    .select(
      "_id status queueOrder assignedAt scheduledAt startedAt round order createdAt court"
    )
    .lean();

  if (!candidates.length) {
    return res.json({ matchId: null });
  }

  candidates.sort(lexCmp);

  // Nếu có "after" và tồn tại trong tập → lấy phần tử đứng sau nó
  if (after && mongoose.Types.ObjectId.isValid(after)) {
    const idx = candidates.findIndex((m) => String(m._id) === String(after));
    if (idx >= 0) {
      const next = candidates[idx + 1];
      return res.json({ matchId: next ? String(next._id) : null });
    }
    // Nếu "after" không nằm trong tập (vì đã finished/khác sân), ta lấy phần tử đầu
  }

  // Mặc định: trả trận "đầu hàng" theo tiêu chí sort
  return res.json({ matchId: String(candidates[0]._id) });
});