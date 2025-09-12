// controllers/slotPlanController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Bracket from "../../models/bracketModel.js";
import Registration from "../../models/registrationModel.js";
import Match from "../../models/matchModel.js"

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** lấy size hợp lệ của group; ưu tiên expectedSize, fallback regIds.length */
const groupSizeOf = (g) => {
  const s = Number(g?.expectedSize || 0);
  if (Number.isInteger(s) && s > 0) return s;
  return Array.isArray(g?.regIds) ? g.regIds.length : 0;
};

/**
 * POST /api/admin/brackets/:bid/slot-plan/bulk-assign
 * body: { assignments: [{ poolKey, slotIndex, regId, locked }], conflictPolicy: "replace"|"skip" }
 */
export const bulkAssignSlotPlan = asyncHandler(async (req, res) => {
  const { bid } = req.params;
  const { assignments = [], conflictPolicy = "replace" } = req.body || {};

  if (!Array.isArray(assignments) || !assignments.length) {
    return res
      .status(400)
      .json({ ok: false, message: "assignments trống hoặc sai định dạng" });
  }
  if (!["replace", "skip"].includes(conflictPolicy)) {
    return res.status(400).json({
      ok: false,
      message: "conflictPolicy phải là 'replace' hoặc 'skip'",
    });
  }

  const bracket = await Bracket.findById(bid).lean();
  if (!bracket)
    return res
      .status(404)
      .json({ ok: false, message: "Bracket không tồn tại" });

  if (["drawn", "in_progress", "done"].includes(bracket.drawStatus)) {
    return res.status(409).json({
      ok: false,
      message: "Bracket đã bốc/đang chạy, không thể dàn xếp.",
    });
  }

  // ==== validate groups/slots
  const byKey = new Map((bracket.groups || []).map((g) => [String(g.name), g]));
  const seenRegInBatch = new Set();
  const seenSlotInBatch = new Set();

  // gom regIds để validate
  const regIds = [];
  for (const a of assignments) {
    const poolKey = String(a.poolKey || "");
    const slotIndex = Number(a.slotIndex);
    const regId = String(a.regId || a.registration);

    if (!poolKey || !Number.isInteger(slotIndex) || slotIndex < 1) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu hoặc sai poolKey/slotIndex trong assignments.",
      });
    }
    if (!regId) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu regId trong assignments." });
    }

    const g = byKey.get(poolKey);
    if (!g) {
      return res.status(400).json({
        ok: false,
        message: `Bảng '${poolKey}' không tồn tại trong bracket.`,
      });
    }
    const size = groupSizeOf(g);
    if (slotIndex > size) {
      return res.status(400).json({
        ok: false,
        message: `Slot #${slotIndex} vượt kích thước của bảng ${poolKey} (size=${size}).`,
      });
    }

    const rk = String(regId);
    if (seenRegInBatch.has(rk)) {
      return res.status(400).json({
        ok: false,
        message: `Một regId xuất hiện 2 lần trong batch: ${rk}`,
      });
    }
    seenRegInBatch.add(rk);

    const sk = `${poolKey}:${slotIndex}`;
    if (seenSlotInBatch.has(sk)) {
      return res.status(400).json({
        ok: false,
        message: `Một slot được gán 2 lần trong batch: ${sk}`,
      });
    }
    seenSlotInBatch.add(sk);

    regIds.push(oid(regId));
  }

  // ==== validate regIds thuộc đúng giải (hoặc scope bạn muốn)
  const regs = await Registration.find({
    _id: { $in: regIds },
    tournament: bracket.tournament, // đảm bảo thuộc giải của bracket
  })
    .select("_id")
    .lean();

  if (regs.length !== regIds.length) {
    const okSet = new Set(regs.map((r) => String(r._id)));
    const missing = regIds.map(String).filter((id) => !okSet.has(id));
    return res.status(400).json({
      ok: false,
      message: `Registration không hợp lệ hoặc không thuộc tournament: ${missing.join(
        ", "
      )}`,
    });
  }

  // ==== merge vào slotPlan hiện có
  const current = new Map(
    (bracket.slotPlan || []).map((a) => [`${a.poolKey}:${a.slotIndex}`, a])
  );

  for (const a of assignments) {
    const key = `${a.poolKey}:${Number(a.slotIndex)}`;
    if (current.has(key) && conflictPolicy === "skip") continue;

    current.set(key, {
      poolKey: String(a.poolKey),
      slotIndex: Number(a.slotIndex),
      registration: oid(a.regId || a.registration),
      locked: a.locked !== false, // mặc định true
      by: req.user?._id || null,
      updatedAt: new Date(),
    });
  }

  // chặn 1 registration xuất hiện ở nhiều slot trong cùng bracket
  {
    const seen = new Set();
    for (const v of current.values()) {
      const rid = String(v.registration);
      if (seen.has(rid)) {
        return res.status(409).json({
          ok: false,
          message: `Registration bị trùng ở nhiều slot: ${rid}`,
        });
      }
      seen.add(rid);
    }
  }

  // ==== persist
  const write = await Bracket.updateOne(
    { _id: oid(bid) },
    {
      $set: {
        slotPlan: Array.from(current.values()),
        drawStatus: "preassigned",
        "drawConfig.respectPreassignments": true,
        updatedAt: new Date(),
      },
    }
  );

  if (!write?.acknowledged) {
    return res
      .status(500)
      .json({ ok: false, message: "Lưu slotPlan thất bại" });
  }

  return res.json({
    ok: true,
    slotPlan: Array.from(current.values()).map((x) => ({
      poolKey: x.poolKey,
      slotIndex: x.slotIndex,
      registration: String(x.registration),
      locked: !!x.locked,
      updatedAt: x.updatedAt,
    })),
  });
});

