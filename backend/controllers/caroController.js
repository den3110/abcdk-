// controllers/caroController.js — Cờ Caro (Gomoku).
import asyncHandler from "express-async-handler";
import CaroRoom from "../models/caroRoomModel.js";
import {
  startHand,
  applyMove,
  serializeRoom,
} from "../services/caroEngine.js";
import { getIO } from "../socket/index.js";
import { sendToUserIds } from "../services/notifications/expoPush.js";
import { createInAppNotifications } from "../services/inAppNotify.js";

const USER_FIELDS = "_id name nickname avatar";
const EMOJI_WHITELIST = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏"];

const ROOM_IDLE_MS = 10 * 60 * 1000;
async function closeStaleRooms() {
  try {
    await CaroRoom.updateMany(
      {
        status: "open",
        lastActivityAt: { $lt: new Date(Date.now() - ROOM_IDLE_MS) },
      },
      { $set: { status: "closed" } },
    );
  } catch (err) {
    console.error("[caro] closeStaleRooms:", err?.message || err);
  }
}
setInterval(closeStaleRooms, 60_000).unref?.();

function emitRoomTo(room, event, payload) {
  try {
    getIO?.()?.to(`caro:room:${room._id}`).emit(event, payload);
  } catch (err) {
    console.error("[caro] emit:", err?.message || err);
  }
}
function broadcastUpdate(room) {
  emitRoomTo(room, "caro:room:updated", { roomId: String(room._id) });
  broadcastLobby();
}
function broadcastLobby() {
  try {
    getIO?.()?.to("caro:lobby").emit("caro:lobby:updated", {});
  } catch {}
}
async function populateRoom(room) {
  return room.populate("seats.user", USER_FIELDS);
}

/* ═════════ Room CRUD ═════════ */

export const listCaroRooms = asyncHandler(async (req, res) => {
  await closeStaleRooms();
  const rooms = await CaroRoom.find({ status: "open" })
    .sort({ lastActivityAt: -1 })
    .limit(50)
    .populate("seats.user", USER_FIELDS)
    .lean();
  const items = rooms.map((r) => ({
    _id: r._id,
    name: r.name,
    stake: r.stake,
    buyIn: r.buyIn,
    boardSize: r.boardSize,
    maxSeats: r.maxSeats,
    seatsTaken: (r.seats || []).filter((s) => s.user).length,
    seatUsers: (r.seats || [])
      .filter((s) => s?.user)
      .map((s) => ({
        _id: s.user._id,
        nickname: s.user.nickname,
        name: s.user.name,
        avatar: s.user.avatar,
      })),
    createdBy: r.createdBy,
    stage: r.stage,
    handNumber: r.handNumber,
    lastActivityAt: r.lastActivityAt,
  }));
  res.json({ items });
});

export const createCaroRoom = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(
    b.name || `Bàn của ${req.user?.nickname || req.user?.name || "user"}`,
  ).slice(0, 60);
  const stake = Math.max(1, Math.min(10000, Number(b.stake) || 100));
  const buyIn = Math.max(stake * 10, Math.min(1_000_000, Number(b.buyIn) || 1000));
  const boardSize = Math.max(10, Math.min(20, Number(b.boardSize) || 15));
  const maxSeats = 2;
  const seats = Array.from({ length: maxSeats }, (_, i) => ({
    seatIndex: i,
    user: null,
    chips: 0,
    sittingOut: false,
  }));
  seats[0].user = req.user._id;
  seats[0].chips = buyIn;
  const room = await CaroRoom.create({
    name,
    createdBy: req.user._id,
    stake,
    buyIn,
    boardSize,
    maxSeats,
    seats,
    status: "open",
    stage: "waiting",
  });
  const populated = await populateRoom(room);
  broadcastLobby();
  res.status(201).json({ room: serializeRoom(populated) });
});

export const getCaroRoom = asyncHandler(async (req, res) => {
  const room = await CaroRoom.findById(req.params.id).populate(
    "seats.user",
    USER_FIELDS,
  );
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  res.json({ room: serializeRoom(room) });
});

export const sitCaroRoom = asyncHandler(async (req, res) => {
  const room = await CaroRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  if (room.status === "closed") {
    res.status(400);
    throw new Error("Bàn đã đóng");
  }
  if (room.stage === "playing") {
    res.status(400);
    throw new Error("Ván đang chơi — vui lòng chờ ván kết thúc rồi vào");
  }
  const seatIdx = Number(req.body?.seatIndex);
  if (
    !Number.isFinite(seatIdx) ||
    seatIdx < 0 ||
    seatIdx >= room.seats.length
  ) {
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

export const leaveCaroRoom = asyncHandler(async (req, res) => {
  const room = await CaroRoom.findById(req.params.id);
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
  seat.user = null;
  seat.chips = 0;
  seat.sittingOut = false;
  if (String(room.createdBy) === String(req.user._id)) {
    const nextHost = room.seats.find((s) => s.user);
    if (nextHost) room.createdBy = nextHost.user;
  }
  if (!room.seats.some((s) => s.user)) {
    room.status = "closed";
  }
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated) });
});

export const startCaroHand = asyncHandler(async (req, res) => {
  const room = await CaroRoom.findById(req.params.id);
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
  if (room.stage === "playing") {
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

// POST /api/caro/rooms/:id/move  { row, col }
export const caroMove = asyncHandler(async (req, res) => {
  const room = await CaroRoom.findById(req.params.id);
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
  const { row, col } = req.body || {};
  try {
    applyMove(room, seat.seatIndex, Number(row), Number(col));
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

/* ═════════ Chat / emoji / invite ═════════ */

export const chatCaroRoom = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 300);
  if (!text) {
    res.status(400);
    throw new Error("Trống");
  }
  const room = await CaroRoom.findById(req.params.id);
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
  if (room.messages.length > 100) {
    room.messages = room.messages.slice(-100);
  }
  room.lastActivityAt = new Date();
  await room.save();
  emitRoomTo(room, "caro:room:chat", { roomId: String(room._id), message: msg });
  res.json({ ok: true, message: msg });
});

export const emojiCaroRoom = asyncHandler(async (req, res) => {
  const emoji = String(req.body?.emoji || "").trim();
  if (!EMOJI_WHITELIST.includes(emoji)) {
    res.status(400);
    throw new Error("Emoji không hợp lệ");
  }
  const room = await CaroRoom.findById(req.params.id).select("_id seats");
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const seat = room.seats.find(
    (s) => String(s.user) === String(req.user._id),
  );
  if (!seat) {
    res.status(400);
    throw new Error("Bạn không ở bàn");
  }
  emitRoomTo(room, "caro:room:emoji", {
    roomId: String(room._id),
    seatIndex: seat.seatIndex,
    emoji,
    at: Date.now(),
  });
  res.json({ ok: true });
});

const inviteLog = new Map();
export const inviteCaroRoom = asyncHandler(async (req, res) => {
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
  const room = await CaroRoom.findById(req.params.id).select("_id name");
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const title = "♟️ Mời chơi Caro";
  const body = `${req.user.nickname || req.user.name} mời bạn vào bàn "${room.name}"`;
  const data = { url: `/caro/${room._id}`, roomId: String(room._id) };
  try {
    await Promise.allSettled([
      sendToUserIds(userIds, { title, body, data }),
      createInAppNotifications(userIds, {
        kind: "CARO_INVITE",
        title,
        body,
        data,
      }),
    ]);
  } catch (err) {
    console.error("[caro] invite:", err?.message || err);
  }
  res.json({ ok: true, invited: userIds.length });
});
