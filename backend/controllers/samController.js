// controllers/samController.js — Sâm Lốc room controller.
// PHASE 2: room CRUD + sit/leave + start + chat + emoji + invite.
// Gameplay actions (play combo, pass, chặt, scoring) Phase 3.
import asyncHandler from "express-async-handler";
import SamRoom from "../models/samRoomModel.js";
import {
  startHand,
  serializeRoom,
  applyAction,
} from "../services/samEngine.js";
import { getIO } from "../socket/index.js";
import { sendToUserIds } from "../services/notifications/expoPush.js";
import { createInAppNotifications } from "../services/inAppNotify.js";

const USER_FIELDS = "_id name nickname avatar";
const EMOJI_WHITELIST = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏"];

const ROOM_IDLE_MS = 10 * 60 * 1000;
async function closeStaleRooms() {
  try {
    await SamRoom.updateMany(
      {
        status: "open",
        lastActivityAt: { $lt: new Date(Date.now() - ROOM_IDLE_MS) },
      },
      { $set: { status: "closed" } },
    );
  } catch (err) {
    console.error("[sam] closeStaleRooms:", err?.message || err);
  }
}
setInterval(closeStaleRooms, 60_000).unref?.();

function emitRoomTo(room, event, payload) {
  try {
    getIO?.()?.to(`sam:room:${room._id}`).emit(event, payload);
  } catch (err) {
    console.error("[sam] emit:", err?.message || err);
  }
}
function broadcastUpdate(room) {
  emitRoomTo(room, "sam:room:updated", { roomId: String(room._id) });
}
async function populateRoom(room) {
  return room.populate("seats.user", USER_FIELDS);
}

/* ═════════ Room CRUD ═════════ */

export const listSamRooms = asyncHandler(async (req, res) => {
  await closeStaleRooms();
  const rooms = await SamRoom.find({ status: "open" })
    .sort({ lastActivityAt: -1 })
    .limit(50)
    .populate("seats.user", USER_FIELDS)
    .lean();
  const items = rooms.map((r) => ({
    _id: r._id,
    name: r.name,
    stake: r.stake,
    buyIn: r.buyIn,
    maxSeats: r.maxSeats,
    seatsTaken: (r.seats || []).filter((s) => s.user).length,
    stage: r.stage,
    handNumber: r.handNumber,
    lastActivityAt: r.lastActivityAt,
  }));
  res.json({ items });
});

export const createSamRoom = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(
    b.name || `Bàn của ${req.user?.nickname || req.user?.name || "user"}`,
  ).slice(0, 60);
  const stake = Math.max(1, Math.min(10000, Number(b.stake) || 100));
  const buyIn = Math.max(stake * 10, Math.min(1_000_000, Number(b.buyIn) || 1000));
  const maxSeats = 4;
  const seats = Array.from({ length: maxSeats }, (_, i) => ({
    seatIndex: i,
    user: null,
    chips: 0,
    cards: [],
    hasFinished: false,
    finishOrder: 0,
    sittingOut: false,
  }));
  const room = await SamRoom.create({
    name,
    createdBy: req.user._id,
    stake,
    buyIn,
    maxSeats,
    seats,
    status: "open",
    stage: "waiting",
  });
  const populated = await populateRoom(room);
  res.status(201).json({ room: serializeRoom(populated, req.user._id) });
});

export const getSamRoom = asyncHandler(async (req, res) => {
  const room = await SamRoom.findById(req.params.id).populate(
    "seats.user",
    USER_FIELDS,
  );
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  res.json({ room: serializeRoom(room, req.user?._id) });
});

export const sitSamRoom = asyncHandler(async (req, res) => {
  const room = await SamRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  if (room.status === "closed") {
    res.status(400);
    throw new Error("Bàn đã đóng");
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
  res.json({ room: serializeRoom(populated, req.user._id) });
});

export const leaveSamRoom = asyncHandler(async (req, res) => {
  const room = await SamRoom.findById(req.params.id);
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
  seat.cards = [];
  seat.hasFinished = false;
  seat.finishOrder = 0;
  seat.sittingOut = false;
  seat.lastAction = null;
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated, req.user._id) });
});

export const startSamHand = asyncHandler(async (req, res) => {
  const room = await SamRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const isSeated = room.seats.some(
    (s) => String(s.user) === String(req.user._id),
  );
  if (!isSeated) {
    res.status(403);
    throw new Error("Bạn phải ngồi vào bàn trước");
  }
  if (room.stage !== "waiting") {
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
  res.json({ room: serializeRoom(populated, req.user._id) });
});

// POST /api/sam/rooms/:id/action  { action, cards? }
export const samAction = asyncHandler(async (req, res) => {
  const room = await SamRoom.findById(req.params.id);
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
  const { action, cards } = req.body || {};
  try {
    applyAction(room, seat.seatIndex, String(action || ""), { cards });
  } catch (err) {
    res.status(400);
    throw err;
  }
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated, req.user._id) });
});

/* ═════════ Chat / emoji / invite ═════════ */

export const chatSamRoom = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 300);
  if (!text) {
    res.status(400);
    throw new Error("Trống");
  }
  const room = await SamRoom.findById(req.params.id);
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
  emitRoomTo(room, "sam:room:chat", { roomId: String(room._id), message: msg });
  res.json({ ok: true, message: msg });
});

export const emojiSamRoom = asyncHandler(async (req, res) => {
  const emoji = String(req.body?.emoji || "").trim();
  if (!EMOJI_WHITELIST.includes(emoji)) {
    res.status(400);
    throw new Error("Emoji không hợp lệ");
  }
  const room = await SamRoom.findById(req.params.id).select("_id seats");
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
  emitRoomTo(room, "sam:room:emoji", {
    roomId: String(room._id),
    seatIndex: seat.seatIndex,
    emoji,
    at: Date.now(),
  });
  res.json({ ok: true });
});

const inviteLog = new Map();
export const inviteSamRoom = asyncHandler(async (req, res) => {
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
  const room = await SamRoom.findById(req.params.id).select("_id name");
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const title = "🃏 Mời chơi Sâm";
  const body = `${req.user.nickname || req.user.name} mời bạn vào bàn "${room.name}"`;
  const data = { url: `/sam/${room._id}`, roomId: String(room._id) };
  try {
    await Promise.allSettled([
      sendToUserIds(userIds, { title, body, data }),
      createInAppNotifications(userIds, {
        kind: "SAM_INVITE",
        title,
        body,
        data,
      }),
    ]);
  } catch (err) {
    console.error("[sam] invite:", err?.message || err);
  }
  res.json({ ok: true, invited: userIds.length });
});
