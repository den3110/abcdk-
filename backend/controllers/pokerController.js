// controllers/pokerController.js — Texas Hold'em multiplayer.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import PokerRoom from "../models/pokerRoomModel.js";
import {
  startHand,
  applyAction,
  activeSeats,
  serializeRoom,
} from "../services/pokerEngine.js";
import { getIO } from "../socket/index.js";

const USER_FIELDS = "_id name nickname avatar";

function emitRoomTo(room, event, payload) {
  try {
    const io = getIO?.();
    if (io) io.to(`poker:room:${room._id}`).emit(event, payload);
  } catch (err) {
    console.error("[poker] emit error:", err?.message || err);
  }
}

// Broadcast state — mỗi viewer thấy state riêng (cards khác nhau).
// Nếu emit chung thì lộ cards. Cách xử lý: emit sự kiện "poker:room:updated"
// dạng thông báo, client sẽ tự gọi GET /rooms/:id để lấy state với cards
// của mình. Simple và safe.
function broadcastUpdate(room) {
  emitRoomTo(room, "poker:room:updated", { roomId: String(room._id) });
}

async function populateRoom(room) {
  return room.populate("seats.user", USER_FIELDS);
}

/* ═══════════ Room CRUD ═══════════ */

// GET /api/poker/rooms — list open rooms
export const listPokerRooms = asyncHandler(async (req, res) => {
  const rooms = await PokerRoom.find({ status: "open" })
    .sort({ lastActivityAt: -1 })
    .limit(50)
    .populate("seats.user", USER_FIELDS)
    .lean();
  const items = rooms.map((r) => ({
    _id: r._id,
    name: r.name,
    smallBlind: r.smallBlind,
    bigBlind: r.bigBlind,
    buyIn: r.buyIn,
    maxSeats: r.maxSeats,
    seatsTaken: (r.seats || []).filter((s) => s.user).length,
    stage: r.stage,
    handNumber: r.handNumber,
    lastActivityAt: r.lastActivityAt,
  }));
  res.json({ items });
});

// POST /api/poker/rooms  { name, smallBlind, bigBlind, buyIn }
export const createPokerRoom = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || `Bàn của ${req.user?.nickname || req.user?.name || "user"}`).slice(0, 60);
  const smallBlind = Math.max(1, Math.min(1000, Number(b.smallBlind) || 5));
  const bigBlind = Math.max(smallBlind * 2, Math.min(10000, Number(b.bigBlind) || smallBlind * 2));
  const buyIn = Math.max(bigBlind * 20, Math.min(1_000_000, Number(b.buyIn) || bigBlind * 100));
  const maxSeats = Math.max(2, Math.min(9, Number(b.maxSeats) || 6));
  const seats = Array.from({ length: maxSeats }, (_, i) => ({
    seatIndex: i,
    user: null,
    chips: 0,
    cards: [],
    betThisStreet: 0,
    totalBetThisHand: 0,
    hasFolded: false,
    isAllIn: false,
    sittingOut: false,
  }));
  const room = await PokerRoom.create({
    name,
    createdBy: req.user._id,
    smallBlind,
    bigBlind,
    buyIn,
    maxSeats,
    seats,
    status: "open",
    stage: "waiting",
  });
  const populated = await populateRoom(room);
  res.status(201).json({ room: serializeRoom(populated, req.user._id) });
});

// GET /api/poker/rooms/:id
export const getPokerRoom = asyncHandler(async (req, res) => {
  const room = await PokerRoom.findById(req.params.id).populate(
    "seats.user",
    USER_FIELDS,
  );
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  res.json({ room: serializeRoom(room, req.user?._id) });
});

// POST /api/poker/rooms/:id/sit  { seatIndex }
export const sitPokerRoom = asyncHandler(async (req, res) => {
  const room = await PokerRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
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
  // Check đã ngồi ở ghế khác chưa
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

// POST /api/poker/rooms/:id/leave
export const leavePokerRoom = asyncHandler(async (req, res) => {
  const room = await PokerRoom.findById(req.params.id);
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
  // Nếu đang trong hand → fold trước rồi mới rời
  if (room.stage !== "waiting" && seat.cards?.length && !seat.hasFolded) {
    seat.hasFolded = true;
    seat.lastAction = "fold";
  }
  seat.user = null;
  seat.chips = 0;
  seat.cards = [];
  seat.betThisStreet = 0;
  seat.totalBetThisHand = 0;
  seat.hasFolded = false;
  seat.isAllIn = false;
  seat.sittingOut = false;
  seat.lastAction = null;
  room.lastActivityAt = new Date();
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated, req.user._id) });
});

// POST /api/poker/rooms/:id/start — start next hand
export const startPokerHand = asyncHandler(async (req, res) => {
  const room = await PokerRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  if (room.stage !== "waiting") {
    res.status(400);
    throw new Error("Ván đang diễn ra");
  }
  const active = activeSeats(room);
  if (active.length < 2) {
    res.status(400);
    throw new Error("Cần ít nhất 2 người có chip");
  }
  try {
    startHand(room);
  } catch (err) {
    res.status(400);
    throw err;
  }
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated, req.user._id) });
});

// POST /api/poker/rooms/:id/action  { action, amount }
export const pokerAction = asyncHandler(async (req, res) => {
  const room = await PokerRoom.findById(req.params.id);
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
  const { action, amount } = req.body || {};
  try {
    applyAction(room, seat.seatIndex, action, Number(amount) || 0);
  } catch (err) {
    res.status(400);
    throw err;
  }
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  res.json({ room: serializeRoom(populated, req.user._id) });
});
