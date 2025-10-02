// socket/liveHandlers.js
import Match from "../models/matchModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import usersOfReg from "../utils/usersOfReg.js";
import latestSnapshot from "../utils/getLastestSnapshot.js";
import { applyRatingForFinishedMatch } from "../utils/applyRatingForFinishedMatch.js";
import { onMatchFinished } from "../services/courtQueueService.js";
import { decorateServeAndSlots } from "../utils/liveServeUtils.js";

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
  // ================= helpers (chỉ dùng nội bộ, không thay đổi field cũ) ================
  const pick = (v) => (v && String(v).trim()) || "";
  const preferNick = (p) =>
    pick(p?.nickname) ||
    pick(p?.nickName) ||
    pick(p?.user?.nickname) ||
    pick(p?.user?.nickName) ||
    pick(p?.shortName) ||
    pick(p?.name) ||
    pick(p?.fullName);

  const normPlayer = (p) => {
    if (!p) return null;
    const _id = p._id || p.id || p; // hỗ trợ cả ObjectId và đã map sẵn
    return {
      _id,
      nickname: preferNick(p),
      name: p?.fullName || p?.name || "",
      shortName: p?.shortName || undefined,
    };
  };

  const playersFromReg = (reg) => {
    if (!reg || typeof reg !== "object") return [];
    const list = [normPlayer(reg.player1), normPlayer(reg.player2)].filter(
      Boolean
    );
    return list;
  };

  const teamNameFromReg = (reg) => {
    const ps = playersFromReg(reg);
    const nick = ps
      .map((x) => x.nickname)
      .filter(Boolean)
      .join(" & ");
    if (nick) return nick;
    // fallback: single -> p1, double -> p1 & p2 nếu có
    const a = preferNick(reg?.player1);
    const b = preferNick(reg?.player2);
    return [a, b].filter(Boolean).join(" & ");
  };

  // ---- map bracket (tái dùng cho bracket & prevBracket)
  const mapBracket = (b) => {
    if (!b) return null;
    return {
      _id: b._id || b,
      type: (b.type || "").toLowerCase(),
      name: b.name || "",
      order: b.order ?? undefined,
      stage: b.stage ?? undefined,
      drawRounds: b.drawRounds ?? 0,
      drawStatus: b.drawStatus || undefined,
      // meta cho tính rounds/scale
      meta: {
        drawSize: Number(b?.meta?.drawSize) || 0,
        maxRounds: Number(b?.meta?.maxRounds) || 0,
        expectedFirstRoundMatches:
          Number(b?.meta?.expectedFirstRoundMatches) || 0,
      },
      // groups để map B-index
      groups: Array.isArray(b.groups)
        ? b.groups.map((g) => ({
            _id: g._id || g.id || undefined,
            name: g.name || g.label || g.key || "",
            expectedSize: Number.isFinite(g.expectedSize)
              ? g.expectedSize
              : undefined,
          }))
        : [],
      // nếu cần FE hiển thị luật mặc định
      config: b.config
        ? {
            rules: b.config.rules || undefined,
            roundElim: b.config.roundElim || undefined,
            roundRobin: b.config.roundRobin || undefined,
            doubleElim: b.config.doubleElim || undefined,
            swiss: b.config.swiss || undefined,
            gsl: b.config.gsl || undefined,
          }
        : undefined,
      scheduler: b.scheduler || undefined,
      drawSettings: b.drawSettings || undefined,
      overlay: b.overlay || undefined,
      noRankDelta:
        typeof b.noRankDelta === "boolean" ? b.noRankDelta : undefined,
    };
  };

  // ================= Tournament (lite) =================
  const tournament = m.tournament
    ? {
        _id: m.tournament._id || m.tournament,
        name: m.tournament.name || "",
        image: m.tournament.image || "",
        eventType: (m.tournament.eventType || "").toLowerCase(),
        overlay: m.tournament.overlay || undefined,
      }
    : undefined;

  // ================= Bracket (đủ field để FE tính V/B) =================
  const bracket = m.bracket ? mapBracket(m.bracket) : undefined;

  // 🆕 prevBracket/prevBrackets (nếu đã được tính ở controller/socket)
  const prevBracket = m.prevBracket ? mapBracket(m.prevBracket) : null;
  const prevBrackets =
    Array.isArray(m.prevBrackets) && m.prevBrackets.length
      ? m.prevBrackets.map(mapBracket)
      : [];

  // ================= Overlay fallback: match → bracket → tournament =================
  const overlayFromMatch =
    m.overlay && typeof m.overlay === "object" && Object.keys(m.overlay).length
      ? m.overlay
      : null;
  const overlay =
    overlayFromMatch ?? bracket?.overlay ?? tournament?.overlay ?? undefined;

  // ================= Media =================
  const primaryVideo =
    typeof m.video === "string" && m.video.trim().length ? m.video.trim() : "";
  const videoUrl = typeof m.videoUrl === "string" ? m.videoUrl : undefined;
  const stream = typeof m.stream === "string" ? m.stream : undefined;
  const streams = Array.isArray(m.streams)
    ? m.streams
    : Array.isArray(m.meta?.streams)
    ? m.meta.streams
    : undefined;

  // ================= Users (lite) =================
  const normUserLite = (u) => {
    if (!u) return null;
    const nickname =
      (u.nickname && String(u.nickname).trim()) ||
      (u.nickName && String(u.nickName).trim()) ||
      "";
    return { _id: u._id, name: u.name || u.fullName || "", nickname };
  };

  const referees = Array.isArray(m.referee)
    ? m.referee.map(normUserLite).filter(Boolean)
    : [];

  const liveBy = m.liveBy ? normUserLite(m.liveBy) : null;

  // ================= Court (lite + fallback) =================
  const courtObj = m.court
    ? {
        _id: m.court._id || m.court,
        name:
          m.court.name ??
          (m.court.number != null ? `Sân ${m.court.number}` : ""),
        number: m.court.number,
        code: m.court.code,
        label: m.court.label,
        zone: m.court.zone ?? m.court.area,
        venue: m.court.venue,
        building: m.court.building,
        floor: m.court.floor,
      }
    : undefined;

  // ================= Format & Pool (phục vụ B-index) =================
  const format = (m.format || "").toLowerCase() || undefined;
  const rrRound = Number.isFinite(Number(m.rrRound))
    ? Number(m.rrRound)
    : undefined;
  const pool =
    m.pool && (m.pool.id || m.pool._id || m.pool.name)
      ? {
          id: m.pool.id || m.pool._id || undefined,
          name: m.pool.name || undefined, // "A" / "B" / ...
        }
      : undefined;

  // ================= roundCode & roundName (bổ sung) =================
  let roundCode = m.roundCode || undefined;
  if (!roundCode) {
    const drawSize =
      Number(m?.bracket?.meta?.drawSize) ||
      (Number.isInteger(m?.bracket?.drawRounds)
        ? 1 << m.bracket.drawRounds
        : 0);
    if (drawSize && Number.isInteger(m?.round) && m.round >= 1) {
      const roundSize = Math.max(
        2,
        Math.floor(drawSize / Math.pow(2, m.round - 1))
      );
      roundCode = `R${roundSize}`;
    }
  }
  const roundName = m.roundName || undefined;

  // ================= Teams (gộp sẵn để FE có thể dùng trực tiếp) =================
  const teams =
    m.pairA || m.pairB
      ? {
          A: m.pairA
            ? {
                name: teamNameFromReg(m.pairA),
                players: playersFromReg(m.pairA),
                seed: m?.pairA?.seed ?? undefined,
                label: m?.pairA?.label ?? undefined,
                teamName: m?.pairA?.teamName ?? undefined,
              }
            : undefined,
          B: m.pairB
            ? {
                name: teamNameFromReg(m.pairB),
                players: playersFromReg(m.pairB),
                seed: m?.pairB?.seed ?? undefined,
                label: m?.pairB?.label ?? undefined,
                teamName: m?.pairB?.teamName ?? undefined,
              }
            : undefined,
        }
      : undefined;

  // ================= Build DTO (giữ nguyên field cũ, chỉ thêm mới) =================
  return {
    _id: m._id,
    // 🔹 added: matchId (alias) cho FE nào expect matchId
    matchId: String(m._id),

    status: m.status,
    winner: m.winner,

    // vòng và thứ tự trong vòng
    round: m.round,
    rrRound, // <-- RR/Group round theo mẫu
    order: m.order,

    // 🔹 added: stageIndex, labelKey cho các màn hiển thị/điều hướng
    stageIndex: m.stageIndex ?? undefined,
    labelKey: m.labelKey || undefined,

    // 🔹 added: roundCode & roundName để FE render "Tứ kết/Bán kết..."
    roundCode,
    roundName,

    // format & pool để FE build mã Vx-Bx-Tx
    format,
    pool,

    // giữ nguyên rules, serve, scores...
    rules: m.rules || {},
    currentGame: m.currentGame ?? 0,
    gameScores: Array.isArray(m.gameScores) ? m.gameScores : [],

    // cặp/seed & phụ thuộc (giữ nguyên)
    pairA: m.pairA || null,
    pairB: m.pairB || null,
    seedA: m.seedA || null,
    seedB: m.seedB || null,
    previousA: m.previousA || null,
    previousB: m.previousB || null,
    nextMatch: m.nextMatch || null,

    // 🔹 added: teams (gộp sẵn tên + players); KHÔNG thay thế pairA/pairB
    teams,

    // referee list
    referees,
    // live controller
    liveBy,

    // thời gian
    scheduledAt: m.scheduledAt || null,
    startAt: m.startAt || undefined, // giữ nếu backend còn dùng
    startedAt: m.startedAt || null,
    finishedAt: m.finishedAt || null,

    version: m.liveVersion ?? 0,

    // giao ban đầu
    serve: m.serve || { side: "A", server: 2 },

    // liên kết
    tournament,
    bracket,
    bracketType: bracket?.type || undefined,

    // 🆕 thêm prevBracket & prevBrackets
    prevBracket, // object hoặc null
    prevBrackets, // mảng (có thể rỗng)

    overlay,

    // media
    video: primaryVideo || undefined,
    videoUrl,
    stream,
    streams,

    // court (đầy đủ + fallback keys)
    court: courtObj || null,
    courtId: courtObj?._id || undefined,
    courtName: courtObj?.name || undefined,
    courtNo: courtObj?.number ?? undefined,

    // hiển thị phụ
    label: m.label || undefined,
    managers: m.managers,

    // (tuỳ chọn) các field hàng chờ/sân nếu có — thêm không ảnh hưởng API cũ
    queueOrder: m.queueOrder ?? undefined,
    courtCluster: m.courtCluster || undefined,
    assignedAt: m.assignedAt || undefined,
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

      // ✅ cập nhật serve.serverId dựa trên base đã lưu
      const base = m?.meta?.slots?.base;
      if (base && base[m.serve.side]) {
        const map = base[m.serve.side]; // { userId: 1|2 }
        const wanted = Number(m.serve.server); // 1|2
        const entry = Object.entries(map).find(
          ([, slot]) => Number(slot) === wanted
        );
        m.serve.serverId = entry ? entry[0] : null;
      } else {
        // nếu chưa có base -> xoá id để FE fallback
        if (m.serve.serverId) m.serve.serverId = undefined;
      }
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

  const doc = await Match.findById(matchId)
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          // có đủ các tên + user.nickname để FE fallback
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
    // referee là mảng
    .populate({
      path: "referee",
      select: "name fullName nickname nickName",
    })
    // người đang điều khiển live
    .populate({ path: "liveBy", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    .populate({
      path: "tournament",
      select: "name image eventType overlay",
    })
    // 🆕 BRACKET: gửi đủ groups + meta + config như mẫu JSON bạn đưa
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
        // meta.*
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        // groups[]
        "groups._id",
        "groups.name",
        "groups.expectedSize",
        // rules + các config khác để FE tham chiếu
        "config.rules",
        "config.doubleElim",
        "config.roundRobin",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
        // nếu bạn có overlay ở bracket thì giữ lại
        "overlay",
      ].join(" "),
    })
    // 🆕 court để FE auto-next theo sân
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor",
    })
    .lean();
  io?.to(`match:${matchId}`)?.emit("match:update", {
    type: "point",
    data: toDTO(decorateServeAndSlots(doc)),
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
export async function setServe(matchId, side, server, serverId, by, io) {
  // --- validate đầu vào ---
  if (!matchId) throw new Error("matchId required");

  const sideU = String(side || "").toUpperCase();
  if (!["A", "B"].includes(sideU)) throw new Error("Invalid side");

  const srvNum = Number(server);
  if (![1, 2].includes(srvNum)) throw new Error("Invalid server number");

  // --- load match + người chơi để còn đối chiếu userId ---
  const m = await Match.findById(matchId)
    .populate({
      path: "pairA",
      select: "player1 player2",
      populate: [
        { path: "player1", select: "user" },
        { path: "player2", select: "user" },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2",
      populate: [
        { path: "player1", select: "user" },
        { path: "player2", select: "user" },
      ],
    });

  if (!m) throw new Error("Match not found");

  // --- helpers nhỏ ---
  const uidOf = (p) =>
    String(p?.user?._id || p?.user || p?._id || p?.id || "").trim();

  const playersA = [uidOf(m?.pairA?.player1), uidOf(m?.pairA?.player2)].filter(
    Boolean
  );
  const playersB = [uidOf(m?.pairB?.player1), uidOf(m?.pairB?.player2)].filter(
    Boolean
  );

  // serverId (nếu có) phải thuộc đúng đội
  if (serverId) {
    const s = String(serverId);
    const ok =
      (sideU === "A" && playersA.includes(s)) ||
      (sideU === "B" && playersB.includes(s));
    if (!ok) throw new Error("serverId not in team " + sideU);
  }

  // --- điểm hiện tại của ván đang chơi (để tính parity) ---
  const gs = Array.isArray(m.gameScores) ? m.gameScores : [];
  const gi = Math.max(0, gs.length - 1);
  const curA = Number(gs[gi]?.a || 0);
  const curB = Number(gs[gi]?.b || 0);

  // --- base map (từ slots.base), fallback p1=1, p2=2 nếu thiếu ---
  const baseA = (m?.slots?.base?.A && { ...m.slots.base.A }) || {};
  const baseB = (m?.slots?.base?.B && { ...m.slots.base.B }) || {};

  if (playersA[0] && ![1, 2].includes(Number(baseA[playersA[0]])))
    baseA[playersA[0]] = 1;
  if (playersA[1] && ![1, 2].includes(Number(baseA[playersA[1]])))
    baseA[playersA[1]] = 2;
  if (playersB[0] && ![1, 2].includes(Number(baseB[playersB[0]])))
    baseB[playersB[0]] = 1;
  if (playersB[1] && ![1, 2].includes(Number(baseB[playersB[1]])))
    baseB[playersB[1]] = 2;

  const flip = (n) => (n === 1 ? 2 : 1);
  const slotNow = (baseSlot, teamScore) =>
    teamScore % 2 === 0 ? baseSlot : flip(baseSlot);

  // --- chọn serverId nếu client không gửi: ưu tiên người có baseSlot=1 ---
  let serverUid = serverId ? String(serverId) : "";
  if (!serverUid) {
    const teamList = sideU === "A" ? playersA : playersB;
    const teamBase = sideU === "A" ? baseA : baseB;
    serverUid =
      teamList.find((u) => Number(teamBase[u]) === 1) || teamList[0] || "";
  }

  // --- slot hiện tại của người giao ---
  const baseSlotOfServer =
    sideU === "A"
      ? Number(baseA[serverUid] || 1)
      : Number(baseB[serverUid] || 1);

  const teamScore = sideU === "A" ? curA : curB;
  const serverSlotNow = slotNow(baseSlotOfServer, teamScore);

  // --- tìm người đỡ bên còn lại: ai đang đứng CÙNG Ô với server ---
  const otherSide = sideU === "A" ? "B" : "A";
  const otherList = otherSide === "A" ? playersA : playersB;
  const otherBase = otherSide === "A" ? baseA : baseB;
  const otherScore = otherSide === "A" ? curA : curB;

  let receiverUid = "";
  for (const u of otherList) {
    const b = Number(otherBase[u] || 1);
    if (slotNow(b, otherScore) === serverSlotNow) {
      receiverUid = u;
      break;
    }
  }

  // --- lưu serve + serverId + receiverId ---
  const prevServe = m.serve || { side: "A", server: 2 };

  m.set("serve.side", sideU, { strict: false });
  m.set("serve.server", srvNum, { strict: false });
  if (serverUid) m.set("serve.serverId", serverUid, { strict: false });
  if (receiverUid) m.set("serve.receiverId", receiverUid, { strict: false });

  // để FE tương thích: FE đang đọc receiverId từ slots.receiverId
  m.set("slots.receiverId", receiverUid || null, { strict: false });
  m.set("slots.serverId", serverUid || null, { strict: false });
  m.set("slots.updatedAt", new Date(), { strict: false });
  const prevVer = Number(m?.slots?.version || 0);
  m.set("slots.version", prevVer + 1, { strict: false });
  m.markModified("slots");

  // log + version
  m.liveLog = m.liveLog || [];
  m.liveLog.push({
    type: "serve",
    by,
    payload: {
      prev: prevServe,
      next: {
        side: sideU,
        server: srvNum,
        serverId: serverUid || null,
        receiverId: receiverUid || null,
      },
    },
    at: new Date(),
  });
  m.liveVersion = Number(m.liveVersion || 0) + 1;

  await m.save();

  // phát update
  const doc = await Match.findById(m._id).populate("pairA pairB referee");
  io?.to(`match:${matchId}`)?.emit("match:update", {
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