const same = (a, b) => String(a) === String(b);

function findGroupFromParam(bracket, groupParam) {
  // Ưu tiên _id; nếu không phải ObjectId, fallback by name (A/B/C…)
  if (mongoose.isValidObjectId(groupParam)) {
    return bracket.groups.id(groupParam);
  }
  return (bracket.groups || []).find(
    (g) => String(g.name) === String(groupParam)
  );
}

/**
 * POST /admin/brackets/:bracketId/groups/:groupId/insert-slot
 * body: { registrationId: string, slotIndex: number (1-based), autoGrowExpectedSize?: boolean }
 *
 * - Gỡ reg khỏi mọi group trong cùng bracket (di chuyển).
 * - Chèn vào group tại vị trí slotIndex (1-based) → các slot sau đẩy xuống.
 * - Nếu vượt expectedSize và expectedSize>0:
 *    + autoGrowExpectedSize=true -> set expectedSize = regIds.length (an toàn UI).
 *    + ngược lại -> 409 (reject).
 */
export async function insertRegIntoGroupSlot(req, res) {
  const { bracketId, groupId } = req.params;
  const {
    registrationId,
    slotIndex = 1,
    autoGrowExpectedSize = true,
  } = req.body || {};

  if (
    !mongoose.isValidObjectId(bracketId) ||
    !mongoose.isValidObjectId(registrationId)
  ) {
    return res.status(400).json({ message: "Tham số không hợp lệ" });
  }

  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const bracket = await Bracket.findById(bracketId).session(session);
      if (!bracket) throw new Error("Không tìm thấy bracket");

      const group = findGroupFromParam(bracket, groupId);
      if (!group) throw new Error("Không tìm thấy group");

      // Kiểm tra reg thuộc cùng tournament
      const reg = await Registration.findById(registrationId)
        .select("_id tournament")
        .session(session);
      if (!reg) throw new Error("Không tìm thấy registration");
      if (!same(reg.tournament, bracket.tournament)) {
        throw new Error("Registration không thuộc tournament của bracket");
      }

      // 1) Gỡ khỏi mọi group (nếu đã tồn tại)
      bracket.groups.forEach((g) => {
        g.regIds = (g.regIds || []).filter((rid) => !same(rid, registrationId));
      });

      // 2) Chèn vào group tại vị trí (1-based)
      group.regIds = group.regIds || [];
      const insertAt =
        Math.max(1, Math.min(Number(slotIndex) || 1, group.regIds.length + 1)) -
        1;
      group.regIds.splice(insertAt, 0, oid(registrationId));

      // 3) Kiểm soát expectedSize
      const size = Number(group.expectedSize) || 0;
      if (size > 0 && group.regIds.length > size) {
        if (autoGrowExpectedSize) {
          group.expectedSize = group.regIds.length;
        } else {
          throw new Error(
            `Vượt expectedSize (${group.regIds.length}/${size}). Chọn 'Grow' hoặc vị trí khác.`
          );
        }
      }

      await bracket.save({ session });
      return {
        ok: true,
        group: group.toObject(),
        groups: bracket.groups.map((g) => g.toObject()),
      };
    });

    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  } finally {
    session.endSession();
  }
}

/**
 * POST /admin/brackets/:bracketId/groups/:groupId/generate-matches
 * body: { registrationId: string, doubleRound?: boolean }
 *
 * - Chỉ bù các cặp còn thiếu có liên quan tới đội này trong pool.
 * - format='group', phase='group', pool={ id: group._id, name: group.name }
 * - rules lấy từ bracket.config.rules
 */
