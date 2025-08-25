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
export const upsertCourts = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  console.log(req.body)
  const { bracket, cluster, names, count } = req.body || {};
    console.log(bracket)
  if (!mongoose.isValidObjectId(tournamentId)) {
    return res.status(400).json({ message: "Invalid tournament id" });
  }
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }

  // reuse cluster cũ cho pipeline xếp lịch (dùng chính bracketId làm 'cluster-key')
  const clusterKey = String(bracket);

  let desired = [];
  if (Array.isArray(names) && names.length) {
    desired = names.map((s) => String(s).trim()).filter(Boolean);
  } else if (Number.isInteger(count) && count > 0) {
    desired = Array.from({ length: count }, (_, i) => `Sân ${i + 1}`);
  } else {
    return res.status(400).json({ message: "Thiếu 'names' hoặc 'count' > 0" });
  }

  const tid = new mongoose.Types.ObjectId(tournamentId);
  const bid = new mongoose.Types.ObjectId(bracket);

  // Lấy các sân hiện có trong đúng bracket
  const existing = await Court.find({ tournament: tid, bracket: bid }).lean();
  const byName = new Map(existing.map((c) => [c.name, c]));

  const bulk = [];
  desired.forEach((name, idx) => {
    const f = byName.get(name);
    if (f) {
      bulk.push({
        updateOne: {
          filter: { _id: f._id },
          update: {
            $set: {
              order: idx,
              isActive: true,
              status: f.status === "maintenance" ? "idle" : f.status,
              // giữ nguyên cluster cũ nếu bạn vẫn dùng để hiển thị label; không bắt buộc
              cluster: cluster ?? f.cluster ?? clusterKey,
            },
          },
        },
      });
    } else {
      bulk.push({
        insertOne: {
          document: {
            tournament: tid,
            bracket: bid, // 🔴 bắt buộc
            name,
            // cluster chỉ để label/nhãn; mặc định dùng bracketId để tương thích queue-service hiện tại
            cluster: cluster ?? clusterKey,
            order: idx,
            isActive: true,
            status: "idle",
            currentMatch: null,
          },
        },
      });
    }
  });

  // Deactivate những sân không còn trong danh sách (trong đúng bracket)
  existing.forEach((c) => {
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
  });

  if (bulk.length) await Court.bulkWrite(bulk);

  // Build queue + fill ngay (tạm thời truyền clusterKey = bracketId vào service cũ)
  await buildGroupsRotationQueue({ tournamentId, cluster: clusterKey });
  const fill = await fillIdleCourtsForCluster({
    tournamentId,
    cluster: clusterKey,
  });

  const items = await Court.find({ tournament: tid, bracket: bid })
    .sort({ order: 1 })
    .lean();

  res.json({ items, ...fill });
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
    Court.find({ tournament: tournamentId, bracket, isActive: true }).sort({ order: 1 }).lean(),
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
