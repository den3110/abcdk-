// socket/liveHandlers.js
import Match from "../models/matchModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import usersOfReg from "../utils/usersOfReg.js";
import latestSnapshot from "../utils/getLastestSnapshot.js";
import { applyRatingForFinishedMatch } from "../utils/applyRatingForFinishedMatch.js";
import { onMatchFinished } from "../services/courtQueueService.js";

// ===== CAP-AWARE helpers =====
function isFinitePos(n) {
  return Number.isFinite(n) && n > 0;
}

/**
 * Kết luận 1 ván dựa trên rules (pointsToWin, winByTwo, cap).
 * Trả về: { finished: boolean, winner: 'A'|'B'|null, capped: boolean }
 */
function evaluateGameFinish(aRaw, bRaw, rules) {
  const a = Number(aRaw) || 0;
  const b = Number(bRaw) || 0;

  const base = Number(rules?.pointsToWin ?? 11);
  const byTwo = rules?.winByTwo !== false; // default true
  const mode = String(rules?.cap?.mode ?? "none"); // 'none' | 'hard' | 'soft'
  const capPoints =
    rules?.cap?.points != null ? Number(rules.cap.points) : null;

  // HARD CAP: chạm cap là kết thúc ngay (không cần chênh 2)
  if (mode === "hard" && isFinitePos(capPoints)) {
    if (a >= capPoints || b >= capPoints) {
      if (a === b) return { finished: false, winner: null, capped: false }; // edge-case nhập tay
      return { finished: true, winner: a > b ? "A" : "B", capped: true };
    }
  }

  // SOFT CAP: khi đạt ngưỡng cap, bỏ luật chênh 2 → ai dẫn trước là thắng
  if (mode === "soft" && isFinitePos(capPoints)) {
    if (a >= capPoints || b >= capPoints) {
      if (a === b) return { finished: false, winner: null, capped: false };
      return { finished: true, winner: a > b ? "A" : "B", capped: true };
    }
  }

  // Không cap / chưa tới cap:
  if (byTwo) {
    if ((a >= base || b >= base) && Math.abs(a - b) >= 2) {
      return { finished: true, winner: a > b ? "A" : "B", capped: false };
    }
  } else {
    if ((a >= base || b >= base) && a !== b) {
      return { finished: true, winner: a > b ? "A" : "B", capped: false };
    }
  }
  return { finished: false, winner: null, capped: false };
}
export const toDTO = (m) => {
  const tournament = m.tournament
    ? {
        _id: m.tournament._id || m.tournament,
        name: m.tournament.name || "",
        image: m.tournament.image || "",
        eventType: (m.tournament.eventType || "").toLowerCase(),
        overlay: m.tournament.overlay || undefined,
      }
    : undefined;

  const bracket = m.bracket
    ? {
        _id: m.bracket._id || m.bracket,
        type: (m.bracket.type || "").toLowerCase(),
        name: m.bracket.name || "",
        order: m.bracket.order ?? undefined,
        overlay: m.bracket.overlay || undefined,
      }
    : undefined;

  // Fallback overlay: ưu tiên overlay tại match (nếu có & non-empty) → bracket → tournament
  const overlayFromMatch =
    m.overlay && typeof m.overlay === "object" && Object.keys(m.overlay).length
      ? m.overlay
      : null;
  const overlay =
    overlayFromMatch ?? bracket?.overlay ?? tournament?.overlay ?? undefined;

  // Media
  const primaryVideo =
    typeof m.video === "string" && m.video.trim().length ? m.video.trim() : "";
  const videoUrl = typeof m.videoUrl === "string" ? m.videoUrl : undefined;
  const stream = typeof m.stream === "string" ? m.stream : undefined;
  const streams = Array.isArray(m.streams)
    ? m.streams
    : Array.isArray(m.meta?.streams)
    ? m.meta.streams
    : undefined;

  // Chuẩn hoá tên nick cho user (referees/liveBy)
  const normUserLite = (u) => {
    if (!u) return null;
    const nickname =
      (u.nickname && String(u.nickname).trim()) ||
      (u.nickName && String(u.nickName).trim()) ||
      "";
    return { _id: u._id, name: u.name || u.fullName || "", nickname };
  };

  // referees: luôn trả về mảng (kể cả rỗng)
  const referees = Array.isArray(m.referee)
    ? m.referee.map(normUserLite).filter(Boolean)
    : [];

  // liveBy: user đang điều khiển bảng điểm
  const liveBy = m.liveBy ? normUserLite(m.liveBy) : null;

  return {
    _id: m._id,
    status: m.status,
    winner: m.winner,

    // top-level dùng cho tiêu đề R#/order
    round: m.round,
    order: m.order,

    rules: m.rules || {},
    currentGame: m.currentGame ?? 0,
    gameScores: Array.isArray(m.gameScores) ? m.gameScores : [],

    // cặp/seed & phụ thuộc
    pairA: m.pairA || null,
    pairB: m.pairB || null,
    seedA: m.seedA || null,
    seedB: m.seedB || null,
    previousA: m.previousA || null,
    previousB: m.previousB || null,
    nextMatch: m.nextMatch || null,

    // ⭐ thay vì 1 referee, trả về danh sách
    referees,
    // (tuỳ bạn có muốn giữ backward-compat không)
    // referee: referees[0] || null,

    // thời gian
    scheduledAt: m.scheduledAt || null,
    startedAt: m.startedAt || null,
    finishedAt: m.finishedAt || null,

    version: m.liveVersion ?? 0,

    // serve mặc định
    serve: m.serve || { side: "A", server: 2 },

    tournament,
    bracket,
    bracketType: bracket?.type || undefined,

    overlay,

    // media
    video: primaryVideo || undefined,
    videoUrl,
    stream,
    streams,

    // ⭐ expose liveBy cho FE
    liveBy,
  };
};

