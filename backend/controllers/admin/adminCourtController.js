// controllers/admin/adminCourtController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Court from "../../models/courtModel.js";
import Match from "../../models/matchModel.js";
import {
  buildGroupsRotationQueue,
  assignNextToCourt,
  freeCourtAndAssignNext,
  fillIdleCourtsForCluster,
} from "../../services/courtQueueService.js";

/**
 * Upsert danh sách sân cho 1 giải + bracket
 * Sau khi lưu: build queue (tạm reuse 'cluster' = bracketId) + fill ngay các sân idle
 */
/** Helper: lấy số thứ tự bảng từ code/name (B1, B2, ...) */
function groupIndexFrom(any) {
  const s = (any?.code ?? any?.name ?? any ?? "").toString();
  const m = s.match(/B(\d+)/i);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Helper: fallback từ mã trận kiểu V1-B3#6 */
function parseFromCode(code) {
  const s = (code || "").toString();
  const g = s.match(/-B(\d+)/i);
  const idx = g ? parseInt(g[1], 10) : Number.MAX_SAFE_INTEGER;
  const n = s.match(/#(\d+)/);
  const num = n ? parseInt(n[1], 10) : Number.MAX_SAFE_INTEGER;
  return { gidx: idx, num };
}

/** Comparator: nhóm theo bảng rồi tới thứ tự trận trong bảng */
function groupFirstComparator(a, b) {
  // 1) group index
  const ga =
    a.groupOrder ??
    groupIndexFrom(a.group) ??
    groupIndexFrom(a.pool) ??
    parseFromCode(a.code).gidx;
  const gb =
    b.groupOrder ??
    groupIndexFrom(b.group) ??
    groupIndexFrom(b.pool) ??
    parseFromCode(b.code).gidx;

  if (ga !== gb) return ga - gb;

  // 2) order trong bảng
  const na =
    a.order ??
    a.sequence ??
    a.roundOrder ??
    parseFromCode(a.code).num ??
    999999;
  const nb =
    b.order ??
    b.sequence ??
    b.roundOrder ??
    parseFromCode(b.code).num ??
    999999;

  if (na !== nb) return na - nb;

  // 3) phụ (round rồi _id để ổn định sort)
  const ra = a.round ?? 0;
  const rb = b.round ?? 0;
  if (ra !== rb) return ra - rb;

  return String(a._id).localeCompare(String(b._id));
}

/**
 * Upsert courts theo BRACKET
 * - Params:   :tournamentId
 * - Body:     { bracket: ObjectId, names?: string[], count?: number }
 * - Không nhận cluster/courtId gì hết
 */
export const upsertCourts = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { bracket, names, count } = req.body || {};

  if (!mongoose.isValidObjectId(tournamentId)) {
    return res.status(400).json({ message: "Invalid tournament id" });
  }
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }

  // chuẩn hóa danh sách tên sân mong muốn
  let desired = [];
  if (Array.isArray(names) && names.length) {
    desired = [...new Set(names.map((s) => String(s).trim()).filter(Boolean))];
  } else if (Number.isInteger(count) && count > 0) {
    desired = Array.from({ length: count }, (_, i) => `Sân ${i + 1}`);
  } else {
    return res.status(400).json({ message: "Thiếu 'names' hoặc 'count' > 0" });
  }

  const tid = new mongoose.Types.ObjectId(tournamentId);
  const bid = new mongoose.Types.ObjectId(bracket);

  // chỉ thao tác trong BRACKET này
  const existing = await Court.find({ tournament: tid, bracket: bid }).lean();
  const byName = new Map(existing.map((c) => [c.name, c]));

  const clusterKey = String(bracket); // dùng bracketId làm cluster nội bộ (ẩn với client)

  const bulk = [];

  // upsert theo thứ tự names
  desired.forEach((name, idx) => {
    const found = byName.get(name);
    if (found) {
      bulk.push({
        updateOne: {
          filter: { _id: found._id },
          update: {
            $set: {
              order: idx,
              isActive: true,
              status: found.status === "maintenance" ? "idle" : found.status,
              // không nhận cluster từ client; gán theo bracketId để tương thích service cũ
              cluster: clusterKey,
            },
          },
        },
      });
    } else {
      bulk.push({
        insertOne: {
          document: {
            tournament: tid,
            bracket: bid,
            name,
            order: idx,
            isActive: true,
            status: "idle",
            currentMatch: null,
            // ẩn với client, dùng nội bộ
            cluster: clusterKey,
          },
        },
      });
    }
  });

  // deactivate những sân không còn trong danh sách của BRACKET này
  for (const c of existing) {
    if (!desired.includes(c.name)) {
      bulk.push({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              isActive: false,
              status: "maintenance",
              currentMatch: null,
            },
          },
        },
      });
    }
  }

  if (bulk.length) await Court.bulkWrite(bulk, { ordered: false });

  // rebuild & fill hàng đợi chỉ cho BRACKET này (dùng clusterKey = bracketId)
  try {
    await buildGroupsRotationQueue({ tournamentId, cluster: clusterKey });
    await fillIdleCourtsForCluster({ tournamentId, cluster: clusterKey });
  } catch (e) {
    // không chặn response nếu service hàng đợi lỗi nhẹ
    console.error("[queue] rebuild/fill error:", e?.message || e);
  }

  const items = await Court.find({ tournament: tid, bracket: bid })
    .sort({ order: 1 })
    .lean();

  return res.json({ items });
});

