// services/courtQueueService.js
import mongoose from "mongoose";
import Court from "../models/courtModel.js";
import Match from "../models/matchModel.js";
import Registration from "../models/registrationModel.js";

/** Helper: build Map registrationId -> [userIds...] */
async function buildRegUsersMap(regIds) {
  if (!regIds.size) return new Map();
  const regs = await Registration.find({ _id: { $in: [...regIds] } })
    .select("player1.user player2.user")
    .lean();
  return new Map(
    regs.map((r) => [
      String(r._id),
      [r.player1?.user, r.player2?.user].filter(Boolean).map(String),
    ])
  );
}

/**
 * Xếp hàng đợi vòng bảng theo thứ tự interleaved: A1,B1,C1,... rồi A2,B2,...
 * - Ưu tiên lọc theo BRACKET (nếu truyền vào).
 * - Khi đưa vào queue: gắn courtCluster = clusterKey (thường = String(bracketId)).
 */
export async function buildGroupsRotationQueue({
  tournamentId,
  bracket, // optional: bracketId (string/ObjectId)
  cluster = "Main", // fallback cho mode cũ
}) {
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const clusterKey = bracket ? String(bracket) : cluster;

  const matchFilter = {
    tournament: tid,
    format: "group",
    status: { $in: ["scheduled", "queued", "assigned"] }, // giữ assigned
  };

  if (bracket) {
    matchFilter.bracket = new mongoose.Types.ObjectId(bracket);
  } else {
    // mode cũ: dựa theo courtCluster đã gán
    matchFilter.courtCluster = clusterKey;
  }

  const matches = await Match.find(matchFilter)
    .select("_id pool rrRound round order status pairA pairB")
    .lean();

  // nhóm theo pool.name
  const byPool = matches.reduce((acc, m) => {
    const key = (m.pool && m.pool.name) || "?";
    (acc[key] ||= []).push(m);
    return acc;
  }, {});

  // sắp trong từng pool theo rrRound/round rồi order
  const rk = (m) => (Number.isInteger(m.rrRound) ? m.rrRound : m.round || 0);
  Object.values(byPool).forEach((arr) =>
    arr.sort((a, b) => rk(a) - rk(b) || (a.order || 0) - (b.order || 0))
  );

  // interleave: A1,B1,C1..., A2,B2,C2...
  const pools = Object.keys(byPool).sort();
  const maxLen = Math.max(0, ...Object.values(byPool).map((a) => a.length));
  const linear = [];
  for (let i = 0; i < maxLen; i++) {
    for (const p of pools) {
      const m = byPool[p][i];
      if (m) linear.push(m);
    }
  }

  // denorm participants (để tránh double-book khi assign)
  const regIds = new Set();
  for (const m of linear) {
    if (m.pairA) regIds.add(String(m.pairA));
    if (m.pairB) regIds.add(String(m.pairB));
  }
  const regUsers = await buildRegUsersMap(regIds);

  let order = 1;
  const bulk = [];
  for (const m of linear) {
    if (m.status === "assigned") continue; // không đụng trận đang gán
    const participants = [
      ...(regUsers.get(String(m.pairA)) || []),
      ...(regUsers.get(String(m.pairB)) || []),
    ];
    bulk.push({
      updateOne: {
        filter: { _id: m._id },
        update: {
          $set: {
            status: "queued",
            queueOrder: order++,
            courtCluster: clusterKey, // QUAN TRỌNG: ghim cụm (thường = String(bracketId))
            ...(participants.length ? { participants } : {}),
          },
        },
      },
    });
  }
  if (bulk.length) await Match.bulkWrite(bulk);
  return { totalQueued: bulk.length, pools: pools.length };
}

/**
 * Gán trận tiếp theo vào 1 sân đang idle (tôn trọng thứ tự, tránh trùng VĐV đang bận).
 * Thứ tự ưu tiên:
 *  1) Trận QUEUED theo courtCluster (đúng chuẩn).
 *  2) Trận QUEUED theo BRACKET của sân nhưng chưa có courtCluster (data cũ).
 *  3) Trận SCHEDULED theo BRACKET của sân → assign thẳng (không cần queued).
 */
