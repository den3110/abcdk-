// controllers/xiangqiController.js — Cờ tướng
import asyncHandler from "express-async-handler";
import XiangqiRoom from "../models/xiangqiRoomModel.js";
import {
  startHand,
  applyMove,
  applyResign,
  serializeRoom,
} from "../services/xiangqiEngine.js";
import { getIO } from "../socket/index.js";
import { sendToUserIds } from "../services/notifications/expoPush.js";
import { createInAppNotifications } from "../services/inAppNotify.js";

const USER_FIELDS = "_id name nickname avatar";

const ROOM_IDLE_MS = 15 * 60 * 1000;
async function closeStaleRooms() {
  try {
    await XiangqiRoom.updateMany(
      { status: "open", lastActivityAt: { $lt: new Date(Date.now() - ROOM_IDLE_MS) } },
      { $set: { status: "closed" } },
    );
  } catch {}
}
setInterval(closeStaleRooms, 60_000).unref?.();

function emitRoomTo(room, event, payload) {
  try {
    getIO?.()?.to(`xiangqi:room:${room._id}`).emit(event, payload);
  } catch {}
}
function broadcastUpdate(room) {
  emitRoomTo(room, "xiangqi:room:updated", { roomId: String(room._id) });
}
async function populateRoom(room) {
  return room.populate("seats.user", USER_FIELDS);
}

export const listXiangqiRooms = asyncHandler(async (_req, res) => {
  await closeStaleRooms();
  const rooms = await XiangqiRoom.find({ status: "open" })
    .sort({ lastActivityAt: -1 })
    .limit(50)
    .populate("seats.user", USER_FIELDS)
    .lean();
  res.json({
    items: rooms.map((r) => ({
      _id: r._id,
      name: r.name,
      stake: r.stake,
      buyIn: r.buyIn,
      maxSeats: r.maxSeats,
      seatsTaken: (r.seats || []).filter((s) => s.user).length,
      stage: r.stage,
      handNumber: r.handNumber,
      lastActivityAt: r.lastActivityAt,
    })),
  });
});

export const createXiangqiRoom = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(
    b.name || `Bàn của ${req.user?.nickname || req.user?.name || "user"}`,
  ).slice(0, 60);
  const stake = Math.max(1, Math.min(10000, Number(b.stake) || 100));
  const buyIn = Math.max(stake * 10, Math.min(1_000_000, Number(b.buyIn) || 1000));
  const seats = Array.from({ length: 2 }, (_, i) => ({
    seatIndex: i,
    user: null,
    chips: 0,
    sittingOut: false,
  }));
  seats[0].user = req.user._id;
  seats[0].chips = buyIn;
  const room = await XiangqiRoom.create({
    name,
    createdBy: req.user._id,
    stake,
    buyIn,
    maxSeats: 2,
    seats,
    status: "open",
    stage: "waiting",
  });
  const populated = await populateRoom(room);
  res.status(201).json({ room: serializeRoom(populated) });
});

export const getXiangqiRoom = asyncHandler(async (req, res) => {
  const room = await XiangqiRoom.findById(req.params.id).populate(
    "seats.user",
    USER_FIELDS,
  );
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  res.json({ room: serializeRoom(room) });
});

export const sitXiangqiRoom = asyncHandler(async (req, res) => {
  const room = await XiangqiRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  if (room.stage === "playing") {
    res.status(400);
    throw new Error("Ván đang chơi — vui lòng chờ ván kết thúc rồi vào");
  }
  const seatIdx = Number(req.body?.seatIndex);
  if (!Number.isFinite(seatIdx) || seatIdx < 0 || seatIdx >= room.seats.length) {
    res.status(400);
    throw new Error("Ghế không hợp lệ");
  }
  const already = room.seats.find(
    (s) => String(s.user) === String(req.user._id),
  );
  if (already) {
    res.status(400);
    throw new Error("Bạn đã ngồi ở ghế " + already.seatIndex);
  }
  const seat = room.seats[seatIdx];
  if (seat.user) {
    res.status(400);
    throw new Error("Ghế đã có người");
  }
  seat.user = req.user._id;
  seat.chips = room.buyIn;
  seat.sittingOut = false;
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated) });
});

