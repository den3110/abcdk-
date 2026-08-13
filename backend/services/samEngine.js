// services/samEngine.js — Sâm Lốc engine skeleton.
// PHASE 2: deal 10 cards/player, combo primitives (đôi/tam/sảnh/tứ quý/
// sảnh rồng), serializeRoom. Turn state machine (play/pass, chặt 2, đền
// chip khi bắt tứ quý...) sẽ hoàn thiện Phase 3.
import { newDeck, shuffle, sortHand, cardRank, cardSuit } from "./cardDeck.js";

export { newDeck, shuffle, sortHand };

// Sâm/Tiến Lên rank order: 3 nhỏ nhất, 2 lớn nhất.
// 3=0, 4=1, ..., K=10, A=11, 2=12.
const SAM_ORDER = {
  "3": 0, "4": 1, "5": 2, "6": 3, "7": 4, "8": 5, "9": 6,
  T: 7, J: 8, Q: 9, K: 10, A: 11, "2": 12,
};
function samRankValue(card) {
  return SAM_ORDER[card?.[0]] ?? -1;
}

// Sort bài theo thứ tự Sâm (3 nhỏ nhất, 2 cao nhất). Cùng bậc → theo chất.
const SAM_SUIT_ORDER = { s: 3, h: 2, d: 1, c: 0 };
function samSortHand(cards) {
  return [...cards].sort((a, b) => {
    const dr = samRankValue(a) - samRankValue(b);
    if (dr !== 0) return dr;
    return (SAM_SUIT_ORDER[cardSuit(a)] || 0) - (SAM_SUIT_ORDER[cardSuit(b)] || 0);
  });
}

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
    seat.hasClaimedSam = false;
    seat.cutByHeoCount = 0;
    seat.caughtSamBy = -1;
  }
  room.samClaimerIndex = -1;
  room.samCatcherIndex = -1;
  room.xinSamDeadlineAt = null;

  // Deal 10 lá/người
  let deckPtr = 0;
  for (const seat of seats) {
    seat.cards = samSortHand(deck.slice(deckPtr, deckPtr + 10));
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
  room.activeIndex = -1; // chờ hết xin sâm

  room.currentCombo = null;
  room.passedSeats = [];
  room.plays = [];
  room.winners = [];
  room.handNumber += 1;
  // Phase Xin Sâm: 10s cho tất cả xin/bắt sâm
  room.stage = "xin_sam";
  room.handStartedAt = new Date();
  room.handEndedAt = null;
  const now = Date.now();
  room.xinSamDeadlineAt = new Date(now + 10_000);
  room.turnDeadlineAt = null;
  return room;
}

// Hoàn tất phase Xin Sâm → chuyển sang playing.
// Nếu có claimer → claimer đánh đầu. Ngược lại → starter có 3♠.
export function finishXinSam(room) {
  if (room.stage !== "xin_sam") return room;
  const claimerIdx = room.samClaimerIndex;
  const active = room.seats.filter((s) => s?.user && !s.sittingOut);
  const claimer = claimerIdx >= 0
    ? active.find((s) => s.seatIndex === claimerIdx)
    : null;
  if (claimer) {
    room.activeIndex = claimer.seatIndex;
  } else {
    room.activeIndex = room.starterIndex;
  }
  room.stage = "playing";
  room.xinSamDeadlineAt = null;
  const now = Date.now();
  room.turnDeadlineAt = new Date(
    now + (room.turnDurationSec || 30) * 1000,
  );
  return room;
}

// User xin sâm.
export function claimSam(room, seatIndex) {
  if (room.stage !== "xin_sam") {
    throw new Error("Không phải phase xin sâm");
  }
  const seat = room.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat || !seat.user) throw new Error("Ghế không hợp lệ");
  if (room.samClaimerIndex >= 0) {
    throw new Error("Đã có người xin sâm");
  }
  seat.hasClaimedSam = true;
  room.samClaimerIndex = seatIndex;
  seat.lastAction = "xin sâm";
  return room;
}

