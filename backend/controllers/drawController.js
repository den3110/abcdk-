// controllers/drawController.js
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import DrawSession from "../models/drawSessionModel.js";
import Bracket from "../models/bracketModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import Match from "../models/matchModel.js";

import { planGroups } from "../utils/draw/groupPlanner.js";
import { buildRoundRobin } from "../utils/draw/roundRobin.js";
import {
  selectNextCandidate,
  advanceCursor,
} from "../utils/draw/selectNext.js";

const asId = (x) => new mongoose.Types.ObjectId(String(x));

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function eventTypeOf(tourDoc) {
  return tourDoc?.eventType === "single" ? "single" : "double";
}

function normalizeRoundKey(k) {
  if (!k) return null;
  const up = String(k).toUpperCase();
  const valid = [
    "R2048",
    "R1024",
    "R512",
    "R256",
    "R128",
    "R64",
    "R32",
    "R16",
    "QF",
    "SF",
    "F",
  ];
  return valid.includes(up) ? up : null;
}

function roundKeyToPairs(k) {
  const up = normalizeRoundKey(k);
  if (!up) return null;
  if (up.startsWith("R") && Number.isFinite(+up.slice(1))) {
    const teams = +up.slice(1);
    return teams / 2;
  }
  switch (up) {
    case "QF":
      return 4;
    case "SF":
      return 2;
    case "F":
      return 1;
    default:
      return null;
  }
}

// Tạo key nhóm: A, B, C... nếu >26 thì G27, G28...
function groupKeys(count) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  if (count <= alphabet.length) return alphabet.slice(0, count);
  return Array.from({ length: count }, (_, i) =>
    i < 26 ? alphabet[i] : `G${i + 1}`
  );
}

const nameFromPlayer = (p) => p?.fullName || p?.name || p?.nickname || null;

const regDisplayName = (reg, evType = "double") => {
  if (!reg) return "—";
  if (evType === "single") return nameFromPlayer(reg?.player1) || "—";
  const p1 = nameFromPlayer(reg?.player1);
  const p2 = nameFromPlayer(reg?.player2);
  return p1 && p2 ? `${p1} & ${p2}` : p1 || p2 || "—";
};

async function getNameMap(regIds, evType = "double") {
  if (!regIds?.length) return new Map();
  const docs = await Registration.find({ _id: { $in: regIds } })
    .select("_id player1 player2")
    .lean();
  const map = new Map();
  docs.forEach((r) => map.set(String(r._id), regDisplayName(r, evType)));
  return map;
}

async function computeReveals(session) {
  const evType = eventTypeOf(
    await Tournament.findById(session.tournament).select("eventType")
  );

  const inBoardIds = new Set();
  if (session.mode === "group") {
    for (const g of session.board.groups || []) {
      for (const rid of g.slots || []) if (rid) inBoardIds.add(String(rid));
    }
  } else {
    for (const p of session.board.pairs || []) {
      if (p?.a) inBoardIds.add(String(p.a));
      if (p?.b) inBoardIds.add(String(p.b));
    }
  }

  const nameMap = await getNameMap([...inBoardIds], evType);

  if (session.mode === "group") {
    const out = [];
    (session.board.groups || []).forEach((g, gi) => {
      (g.slots || []).forEach((rid) => {
        if (rid) {
          out.push({
            group: gi + 1, // số thứ tự (FE đang dùng để hiển thị)
            groupKey: g.key || null, // nhãn A/B/C để hiển thị đẹp
            teamName: nameMap.get(String(rid)) || String(rid),
          });
        }
      });
    });
    return out;
  }

  // knockout
  return (session.board.pairs || []).map((p) => ({
    AName: p?.a ? nameMap.get(String(p.a)) || String(p.a) : null,
    BName: p?.b ? nameMap.get(String(p.b)) || String(p.b) : null,
  }));
}

