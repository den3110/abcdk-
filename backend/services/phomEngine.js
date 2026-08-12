// services/phomEngine.js — Phỏm (Tá lả) engine skeleton.
// PHASE 2: deal 9 cards/player (10 cho nhà cái), meld detector primitives,
// serializeRoom (ẩn deck + bài người khác). Turn state machine + ù/hạ phỏm/
// scoring sẽ hoàn thiện Phase 3.
import { newDeck, shuffle, sortHand, cardRank, cardSuit, rankValue } from "./cardDeck.js";

export { newDeck, shuffle, sortHand };

// Ghế còn active (có user + không sitting out).
export function activeSeats(room) {
  return (room.seats || []).filter((s) => s?.user && !s.sittingOut);
}

// Bắt đầu ván mới. Deal 9 lá/người, nhà cái +1 lá (rút trước lượt đầu).
// Reset state ván trước.
export function startHand(room) {
  const seats = activeSeats(room);
  if (seats.length < 2) {
    throw new Error("Cần ít nhất 2 người để bắt đầu");
  }
  if (seats.length > 4) {
    throw new Error("Tối đa 4 người chơi Phỏm");
  }

  const deck = shuffle(newDeck());
  // Xoá state cũ của mỗi ghế
  for (const seat of room.seats) {
    if (!seat?.user) continue;
    seat.cards = [];
    seat.melds = [];
    seat.leftover = [];
    seat.hasWon = false;
    seat.hasDowned = false;
    seat.lastAction = null;
  }

  // Dealer luân phiên
  const activeIdxs = seats.map((s) => s.seatIndex);
  if (room.handNumber === 0) {
    room.dealerIndex = activeIdxs[0];
  } else {
    const curIdx = activeIdxs.indexOf(room.dealerIndex);
    room.dealerIndex = activeIdxs[(curIdx + 1) % activeIdxs.length];
  }

  // Deal 9 lá cho mỗi seat, nhà cái +1 (tổng 10, sẽ thảy 1 lá đầu tiên)
  let deckPtr = 0;
  for (const seat of seats) {
    const n = seat.seatIndex === room.dealerIndex ? 10 : 9;
    seat.cards = sortHand(deck.slice(deckPtr, deckPtr + n));
    deckPtr += n;
  }
  room.deck = deck.slice(deckPtr);
  room.discards = [];
  room.currentCombo = null;
  room.winners = [];
  room.handNumber += 1;
  room.stage = "playing";
  // Nhà cái đánh trước (đã có 10 lá, thảy 1 lá xuống discard)
  room.activeIndex = room.dealerIndex;
  room.handStartedAt = new Date();
  room.handEndedAt = null;
  const now = Date.now();
  room.turnDeadlineAt = new Date(now + (room.turnDurationSec || 30) * 1000);
  return room;
}

/* -------- Meld primitives -------- */

// Kiểm tra 3+ bài cùng bậc (VD: 3 con A).
export function isSameRank(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const r = cardRank(cards[0]);
  return cards.every((c) => cardRank(c) === r);
}

// Kiểm tra 3+ bài liên tiếp cùng chất (VD: 5♥ 6♥ 7♥).
export function isStraightSameSuit(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const s = cardSuit(cards[0]);
  if (!cards.every((c) => cardSuit(c) === s)) return false;
  const vals = cards.map(rankValue).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1] + 1) return false;
  }
  return true;
}

// Là phỏm (meld) hợp lệ?
export function isValidMeld(cards) {
  return isSameRank(cards) || isStraightSameSuit(cards);
}

/* -------- Serializer -------- */

// Chuẩn hoá room trả về cho client — ẩn deck + bài người khác (chỉ hiện
// số lá). viewerUserId nhìn thấy bài của chính mình.
export function serializeRoom(room, viewerUserId) {
  const meIdStr = viewerUserId ? String(viewerUserId) : "";
  const seats = (room.seats || []).map((s) => {
    const isMine = s?.user && String(s.user._id || s.user) === meIdStr;
    return {
      user: s.user,
      seatIndex: s.seatIndex,
      chips: s.chips,
      cards: isMine ? s.cards : [],
      cardCount: (s.cards || []).length,
      melds: s.melds || [],
      leftover: s.leftover || [],
      hasWon: s.hasWon,
      hasDowned: s.hasDowned,
      lastAction: s.lastAction,
      sittingOut: s.sittingOut,
    };
  });
  return {
    _id: room._id,
    name: room.name,
    createdBy: room.createdBy,
    buyIn: room.buyIn,
    stake: room.stake,
    maxSeats: room.maxSeats,
    seats,
    handNumber: room.handNumber,
    stage: room.stage,
    dealerIndex: room.dealerIndex,
    activeIndex: room.activeIndex,
    deckCount: (room.deck || []).length,
    discards: room.discards || [],
    currentCombo: room.currentCombo || null,
    winners: room.winners || [],
    handStartedAt: room.handStartedAt,
    handEndedAt: room.handEndedAt,
    turnDeadlineAt: room.turnDeadlineAt,
    turnDurationSec: room.turnDurationSec,
    messages: room.messages || [],
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

/* -------- Apply action (Phase 3 sẽ mở rộng) -------- */

// Placeholder — Phase 3 sẽ implement draw_deck / draw_discard / discard /
// down / gui / u với validation đầy đủ.
export function applyAction(_room, _seatIndex, _action, _payload) {
  throw new Error("Phỏm gameplay chưa hoàn thiện (Phase 3)");
}