const gamesToWin = (bestOf) => Math.floor(bestOf / 2) + 1;
const gameWon = (x, y, pts, byTwo) =>
  x >= pts && (byTwo ? x - y >= 2 : x - y >= 1);

// ✅ helper: đội mất bóng -> đổi lượt theo luật pickleball đơn giản
function onLostRallyNextServe(prev) {
  // nếu đang server #1 thua -> chuyển #2 (cùng đội)
  // nếu đang server #2 thua -> side-out: đổi sang đội kia, server #1
  if (prev.server === 1) return { side: prev.side, server: 2 };
  return { side: prev.side === "A" ? "B" : "A", server: 1 };
}

export async function startMatch(matchId, refereeId, io) {
  const m = await Match.findById(matchId);
  if (!m || m.status === "finished") return;

  m.status = "live";
  m.startedAt = new Date();

  if (!m.gameScores?.length) {
    m.gameScores = [{ a: 0, b: 0 }];
    m.currentGame = 0;
  }

  // ✅ 0-0-2 khi mở ván
  if (!m.serve) m.serve = { side: "A", server: 2 };

  m.liveBy = refereeId || null;
  m.liveLog = m.liveLog || [];
  m.liveLog.push({ type: "start", by: refereeId, at: new Date() });
  m.liveVersion = (m.liveVersion || 0) + 1;
  await m.save();

  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io.to(`match:${matchId}`).emit("match:update", {
    type: "start",
    data: toDTO(doc),
  });
}