function emitPlanned(io, bracketId, planned, groupsPreview = []) {
  io?.to(`draw:${String(bracketId)}`)?.emit("draw:planned", {
    bracketId: String(bracketId),
    planned,
    groups: groupsPreview,
  });
}

async function emitUpdate(io, session) {
  const reveals = await computeReveals(session);
  const payload = {
    state: session.status === "active" ? "running" : session.status,
    reveals,
  };

  const roomBracket = `draw:${String(session.bracket)}`;
  const roomSession = `drawsess:${String(session._id)}`;

  io?.to(roomBracket)?.emit("draw:update", payload);
  io?.to(roomSession)?.emit("draw:update", payload);

  // tương thích app cũ (nếu FE đang listen 'draw:revealed')
  io?.to(roomBracket)?.emit("draw:revealed", payload);
  io?.to(roomSession)?.emit("draw:revealed", payload);
}

function emitTerminal(io, session, type /* 'committed' | 'canceled' */) {
  const roomBracket = `draw:${String(session.bracket)}`;
  const roomSession = `drawsess:${String(session._id)}`;
  io?.to(roomBracket)?.emit(`draw:${type}`, { session });
  io?.to(roomSession)?.emit(`draw:${type}`, { session });
}

// ==== KO helpers (map round code ↔ đội, round number) ====
function codeToTeams(k) {
  const up = String(k || "").toUpperCase();
  if (up === "QF") return 8;
  if (up === "SF") return 4;
  if (up === "F") return 2;
  if (up.startsWith("R")) {
    const n = +up.slice(1);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function nextPow2(n) {
  let p = 1;
  const need = Math.max(2, n | 0);
  while (p < need) p <<= 1;
  return p;
}
async function calcRoundNumberForCode(tournamentId, code) {
  const totalTeams = await Registration.countDocuments({
    tournament: tournamentId,
    "payment.status": "Paid",
  });
  const full = nextPow2(totalTeams);
  const totalRounds = Math.max(1, Math.log2(full));
  const stageTeams = codeToTeams(code) || 2;
  return Math.max(1, Math.round(totalRounds - Math.log2(stageTeams) + 1));
}

// === Purge helpers: chỉ xoá đúng các trận đã tạo bởi lần commit trước ===
async function getLastCommittedSession(
  bracketId,
  mode,
  roundKey /* null cho group */
) {
  const q = {
    bracket: new mongoose.Types.ObjectId(String(bracketId)),
    status: "committed",
    mode,
  };
  if (mode === "knockout" && roundKey)
    q["$or"] = [{ targetRound: roundKey }, { "board.roundKey": roundKey }];
  return DrawSession.findOne(q).sort({ committedAt: -1, createdAt: -1 });
}

function getCommittedMatchIdsFromHistory(sess) {
  if (!sess?.history?.length) return [];
  // tìm commit gần nhất có payload.matchIds
  for (let i = sess.history.length - 1; i >= 0; i--) {
    const h = sess.history[i];
    if (
      h?.action === "commit" &&
      Array.isArray(h?.payload?.matchIds) &&
      h.payload.matchIds.length
    ) {
      return h.payload.matchIds.map(String);
    }
  }
  return [];
}

// Xoá sạch các match theo ID (kể cả live/finished) và gỡ các liên kết previousA/B, nextMatch tới chúng
async function purgeMatchesByIds(matchIds = []) {
  if (!matchIds.length) return { deleted: 0 };
  const ids = matchIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  // 1) Gỡ liên kết ở các trận khác
  await Match.updateMany(
    { previousA: { $in: ids } },
    { $unset: { previousA: "" }, $set: { pairA: null } }
  );
  await Match.updateMany(
    { previousB: { $in: ids } },
    { $unset: { previousB: "" }, $set: { pairB: null } }
  );
  await Match.updateMany(
    { nextMatch: { $in: ids } },
    { $unset: { nextMatch: "", nextSlot: "" } }
  );

  // 2) Xoá chính các trận này (không filter trạng thái)
  const r = await Match.deleteMany({ _id: { $in: ids } });
  return { deleted: r?.deletedCount || 0 };
}

// Tiện ích: xoá “kết quả của lần bốc trước” theo bracket/mode/roundKey
async function purgePreviousDrawResults(
  bracketId,
  mode,
  roundKey /* null cho group */
) {
  const last = await getLastCommittedSession(bracketId, mode, roundKey);
  if (!last) return { deleted: 0 };
  const matchIds = getCommittedMatchIdsFromHistory(last);
  if (!matchIds.length) return { deleted: 0 }; // các commit cũ (trước bản vá này) có thể không có matchIds
  return purgeMatchesByIds(matchIds);
}

// (giữ lại helpers khác bạn đã có: normalizeRoundKey, roundKeyToPairs, calc roundNumber..., v.v.)

// ─────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/draw/:bracketId/start
 * body:
 *  - { mode: "group", groupSize?, groupCount?, settings?, seed? }
 *  - { mode: "knockout", round: "R16"|..., settings?, seed? }
 */
export const startDraw = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const {
    mode,
    groupSize,
    groupCount,
    settings = {},
    seed,
    round,
    usePrevWinners = false,
  } = req.body || {};

  const bracket = await Bracket.findById(bracketId).populate(
    "tournament",
    "eventType"
  );
  if (!bracket) {
    res.status(404);
    throw new Error("Bracket not found");
  }

  const regs = await Registration.find({
    tournament: bracket.tournament._id,
    "payment.status": "Paid",
  })
    .select("_id player1 player2")
    .lean();

  const io = req.app.get("io");

  // Không có đội: vẫn phát planned rỗng và trả trạng thái idle
  if (!regs.length) {
    emitPlanned(io, bracketId, { groupSizes: [], byes: 0 }, []);
    return res.json({
      ok: true,
      drawId: null,
      state: "idle",
      reveals: [],
      planned: { groupSizes: [], byes: 0 },
    });
  }

  if (mode === "group") {
    await purgePreviousDrawResults(bracket._id, "group", null);
    // 1) Lập plan nhóm
    const { groupSizes, byes } = planGroups(regs.length, {
      groupSize,
      groupCount,
      autoFit: settings?.autoFit !== false,
      allowUneven: settings?.allowUneven !== false,
      byePolicy: settings?.byePolicy || "none",
      overflowPolicy: settings?.overflowPolicy || "grow",
      underflowPolicy: settings?.underflowPolicy || "shrink",
      minSize: Number(settings?.minSize ?? 3),
      maxSize: Number(settings?.maxSize ?? 16),
    });
    if (!groupSizes?.length) {
      res.status(400);
      throw new Error("Cannot plan groups with provided parameters.");
    }

    // 2) Khởi tạo board rỗng theo plan (Có type + key để pass schema)
    const keys = groupKeys(groupSizes.length);
    const board = {
      type: "group", // REQUIRED BY SCHEMA
      groups: groupSizes.map((sz, i) => ({
        key: keys[i], // REQUIRED: tránh lỗi "board.groups.#.key is required"
        size: sz,
        slots: Array(sz).fill(null), // danh sách regId hoặc null
      })),
    };

    // 3) Tạo session
    const sess = await DrawSession.create({
      tournament: bracket.tournament._id,
      bracket: bracket._id,
      mode: "group",
      board,
      pool: regs.map((r) => r._id),
      taken: [],
      cursor: { gIndex: 0, slotIndex: 0 },
      status: "active",
      settings: { ...settings, seed },
      history: [{ action: "start", by: req.user?._id || null }],
    });

    // 4) Emit planned cho mọi người đang xem bracket
    emitPlanned(
      io,
      bracketId,
      { groupSizes, byes },
      board.groups.map((g, i) => ({ index: i, key: g.key, ids: [] }))
    );

    // 5) Emit update rỗng cho room session
    await emitUpdate(io, sess);

    return res.json({
      ok: true,
      drawId: String(sess._id),
      state: "running",
      reveals: [],
      planned: { groupSizes, byes },
    });
  }

  if (mode === "knockout") {
    const pairCount = roundKeyToPairs(round);
    if (!pairCount) {
      res.status(400);
      throw new Error("Invalid 'round' for knockout.");
    }

    const target = normalizeRoundKey(round) || null;

    // bốc lại ko vòng này → xoá đúng các trận commit trước ở chính vòng này
    await purgePreviousDrawResults(bracket._id, "knockout", target);

    // pool theo lựa chọn:
    let poolIds = regs.map((r) => r._id); // mặc định: tất cả đội đã Paid
    const stageTeams = codeToTeams(target) || pairCount * 2;
    const roundNumber = await calcRoundNumberForCode(
      bracket.tournament._id,
      target
    );

    if (usePrevWinners) {
      if (roundNumber <= 1) {
        res.status(400);
        throw new Error("Vòng đầu tiên không có vòng trước để lấy đội thắng.");
      }
      const prevRound = roundNumber - 1;
      const prevMatches = await Match.find({
        bracket: bracket._id,
        round: prevRound,
      }).select("pairA pairB winner");

      const winners = [];
      for (const m of prevMatches) {
        const w =
          m.winner === "A" ? m.pairA : m.winner === "B" ? m.pairB : null;
        if (w) winners.push(w);
      }
      if (winners.length < stageTeams) {
        res.status(400);
        throw new Error(
          `Chưa đủ đội thắng từ vòng trước: cần ${stageTeams}, hiện có ${winners.length}. ` +
            `Vui lòng hoàn tất vòng trước hoặc bỏ chọn "Lấy đội thắng ở vòng trước".`
        );
      }
      poolIds = winners.slice(0, stageTeams);
    }

    // ⚠️ Quan trọng: KnockoutPairSchema yêu cầu field 'index'
    const board = {
      type: "knockout", // REQUIRED BY SCHEMA
      roundKey: target || null,
      pairs: Array.from({ length: pairCount }, (_, i) => ({
        index: i,
        a: null,
        b: null,
      })),
    };

    const sess = await DrawSession.create({
      tournament: bracket.tournament._id,
      bracket: bracket._id,
      mode: "knockout",
      board,
      pool: poolIds,
      taken: [],
      targetRound: target,
      cursor: { pairIndex: 0, side: "A" },
      status: "active",
      settings: { ...settings, seed },
      history: [{ action: "start", by: req.user?._id || null }],
    });

    // Với knockout, planned chỉ là thông báo khởi tạo
    emitPlanned(io, bracketId, { groupSizes: [], byes: 0 }, []);
    await emitUpdate(io, sess);

    return res.json({
      ok: true,
      drawId: String(sess._id),
      state: "running",
      reveals: [],
    });
  }

  res.status(400);
  throw new Error("Unsupported mode. Use 'group' or 'knockout'.");
});

