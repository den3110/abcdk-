// controllers/drawController.js
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import DrawSession from "../models/drawSessionModel.js";
import Bracket from "../models/bracketModel.js";
import Tournament from "../models/tournamentModel.js";
import Registration from "../models/registrationModel.js";
import Match from "../models/matchModel.js";
import User from "../models/userModel.js";
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

export async function getNameMap(regIds = [], evType = "single") {
  if (!Array.isArray(regIds) || regIds.length === 0) return new Map();

  const regs = await Registration.find({ _id: { $in: regIds } })
    .populate({
      path: "player1 player2",
      model: User,
      select: "name nickname",
    })
    .lean();

  const map = new Map();
  for (const r of regs) {
    if (evType === "single") {
      const u = r.player1;
      map.set(String(r._id), u?.nickName || u?.fullName || "Ẩn danh");
    } else {
      // double: cặp 2 người
      const a = r.player1?.nickName || r.player1?.fullName || "Ẩn danh";
      const b = r.player2?.nickName || r.player2?.fullName || "Ẩn danh";
      map.set(String(r._id), `${a} / ${b}`);
    }
  }
  return map;
}

async function computeReveals(session) {
  const evType = eventTypeOf(
    await Tournament.findById(session.tournament).select("eventType")
  );

  const inBoardIds = new Set();
  if (session.mode === "group") {
    for (const g of session.board?.groups || []) {
      for (const rid of g.slots || []) if (rid) inBoardIds.add(String(rid));
    }
  } else {
    for (const p of session.board?.pairs || []) {
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

  // tương thích app cũ
  io?.to(roomBracket)?.emit("draw:revealed", payload);
  io?.to(roomSession)?.emit("draw:revealed", payload);
}

function emitTerminal(io, session, type /* 'committed' | 'canceled' */) {
  const roomBracket = `draw:${String(session.bracket)}`;
  const roomSession = `drawsess:${String(session._id)}`;
  io?.to(roomBracket)?.emit(`draw:${type}`, { session });
  io?.to(roomSession)?.emit(`draw:${type}`, { session });
}

// ==== KO helpers ====
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

async function calcRoundNumberForCode(bracket, code, fallbackPairsLen) {
  const stageTeams =
    codeToTeams(code) ||
    (Number.isFinite(fallbackPairsLen) ? fallbackPairsLen * 2 : 2);

  const candFromKeys = codeToTeams(
    bracket?.ko?.startKey || bracket?.prefill?.roundKey
  );

  const numericCands = [
    bracket?.meta?.firstRoundSize,
    bracket?.meta?.drawSize,
    bracket?.drawScale,
    bracket?.maxSlots,
    bracket?.capacity,
    bracket?.size,
    bracket?.meta?.qualifiers,
    bracket?.qualifiers,
  ]
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 2);

  let entryTeams =
    candFromKeys ||
    (numericCands.length ? Math.max(stageTeams, numericCands[0]) : null);

  if (!entryTeams && Number.isFinite(fallbackPairsLen)) {
    entryTeams = Math.max(stageTeams, fallbackPairsLen * 2);
  }

  if (!entryTeams) {
    const totalPaidTeams = await Registration.countDocuments({
      tournament: bracket.tournament,
      "payment.status": "Paid",
    });
    entryTeams = Math.max(stageTeams, totalPaidTeams || 2);
  }

  const full = nextPow2(entryTeams);
  const totalRounds = Math.max(1, Math.log2(full));
  const r = Math.max(1, Math.round(totalRounds - Math.log2(stageTeams) + 1));
  return r;
}

// === Purge helpers ===
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

async function purgeMatchesByIds(matchIds = []) {
  if (!matchIds.length) return { deleted: 0 };
  const ids = matchIds.map((id) => new mongoose.Types.ObjectId(String(id)));

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

  const r = await Match.deleteMany({ _id: { $in: ids } });
  return { deleted: r?.deletedCount || 0 };
}

async function purgePreviousDrawResults(
  bracketId,
  mode,
  roundKey /* null cho group */
) {
  const last = await getLastCommittedSession(bracketId, mode, roundKey);
  if (!last) return { deleted: 0 };
  const matchIds = getCommittedMatchIdsFromHistory(last);
  if (!matchIds.length) return { deleted: 0 };
  return purgeMatchesByIds(matchIds);
}

// === tiny utils ===
const pickPositive = (...vals) => {
  for (const x of vals) {
    const v = Number(x);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
};
const coalesce = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

function getDrawPreset(bracket, tournament) {
  return (
    bracket?.config?.drawSettings ||
    bracket?.drawSettings ||
    tournament?.config?.drawSettings ||
    tournament?.drawSettings ||
    null
  );
}

// Fallback rebuild groups từ meta
function rebuildGroupsFromMeta(dto) {
  const sizes = dto?.computedMeta?.group?.sizes;
  if (!Array.isArray(sizes) || sizes.length === 0) return false;
  const keys = groupKeys(sizes.length);
  dto.board.groups = sizes.map((sz, i) => ({
    key: keys[i],
    size: sz,
    slots: Array(Math.max(1, Number(sz) || 1)).fill(null),
  }));
  if (
    !dto.cursor ||
    typeof dto.cursor.gIndex !== "number" ||
    typeof dto.cursor.slotIndex !== "number"
  ) {
    dto.cursor = { gIndex: 0, slotIndex: 0 };
  }
  return true;
}

/** ✅ Thu thập regId đã cơ cấu (locked) trong Bracket.slotPlan để loại khỏi pool */
function collectUsedPreassignedFromBracket(bracket, board) {
  const used = new Set();
  if (!bracket?.slotPlan?.length || !Array.isArray(board?.groups)) return used;

  const keyToIndex = new Map(board.groups.map((g, i) => [String(g.key), i]));
  for (const a of bracket.slotPlan) {
    if (!a?.poolKey || !(a.locked ?? true)) continue;
    const gi = keyToIndex.get(String(a.poolKey));
    if (gi === undefined) continue;
    const size = Number(board.groups[gi]?.size) || 0;
    const si0 = Math.max(1, Number(a.slotIndex || 0)) - 1;
    if (si0 < 0 || si0 >= size) continue;
    const rid = a.registration || a.regId;
    if (rid) used.add(String(rid));
  }
  return used;
}

/** ✅ Tìm regId preassign cho slot hiện tại (gi, si) — đọc trực tiếp từ Bracket mỗi lần reveal */
async function findPreassignedRegForSlot(bracketId, board, gi, si) {
  const br = await Bracket.findById(bracketId).select("slotPlan").lean();
  if (!br?.slotPlan?.length || !Array.isArray(board?.groups)) return null;

  const group = board.groups[gi];
  if (!group) return null;
  const groupKey = String(group.key || "");
  const targetIndex = Number(si) + 1; // 1-based in slotPlan

  // các reg đã đặt để tránh gán trùng
  const placed = new Set();
  for (const g of board.groups || [])
    for (const rid of g.slots || []) if (rid) placed.add(String(rid));

  for (const a of br.slotPlan) {
    if ((a.locked ?? true) !== true) continue;
    if (String(a.poolKey) !== groupKey) continue;
    if (Number(a.slotIndex) !== targetIndex) continue;
    const rid = a.registration || a.regId;
    if (!rid) continue;
    if (placed.has(String(rid))) return null; // đã nằm ở slot khác
    return asId(rid);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/draw/:bracketId/start
 */
// Helpers
const pow2Ceil = (n) => 1 << Math.ceil(Math.log2(Math.max(1, Number(n) || 1)));
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
const parseTeamsFromRoundKey = (key) => {
  if (!key || typeof key !== "string") return null;
  const m = key.trim().match(/^R(\d+)$/i);
  return m ? Number(m[1]) : null;
};

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

  const paidCount = regs.length;
  const io = req.app.get("io");

  // ───────────────────── NO ENTRANTS (non-group) ─────────────────────
  if (!paidCount && mode !== "group") {
    emitPlanned(io, bracketId, { groupSizes: [], byes: 0 }, []);
    return res.json({
      ok: true,
      drawId: null,
      state: "idle",
      reveals: [],
      planned: { groupSizes: [], byes: 0 },
      message:
        "Chưa có đội nào hoàn tất thanh toán nên chưa thể bốc thăm. Vui lòng xác nhận danh sách thanh toán trước.",
      meta: { paidCount },
    });
  }

  // ───────────────────── GROUP ─────────────────────
  if (mode === "group") {
    // Guard: 0 đội Paid
    if (!paidCount) {
      emitPlanned(io, bracketId, { groupSizes: [], byes: 0 }, []);
      return res.json({
        ok: true,
        drawId: null,
        state: "idle",
        reveals: [],
        planned: { groupSizes: [], byes: 0 },
        message:
          "Chưa có đội nào hoàn tất thanh toán nên chưa thể bốc thăm vòng bảng.",
        meta: { paidCount },
      });
    }

    await purgePreviousDrawResults(bracket._id, "group", null);

    const preset = getDrawPreset(bracket, bracket.tournament) || {};
    const plannerPreset = preset?.planner || {};

    const plannerOpts = {
      autoFit: coalesce(settings?.autoFit, plannerPreset.autoFit, true),
      allowUneven: coalesce(
        settings?.allowUneven,
        plannerPreset.allowUneven,
        true
      ),
      byePolicy: coalesce(settings?.byePolicy, plannerPreset.byePolicy, "none"),
      overflowPolicy: coalesce(
        settings?.overflowPolicy,
        plannerPreset.overflowPolicy,
        "grow"
      ),
      underflowPolicy: coalesce(
        settings?.underflowPolicy,
        plannerPreset.underflowPolicy,
        "shrink"
      ),
      minSize: Number(coalesce(settings?.minSize, plannerPreset.minSize, 3)),
      maxSize: Number(coalesce(settings?.maxSize, plannerPreset.maxSize, 16)),
    };

    const designGroups = Array.isArray(bracket.groups) ? bracket.groups : [];
    const hasDesign = bracket.type === "group" && designGroups.length > 0;

    const rrGroupSize = pickPositive(
      groupSize,
      bracket?.config?.roundRobin?.groupSize,
      plannerPreset.groupSize
    );

    let groupSizes = null;
    let byes = 0;

    if (hasDesign) {
      const sizes = designGroups.map((g) =>
        pickPositive(g?.expectedSize, rrGroupSize)
      );

      if (sizes.every((s) => Number.isFinite(s) && s > 0)) {
        const need = paidCount;
        const totalCap = sizes.reduce((a, b) => a + b, 0);
        let final = [...sizes];

        if (need > totalCap) {
          const extra = need - totalCap;
          if (plannerOpts.overflowPolicy === "extraGroup") {
            const base = pickPositive(rrGroupSize, plannerOpts.minSize, 4);
            const extraGroups = Math.ceil(extra / base);
            for (let i = 0; i < extraGroups; i++) final.push(base);
          } else {
            let remain = extra,
              i = 0;
            while (remain > 0) {
              final[i % final.length]++;
              i++;
              remain--;
            }
          }
        } else if (need < totalCap) {
          const slack = totalCap - need;
          if (plannerOpts.underflowPolicy === "shrink") {
            const minSz = Math.max(1, plannerOpts.minSize);
            const totalShrinkCap = final.reduce(
              (acc, s) => acc + Math.max(0, s - minSz),
              0
            );
            const shrink = Math.min(slack, totalShrinkCap);

            if (shrink > 0) {
              let left = shrink;
              for (let j = final.length - 1; j >= 0 && left > 0; j--) {
                const can = Math.max(0, final[j] - minSz);
                const take = Math.min(can, left);
                final[j] -= take;
                left -= take;
              }
            }
            byes = slack - shrink;
          } else {
            byes = slack;
          }
        }

        groupSizes = final;
      }
    }

    if (!groupSizes) {
      const effGroupSize = pickPositive(
        groupSize,
        rrGroupSize,
        plannerPreset.groupSize
      );
      const effGroupCount = pickPositive(
        groupCount,
        hasDesign ? designGroups.length : null,
        plannerPreset.groupCount
      );

      const planned = planGroups(paidCount, {
        groupSize: effGroupSize ?? null,
        groupCount: effGroupCount ?? null,
        ...plannerOpts,
      });
      if (!planned?.groupSizes?.length) {
        emitPlanned(io, bracketId, { groupSizes: [], byes: 0 }, []);
        return res.status(400).json({
          ok: false,
          message:
            "Không thể lập nhóm với tham số hiện tại. Vui lòng điều chỉnh kích thước số nhóm/kích thước nhóm.",
        });
      }
      groupSizes = planned.groupSizes;
      byes = planned.byes ?? 0;
    }

    const keysFromDesign =
      hasDesign && designGroups.every((g) => g?.name)
        ? designGroups.map((g) => String(g.name))
        : groupKeys(groupSizes.length);

    const board = {
      type: "group",
      groups: groupSizes.map((sz, i) => ({
        key: keysFromDesign[i] || groupKeys(groupSizes.length)[i],
        size: sz,
        slots: Array(Math.max(1, Number(sz) || 1)).fill(null),
      })),
    };

    // Không ghim sẵn vào board; chỉ loại khỏi pool
    const usedPre = collectUsedPreassignedFromBracket(bracket, board);

    const presetSeed = pickPositive(seed, preset?.seed);
    const sessionSettings = {
      ...settings,
      ...(presetSeed ? { seed: presetSeed } : {}),
    };

    const poolIds = regs
      .map((r) => r._id)
      .filter((id) => !usedPre.has(String(id)));

    const sess = await DrawSession.create({
      tournament: bracket.tournament._id,
      bracket: bracket._id,
      mode: "group",
      board,
      pool: poolIds,
      taken: [],
      cursor: { gIndex: 0, slotIndex: 0 },
      status: "active",
      settings: sessionSettings,
      history: [{ action: "start", by: req.user?._id || null }],
      computedMeta: {
        group: { sizes: groupSizes, count: groupSizes.length, byes },
      },
    });

    emitPlanned(io, bracketId, { groupSizes, byes }, []);
    await emitUpdate(io, sess);

    return res.json({
      ok: true,
      drawId: String(sess._id),
      state: "running",
      reveals: [],
      planned: { groupSizes, byes },
      message: `Đã khởi tạo bốc thăm vòng bảng: ${poolIds.length} đội, ${groupSizes.length} nhóm, ${byes} suất bye (nếu có).`,
      meta: { paidCount, poolCount: poolIds.length },
    });
  }

  // ───────────────────── PO / PLAYOFF (roundElim) — tách riêng ─────────────────────
  if (mode === "po" || mode === "playoff") {
    // chuẩn hoá thành "po" cho DrawSession.mode
    const sessMode = "po";

    // Pool mặc định = Paid; có thể override bằng winners nếu usePrevWinners
    let poolIds = regs.map((r) => r._id);
    let entrants = poolIds.length;

    if (usePrevWinners) {
      // Cố gắng xác định vòng trước dựa vào round (nếu có), ngược lại suy diễn theo calcRoundNumberForCode
      const desiredTeams =
        parseTeamsFromRoundKey(round) ??
        (round ? codeToTeams(round) : null) ??
        entrants;

      const tempPairs = Math.floor(desiredTeams / 2);
      const tempRoundNumber = await calcRoundNumberForCode(
        bracket,
        `R${desiredTeams}`,
        tempPairs
      );
      if (!tempRoundNumber || tempRoundNumber <= 1) {
        res.status(400);
        throw new Error("Vòng đầu tiên không có vòng trước để lấy đội thắng.");
      }

      const prevRound = tempRoundNumber - 1;
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
      poolIds = winners;
      entrants = winners.length;
    }

    // Xác định stageTeams & số cặp cho vòng này — KHÔNG ép 2^k
    // - Nếu admin truyền round="R{X}" → dùng X.
    // - Nếu X < entrants → nâng X = entrants (không bỏ đội).
    let stageTeams =
      parseTeamsFromRoundKey(round) ??
      (round ? codeToTeams(round) : null) ??
      entrants;

    if (!Number.isFinite(stageTeams) || stageTeams < entrants) {
      stageTeams = entrants;
    }

    const pairCount = Math.floor(stageTeams / 2);
    const availableSlots = pairCount * 2;
    const byeCount = Math.abs(availableSlots - entrants); // cả hai trường hợp N lẻ hoặc thiếu người so với X

    const target = `R${stageTeams}`;

    // Dọn các trận đúng vòng nếu tính được roundNumber
    try {
      const roundNumber = await calcRoundNumberForCode(
        bracket,
        target,
        pairCount
      );
      if (Number.isFinite(roundNumber)) {
        await Match.deleteMany({ bracket: bracket._id, round: roundNumber });
      }
    } catch (e) {
      console.error(
        "[startDraw] Failed to clear matches for bracket",
        bracket._id,
        "target",
        target,
        e
      );
    }

    // Tạo board roundElim (PO)
    const board = {
      type: "roundElim",
      roundKey: target,
      pairs: Array.from({ length: pairCount }, (_, i) => ({
        index: i,
        a: null,
        b: null,
      })),
    };

    // Tạo session
    const sess = await DrawSession.create({
      tournament: bracket.tournament._id,
      bracket: bracket._id,
      mode: sessMode, // "po"
      board,
      pool: poolIds, // có thể < availableSlots → sẽ có BYE
      taken: [],
      targetRound: target,
      cursor: { pairIndex: 0, side: "A" },
      status: "active",
      settings: { ...settings, seed },
      history: [{ action: "start", by: req.user?._id || null }],
      computedMeta: {
        po: {
          entrants: poolIds.length,
          stageTeams,
          pairCount,
          byes: byeCount,
        },
      },
    });

    emitPlanned(io, bracketId, { groupSizes: [], byes: byeCount }, []);
    await emitUpdate(io, sess);

    return res.json({
      ok: true,
      drawId: String(sess._id),
      state: "running",
      reveals: [],
      message: `Đã khởi tạo bốc thăm Playoff (${target}), số cặp: ${pairCount}, đội: ${
        poolIds.length
      }${byeCount ? `, BYE: ${byeCount}` : ""}.`,
      meta: {
        paidCount,
        poolCount: poolIds.length,
        pairCount,
        round: target,
        byes: byeCount,
        stageTeams,
      },
    });
  }

  // ───────────────────── KNOCKOUT ─────────────────────
  if (mode === "knockout") {
    const pairCount = roundKeyToPairs(round);
    if (!pairCount) {
      res.status(400);
      throw new Error("Invalid 'round' for knockout.");
    }

    const target = normalizeRoundKey(round) || null;

    await purgePreviousDrawResults(bracket._id, "knockout", target);

    let poolIds = regs.map((r) => r._id);
    const stageTeams = (target && codeToTeams(target)) || pairCount * 2;
    const roundNumber = await calcRoundNumberForCode(
      bracket,
      target,
      pairCount
    );

    try {
      const clearQuery = { bracket: bracket._id };
      if (Number.isFinite(roundNumber)) clearQuery.round = roundNumber;
      await Match.deleteMany(clearQuery);
    } catch (e) {
      console.error(
        "[startDraw] Failed to clear matches for bracket",
        bracket._id,
        "round",
        roundNumber,
        e
      );
    }

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
          `Chưa đủ đội thắng từ vòng trước: cần ${stageTeams}, hiện có ${winners.length}. Vui lòng hoàn tất vòng trước hoặc bỏ chọn "Lấy đội thắng ở vòng trước".`
        );
      }
      poolIds = winners.slice(0, stageTeams);
    }

    const board = {
      type: "knockout",
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
      computedMeta: { ko: { entrants: poolIds.length } },
    });

    emitPlanned(io, bracketId, { groupSizes: [], byes: 0 }, []);
    await emitUpdate(io, sess);

    return res.json({
      ok: true,
      drawId: String(sess._id),
      state: "running",
      reveals: [],
      message: `Đã khởi tạo bốc thăm Knockout (${
        target || "vòng hiện tại"
      }), số cặp: ${pairCount}, đội tham dự: ${poolIds.length}.`,
      meta: { paidCount, poolCount: poolIds.length, pairCount, round: target },
    });
  }

  res.status(400);
  throw new Error(
    "Unsupported mode. Use 'group', 'po'/'playoff' hoặc 'knockout'."
  );
});

