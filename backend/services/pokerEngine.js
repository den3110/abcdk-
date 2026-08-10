// services/pokerEngine.js — Texas Hold'em No-Limit engine.
// Simple main pot only (không side pot cho MVP), buy-in cố định, blinds
// cố định. Hand evaluation dùng thuật toán cơ bản: rank tay + high cards.

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const SUITS = ["h", "d", "c", "s"]; // hearts, diamonds, clubs, spades

/* ═══════════ Deck ═══════════ */

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

// Fisher-Yates
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ═══════════ Hand evaluation ═══════════ */

/**
 * Trả về rank object: { rank: 1..10, tiebreak: [values...], name: string }
 * rank cao hơn = tay mạnh hơn. Compare rank trước, sau đó tiebreak lex.
 * 10 = Straight Flush, 9 = Four of a Kind, 8 = Full House, 7 = Flush,
 * 6 = Straight, 5 = Three of a Kind, 4 = Two Pair, 3 = One Pair, 2 = High Card
 */
export function evaluate5(cards) {
  const ranks = cards.map((c) => RANK_VAL[c[0]]).sort((a, b) => b - a);
  const suits = cards.map((c) => c[1]);
  const isFlush = suits.every((s) => s === suits[0]);
  const unique = Array.from(new Set(ranks)).sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      isStraight = true;
      straightHigh = unique[0];
    } else if (unique[0] === 14 && unique[1] === 5 && unique[4] === 2) {
      // A-2-3-4-5 wheel
      isStraight = true;
      straightHigh = 5;
    }
  }
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const sortedByCount = Object.entries(counts)
    .map(([r, c]) => ({ r: Number(r), c }))
    .sort((a, b) => (b.c - a.c) || (b.r - a.r));

  if (isFlush && isStraight)
    return { rank: 10, tiebreak: [straightHigh], name: "Straight Flush" };
  if (sortedByCount[0].c === 4)
    return {
      rank: 9,
      tiebreak: [sortedByCount[0].r, sortedByCount[1].r],
      name: "Four of a Kind",
    };
  if (sortedByCount[0].c === 3 && sortedByCount[1].c === 2)
    return {
      rank: 8,
      tiebreak: [sortedByCount[0].r, sortedByCount[1].r],
      name: "Full House",
    };
  if (isFlush) return { rank: 7, tiebreak: ranks.slice(), name: "Flush" };
  if (isStraight) return { rank: 6, tiebreak: [straightHigh], name: "Straight" };
  if (sortedByCount[0].c === 3)
    return {
      rank: 5,
      tiebreak: [
        sortedByCount[0].r,
        sortedByCount[1].r,
        sortedByCount[2].r,
      ],
      name: "Three of a Kind",
    };
  if (sortedByCount[0].c === 2 && sortedByCount[1].c === 2)
    return {
      rank: 4,
      tiebreak: [
        sortedByCount[0].r,
        sortedByCount[1].r,
        sortedByCount[2].r,
      ],
      name: "Two Pair",
    };
  if (sortedByCount[0].c === 2)
    return {
      rank: 3,
      tiebreak: [
        sortedByCount[0].r,
        sortedByCount[1].r,
        sortedByCount[2].r,
        sortedByCount[3].r,
      ],
      name: "One Pair",
    };
  return { rank: 2, tiebreak: ranks.slice(), name: "High Card" };
}

// Chọn combo 5 mạnh nhất từ 7 lá
export function evaluate7(cards) {
  if (cards.length < 5) return null;
  let best = null;
  const n = cards.length;
  for (let i = 0; i < n - 4; i++)
    for (let j = i + 1; j < n - 3; j++)
      for (let k = j + 1; k < n - 2; k++)
        for (let l = k + 1; l < n - 1; l++)
          for (let m = l + 1; m < n; m++) {
            const combo = [
              cards[i],
              cards[j],
              cards[k],
              cards[l],
              cards[m],
            ];
            const e = evaluate5(combo);
            if (!best || compareEval(e, best) > 0) {
              best = { ...e, cards: combo };
            }
          }
  return best;
}