/**
 * POST /api/draw/:drawId/next
 */
export const drawNext = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;
  const sess = await DrawSession.findById(drawId);
  if (!sess) {
    res.status(404);
    throw new Error("Draw session not found");
  }
  if (sess.status !== "active") {
    res.status(400);
    throw new Error(`Cannot draw when session status = ${sess.status}`);
  }
  if (!sess.pool?.length) {
    res.status(400);
    throw new Error("Pool is empty");
  }

  // Load eventType vào DTO cho selectNextCandidate
  const tour = await Tournament.findById(sess.tournament).select("eventType");
  const dto = sess.toObject();
  dto.__eventType = eventTypeOf(tour);

  // Đảm bảo cursor đang ở slot trống
  advanceCursor(dto);

  // Chọn ứng viên
  const chosen = await selectNextCandidate(dto);
  if (!chosen) {
    res.status(400);
    throw new Error("No candidate available");
  }

  // Đặt vào board
  if (dto.mode === "group") {
    const gi = dto.cursor.gIndex;
    const si = dto.cursor.slotIndex;
    if (dto.board.groups[gi].slots[si]) {
      res.status(409);
      throw new Error("Slot already filled (concurrent op?)");
    }
    dto.board.groups[gi].slots[si] = asId(chosen);
  } else {
    const pi = dto.cursor.pairIndex;
    if (dto.cursor.side === "A") {
      if (dto.board.pairs[pi].a) {
        res.status(409);
        throw new Error("Slot already filled (concurrent op?)");
      }
      dto.board.pairs[pi].a = asId(chosen);
    } else {
      if (dto.board.pairs[pi].b) {
        res.status(409);
        throw new Error("Slot already filled (concurrent op?)");
      }
      dto.board.pairs[pi].b = asId(chosen);
    }
  }

  // Cập nhật pool/taken và cursor
  dto.pool = dto.pool.filter((x) => String(x) !== String(chosen));
  dto.taken = [...(dto.taken || []), asId(chosen)];
  advanceCursor(dto);

  // Persist
  sess.board = dto.board;
  sess.pool = dto.pool;
  sess.taken = dto.taken;
  sess.cursor = dto.cursor;
  sess.history.push({
    action: "pick",
    payload: { regId: chosen, cursor: dto.cursor },
    by: req.user?._id || null,
  });
  await sess.save();

  // Socket
  const io = req.app.get("io");
  await emitUpdate(io, sess);

  res.json(sess);
});

