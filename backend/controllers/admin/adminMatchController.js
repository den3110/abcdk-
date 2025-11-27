import asyncHandler from "express-async-handler";
import Match from "../../models/matchModel.js";
import RatingChange from "../../models/ratingChangeModel.js";
import Bracket from "../../models/bracketModel.js";
import { computeRatingPreviewFromParams } from "../../utils/applyRatingForFinishedMatch.js";
import mongoose from "mongoose";
import Court from "../../models/courtModel.js";
import User from "../../models/userModel.js";
import { canManageTournament } from "../../utils/tournamentAuth.js";
import {
  EVENTS,
  publishNotification,
} from "../../services/notifications/notificationHub.js";

/** Chuẩn hoá DTO match (đủ dữ liệu để render) */
const toDTO = (m) => ({
  _id: m._id,
  tournament:
    typeof m.tournament === "object"
      ? {
          _id: m.tournament._id,
          name: m.tournament.name,
        }
      : m.tournament,
  bracket:
    typeof m.bracket === "object"
      ? {
          _id: m.bracket._id,
          name: m.bracket.name,
          type: m.bracket.type,
          stage: m.bracket.stage,
        }
      : m.bracket,
  format: m.format,
  branch: m.branch,
  round: m.round,
  order: m.order,
  code: m.code,
  labelKey: m.labelKey,
  pairA: m.pairA,
  pairB: m.pairB,
  rules: m.rules,
  gameScores: m.gameScores,
  status: m.status,
  winner: m.winner,
  referee: m.referee,
  startedAt: m.startedAt,
  finishedAt: m.finishedAt,
  scheduledAt: m.scheduledAt,
  court: m.court,
  courtLabel: m.courtLabel,
  ratingDelta: m.ratingDelta,
  ratingApplied: m.ratingApplied,
  ratingAppliedAt: m.ratingAppliedAt,
  liveVersion: m.liveVersion ?? 0,
});

/** GET /api/admin/matches/:id */
export const getMatchAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const m = await Match.findById(id)
    .populate({ path: "tournament", select: "name _id" })
    .populate({ path: "bracket", select: "name type stage _id createdAt" })
    .populate({ path: "pairA", select: "player1 player2" })
    .populate({ path: "pairB", select: "player1 player2" })
    .populate({ path: "referee", select: "name nickname avatar" });

  if (!m) return res.status(404).json({ message: "Match not found" });

  // ====== Tính "R" toàn giải (cộng dồn qua các bracket) ======
  const tId = String(m.tournament?._id || m.tournament || "");
  const brId = String(m.bracket?._id || m.bracket || "");

  let codeR;
  if (tId && brId) {
    // 1) Lấy toàn bộ bracket của giải & sắp xếp theo stage, createdAt, _id
    const brackets = await Bracket.find({ tournament: tId })
      .select("_id type stage createdAt")
      .lean();

    brackets.sort((a, b) => {
      const sa = Number(a.stage ?? 0);
      const sb = Number(b.stage ?? 0);
      if (sa !== sb) return sa - sb;
      const ca = new Date(a.createdAt || 0).getTime();
      const cb = new Date(b.createdAt || 0).getTime();
      if (ca !== cb) return ca - cb;
      return String(a._id).localeCompare(String(b._id));
    });

    // 2) Đếm số round thực tế theo từng bracket trong giải
    const tMatches = await Match.find({ tournament: tId })
      .select("bracket round")
      .lean();

    const roundsSetByBracket = new Map(); // brId -> Set(round)
    for (const tm of tMatches) {
      const _bid = String(tm.bracket || "");
      if (!_bid) continue;
      if (!roundsSetByBracket.has(_bid))
        roundsSetByBracket.set(_bid, new Set());
      const r = Number(tm.round ?? 1);
      if (Number.isFinite(r)) roundsSetByBracket.get(_bid).add(r);
    }

    // group = 1 vòng; các loại khác = số round distinct (fallback 1 nếu chưa có trận)
    const roundsCount = new Map(); // brId -> count
    for (const b of brackets) {
      const _bid = String(b._id);
      const type = String(b.type || "").toLowerCase();
      if (type === "group") {
        roundsCount.set(_bid, 1);
      } else {
        const c = roundsSetByBracket.get(_bid)?.size || 0;
        roundsCount.set(_bid, Math.max(1, c));
      }
    }

    // 3) Tính baseStart cho mỗi bracket: base = 1 + tổng vòng các bracket trước
    const baseStart = new Map(); // brId -> base
    let acc = 0;
    for (const b of brackets) {
      const _bid = String(b._id);
      baseStart.set(_bid, acc + 1);
      acc += roundsCount.get(_bid) || 1;
    }

    // 4) Tính R global cho trận hiện tại
    const base = baseStart.get(brId) ?? 1;
    const localRound = Number(m.round ?? 1);
    const globalRound =
      base + (Number.isFinite(localRound) ? localRound - 1 : 0);
    const tIndex = Number.isFinite(Number(m.order)) ? Number(m.order) + 1 : "?";
    codeR = `V${globalRound}-T${tIndex}`;
  } else {
    // fallback: dùng round cục bộ nếu thiếu tournament/bracket
    const localRound = Number(m.round ?? 1) || "?";
    const tIndex = Number.isFinite(Number(m.order)) ? Number(m.order) + 1 : "?";
    codeR = `V${localRound}-T${tIndex}`;
  }

  // DTO gốc rồi ghi đè code + thêm thông tin phụ trợ
  const dto = toDTO(m);
  dto.code = codeR; // ghi đè mã theo R toàn giải
  dto.globalCode = codeR; // nếu muốn dùng song song
  dto.globalRound =
    Number((typeof codeR === "string" && codeR.match(/^R(\d+)/)?.[1]) || NaN) ||
    undefined;

  return res.json({ ok: true, match: dto });
});