/**
 * POST /api/draw/:drawId/next
 */
// Helper dựng tên hiển thị từ registration
const _pName = (p) =>
  p?.nickName || p?.fullName || p?.name || p?.displayName || null;

const displayNameFromReg = (reg, eventType) => {
  if (!reg) return null;
  const teamFallback =
    reg.teamName || reg.nickName || reg.name || reg.displayName || null;
  const single = String(eventType || "")
    .toLowerCase()
    .includes("single");
  const p1 = _pName(reg.player1) || reg.player1Name || null;
  if (single) return p1 || teamFallback || "—";
  const p2 = _pName(reg.player2) || reg.player2Name || null;
  if (p1 && p2) return `${p1} & ${p2}`;
  return p1 || teamFallback || "—";
};

// helper: slot (pi,side)A đứng trước (pi,side)B
function isAfterSlot(targetPi, targetSide, curPi, curSide) {
  if (targetPi > curPi) return true;
  if (targetPi < curPi) return false;
  // cùng pairIndex → A trước B
  if (curSide === "A" && targetSide === "B") return true;
  return false;
}

// helper: reg đã được dùng chưa (dùng cho cả board và taken)
function isRegUsed(board, taken, regId) {
  const idStr = String(regId);
  if (Array.isArray(taken) && taken.some((t) => String(t) === idStr)) {
    return true;
  }
  // KO
  if (Array.isArray(board?.pairs)) {
    for (const p of board.pairs) {
      if (!p) continue;
      if (p.a && String(p.a) === idStr) return true;
      if (p.b && String(p.b) === idStr) return true;
    }
  }
  // group
  if (Array.isArray(board?.groups)) {
    for (const g of board.groups) {
      if (!g?.slots) continue;
      if (g.slots.some((s) => s && String(s) === idStr)) return true;
    }
  }
  return false;
}

