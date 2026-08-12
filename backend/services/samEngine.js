// services/samEngine.js — Sâm Lốc engine skeleton.
// PHASE 2: deal 10 cards/player, combo primitives (đôi/tam/sảnh/tứ quý/
// sảnh rồng), serializeRoom. Turn state machine (play/pass, chặt 2, đền
// chip khi bắt tứ quý...) sẽ hoàn thiện Phase 3.
import { newDeck, shuffle, sortHand, cardRank, cardSuit, rankValue } from "./cardDeck.js";

export { newDeck, shuffle, sortHand };

export function activeSeats(room) {
  return (room.seats || []).filter((s) => s?.user && !s.sittingOut);
}

// Bắt đầu ván. Deal 10 lá cho mỗi seat (4 người = 40 lá; deck 52 lá dư 12).
// Người có 3♠ đánh đầu (starter). Ván sau: người thắng ván trước đánh đầu.
export function startHand(room) {
  const seats = activeSeats(room);
  if (seats.length < 2) throw new Error("Cần ít nhất 2 người để bắt đầu");
  if (seats.length > 4) throw new Error("Tối đa 4 người chơi Sâm");

  const deck = shuffle(newDeck());
  for (const seat of room.seats) {
    if (!seat?.user) continue;
    seat.cards = [];
    seat.hasFinished = false;
    seat.finishOrder = 0;
    seat.lastAction = null;
  }

  // Deal 10 lá/người
  let deckPtr = 0;
  for (const seat of seats) {
    seat.cards = sortHand(deck.slice(deckPtr, deckPtr + 10));
    deckPtr += 10;
  }
  room.deck = deck.slice(deckPtr); // 52 - 40 = 12 lá dư (không dùng ván này)

  // Xác định starter — ai có 3♠
  let starterIdx = seats[0].seatIndex;
  for (const seat of seats) {
    if (seat.cards.includes("3s")) {
      starterIdx = seat.seatIndex;
      break;
    }
  }
  // Ván sau: nếu handNumber > 0 và có winner ván trước → winner đánh đầu.
  if (room.handNumber > 0 && Array.isArray(room.winners) && room.winners[0]) {
    starterIdx = room.winners[0].seatIndex;
  }
  room.starterIndex = starterIdx;
  room.activeIndex = starterIdx;

  room.currentCombo = null;
  room.passedSeats = [];
  room.plays = [];
  room.winners = [];
  room.handNumber += 1;
  room.stage = "playing";
  room.handStartedAt = new Date();
  room.handEndedAt = null;
  const now = Date.now();
  room.turnDeadlineAt = new Date(now + (room.turnDurationSec || 30) * 1000);
  return room;
}

/* -------- Combo primitives -------- */

// "single" | "pair" | "triple" | "quad" | "straight" | "dragon" | null
export function comboType(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const n = cards.length;
  const ranks = cards.map(cardRank);
  const uniqRanks = new Set(ranks);

  if (n === 1) return "single";
  if (n === 2 && uniqRanks.size === 1) return "pair";
  if (n === 3 && uniqRanks.size === 1) return "triple";
  if (n === 4 && uniqRanks.size === 1) return "quad";

  // Sảnh: 3+ lá liên tiếp (khác chất được), không có 2.
  if (n >= 3 && !ranks.includes("2")) {
    const vals = cards.map(rankValue).sort((a, b) => a - b);
    let isStraight = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) {
        isStraight = false;
        break;
      }
    }
    if (isStraight) {
      // Sảnh rồng (dragon) = 10 lá liên tiếp 3→A khác chất
      if (n === 10) return "dragon";
      return "straight";
    }
  }

  return null;
}

// So sánh 2 combo cùng loại. Trả về > 0 nếu a lớn hơn b, < 0 nếu nhỏ hơn.
// Sâm dùng bậc lá cao nhất; sảnh dùng lá cao nhất.
export function compareCombos(a, b) {
  if (a.type !== b.type) return 0; // không cùng loại → không so được (trừ chặt)
  if (a.cards.length !== b.cards.length) return 0;
  const aMax = Math.max(...a.cards.map(rankValue));
  const bMax = Math.max(...b.cards.map(rankValue));
  return aMax - bMax;
}

/* -------- Serializer -------- */

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
      hasFinished: s.hasFinished,
      finishOrder: s.finishOrder,
      lastAction: s.lastAction,
      sittingOut: s.sittingOut,
    };
  });
  return {
    _id: room._id,
    name: room.name,
    createdBy: room.createdBy,
    stake: room.stake,
    buyIn: room.buyIn,
    maxSeats: room.maxSeats,
    allowInstantWin: room.allowInstantWin,
    seats,
    handNumber: room.handNumber,
    stage: room.stage,
    starterIndex: room.starterIndex,
    activeIndex: room.activeIndex,
    deckCount: (room.deck || []).length,
    currentCombo: room.currentCombo || null,
    passedSeats: room.passedSeats || [],
    plays: room.plays || [],
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

export function applyAction(_room, _seatIndex, _action, _payload) {
  throw new Error("Sâm gameplay chưa hoàn thiện (Phase 3)");
}
