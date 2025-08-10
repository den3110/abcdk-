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
});

const gamesToWin = (bestOf) => Math.floor(bestOf / 2) + 1;
const gameWon = (x, y, pts, byTwo) =>
  x >= pts && (byTwo ? x - y >= 2 : x - y >= 1);

export async function startMatch(matchId, refereeId, io) {
  const m = await Match.findById(matchId);
  if (!m || m.status === "finished") return;

  m.status = "live";
  m.startedAt = new Date();
  if (!m.gameScores || !m.gameScores.length) m.gameScores = [{ a: 0, b: 0 }];
  m.currentGame = 0;
  m.liveBy = refereeId || null;
  m.liveVersion = (m.liveVersion || 0) + 1;
  m.liveLog = m.liveLog || [];
  m.liveLog.push({ type: "start", by: refereeId, at: new Date() });
  await m.save();

  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io.to(matchId).emit("match:update", { type: "start", data: toDTO(doc) });
}

export async function addPoint(matchId, team, step = 1, by, io) {
  const m = await Match.findById(matchId);
  if (!m || m.status !== "live") return;

  const gi = m.currentGame ?? 0;
  const cur = m.gameScores[gi] || { a: 0, b: 0 };
  if (team === "A") cur.a += step;
  if (team === "B") cur.b += step;
  m.gameScores[gi] = cur;

  const { pointsToWin, winByTwo, bestOf } = m.rules;
  let ended = null;
  if (gameWon(cur.a, cur.b, pointsToWin, winByTwo)) ended = "A";
  if (gameWon(cur.b, cur.a, pointsToWin, winByTwo)) ended = "B";

  if (ended) {
    // đếm ván thắng mỗi bên
    const count = (side) =>
      m.gameScores.reduce((acc, s) => {
        if (side === "A" && gameWon(s.a, s.b, pointsToWin, winByTwo))
          return acc + 1;
        if (side === "B" && gameWon(s.b, s.a, pointsToWin, winByTwo))
          return acc + 1;
        return acc;
      }, 0);

    const target = gamesToWin(bestOf);
    const wonA = count("A");
    const wonB = count("B");

    if (wonA >= target || wonB >= target) {
      m.status = "finished";
      m.winner = wonA > wonB ? "A" : "B";
      m.finishedAt = new Date();
    } else {
      // mở ván mới
      m.gameScores.push({ a: 0, b: 0 });
      m.currentGame = gi + 1;
    }
  }

  m.liveLog = m.liveLog || [];
  m.liveLog.push({
    type: "point",
    by,
    payload: { team, step },
    at: new Date(),
  });
  m.liveVersion = (m.liveVersion || 0) + 1;
  await m.save();

  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io.to(matchId).emit("match:update", { type: "point", data: toDTO(doc) });
}

export async function undoLast(matchId, by, io) {
  const m = await Match.findById(matchId);
  if (!m || !m.liveLog?.length) return;

  // tìm event point gần nhất và đảo ngược
  for (let i = m.liveLog.length - 1; i >= 0; i--) {
    const ev = m.liveLog[i];
    if (ev.type === "point") {
      if (m.status === "finished") {
        m.status = "live";
        m.winner = "";
        m.finishedAt = null;
      }

      // nếu đang ở ván mới chưa điểm -> quay lại ván trước
      if (m.currentGame > 0) {
        const cg = m.gameScores[m.currentGame];
        if (cg?.a === 0 && cg?.b === 0) {
          m.gameScores.pop();
          m.currentGame = m.currentGame - 1;
        }
      }
      const g = m.gameScores[m.currentGame || 0];
      if (ev.payload.team === "A") g.a -= ev.payload.step || 1;
      if (ev.payload.team === "B") g.b -= ev.payload.step || 1;

      m.liveLog.splice(i, 1);
      m.liveVersion = (m.liveVersion || 0) + 1;
      await m.save();

      const doc = await Match.findById(m._id).populate("pairA pairB referee");
      io.to(matchId).emit("match:update", { type: "undo", data: toDTO(doc) });
      return;
    }
  }
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