// helper: chọn random 1 phần tử từ mảng (an toàn)
function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx];
}

export const drawNext = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;

  const sess = await DrawSession.findById(drawId).select(
    "+board +mode +pool +taken +cursor +history +settings +status +tournament +bracket +preplan"
  );
  if (!sess) {
    res.status(404);
    throw new Error("Draw session not found");
  }
  if (sess.status !== "active") {
    res.status(400);
    throw new Error(`Cannot draw when session status = ${sess.status}`);
  }

  // lấy thông tin để build tên đội
  const tour = await Tournament.findById(sess.tournament).select("eventType");
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found for this draw session");
  }

  // dto làm việc tạm
  const dto = sess.toObject();
  dto.__eventType = eventTypeOf(tour);
  dto.pool = Array.isArray(dto.pool) ? dto.pool : [];
  dto.taken = Array.isArray(dto.taken) ? dto.taken : [];
  dto.board = dto.board ?? {};
  dto.cursor = dto.cursor ?? null;
  dto.mode =
    dto.mode ?? (Array.isArray(dto.board?.groups) ? "group" : "knockout");

  // ========== chuẩn hoá board ==========
  if (dto.mode === "group") {
    if (!Array.isArray(dto.board.groups) || dto.board.groups.length === 0) {
      const ok = rebuildGroupsFromMeta(dto);
      if (!ok) {
        res.status(400);
        throw new Error("Board.groups is not initialized");
      }
    }
    dto.board.groups = dto.board.groups.map((g, idx) => {
      const group = g ?? {};
      if (!Array.isArray(group.slots)) {
        res.status(400);
        throw new Error(`Group ${idx + 1} has no slots array`);
      }
      return group;
    });
  } else {
    dto.board.pairs = Array.isArray(dto.board.pairs) ? dto.board.pairs : [];
    if (dto.board.pairs.length === 0) {
      res.status(400);
      throw new Error("Board.pairs is not initialized");
    }
  }

  // luôn đứng ở slot trống
  advanceCursor(dto);

  // ==================================================================
  // ======================== GROUP MODE ==============================
  // ==================================================================
  if (dto.mode === "group") {
    const { gIndex: gi, slotIndex: si } = dto.cursor || {};
    if (
      typeof gi !== "number" ||
      typeof si !== "number" ||
      !dto.board.groups[gi] ||
      !Array.isArray(dto.board.groups[gi].slots)
    ) {
      res.status(409);
      throw new Error("Invalid cursor for group mode");
    }
    if (dto.board.groups[gi].slots[si]) {
      res.status(409);
      throw new Error("Slot already filled (concurrent op?)");
    }

    // ưu tiên slotPlan đã cơ cấu sẵn
    let chosen = await findPreassignedRegForSlot(
      sess.bracket,
      dto.board,
      gi,
      si
    );

    // nếu slot đó chưa được cơ cấu → rơi về pool chung
    if (!chosen) {
      if (!Array.isArray(dto.pool) || dto.pool.length === 0) {
        res.status(400);
        throw new Error("Pool is empty");
      }
      chosen = await selectNextCandidate(dto);
      if (!chosen) {
        res.status(400);
        throw new Error("No candidate available");
      }
    }

    dto.board.groups[gi].slots[si] = asId(chosen);

    const filledGroup = dto.board.groups[gi] || {};
    const filledGroupCode =
      filledGroup.key || filledGroup.code || String.fromCharCode(65 + gi);

    // bỏ khỏi pool + đánh dấu đã lấy
    dto.pool = dto.pool.filter((x) => String(x) !== String(chosen));
    dto.taken = [...dto.taken, asId(chosen)];

    // chuyển con trỏ
    advanceCursor(dto);

    // lưu session
    sess.board = dto.board;
    sess.pool = dto.pool;
    sess.taken = dto.taken;
    sess.cursor = dto.cursor;
    if (!Array.isArray(sess.history)) sess.history = [];
    sess.history.push({
      action: "pick",
      payload: { regId: chosen, cursor: dto.cursor },
      by: req.user?._id || null,
      at: new Date(),
    });
    await sess.save();

    // socket
    const io = req.app.get("io");
    await emitUpdate(io, sess);

    // build tên
    const reg = await Registration.findById(chosen)
      .select("teamName nickName name displayName player1 player2")
      .populate("player1", "nickName fullName name displayName")
      .populate("player2", "nickName fullName name displayName")
      .lean();
    const nextName =
      displayNameFromReg(reg, dto.__eventType) ||
      `#${String(chosen).slice(-6)}`;

    const out = sess.toObject();
    out.next = {
      type: "group",
      regId: asId(chosen),
      name: nextName,
      groupCode: filledGroupCode,
      slotIndex: si,
    };
    return res.json(out);
  }

  // ==================================================================
  // ========================== KO / PO ===============================
  // ==================================================================

  if (!Array.isArray(dto.pool) || dto.pool.length === 0) {
    res.status(400);
    throw new Error("Pool is empty");
  }

  const { pairIndex: pi, side } = dto.cursor || {};
  if (typeof pi !== "number" || !dto.board.pairs[pi]) {
    res.status(409);
    throw new Error("Invalid cursor for KO mode");
  }

  // ===== helpers =====
  const isRegUsed = (board, taken, regId) => {
    const s = String(regId);
    if (Array.isArray(taken) && taken.some((t) => String(t) === s)) return true;
    if (Array.isArray(board?.pairs)) {
      for (const p of board.pairs) {
        if (!p) continue;
        if (p.a && String(p.a) === s) return true;
        if (p.b && String(p.b) === s) return true;
      }
    }
    if (Array.isArray(board?.groups)) {
      for (const g of board.groups) {
        if (!g?.slots) continue;
        if (g.slots.some((x) => x && String(x) === s)) return true;
      }
    }
    return false;
  };

  const slotIsAfter = (targetPi, targetSide, curPi, curSide) => {
    if (targetPi > curPi) return true;
    if (targetPi < curPi) return false;
    // cùng match → A trước B
    if (curSide === "A" && targetSide === "B") return true;
    return false;
  };

  const normIndex = (x) => {
    if (x == null) return null;
    if (typeof x.pairIndex === "number") return x.pairIndex;
    if (typeof x.pair === "number") return x.pair - 1;
    return null;
  };

  const pickRandom = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    const i = Math.floor(Math.random() * arr.length);
    return arr[i];
  };

  const hasPreplanData = (pp) =>
    pp &&
    ((Array.isArray(pp.fixed) && pp.fixed.length > 0) ||
      (Array.isArray(pp.pools) && pp.pools.length > 0));

  // 👉 lấy preplan: ưu tiên mỗi phiên, không có thì lấy ở bracket
  let preplan = hasPreplanData(sess.preplan) ? sess.preplan : null;
  if (!preplan) {
    const br = await Bracket.findById(sess.bracket).select("poPreplan").lean();
    if (hasPreplanData(br?.poPreplan)) {
      preplan = br.poPreplan;
      // cache lại cho session
      sess.preplan = br.poPreplan;
    }
  }

  let chosen = null;
  const reservedForLater = new Set();

  if (preplan) {
    const fixedAll = Array.isArray(preplan.fixed) ? preplan.fixed : [];
    const poolsAll = Array.isArray(preplan.pools) ? preplan.pools : [];

    // ================= 1) cố định đúng slot này trước =================
    // ở đây slot này có thể có nhiều fixed (ít gặp) → lấy cái đầu còn dùng được
    const fixedForThis = fixedAll.filter((f) => {
      const idx = normIndex(f);
      if (idx == null) return false;
      return f.side === side && (idx === pi || idx === pi + 1);
    });

    for (const fx of fixedForThis) {
      if (fx.reg) {
        const regId = String(fx.reg);
        if (!isRegUsed(dto.board, dto.taken, regId)) {
          chosen = regId;
          break;
        }
      }
    }

    // ================= 2) nếu chưa có → gom TẤT CẢ pools của slot này =================
    if (!chosen) {
      const poolsForThis = poolsAll.filter((p) => {
        const idx = normIndex(p);
        if (idx == null) return false;
        return p.side === side && (idx === pi || idx === pi + 1);
      });

      if (poolsForThis.length) {
        // gộp candidates từ nhiều mảng → unique
        const candSet = new Set();
        for (const p of poolsForThis) {
          for (const c of p.candidates || []) {
            // chỉ add nếu chưa dùng ở slot trước
            if (!isRegUsed(dto.board, dto.taken, c)) {
              candSet.add(String(c));
            }
          }
        }
        const available = Array.from(candSet);
        if (available.length) {
          // random TRONG CHÍNH DANH SÁCH NÀY
          chosen = pickRandom(available);
        }
      }
    }

    // ================= 3) build danh sách đội để dành cho slot SAU =================
    // mục đích: khi fallback từ pool chung thì không chạm vào các đội đã cơ cấu cho slot sau
    for (const f of fixedAll) {
      const fIdx = normIndex(f);
      const fSide = f.side === "B" ? "B" : "A";
      if (fIdx == null) continue;
      if (slotIsAfter(fIdx, fSide, pi, side) && f.reg) {
        reservedForLater.add(String(f.reg));
      }
    }
    for (const p of poolsAll) {
      const pIdx = normIndex(p);
      const pSide = p.side === "B" ? "B" : "A";
      if (pIdx == null) continue;
      if (slotIsAfter(pIdx, pSide, pi, side)) {
        for (const c of p.candidates || []) {
          reservedForLater.add(String(c));
        }
      }
    }
  }

  // ================= 4) Fallback về pool chung =================
  if (!chosen) {
    // pool chung nhưng loại hết đội đã cơ cấu cho slot sau + đội đã dùng
    const filteredPool = dto.pool.filter(
      (id) =>
        !reservedForLater.has(String(id)) &&
        !isRegUsed(dto.board, dto.taken, id)
    );

    if (!filteredPool.length) {
      res.status(400);
      throw new Error(
        "Pool hiện chỉ còn các đội đã được cơ cấu cho slot phía sau, không thể bốc ngẫu nhiên."
      );
    }

    // mượn lại hàm cũ để vẫn giữ logic chọn của bạn
    const backup = dto.pool;
    dto.pool = filteredPool;
    chosen = await selectNextCandidate(dto);
    dto.pool = backup;

    if (!chosen) {
      res.status(400);
      throw new Error("No candidate available");
    }
  }

  // ================= 5) gán vào board =================
  if (side === "A") {
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

  const chosenStr = String(chosen);

  // nếu đội đó đang nằm trong pool thì xoá
  dto.pool = dto.pool.filter((x) => String(x) !== chosenStr);
  // và đánh dấu đã lấy
  dto.taken = [...dto.taken, asId(chosenStr)];

  // tới slot tiếp theo
  advanceCursor(dto);

  // lưu session
  sess.board = dto.board;
  sess.pool = dto.pool;
  sess.taken = dto.taken;
  sess.cursor = dto.cursor;
  if (!Array.isArray(sess.history)) sess.history = [];
  sess.history.push({
    action: "pick",
    payload: { regId: chosenStr, cursor: dto.cursor },
    by: req.user?._id || null,
    at: new Date(),
  });
  await sess.save();

  // socket
  const io = req.app.get("io");
  await emitUpdate(io, sess);

  // build response cuối
  const reg = await Registration.findById(chosenStr)
    .select("teamName nickName name displayName player1 player2")
    .populate("player1", "nickName fullName name displayName")
    .populate("player2", "nickName fullName name displayName")
    .lean();
  const nextName =
    displayNameFromReg(reg, dto.__eventType) ||
    `#${String(chosenStr).slice(-6)}`;

  const out = sess.toObject();
  out.next = {
    type: "ko",
    regId: asId(chosenStr),
    name: nextName,
    pairIndex: pi,
    side,
  };
  return res.json(out);
});