export const leaveXiangqiRoom = asyncHandler(async (req, res) => {
  const room = await XiangqiRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const seat = room.seats.find(
    (s) => String(s.user) === String(req.user._id),
  );
  if (!seat) {
    res.status(400);
    throw new Error("Bạn không ở bàn này");
  }
  if (room.stage === "playing") {
    try {
      applyResign(room, seat.seatIndex);
    } catch {}
  }
  seat.user = null;
  seat.chips = 0;
  seat.sittingOut = false;
  if (String(room.createdBy) === String(req.user._id)) {
    const nextHost = room.seats.find((s) => s.user);
    if (nextHost) room.createdBy = nextHost.user;
  }
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated) });
});

export const startXiangqiHand = asyncHandler(async (req, res) => {
  const room = await XiangqiRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  if (String(room.createdBy) !== String(req.user._id)) {
    res.status(403);
    throw new Error("Chỉ chủ phòng mới có quyền bắt đầu ván");
  }
  const isSeated = room.seats.some(
    (s) => String(s.user) === String(req.user._id),
  );
  if (!isSeated) {
    res.status(403);
    throw new Error("Bạn phải ngồi vào bàn trước");
  }
  if (room.stage !== "waiting" && room.stage !== "showdown") {
    res.status(400);
    throw new Error("Ván đang chơi");
  }
  try {
    startHand(room);
  } catch (err) {
    res.status(400);
    throw err;
  }
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated) });
});

// POST /api/xiangqi/rooms/:id/move  { from: [r,c], to: [r,c] }
export const xiangqiMove = asyncHandler(async (req, res) => {
  const room = await XiangqiRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const seat = room.seats.find(
    (s) => String(s.user) === String(req.user._id),
  );
  if (!seat) {
    res.status(403);
    throw new Error("Bạn không ở bàn này");
  }
  const { from, to } = req.body || {};
  if (!Array.isArray(from) || !Array.isArray(to)) {
    res.status(400);
    throw new Error("from/to không hợp lệ");
  }
  try {
    applyMove(room, seat.seatIndex, [Number(from[0]), Number(from[1])], [
      Number(to[0]),
      Number(to[1]),
    ]);
  } catch (err) {
    res.status(400);
    throw err;
  }
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated) });
});

export const xiangqiResign = asyncHandler(async (req, res) => {
  const room = await XiangqiRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const seat = room.seats.find(
    (s) => String(s.user) === String(req.user._id),
  );
  if (!seat) {
    res.status(403);
    throw new Error("Bạn không ở bàn này");
  }
  try {
    applyResign(room, seat.seatIndex);
  } catch (err) {
    res.status(400);
    throw err;
  }
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated) });
});

export const chatXiangqiRoom = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 300);
  if (!text) {
    res.status(400);
    throw new Error("Trống");
  }
  const room = await XiangqiRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const msg = {
    user: req.user._id,
    name: req.user.nickname || req.user.name,
    avatar: req.user.avatar,
    text,
    at: new Date(),
  };
  room.messages.push(msg);
  if (room.messages.length > 100) room.messages = room.messages.slice(-100);
  room.lastActivityAt = new Date();
  await room.save();
  emitRoomTo(room, "xiangqi:room:chat", { roomId: String(room._id), message: msg });
  res.json({ ok: true, message: msg });
});

const inviteLog = new Map();
export const inviteXiangqiRoom = asyncHandler(async (req, res) => {
  const userIds = Array.isArray(req.body?.userIds)
    ? req.body.userIds.filter(Boolean).slice(0, 20)
    : [];
  if (!userIds.length) {
    res.status(400);
    throw new Error("Chưa chọn ai");
  }
  const key = String(req.user._id);
  const now = Date.now();
  const arr = (inviteLog.get(key) || []).filter((t) => now - t < 3600_000);
  if (arr.length >= 30) {
    res.status(429);
    throw new Error("Bạn mời quá nhiều — thử lại sau 1 giờ");
  }
  arr.push(now);
  inviteLog.set(key, arr);
  const room = await XiangqiRoom.findById(req.params.id).select("_id name");
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const title = "🀄 Mời chơi Cờ Tướng";
  const body = `${req.user.nickname || req.user.name} mời bạn vào bàn "${room.name}"`;
  const data = { url: `/xiangqi/${room._id}`, roomId: String(room._id) };
  try {
    await Promise.allSettled([
      sendToUserIds(userIds, { title, body, data }),
      createInAppNotifications(userIds, {
        kind: "XIANGQI_INVITE",
        title,
        body,
        data,
      }),
    ]);
  } catch {}
  res.json({ ok: true, invited: userIds.length });
});