// chua dung
async function applyRatingDeltaForMatch(mt, scorerId) {
  // đã áp dụng hoặc không cấu hình delta → bỏ qua
  const delta = Number(mt.ratingDelta) || 0;
  if (mt.ratingApplied || delta <= 0) return;

  // lấy loại giải (đơn/đôi)
  const tour = await Tournament.findById(mt.tournament).select("eventType");
  const eventType = tour?.eventType === "single" ? "single" : "double";

  // nạp 2 registration
  const regs = await Registration.find({
    _id: { $in: [mt.pairA, mt.pairB].filter(Boolean) },
  })
    .select("player1 player2")
    .lean();
  const regA = regs.find((r) => String(r._id) === String(mt.pairA));
  const regB = regs.find((r) => String(r._id) === String(mt.pairB));

  const usersA = usersOfReg(regA);
  const usersB = usersOfReg(regB);
  if (!usersA.length || !usersB.length) return;

  const winners = mt.winner === "A" ? usersA : usersB;
  const losers = mt.winner === "A" ? usersB : usersA;
  const AUTO_TOKEN = (mid) => `[AUTO mt:${String(mid)}]`;
  const tokenNote = `${AUTO_TOKEN(mt._id)} winner:${
    mt.winner
  } Δ${delta} (${eventType})`;

  const docs = [];
  for (const uid of winners) {
    const prev = await latestSnapshot(uid);
    const next = {
      single: eventType === "single" ? prev.single + delta : prev.single,
      double: eventType === "double" ? prev.double + delta : prev.double,
    };
    docs.push({
      user: uid,
      scorer: scorerId || null,
      single: next.single,
      double: next.double,
      note: tokenNote,
      scoredAt: new Date(),
    });
  }
  for (const uid of losers) {
    const prev = await latestSnapshot(uid);
    const next = {
      single:
        eventType === "single" ? Math.max(0, prev.single - delta) : prev.single,
      double:
        eventType === "double" ? Math.max(0, prev.double - delta) : prev.double,
    };
    docs.push({
      user: uid,
      scorer: scorerId || null,
      single: next.single,
      double: next.double,
      note: tokenNote,
      scoredAt: new Date(),
    });
  }

  if (docs.length) {
    await ScoreHistory.insertMany(docs);
    mt.ratingApplied = true;
    mt.ratingAppliedAt = new Date();
    await mt.save();
  }
}

// yêu cầu sẵn có các helper: gameWon, gamesToWin, onLostRallyNextServe, toDTO
// (tuỳ bạn import ở đầu file) + hàm applyRatingForFinishedMatch (nếu dùng auto cộng/trừ điểm)

