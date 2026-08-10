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

// Map roomId → timeout để clear khi có action mới. In-memory: nếu server
// restart, timer mất — chấp nhận cho MVP; client-side có thể bấm sớm rồi
// server không nhận (timeout đã fire). Chỉ mất 1 lượt.
const roomTimers = new Map();

function scheduleTimeout(roomId) {
  clearTimeout(roomTimers.get(String(roomId)));
  roomTimers.delete(String(roomId));
  // Load room state để lấy deadline
  PokerRoom.findById(roomId)
    .select("turnDeadlineAt activeIndex stage")
    .lean()
    .then((r) => {
      if (!r || !r.turnDeadlineAt || r.activeIndex < 0 || r.stage === "waiting") {
        return;
      }
      const ms = Math.max(
        0,
        new Date(r.turnDeadlineAt).getTime() - Date.now(),
      );
      const t = setTimeout(() => autoAct(roomId).catch(() => {}), ms + 500);
      roomTimers.set(String(roomId), t);
    })
    .catch(() => {});
}

async function autoAct(roomId) {
  const room = await PokerRoom.findById(roomId);
  if (!room) return;
  if (room.stage === "waiting" || room.activeIndex < 0) return;
  const deadline = room.turnDeadlineAt
    ? new Date(room.turnDeadlineAt).getTime()
    : 0;
  if (Date.now() < deadline - 200) {
    // Timer chưa hết — reschedule
    scheduleTimeout(roomId);
    return;
  }
  const seat = room.seats[room.activeIndex];
  if (!seat || !seat.user) return;
  const toCall = room.currentBet - seat.betThisStreet;
  const action = toCall > 0 ? "fold" : "check";
  try {
    const { applyAction } = await import("../services/pokerEngine.js");
    applyAction(room, room.activeIndex, action, 0);
    await room.save();
    const populated = await room.populate("seats.user", USER_FIELDS);
    getIO?.()
      ?.to(`poker:room:${room._id}`)
      .emit("poker:room:updated", { roomId: String(room._id) });
    // Schedule cho lượt kế tiếp
    if (populated.activeIndex >= 0 && populated.stage !== "waiting") {
      scheduleTimeout(populated._id);
    }
  } catch (err) {
    console.error("[poker] autoAct error:", err?.message || err);
  }
}

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
  scheduleTimeout(room._id);
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
  if (populated.activeIndex >= 0 && populated.stage !== "waiting") {
    scheduleTimeout(populated._id);
  }
  res.json({ room: serializeRoom(populated, req.user._id) });
});

// POST /api/poker/rooms/:id/emoji  { emoji }
// Ephemeral emoji reaction, không lưu DB, chỉ emit socket.
const EMOJI_WHITELIST = new Set(["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "👏", "🎉"]);
export const emojiPokerRoom = asyncHandler(async (req, res) => {
  const room = await PokerRoom.findById(req.params.id).select("seats").lean();
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const seat = (room.seats || []).find(
    (s) => String(s.user) === String(req.user._id),
  );
  if (!seat) {
    res.status(400);
    throw new Error("Bạn không ở bàn này");
  }
  const emoji = String(req.body?.emoji || "").slice(0, 6);
  if (!EMOJI_WHITELIST.has(emoji)) {
    res.status(400);
    throw new Error("Emoji không hợp lệ");
  }
  getIO?.()
    ?.to(`poker:room:${req.params.id}`)
    .emit("poker:room:emoji", {
      roomId: String(req.params.id),
      seatIndex: seat.seatIndex,
      emoji,
      at: Date.now(),
    });
  res.json({ success: true });
});

// POST /api/poker/rooms/:id/reveal — khoe bài cuối ván. Chỉ hoạt động khi
// stage === "waiting" hoặc "showdown" (ván vừa xong), user còn có bài
// trong sub state (chưa reset sang ván mới).
export const revealPokerCards = asyncHandler(async (req, res) => {
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
  if (!seat.cards?.length) {
    res.status(400);
    throw new Error("Bạn không có bài để khoe");
  }
  const already = (room.reveals || []).some(
    (r) => Number(r.seatIndex) === seat.seatIndex,
  );
  if (already) {
    res.status(400);
    throw new Error("Đã khoe rồi");
  }
  room.reveals.push({
    seatIndex: seat.seatIndex,
    userId: req.user._id,
    cards: seat.cards.slice(),
    at: new Date(),
  });
  await room.save();
  const populated = await populateRoom(room);
  broadcastUpdate(populated);
  getIO?.()
    ?.to(`poker:room:${room._id}`)
    .emit("poker:room:reveal", {
      roomId: String(room._id),
      seatIndex: seat.seatIndex,
      cards: seat.cards.slice(),
    });
  res.json({ success: true });
});

// POST /api/poker/rooms/:id/chat  { text }
export const chatPokerRoom = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 300);
  if (!text) {
    res.status(400);
    throw new Error("Nội dung trống");
  }
  const room = await PokerRoom.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy bàn");
  }
  const msg = {
    user: req.user._id,
    name: req.user.nickname || req.user.name || "User",
    avatar: req.user.avatar || "",
    text,
    at: new Date(),
  };
  room.messages.push(msg);
  // Cap 100 tin gần nhất
  if (room.messages.length > 100) {
    room.messages = room.messages.slice(-100);
  }
  room.lastActivityAt = new Date();
  await room.save();
  getIO?.()
    ?.to(`poker:room:${room._id}`)
    .emit("poker:room:chat", { roomId: String(room._id), message: msg });
  res.json({ success: true, message: msg });
});