/**
 * POST /api/draw/:drawId/commit
 * - group: lưu bảng (groups) vào Bracket; không tạo trận tại đây
 * - knockout: tạo các trận từ cặp đã bốc cho đúng vòng
 */
export const drawCommit = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;

  const sess = await DrawSession.findById(drawId);
  if (!sess) {
    res.status(404);
    throw new Error("Draw session not found");
  }
  if (sess.status !== "active") {
    res.status(400);
    throw new Error(`Cannot commit when session status = ${sess.status}`);
  }

  const br = await Bracket.findById(sess.bracket);
  if (!br) {
    res.status(404);
    throw new Error("Bracket not found");
  }
  const tour = await Tournament.findById(sess.tournament);

  let created = 0;
  let createdIds = [];
  let updated = 0;

  if (sess.mode === "group") {
    await purgePreviousDrawResults(br._id, "group", null);

    const groupsFromBoard = (sess.board?.groups || []).map((g, i) => ({
      name: g.key || String.fromCharCode(65 + i),
      regIds: (g.slots || []).filter(Boolean),
    }));

    br.groups = groupsFromBoard;
    br.teamsCount = groupsFromBoard.reduce(
      (acc, g) => acc + (g.regIds?.length || 0),
      0
    );
    br.drawStatus = "drawn";
    await br.save();
  } else if (sess.mode === "knockout" || sess.mode === "po") {
    const target = sess.targetRound || sess.board?.roundKey || null;
    await purgePreviousDrawResults(br._id, sess.mode, target);

    const pairs = sess.board?.pairs || [];
    const roundNumber = await calcRoundNumberForCode(br, target, pairs.length);

    const defaultRules = br?.config?.rules || {
      bestOf: 3,
      pointsToWin: 11,
      winByTwo: true,
    };

    const overwriteExisting = Boolean(req.body?.overwriteExisting);
    const existing = await Match.find({
      bracket: br._id,
      round: roundNumber,
    })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    const byOrder = new Map(existing.map((m) => [Number(m.order) || 0, m]));

    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      if (!p?.a || !p?.b) continue;
      const desiredOrder = Number(p.index ?? i);
      const found = byOrder.get(desiredOrder) || existing[i];

      if (found) {
        if (found.status === "finished" && !overwriteExisting) {
          continue;
        }
        await Match.updateOne(
          { _id: found._id },
          {
            $set: {
              tournament: tour._id,
              bracket: br._id,
              round: roundNumber,
              order: desiredOrder,
              pairA: p.a,
              pairB: p.b,
              rules: defaultRules,
              status: "scheduled",
              gameScores: [],
              winner: null,
            },
            $unset: { previousA: "", previousB: "" },
          }
        );
        updated++;
      } else {
        const m = await Match.create({
          tournament: tour._id,
          bracket: br._id,
          round: roundNumber,
          order: desiredOrder,
          pairA: p.a,
          pairB: p.b,
          rules: defaultRules,
          gameScores: [],
          status: "scheduled",
        });
        created++;
        createdIds.push(String(m._id));
      }
    }

    if (created > 0) {
      br.matchesCount = (br.matchesCount || 0) + created;
      await br.save();
    }
  } else {
    res.status(400);
    throw new Error("Unsupported draw mode.");
  }

  sess.status = "committed";
  sess.committedAt = new Date();
  sess.history.push({
    action: "commit",
    payload: { created, updated, matchIds: createdIds },
    by: req.user?._id || null,
  });
  await sess.save();

  const io = req.app.get("io");
  emitTerminal(io, sess, "committed");

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
export const getDrawStatusByBracket = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;

  let sess = await DrawSession.findOne({
    bracket: new mongoose.Types.ObjectId(String(bracketId)),
    status: "active",
  }).sort({ createdAt: -1 });

  if (!sess) {
    sess = await DrawSession.findOne({
      bracket: new mongoose.Types.ObjectId(String(bracketId)),
    }).sort({ createdAt: -1 });
  }

  if (!sess) {
    return res.json({
      ok: true,
      state: "idle",
      drawId: null,
      mode: null,
      reveals: [],
    });
  }

  const reveals = await computeReveals(sess);

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