/** GET /api/admin/matches/:id/logs  (liveLog embedded + formatted) */
export const getMatchLogs = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const m = await Match.findById(id)
    .select("liveLog")
    .populate({ path: "liveLog.by", select: "name nickname avatar" });
  if (!m) return res.status(404).json({ message: "Match not found" });

  const logs = (m.liveLog || [])
    .slice()
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((e, idx) => ({
      idx,
      type: e.type,
      at: e.at,
      by: e.by
        ? {
            _id: e.by._id,
            name: e.by.name,
            nickname: e.by.nickname,
            avatar: e.by.avatar,
          }
        : null,
      payload: e.payload ?? null,
    }));

  res.json({ ok: true, count: logs.length, logs });
});

/** GET /api/admin/matches/:id/rating-changes */
export const getMatchRatingChanges = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rows = await RatingChange.find({ match: id })
    .populate({ path: "user", select: "name nickname avatar" })
    .sort({ createdAt: 1 });

  res.json({
    ok: true,
    list: rows.map((r) => ({
      _id: r._id,
      user: r.user
        ? {
            _id: r.user._id,
            name: r.user.name,
            nickname: r.user.nickname,
            avatar: r.user.avatar,
          }
        : r.user,
      kind: r.kind, // "singles" | "doubles"
      before: r.before,
      after: r.after,
      delta: r.delta,
      expected: r.expected,
      score: r.score,
      reliabilityBefore: r.reliabilityBefore,
      reliabilityAfter: r.reliabilityAfter,
      marginBonus: r.marginBonus,
      createdAt: r.createdAt,
    })),
  });
});