export async function generateGroupMatchesForTeam(req, res) {
  const { bracketId, groupId } = req.params;
  const { registrationId, doubleRound } = req.body || {};

  if (
    !mongoose.isValidObjectId(bracketId) ||
    !mongoose.isValidObjectId(registrationId)
  ) {
    return res.status(400).json({ message: "Tham số không hợp lệ" });
  }

  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const bracket = await Bracket.findById(bracketId).session(session);
      if (!bracket) throw new Error("Không tìm thấy bracket");

      const group = findGroupFromParam(bracket, groupId);
      if (!group) throw new Error("Không tìm thấy group");

      const entries = (group.regIds || []).map(String);
      if (!entries.some((x) => same(x, registrationId))) {
        throw new Error("Đội chưa nằm trong group này");
      }

      const cfgRules = bracket?.config?.rules || {};
      const rrCfg = bracket?.config?.roundRobin || {};
      const isDouble =
        typeof doubleRound === "boolean" ? doubleRound : !!rrCfg?.doubleRound;

      const opponents = entries.filter((x) => !same(x, registrationId));
      if (opponents.length === 0) return { ok: true, created: 0 };

      // Lấy danh sách đã tồn tại trong pool này
      const existing = await Match.find({
        bracket: bracket._id,
        format: { $in: ["group", "round_robin", null] },
        "pool.id": group._id,
        $or: [{ pairA: oid(registrationId) }, { pairB: oid(registrationId) }],
      })
        .select("pairA pairB")
        .lean()
        .session(session);

      const hasSet = new Set(
        existing.map((m) => `${String(m.pairA)}|${String(m.pairB)}`)
      );
      const toCreate = [];

      for (const opp of opponents) {
        const key1 = `${registrationId}|${opp}`;
        const key2 = `${opp}|${registrationId}`;
        const already = hasSet.has(key1) || hasSet.has(key2);

        if (!already) {
          toCreate.push({ A: registrationId, B: opp, rrRound: 1 });
          if (isDouble)
            toCreate.push({ A: opp, B: registrationId, rrRound: 2 }); // lượt về
        } else if (isDouble) {
          // Nếu doubleRound mà mới tồn tại 1 chiều → bổ sung chiều còn lại
          const haveAB = hasSet.has(key1);
          const haveBA = hasSet.has(key2);
          if (haveAB && !haveBA)
            toCreate.push({ A: opp, B: registrationId, rrRound: 2 });
          if (!haveAB && haveBA)
            toCreate.push({ A: registrationId, B: opp, rrRound: 1 });
        }
      }

      if (toCreate.length === 0) return { ok: true, created: 0 };

      // Lấy order hiện tại trong pool để xếp tiếp
      const last = await Match.find({
        bracket: bracket._id,
        "pool.id": group._id,
      })
        .sort({ round: -1, order: -1 })
        .limit(1)
        .select("round order")
        .lean()
        .session(session);

      const startOrder = last?.[0]?.order >= 0 ? last[0].order + 1 : 0;
      let cursor = startOrder;

      const docs = toCreate.map((it) => ({
        tournament: bracket.tournament,
        bracket: bracket._id,
        format: "group",
        branch: "main",
        phase: "group",
        pool: { id: group._id, name: group.name },
        rrRound: it.rrRound ?? null,
        round: 1,
        order: cursor++,
        seedA: null,
        seedB: null,
        pairA: oid(it.A),
        pairB: oid(it.B),
        rules: cfgRules,
        status: "scheduled",
      }));

      await Match.insertMany(docs, { session });
      return { ok: true, created: docs.length };
    });

    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  } finally {
    session.endSession();
  }
}

export const getAdminBracketById = async (req, res) => {
  try {
    const { bracketId } = req.params;

    if (!mongoose.isValidObjectId(bracketId)) {
      return res.status(400).json({ message: "Invalid bracketId" });
    }

    const bracket = await Bracket.findById(bracketId)
      .populate({ path: "tournament", select: "_id name status sportType" })
      // cần virtuals để FE nào còn dùng g.key/g.size vẫn chạy
      .lean({ virtuals: true });

    if (!bracket) {
      return res.status(404).json({ message: "Bracket not found" });
    }

    // Chuẩn hóa regIds thành string (phòng trường hợp client strict)
    bracket.groups = (bracket.groups || []).map((g) => ({
      ...g,
      regIds: (g.regIds || []).map((id) => id?.toString()),
    }));

    return res.json(bracket);
  } catch (err) {
    console.error("getAdminBracketById error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};