export const buildGroupsQueueHttp = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { bracket } = req.body || {};
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }
  const clusterKey = String(bracket);
  const out = await buildGroupsRotationQueue({
    tournamentId,
    cluster: clusterKey,
  });
  res.json(out);
});

export const assignNextHttp = asyncHandler(async (req, res) => {
  const { tournamentId, courtId } = req.params;
  const { bracket } = req.body || {};
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }
  const clusterKey = String(bracket);
  const match = await assignNextToCourt({
    tournamentId,
    courtId,
    cluster: clusterKey,
  });
  res.json({ match });
});

export const freeCourtHttp = asyncHandler(async (req, res) => {
  const { courtId } = req.params;
  const match = await freeCourtAndAssignNext({ courtId });
  res.json({ match });
});

export const getSchedulerState = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { bracket } = req.query || {};
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }
  const clusterKey = String(bracket);

  const [courts, matches] = await Promise.all([
    Court.find({ tournament: tournamentId, bracket, isActive: true })
      .sort({ order: 1 })
      .lean(),
    // ⚠️ Hiện tại service/match đang dùng 'courtCluster' → tạm reuse clusterKey = bracketId
    Match.find({
      tournament: tournamentId,
      courtCluster: clusterKey,
      status: { $in: ["queued", "assigned", "live"] },
    })
      .select(
        "_id status queueOrder court courtLabel participants pool rrRound round order"
      )
      .sort({ status: 1, queueOrder: 1 })
      .lean(),
  ]);

  res.json({ courts, matches });
});

/* ======================== ⭐ NEW: helpers ======================== */
function courtLabelOf(court) {
  return (
    court?.name ||
    court?.label ||
    court?.title ||
    court?.code ||
    (court?._id ? `Court-${String(court._id).slice(-4)}` : "")
  );
}

/* ======================== ⭐ NEW: gán 1 trận cụ thể vào 1 sân ========================
 * POST /api/tournaments/:tournamentId/courts/:courtId/assign-specific
 * body: { bracket, matchId, replace = true }
 */