// User bắt sâm (khi có người khác đã xin).
export function catchSam(room, seatIndex) {
  if (room.stage !== "xin_sam") {
    throw new Error("Không phải phase xin sâm");
  }
  if (room.samClaimerIndex < 0) {
    throw new Error("Chưa có ai xin sâm để bắt");
  }
  if (room.samClaimerIndex === seatIndex) {
    throw new Error("Không thể bắt sâm của chính mình");
  }
  const seat = room.seats.find((s) => s.seatIndex === seatIndex);
  if (!seat || !seat.user) throw new Error("Ghế không hợp lệ");
  room.samCatcherIndex = seatIndex;
  seat.lastAction = "bắt sâm";
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
        .map((r) => SAM_ORDER[r])
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

  // Sảnh thường: 3+ lá liên tiếp (khác chất được), KHÔNG có 2.
  if (n >= 3 && !ranks.includes("2")) {
    const vals = cards.map(samRankValue).sort((a, b) => a - b);
    let isStraight = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) {
        isStraight = false;
        break;
      }
    }
    if (isStraight) {
      // Sảnh rồng = 10 lá liên tiếp 3→A (không có 2)
      if (n === 10) return "dragon";
      return "straight";
    }
  }

  // Sảnh A-low (A-2-3, A-2-3-4, A-2-3-4-5, ...): A đóng vai trò "1" đứng
  // trước 2, các lá còn lại phải là 3, 4, 5, ... liên tiếp. Cards phải
  // bao gồm cả A và 2. Không áp dụng cho length 10 (chồng với sảnh rồng).
  if (n >= 3 && n <= 9 && ranks.includes("A") && ranks.includes("2")) {
    // Mapping riêng cho A-low: A=0, 2=1, 3=2, 4=3, ..., K=12.
    const A_LOW = {
      A: 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6,
      "8": 7, "9": 8, T: 9, J: 10, Q: 11, K: 12,
    };
    const vals = ranks
      .map((r) => (r in A_LOW ? A_LOW[r] : -1))
      .sort((a, b) => a - b);
    // Bắt buộc bắt đầu bằng A(0)-2(1), các lá tiếp theo liên tiếp.
    if (vals[0] === 0 && vals[1] === 1) {
      let ok = true;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] !== vals[i - 1] + 1) {
          ok = false;
          break;
        }
      }
      if (ok) return "straight";
    }
  }

  return null;
}

// Sảnh A-low: cards chứa cả A và 2 (dùng để phân biệt với sảnh thường
// khi compareCombos — A-low là sảnh thấp nhất).
function isALowStraight(cards) {
  const ranks = cards.map(cardRank);
  return ranks.includes("A") && ranks.includes("2");
}

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
      const nMax = Math.max(...newCombo.cards.map(samRankValue));
      const oMax = Math.max(...oldCombo.cards.map(samRankValue));
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

  // Sảnh: A-low là sảnh thấp nhất; nếu 1 bên A-low, 1 bên regular thì
  // A-low luôn nhỏ hơn. Nếu cả 2 A-low, so bằng lá cao nhất (không tính
  // A/2). Nếu cả 2 regular, dùng max samRankValue mặc định.
  if (a.type === "straight") {
    const aLow = isALowStraight(a.cards);
    const bLow = isALowStraight(b.cards);
    if (aLow && !bLow) return -1;
    if (!aLow && bLow) return 1;
    if (aLow && bLow) {
      const topOf = (cards) => {
        const nonSpecial = cards
          .map(cardRank)
          .filter((r) => r !== "A" && r !== "2");
        if (nonSpecial.length === 0) return -Infinity;
        return Math.max(...nonSpecial.map((r) => SAM_ORDER[r] ?? -1));
      };
      return topOf(a.cards) - topOf(b.cards);
    }
  }

  const aMax = Math.max(...a.cards.map(samRankValue));
  const bMax = Math.max(...b.cards.map(samRankValue));
  return aMax - bMax;
}

/* -------- Serializer -------- */

// Enrich winners với userName từ populated seats (winners lưu trước populate
// nên user chỉ là ObjectId, sẽ hiện "?"). Gọi sau khi populate.
function enrichWinners(room) {
  if (!Array.isArray(room.winners) || !room.winners.length) return;
  const seatMap = new Map();
  for (const s of room.seats || []) {
    if (s?.user && typeof s.user === "object") {
      seatMap.set(s.seatIndex, s.user);
    }
  }
  for (const w of room.winners) {
    if (w.userName && w.userName !== "?") continue;
    const u = seatMap.get(w.seatIndex);
    if (u) {
      w.userName = u.nickname || u.name || "?";
      w.userId = u._id || w.userId;
    }
  }
}