/**
 * POST /api/brackets/:bracketId/groups/generate-matches
 */
export const generateGroupMatches = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const {
    mode = "auto",
    matches = [],
    rules = {},
    doubleRound = false,
  } = req.body || {};

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
    bestOf: 1,
    pointsToWin: 11,
    winByTwo: true,
  };

  const groupMap = new Map((br.groups || []).map((g) => [String(g._id), g]));

  let created = 0;
  const createdIds = [];
  if (mode === "manual") {
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

    const rounds1 = buildRoundRobin(ids);

    const rounds = doubleRound
      ? rounds1.concat(
          rounds1.map((roundPairs) => roundPairs.map(([A, B]) => [B, A]))
        )
      : rounds1;

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

  res.json({
    ok: true,
    mode: "auto",
    created,
    matchIds: createdIds,
    doubleRound,
  });
});

function groupBy(list, keyFn) {
  const m = {};
  for (const it of list) {
    const k = keyFn(it);
    if (!m[k]) m[k] = [];
    m[k].push(it);
  }
  return m;
}

function sumGameScores(gs) {
  if (!Array.isArray(gs) || gs.length === 0) return { aTotal: 0, bTotal: 0 };
  let aTotal = 0,
    bTotal = 0;
  for (const g of gs) {
    aTotal += Number(g?.a || 0);
    bTotal += Number(g?.b || 0);
  }
  return { aTotal, bTotal };
}