// POST /admin/match/rating/preview
// body: { tournamentId, bracketId?, round?, pairARegId, pairBRegId, winner, gameScores:[{a,b}], forfeit? }
export const previewRatingDelta = asyncHandler(async (req, res) => {
  const {
    tournamentId,
    bracketId,
    round,
    pairARegId,
    pairBRegId,
    winner,
    gameScores,
    forfeit,
  } = req.body || {};
  if (!tournamentId || !pairARegId || !pairBRegId || !winner) {
    res.status(400);
    throw new Error("tournamentId, pairARegId, pairBRegId, winner là bắt buộc");
  }
  const details = await computeRatingPreviewFromParams({
    tournamentId,
    bracketId,
    round,
    pairARegId,
    pairBRegId,
    winner,
    gameScores: Array.isArray(gameScores) ? gameScores : [],
    forfeit: !!forfeit,
  });
  res.json(details);
});

/**
 * POST /api/matches/:id/reset-scores
 * Reset bảng điểm về 0–0: xoá gameScores[], currentGame=0, (tuỳ chọn) reset serve, xoá liveLog
 * - KHÔNG tự ý đổi status (FE sẽ đổi trước nếu muốn)
 * - Nếu status !== 'finished' thì winner = "" và finishedAt = null.
 *   Nếu status !== 'live' thì startedAt = null (vì về scheduled/queued).
 * - Không đụng ratingApplied/ratingDelta.
 * Body options (tuỳ chọn):
 *   - clearLiveLog?: boolean (default false)
 *   - resetServe?: boolean (default true)
 *   - bumpVersion?: boolean (default true)
 */
export const resetMatchScores = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    clearLiveLog = false,
    resetServe = true,
    bumpVersion = true,
  } = req.body || {};

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid match id" });
  }

  const match = await Match.findById(id);
  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }

  // ===== Reset scoreboard theo schema hiện tại =====
  match.gameScores = []; // xoá toàn bộ ván
  match.currentGame = 0; // quay về game 0 (chưa bắt đầu)

  if (resetServe) {
    // về default theo schema
    match.serve = { side: "A", server: 2 };
  }

  // Nếu không còn finished, đảm bảo winner & mốc thời gian hợp lý
  if (match.status !== "finished") {
    match.winner = ""; // clear winner (enum: ["A","B",""])
    match.finishedAt = null;
    if (match.status !== "live") {
      match.startedAt = null;
    }
  }

  if (clearLiveLog && Array.isArray(match.liveLog)) {
    match.liveLog = [];
  }

  // Bump version để client biết có thay đổi live state
  if (bumpVersion) {
    match.liveVersion = (match.liveVersion || 0) + 1;
  }

  await match.save();

  // Phát socket để UI cập nhật ngay (optional)
  const io = req.app.get("io");
  try {
    const payload = {
      matchId: match._id,
      gameScores: match.gameScores,
      currentGame: match.currentGame,
      serve: match.serve,
      status: match.status,
      winner: match.winner,
      liveVersion: match.liveVersion,
    };
    io?.to(String(match._id)).emit("score:reset", payload);
    io?.to(String(match._id)).emit("match:patched", { matchId: match._id });
  } catch (_) {
    // socket optional, không chặn request
  }

  return res.json({
    message: "Đã reset tỉ số về 0–0 (xoá toàn bộ gameScores).",
    matchId: match._id,
    status: match.status,
    winner: match.winner,
    liveVersion: match.liveVersion,
  });
});

/**
 * POST /api/admin/tournaments/:tid/matches/:mid/court
 * body: { courtId: string }
 * - Gán court cho match
 */