export async function assignNextToCourt({
  tournamentId,
  courtId,
  cluster = "Main",
}) {
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const cid = new mongoose.Types.ObjectId(courtId);

  const court = await Court.findById(cid)
    .select("tournament isActive status name bracket cluster")
    .lean();
  if (!court) return null; // court không tồn tại
  if (String(court.tournament) !== String(tid)) return null; // sai giải
  if (!court.isActive) return null; // sân đã deactivate
  if (court.status !== "idle") return null; // không idle thì thôi

  // danh sách user đang bận (đang assigned/live) trong cùng cụm
  const engaged = new Set(
    (
      await Match.find({
        tournament: tid,
        courtCluster: cluster,
        status: { $in: ["assigned", "live"] },
      })
        .select("participants")
        .lean()
    )
      .flatMap((m) => m.participants || [])
      .map(String)
  );

  // ===== Try 1: QUEUED theo courtCluster
  let next = await Match.findOneAndUpdate(
    {
      tournament: tid,
      court: null,
      courtCluster: cluster,
      status: "queued",
      ...(engaged.size
        ? { participants: { $not: { $elemMatch: { $in: [...engaged] } } } }
        : {}),
    },
    {
      $set: {
        status: "assigned",
        court: cid,
        courtLabel: court.name || "",
        assignedAt: new Date(),
        courtCluster: cluster, // đảm bảo đồng bộ
      },
    },
    { sort: { queueOrder: 1 }, new: true }
  );

  // ===== Try 2: QUEUED theo BRACKET của sân nhưng chưa có courtCluster
  if (!next) {
    const bid = court.bracket
      ? new mongoose.Types.ObjectId(court.bracket)
      : null;
    if (bid) {
      next = await Match.findOneAndUpdate(
        {
          tournament: tid,
          court: null,
          bracket: bid,
          status: "queued",
          $or: [
            { courtCluster: { $exists: false } },
            { courtCluster: null },
            { courtCluster: "" },
          ],
          ...(engaged.size
            ? { participants: { $not: { $elemMatch: { $in: [...engaged] } } } }
            : {}),
        },
        {
          $set: {
            status: "assigned",
            court: cid,
            courtLabel: court.name || "",
            assignedAt: new Date(),
            courtCluster: cluster,
          },
        },
        { sort: { queueOrder: 1 }, new: true }
      );
    }
  }

  // ===== Try 3: SCHEDULED theo BRACKET (không cần queued)
  if (!next) {
    const bid = court.bracket
      ? new mongoose.Types.ObjectId(court.bracket)
      : null;
    if (bid) {
      // Lấy một ít ứng viên theo thứ tự tự nhiên
      const candidates = await Match.find({
        tournament: tid,
        court: null,
        bracket: bid,
        status: "scheduled",
      })
        .sort({ rrRound: 1, round: 1, order: 1, createdAt: 1 })
        .limit(12)
        .select("_id pairA pairB participants")
        .lean();

      // Bổ sung participants nếu thiếu bằng cách tra Registration
      const regIds = new Set();
      for (const m of candidates) {
        if (!m.participants?.length) {
          if (m.pairA) regIds.add(String(m.pairA));
          if (m.pairB) regIds.add(String(m.pairB));
        }
      }
      const regUsers = await buildRegUsersMap(regIds);

      let chosen = null;
      for (const m of candidates) {
        const parts = m.participants?.length
          ? m.participants.map(String)
          : [
              ...(regUsers.get(String(m.pairA)) || []),
              ...(regUsers.get(String(m.pairB)) || []),
            ];
        const conflict = parts && parts.some((u) => engaged.has(String(u)));
        if (!conflict) {
          chosen = { _id: m._id, participants: parts };
          break;
        }
      }

      if (chosen) {
        // Tạo queueOrder mới (không bắt buộc, giúp sorting/analytics)
        const maxQ = await Match.find({
          tournament: tid,
          courtCluster: cluster,
        })
          .sort({ queueOrder: -1 })
          .limit(1)
          .select("queueOrder")
          .lean();
        const nextQ = (maxQ?.[0]?.queueOrder || 0) + 1;

        // Atomically assign nếu vẫn còn scheduled & chưa có court
        next = await Match.findOneAndUpdate(
          { _id: chosen._id, court: null, status: "scheduled" },
          {
            $set: {
              status: "assigned",
              court: cid,
              courtLabel: court.name || "",
              assignedAt: new Date(),
              courtCluster: cluster,
              queueOrder: nextQ,
              ...(chosen.participants?.length
                ? { participants: chosen.participants }
                : {}),
            },
          },
          { new: true }
        );
      }
    }
  }

  if (!next) return null;

  await Court.updateOne(
    { _id: cid },
    { $set: { status: "assigned", currentMatch: next._id } }
  );

  return next.toObject();
}