// PRNG đơn giản có seed để trộn deterministic
function seededShuffle(arr, seedInput) {
  if (seedInput === undefined || seedInput === null) return arr;
  let seed = Number(seedInput);
  if (!Number.isFinite(seed) || seed === 0) seed = Date.now();
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== Standings từ các trận vòng bảng đã hoàn thành =====
export async function buildStandingsForBracket(bracketId) {
  const matches = await Match.find({
    bracket: asId(bracketId),
    format: "group",
    status: "finished",
  })
    .select("pool pairA pairB winner gameScores")
    .lean();

  const rows = new Map();
  const ensure = (regId, groupKey) => {
    const k = String(regId);
    if (!rows.has(k)) {
      rows.set(k, {
        registrationId: asId(regId),
        groupKey: groupKey || "N/A",
        played: 0,
        won: 0,
        lost: 0,
        points: 0,
        diff: 0,
        scored: 0,
      });
    }
    return rows.get(k);
  };

  for (const m of matches) {
    const A = m.pairA;
    const B = m.pairB;
    if (!A || !B) continue;
    const gKey = m?.pool?.name || String(m?.pool?.id || "N/A");

    const ra = ensure(A, gKey);
    const rb = ensure(B, gKey);
    ra.played++;
    rb.played++;

    if (m.winner === "A") {
      ra.won++;
      rb.lost++;
      ra.points += 3;
    } else if (m.winner === "B") {
      rb.won++;
      ra.lost++;
      rb.points += 3;
    } else {
      ra.points += 1;
      rb.points += 1;
    }

    const { aTotal, bTotal } = sumGameScores(m?.gameScores);
    ra.diff += aTotal - bTotal;
    rb.diff += bTotal - aTotal;
    ra.scored += aTotal;
    rb.scored += bTotal;
  }

  const arr = Array.from(rows.values());
  const byGroup = groupBy(arr, (r) => r.groupKey);
  const out = [];
  for (const [, list] of Object.entries(byGroup)) {
    list.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.scored !== a.scored) return b.scored - a.scored;
      if (a.lost !== b.lost) return a.lost - b.lost;
      return 0;
    });
    list.forEach((row, i) => (row.rank = i + 1));
    out.push(...list);
  }
  return out;
}