export function compareEval(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.tiebreak.length, b.tiebreak.length); i++) {
    if (a.tiebreak[i] !== b.tiebreak[i])
      return a.tiebreak[i] - b.tiebreak[i];
  }
  return 0;
}

/* ═══════════ Hand flow helpers ═══════════ */

// Số seat active (ngồi + có chip + không sitting out)
export function activeSeats(room) {
  return (room.seats || []).filter(
    (s) => s.user && s.chips > 0 && !s.sittingOut,
  );
}

// Số seat còn trong ván (không fold + đã có bài)
export function playingSeats(room) {
  return (room.seats || []).filter(
    (s) => s.user && s.cards?.length && !s.hasFolded,
  );
}

// Tìm seat kế tiếp active theo chiều kim đồng hồ từ seatIndex.
export function nextActiveSeat(room, fromIdx) {
  const seats = room.seats || [];
  for (let i = 1; i <= seats.length; i++) {
    const idx = (fromIdx + i) % seats.length;
    const s = seats[idx];
    if (s?.user && s.cards?.length && !s.hasFolded && !s.isAllIn) return idx;
  }
  return -1;
}

// Bắt đầu ván mới. Requires activeSeats(room).length >= 2.
export function startHand(room) {
  const active = activeSeats(room);
  if (active.length < 2) throw new Error("Cần ít nhất 2 người có chip");

  // Reset state
  room.handNumber = (room.handNumber || 0) + 1;
  room.stage = "preflop";
  room.board = [];
  room.deck = shuffle(newDeck());
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = room.bigBlind;
  room.lastAggressorIndex = -1;
  room.actions = [];
  room.winners = [];
  room.reveals = [];
  room.actedThisStreet = [];
  room.handStartedAt = new Date();
  room.handEndedAt = null;
  room.lastActivityAt = new Date();

  // Reset seat states
  for (const s of room.seats) {
    s.cards = [];
    s.betThisStreet = 0;
    s.totalBetThisHand = 0;
    s.hasFolded = false;
    s.isAllIn = false;
    s.lastAction = null;
  }

  // Dealer nút — dịch sang seat active kế tiếp
  const seatIdxs = active.map((s) => s.seatIndex).sort((a, b) => a - b);
  let dealer = room.dealerIndex;
  const dealerActive = active.some((s) => s.seatIndex === dealer);
  if (!dealerActive) {
    dealer = seatIdxs[0];
  } else {
    const pos = seatIdxs.indexOf(dealer);
    dealer = seatIdxs[(pos + 1) % seatIdxs.length];
  }
  room.dealerIndex = dealer;

  // Small blind = ngay sau dealer trong active (heads-up: dealer = SB)
  let sbIdx, bbIdx;
  if (active.length === 2) {
    // Heads-up: dealer = SB
    sbIdx = dealer;
    bbIdx = seatIdxs.find((i) => i !== dealer);
  } else {
    const dpos = seatIdxs.indexOf(dealer);
    sbIdx = seatIdxs[(dpos + 1) % seatIdxs.length];
    bbIdx = seatIdxs[(dpos + 2) % seatIdxs.length];
  }

  // Post blinds
  postBlind(room, sbIdx, room.smallBlind, "post_sb");
  postBlind(room, bbIdx, room.bigBlind, "post_bb");
  room.currentBet = room.bigBlind;
  room.minRaise = room.bigBlind;

  // Deal 2 lá cho mỗi seat active
  for (let round = 0; round < 2; round++) {
    for (const s of active) {
      s.cards.push(room.deck.shift());
    }
  }

  // Actor đầu tiên = seat kế tiếp BB (hoặc SB trong heads-up)
  const bbPos = seatIdxs.indexOf(bbIdx);
  const firstActor = seatIdxs[(bbPos + 1) % seatIdxs.length];
  room.activeIndex = firstActor;
  room.lastAggressorIndex = bbIdx; // BB được checked-around thì street kết thúc
  setTurnDeadline(room);
}

function setTurnDeadline(room) {
  if (room.activeIndex < 0) {
    room.turnDeadlineAt = null;
    return;
  }
  const dur = room.turnDurationSec || 30;
  room.turnDeadlineAt = new Date(Date.now() + dur * 1000);
}