/**
 * POST /api/draw/:drawId/commit
 * - group: tạo lịch round-robin
 * - knockout: tạo các trận từ cặp đã bốc
 */
export const drawCommit = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;

  // 1) Lấy session
  const sess = await DrawSession.findById(drawId);
  if (!sess) {
    res.status(404);
    throw new Error("Draw session not found");
  }
  if (sess.status !== "active") {
    res.status(400);
    throw new Error(`Cannot commit when session status = ${sess.status}`);
  }

  // 2) Lấy bracket & tournament
  const br = await Bracket.findById(sess.bracket);
  if (!br) {
    res.status(404);
    throw new Error("Bracket not found");
  }
  const tour = await Tournament.findById(sess.tournament);

  // 3) Biến dùng chung
  let created = 0;
  let createdIds = [];

  // Utility cục bộ để tính roundNumber đúng theo tổng đội đã thanh toán
  const nextPow2 = (n) => {
    let p = 1;
    const need = Math.max(2, n | 0);
    while (p < need) p <<= 1;
    return p;
  };
  const codeToTeams = (k) => {
    const up = String(k || "").toUpperCase();
    if (up === "QF") return 8;
    if (up === "SF") return 4;
    if (up === "F") return 2;
    if (up.startsWith("R")) {
      const n = +up.slice(1);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const calcRoundNumberForCode = async (
    tournamentId,
    code,
    fallbackPairsLen
  ) => {
    // tổng đội đã thanh toán
    const totalPaidTeams = await Registration.countDocuments({
      tournament: tournamentId,
      "payment.status": "Paid",
    });
    const full = nextPow2(totalPaidTeams);
    const totalRounds = Math.max(1, Math.log2(full));
    const stageTeams =
      codeToTeams(code) ||
      (Number.isFinite(fallbackPairsLen) ? fallbackPairsLen * 2 : 2);
    return Math.max(1, Math.round(totalRounds - Math.log2(stageTeams) + 1));
  };

  if (sess.mode === "group") {
    // 4A) GROUP: Xoá đúng các trận do lần commit group trước tạo (nếu có lưu matchIds),
    // rồi CHỈ lưu bảng về Bracket — không tạo trận ở đây.
    await purgePreviousDrawResults(br._id, "group", null);

    const groupsFromBoard = (sess.board?.groups || []).map((g, i) => ({
      name: g.key || String.fromCharCode(65 + i), // "A","B",...
      regIds: (g.slots || []).filter(Boolean), // danh sách Registration _id
    }));

    br.groups = groupsFromBoard;
    br.teamsCount = groupsFromBoard.reduce(
      (acc, g) => acc + (g.regIds?.length || 0),
      0
    );
    await br.save();

    // Không tạo trận → created = 0, createdIds = []
  } else if (sess.mode === "knockout") {
    // 4B) KNOCKOUT: Xoá đúng các trận do lần commit KO trước ở CHÍNH VÒNG NÀY,
    // sau đó tạo lại trận cho vòng này.
    const target = sess.targetRound || sess.board?.roundKey || null;

    await purgePreviousDrawResults(br._id, "knockout", target);

    const pairs = sess.board?.pairs || [];
    const roundNumber = await calcRoundNumberForCode(
      tour._id,
      target,
      pairs.length
    );

    const defaultRules = br?.config?.rules || {
      bestOf: 3,
      pointsToWin: 11,
      winByTwo: true,
    };

    let order = 0;
    for (const p of pairs) {
      if (!p.a || !p.b) continue; // chỉ tạo trận khi đủ 2 bên
      const m = await Match.create({
        tournament: tour._id,
        bracket: br._id,
        round: roundNumber, // số vòng (1=round đầu của bracket này)
        order: order++,
        pairA: p.a,
        pairB: p.b,
        rules: defaultRules,
        gameScores: [],
        status: "scheduled",
      });
      created++;
      createdIds.push(String(m._id));
    }

    if (created > 0) {
      br.matchesCount = (br.matchesCount || 0) + created;
      await br.save();
    }
  } else {
    res.status(400);
    throw new Error("Unsupported draw mode.");
  }

  // 5) Đánh dấu commit & lưu matchIds để lần sau bốc lại xoá chuẩn
  sess.status = "committed";
  sess.committedAt = new Date();
  sess.history.push({
    action: "commit",
    payload: { created, matchIds: createdIds },
    by: req.user?._id || null,
  });
  await sess.save();

  // 6) Thông báo socket
  const io = req.app.get("io");
  emitTerminal(io, sess, "committed");

  // 7) Response giữ nguyên format
  res.json({ ok: true, created, session: sess });
});

