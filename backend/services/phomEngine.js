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

/* -------- Best-melds solver (Phase 3) -------- */

// Sinh tất cả tổ hợp con size 3-4-5 từ danh sách bài, kiểm tra là meld.
function generatePossibleMelds(cards) {
  const melds = [];
  const n = cards.length;
  // Chỉ xét size 3-5 (đủ dùng vì Phỏm chỉ 9 lá)
  for (const size of [3, 4, 5]) {
    const combo = (start, chosen) => {
      if (chosen.length === size) {
        if (isValidMeld(chosen.map((i) => cards[i]))) {
          melds.push([...chosen]);
        }
        return;
      }
      for (let i = start; i < n; i++) {
        chosen.push(i);
        combo(i + 1, chosen);
        chosen.pop();
      }
    };
    combo(0, []);
  }
  return melds;
}

// Tìm phân hoạch phỏm giảm điểm lẻ nhất. cards = bài trong tay.
// Trả về { melds: [[cards]], leftover: [cards], leftoverValue: number }.
// Leftover value = tổng bậc bài lẻ (2=2, ..., A=14).
export function findBestPartition(cards) {
  const possible = generatePossibleMelds(cards);
  let best = { meldSets: [], leftoverIdx: [...cards.keys()] };

  const solve = (idxAvail, chosenMelds) => {
    // Xử lý ngay leftover hiện tại
    if (chosenMelds.length && idxAvail.length < best.leftoverIdx.length) {
      best = { meldSets: [...chosenMelds], leftoverIdx: [...idxAvail] };
    }
    if (idxAvail.length === 0) return;
    if (!chosenMelds.length && best.leftoverIdx.length > cards.length - 3) {
      // baseline
      best = { meldSets: [], leftoverIdx: [...idxAvail] };
    }

    const availSet = new Set(idxAvail);
    for (const m of possible) {
      if (m.every((i) => availSet.has(i))) {
        const remaining = idxAvail.filter((i) => !m.includes(i));
        solve(remaining, [...chosenMelds, m]);
      }
    }
  };
  solve([...cards.keys()], []);

  const meldSets = best.meldSets.map((m) => m.map((i) => cards[i]));
  const leftover = best.leftoverIdx.map((i) => cards[i]);
  const leftoverValue = leftover.reduce(
    (sum, c) => sum + (rankValue(c) + 2),
    0,
  );
  return { melds: meldSets, leftover, leftoverValue };
}

// Ù = toàn bộ bài trong tay tạo thành phỏm hết (không còn lá lẻ).
export function isU(cards) {
  const part = findBestPartition(cards);
  return part.leftover.length === 0 && part.melds.length > 0;
}

/* -------- Turn management -------- */

function nextActiveSeat(room, fromIdx) {
  const activeIdxs = activeSeats(room).map((s) => s.seatIndex);
  if (activeIdxs.length === 0) return -1;
  const curPos = activeIdxs.indexOf(fromIdx);
  return activeIdxs[(curPos + 1) % activeIdxs.length];
}

function scheduleNextTurn(room, nextSeat) {
  room.activeIndex = nextSeat;
  const now = Date.now();
  room.turnDeadlineAt = new Date(now + (room.turnDurationSec || 30) * 1000);
}

// Đếm số vòng đã xong (mỗi vòng = mỗi active seat có 1 lượt).
// Sau 4 vòng đầy đủ → chuyển sang showdown.
function roundsCompleted(room) {
  const n = activeSeats(room).length;
  if (n === 0) return 0;
  return Math.floor((room.discards || []).length / n);
}

/* -------- Showdown + scoring -------- */

// Kết thúc ván → tính điểm mỗi seat, phân định winner, tính chip settlement.
function endHand(room) {
  const seats = activeSeats(room);
  const results = seats.map((seat) => {
    // Lấy bài còn trong tay (chưa trong melds đã hạ)
    const inHand = seat.cards;
    const already = new Set((seat.melds || []).flat());
    const remaining = inHand.filter((c) => !already.has(c));
    // Nếu đã ù, leftover = 0
    if (seat.hasWon) {
      return {
        seatIndex: seat.seatIndex,
        leftoverValue: 0,
        leftover: [],
        finalMelds: seat.melds || [],
        userName: seat.user?.nickname || seat.user?.name || "?",
        userId: seat.user?._id || seat.user,
      };
    }
    // Tìm phân hoạch phỏm tốt nhất trong bài còn lại
    const part = findBestPartition(remaining);
    return {
      seatIndex: seat.seatIndex,
      leftoverValue: part.leftoverValue,
      leftover: part.leftover,
      finalMelds: [...(seat.melds || []), ...part.melds],
      userName: seat.user?.nickname || seat.user?.name || "?",
      userId: seat.user?._id || seat.user,
    };
  });

  // Sort ascending leftover — ai thấp nhất thắng
  results.sort((a, b) => a.leftoverValue - b.leftoverValue);
  const winner = results[0];
  const stake = room.stake || 50;

  // Chip settlement: mỗi loser trả stake × (leftoverValue - winner.leftoverValue) hoặc flat
  // Simple: winner ăn stake × (n-1); mỗi loser trả stake
  const winSeat = room.seats.find((s) => s.seatIndex === winner.seatIndex);
  let totalGain = 0;
  for (const r of results) {
    if (r.seatIndex === winner.seatIndex) continue;
    const seat = room.seats.find((s) => s.seatIndex === r.seatIndex);
    // Móm = không có phỏm nào (leftover = cả 9 lá) → phạt gấp đôi
    const isMom = (r.finalMelds || []).length === 0;
    const penalty = isMom ? stake * 2 : stake;
    const pay = Math.min(seat.chips, penalty);
    seat.chips -= pay;
    totalGain += pay;
    seat.lastAction = isMom ? "móm" : "thua";
  }
  if (winSeat) winSeat.chips += totalGain;

  // Save winners + reveals
  room.winners = results.map((r) => ({
    seatIndex: r.seatIndex,
    userId: r.userId,
    userName: r.userName,
    handDescription:
      r.seatIndex === winner.seatIndex
        ? "🏆 Nhất ván"
        : (r.finalMelds || []).length === 0
        ? "Móm"
        : `Lẻ ${r.leftoverValue}`,
    amountWon:
      r.seatIndex === winner.seatIndex
        ? totalGain
        : -(((r.finalMelds || []).length === 0 ? stake * 2 : stake)),
    revealedCards: r.leftover,
  }));
  room.stage = "showdown";
  room.activeIndex = -1;
  room.turnDeadlineAt = null;
  room.handEndedAt = new Date();
  // Reset stage waiting sau 5s? — client tự bấm "bắt đầu" ván mới.
  setTimeout(() => {
    // Không dùng — client sẽ gọi start manual
  }, 0);
  return room;
}