// ✅ addPoint mới: trung lập, chỉ auto khi opts.autoNext === true
export async function addPoint(matchId, team, step = 1, by, io, opts = {}) {
  const { autoNext = false } = opts;

  const m = await Match.findById(matchId);
  if (!m || m.status !== "live") return;

  // ---- helpers an toàn ----
  const toNum = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  const clamp0 = (n) => (n < 0 ? 0 : n);
  const validSide = (s) => (s === "A" || s === "B" ? s : "A");
  const validServer = (x) => (x === 1 || x === 2 ? x : 2);

  if (!["A", "B"].includes(team)) return;
  const st = toNum(step, 1);
  if (st === 0) return;

  // đảm bảo m.gameScores & currentGame
  if (!Array.isArray(m.gameScores)) m.gameScores = [];
  let gi = Number.isInteger(m.currentGame) ? m.currentGame : 0;
  if (gi < 0) gi = 0;
  while (m.gameScores.length <= gi) m.gameScores.push({ a: 0, b: 0 });

  const curRaw = m.gameScores[gi] || {};
  const cur = { a: toNum(curRaw.a, 0), b: toNum(curRaw.b, 0) };

  // cộng/trừ điểm (không âm)
  if (team === "A") cur.a = clamp0(cur.a + st);
  else cur.b = clamp0(cur.b + st);
  m.gameScores[gi] = cur;

  // ===== serve/rally =====
  // Chỉ đổi lượt giao khi là điểm THÊM (st > 0). Undo không đụng tới serve.
  const prevServe = {
    side: validSide(m.serve?.side),
    server: validServer(m.serve?.server),
  };
  if (st > 0) {
    const servingTeam = prevServe.side;
    const scoredForServing = team === servingTeam;
    if (!scoredForServing) {
      // đội nhận ghi điểm → đổi lượt/đổi người theo luật hệ thống
      m.serve = onLostRallyNextServe(prevServe);
    } else if (!m.serve) {
      m.serve = prevServe;
    }
  }

  // ===== rules (cap-aware) =====
  const rules = {
    bestOf: toNum(m.rules?.bestOf, 3),
    pointsToWin: toNum(m.rules?.pointsToWin, 11),
    winByTwo:
      m.rules?.winByTwo === undefined ? true : Boolean(m.rules?.winByTwo),
    cap: {
      mode: String(m.rules?.cap?.mode ?? "none"),
      points:
        m.rules?.cap?.points === undefined ? null : Number(m.rules.cap.points),
    },
  };

  // Kết luận ván hiện tại
  const ev = evaluateGameFinish(cur.a, cur.b, rules);

  if (ev.finished) {
    // Đếm số ván thắng (tính trên toàn bộ m.gameScores sau cập nhật)
    let aWins = 0,
      bWins = 0;
    for (let i = 0; i < m.gameScores.length; i++) {
      const g = m.gameScores[i] || { a: 0, b: 0 };
      const ge = evaluateGameFinish(toNum(g.a, 0), toNum(g.b, 0), rules);
      if (ge.finished) {
        if (ge.winner === "A") aWins++;
        else if (ge.winner === "B") bWins++;
      }
    }
    const need = Math.floor(Number(rules.bestOf) / 2) + 1;

    if (autoNext === true) {
      // ✅ CHỈ trong chế độ tự động mới được advance/finish
      if (aWins >= need || bWins >= need) {
        // Kết thúc TRẬN
        m.status = "finished";
        m.winner = aWins > bWins ? "A" : "B";
        if (!m.finishedAt) m.finishedAt = new Date();
      } else {
        // Mở ván mới, đảo bên giao đầu ván, 0-0-2
        m.gameScores.push({ a: 0, b: 0 });
        m.currentGame = gi + 1;
        const nextFirstSide = validSide(prevServe.side) === "A" ? "B" : "A";
        m.serve = { side: nextFirstSide, server: 2 };

        m.liveLog = m.liveLog || [];
        m.liveLog.push({
          type: "serve",
          by: by || null,
          payload: { team: m.serve.side, server: 2 },
          at: new Date(),
        });
      }
    }
    // ❌ Không autoNext: KHÔNG làm gì thêm (để trọng tài bấm nút)
  }

  // log point + version
  m.liveLog = m.liveLog || [];
  m.liveLog.push({
    type: "point",
    by: by || null,
    payload: { team, step: st, prevServe },
    at: new Date(),
  });
  m.liveVersion = toNum(m.liveVersion, 0) + 1;

  await m.save();

  // Áp rating + notify queue khi trận kết thúc
  try {
    if (m.status === "finished" && !m.ratingApplied) {
      await applyRatingForFinishedMatch(m._id);
      await onMatchFinished({ matchId: m._id });
    }
  } catch (err) {
    console.error("[rating] applyRatingForFinishedMatch error:", err);
  }

  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io?.to(`match:${matchId}`)?.emit("match:update", {
    type: "point",
    data: toDTO(doc),
  });
}

export async function undoLast(matchId, by, io) {
  const m = await Match.findById(matchId);
  if (!m || !m.liveLog?.length) return;

  for (let i = m.liveLog.length - 1; i >= 0; i--) {
    const ev = m.liveLog[i];
    if (ev.type === "point") {
      // nếu vừa finish -> mở lại
      if (m.status === "finished") {
        m.status = "live";
        m.winner = "";
        m.finishedAt = null;
      }

      // nếu ván mới vừa mở nhưng chưa có điểm thì pop ván cuối
      if (m.currentGame > 0) {
        const cg = m.gameScores[m.currentGame];
        if (cg?.a === 0 && cg?.b === 0) {
          m.gameScores.pop();
          m.currentGame -= 1;
        }
      }

      // đảo điểm
      const g = m.gameScores[m.currentGame || 0];
      const step = ev.payload?.step || 1;
      if (ev.payload?.team === "A") g.a -= step;
      if (ev.payload?.team === "B") g.b -= step;

      // ✅ khôi phục serve trước đó
      if (ev.payload?.prevServe) m.serve = ev.payload.prevServe;

      m.liveLog.splice(i, 1);
      m.liveVersion = (m.liveVersion || 0) + 1;
      await m.save();

      const doc = await Match.findById(m._id).populate("pairA pairB referee");
      io.to(`match:${matchId}`).emit("match:update", {
        type: "undo",
        data: toDTO(doc),
      });
      return;
    }
  }
}