/**
 * POST /api/draw/:drawId/cancel
 */
export const drawCancel = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;
  const sess = await DrawSession.findById(drawId);
  if (!sess) {
    res.status(404);
    throw new Error("Draw session not found");
  }
  if (sess.status !== "active") {
    res.status(400);
    throw new Error(`Cannot cancel when session status = ${sess.status}`);
  }

  sess.status = "canceled";
  sess.canceledAt = new Date();
  sess.history.push({ action: "cancel", by: req.user?._id || null });
  await sess.save();

  const io = req.app.get("io");
  emitTerminal(io, sess, "canceled");

  res.json({ ok: true, session: sess });
});

/**
 * GET /api/draw/:drawId
 * - Trả session (có thể FE dùng để resume)
 */
export const getDrawSession = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;
  const sess = await DrawSession.findById(drawId)
    .populate({ path: "board.groups.slots", select: "player1 player2" })
    .populate({ path: "board.pairs.a", select: "player1 player2" })
    .populate({ path: "board.pairs.b", select: "player1 player2" });
  if (!sess) {
    res.status(404);
    throw new Error("Draw session not found");
  }
  res.json(sess);
});

// === GET STATUS BY BRACKET =============================================
// GET /api/brackets/:bracketId/draw/status
// Trả về phiên mới nhất của bracket (ưu tiên phiên active; nếu không có, lấy phiên mới nhất bất kỳ)
// Shape: { ok, state, drawId, mode, reveals }
export const getDrawStatusByBracket = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;

  // 1) Tìm phiên ACTIVE trước (nếu có)
  let sess = await DrawSession.findOne({
    bracket: new mongoose.Types.ObjectId(String(bracketId)),
    status: "active",
  }).sort({ createdAt: -1 });

  // 2) Nếu không có active, lấy phiên mới nhất (committed/canceled/active cũ)
  if (!sess) {
    sess = await DrawSession.findOne({
      bracket: new mongoose.Types.ObjectId(String(bracketId)),
    }).sort({ createdAt: -1 });
  }

  if (!sess) {
    // chưa từng bốc
    return res.json({
      ok: true,
      state: "idle",
      drawId: null,
      mode: null,
      reveals: [],
    });
  }

  // Dựng reveals từ board (kể cả đã committed)
  const reveals = await computeReveals(sess);

  // Chuẩn hóa state cho FE
  const state =
    sess.status === "active"
      ? "running"
      : sess.status === "committed"
      ? "committed"
      : sess.status === "canceled"
      ? "canceled"
      : sess.status;

  return res.json({
    ok: true,
    state,
    drawId: String(sess._id),
    mode: sess.mode,
    reveals,
  });
});

