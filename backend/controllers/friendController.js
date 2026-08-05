// controllers/friendController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Friendship from "../models/friendshipModel.js";
import User from "../models/userModel.js";
import Ranking from "../models/rankingModel.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";
import { getIO } from "../socket/index.js";
import { sendToUserIds } from "../services/notifications/expoPush.js";
import { createInAppNotifications } from "../services/inAppNotify.js";

const USER_FIELDS = "_id name nickname avatar role";

function emitToUser(userId, event, payload) {
  try {
    const io = getIO?.();
    if (io) io.to(`user:${String(userId)}`).emit(event, payload);
  } catch (err) {
    console.error("[friends] emit error:", err?.message || err);
  }
}

async function pickName(userId) {
  try {
    const u = await User.findById(userId).select("nickname name").lean();
    return u?.nickname || u?.name || "Ai đó";
  } catch {
    return "Ai đó";
  }
}

// Tra Friendship giữa A và B (bất kể hướng)
async function findEdge(a, b) {
  return Friendship.findOne({
    $or: [
      { requester: a, addressee: b },
      { requester: b, addressee: a },
    ],
  });
}

/* ─────────────────────── SEND REQUEST ─────────────────────── */

// POST /api/friends/request  { userId }
export const sendRequest = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const peerId = req.body?.userId;
  if (!peerId || !mongoose.isValidObjectId(peerId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }
  if (String(peerId) === String(viewer._id)) {
    res.status(400);
    throw new Error("Không thể tự kết bạn với mình");
  }
  const peer = await User.findById(peerId).select("_id");
  if (!peer) {
    res.status(404);
    throw new Error("Không tìm thấy user");
  }

  let edge = await findEdge(viewer._id, peerId);
  if (edge) {
    if (edge.status === "accepted") {
      return res.json({ status: "accepted", edge });
    }
    if (edge.status === "pending") {
      // Nếu peer trước đó đã gửi mình, coi như auto-accept
      if (String(edge.requester) === String(peerId)) {
        edge.status = "accepted";
        edge.acceptedAt = new Date();
        await edge.save();
        emitToUser(peerId, "friend:accepted", { by: String(viewer._id) });
        const name = await pickName(viewer._id);
        sendToUserIds(
          [String(peerId)],
          {
            title: "Đã kết bạn",
            body: `${name} đã chấp nhận lời mời kết bạn của bạn`,
            data: {
              url: `/user/${String(viewer._id)}`,
              kind: "FRIEND_ACCEPTED",
            },
          },
          { ttl: 3600 }
        ).catch(() => {});
        createInAppNotifications({
          recipients: [String(peerId)],
          actorId: viewer._id,
          type: "FRIEND_ACCEPTED",
          title: "Đã kết bạn",
          body: `${name} đã chấp nhận lời mời kết bạn của bạn`,
          url: `/user/${String(viewer._id)}`,
          data: { userId: String(viewer._id) },
        }).catch(() => {});
        return res.json({ status: "accepted", edge });
      }
      return res.json({ status: "pending", edge });
    }
    if (edge.status === "declined") {
      // Cho phép gửi lại
      edge.requester = viewer._id;
      edge.addressee = peerId;
      edge.status = "pending";
      edge.acceptedAt = null;
      await edge.save();
    } else if (edge.status === "blocked") {
      res.status(403);
      throw new Error("Không thể gửi lời mời tới user này");
    }
  } else {
    try {
      edge = await Friendship.create({
        requester: viewer._id,
        addressee: peerId,
        status: "pending",
      });
    } catch (err) {
      if (err?.code === 11000) {
        edge = await findEdge(viewer._id, peerId);
      } else throw err;
    }
  }

  emitToUser(peerId, "friend:request:new", {
    from: String(viewer._id),
    edgeId: String(edge._id),
  });

  const name = await pickName(viewer._id);
  sendToUserIds(
    [String(peerId)],
    {
      title: "Lời mời kết bạn",
      body: `${name} muốn kết bạn với bạn`,
      data: {
        url: `/friends?tab=incoming`,
        kind: "FRIEND_REQUEST_NEW",
      },
    },
    { ttl: 3600 }
  ).catch(() => {});
  createInAppNotifications({
    recipients: [String(peerId)],
    actorId: viewer._id,
    type: "FRIEND_REQUEST_NEW",
    title: "Lời mời kết bạn",
    body: `${name} muốn kết bạn với bạn`,
    url: `/friends`,
    data: { edgeId: String(edge._id) },
  }).catch(() => {});

  res.status(201).json({ status: "pending", edge });
});