export const assignSpecificHttp = asyncHandler(async (req, res) => {
  const { tournamentId, courtId } = req.params;
  const { bracket, matchId, replace = true } = req.body || {};

  if (!mongoose.isValidObjectId(tournamentId)) {
    return res.status(400).json({ message: "Sai 'tournamentId'." });
  }
  if (!mongoose.isValidObjectId(courtId)) {
    return res.status(400).json({ message: "Sai 'courtId'." });
  }
  if (!mongoose.isValidObjectId(bracket)) {
    return res.status(400).json({ message: "Sai 'bracket'." });
  }
  if (!mongoose.isValidObjectId(matchId)) {
    return res.status(400).json({ message: "Sai 'matchId'." });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1) Tìm court + match
    const [court, match] = await Promise.all([
      Court.findOne({
        _id: courtId,
        tournament: tournamentId,
        bracket,
        isActive: true,
      }).session(session),
      Match.findOne({ _id: matchId, tournament: tournamentId }).session(
        session
      ),
    ]);

    if (!court) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Không tìm thấy sân hợp lệ." });
    }
    if (!match) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Không tìm thấy trận cần gán." });
    }
    if (String(match.bracket || "") !== String(bracket)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Trận và bracket không khớp." });
    }
    if (String(match.status || "") === "finished") {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ message: "Trận đã kết thúc; không thể gán." });
    }

    // 2) Nếu trận đã đang ở đúng sân -> idempotent
    if (String(match.court || "") === String(courtId)) {
      await session.commitTransaction();
      session.endSession();
      return res.json({
        message: "Trận đã được gán ở sân này.",
        court,
        match,
      });
    }

    // 3) Nếu sân đang có trận "assigned" hoặc "live"
    const currentOnCourt = await Match.findOne({
      tournament: tournamentId,
      court: courtId,
      status: { $in: ["assigned", "live"] },
    })
      .select("_id status")
      .session(session);

    if (currentOnCourt && !replace) {
      await session.abortTransaction();
      return res.status(409).json({
        message: "Sân đang có trận. Thiếu quyền thay thế (replace=false).",
      });
    }

    // 3a) Gỡ trận đang chiếm sân (nếu có)
    if (currentOnCourt) {
      await Match.updateOne(
        { _id: currentOnCourt._id },
        {
          $unset: { court: "", courtLabel: "" },
          $set: { status: "queued" }, // đưa lại hàng đợi
        },
        { session }
      );
    }

    // 3b) Nếu trận mục tiêu đang ở sân khác -> gỡ khỏi sân cũ
    if (match.court && String(match.court) !== String(courtId)) {
      await Match.updateOne(
        { _id: match._id },
        { $unset: { court: "", courtLabel: "" } },
        { session }
      );

      // Set sân cũ (nếu còn) về idle nếu không còn trận assigned/live
      const oldCourtId = match.court;
      const stillBusy = await Match.exists({
        tournament: tournamentId,
        court: oldCourtId,
        status: { $in: ["assigned", "live"] },
      }).session(session);
      if (!stillBusy) {
        await Court.updateOne(
          { _id: oldCourtId },
          { $set: { status: "idle", currentMatch: null } },
          { session }
        );
      }
    }

    // 4) Gán trận mục tiêu vào sân
    const label = courtLabelOf(court);
    await Match.updateOne(
      { _id: match._id },
      {
        $set: {
          court: courtId,
          courtLabel: label,
          status: "assigned",
          courtCluster: String(bracket), // giữ cluster theo bracket để UI/state đọc được
        },
      },
      { session }
    );

    await Court.updateOne(
      { _id: courtId },
      { $set: { status: "assigned", currentMatch: match._id } },
      { session }
    );

    const [updatedMatch, updatedCourt] = await Promise.all([
      Match.findById(match._id).session(session),
      Court.findById(courtId).session(session),
    ]);

    await session.commitTransaction();
    session.endSession();

    return res.json({
      message: "Đã gán trận vào sân thành công.",
      court: updatedCourt,
      match: updatedMatch,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
});

/* ======================== ⭐ NEW: reset toàn bộ sân & gỡ gán ========================
 * POST /api/tournaments/:tournamentId/courts/reset
 * body: { bracket }
 * - Xoá tất cả Court trong bracket
 * - Gỡ 'court' & 'courtLabel' khỏi các trận đang gán (assigned/live) của bracket
 * - Đưa trạng thái các trận đang gán về 'queued' (finished giữ nguyên)
 */
export const resetCourtsHttp = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { bracket } = req.body || {};

  if (!mongoose.isValidObjectId(tournamentId)) {
    return res.status(400).json({ message: "Sai 'tournamentId'." });
  }
  if (!mongoose.isValidObjectId(bracket)) {
    return res.status(400).json({ message: "Sai 'bracket'." });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1) Gỡ gán khỏi các trận thuộc cluster/bracket này
    const unassignFilter = {
      tournament: tournamentId,
      // dùng cluster = bracket như các API khác trong file
      $or: [{ bracket }, { courtCluster: String(bracket) }],
      court: { $exists: true, $ne: null },
      status: { $in: ["assigned", "live"] },
    };

    const unassignRes = await Match.updateMany(
      unassignFilter,
      {
        $unset: { court: "", courtLabel: "" },
        $set: { status: "queued" },
      },
      { session }
    );

    // 2) Xoá hết Court của bracket này
    const deleteRes = await Court.deleteMany(
      { tournament: tournamentId, bracket },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      message: "Đã reset toàn bộ sân & gỡ gán các trận.",
      matchesUnassigned: unassignRes?.modifiedCount || 0,
      courtsDeleted: deleteRes?.deletedCount || 0,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
});