export const generateGroupMatches = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const { mode = "auto", matches = [], rules = {} } = req.body || {};

  const br = await Bracket.findById(bracketId).lean();
  if (!br) {
    res.status(404);
    throw new Error("Bracket not found");
  }
  if (!["group", "round_robin", "gsl"].includes(br.type)) {
    res.status(400);
    throw new Error("Bracket không phải vòng bảng.");
  }
  const defaultRules = br?.config?.rules || {
    bestOf: 3,
    pointsToWin: 11,
    winByTwo: true,
  };

  // Map groupId -> { name, regIds }
  const groupMap = new Map((br.groups || []).map((g) => [String(g._id), g]));

  let created = 0;
  const createdIds = [];

  if (mode === "manual") {
    // matches: [{ groupId, pairA, pairB }]
    for (const m of matches) {
      const g = groupMap.get(String(m.groupId));
      if (!g) {
        res.status(400);
        throw new Error("Thiếu hoặc sai groupId.");
      }
      const a = String(m.pairA || "");
      const b = String(m.pairB || "");
      const validA = g.regIds.some((id) => String(id) === a);
      const validB = g.regIds.some((id) => String(id) === b);
      if (!validA || !validB || a === b) {
        res.status(400);
        throw new Error("Cặp không hợp lệ trong group.");
      }
      const doc = await Match.create({
        tournament: br.tournament,
        bracket: br._id,
        format: "group",
        pool: { id: g._id, name: g.name },
        rrRound: null,
        round: 1,
        order: created,
        pairA: a,
        pairB: b,
        rules: { ...defaultRules, ...rules },
        gameScores: [],
        status: "scheduled",
      });
      created++;
      createdIds.push(String(doc._id));
    }
    return res.json({ ok: true, mode, created, matchIds: createdIds });
  }

  // AUTO: round-robin cho từng group
  for (const g of br.groups || []) {
    const ids = (g.regIds || []).map(String);
    if (ids.length < 2) continue;
    const rounds = buildRoundRobin(ids);
    let order = 0;
    for (let r = 0; r < rounds.length; r++) {
      for (const [A, B] of rounds[r]) {
        const doc = await Match.create({
          tournament: br.tournament,
          bracket: br._id,
          format: "group",
          pool: { id: g._id, name: g.name },
          rrRound: r + 1,
          round: 1,
          order: order++,
          pairA: A,
          pairB: B,
          rules: { ...defaultRules, ...rules },
          gameScores: [],
          status: "scheduled",
        });
        created++;
        createdIds.push(String(doc._id));
      }
    }
  }
  res.json({ ok: true, mode: "auto", created, matchIds: createdIds });
});