export async function assignMatchToCourt(req, res) {
  try {
    const { tid, mid } = req.params;
    const { courtId } = req.body || {};

    // ===== Validate =====
    if (!mongoose.Types.ObjectId.isValid(tid)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }
    if (!mongoose.Types.ObjectId.isValid(mid)) {
      return res.status(400).json({ message: "Invalid match id" });
    }
    if (!mongoose.Types.ObjectId.isValid(courtId)) {
      return res.status(400).json({ message: "Invalid court id" });
    }

    // ===== Auth =====
    const me = req.user;
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, tid);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // ===== Load match (thuộc giải) =====
    const match = await Match.findById(mid)
      .select(
        "_id tournament bracket status court courtLabel courtCluster assignedAt type format pool round order globalRound"
      )
      .lean();
    if (!match) return res.status(404).json({ message: "Match not found" });
    if (String(match.tournament) !== String(tid)) {
      return res.status(400).json({ message: "Match not in this tournament" });
    }

    // ===== Load court (chỉ cần cùng giải; KHÔNG kiểm bracket) =====
    const court = await Court.findById(courtId)
      .select(
        "_id tournament name label code cluster status currentMatch isActive"
      )
      .lean();
    if (!court) return res.status(404).json({ message: "Court not found" });
    if (String(court.tournament) !== String(tid)) {
      return res.status(400).json({ message: "Court not in this tournament" });
    }
    if (court.isActive === false) {
      return res.status(409).json({ message: "Court is inactive" });
    }

    // Sân đang gắn match khác → từ chối
    if (court.currentMatch && String(court.currentMatch) !== String(mid)) {
      return res
        .status(409)
        .json({ message: "Sân đã được gán cho một trận khác" });
    }

    // Nếu match đang gắn sân A → gỡ ở sân A trước (không đổi status match)
    if (match.court && String(match.court) !== String(courtId)) {
      await Court.updateOne(
        { _id: match.court, currentMatch: match._id },
        { $set: { currentMatch: null, status: "idle" } }
      );
    }

    // ===== Cập nhật match → gán sân mới =====
    const nextStatus =
      match.status === "scheduled" || match.status === "queued"
        ? "assigned"
        : match.status;

    const courtLabel =
      court.name ||
      court.label ||
      court.code ||
      `Sân #${String(court._id).slice(-4)}`;

    const updatedMatch = await Match.findByIdAndUpdate(
      mid,
      {
        $set: {
          court: court._id,
          courtLabel,
          courtCluster: court.cluster || "Main",
          status: nextStatus,
          assignedAt: new Date(),
        },
      },
      { new: true }
    ).select("_id code status court courtLabel courtCluster assignedAt");

    // ===== Cập nhật court =====
    await Court.findByIdAndUpdate(court._id, {
      $set: {
        currentMatch: updatedMatch._id,
        status: updatedMatch.status === "live" ? "live" : "assigned",
      },
    });

    // ===== Emit status:updated =====
    const io = req.app.get("io");
    io?.to(String(match._id)).emit("status:updated", {
      matchId: match._id,
      status: updatedMatch.status,
    });

    // ===== Build mã trận KHÔNG phụ thuộc bracket =====
    const GROUP_LIKE = new Set(["group", "round_robin", "gsl", "swiss"]);
    const isGroupLike = (m) => {
      const t1 = String(m?.type || "").toLowerCase();
      const f1 = String(m?.format || "").toLowerCase();
      if (GROUP_LIKE.has(t1) || GROUP_LIKE.has(f1)) return true;
      if (m?.pool) return true; // có pool coi là group-like
      return false;
    };
    const letterToIndex = (s) => {
      const ch = String(s || "")
        .trim()
        .toUpperCase();
      if (/^[A-Z]$/.test(ch)) return ch.charCodeAt(0) - 64; // A=1
      return null;
    };
    const getPoolIndex = (pool) => {
      if (!pool) return null;
      const cand = String(
        pool.index ?? pool.idx ?? pool.code ?? pool.key ?? pool.name ?? ""
      ).trim();
      if (!cand) return null;
      if (/^\d+$/.test(cand)) {
        const n = parseInt(cand, 10);
        return n > 0 ? n : null;
      }
      const mB = /^B(\d+)$/i.exec(cand);
      if (mB) return parseInt(mB[1], 10);
      const byLetter = letterToIndex(cand);
      if (byLetter) return byLetter;
      return null;
    };
    const extractT = (m) => {
      const o = Number(m?.order);
      if (Number.isFinite(o) && o >= 0) return o + 1;
      const lk = String(m?.labelKey || "");
      const mm = lk.match(/(\d+)$/);
      if (mm) return Number(mm[1]);
      return 1;
    };
    const computeDisplayCode = (m) => {
      const T = extractT(m);
      if (isGroupLike(m)) {
        // Group-like: V1 -[B]- T
        const B = getPoolIndex(m?.pool);
        const code = `V1${B ? `-B${B}` : ""}-T${T}`;
        return { code, displayCode: code };
      } else {
        // KO/Elim: V{globalRound|round|1} - T
        const r =
          (Number.isFinite(Number(m?.globalRound)) && Number(m.globalRound)) ||
          (Number.isFinite(Number(m?.round)) && Number(m.round)) ||
          1;
        const code = `V${r}-T${T}`;
        return { code, displayCode: code };
      }
    };

    // ===== Emit snapshot đầy đủ (kèm code mới) =====
    const m = await Match.findById(match._id)
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
        path: "court",
        select: "name number code label zone area venue building floor cluster",
      })
      .populate({ path: "liveBy", select: "name fullName nickname nickName" })
      .select(
        "label managers court courtLabel courtCluster " +
          "scheduledAt startAt startedAt finishedAt status " +
          "tournament bracket rules currentGame gameScores " +
          "round order code roundCode roundName " +
          "seedA seedB previousA previousB nextMatch winner serve overlay " +
          "video videoUrl stream streams meta " +
          "type format rrRound pool " +
          "liveBy liveVersion"
      )
      .lean();

    if (m) {
      // Nickname fallback
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
      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      // Build code không cần offset
      const { code, displayCode } = computeDisplayCode(m);
      m.code = code;
      m.displayCode = displayCode;
      m.roundCode = code;

      io?.to(`match:${String(match._id)}`).emit("match:snapshot", toDTO(m));

      // 🔔 Gửi thông báo push cho tất cả VĐV của 2 đội
      try {
        const courtName =
          m.court?.name ||
          m.court?.label ||
          m.court?.code ||
          (m.court?.number != null ? `Sân ${m.court.number}` : "sân thi đấu");

        const tourName = m.tournament?.name || "giải đấu";

        const teamLabel = (pair) => {
          if (!pair) return "";
          if (pair.teamName) return pair.teamName;
          if (pair.label) return pair.label;
          const names = [];
          const nn = (p) =>
            p?.nickname ||
            p?.nickName ||
            p?.shortName ||
            p?.fullName ||
            p?.name ||
            "";
          if (nn(pair.player1)) names.push(nn(pair.player1));
          if (nn(pair.player2)) names.push(nn(pair.player2));
          return names.join(" / ") || "Đội";
        };

        const teamAName = teamLabel(m.pairA);
        const teamBName = teamLabel(m.pairB);

        const userIds = new Set();
        const collectUser = (p) => {
          if (!p || !p.user) return;
          const u = p.user;
          const uid =
            typeof u === "object" ? u._id || u.id || u.toString?.() : u;
          if (uid) userIds.add(String(uid));
        };

        if (m.pairA) {
          collectUser(m.pairA.player1);
          collectUser(m.pairA.player2);
        }
        if (m.pairB) {
          collectUser(m.pairB.player1);
          collectUser(m.pairB.player2);
        }

        if (userIds.size) {
          const ctx = {
            matchId: String(m._id),
            tournamentId: String(m.tournament?._id || tid),
            courtLabel: courtName,
            tournamentName: tourName,
            teamAName,
            teamBName,
            displayCode: m.displayCode,
            // ép audience = các user thuộc hai đội
            overrideAudience: [...userIds],
          };

          // không block response
          setImmediate(() => {
            publishNotification(EVENTS.MATCH_COURT_ASSIGNED, ctx).catch((e) =>
              console.error(
                "[notify] MATCH_COURT_ASSIGNED error:",
                e?.message || e
              )
            );
          });
        }
      } catch (e) {
        console.error(
          "[assignMatchToCourt] build notification error:",
          e?.message || e
        );
      }
    }

    // (tuỳ chọn) báo phòng scheduler của cluster này refresh state
    try {
      const clusterKey = court.cluster || "Main";
      io?.to(`tour:${tid}:${clusterKey}`).emit("scheduler:state:dirty", {
        at: Date.now(),
        reason: "assign:court",
        courtId: String(court._id),
        matchId: String(match._id),
      });
    } catch (_) {}

    return res.json({ ok: true, match: updatedMatch });
  } catch (err) {
    console.error("[assignMatchToCourt] error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
/**
 * DELETE /api/admin/tournaments/:tid/matches/:mid/court
 * - Bỏ gán court của match
 */
export async function clearMatchCourt(req, res) {
  try {
    const { tid, mid } = req.params;

    if (!mongoose.Types.ObjectId.isValid(tid)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }
    if (!mongoose.Types.ObjectId.isValid(mid)) {
      return res.status(400).json({ message: "Invalid match id" });
    }
    const me = req.user;
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, tid);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const match = await Match.findById(mid)
      .select("_id tournament status court courtLabel")
      .lean();
    if (!match) return res.status(404).json({ message: "Match not found" });
    if (String(match.tournament) !== String(tid)) {
      return res.status(400).json({ message: "Match not in this tournament" });
    }

    // Gỡ currentMatch của court nếu đang trỏ tới match này
    if (match.court) {
      await Court.updateOne(
        { _id: match.court, currentMatch: match._id },
        { $set: { currentMatch: null, status: "idle" } }
      );
    }

    // Nếu đang "assigned" do có sân → trả về trạng thái "scheduled"
    const next = match.status === "assigned" ? { status: "scheduled" } : {};
    const updatedMatch = await Match.findByIdAndUpdate(
      mid,
      {
        $set: {
          ...next,
          court: null,
          courtLabel: "",
          assignedAt: null,
        },
      },
      { new: true }
    ).select("_id code status court courtLabel assignedAt");

    // Emit status:updated (dùng updatedMatch.status)
    const io = req.app.get("io");
    io?.to(String(match._id)).emit("status:updated", {
      matchId: match._id,
      status: updatedMatch.status,
    });

    // ===== Helpers build mã trận (V[-B]-T) =====
    const isGroupLike = (t) =>
      ["group", "round_robin", "gsl", "swiss"].includes(String(t || ""));

    const countBracketRounds = (b) => {
      const t = String(b?.type || "");
      if (isGroupLike(t)) return 1; // vòng bảng tính 1 vòng
      const metaRounds = Number(b?.meta?.maxRounds || 0);
      const drawRounds = Number(b?.drawRounds || 0);
      return Math.max(metaRounds, drawRounds, 0);
    };

    // "A"→1, "B"→2; "3"→3; nếu tên lạ thì tìm index trong bracket.groups
    const getPoolIndex = (raw, curBracket) => {
      const s = String(raw ?? "").trim();
      if (!s) return null;
      if (/^\d+$/.test(s)) {
        const n = parseInt(s, 10);
        return n > 0 ? n : null;
      }
      const up = s.toUpperCase();
      if (/^[A-Z]$/.test(up)) return up.charCodeAt(0) - 64; // A=1
      const groups = curBracket?.groups || [];
      const idx = groups.findIndex(
        (g) =>
          String(g?.name || "")
            .trim()
            .toUpperCase() === up
      );
      return idx >= 0 ? idx + 1 : null;
    };

    const buildMatchCodeWithOffset = (mDoc, curBracket, offset) => {
      if (!mDoc || !curBracket) {
        const r = Math.max(1, Number(mDoc?.round || 1));
        const T = Math.max(
          1,
          Number(mDoc?.order) >= 0 ? Number(mDoc.order) + 1 : 1
        );
        const V = offset + r;
        return { code: `V${V}-T${T}`, displayCode: `V${V}-T${T}` };
      }
      const t = String(curBracket?.type || "");
      const localRound = isGroupLike(t)
        ? 1
        : Math.max(1, Number(mDoc?.round || 1));
      const V = offset + localRound;
      const T = Math.max(
        1,
        Number(mDoc?.order) >= 0 ? Number(mDoc.order) + 1 : 1
      );

      if (isGroupLike(t)) {
        const poolRaw = mDoc?.pool?.key ?? mDoc?.pool?.name ?? "";
        const poolIdx = getPoolIndex(poolRaw, curBracket);
        const B = poolIdx != null ? `-B${poolIdx}` : "";
        const code = `V${V}${B}-T${T}`;
        return { code, displayCode: code };
      } else {
        const code = `V${V}-T${T}`;
        return { code, displayCode: code };
      }
    };

    // Lấy snapshot đầy đủ cho client
    const m = await Match.findById(match._id)
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
          "round order code roundCode roundName " +
          "seedA seedB previousA previousB nextMatch winner serve overlay " +
          "video videoUrl stream streams meta " +
          "format rrRound pool " +
          "liveBy liveVersion"
      )
      .lean();

    if (m) {
      // Nickname fallback
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
      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      // Fallback streams
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      // === Tính baseOffset & build mã trận chuẩn (V…[-B…]-T…) ===
      if (m.bracket) {
        const prevBrs = await Bracket.find({
          tournament: tid,
          order: { $lt: m.bracket.order ?? 0 },
        })
          .select("type meta.maxRounds drawRounds")
          .sort({ order: 1 })
          .lean();

        const baseOffset = (prevBrs || []).reduce(
          (sum, b) => sum + countBracketRounds(b),
          0
        );

        const { code, displayCode } = buildMatchCodeWithOffset(
          m,
          m.bracket,
          baseOffset
        );
        m.code = code;
        m.displayCode = displayCode;
        m.roundCode = code; // tương thích nơi đọc roundCode
      }

      // Emit snapshot với mã trận chuẩn
      io?.to(`match:${String(match._id)}`).emit("match:snapshot", toDTO(m));
    }

    return res.json({ ok: true, match: updatedMatch });
  } catch (err) {
    console.error("[clearMatchCourt] error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * GET /api/admin/tournaments/:tid/matches/:mid/referees
 * Trả về danh sách user đang được gán làm trọng tài của trận.
 */
export async function getMatchReferees(req, res) {
  try {
    const { tid, mid } = req.params;

    if (!mongoose.Types.ObjectId.isValid(tid)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }
    if (!mongoose.Types.ObjectId.isValid(mid)) {
      return res.status(400).json({ message: "Invalid match id" });
    }

    // Quyền: admin hoặc quản lý giải
    const me = req.user;
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, tid);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Tìm match đúng giải (ưu tiên bằng tournament trực tiếp)
    let match = await Match.findOne({ _id: mid, tournament: tid })
      .select("_id tournament bracket referee")
      .populate({
        path: "referee", // ✅ đúng field trong schema
        model: "User",
        select:
          "_id name nickname displayName fullName email phone province avatar",
      })
      .lean();

    // fallback: dữ liệu cũ thiếu tournament → kiểm tra qua bracket
    if (!match) {
      const m2 = await Match.findById(mid).select("_id bracket").lean();
      if (!m2) return res.status(404).json({ message: "Match not found" });

      const br = await Bracket.findById(m2.bracket).select("tournament").lean();
      if (!br || String(br.tournament) !== String(tid)) {
        return res
          .status(404)
          .json({ message: "Match not found in this tournament" });
      }

      match = await Match.findById(mid)
        .select("_id tournament bracket referee")
        .populate({
          path: "referee",
          model: "User",
          select:
            "_id name nickname displayName fullName email phone province avatar",
        })
        .lean();
      if (!match) return res.status(404).json({ message: "Match not found" });
    }

    const referees = Array.isArray(match.referee) ? match.referee : [];
    return res.json(referees);
  } catch (err) {
    console.error("[getMatchReferees] error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