// Đẩy đội thắng sang trận kế tiếp nếu có cấu trúc nextMatch/nextSlot
async function propagateWinnerToNextMatch(matchId) {
  const m = await Match.findById(matchId).lean();
  if (!m) return;

  const winnerTeam =
    m.winner === "A" ? m.pairA : m.winner === "B" ? m.pairB : null;
  if (!winnerTeam) return;

  const nextId = m?.nextMatch;
  const nextSlot = m?.nextSlot || "A";
  if (!nextId) return;

  const setObj =
    nextSlot === "A" ? { pairA: winnerTeam } : { pairB: winnerTeam };
  await Match.updateOne(
    { _id: asId(nextId) },
    { $set: { ...setObj, updatedAt: new Date() } }
  );
}

// ====== API: Assign BYEs ======
// ====== API: Assign BYEs ======
export const assignByes = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const {
    round,
    matchIds,
    limit,
    randomSeed,
    dryRun = false,
    source,
  } = req.body || {};

  const br = await Bracket.findById(bracketId).lean();
  if (!br) {
    res.status(404);
    throw new Error("Bracket not found");
  }
  const tour = await Tournament.findById(br.tournament).lean();
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  // Lấy các trận KO/PO (không phải group)
  const q = { bracket: br._id, format: { $ne: "group" } };
  if (Number.isFinite(Number(round))) q.round = Number(round);
  if (Array.isArray(matchIds) && matchIds.length) {
    q._id = { $in: matchIds.map(asId) };
  }
  const matches = await Match.find(q).lean();

  // Tìm slot BYE còn trống
  const openByeSlots = [];
  for (const m of matches) {
    const aIsBye = m?.seedA?.type === "bye";
    const bIsBye = m?.seedB?.type === "bye";
    if (aIsBye && !m?.pairA) {
      openByeSlots.push({
        match: m,
        matchId: m._id,
        round: m.round || 0,
        order: m.order || 0,
        side: "A",
      });
    }
    if (bIsBye && !m?.pairB) {
      openByeSlots.push({
        match: m,
        matchId: m._id,
        round: m.round || 0,
        order: m.order || 0,
        side: "B",
      });
    }
  }

  if (!openByeSlots.length) {
    return res.json({
      ok: true,
      assigned: 0,
      preview: [],
      reason: "NO_OPEN_BYE_SLOT",
    });
  }

  // Build pool ứng viên
  let candidates = [];
  const modeSel = source?.mode;

  if (modeSel === "manual") {
    const ids = (source?.params?.teamIds || []).map(asId);
    if (!ids.length) {
      res.status(400);
      throw new Error("Manual mode requires params.teamIds");
    }
    candidates = await Registration.find({
      _id: { $in: ids },
      tournament: br.tournament,
    })
      .select("_id player1 player2")
      .lean();
  } else if (modeSel === "topEachGroup") {
    const takePerGroup = Math.max(1, Number(source?.params?.takePerGroup ?? 1));
    const rankN = Number(source?.params?.rank);
    const range = source?.params?.range;

    const standings = await buildStandingsForBracket(br._id);
    const byGroup = groupBy(standings, (r) => r.groupKey || "N/A");

    for (const rows of Object.values(byGroup)) {
      let pool = [];
      if (Array.isArray(range) && range.length === 2) {
        const [lo, hi] = range.map(Number);
        pool = rows.filter((r) => r.rank >= lo && r.rank <= hi);
      } else if (Number.isFinite(rankN)) {
        pool = rows.filter((r) => r.rank === rankN);
      } else {
        pool = rows.filter((r) => r.rank === 3);
      }
      const mixed = seededShuffle(pool, randomSeed);
      const picked = mixed.slice(0, takePerGroup);
      const regIds = picked.map((r) => r.registrationId);
      if (regIds.length) {
        const regs2 = await Registration.find({
          _id: { $in: regIds },
          tournament: br.tournament,
        })
          .select("_id player1 player2")
          .lean();
        candidates.push(...regs2);
      }
    }
    candidates = seededShuffle(candidates, randomSeed);
  } else if (modeSel === "bestOfTopN") {
    const rankN = Number(source?.params?.rank ?? 3);
    const standings = await buildStandingsForBracket(br._id);
    const filtered = standings.filter((r) => r.rank === rankN);
    filtered.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.scored !== a.scored) return b.scored - a.scored;
      if (a.lost !== b.lost) return a.lost - b.lost;
      return 0;
    });
    const regIds = filtered.map((r) => r.registrationId);
    candidates = await Registration.find({
      _id: { $in: regIds },
      tournament: br.tournament,
    })
      .select("_id player1 player2")
      .lean();
  } else {
    res.status(400);
    throw new Error("Unknown source.mode");
  }

  if (!candidates.length) {
    return res.json({
      ok: true,
      assigned: 0,
      preview: [],
      reason: "EMPTY_CANDIDATE_POOL",
    });
  }

  // Loại trùng ứng viên
  {
    const seen = new Set();
    candidates = candidates.filter((c) => {
      const id = String(c._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  // Ưu tiên slot theo (round asc, order asc, side A trước B)
  openByeSlots.sort((x, y) => {
    if (x.round !== y.round) return x.round - y.round;
    if (x.order !== y.order) return x.order - y.order;
    return x.side === y.side ? 0 : x.side === "A" ? -1 : 1;
  });

  // Bắt cặp slot ↔ candidates
  const lim = Number.isFinite(Number(limit)) ? Number(limit) : Infinity;
  const maxAssign = Math.min(openByeSlots.length, candidates.length, lim);

  const assignments = [];
  for (let i = 0; i < maxAssign; i++) {
    const slot = openByeSlots[i];
    const reg = candidates[i];
    assignments.push({
      matchId: slot.matchId,
      side: slot.side,
      regId: reg._id,
    });
  }

  const preview = assignments.map((a) => ({
    matchId: a.matchId,
    side: a.side,
    teamId: a.regId,
  }));

  if (dryRun) {
    return res.json({
      ok: true,
      dryRun: true,
      assigned: preview.length,
      preview,
    });
  }

  // ⛔️ KHÔNG auto-finish: gộp update theo trận, chỉ set pairA/pairB + updatedAt
  const byMatch = assignments.reduce((acc, a) => {
    const k = String(a.matchId);
    (acc[k] ||= []).push(a);
    return acc;
  }, {});

  const ops = [];
  for (const [matchId, list] of Object.entries(byMatch)) {
    const setObj = { updatedAt: new Date() };
    for (const a of list) {
      if (a.side === "A") setObj.pairA = a.regId;
      else setObj.pairB = a.regId;
    }
    ops.push({
      updateOne: {
        filter: { _id: asId(matchId) },
        update: { $set: setObj }, // tuyệt đối không set status/winner/reason/finishedAt
      },
    });
  }

  if (ops.length) await Match.bulkWrite(ops);

  // ⛔️ Không propagateWinnerToNextMatch ở đây
  return res.json({ ok: true, assigned: assignments.length, preview });
});

// ghi cơ cấu
export const updatePoPreplan = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;
  const {
    fixed = [],
    pools = [],
    avoidPairs = [],
    mustPairs = [],
  } = req.body || {};

  const sess = await DrawSession.findById(drawId);
  if (!sess) {
    res.status(404);
    throw new Error("DrawSession not found");
  }
  if (sess.mode !== "po" || sess.board?.type !== "roundElim") {
    res.status(400);
    throw new Error("Chỉ hỗ trợ cơ cấu cho PO (roundElim).");
  }

  const pairCount = Array.isArray(sess.board?.pairs)
    ? sess.board.pairs.length
    : 0;
  const okSlot = (p, s) =>
    Number.isInteger(p) && p >= 0 && p < pairCount && (s === "A" || s === "B");

  for (const f of fixed) {
    if (!okSlot(f.pairIndex, f.side)) {
      res.status(400);
      throw new Error("fixed: pairIndex/side không hợp lệ");
    }
  }
  for (const p of pools) {
    if (!okSlot(p.pairIndex, p.side)) {
      res.status(400);
      throw new Error("pools: pairIndex/side không hợp lệ");
    }
  }

  const poolSet = new Set((sess.pool || []).map(String));
  for (const f of fixed) {
    if (!poolSet.has(String(f.reg))) {
      res.status(400);
      throw new Error(`fixed: đội ${f.reg} không nằm trong pool hiện tại`);
    }
  }
  for (const p of pools) {
    for (const c of p.candidates || []) {
      if (!poolSet.has(String(c))) {
        res.status(400);
        throw new Error(`pools: đội ${c} không nằm trong pool hiện tại`);
      }
    }
  }

  sess.preplan = { fixed, pools, avoidPairs, mustPairs };
  await sess.save();

  const io = req.app.get("io");
  await emitUpdate(io, sess);

  return res.json({ ok: true, preplan: sess.preplan });
});

// xem thử (optional)
export const previewPoPreplan = expressAsyncHandler(async (req, res) => {
  const { drawId } = req.params;
  const sess = await DrawSession.findById(drawId)
    .select("+board +pool +preplan +mode")
    .lean();
  if (!sess) {
    res.status(404);
    throw new Error("DrawSession not found");
  }
  if (sess.mode !== "po" || sess.board?.type !== "roundElim") {
    res.status(400);
    throw new Error("Chỉ hỗ trợ PO.");
  }
  // ở đây bạn có thể gọi solvePoAssignment nếu có, còn không thì chỉ trả về preplan cho FE render
  return res.json({ ok: true, preplan: sess.preplan, board: sess.board });
});