// ✅ optional: set serve thủ công
export async function setServe(matchId, side, server, by, io) {
  const m = await Match.findById(matchId);
  if (!m) return;
  if (!["A", "B"].includes(side)) return;
  if (![1, 2].includes(Number(server))) return;

  const prevServe = m.serve || { side: "A", server: 2 };
  m.serve = { side, server: Number(server) };
  m.liveLog = m.liveLog || [];
  m.liveLog.push({
    type: "serve",
    by,
    payload: { prevServe, next: m.serve },
    at: new Date(),
  });
  m.liveVersion = (m.liveVersion || 0) + 1;
  await m.save();

  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io.to(`match:${matchId}`).emit("match:update", {
    type: "serve",
    data: toDTO(doc),
  });
}

export async function finishMatch(matchId, winner, reason, by, io) {
  const m = await Match.findById(matchId);
  if (!m) return;

  m.status = "finished";
  m.winner = winner;
  m.finishedAt = new Date();
  if (reason) m.note = `[${reason}] ${m.note || ""}`;

  m.liveLog = m.liveLog || [];
  m.liveLog.push({
    type: "finish",
    by,
    payload: { winner, reason },
    at: new Date(),
  });
  m.liveVersion = (m.liveVersion || 0) + 1;

  await m.save();

  // Áp điểm ngay khi kết thúc thủ công / forfeit
  try {
    if (!m.ratingApplied) {
      await applyRatingForFinishedMatch(m._id);
      await onMatchFinished({ matchId: m._id });
    }
  } catch (err) {
    console.error("[rating] applyRatingForFinishedMatch error:", err);
  }

  const doc = await Match.findById(m._id)
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "nickname nickName user",
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
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
        {
          path: "player2",
          select: "nickname nickName user",
          populate: { path: "user", select: "nickname nickName" },
        },
      ],
    })
    .populate({ path: "referee", select: "name fullName nickname nickName" })
    .lean();

  if (!doc) return;

  // Ưu tiên player.nickname/nickName; nếu thiếu HOẶC rỗng -> fallback user.nickname/user.nickName
  const fillNick = (p) => {
    if (!p) return p;
    const pick = (v) => (v && String(v).trim()) || "";
    const primary = pick(p.nickname) || pick(p.nickName);
    const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
    const n = primary || fromUser || "";
    if (n) {
      p.nickname = n;
      p.nickName = n;
    }
    // (tuỳ chọn) giảm payload:
    // if (p.user) delete p.user;
    return p;
  };

  if (doc.pairA) {
    doc.pairA.player1 = fillNick(doc.pairA.player1);
    doc.pairA.player2 = fillNick(doc.pairA.player2);
  }
  if (doc.pairB) {
    doc.pairB.player1 = fillNick(doc.pairB.player1);
    doc.pairB.player2 = fillNick(doc.pairB.player2);
  }

  // (tuỳ chọn) nếu bạn có meta.streams muốn đính kèm
  if (!doc.streams && doc.meta?.streams) doc.streams = doc.meta.streams;

  io?.to(`match:${matchId}`)?.emit("match:update", {
    type: "finish",
    data: toDTO(doc),
  });
}

export async function forfeitMatch(matchId, winner, reason, by, io) {
  return finishMatch(matchId, winner, reason || "forfeit", by, io);
}