function postBlind(room, seatIdx, amount, actionName) {
  const s = room.seats[seatIdx];
  if (!s || !s.user) return;
  const actual = Math.min(amount, s.chips);
  s.chips -= actual;
  s.betThisStreet += actual;
  s.totalBetThisHand += actual;
  s.lastAction = actionName;
  if (s.chips === 0) s.isAllIn = true;
  room.pot += actual;
  room.actions.push({
    seatIndex: seatIdx,
    action: actionName,
    amount: actual,
    at: new Date(),
  });
}

// Xử lý action: "fold", "check", "call", "raise" (kèm amount = tổng bet
// mới cho street này), "allin".
export function applyAction(room, seatIdx, action, amount = 0) {
  if (seatIdx !== room.activeIndex) throw new Error("Chưa tới lượt bạn");
  const s = room.seats[seatIdx];
  if (!s?.user) throw new Error("Ghế trống");
  if (s.hasFolded || s.isAllIn) throw new Error("Bạn đã fold/allin");

  const toCall = room.currentBet - s.betThisStreet;
  let isAggression = false; // raise / allin vượt currentBet → mọi người act lại

  if (action === "fold") {
    s.hasFolded = true;
    s.lastAction = "fold";
    room.actions.push({
      seatIndex: seatIdx,
      action: "fold",
      amount: 0,
      at: new Date(),
    });
  } else if (action === "check") {
    if (toCall > 0) throw new Error("Không thể check khi có cược trước");
    s.lastAction = "check";
    room.actions.push({
      seatIndex: seatIdx,
      action: "check",
      amount: 0,
      at: new Date(),
    });
  } else if (action === "call") {
    if (toCall <= 0) throw new Error("Không có gì để call — bấm check");
    const actual = Math.min(toCall, s.chips);
    s.chips -= actual;
    s.betThisStreet += actual;
    s.totalBetThisHand += actual;
    room.pot += actual;
    if (s.chips === 0) s.isAllIn = true;
    s.lastAction = s.isAllIn ? "allin" : "call";
    room.actions.push({
      seatIndex: seatIdx,
      action: s.lastAction,
      amount: actual,
      at: new Date(),
    });
  } else if (action === "raise") {
    // amount = tổng bet mới cho street này (không phải delta)
    const target = Math.floor(amount);
    if (target <= room.currentBet)
      throw new Error("Raise phải lớn hơn bet hiện tại");
    const delta = target - s.betThisStreet;
    if (delta > s.chips) throw new Error("Không đủ chip");
    const raiseAmount = target - room.currentBet;
    if (raiseAmount < room.minRaise && delta < s.chips)
      throw new Error(`Raise tối thiểu ${room.minRaise}`);
    s.chips -= delta;
    s.betThisStreet += delta;
    s.totalBetThisHand += delta;
    room.pot += delta;
    if (s.chips === 0) s.isAllIn = true;
    room.currentBet = target;
    room.minRaise = raiseAmount;
    room.lastAggressorIndex = seatIdx;
    isAggression = true;
    s.lastAction = s.isAllIn ? "allin" : "raise";
    room.actions.push({
      seatIndex: seatIdx,
      action: s.lastAction,
      amount: target,
      at: new Date(),
    });
  } else if (action === "allin") {
    const delta = s.chips;
    if (delta <= 0) throw new Error("Không đủ chip để allin");
    const target = s.betThisStreet + delta;
    s.chips = 0;
    s.betThisStreet = target;
    s.totalBetThisHand += delta;
    s.isAllIn = true;
    room.pot += delta;
    if (target > room.currentBet) {
      const raiseAmount = target - room.currentBet;
      if (raiseAmount >= room.minRaise) room.minRaise = raiseAmount;
      room.currentBet = target;
      room.lastAggressorIndex = seatIdx;
      isAggression = true;
    }
    s.lastAction = "allin";
    room.actions.push({
      seatIndex: seatIdx,
      action: "allin",
      amount: target,
      at: new Date(),
    });
  } else {
    throw new Error("Action không hợp lệ");
  }

  // Track acted: raise → chỉ raiser đã act (mọi người khác phải act lại);
  // action thường → thêm seat vào danh sách đã act.
  if (isAggression) {
    room.actedThisStreet = [seatIdx];
  } else {
    const acted = new Set(room.actedThisStreet || []);
    acted.add(seatIdx);
    room.actedThisStreet = Array.from(acted);
  }

  room.lastActivityAt = new Date();
  advance(room);
}

