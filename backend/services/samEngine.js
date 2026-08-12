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

// "single" | "pair" | "triple" | "quad" | "straight" | "fourPairs" | "dragon" | null
// fourPairs = 4 đôi thông (VD: 3♠3♥ 4♠4♥ 5♠5♥ 6♠6♥) — 8 lá, 4 rank liên tiếp, mỗi rank 2 lá
export function comboType(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const n = cards.length;
  const ranks = cards.map(cardRank);
  const uniqRanks = new Set(ranks);

  if (n === 1) return "single";
  if (n === 2 && uniqRanks.size === 1) return "pair";
  if (n === 3 && uniqRanks.size === 1) return "triple";
  if (n === 4 && uniqRanks.size === 1) return "quad";

  // 4 đôi thông (8 lá): 4 rank liên tiếp, mỗi rank đúng 2 lá, không có 2.
  if (n === 8 && !ranks.includes("2")) {
    const rankCount = new Map();
    for (const r of ranks) rankCount.set(r, (rankCount.get(r) || 0) + 1);
    if (rankCount.size === 4 && [...rankCount.values()].every((v) => v === 2)) {
      const vals = [...rankCount.keys()]
        .map((r) => RANK_ORDER_VAL[r])
        .sort((a, b) => a - b);
      let consec = true;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] !== vals[i - 1] + 1) {
          consec = false;
          break;
        }
      }
      if (consec) return "fourPairs";
    }
  }

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

// Local map cho fourPairs — dùng thứ tự 2-3-...-A theo rankValue.
const RANK_ORDER_VAL = {
  "2": 0, "3": 1, "4": 2, "5": 3, "6": 4, "7": 5, "8": 6, "9": 7,
  T: 8, J: 9, Q: 10, K: 11, A: 12,
};

