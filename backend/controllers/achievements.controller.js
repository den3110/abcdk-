// controllers/achievements.controller.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import Registration from "../models/registrationModel.js"; // chỉnh path nếu khác

/* ==================== Helpers ==================== */
const OID = (v) => new mongoose.Types.ObjectId(String(v || "").trim());
const sameId = (a, b) => String(a || "") === String(b || "");

// ❗️Chỉ tính thứ hạng cho bracket type === "knockout"
const KO_TYPE = "knockout";

const matchDT = (m) =>
  m?.finishedAt || m?.startedAt || m?.scheduledAt || m?.createdAt || null;

function usersOfReg(reg) {
  const ids = [];
  const u1 = reg?.player1?.user ? String(reg.player1.user) : null;
  const u2 = reg?.player2?.user ? String(reg.player2.user) : null;
  if (u1) ids.push(u1);
  if (u2) ids.push(u2);
  return ids;
}

function ceilPow2(n) {
  if (!n || n < 1) return 2;
  return 1 << Math.ceil(Math.log2(n));
}
function toNumberOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Vòng loại / play-in… thì không tính thứ hạng
const isQualifierName = (name = "") => {
  const s = String(name || "").toLowerCase();
  return (
    /\b(pre[-\s]?qual|qualif?y|qualifier|play[-\s]?in)\b/i.test(s) ||
    s.startsWith("q ") ||
    s.includes(" q ") ||
    s.endsWith(" q")
  );
};

const labelFromTopK = (top) => {
  if (top === 1) return "Vô địch";
  if (top === 2) return "Á quân";
  if (top === 3) return "Hạng 3";
  if (top === 4) return "Top 4";
  if (top === 8) return "Top 8";
  if (top === 16) return "Top 16";
  return `Top ${top}`;
};

/* ==================== Controller ==================== */
/**
 * Quy tắc:
 * - Thứ hạng (Top mấy) CHỈ tính khi người chơi ở BRACKET KO CUỐI (final knockout) của giải
 *   và BRACKET đó phải có type === "knockout".
 * - roundElim / qualifier / play-in => KHÔNG tính thứ hạng.
 * - Nếu đã VÀO một vòng (có trận ở vòng đó) nhưng chưa đánh xong ⇒ topK tối thiểu của vòng đó.
 * - Win/Loss/Streak tính trên các trận đã kết thúc.
 * - perBracket: TRẢ ĐỦ TẤT CẢ BRACKET user đã tham gia, kèm chi tiết theo vòng.
 */
