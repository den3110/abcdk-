// controllers/slotPlanController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Bracket from "../../models/bracketModel.js";
import Registration from "../../models/registrationModel.js";

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
    return res
      .status(400)
      .json({
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
    return res
      .status(409)
      .json({
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
      return res
        .status(400)
        .json({
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
      return res
        .status(400)
        .json({
          ok: false,
          message: `Bảng '${poolKey}' không tồn tại trong bracket.`,
        });
    }
    const size = groupSizeOf(g);
    if (slotIndex > size) {
      return res
        .status(400)
        .json({
          ok: false,
          message: `Slot #${slotIndex} vượt kích thước của bảng ${poolKey} (size=${size}).`,
        });
    }

    const rk = String(regId);
    if (seenRegInBatch.has(rk)) {
      return res
        .status(400)
        .json({
          ok: false,
          message: `Một regId xuất hiện 2 lần trong batch: ${rk}`,
        });
    }
    seenRegInBatch.add(rk);

    const sk = `${poolKey}:${slotIndex}`;
    if (seenSlotInBatch.has(sk)) {
      return res
        .status(400)
        .json({
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