// Kiểm tra combo mới có "chặt" được combo cũ không (cross-type).
// Trả true nếu newCombo hợp lệ để đè cũ.
// Rules đơn giản:
// - Tứ quý chặt: single 2, pair 2, triple 2, 3 đôi thông (bỏ qua Phase 4)
// - 4 đôi thông chặt: tứ quý bất kỳ
// - Sảnh rồng chặt: tứ quý bất kỳ, 4 đôi thông, 2 đơn/đôi/tam
// - Tứ quý cao chặt tứ quý thấp
// - 4 đôi thông cao chặt 4 đôi thông thấp
// - Sảnh rồng chặt sảnh rồng (không xảy ra vì mỗi ván chỉ 1)
export function canCut(newCombo, oldCombo) {
  if (!oldCombo) return false;
  const nt = newCombo.type;
  const ot = oldCombo.type;
  const oldIs2 = ot === "single" || ot === "pair" || ot === "triple";
  const oldHas2 = oldIs2 && cardRank(oldCombo.cards[0]) === "2";

  // Tứ quý chặt 2 (single/pair/triple)
  if (nt === "quad" && oldHas2) return true;

  // 4 đôi thông chặt tứ quý hoặc 2 (single/pair/triple)
  if (nt === "fourPairs" && (ot === "quad" || oldHas2)) return true;

  // Sảnh rồng chặt tất cả
  if (nt === "dragon") return true;

  // Cùng loại chặt (higher rank)
  if (nt === ot) {
    if (nt === "quad" || nt === "fourPairs") {
      const nMax = Math.max(...newCombo.cards.map(rankValue));
      const oMax = Math.max(...oldCombo.cards.map(rankValue));
      return nMax > oMax;
    }
  }

  return false;
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

/* -------- Turn management -------- */

function nextActiveSeat(room, fromIdx) {
  const allSeats = (room.seats || []).filter(
    (s) => s?.user && !s.sittingOut && !s.hasFinished,
  );
  if (allSeats.length === 0) return -1;
  const idxs = allSeats.map((s) => s.seatIndex);
  const curPos = idxs.indexOf(fromIdx);
  return idxs[(curPos + 1) % idxs.length];
}

function scheduleNextTurn(room, nextSeat) {
  room.activeIndex = nextSeat;
  const now = Date.now();
  room.turnDeadlineAt = new Date(now + (room.turnDurationSec || 30) * 1000);
}

/* -------- Scoring -------- */

function endHand(room) {
  const stake = room.stake || 100;
  // Người chưa hết bài (thối) = lastPlace, phạt chip cho tất cả người khác
  const finished = room.seats.filter((s) => s?.user && s.hasFinished);
  const notFinished = room.seats.filter(
    (s) => s?.user && !s.hasFinished && !s.sittingOut,
  );
  // Nếu chỉ còn 1 người chưa hết → gán họ order cuối
  if (notFinished.length === 1) {
    const last = notFinished[0];
    const maxOrder = Math.max(0, ...finished.map((s) => s.finishOrder || 0));
    last.finishOrder = maxOrder + 1;
    last.hasFinished = true;
  }
  // Xếp hạng cuối: order 1 = nhất, order n = bét
  const ranked = room.seats
    .filter((s) => s?.user)
    .sort((a, b) => (a.finishOrder || 99) - (b.finishOrder || 99));

  // Chip settlement: mỗi bậc thấp hơn trả stake cho bậc cao hơn
  // Nhất ăn stake × (rank_last), Nhì ăn stake × (rank_last-1) - stake (trả nhất),...
  // Simple: mỗi seat = stake × (n - 2*order + 1) so ranking cao ăn
  const n = ranked.length;
  const results = ranked.map((s, i) => {
    const pos = i + 1; // 1..n
    // Điểm chip: (n+1)/2 là điểm 0. Cao hơn → dương, thấp hơn → âm.
    const points = n - pos * 2 + 1;
    const amt = stake * points;
    return { seat: s, pos, amt };
  });
  for (const r of results) {
    r.seat.chips += r.amt;
    r.seat.lastAction = r.pos === 1 ? "🏆 Nhất" : r.pos === n ? "Thối" : `Hạng ${r.pos}`;
  }

  room.winners = results.map((r) => ({
    seatIndex: r.seat.seatIndex,
    userId: r.seat.user?._id || r.seat.user,
    userName: r.seat.user?.nickname || r.seat.user?.name || "?",
    handDescription:
      r.pos === 1 ? "🏆 Nhất ván" : r.pos === n ? "Thối" : `Hạng ${r.pos}`,
    amountWon: r.amt,
    revealedCards: r.seat.cards || [],
  }));
  room.stage = "showdown";
  room.activeIndex = -1;
  room.turnDeadlineAt = null;
  room.handEndedAt = new Date();
  return room;
}

/* -------- Apply action -------- */

// action: "play" | "pass"
// payload: { cards?: string[] }
export function applyAction(room, seatIndex, action, payload = {}) {
  if (room.stage !== "playing") {
    throw new Error("Ván chưa bắt đầu hoặc đã kết thúc");
  }
  if (seatIndex !== room.activeIndex) {
    throw new Error("Chưa tới lượt bạn");
  }
  const seat = room.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat || !seat.user) throw new Error("Ghế không hợp lệ");
  if (seat.hasFinished) throw new Error("Bạn đã hết bài");

  if (action === "pass") {
    // Không được pass nếu không có combo trên bàn
    if (!room.currentCombo) {
      throw new Error("Không thể pass — bạn phải đánh combo mới");
    }
    seat.lastAction = "pass";
    room.passedSeats = [...(room.passedSeats || []), seatIndex];
    room.plays = room.plays || [];
    room.plays.push({ seatIndex, action: "pass", cards: [], at: new Date() });

    // Nếu tất cả người còn chơi (chưa finished) đều pass trừ 1 → người đó
    // được đánh combo mới
    const activePlayers = room.seats.filter(
      (s) => s?.user && !s.hasFinished && !s.sittingOut,
    );
    const stillIn = activePlayers.filter(
      (s) => !room.passedSeats.includes(s.seatIndex),
    );
    if (stillIn.length === 1) {
      // Reset round
      room.currentCombo = null;
      room.passedSeats = [];
      scheduleNextTurn(room, stillIn[0].seatIndex);
    } else {
      scheduleNextTurn(room, nextActiveSeat(room, seatIndex));
    }
    return room;
  }

  if (action === "play") {
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    if (cards.length === 0) throw new Error("Phải chọn ít nhất 1 lá");
    // Check bài có trong tay
    for (const c of cards) {
      if (!seat.cards.includes(c)) {
        throw new Error("Bài không có trong tay: " + c);
      }
    }
    const type = comboType(cards);
    if (!type) throw new Error("Không phải combo hợp lệ");

    // Nếu đang có combo trên bàn, phải cùng loại + cao hơn HOẶC chặt hợp lệ.
    if (room.currentCombo) {
      const cur = room.currentCombo;
      const newCombo = { cards, type };
      const sameShape =
        cur.type === type && cur.cards.length === cards.length;
      if (sameShape) {
        const cmp = compareCombos(newCombo, cur);
        if (cmp <= 0) {
          throw new Error("Combo phải lớn hơn combo trên bàn");
        }
      } else if (!canCut(newCombo, cur)) {
        throw new Error(
          `Không đè được ${cur.type} bằng ${type} — chọn combo khác hoặc pass`,
        );
      }
    } else {
      // Combo đầu ván: nếu ai có 3♠ phải chứa nó trong lượt đầu
      if (room.handNumber >= 1 && (room.plays || []).length === 0) {
        if (seat.cards.includes("3s") && !cards.includes("3s")) {
          throw new Error("Lượt đầu ván phải đánh combo chứa 3♠");
        }
      }
    }

    // Bỏ bài khỏi tay + set combo hiện tại
    seat.cards = seat.cards.filter((c) => !cards.includes(c));
    room.currentCombo = { cards, type, fromSeat: seatIndex };
    room.passedSeats = [];
    room.plays = room.plays || [];
    room.plays.push({ seatIndex, action: "play", cards, at: new Date() });
    seat.lastAction = "đánh " + type;

    // Hết bài → finish
    if (seat.cards.length === 0) {
      seat.hasFinished = true;
      const maxOrder = Math.max(
        0,
        ...room.seats.filter((s) => s.finishOrder > 0).map((s) => s.finishOrder),
      );
      seat.finishOrder = maxOrder + 1;

      // Chỉ còn 1 người chưa hết → kết thúc ván
      const notFinished = room.seats.filter(
        (s) => s?.user && !s.hasFinished && !s.sittingOut,
      );
      if (notFinished.length <= 1) {
        endHand(room);
        return room;
      }
      // Người này hết bài, chuyển lượt cho người kế
      scheduleNextTurn(room, nextActiveSeat(room, seatIndex));
    } else {
      scheduleNextTurn(room, nextActiveSeat(room, seatIndex));
    }
    return room;
  }

  throw new Error("Action không hợp lệ: " + action);
}