export const getUserAchievements = asyncHandler(async (req, res) => {
  const userId = OID(req.params.userId);

  /* ---------- 1) Trận đã kết thúc (để tính W/L/Streak) ---------- */
  const rawFinished = await Match.find({
    status: "finished",
    winner: { $in: ["A", "B"] },
    $or: [{ pairA: { $ne: null } }, { pairB: { $ne: null } }],
  })
    .select(
      "_id tournament bracket winner round order code branch format " +
        "pairA pairB finishedAt startedAt scheduledAt createdAt meta"
    )
    .lean();

  /* ---------- 2) Tất cả registration của user (để bắt trận chưa kết thúc) ---------- */
  const regsOfUser = await Registration.find({
    $or: [{ "player1.user": userId }, { "player2.user": userId }],
  })
    .select("_id tournament")
    .lean();
  const regIdsOfUser = regsOfUser.map((r) => String(r._id));

  if (!rawFinished.length && !regIdsOfUser.length) {
    return res.json({
      userId: String(userId),
      summary: {
        totalPlayed: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        longestWinStreak: 0,
        currentStreak: 0,
        lastPlayedAt: null,
        titles: 0,
        finals: 0,
        podiums: 0,
        careerBestTop: null,
        careerBestLabel: "—",
      },
      perBracket: [],
      perTournament: [],
    });
  }

  /* ---------- 3) Map reg cho finished ---------- */
  const pairIdsFinished = [
    ...new Set(
      rawFinished.flatMap((m) => [m.pairA, m.pairB].filter(Boolean).map(String))
    ),
  ];
  const regsFinished = await Registration.find({
    _id: { $in: pairIdsFinished },
  })
    .select("_id player1.user player2.user")
    .lean();
  const regMapFinished = new Map(regsFinished.map((r) => [String(r._id), r]));

  const finished = rawFinished
    .map((m) => {
      const rA = m.pairA ? regMapFinished.get(String(m.pairA)) : null;
      const rB = m.pairB ? regMapFinished.get(String(m.pairB)) : null;
      const u = String(userId);
      const onA = rA ? usersOfReg(rA).some((x) => sameId(x, u)) : false;
      const onB = rB ? usersOfReg(rB).some((x) => sameId(x, u)) : false;
      if (!onA && !onB) return null;
      return { ...m, onA, onB, dt: matchDT(m) };
    })
    .filter(Boolean);

  /* ---------- 4) W/L/Streak ---------- */
  const asc = [...finished].sort((a, b) => new Date(a.dt) - new Date(b.dt));
  const desc = [...finished].sort((a, b) => new Date(b.dt) - new Date(a.dt));

  let wins = 0,
    losses = 0,
    currentStreak = 0,
    longestWinStreak = 0;

  asc.forEach((m) => {
    const w = (m.winner === "A" && m.onA) || (m.winner === "B" && m.onB);
    const l = (m.winner === "A" && m.onB) || (m.winner === "B" && m.onA);
    if (w) {
      wins++;
      currentStreak++;
      longestWinStreak = Math.max(longestWinStreak, currentStreak);
    } else if (l) {
      losses++;
      currentStreak = 0;
    }
  });

  const totalPlayed = wins + losses;
  const winRate = totalPlayed ? (wins / totalPlayed) * 100 : 0;
  const lastPlayedAt = desc[0]?.dt || null;

  /* ---------- 5) Load toàn bộ bracket/tournament liên quan ---------- */
  const tIdsFromFinished = [
    ...new Set(finished.map((m) => String(m.tournament))),
  ];
  const tIdsFromRegs = [
    ...new Set(regsOfUser.map((r) => String(r.tournament)).filter(Boolean)),
  ];
  const tIds = [...new Set([...tIdsFromFinished, ...tIdsFromRegs])];

  const [bracketsAll, tournaments] = await Promise.all([
    Bracket.find({ tournament: { $in: tIds.map(OID) } })
      .select("_id tournament name type meta drawRounds stage order")
      .lean(),
    Tournament.find({ _id: { $in: tIds.map(OID) } })
      .select("_id name startDate endDate season year")
      .lean(),
  ]);

  const bMap = new Map(bracketsAll.map((b) => [String(b._id), b]));
  const tMap = new Map(tournaments.map((t) => [String(t._id), t]));

  // nhóm finished theo bracket
  const finishedByBracket = new Map();
  finished.forEach((m) => {
    const k = String(m.bracket);
    if (!finishedByBracket.has(k)) finishedByBracket.set(k, []);
    finishedByBracket.get(k).push(m);
  });

  /* ---------- 6) Tìm final knockout (terminal KO) của mỗi giải ---------- */
  const seedConsumers = await Match.find({
    tournament: { $in: tIds.map(OID) },
    $or: [
      { "seedA.type": "stageMatchWinner" },
      { "seedB.type": "stageMatchWinner" },
      { "seedA.type": "stageMatchLoser" },
      { "seedB.type": "stageMatchLoser" },
    ],
  })
    .select("tournament seedA seedB")
    .lean();

  const stagesConsumedByTour = new Map(); // tid -> Set(stageIndex)
  for (const m of seedConsumers) {
    const tid = String(m.tournament);
    const set = stagesConsumedByTour.get(tid) || new Set();
    const sA =
      toNumberOrNull(m?.seedA?.ref?.stageIndex ?? m?.seedA?.ref?.stage) ?? null;
    const sB =
      toNumberOrNull(m?.seedB?.ref?.stageIndex ?? m?.seedB?.ref?.stage) ?? null;
    if (sA != null) set.add(sA);
    if (sB != null) set.add(sB);
    stagesConsumedByTour.set(tid, set);
  }

  const terminalKOByTour = new Map(); // tid -> [bracketId]
  for (const tid of tIds.map(String)) {
    const consumed = stagesConsumedByTour.get(tid) || new Set();
    const candidates = bracketsAll.filter(
      (b) =>
        String(b.tournament) === tid &&
        b.type === KO_TYPE &&
        !isQualifierName(b.name) &&
        !consumed.has(toNumberOrNull(b.stage))
    );
    if (candidates.length) {
      candidates.sort(
        (a, b) =>
          (toNumberOrNull(b.stage) || 0) - (toNumberOrNull(a.stage) || 0) ||
          (toNumberOrNull(b.order) || 0) - (toNumberOrNull(a.order) || 0)
      );
      terminalKOByTour.set(
        tid,
        candidates.map((x) => String(x._id))
      );
    } else {
      const ko = bracketsAll
        .filter(
          (b) =>
            String(b.tournament) === tid &&
            b.type === KO_TYPE &&
            !isQualifierName(b.name)
        )
        .sort(
          (a, b) =>
            (toNumberOrNull(b.stage) || 0) - (toNumberOrNull(a.stage) || 0) ||
            (toNumberOrNull(b.order) || 0) - (toNumberOrNull(a.order) || 0)
        );
      terminalKOByTour.set(tid, ko.length ? [String(ko[0]._id)] : []);
    }
  }
  const allTerminalBids = new Set(
    [...terminalKOByTour.values()].flat().map(String)
  );

  /* ---------- 7) Lấy các trận (mọi trạng thái) ở FINAL KO để biết “đã vào vòng” ---------- */
  let upcomingInFinalKO = [];
  if (regIdsOfUser.length && allTerminalBids.size) {
    upcomingInFinalKO = await Match.find({
      bracket: { $in: [...allTerminalBids].map(OID) },
      $or: [
        { pairA: { $in: regIdsOfUser.map(OID) } },
        { pairB: { $in: regIdsOfUser.map(OID) } },
      ],
      status: { $in: ["scheduled", "queued", "assigned", "live", "finished"] },
    })
      .select(
        "_id tournament bracket winner round order status code " +
          "pairA pairB finishedAt startedAt scheduledAt createdAt"
      )
      .lean();
  }

  // gom mọi trạng thái theo bracket (chỉ cho final KO)
  const anyByBracketFinal = new Map();
  for (const m of upcomingInFinalKO) {
    const k = String(m.bracket);
    if (!anyByBracketFinal.has(k)) anyByBracketFinal.set(k, []);
    anyByBracketFinal.get(k).push({ ...m, dt: matchDT(m) });
  }
  for (const [bid, list] of finishedByBracket.entries()) {
    if (!allTerminalBids.has(String(bid))) continue;
    const arr = anyByBracketFinal.get(bid) || [];
    const existing = new Set(arr.map((x) => String(x._id)));
    for (const m of list) if (!existing.has(String(m._id))) arr.push(m);
    anyByBracketFinal.set(bid, arr);
  }

  /* ---------- 8) Build entries cho perBracket (TẤT CẢ bracket) ---------- */
  function drawSizeOf(brDoc, ms) {
    const metaDS = Number(brDoc?.meta?.drawSize);
    if (Number.isFinite(metaDS) && metaDS > 1) return metaDS;
    const regPairs = new Set(
      ms.flatMap((m) => [
        m.pairA ? String(m.pairA) : null,
        m.pairB ? String(m.pairB) : null,
      ])
    );
    const approxTeams = [...regPairs].filter(Boolean).length;
    return ceilPow2(Math.max(approxTeams, 2));
  }

  // tập tất cả bracket user có liên quan: finished + finalKO upcoming
  const relatedBids = new Set([
    ...finishedByBracket.keys(),
    ...anyByBracketFinal.keys(),
  ]);

  const perBracket = [];
  for (const bid of relatedBids) {
    const br = bMap.get(bid);
    if (!br) continue;
    const tid = String(br.tournament || "");
    const t = tMap.get(tid);

    const isKnockout = br?.type === KO_TYPE;
    const isQualifier = isQualifierName(br?.name || "");
    const isFinalKO = isKnockout && !isQualifier && allTerminalBids.has(bid);

    // danh sách trận dùng tính vòng đã vào:
    const msAny = isFinalKO
      ? anyByBracketFinal.get(bid) || []
      : finishedByBracket.get(bid) || [];
    const msFinished = finishedByBracket.get(bid) || [];

    // Nếu không có trận nào liên quan (edge), bỏ qua
    if (!msAny.length && !msFinished.length) continue;

    // roundMax / drawSize (dựa vào msAny nếu có, ngược lại msFinished)
    const baseForSize = msAny.length ? msAny : msFinished;
    const ds = drawSizeOf(br, baseForSize);
    const roundMax =
      Number(br?.meta?.maxRounds) ||
      (Number.isInteger(br?.drawRounds) && br.drawRounds > 0
        ? br.drawRounds
        : Math.round(Math.log2(ds)) || 1);

    // rounds entered
    const roundsEntered = (msAny.length ? msAny : msFinished)
      .map((m) => Number(m.round) || 1)
      .filter((v) => v >= 1);
    const deepestEntered = roundsEntered.length
      ? Math.max(...roundsEntered)
      : null;

    // thống kê theo round từ các trận finished
    const winsByRound = {};
    const lossesByRound = {};
    for (const m of msFinished) {
      const r = Number(m.round) || 1;
      const win = (m.winner === "A" && m.onA) || (m.winner === "B" && m.onB);
      const lose = (m.winner === "A" && m.onB) || (m.winner === "B" && m.onA);
      if (win) winsByRound[r] = (winsByRound[r] || 0) + 1;
      if (lose) lossesByRound[r] = (lossesByRound[r] || 0) + 1;
    }

    // tính top cho FINAL KO
    let topK = null;
    let confirmed = false;
    if (isFinalKO) {
      // đã thua ở vòng nào?
      const byRoundFinished = [...msFinished].sort(
        (a, b) => (a.round || 1) - (b.round || 1)
      );
      let lostRoundIdx = null;
      let wonFinal = false;

      for (const m of byRoundFinished) {
        const rIdx = Number(m.round) > 0 ? Number(m.round) : 1;
        const win = (m.winner === "A" && m.onA) || (m.winner === "B" && m.onB);
        const lose = (m.winner === "A" && m.onB) || (m.winner === "B" && m.onA);
        if (rIdx === roundMax && win) wonFinal = true;
        if (lose && lostRoundIdx == null) lostRoundIdx = rIdx;
      }

      if (wonFinal) {
        topK = 1;
        confirmed = true;
      } else if (lostRoundIdx != null) {
        topK = 2 ** (roundMax - lostRoundIdx + 1);
        topK = Math.min(topK, ds);
        confirmed = true;
      } else if (deepestEntered != null) {
        // chưa thua, nhưng đã vào vòng sâu hơn → top tối thiểu
        topK = 2 ** (roundMax - deepestEntered + 1);
        topK = Math.min(topK, ds);
        confirmed = false;
      }
    }

    // tổng quan bracket (dựa trên finished)
    const winsB = msFinished.filter(
      (m) => (m.winner === "A" && m.onA) || (m.winner === "B" && m.onB)
    ).length;
    const lossesB = msFinished.filter(
      (m) => (m.winner === "A" && m.onB) || (m.winner === "B" && m.onA)
    ).length;

    // last time (ưu tiên mọi trạng thái để FE sắp)
    const lastAnyAt =
      (msAny.length ? msAny : msFinished)
        .map((m) => matchDT(m))
        .sort((a, b) => new Date(b) - new Date(a))[0] || null;

    perBracket.push({
      tournamentId: tid || null,
      tournamentName: t?.name || "—",
      tournamentStart: t?.startDate || null,
      tournamentEnd: t?.endDate || null,
      season: t?.season ?? t?.year ?? null,

      bracketId: bid,
      bracketName: br?.name || "—",
      bracketType: br?.type || "knockout",
      stage: toNumberOrNull(br?.stage) ?? null,
      order: toNumberOrNull(br?.order) ?? null,
      isQualifier,
      isFinalKO,

      drawSize: ds,
      roundMax,

      // ==== Thứ hạng ====
      topK, // null nếu không phải final KO
      confirmed, // true nếu đã chốt (thua/vô địch), false = top tối thiểu khi đã vào vòng

      // ==== Thống kê ====
      stats: {
        played: winsB + lossesB,
        wins: winsB,
        losses: lossesB,
        winRate: winsB + lossesB ? (winsB / (winsB + lossesB)) * 100 : 0,
      },

      // ==== Chi tiết theo vòng (hiện hết) ====
      rounds: {
        enteredRounds: [...new Set(roundsEntered)].sort((a, b) => a - b),
        deepestEntered,
        winsByRound,
        lossesByRound,
      },

      lastMatchAt: lastAnyAt,
    });
  }

  // sort perBracket cho dễ xem: theo giải, rồi theo stage↓, order↓, rồi thời gian
  perBracket.sort((a, b) => {
    if (a.tournamentId !== b.tournamentId) {
      return String(a.tournamentId || "").localeCompare(
        String(b.tournamentId || "")
      );
    }
    return (
      (toNumberOrNull(b.stage) || 0) - (toNumberOrNull(a.stage) || 0) ||
      (toNumberOrNull(b.order) || 0) - (toNumberOrNull(a.order) || 0) ||
      new Date(b.lastMatchAt || 0) - new Date(a.lastMatchAt || 0)
    );
  });

  /* ---------- 9) perTournament: chỉ lấy các record final KO ---------- */
  const perTournament = [];
  {
    const group = new Map();
    for (const r of perBracket) {
      if (!r.isFinalKO) continue;
      const key = r.tournamentId || "null";
      if (!group.has(key)) group.set(key, []);
      group.get(key).push(r);
    }
    for (const arr of group.values()) {
      arr.sort((a, b) => {
        if (a.topK != null && b.topK != null && a.topK !== b.topK) {
          return a.topK - b.topK;
        }
        return new Date(b.lastMatchAt || 0) - new Date(a.lastMatchAt || 0);
      });
      perTournament.push(...arr);
    }
  }

  /* ---------- 10) Danh hiệu: chỉ đếm kết quả final KO đã xác nhận ---------- */
  const onlyFinalKOConfirmed = perBracket.filter(
    (x) => x.isFinalKO && x.confirmed
  );
  const titles = onlyFinalKOConfirmed.filter((x) => x.topK === 1).length;
  const finals = onlyFinalKOConfirmed.filter(
    (x) => x.topK === 1 || x.topK === 2
  ).length;
  const podiums = onlyFinalKOConfirmed.filter((x) =>
    [1, 2, 3].includes(x.topK)
  ).length;

  // career best: lấy best trong tất cả perBracket (bao gồm top tối thiểu)
  const careerBestTop = perBracket
    .map((x) => x.topK)
    .filter((x) => x != null)
    .reduce((min, v) => (min == null || v < min ? v : min), null);

  /* ---------- 11) Trả về ---------- */
  return res.json({
    userId: String(userId),
    summary: {
      totalPlayed,
      wins,
      losses,
      winRate,
      longestWinStreak,
      currentStreak,
      lastPlayedAt,
      titles,
      finals,
      podiums,
      careerBestTop,
      careerBestLabel:
        careerBestTop != null ? labelFromTopK(careerBestTop) : "—",
    },
    perBracket, // ← đã “hiện hết” kèm rounds detail
    perTournament, // ← chỉ final KO
  });
});