// Sau mỗi action: nếu street chưa xong → chuyển actor; nếu xong → sang street kế
function advance(room) {
  const inHand = playingSeats(room);
  // Chỉ còn 1 người → thắng luôn
  if (inHand.length === 1) {
    return finishHandUncontested(room, inHand[0]);
  }

  // Street kết thúc khi: mọi seat còn chơi (non-fold, non-allin) đã match
  // currentBet VÀ đã hành động ít nhất 1 lần trong street này. Blinds không
  // tính là "đã act" → BB giữ option preflop; raise reset danh sách acted.
  // (Fix bug cũ: BB check xong lượt bị quay lại dealer vì check dựa vào
  // lastAction === "post_bb" đã bị ghi đè.)
  const nextIdx = nextActiveSeat(room, room.activeIndex);
  const activeInHand = inHand.filter((s) => !s.isAllIn);
  const allMatched = activeInHand.every(
    (s) => s.betThisStreet === room.currentBet,
  );
  const acted = new Set(room.actedThisStreet || []);
  const everyoneActed = activeInHand.every((s) => acted.has(s.seatIndex));

  if (allMatched && everyoneActed) {
    return advanceStreet(room);
  }

  if (nextIdx === -1) {
    // Không còn ai để hành động (tất cả allin) → chạy hết board
    return runOutBoard(room);
  }
  room.activeIndex = nextIdx;
  setTurnDeadline(room);
}

function advanceStreet(room) {
  // Reset betThisStreet + danh sách đã act cho street mới
  for (const s of room.seats) s.betThisStreet = 0;
  room.currentBet = 0;
  room.minRaise = room.bigBlind;
  room.actedThisStreet = [];

  // Deal board
  if (room.stage === "preflop") {
    room.deck.shift(); // burn
    room.board.push(room.deck.shift(), room.deck.shift(), room.deck.shift());
    room.stage = "flop";
  } else if (room.stage === "flop") {
    room.deck.shift();
    room.board.push(room.deck.shift());
    room.stage = "turn";
  } else if (room.stage === "turn") {
    room.deck.shift();
    room.board.push(room.deck.shift());
    room.stage = "river";
  } else if (room.stage === "river") {
    return showdown(room);
  }

  // Actor đầu tiên post-flop = SB (hoặc kế tiếp) — active kế dealer
  const seatIdxs = room.seats
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.user && x.s.cards?.length && !x.s.hasFolded && !x.s.isAllIn)
    .map((x) => x.i)
    .sort((a, b) => a - b);
  // <= 1 người còn chip để cược → không còn action nào có thể xảy ra,
  // chạy hết board rồi showdown luôn (fix bug: sau khi call all-in vẫn
  // được hỏi check/raise ở street kế).
  if (seatIdxs.length <= 1) return runOutBoard(room);
  const dealer = room.dealerIndex;
  const dpos = seatIdxs.findIndex((i) => i > dealer);
  const firstActor = dpos >= 0 ? seatIdxs[dpos] : seatIdxs[0];
  room.activeIndex = firstActor;
  room.lastAggressorIndex = firstActor; // nếu ai cũng check, street end tại đây
  setTurnDeadline(room);
}

// Tất cả đã allin → deal hết board rồi showdown
function runOutBoard(room) {
  while (room.board.length < 5) {
    if (room.stage === "preflop") {
      room.deck.shift();
      room.board.push(room.deck.shift(), room.deck.shift(), room.deck.shift());
      room.stage = "flop";
    } else if (room.stage === "flop") {
      room.deck.shift();
      room.board.push(room.deck.shift());
      room.stage = "turn";
    } else if (room.stage === "turn") {
      room.deck.shift();
      room.board.push(room.deck.shift());
      room.stage = "river";
    }
  }
  return showdown(room);
}