/* ─────────────────────── ACCEPT / DECLINE ─────────────────────── */

// POST /api/friends/:id/accept
export const acceptRequest = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const edge = await Friendship.findById(req.params.id);
  if (!edge) {
    res.status(404);
    throw new Error("Không tìm thấy lời mời");
  }
  if (String(edge.addressee) !== String(viewer._id)) {
    res.status(403);
    throw new Error("Chỉ người nhận mới có quyền chấp nhận");
  }
  if (edge.status !== "pending") {
    res.status(400);
    throw new Error("Lời mời không còn ở trạng thái chờ");
  }
  edge.status = "accepted";
  edge.acceptedAt = new Date();
  await edge.save();

  emitToUser(edge.requester, "friend:accepted", {
    by: String(viewer._id),
  });
  const name = await pickName(viewer._id);
  sendToUserIds(
    [String(edge.requester)],
    {
      title: "Đã kết bạn",
      body: `${name} đã chấp nhận lời mời kết bạn`,
      data: {
        url: `/user/${String(viewer._id)}`,
        kind: "FRIEND_ACCEPTED",
      },
    },
    { ttl: 3600 }
  ).catch(() => {});
  createInAppNotifications({
    recipients: [String(edge.requester)],
    actorId: viewer._id,
    type: "FRIEND_ACCEPTED",
    title: "Đã kết bạn",
    body: `${name} đã chấp nhận lời mời kết bạn`,
    url: `/user/${String(viewer._id)}`,
    data: { userId: String(viewer._id) },
  }).catch(() => {});

  res.json({ status: "accepted", edge });
});

// POST /api/friends/:id/decline
export const declineRequest = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const edge = await Friendship.findById(req.params.id);
  if (!edge) {
    res.status(404);
    throw new Error("Không tìm thấy lời mời");
  }
  if (String(edge.addressee) !== String(viewer._id)) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  edge.status = "declined";
  await edge.save();
  res.json({ status: "declined" });
});

// DELETE /api/friends/edge/:id  — huỷ lời mời (nếu là requester) hoặc unfriend
export const removeEdge = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const edge = await Friendship.findById(req.params.id);
  if (!edge) {
    res.status(404);
    throw new Error("Không tìm thấy");
  }
  const isPart =
    String(edge.requester) === String(viewer._id) ||
    String(edge.addressee) === String(viewer._id);
  if (!isPart) {
    res.status(403);
    throw new Error("Không có quyền");
  }
  await edge.deleteOne();
  res.json({ success: true });
});

/* ─────────────────────── LISTINGS ─────────────────────── */

// GET /api/friends  (accepted)
export const listFriends = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const cursor = decodeCursor(req.query.cursor);
  const q = {
    status: "accepted",
    $or: [{ requester: viewer._id }, { addressee: viewer._id }],
  };
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }
  const docs = await Friendship.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("requester", USER_FIELDS)
    .populate("addressee", USER_FIELDS);

  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit).map((d) => {
    const isReq = String(d.requester?._id || d.requester) === String(viewer._id);
    const peer = isReq ? d.addressee : d.requester;
    return {
      edgeId: d._id,
      user: peer,
      since: d.acceptedAt || d.updatedAt,
    };
  });
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// GET /api/friends/requests?direction=incoming|outgoing
export const listRequests = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const direction = req.query.direction === "outgoing" ? "outgoing" : "incoming";
  const q = { status: "pending" };
  if (direction === "incoming") q.addressee = viewer._id;
  else q.requester = viewer._id;
  const docs = await Friendship.find(q)
    .sort({ _id: -1 })
    .limit(100)
    .populate("requester", USER_FIELDS)
    .populate("addressee", USER_FIELDS);
  const items = docs.map((d) => ({
    edgeId: d._id,
    user: direction === "incoming" ? d.requester : d.addressee,
    at: d.createdAt,
  }));
  res.json({ items });
});