export function serializeRoom(room, viewerUserId) {
  enrichWinners(room);
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
      hasClaimedSam: s.hasClaimedSam,
      cutByHeoCount: s.cutByHeoCount,
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
    xinSamDeadlineAt: room.xinSamDeadlineAt,
    samClaimerIndex: room.samClaimerIndex,
    samCatcherIndex: room.samCatcherIndex,
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

/* -------- Scoring (per-card × stake) -------- */

// Tính chip phạt cho 1 seat (loser). Return dương = phải trả.
// - Bị bắt sâm (đã xin sâm nhưng không thắng): stake × 10 × 2 × 3 (đền 3x móm)
// - Móm (không đánh được lá nào, còn đúng 10 lá): stake × 10 × 2
// - Bị chặt heo (đánh 2 mà bị đè): tính như móm — stake × 10 × 2
// - Thua bình thường: stake × cardsLeft
function computeLoserPenalty(seat, stake, isSamCaught) {
  if (isSamCaught) return stake * 10 * 2 * 3;
  if (seat.cutByHeoCount > 0) return stake * 10 * 2;
  const left = (seat.cards || []).length;
  if (left >= 10) return stake * 10 * 2; // móm
  return stake * left;
}

function endHand(room) {
  const stake = room.stake || 5;
  const active = room.seats.filter((s) => s?.user && !s.sittingOut);
  const finished = active.filter((s) => s.hasFinished);
  const notFinished = active.filter((s) => !s.hasFinished);

  // Gán finishOrder cho các seat chưa xong (theo thứ tự ai còn ít bài hơn = trước)
  const sortedNotFinished = [...notFinished].sort(
    (a, b) => (a.cards?.length || 0) - (b.cards?.length || 0),
  );
  let maxOrder = Math.max(0, ...finished.map((s) => s.finishOrder || 0));
  for (const s of sortedNotFinished) {
    maxOrder += 1;
    s.finishOrder = maxOrder;
    s.hasFinished = true;
  }

  // Winner = seat có finishOrder=1
  const winnerSeat = active.find((s) => s.finishOrder === 1);

  // Xử lý xin sâm: nếu có người xin sâm nhưng KHÔNG thắng ván → phạt bắt sâm
  const claimer = active.find((s) => s.hasClaimedSam);
  const samFailed = claimer && claimer.finishOrder !== 1;
  // Ai ăn tiền bắt sâm: samCatcherIndex (nếu có) hoặc winner
  const catcher =
    room.samCatcherIndex >= 0
      ? active.find((s) => s.seatIndex === room.samCatcherIndex)
      : winnerSeat;

  const results = active.map((s) => {
    if (s === winnerSeat) return { seat: s, amt: 0, pos: 1, note: "🏆 Nhất" };
    const isSamCaught = samFailed && s === claimer;
    const penalty = computeLoserPenalty(s, stake, isSamCaught);
    let note = "";
    if (isSamCaught) note = "Bị bắt sâm";
    else if (s.cutByHeoCount > 0) note = "Bị chặt heo";
    else if ((s.cards || []).length >= 10) note = "Móm";
    else note = `Còn ${(s.cards || []).length} lá`;
    return { seat: s, amt: -penalty, pos: s.finishOrder, note };
  });

  // Winner ăn tổng tất cả penalty; nếu có catcher riêng cho bắt sâm → 3x
  // penalty đó ăn về catcher, phần còn lại về winner.
  let winnerGain = 0;
  let catcherGain = 0;
  for (const r of results) {
    if (r.amt < 0) {
      const isSamCaughtRow =
        samFailed && r.seat === claimer;
      if (isSamCaughtRow && catcher && catcher !== winnerSeat) {
        catcherGain += -r.amt;
      } else {
        winnerGain += -r.amt;
      }
    }
  }
  // Apply chips
  for (const r of results) {
    if (r.amt < 0) {
      const pay = Math.min(r.seat.chips, -r.amt);
      r.seat.chips -= pay;
      r.amt = -pay;
    }
    r.seat.lastAction = r.note;
  }
  if (winnerSeat) {
    winnerSeat.chips += winnerGain;
    // Update winner row's amt
    const wr = results.find((r) => r.seat === winnerSeat);
    if (wr) wr.amt = winnerGain;
  }
  if (catcher && catcher !== winnerSeat) {
    catcher.chips += catcherGain;
    const cr = results.find((r) => r.seat === catcher);
    if (cr) cr.amt = (cr.amt || 0) + catcherGain;
  }

  room.winners = results
    .sort((a, b) => a.pos - b.pos)
    .map((r) => ({
      seatIndex: r.seat.seatIndex,
      userId: r.seat.user?._id || r.seat.user,
      userName: r.seat.user?.nickname || r.seat.user?.name || "?",
      handDescription:
        r.pos === 1 ? "🏆 Nhất ván" : r.note,
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
    let isCutting = false;
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
      } else {
        isCutting = true;
      }

      // Chặt heo: nếu current combo là single/pair/triple con 2 và bị chặt
      // → mark seat của người đánh 2 là bị chặt heo (penalty ván này).
      const curHas2 =
        (cur.type === "single" || cur.type === "pair" || cur.type === "triple") &&
        cur.cards[0] &&
        cur.cards[0][0] === "2";
      const isCutter =
        type === "quad" || type === "fourPairs" || type === "dragon";
      if (curHas2 && isCutter && cur.fromSeat != null && cur.fromSeat !== seatIndex) {
        const victim = room.seats.find(
          (s) => s.seatIndex === cur.fromSeat,
        );
        if (victim) victim.cutByHeoCount = (victim.cutByHeoCount || 0) + 1;
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

    // Hết bài → thắng ván ngay (rule Sâm: nhất = kết thúc luôn)
    if (seat.cards.length === 0) {
      seat.hasFinished = true;
      seat.finishOrder = 1;
      // Xếp các seat còn lại theo cards.length (ít lá hơn = hạng cao hơn)
      const others = room.seats
        .filter((s) => s?.user && !s.hasFinished && !s.sittingOut)
        .sort((a, b) => (a.cards?.length || 0) - (b.cards?.length || 0));
      let order = 2;
      for (const s of others) {
        s.finishOrder = order++;
        s.hasFinished = true;
      }
      endHand(room);
      return room;
    }
    scheduleNextTurn(room, nextActiveSeat(room, seatIndex));
    return room;
  }

  throw new Error("Action không hợp lệ: " + action);
}