/**
 * Lấp đầy tất cả sân idle trong 1 cụm (theo order).
 * Dùng assignNextToCourt (đã hỗ trợ lấy từ scheduled).
 */
export async function fillIdleCourtsForCluster({
  tournamentId,
  cluster = "Main",
  maxAssign = Infinity,
}) {
  const tid = new mongoose.Types.ObjectId(tournamentId);

  const idleCourts = await Court.find({
    tournament: tid,
    cluster,
    isActive: true,
    status: "idle",
  })
    .select("_id")
    .sort({ order: 1 })
    .lean();

  let assignedNow = 0;
  for (const c of idleCourts) {
    if (assignedNow >= maxAssign) break;
    const ok = await assignNextToCourt({
      tournamentId,
      courtId: c._id,
      cluster,
    });
    if (ok) assignedNow++;
    else continue; // có thể sân này kẹt do trùng VĐV, thử sân kế tiếp
  }

  const remainingQueued = await Match.countDocuments({
    tournament: tid,
    courtCluster: cluster,
    status: "queued",
    court: null,
  });

  return { assignedNow, idleCourtsChecked: idleCourts.length, remainingQueued };
}

/**
 * Free sân rồi gán trận kế (thường gọi khi admin bấm "Free")
 */
export async function freeCourtAndAssignNext({ courtId }) {
  const court = await Court.findById(courtId)
    .select("_id tournament cluster")
    .lean();
  if (!court) return null;

  await Court.updateOne(
    { _id: courtId },
    { $set: { status: "idle", currentMatch: null } }
  );

  return assignNextToCourt({
    tournamentId: court.tournament,
    courtId,
    cluster: court.cluster || "Main", // theo thiết kế: cluster = String(bracketId)
  });
}

/**
 * Gọi sau khi 1 trận finished để free sân và gán tiếp.
 * Trả về { tournamentId, clusterKey, assigned } để socket/controller biết mà broadcast.
 */
export async function onMatchFinished({ matchId }) {
  const m = await Match.findById(matchId)
    .select("court tournament courtCluster")
    .lean();
  if (!m || !m.court)
    return { tournamentId: null, clusterKey: null, assigned: false };

  // Nếu match thiếu courtCluster, đọc cluster từ Court (cluster hiện là String(bracketId))
  const courtDoc = await Court.findById(m.court)
    .select("cluster isActive")
    .lean();
  const clusterKey = m.courtCluster || courtDoc?.cluster || "Main";

  await Court.updateOne(
    { _id: m.court },
    { $set: { status: "idle", currentMatch: null } }
  );

  // if (!courtDoc?.isActive) {
  //   // sân bị deactivate (ví dụ upsert loại bỏ sân này) → dừng tại đây, không auto-assign
  //   return { tournamentId: m.tournament, clusterKey, assigned: false };
  // }

  const assigned = await assignNextToCourt({
    tournamentId: m.tournament,
    courtId: m.court,
    cluster: clusterKey,
  });

  return {
    tournamentId: m.tournament,
    clusterKey,
    assigned: !!assigned,
  };
}