// GET /api/friends/status/:userId → { status, edgeId? }
// status: none | pending_incoming | pending_outgoing | accepted | blocked
export const getStatus = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const peerId = req.params.userId;
  if (!mongoose.isValidObjectId(peerId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }
  if (String(peerId) === String(viewer._id)) {
    return res.json({ status: "self" });
  }
  const edge = await findEdge(viewer._id, peerId);
  if (!edge) return res.json({ status: "none" });
  if (edge.status === "accepted")
    return res.json({ status: "accepted", edgeId: edge._id });
  if (edge.status === "pending") {
    const outgoing = String(edge.requester) === String(viewer._id);
    return res.json({
      status: outgoing ? "pending_outgoing" : "pending_incoming",
      edgeId: edge._id,
    });
  }
  if (edge.status === "blocked")
    return res.json({ status: "blocked", edgeId: edge._id });
  return res.json({ status: "none" });
});

// GET /api/friends/counts → { friends, incoming, outgoing }
export const getCounts = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const [friends, incoming, outgoing] = await Promise.all([
    Friendship.countDocuments({
      status: "accepted",
      $or: [{ requester: viewer._id }, { addressee: viewer._id }],
    }),
    Friendship.countDocuments({
      status: "pending",
      addressee: viewer._id,
    }),
    Friendship.countDocuments({
      status: "pending",
      requester: viewer._id,
    }),
  ]);
  res.json({ friends, incoming, outgoing });
});

/**
 * GET /api/friends/suggestions?limit=10
 * Gợi ý kết bạn: ưu tiên cùng tỉnh + điểm trình gần (single/double ±0.5),
 * loại bỏ chính user + user đã có edge (pending/accepted/blocked).
 */
export const listSuggestions = asyncHandler(async (req, res) => {
  const viewer = req.user;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 30);

  // Lấy province + score của viewer
  const [me, myRanking] = await Promise.all([
    User.findById(viewer._id).select("_id province").lean(),
    Ranking.findOne({ user: viewer._id }).select("single double").lean(),
  ]);
  const myProvince = String(me?.province || "").trim();
  const myS = Number(myRanking?.single || 0);
  const myD = Number(myRanking?.double || 0);

  // ID đã có edge với viewer
  const edges = await Friendship.find({
    $or: [{ requester: viewer._id }, { addressee: viewer._id }],
  })
    .select("requester addressee")
    .lean();
  const excludeIds = new Set([String(viewer._id)]);
  for (const e of edges) {
    excludeIds.add(String(e.requester));
    excludeIds.add(String(e.addressee));
  }

  // Query 1: same province, active user, exclude edges
  const sameProvinceQuery = {
    _id: { $nin: Array.from(excludeIds).map((id) => new mongoose.Types.ObjectId(id)) },
    isDeleted: { $ne: true },
    isBanned: { $ne: true },
  };
  if (myProvince) sameProvinceQuery.province = myProvince;

  const sameProvince = await User.find(sameProvinceQuery)
    .select("_id name nickname avatar province")
    .limit(limit * 3)
    .lean();

  // Nếu chưa đủ, fetch thêm không giới hạn tỉnh
  let others = [];
  if (sameProvince.length < limit) {
    others = await User.find({
      _id: {
        $nin: [
          ...Array.from(excludeIds).map((id) => new mongoose.Types.ObjectId(id)),
          ...sameProvince.map((u) => u._id),
        ],
      },
      isDeleted: { $ne: true },
      isBanned: { $ne: true },
    })
      .select("_id name nickname avatar province")
      .limit(limit * 2)
      .lean();
  }

  const candidateIds = [...sameProvince, ...others].map((u) => u._id);
  const rankings = await Ranking.find({ user: { $in: candidateIds } })
    .select("user single double")
    .lean();
  const scoreMap = new Map(
    rankings.map((r) => [String(r.user), { single: Number(r.single) || 0, double: Number(r.double) || 0 }])
  );

  // Chấm điểm gợi ý: cùng tỉnh +50, khoảng cách skill (single+double) càng nhỏ càng tốt
  const scored = [...sameProvince, ...others].map((u) => {
    const score = scoreMap.get(String(u._id)) || { single: 0, double: 0 };
    let s = 0;
    if (myProvince && u.province === myProvince) s += 50;
    if (myS > 0 && score.single > 0) {
      s += Math.max(0, 20 - Math.abs(myS - score.single) * 10);
    }
    if (myD > 0 && score.double > 0) {
      s += Math.max(0, 20 - Math.abs(myD - score.double) * 10);
    }
    return { user: { ...u, score }, sortKey: s };
  });

  scored.sort((a, b) => b.sortKey - a.sortKey);
  const items = scored.slice(0, limit).map((x) => x.user);
  res.json({ items });
});