/* -------- Apply action -------- */

// action: "draw_deck" | "draw_discard" | "discard" | "u"
// payload: { card?: string, meldCards?: string[] }
export function applyAction(room, seatIndex, action, payload = {}) {
  if (room.stage !== "playing") {
    throw new Error("Ván chưa bắt đầu hoặc đã kết thúc");
  }
  if (seatIndex !== room.activeIndex) {
    throw new Error("Chưa tới lượt bạn");
  }
  const seat = room.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat || !seat.user) throw new Error("Ghế không hợp lệ");

  const now = Date.now();

  if (action === "u") {
    // Ù: cả bài trong tay tạo thành phỏm hết
    if (!isU(seat.cards)) {
      throw new Error("Bài chưa ù (còn lá lẻ)");
    }
    seat.hasWon = true;
    seat.melds = findBestPartition(seat.cards).melds;
    endHand(room);
    return room;
  }

  if (action === "draw_deck") {
    if (seat.cards.length !== 9 && seat.seatIndex !== room.dealerIndex) {
      throw new Error("Không thể bốc lúc này");
    }
    if (seat.cards.length >= 10) {
      throw new Error("Đã có 10 lá, phải thảy trước");
    }
    if ((room.deck || []).length === 0) {
      // Nọc hết → kết thúc ván, tính điểm
      endHand(room);
      return room;
    }
    const drawn = room.deck.shift();
    seat.cards = sortHand([...seat.cards, drawn]);
    seat.lastAction = "bốc nọc";
    // Phải thảy 1 lá — chuyển state chờ discard (không đổi turn)
    return room;
  }

  if (action === "draw_discard") {
    // Ăn lá trên cùng discard, PHẢI kèm meld 3-lá (ít nhất) chứa lá đó
    const meldCards = Array.isArray(payload.meldCards)
      ? payload.meldCards
      : null;
    if (!meldCards || meldCards.length < 3) {
      throw new Error("Phải ghép thành phỏm 3+ lá để ăn");
    }
    if (!room.discards || room.discards.length === 0) {
      throw new Error("Không có bài để ăn");
    }
    const top = room.discards[room.discards.length - 1];
    if (!meldCards.includes(top.card)) {
      throw new Error("Phỏm phải chứa lá vừa thảy");
    }
    // Các lá còn lại trong meld phải có trong tay
    const otherCards = meldCards.filter((c) => c !== top.card);
    for (const c of otherCards) {
      if (!seat.cards.includes(c)) {
        throw new Error("Bài không có trong tay: " + c);
      }
    }
    if (!isValidMeld(meldCards)) {
      throw new Error("Không phải phỏm hợp lệ");
    }
    // Thực hiện: bỏ lá top ra discard, thêm vào tay, hạ meld
    room.discards.pop();
    seat.cards = sortHand([...seat.cards, top.card]);
    seat.melds = [...(seat.melds || []), meldCards];
    seat.hasDowned = true;
    seat.lastAction = "ăn + hạ phỏm";
    // Phải thảy 1 lá — chưa đổi turn
    return room;
  }

  if (action === "discard") {
    const card = String(payload.card || "");
    if (!seat.cards.includes(card)) {
      throw new Error("Không có lá đó trong tay");
    }
    if (seat.cards.length <= 9 && seat.seatIndex !== room.dealerIndex) {
      throw new Error("Phải bốc bài trước");
    }
    seat.cards = seat.cards.filter((c) => c !== card);
    room.discards.push({
      card,
      fromSeat: seat.seatIndex,
      at: new Date(),
    });
    seat.lastAction = "thảy " + card;

    // Chuyển lượt
    const next = nextActiveSeat(room, seat.seatIndex);
    scheduleNextTurn(room, next);

    // Nếu đã đủ 4 vòng → kết thúc ván
    if (roundsCompleted(room) >= 4) {
      endHand(room);
    }
    return room;
  }

  throw new Error("Action không hợp lệ: " + action);
}
