// services/xiangqiEngine.js — Cờ tướng engine.
// Board 10 hàng × 9 cột. Red (uppercase) ở nửa dưới (rows 5-9), Black (lowercase) nửa trên (rows 0-4). Sông = giữa row 4 và 5.
// Cung (palace): red = rows 7-9 cols 3-5; black = rows 0-2 cols 3-5.
// Pieces: K=Tướng, A=Sĩ, E=Tượng, H=Mã, R=Xe, C=Pháo, P=Tốt.

const SIZE_C = 9;
const SIZE_R = 10;

function idx(r, c) {
  return r * SIZE_C + c;
}
function inBoard(r, c) {
  return r >= 0 && r < SIZE_R && c >= 0 && c < SIZE_C;
}
function isRed(p) {
  return p && p >= "A" && p <= "Z";
}
function isBlack(p) {
  return p && p >= "a" && p <= "z";
}
function sameSide(a, b) {
  if (!a || !b) return false;
  return (isRed(a) && isRed(b)) || (isBlack(a) && isBlack(b));
}
function typeOf(p) {
  return p ? p.toUpperCase() : "";
}

function initialBoard() {
  const b = new Array(SIZE_R * SIZE_C).fill("");
  // Black (top, rows 0-4)
  const backRankBlack = ["r", "h", "e", "a", "k", "a", "e", "h", "r"];
  for (let c = 0; c < 9; c++) b[idx(0, c)] = backRankBlack[c];
  b[idx(2, 1)] = "c";
  b[idx(2, 7)] = "c";
  for (let c = 0; c < 9; c += 2) b[idx(3, c)] = "p";
  // Red (bottom, rows 5-9)
  const backRankRed = ["R", "H", "E", "A", "K", "A", "E", "H", "R"];
  for (let c = 0; c < 9; c++) b[idx(9, c)] = backRankRed[c];
  b[idx(7, 1)] = "C";
  b[idx(7, 7)] = "C";
  for (let c = 0; c < 9; c += 2) b[idx(6, c)] = "P";
  return b;
}

export function activeSeats(room) {
  return (room.seats || []).filter((s) => s?.user && !s.sittingOut);
}

export function startHand(room) {
  const seats = activeSeats(room);
  if (seats.length < 2) throw new Error("Cần đủ 2 người để bắt đầu");
  room.board = initialBoard();
  room.moves = [];
  room.winnerSeatIndex = -1;
  room.resultReason = null;
  room.handNumber += 1;
  room.stage = "playing";
  room.activeSeatIndex = 0; // đỏ đi trước
  room.handStartedAt = new Date();
  room.handEndedAt = null;
  const now = Date.now();
  room.turnDeadlineAt = new Date(
    now + (room.turnDurationSec || 60) * 1000,
  );
  return room;
}

