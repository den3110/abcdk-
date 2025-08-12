// socket/liveHandlers.js
import Match from "../models/matchModel.js";

export const toDTO = (m) => ({
  _id: m._id,
  status: m.status,
  winner: m.winner,
  rules: m.rules,
  currentGame: m.currentGame ?? 0,
  gameScores: m.gameScores || [],
  pairA: m.pairA,
  pairB: m.pairB,
  referee: m.referee,
  tournament: m.tournament,
  scheduledAt: m.scheduledAt,
  startedAt: m.startedAt,
  finishedAt: m.finishedAt,
  version: m.liveVersion ?? 0,
  // ✅ gửi serve cho FE
  serve: m.serve || { side: "A", server: 2 },
});

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

export async function addPoint(matchId, team, step = 1, by, io) {
  const m = await Match.findById(matchId);
  if (!m || m.status !== "live") return;

  const gi = m.currentGame ?? 0;
  const cur = m.gameScores[gi] || { a: 0, b: 0 };
  const prevServe = m.serve || { side: "A", server: 2 };

  if (team === "A") cur.a += step;
  if (team === "B") cur.b += step;
  m.gameScores[gi] = cur;

  // ✅ tính đổi lượt theo rally:
  // - Nếu đội giao thắng rally => ghi điểm, giữ nguyên serve
  // - Nếu đội nhận thắng rally => không cộng điểm cho serve team, chuyển lượt: (#1 -> #2), (#2 -> side out)
  const servingTeam = prevServe.side;
  const scoredForServing = team === servingTeam;

  if (!scoredForServing) {
    m.serve = onLostRallyNextServe(prevServe);
  }
  // Nếu scoredForServing=true: giữ nguyên m.serve; (không đổi #, đúng luật “người giao tiếp tục giao”)

  // ✅ xử lý kết thúc ván + tạo ván mới
  const { pointsToWin, winByTwo, bestOf } = m.rules || {};
  let ended = null;
  if (gameWon(cur.a, cur.b, pointsToWin, winByTwo)) ended = "A";
  if (gameWon(cur.b, cur.a, pointsToWin, winByTwo)) ended = "B";

  if (ended) {
    const countWins = (side) =>
      m.gameScores.reduce((acc, s) => {
        if (side === "A" && gameWon(s.a, s.b, pointsToWin, winByTwo))
          return acc + 1;
        if (side === "B" && gameWon(s.b, s.a, pointsToWin, winByTwo))
          return acc + 1;
        return acc;
      }, 0);

    const target = gamesToWin(bestOf);
    const wonA = countWins("A");
    const wonB = countWins("B");

    if (wonA >= target || wonB >= target) {
      m.status = "finished";
      m.winner = wonA > wonB ? "A" : "B";
      m.finishedAt = new Date();
    } else {
      // ✅ mở ván mới & reset serve về 0-0-2 cho fairness
      m.gameScores.push({ a: 0, b: 0 });
      m.currentGame = gi + 1;
      m.serve = { side: m.serve.side === "A" ? "B" : "A", server: 2 }; // alternating side, server=2
    }
  }

  // log + tăng version
  m.liveLog = m.liveLog || [];
  m.liveLog.push({
    type: "point",
    by,
    payload: { team, step, prevServe }, // ✅ lưu prevServe để UNDO
    at: new Date(),
  });
  m.liveVersion = (m.liveVersion || 0) + 1;
  await m.save();

  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io.to(`match:${matchId}`).emit("match:update", {
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

  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io.to(matchId).emit("match:update", { type: "finish", data: toDTO(doc) });
}

export async function forfeitMatch(matchId, winner, reason, by, io) {
  return finishMatch(matchId, winner, reason || "forfeit", by, io);
}