function finishHandUncontested(room, winner) {
  winner.chips += room.pot;
  room.winners = [
    {
      seatIndex: winner.seatIndex,
      userId: winner.user,
      handDescription: "Uncontested (đối thủ fold hết)",
      amountWon: room.pot,
      revealedCards: [],
    },
  ];
  endHand(room);
}

function showdown(room) {
  room.stage = "showdown";
  const inHand = playingSeats(room);
  const evaluated = inHand.map((s) => {
    const seven = [...s.cards, ...room.board];
    const e = evaluate7(seven);
    return { seat: s, eval: e };
  });
  evaluated.sort((a, b) => compareEval(b.eval, a.eval));
  // Winners = những người có eval bằng eval mạnh nhất
  const best = evaluated[0].eval;
  const winners = evaluated.filter((x) => compareEval(x.eval, best) === 0);
  const share = Math.floor(room.pot / winners.length);
  const remainder = room.pot - share * winners.length;
  room.winners = winners.map((w, idx) => {
    const amt = share + (idx === 0 ? remainder : 0);
    w.seat.chips += amt;
    return {
      seatIndex: w.seat.seatIndex,
      userId: w.seat.user,
      handDescription: w.eval.name,
      amountWon: amt,
      revealedCards: w.seat.cards.slice(),
    };
  });
  endHand(room);
}

function endHand(room) {
  room.handEndedAt = new Date();
  room.pot = 0;
  room.stage = "waiting";
  room.activeIndex = -1;
  room.currentBet = 0;
  room.turnDeadlineAt = null;
  room.deck = []; // clear để giảm document size
  // Đánh dấu seat hết chip → sitting out
  for (const s of room.seats) {
    if (s.user && s.chips <= 0) s.sittingOut = true;
    s.cards = []; // không giấu ván sau nữa
  }
}

/* ═══════════ Room DTO for client ═══════════ */

// Trả state ẩn: deck ẩn hoàn toàn, cards của người khác ẩn trừ showdown.
export function serializeRoom(room, viewerUserId) {
  const viewerStr = String(viewerUserId || "");
  const reveals = new Set(
    (room.reveals || []).map((r) => Number(r.seatIndex)),
  );
  const seats = (room.seats || []).map((s) => {
    const isViewer = s.user && String(s.user._id || s.user) === viewerStr;
    const showCards =
      reveals.has(s.seatIndex) ||
      (room.stage === "showdown" &&
        !s.hasFolded &&
        (room.winners || []).some((w) => w.seatIndex === s.seatIndex));
    return {
      seatIndex: s.seatIndex,
      user: s.user
        ? typeof s.user === "object"
          ? {
              _id: s.user._id,
              name: s.user.name,
              nickname: s.user.nickname,
              avatar: s.user.avatar,
            }
          : { _id: s.user }
        : null,
      chips: s.chips,
      cards:
        isViewer || showCards
          ? s.cards
          : s.cards?.length
            ? ["??", "??"]
            : [],
      betThisStreet: s.betThisStreet,
      totalBetThisHand: s.totalBetThisHand,
      hasFolded: s.hasFolded,
      isAllIn: s.isAllIn,
      lastAction: s.lastAction,
      sittingOut: s.sittingOut,
      isYou: isViewer,
    };
  });
  return {
    _id: room._id,
    name: room.name,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    buyIn: room.buyIn,
    maxSeats: room.maxSeats,
    stage: room.stage,
    handNumber: room.handNumber,
    dealerIndex: room.dealerIndex,
    activeIndex: room.activeIndex,
    board: room.board,
    pot: room.pot,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    seats,
    winners: room.winners,
    actions: (room.actions || []).slice(-15), // 15 actions gần nhất
    turnDeadlineAt: room.turnDeadlineAt,
    turnDurationSec: room.turnDurationSec || 30,
    messages: (room.messages || []).slice(-50),
    reveals: room.reveals || [],
    lastActivityAt: room.lastActivityAt,
    status: room.status,
  };
}