// Kiểm tra 1 nước đi hợp lệ (không xử lý chiếu tướng — user tự thua nếu bị bắt K).
export function isLegalMove(board, from, to, red) {
  const [r1, c1] = from;
  const [r2, c2] = to;
  if (!inBoard(r1, c1) || !inBoard(r2, c2)) return false;
  if (r1 === r2 && c1 === c2) return false;
  const p = board[idx(r1, c1)];
  if (!p) return false;
  if (red && !isRed(p)) return false;
  if (!red && !isBlack(p)) return false;
  const target = board[idx(r2, c2)];
  if (target && sameSide(p, target)) return false;

  const t = typeOf(p);
  const dr = r2 - r1;
  const dc = c2 - c1;

  switch (t) {
    case "K": {
      // Tướng: 1 ô ngang/dọc, trong cung
      if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
      if (c2 < 3 || c2 > 5) return false;
      if (red && (r2 < 7 || r2 > 9)) return false;
      if (!red && (r2 < 0 || r2 > 2)) return false;
      // Face-to-face rule: nếu ăn K đối phương thẳng cột không bị chắn → hợp lệ (bắt được)
      return true;
    }
    case "A": {
      // Sĩ: chéo 1 ô trong cung
      if (Math.abs(dr) !== 1 || Math.abs(dc) !== 1) return false;
      if (c2 < 3 || c2 > 5) return false;
      if (red && (r2 < 7 || r2 > 9)) return false;
      if (!red && (r2 < 0 || r2 > 2)) return false;
      return true;
    }
    case "E": {
      // Tượng: chéo 2 ô, không vượt sông, mắt tượng không bị chắn
      if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) return false;
      if (red && r2 < 5) return false;
      if (!red && r2 > 4) return false;
      const midR = (r1 + r2) / 2;
      const midC = (c1 + c2) / 2;
      if (board[idx(midR, midC)]) return false;
      return true;
    }
    case "H": {
      // Mã: L (2+1), chân mã không bị chắn
      const absR = Math.abs(dr);
      const absC = Math.abs(dc);
      if (!((absR === 2 && absC === 1) || (absR === 1 && absC === 2))) {
        return false;
      }
      let blockR = r1, blockC = c1;
      if (absR === 2) blockR = r1 + dr / 2;
      else blockC = c1 + dc / 2;
      if (board[idx(blockR, blockC)]) return false;
      return true;
    }
    case "R": {
      // Xe: ngang/dọc, không có quân chắn
      if (dr !== 0 && dc !== 0) return false;
      const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
      const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;
      let rr = r1 + stepR, cc = c1 + stepC;
      while (rr !== r2 || cc !== c2) {
        if (board[idx(rr, cc)]) return false;
        rr += stepR;
        cc += stepC;
      }
      return true;
    }
    case "C": {
      // Pháo: ngang/dọc; đi không có quân chắn; ăn PHẢI có đúng 1 quân giữa
      if (dr !== 0 && dc !== 0) return false;
      const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
      const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;
      let rr = r1 + stepR, cc = c1 + stepC;
      let count = 0;
      while (rr !== r2 || cc !== c2) {
        if (board[idx(rr, cc)]) count++;
        rr += stepR;
        cc += stepC;
      }
      if (!target) return count === 0;
      return count === 1;
    }
    case "P": {
      // Tốt: đi thẳng trước; sau khi qua sông có thể ngang 1 ô. Không lùi.
      if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
      if (red) {
        if (dr > 0) return false; // đỏ đi lên (row nhỏ hơn)
        // Chưa qua sông (r1 >= 5): chỉ đi thẳng
        if (r1 >= 5 && dc !== 0) return false;
      } else {
        if (dr < 0) return false; // đen đi xuống
        if (r1 <= 4 && dc !== 0) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

// Kiểm tra face-to-face: sau 1 nước đi, 2 tướng cùng cột không có quân chắn → nước KHÔNG hợp lệ.
function faceToFace(board) {
  let redK = null, blackK = null;
  for (let r = 0; r < SIZE_R; r++) {
    for (let c = 0; c < SIZE_C; c++) {
      const p = board[idx(r, c)];
      if (p === "K") redK = [r, c];
      if (p === "k") blackK = [r, c];
    }
  }
  if (!redK || !blackK) return false;
  if (redK[1] !== blackK[1]) return false;
  const c = redK[1];
  const from = Math.min(redK[0], blackK[0]) + 1;
  const to = Math.max(redK[0], blackK[0]);
  for (let r = from; r < to; r++) {
    if (board[idx(r, c)]) return false;
  }
  return true;
}

export function applyMove(room, seatIndex, from, to) {
  if (room.stage !== "playing") {
    throw new Error("Ván chưa bắt đầu hoặc đã kết thúc");
  }
  if (seatIndex !== room.activeSeatIndex) {
    throw new Error("Chưa tới lượt bạn");
  }
  const red = seatIndex === 0;
  const board = [...(room.board || [])];
  if (!isLegalMove(board, from, to, red)) {
    throw new Error("Nước đi không hợp lệ");
  }
  const [r1, c1] = from;
  const [r2, c2] = to;
  const p = board[idx(r1, c1)];
  const captured = board[idx(r2, c2)];
  board[idx(r2, c2)] = p;
  board[idx(r1, c1)] = "";
  if (faceToFace(board)) {
    throw new Error("Không được để 2 tướng đối mặt");
  }
  room.board = board;
  room.moves.push({
    seatIndex,
    from,
    to,
    piece: p,
    captured: captured || null,
    at: new Date(),
  });

  // Ăn được tướng đối phương → thắng
  if (captured && (captured === "K" || captured === "k")) {
    room.winnerSeatIndex = seatIndex;
    room.resultReason = "bắt tướng";
    endHand(room);
    return room;
  }

  // Chuyển lượt
  room.activeSeatIndex = 1 - seatIndex;
  const now = Date.now();
  room.turnDeadlineAt = new Date(
    now + (room.turnDurationSec || 60) * 1000,
  );
  return room;
}

export function applyResign(room, seatIndex) {
  if (room.stage !== "playing") throw new Error("Ván chưa bắt đầu hoặc đã kết thúc");
  room.winnerSeatIndex = 1 - seatIndex;
  room.resultReason = "xin thua";
  endHand(room);
  return room;
}

function endHand(room) {
  const stake = room.stake || 100;
  room.stage = "showdown";
  room.turnDeadlineAt = null;
  room.handEndedAt = new Date();
  if (room.winnerSeatIndex >= 0) {
    const winner = room.seats.find((s) => s.seatIndex === room.winnerSeatIndex);
    const loser = room.seats.find((s) => s.seatIndex !== room.winnerSeatIndex && s?.user);
    if (winner && loser) {
      const pay = Math.min(loser.chips, stake);
      loser.chips -= pay;
      winner.chips += pay;
    }
  }
  return room;
}

export function serializeRoom(room) {
  return {
    _id: room._id,
    name: room.name,
    createdBy: room.createdBy,
    stake: room.stake,
    buyIn: room.buyIn,
    maxSeats: room.maxSeats,
    seats: (room.seats || []).map((s) => ({
      user: s.user,
      seatIndex: s.seatIndex,
      chips: s.chips,
      sittingOut: s.sittingOut,
    })),
    handNumber: room.handNumber,
    stage: room.stage,
    board: room.board || [],
    activeSeatIndex: room.activeSeatIndex,
    moves: room.moves || [],
    winnerSeatIndex: room.winnerSeatIndex,
    resultReason: room.resultReason,
    turnDeadlineAt: room.turnDeadlineAt,
    turnDurationSec: room.turnDurationSec,
    handStartedAt: room.handStartedAt,
    handEndedAt: room.handEndedAt,
    messages: room.messages || [],
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}
